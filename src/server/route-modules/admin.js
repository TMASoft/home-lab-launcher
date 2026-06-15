const express = require('express');
const path = require('path');
const { getSetting, setSetting } = require('../db');

function registerAdminRoutes(router, deps) {
  const { db, dataDir, pluginDir, requireRole, logEvent, publicSettings, settingsPayload, getAppearance, DEFAULT_APPEARANCE, sanitizeAppearance, getThemePresets, saveAppAssetDataUrl, downloadAppAsset, slug, cleanText, THEME_PRESET_FORMAT, packageJson, fileSize, configWarnings, adminNotices, pluginManager, effectiveConfig, buildBackup, applyConfigBackup, previewConfigBackup, safeJsonParse, scheduler } = deps;
  router.patch('/settings', requireRole('admin'), express.json(), (req, res) => {
    try {
      const settings = settingsPayload(req.body || {});
      for (const [key, value] of Object.entries(settings)) setSetting(db, key, value);
      if (Object.prototype.hasOwnProperty.call(settings, 'app_name')) {
        const appName = settings.app_name;
        const appearance = getAppearance(db);
        setSetting(db, 'appearance', sanitizeAppearance({
          ...appearance,
          brand: {
            ...appearance.brand,
            appName,
            pageTitle: appName,
            brandText: appName
          }
        }));
      }
      logEvent(db, req, 'settings.updated', settings);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/admin/appearance', requireRole('admin'), (req, res) => {
    res.json({ appearance: getAppearance(db), presets: getThemePresets(db) });
  });

  router.put('/admin/appearance', requireRole('admin'), express.json({ limit: '1mb' }), (req, res) => {
    try {
      const appearance = sanitizeAppearance(req.body.appearance || req.body || {});
      setSetting(db, 'appearance', appearance);
      if (appearance.brand?.appName) setSetting(db, 'app_name', appearance.brand.appName);
      logEvent(db, req, 'appearance.updated', { appName: appearance.brand.appName });
      res.json({ appearance });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/admin/appearance/reset', requireRole('admin'), (req, res) => {
    const appName = getSetting(db, 'app_name', DEFAULT_APPEARANCE.brand.appName);
    const appearance = sanitizeAppearance({ ...DEFAULT_APPEARANCE, brand: { ...DEFAULT_APPEARANCE.brand, appName, pageTitle: appName, brandText: appName } });
    setSetting(db, 'appearance', appearance);
    logEvent(db, req, 'appearance.reset');
    res.json({ appearance });
  });

  router.post('/app-assets', requireRole('admin'), express.json({ limit: '7mb' }), async (req, res) => {
    try {
      let url = '';
      if (req.body.assetData) url = saveAppAssetDataUrl(dataDir, req.body.assetData);
      else if (req.body.url) url = await downloadAppAsset(dataDir, req.body.url, req.session.user.role);
      else throw new Error('assetData or url is required');
      logEvent(db, req, 'app_asset.created', { url });
      res.status(201).json({ url });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/admin/theme-presets', requireRole('admin'), (req, res) => {
    res.json({ presets: getThemePresets(db) });
  });

  router.post('/admin/theme-presets', requireRole('admin'), express.json({ limit: '1mb' }), (req, res) => {
    try {
      const presets = getThemePresets(db);
      const rootId = slug(req.body.id || req.body.name || 'theme');
      let id = rootId;
      let i = 2;
      while (presets.some((item) => item.id === id)) id = `${rootId}-${i++}`;
      const preset = {
        id,
        name: cleanText(req.body.name, 'Untitled theme', 80),
        description: cleanText(req.body.description, '', 240),
        appearance: sanitizeAppearance(req.body.appearance || getAppearance(db)),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      presets.push(preset);
      setSetting(db, 'theme_presets', presets);
      logEvent(db, req, 'theme_preset.created', { id: preset.id, name: preset.name });
      res.status(201).json({ preset });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.patch('/admin/theme-presets/:id', requireRole('admin'), express.json({ limit: '1mb' }), (req, res) => {
    try {
      const presets = getThemePresets(db);
      const index = presets.findIndex((preset) => preset.id === req.params.id);
      if (index < 0) return res.status(404).json({ error: 'Preset not found' });
      const next = { ...presets[index] };
      if (Object.prototype.hasOwnProperty.call(req.body, 'name')) next.name = cleanText(req.body.name, next.name, 80);
      if (Object.prototype.hasOwnProperty.call(req.body, 'description')) next.description = cleanText(req.body.description, next.description, 240);
      if (Object.prototype.hasOwnProperty.call(req.body, 'appearance')) next.appearance = sanitizeAppearance(req.body.appearance);
      next.updatedAt = new Date().toISOString();
      presets[index] = next;
      setSetting(db, 'theme_presets', presets);
      logEvent(db, req, 'theme_preset.updated', { id: next.id });
      res.json({ preset: next });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/admin/theme-presets/:id/apply', requireRole('admin'), (req, res) => {
    const preset = getThemePresets(db).find((item) => item.id === req.params.id);
    if (!preset) return res.status(404).json({ error: 'Preset not found' });
    setSetting(db, 'appearance', preset.appearance);
    if (preset.appearance.brand?.appName) setSetting(db, 'app_name', preset.appearance.brand.appName);
    logEvent(db, req, 'theme_preset.applied', { id: preset.id });
    res.json({ appearance: preset.appearance });
  });

  router.delete('/admin/theme-presets/:id', requireRole('admin'), (req, res) => {
    const before = getThemePresets(db);
    const presets = before.filter((preset) => preset.id !== req.params.id);
    if (presets.length === before.length) return res.status(404).json({ error: 'Preset not found' });
    setSetting(db, 'theme_presets', presets);
    logEvent(db, req, 'theme_preset.deleted', { id: req.params.id });
    res.json({ ok: true });
  });

  router.get('/admin/theme-presets/:id/export', requireRole('admin'), (req, res) => {
    const preset = getThemePresets(db).find((item) => item.id === req.params.id);
    if (!preset) return res.status(404).json({ error: 'Preset not found' });
    logEvent(db, req, 'theme_preset.exported', { id: preset.id });
    res.json({ format: THEME_PRESET_FORMAT, name: preset.name, description: preset.description, appearance: preset.appearance });
  });

  router.post('/admin/theme-presets/import', requireRole('admin'), express.json({ limit: '1mb' }), (req, res) => {
    try {
      if (req.body.format !== THEME_PRESET_FORMAT) throw new Error('Unsupported theme preset format');
      const preset = {
        id: slug(req.body.name || 'theme'),
        name: cleanText(req.body.name, 'Imported theme', 80),
        description: cleanText(req.body.description, '', 240),
        appearance: sanitizeAppearance(req.body.appearance || {}),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      const presets = getThemePresets(db);
      let id = slug(preset.name);
      let i = 2;
      while (presets.some((item) => item.id === id)) id = `${slug(preset.name)}-${i++}`;
      preset.id = id;
      presets.push(preset);
      setSetting(db, 'theme_presets', presets);
      logEvent(db, req, 'theme_preset.imported', { id: preset.id });
      res.status(201).json({ preset });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/admin/overview', requireRole('admin'), (req, res) => {
    res.json({
      settings: publicSettings(db),
      counts: {
        users: db.prepare('SELECT COUNT(*) AS count FROM users').get().count,
        services: db.prepare('SELECT COUNT(*) AS count FROM services').get().count,
        plugins: db.prepare('SELECT COUNT(*) AS count FROM plugins').get().count,
        logs: db.prepare('SELECT COUNT(*) AS count FROM app_logs').get().count
      },
      runtime: {
        appVersion: packageJson.version,
        node: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        env: process.env.NODE_ENV || 'development',
        databaseBytes: fileSize(path.join(dataDir, 'launcher.sqlite')),
        pluginDir
      },
      warnings: configWarnings(db, { dataDir, pluginDir }),
      notices: adminNotices(db, pluginManager, { dataDir, pluginDir }).slice(0, 8)
    });
  });


  router.get('/admin/health', requireRole('admin'), (req, res) => {
    res.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      app: { name: packageJson.name, version: packageJson.version },
      warnings: configWarnings(db, { dataDir, pluginDir }),
      storage: {
        dataDir,
        pluginDir,
        databaseBytes: fileSize(path.join(dataDir, 'launcher.sqlite')),
        walBytes: fileSize(path.join(dataDir, 'launcher.sqlite-wal'))
      },
      runtime: { node: process.version, uptimeSeconds: Math.round(process.uptime()), platform: process.platform, arch: process.arch },
      sessions: {
        active: db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?').get(Date.now()).count
      },
      plugins: pluginManager.health(),
      scheduledJobs: { core: scheduler ? scheduler.list() : [], plugins: pluginManager.health().jobs }
    });
  });

  router.get('/admin/config', requireRole('admin'), (req, res) => {
    res.json({ config: effectiveConfig(db, req, { dataDir, pluginDir }) });
  });

  router.get('/admin/notices', requireRole('admin'), (req, res) => {
    res.json({ notices: adminNotices(db, pluginManager, { dataDir, pluginDir }) });
  });

  router.get('/admin/backup', requireRole('admin'), (req, res) => {
    logEvent(db, req, 'backup.exported');
    res.setHeader('Content-Disposition', `attachment; filename="home-lab-launcher-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(buildBackup(db));
  });

  router.get('/admin/database/export', requireRole('admin'), (req, res) => {
    db.pragma('wal_checkpoint(TRUNCATE)');
    logEvent(db, req, 'database.exported');
    res.download(path.join(dataDir, 'launcher.sqlite'), `home-lab-launcher-db-${new Date().toISOString().slice(0, 10)}.sqlite`);
  });

  router.post('/admin/restore', requireRole('admin'), express.json({ limit: '5mb' }), async (req, res) => {
    try {
      if (req.query.preview === 'true') return res.json({ preview: previewConfigBackup(db, req.body) });
      const result = applyConfigBackup(db, req.body);
      await pluginManager.reload();
      logEvent(db, req, 'backup.restored', result, 'warn');
      res.json({ ok: true, restored: result });
    } catch (error) {
      logEvent(db, req, 'backup.restore_failed', { error: error.message }, 'error');
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/admin/restore/preview', requireRole('admin'), express.json({ limit: '5mb' }), (req, res) => {
    try {
      res.json({ preview: previewConfigBackup(db, req.body) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/admin/logs/export', requireRole('admin'), (req, res) => {
    const rows = db.prepare(`
      SELECT id, level, action, actor_user_id AS actorUserId, actor_username AS actorUsername, ip, details_json AS detailsJson, created_at AS createdAt
      FROM app_logs ORDER BY id DESC LIMIT 5000
    `).all().map((row) => ({ ...row, details: safeJsonParse(row.detailsJson, {}), detailsJson: undefined }));
    logEvent(db, req, 'logs.exported', { count: rows.length });
    res.json({ exportedAt: new Date().toISOString(), logs: rows });
  });

  router.patch('/admin/logs/retention', requireRole('admin'), express.json(), (req, res) => {
    const days = Math.min(3650, Math.max(1, Number(req.body.days || 90)));
    setSetting(db, 'log_retention_days', days);
    logEvent(db, req, 'logs.retention_updated', { days });
    res.json({ days });
  });

  router.post('/admin/logs/prune', requireRole('admin'), (req, res) => {
    const days = Math.min(3650, Math.max(1, Number(getSetting(db, 'log_retention_days', 90))));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = db.prepare('DELETE FROM app_logs WHERE created_at < ?').run(cutoff);
    logEvent(db, req, 'logs.pruned', { days, deleted: result.changes }, 'warn');
    res.json({ ok: true, deleted: result.changes, days });
  });

  router.get('/admin/logs', requireRole('admin'), (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    const clauses = [];
    const params = [];
    if (req.query.level) { clauses.push('level = ?'); params.push(String(req.query.level)); }
    if (req.query.action) { clauses.push('action LIKE ?'); params.push(`%${String(req.query.action)}%`); }
    if (req.query.actor) { clauses.push('actor_username LIKE ?'); params.push(`%${String(req.query.actor)}%`); }
    if (req.query.q) { clauses.push('(action LIKE ? OR actor_username LIKE ? OR details_json LIKE ?)'); params.push(`%${String(req.query.q)}%`, `%${String(req.query.q)}%`, `%${String(req.query.q)}%`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT id, level, action, actor_user_id AS actorUserId, actor_username AS actorUsername, ip, details_json AS detailsJson, created_at AS createdAt
      FROM app_logs ${where} ORDER BY id DESC LIMIT ?
    `).all(...params, limit).map((row) => ({ ...row, details: safeJsonParse(row.detailsJson, {}), detailsJson: undefined }));
    res.json({ logs: rows });
  });


}

module.exports = { registerAdminRoutes };
