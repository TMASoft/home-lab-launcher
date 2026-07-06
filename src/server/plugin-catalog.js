const { getSetting, setSetting } = require('./db');
const { guardedFetch } = require('./server-fetch');
const { cleanText } = require('./validation');
const { parseGithubRepo, LAUNCHER_PLUGIN_API_VERSION, compareVersions } = require('./plugins');

const PLUGIN_CATALOG_URL = process.env.PLUGIN_CATALOG_URL || 'https://raw.githubusercontent.com/TMASoft/home-lab-launcher-plugins/main/catalog.json';
const PLUGIN_CATALOG_FORMAT = 'home-lab-launcher-plugin-catalog-v1';
const CACHE_SETTING_KEY = 'plugin_catalog_cache';
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CATALOG_ENTRIES = 200;
const TRUST_LEVELS = new Set(['official', 'community']);

function shortText(value, max = 500) {
  return cleanText(value, '', max);
}

function shortList(value, itemMax = 40, listMax = 20) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => shortText(item, itemMax)).filter(Boolean).slice(0, listMax);
}

function normalizeCatalogEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Catalog entry must be an object');
  const id = shortText(raw.id, 120);
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) throw new Error('Catalog entry id must match the plugin manifest id format');
  const name = shortText(raw.name, 120);
  if (!name) throw new Error(`Catalog entry ${id} is missing a name`);
  const { sourceUrl } = parseGithubRepo(raw.repo);
  const launcherApiVersion = Number(raw.launcherApiVersion || 1);
  if (!Number.isFinite(launcherApiVersion)) throw new Error(`Catalog entry ${id} has a non-numeric launcherApiVersion`);
  let homepage = '';
  if (raw.homepage) {
    const parsed = new URL(String(raw.homepage));
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`Catalog entry ${id} homepage must be http or https`);
    homepage = parsed.toString();
  }
  const sha256 = {};
  if (raw.sha256 && typeof raw.sha256 === 'object' && !Array.isArray(raw.sha256)) {
    for (const [version, hash] of Object.entries(raw.sha256).slice(0, 50)) {
      const cleanedHash = shortText(hash, 64).toLowerCase();
      const cleanedVersion = shortText(version, 120);
      if (cleanedVersion && /^[a-f0-9]{64}$/.test(cleanedHash)) sha256[cleanedVersion] = cleanedHash;
    }
  }
  const trust = String(raw.trust || '').trim().toLowerCase();
  return {
    id,
    name,
    description: shortText(raw.description, 1000),
    repo: sourceUrl,
    homepage,
    trust: TRUST_LEVELS.has(trust) ? trust : 'community',
    launcherApiVersion,
    latestVersion: shortText(raw.latestVersion, 120),
    permissions: shortList(raw.permissions),
    tags: shortList(raw.tags),
    sha256
  };
}

function normalizeCatalog(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Catalog must be a JSON object');
  if (raw.format !== PLUGIN_CATALOG_FORMAT) throw new Error(`Catalog format must be ${PLUGIN_CATALOG_FORMAT}`);
  if (!Array.isArray(raw.plugins)) throw new Error('Catalog is missing a plugins array');
  const entries = [];
  const warnings = [];
  const seen = new Set();
  for (const item of raw.plugins.slice(0, MAX_CATALOG_ENTRIES)) {
    try {
      const entry = normalizeCatalogEntry(item);
      if (seen.has(entry.id)) throw new Error(`Catalog entry ${entry.id} is duplicated`);
      seen.add(entry.id);
      entries.push(entry);
    } catch (error) {
      warnings.push(error.message);
    }
  }
  return { entries, warnings };
}

/**
 * Fetch the plugin catalog, serving the cached copy when it is fresh enough.
 * A fetch failure never throws: it falls back to the last cached catalog
 * (marked stale) so installed plugins and the Admin UI keep working offline.
 */
async function getPluginCatalog(db, { refresh = false } = {}) {
  const cached = getSetting(db, CACHE_SETTING_KEY, null);
  const cacheUsable = cached && cached.url === PLUGIN_CATALOG_URL && Array.isArray(cached.entries);
  if (!refresh && cacheUsable && Date.now() - Number(cached.fetchedAt || 0) < CACHE_TTL_MS) {
    return { sourceUrl: PLUGIN_CATALOG_URL, fetchedAt: cached.fetchedAt, entries: cached.entries, warnings: cached.warnings || [], stale: false, fetched: false, error: null };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let raw;
    try {
      const response = await guardedFetch(PLUGIN_CATALOG_URL, {
        signal: controller.signal,
        headers: { 'User-Agent': 'home-lab-launcher', Accept: 'application/json' }
      }, { actorRole: 'admin', label: 'Plugin catalog URL' });
      if (!response.ok) throw new Error(`Catalog request failed: HTTP ${response.status}`);
      raw = await response.json();
    } finally {
      clearTimeout(timeout);
    }
    const { entries, warnings } = normalizeCatalog(raw);
    const fetchedAt = Date.now();
    setSetting(db, CACHE_SETTING_KEY, { url: PLUGIN_CATALOG_URL, fetchedAt, entries, warnings });
    return { sourceUrl: PLUGIN_CATALOG_URL, fetchedAt, entries, warnings, stale: false, fetched: true, error: null };
  } catch (error) {
    if (cacheUsable) {
      return { sourceUrl: PLUGIN_CATALOG_URL, fetchedAt: cached.fetchedAt, entries: cached.entries, warnings: cached.warnings || [], stale: true, fetched: false, error: error.message };
    }
    return { sourceUrl: PLUGIN_CATALOG_URL, fetchedAt: null, entries: [], warnings: [], stale: false, fetched: false, error: error.message };
  }
}

/**
 * Attach launcher-side state to catalog entries: API compatibility with this
 * launcher and whether the entry is already installed (matched by manifest id,
 * falling back to the canonical repo URL for renamed ids).
 */
function annotateCatalogEntries(entries, installedPlugins = []) {
  return entries.map((entry) => {
    const installed = installedPlugins.find((plugin) => plugin.id === entry.id)
      || installedPlugins.find((plugin) => plugin.sourceType === 'github' && String(plugin.sourceUrl || '').toLowerCase() === entry.repo.toLowerCase());
    const compatible = entry.launcherApiVersion <= LAUNCHER_PLUGIN_API_VERSION;
    return {
      ...entry,
      compatibility: {
        compatible,
        launcherApiVersion: LAUNCHER_PLUGIN_API_VERSION,
        ...(compatible ? {} : { error: `Plugin requires launcher API ${entry.launcherApiVersion}; this launcher supports ${LAUNCHER_PLUGIN_API_VERSION}` })
      },
      installed: installed ? {
        id: installed.id,
        version: installed.version,
        enabled: installed.enabled,
        lifecycle: installed.lifecycle,
        updateHint: Boolean(entry.latestVersion && compareVersions(entry.latestVersion, installed.version) > 0 && entry.latestVersion !== installed.version)
      } : null
    };
  });
}

module.exports = {
  PLUGIN_CATALOG_URL,
  PLUGIN_CATALOG_FORMAT,
  normalizeCatalog,
  normalizeCatalogEntry,
  getPluginCatalog,
  annotateCatalogEntries
};
