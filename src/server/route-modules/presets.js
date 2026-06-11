const express = require('express');
const { getSetting, setSetting } = require('../db');
const { syncHeimdallPresets, canUpdateCatalog, catalogCooldownRemaining, searchPresets, getPreset, HEIMDALL_RAW_RE } = require('../preset-catalog');

function registerPresetRoutes(router, deps) {
  const { db, dataDir, requireRole, logEvent, downloadServiceIcon, saveServiceIconBuffer, detectImageMime, IMAGE_MIME_EXTENSIONS, uniqueServiceId, slug, guardedFetch, scheduler } = deps;

  // Search presets
  router.get('/admin/presets/search', requireRole('admin', 'editor'), (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) return res.json({ presets: [] });
    const remoteEnabled = getSetting(db, 'enable_remote_presets', false);
    const rows = searchPresets(db, query, { source: remoteEnabled ? undefined : 'local' });
    const presets = rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description || '',
      website: row.website || '',
      category: row.category || 'general',
      accent: row.accent || '#4de7ff',
      iconUrl: row.icon_url || '',
      source: row.source
    }));
    res.json({ presets });
  });

  // Import a preset as a new service
  router.post('/admin/presets/import', requireRole('admin', 'editor'), express.json(), async (req, res) => {
    try {
      const { presetId, customUrl } = req.body;
      if (!presetId) return res.status(400).json({ error: 'presetId is required' });

      const preset = getPreset(db, presetId);
      if (!preset) return res.status(404).json({ error: 'Preset not found' });

      // Download and cache the icon locally
      let icon = '🔗';
      if (preset.icon_url) {
        try {
          icon = await downloadPresetIcon(preset.icon_url, dataDir, deps);
        } catch (iconErr) {
          console.warn(`[preset-import] Could not download icon for ${preset.name}:`, iconErr.message);
          logEvent(db, req, 'preset.icon_download_failed', { presetId, iconUrl: preset.icon_url, error: iconErr.message }, 'warn');
        }
      }

      const serviceId = uniqueServiceId(db, slug(preset.name));
      const url = customUrl || preset.website || 'http://localhost';

      db.prepare(`
        INSERT INTO services (id, name, icon, url, category, accent, description, tags_json, sort_order, featured, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 0, 0, 1)
      `).run(serviceId, preset.name, icon, url, preset.category || 'general', preset.accent || '#4de7ff', preset.description || '');

      logEvent(db, req, 'preset.imported', { presetId: preset.id, serviceId, source: preset.source });
      res.json({ ok: true, serviceId });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Trigger manual catalog update
  router.post('/admin/presets/update', requireRole('admin'), express.json(), async (req, res) => {
    if (!canUpdateCatalog(db)) {
      const remaining = catalogCooldownRemaining(db);
      return res.status(429).json({ error: `Please wait at least 60 seconds between manual catalog updates (${remaining}s remaining)` });
    }

    logEvent(db, req, 'preset_catalog.sync_started');
    // Set the crawl time immediately to prevent concurrent crawls and rate limit bypass
    setSetting(db, 'last_preset_crawled_at', Date.now());

    // Run sync asynchronously so we can respond immediately
    syncHeimdallPresets(db).then((result) => {
      console.log('[preset-catalog] Manual sync result:', result);
    }).catch((error) => {
      console.error('[preset-catalog] Manual sync failed:', error);
    });
    res.json({ ok: true, message: 'Sync started' });
  });

  // Get preset catalog settings
  router.get('/admin/presets/settings', requireRole('admin'), (req, res) => {
    const enableRemotePresets = getSetting(db, 'enable_remote_presets', false);
    const lastCrawledAt = getSetting(db, 'last_preset_crawled_at', null);
    const cooldownRemaining = catalogCooldownRemaining(db);
    const presetCount = db.prepare('SELECT COUNT(*) AS count FROM preset_cache').get().count;
    const localCount = db.prepare("SELECT COUNT(*) AS count FROM preset_cache WHERE source = 'local'").get().count;
    const heimdallCount = db.prepare("SELECT COUNT(*) AS count FROM preset_cache WHERE source = 'heimdall'").get().count;
    const syncStatus = getSetting(db, 'preset_catalog_sync_status', {
      status: 'idle',
      startedAt: null,
      completedAt: null,
      synced: 0,
      error: null
    });
    res.json({
      enableRemotePresets,
      lastCrawledAt,
      cooldownRemaining,
      syncStatus,
      counts: { total: presetCount, local: localCount, heimdall: heimdallCount }
    });
  });

  // Update preset catalog settings
  router.put('/admin/presets/settings', requireRole('admin'), express.json(), (req, res) => {
    if (Object.prototype.hasOwnProperty.call(req.body, 'enableRemotePresets')) {
      const enabled = Boolean(req.body.enableRemotePresets);
      setSetting(db, 'enable_remote_presets', enabled);
      logEvent(db, req, 'preset_settings.updated', { enableRemotePresets: enabled });
      if (enabled) {
        const { startPresetCatalogScheduler } = require('../preset-catalog');
        startPresetCatalogScheduler(db, scheduler);
      } else {
        if (scheduler) {
          scheduler.stop('preset-catalog-sync');
        }
      }
    }
    res.json({ ok: true });
  });
}

/**
 * Download a preset icon, enforcing that Heimdall icons come only from the known
 * raw.githubusercontent.com path. Returns a local /api/service-icons/... path.
 */
async function downloadPresetIcon(iconUrl, dataDir, deps) {
  const { guardedFetch, saveServiceIconBuffer, detectImageMime, IMAGE_MIME_EXTENSIONS } = deps;
  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');

  // Validate URL pattern for Heimdall sources
  if (!HEIMDALL_RAW_RE.test(iconUrl)) throw new Error('Preset icon URL must match the official repository raw path');

  const parsed = new URL(iconUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Icon URL must use http or https');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await guardedFetch(iconUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'home-lab-launcher' }
    }, { actorRole: 'admin', label: 'Preset icon' });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > 5 * 1024 * 1024) throw new Error('Icon too large');

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 5 * 1024 * 1024) throw new Error('Icon too large');

    return saveServiceIconBuffer(dataDir, buffer, response.headers.get('content-type') || '');
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { registerPresetRoutes };
