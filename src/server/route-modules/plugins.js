const express = require('express');
const { applyPluginConfigUpdate, redactPluginConfigForRole } = require('../plugins');

function registerPluginRoutes(router, deps) {
  const { db, requireAuth, requireRole, canRead, logEvent, pluginManager, safeJsonParse, pluginInstallPayload } = deps;
  function requirePluginTrustConfirmation(req, res) {
    if (req.body?.trustConfirmed === true) return false;
    res.status(400).json({ error: 'Plugin install/update requires explicit trust confirmation. Plugins are trusted code and can run server-side.' });
    return true;
  }

  router.get('/plugins', requireAuth, async (req, res) => {
    let updates = [];
    const role = req.session.user?.role;
    if (role === 'admin' && req.query.updates === '1') updates = await pluginManager.checkUpdates();
    const plugins = pluginManager.list().map((plugin) => ({
      ...plugin,
      config: redactPluginConfigForRole(plugin.manifest, plugin.config, role),
      update: updates.find((item) => item.id === plugin.id) || null
    }));
    res.json({ plugins });
  });

  router.get('/plugins/enabled-sections', (req, res) => {
    if (!canRead(req, db)) return res.status(401).json({ error: 'Authentication required' });
    res.json({ sections: pluginManager.sections() });
  });

  router.get('/plugins/:id/logs', requireRole('admin'), (req, res) => {
    const actionPrefix = `plugin.${req.params.id}.`;
    const logs = db.prepare(`
      SELECT id, level, action, actor_user_id AS actorUserId, actor_username AS actorUsername, ip, details_json AS detailsJson, created_at AS createdAt
      FROM app_logs WHERE action LIKE ? ORDER BY id DESC LIMIT 200
    `).all(`${actionPrefix}%`).map((row) => ({ ...row, details: safeJsonParse(row.detailsJson, {}), detailsJson: undefined }));
    res.json({ logs });
  });

  router.post('/plugins/reload', requireRole('admin'), async (req, res) => {
    await pluginManager.reload();
    logEvent(db, req, 'plugins.reloaded');
    res.json({ ok: true, health: pluginManager.health() });
  });

  router.get('/plugin-sources/github/versions', requireRole('admin'), async (req, res) => {
    try {
      const versions = await pluginManager.discoverGithubVersions(String(req.query.repo || ''));
      res.json({ versions });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/plugin-sources/updates', requireRole('admin'), async (req, res) => {
    res.json({ updates: await pluginManager.checkUpdates() });
  });

  router.get('/plugin-sources/local/status', requireRole('admin'), (req, res) => {
    res.json({
      enabled: process.env.NODE_ENV !== 'production' || process.env.ENABLE_LOCAL_PLUGIN_INSTALL === 'true',
      nodeEnv: process.env.NODE_ENV || 'development',
      hostDir: process.env.LOCAL_PLUGIN_HOST_DIR || './local-plugins',
      containerDir: process.env.LOCAL_PLUGIN_CONTAINER_DIR || '/app/local-plugins'
    });
  });

  router.post('/plugins/install', requireRole('admin'), express.json(), async (req, res) => {
    if (requirePluginTrustConfirmation(req, res)) return;
    try {
      const payload = pluginInstallPayload(req.body || {});
      const plugin = await pluginManager.installFromGithub(payload.repoUrl, payload.version, { expectedSha256: payload.expectedSha256 });
      await pluginManager.reload();
      const failed = pluginManager.health().failures.find((item) => item.pluginId === plugin.id);
      if (failed) return res.status(400).json({ error: `Plugin installed but failed to load: ${failed.message}`, plugin });
      const cleaned = pluginManager.cleanupSupersededInstalls();
      logEvent(db, req, 'plugin.installed', { ...plugin, cleaned });
      res.status(201).json({ plugin });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/plugins/install-local', requireRole('admin'), express.json(), async (req, res) => {
    if (requirePluginTrustConfirmation(req, res)) return;
    try {
      const payload = pluginInstallPayload(req.body || {});
      const plugin = await pluginManager.installFromLocal(payload.path);
      await pluginManager.reload();
      const failed = pluginManager.health().failures.find((item) => item.pluginId === plugin.id);
      if (failed) return res.status(400).json({ error: `Plugin installed but failed to load: ${failed.message}`, plugin });
      logEvent(db, req, 'plugin.local_installed', plugin);
      res.status(201).json({ plugin });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/plugins/:id/update', requireRole('admin'), express.json(), async (req, res) => {
    if (requirePluginTrustConfirmation(req, res)) return;
    const previous = db.prepare('SELECT * FROM plugins WHERE id = ?').get(req.params.id);
    if (!previous) return res.status(404).json({ error: 'Plugin not found' });
    if (previous.source_type !== 'github') return res.status(400).json({ error: 'Only GitHub plugins can be updated through this flow' });
    try {
      const payload = pluginInstallPayload(req.body || {});
      const plugin = await pluginManager.installFromGithub(previous.source_url, payload.version || previous.version, { expectedSha256: payload.expectedSha256 });
      await pluginManager.reload();
      const failed = pluginManager.health().failures.find((item) => item.pluginId === plugin.id);
      if (failed) {
        db.prepare(`UPDATE plugins SET name=?, source_url=?, source_type=?, version=?, install_path=?, enabled=?, manifest_json=?, config_json=?, installed_hash=?, lifecycle=?, last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(previous.name, previous.source_url, previous.source_type, previous.version, previous.install_path, previous.enabled, previous.manifest_json, previous.config_json, previous.installed_hash, 'enabled', null, previous.id);
        await pluginManager.reload();
        logEvent(db, req, 'plugin.update_rolled_back', { id: req.params.id, attemptedVersion: (req.body || {}).version, error: failed.message }, 'error');
        return res.status(400).json({ error: `Update failed and was rolled back: ${failed.message}` });
      }
      const cleaned = pluginManager.cleanupSupersededInstalls();
      logEvent(db, req, 'plugin.updated', { id: req.params.id, from: previous.version, to: plugin.version, cleaned });
      res.json({ plugin, rolledBack: false });
    } catch (error) {
      db.prepare(`UPDATE plugins SET name=?, source_url=?, source_type=?, version=?, install_path=?, enabled=?, manifest_json=?, config_json=?, installed_hash=?, lifecycle=?, last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(previous.name, previous.source_url, previous.source_type, previous.version, previous.install_path, previous.enabled, previous.manifest_json, previous.config_json, previous.installed_hash, 'enabled', null, previous.id);
      await pluginManager.reload();
      logEvent(db, req, 'plugin.update_failed', { id: req.params.id, attemptedVersion: (req.body || {}).version, error: error.message }, 'error');
      res.status(400).json({ error: `Update failed and was rolled back: ${error.message}` });
    }
  });

  router.patch('/plugins/:id', requireRole('admin'), express.json(), async (req, res) => {
    const row = db.prepare('SELECT * FROM plugins WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Plugin not found' });
    if (Object.prototype.hasOwnProperty.call(req.body, 'enabled')) {
      db.prepare('UPDATE plugins SET enabled = ?, lifecycle = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.body.enabled ? 1 : 0, req.body.enabled ? 'enabled' : 'disabled', req.params.id);
      await pluginManager.reload();
      logEvent(db, req, 'plugin.toggled', { id: req.params.id, enabled: Boolean(req.body.enabled) });
    }
    res.json({ ok: true });
  });

  router.put('/plugins/:id/config', requireRole('admin', 'editor'), express.json(), (req, res) => {
    const row = db.prepare('SELECT * FROM plugins WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Plugin not found' });
    try {
      const manifest = safeJsonParse(row.manifest_json, {});
      const existing = safeJsonParse(row.config_json, {});
      const result = applyPluginConfigUpdate(manifest, existing, req.body.config || {}, req.session.user.role);
      if (result.allowed.length === 0 && result.rejected.length > 0) return res.status(403).json({ error: 'No submitted plugin config fields are writable by this role', rejected: result.rejected });
      db.prepare('UPDATE plugins SET config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(result.config), req.params.id);
      logEvent(db, req, 'plugin.config_updated', { id: req.params.id, fields: result.allowed, rejectedFields: result.rejected });
      res.json({ ok: true, updatedFields: result.allowed, rejectedFields: result.rejected });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.delete('/plugins/:id', requireRole('admin'), async (req, res) => {
    db.prepare('DELETE FROM plugins WHERE id = ?').run(req.params.id);
    await pluginManager.reload();
    logEvent(db, req, 'plugin.deleted', { id: req.params.id });
    res.json({ ok: true });
  });

}

module.exports = { registerPluginRoutes };
