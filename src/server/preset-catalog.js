const { getSetting, setSetting } = require('./db');
const { guardedFetch } = require('./server-fetch');

const HEIMDALL_TREE_URL = process.env.HEIMDALL_TREE_URL || 'https://api.github.com/repos/linuxserver/Heimdall-Apps/git/trees/master?recursive=true';
const HEIMDALL_RAW_PREFIX = process.env.HEIMDALL_RAW_PREFIX || 'https://raw.githubusercontent.com/linuxserver/Heimdall-Apps/master/';
const HEIMDALL_RAW_RE = new RegExp('^' + HEIMDALL_RAW_PREFIX.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
const COOLDOWN_MS = 60_000;

function slugify(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72);
}

/**
 * Sync Heimdall presets from GitHub into the preset_cache table.
 * Fails gracefully on network errors (air-gapped fallback).
 */
async function syncHeimdallPresets(db) {
  const startedAt = new Date().toISOString();
  const updateStatus = (status, synced = 0, error = null) => {
    setSetting(db, 'preset_catalog_sync_status', {
      status,
      startedAt,
      completedAt: status === 'running' ? null : new Date().toISOString(),
      synced,
      error
    });
  };

  const remoteEnabled = getSetting(db, 'enable_remote_presets', true);
  if (!remoteEnabled) {
    console.log('[preset-catalog] Remote presets disabled, skipping sync.');
    updateStatus('idle', 0, 'Remote presets disabled');
    return { synced: 0, skipped: true };
  }

  updateStatus('running');

  let treeData;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await guardedFetch(HEIMDALL_TREE_URL, {
        signal: controller.signal,
        headers: { 'User-Agent': 'home-lab-launcher', Accept: 'application/vnd.github.v3+json' }
      }, { actorRole: 'admin', label: 'Heimdall catalog URL' });
      if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
      treeData = await response.json();
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    console.warn('[preset-catalog] Could not reach GitHub API, preserving existing presets:', error.message);
    updateStatus('failed', 0, error.message);
    return { synced: 0, error: error.message };
  }

  const tree = treeData?.tree;
  if (!Array.isArray(tree)) {
    console.warn('[preset-catalog] Unexpected GitHub API response, skipping.');
    updateStatus('failed', 0, 'Unexpected response format');
    return { synced: 0, error: 'Unexpected response format' };
  }

  const filesByDir = {};
  for (const item of tree) {
    const parts = item.path.split('/');
    if (parts.length > 1) {
      const dirName = parts[0];
      const fileName = parts.slice(1).join('/');
      if (!filesByDir[dirName]) {
        filesByDir[dirName] = [];
      }
      filesByDir[dirName].push(fileName);
    }
  }

  const dirs = Object.keys(filesByDir);
  let synced = 0;

  const stmt = db.prepare(`
    INSERT INTO preset_cache (id, name, website, description, category, accent, icon_url, source)
    VALUES (@id, @name, @website, @description, @category, @accent, @icon_url, 'heimdall')
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      website = excluded.website,
      description = excluded.description,
      category = excluded.category,
      accent = excluded.accent,
      icon_url = excluded.icon_url,
      cached_at = CURRENT_TIMESTAMP
    WHERE source = 'heimdall'
  `);

  for (const dirName of dirs) {
    try {
      if (!filesByDir[dirName].includes('app.json')) continue;

      const appJsonUrl = `${HEIMDALL_RAW_PREFIX}${encodeURIComponent(dirName)}/app.json`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let appJson;
      try {
        const res = await guardedFetch(appJsonUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': 'home-lab-launcher' }
        }, { actorRole: 'admin', label: 'Heimdall app.json' });
        if (!res.ok) continue;
        appJson = await res.json();
      } finally {
        clearTimeout(timeout);
      }

      const name = appJson.name || dirName;
      const id = `heimdall-${slugify(name)}`;

      // Discover actual image asset
      const supportedExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
      const appFiles = filesByDir[dirName];
      const imageFiles = appFiles.filter(f => supportedExtensions.some(ext => f.toLowerCase().endsWith(ext)));

      let iconUrl = '';
      if (imageFiles.length > 0) {
        const logoFile = imageFiles.find(f => f.toLowerCase().includes('logo'));
        const iconFile = logoFile || imageFiles[0];
        iconUrl = `${HEIMDALL_RAW_PREFIX}${encodeURIComponent(dirName)}/${encodeURIComponent(iconFile)}`;
      }

      const colour = appJson.colour || appJson.color || '#4de7ff';

      stmt.run({
        id,
        name,
        website: appJson.website || appJson.url || '',
        description: appJson.description || '',
        category: (appJson.category || 'general').toLowerCase(),
        accent: colour.startsWith('#') ? colour : `#${colour}`,
        icon_url: iconUrl || null
      });
      synced += 1;
    } catch (error) {
      // Skip individual app failures
      console.warn(`[preset-catalog] Skipping Heimdall app ${dirName}:`, error.message);
    }
  }

  setSetting(db, 'last_preset_crawled_at', Date.now());
  console.log(`[preset-catalog] Heimdall sync complete: ${synced} presets updated.`);
  updateStatus('succeeded', synced);
  return { synced };
}

/**
 * Check if a manual catalog update can proceed (60s cooldown).
 */
function canUpdateCatalog(db) {
  const lastCrawl = getSetting(db, 'last_preset_crawled_at', 0);
  const elapsed = Date.now() - Number(lastCrawl || 0);
  return elapsed >= COOLDOWN_MS;
}

/**
 * Remaining seconds before the next manual update is allowed.
 */
function catalogCooldownRemaining(db) {
  const lastCrawl = getSetting(db, 'last_preset_crawled_at', 0);
  const elapsed = Date.now() - Number(lastCrawl || 0);
  return Math.max(0, Math.ceil((COOLDOWN_MS - elapsed) / 1000));
}

/**
 * Search presets in the cache by keyword.
 */
function searchPresets(db, query, { limit = 25, source } = {}) {
  const q = `%${String(query || '').trim().toLowerCase()}%`;
  let sql = `SELECT * FROM preset_cache WHERE (LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(category) LIKE ?)`;
  const params = [q, q, q];
  if (source) {
    sql += ` AND source = ?`;
    params.push(source);
  }
  sql += ` ORDER BY CASE source WHEN 'local' THEN 0 ELSE 1 END, name ASC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params);
}

/**
 * Get a single preset by id.
 */
function getPreset(db, id) {
  return db.prepare('SELECT * FROM preset_cache WHERE id = ?').get(id);
}

/**
 * Register the weekly Heimdall sync job with the scheduler.
 */
function startPresetCatalogScheduler(db, scheduler) {
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  if (scheduler) {
    scheduler.addInterval('preset-catalog-sync', () => syncHeimdallPresets(db), {
      intervalMs: WEEK_MS,
      initialDelayMs: 30_000
    });
  }
}

module.exports = {
  syncHeimdallPresets,
  canUpdateCatalog,
  catalogCooldownRemaining,
  searchPresets,
  getPreset,
  startPresetCatalogScheduler,
  HEIMDALL_RAW_RE
};
