const express = require('express');
const path = require('path');

function registerServiceRoutes(router, deps) {
  const { db, dataDir, requireRole, canRead, logEvent, allServices, serviceFromRow, serviceSelectSql, serviceIconDir, appAssetDir, slug, uniqueServiceId, normalizeServiceIcon, validateUrl, guardedFetch, healthStatusFrom, checkServiceHealth, logServiceHealthFailure, servicePayload } = deps;
  router.get('/service-icons/:filename', (req, res) => {
    if (!canRead(req, db)) return res.status(401).end();
    const filename = path.basename(req.params.filename || '');
    if (!/^[a-f0-9]{64}\.(jpg|png|gif|webp|svg)$/.test(filename)) return res.status(404).end();
    res.sendFile(path.join(serviceIconDir(dataDir), filename));
  });

  router.get('/app-assets/:filename', (req, res) => {
    const filename = path.basename(req.params.filename || '');
    if (!/^[a-f0-9]{64}\.(jpg|png|gif|webp)$/.test(filename)) return res.status(404).end();
    res.sendFile(path.join(appAssetDir(dataDir), filename));
  });

  router.get('/services', (req, res) => {
    if (!canRead(req, db)) return res.status(401).json({ error: 'Authentication required' });
    const rows = db.prepare(serviceSelectSql('ORDER BY s.sort_order ASC, s.name ASC')).all();
    const services = rows.map(serviceFromRow).filter(s => s.enabled || ['admin', 'editor'].includes(req.session.user?.role));
    res.json({ services });
  });

  router.post('/services', requireRole('admin', 'editor'), express.json({ limit: '7mb' }), async (req, res) => {
    try {
      const body = req.body || {};
      const normalized = servicePayload(body);
      const id = body.id && !db.prepare('SELECT 1 FROM services WHERE id = ?').get(slug(body.id)) ? slug(body.id) : uniqueServiceId(db, body.id || normalized.name);
      const icon = await normalizeServiceIcon(db, req, dataDir, { ...body, icon: normalized.icon, actorRole: req.session.user.role });
      db.prepare(`
        INSERT INTO services (id, name, icon, url, category, accent, description, tags_json, sort_order, featured, enabled, health_check_enabled, health_check_url, health_check_interval_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, normalized.name, icon, normalized.url, normalized.category, normalized.accent, normalized.description, JSON.stringify(normalized.tags), normalized.sortOrder, normalized.featured ? 1 : 0, normalized.enabled ? 1 : 0, normalized.healthCheckEnabled ? 1 : 0, normalized.healthCheckUrl, normalized.healthCheckIntervalMinutes);
      logEvent(db, req, 'service.created', { id, name: normalized.name, iconImage: icon.startsWith('/api/service-icons/') });
      res.status(201).json({ service: serviceFromRow(db.prepare(serviceSelectSql('WHERE s.id = ?')).get(id)) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });


  router.patch('/services/reorder', requireRole('admin', 'editor'), express.json(), (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
    const stmt = db.prepare('UPDATE services SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const tx = db.transaction(() => ids.forEach((id, index) => stmt.run(index * 10, id)));
    tx();
    logEvent(db, req, 'services.reordered', { count: ids.length });
    res.json({ ok: true });
  });


  router.post('/services/:id/duplicate', requireRole('admin', 'editor'), express.json(), (req, res) => {
    const existing = db.prepare(serviceSelectSql('WHERE s.id = ?')).get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Service not found' });
    const source = serviceFromRow(existing);
    const name = String(req.body.name || `${source.name} Copy`);
    const id = uniqueServiceId(db, name);
    db.prepare(`
      INSERT INTO services (id, name, icon, url, category, accent, description, tags_json, sort_order, featured, enabled, health_check_enabled, health_check_url, health_check_interval_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, source.icon, source.url, source.category, source.accent, source.description, JSON.stringify(source.tags || []), Number(req.body.sortOrder ?? source.sortOrder + 1), source.featured ? 1 : 0, source.enabled ? 1 : 0, source.healthCheckEnabled ? 1 : 0, source.healthCheckUrl || '', source.healthCheckIntervalMinutes || 15);
    logEvent(db, req, 'service.duplicated', { sourceId: req.params.id, id, name });
    res.status(201).json({ service: serviceFromRow(db.prepare(serviceSelectSql('WHERE s.id = ?')).get(id)) });
  });

  router.patch('/services/bulk', requireRole('admin', 'editor'), express.json(), (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String).filter(Boolean) : [];
    const action = String(req.body.action || '');
    if (!ids.length) return res.status(400).json({ error: 'No service IDs supplied' });
    const placeholders = ids.map(() => '?').join(',');
    let result;
    if (action === 'enable') result = db.prepare(`UPDATE services SET enabled = 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...ids);
    else if (action === 'disable') result = db.prepare(`UPDATE services SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...ids);
    else if (action === 'feature') result = db.prepare(`UPDATE services SET featured = 1, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...ids);
    else if (action === 'unfeature') result = db.prepare(`UPDATE services SET featured = 0, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...ids);
    else if (action === 'delete') result = db.prepare(`DELETE FROM services WHERE id IN (${placeholders})`).run(...ids);
    else return res.status(400).json({ error: 'Unsupported bulk action' });
    logEvent(db, req, 'services.bulk_action', { action, count: ids.length });
    res.json({ ok: true, changed: result.changes, action });
  });

  router.patch('/services/:id', requireRole('admin', 'editor'), express.json({ limit: '7mb' }), async (req, res) => {
    try {
      const existing = db.prepare(serviceSelectSql('WHERE s.id = ?')).get(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Service not found' });
      const current = serviceFromRow(existing);
      const next = servicePayload(req.body || {}, current);
      const icon = await normalizeServiceIcon(db, req, dataDir, { ...req.body, actorRole: req.session.user.role, icon: Object.prototype.hasOwnProperty.call(req.body, 'icon') ? req.body.icon : current.icon }, current.icon);
      db.prepare(`
        UPDATE services SET name=?, icon=?, url=?, category=?, accent=?, description=?, tags_json=?, sort_order=?, featured=?, enabled=?, health_check_enabled=?, health_check_url=?, health_check_interval_minutes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).run(next.name, icon, next.url, next.category, next.accent, next.description, JSON.stringify(next.tags), next.sortOrder, next.featured ? 1 : 0, next.enabled ? 1 : 0, next.healthCheckEnabled ? 1 : 0, next.healthCheckUrl, next.healthCheckIntervalMinutes, req.params.id);
      logEvent(db, req, 'service.updated', { id: req.params.id, iconImage: icon.startsWith('/api/service-icons/') });
      res.json({ service: serviceFromRow(db.prepare(serviceSelectSql('WHERE s.id = ?')).get(req.params.id)) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/services/test-url', requireRole('admin', 'editor'), express.json(), async (req, res) => {
    const target = String(req.body.url || '').trim();
    if (!validateUrl(target)) return res.status(400).json({ error: 'URL must be http or https' });
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      let response = await guardedFetch(target, { method: 'HEAD', signal: controller.signal }, { actorRole: req.session.user.role, label: 'URL' });
      if (response.status === 405 || response.status === 403) response = await guardedFetch(target, { method: 'GET', signal: controller.signal }, { actorRole: req.session.user.role, label: 'URL' });
      res.json({ ok: response.status >= 200 && response.status < 400, status: healthStatusFrom(response.status), statusCode: response.status, responseMs: Date.now() - started, url: target });
    } catch (error) {
      res.json({ ok: false, status: 'down', error: error.name === 'AbortError' ? 'Request timed out' : error.message, responseMs: Date.now() - started, url: target });
    } finally {
      clearTimeout(timeout);
    }
  });

  router.post('/services/:id/check', requireRole('admin', 'editor'), async (req, res) => {
    const row = db.prepare(serviceSelectSql('WHERE s.id = ?')).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Service not found' });
    try {
      const health = await checkServiceHealth(db, serviceFromRow(row));
      logEvent(db, req, 'service.health_checked', { id: req.params.id, status: health.status, statusCode: health.statusCode });
      logServiceHealthFailure(db, req, serviceFromRow(row), health, 'manual');
      res.json({ health });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/service-health', (req, res) => {
    if (!canRead(req, db)) return res.status(401).json({ error: 'Authentication required' });
    const rows = db.prepare('SELECT service_id AS serviceId, status, status_code AS statusCode, response_ms AS responseMs, checked_at AS checkedAt, next_check_at AS nextCheckAt, error FROM service_health ORDER BY service_id').all();
    res.json({ health: rows });
  });

  router.delete('/services/:id', requireRole('admin', 'editor'), (req, res) => {
    db.prepare('DELETE FROM services WHERE id = ?').run(req.params.id);
    logEvent(db, req, 'service.deleted', { id: req.params.id });
    res.json({ ok: true });
  });


  router.get('/services/export', requireRole('admin', 'editor'), (req, res) => {
    logEvent(db, req, 'services.exported');
    res.json({ exportedAt: new Date().toISOString(), services: allServices(db) });
  });

  router.post('/services/import', requireRole('admin', 'editor'), express.json({ limit: '1mb' }), (req, res) => {
    const services = Array.isArray(req.body.services) ? req.body.services : [];
    const mode = req.body.mode === 'replace' ? 'replace' : 'upsert';
    if (!services.length) return res.status(400).json({ error: 'No services supplied' });
    const existingIds = new Set(db.prepare('SELECT id FROM services').all().map((row) => row.id));
    const incomingIds = services.map((service) => slug(service.id || service.name));
    const duplicateIncomingIds = incomingIds.filter((id, index) => incomingIds.indexOf(id) !== index);
    if (duplicateIncomingIds.length) return res.status(400).json({ error: `Duplicate service IDs in import: ${[...new Set(duplicateIncomingIds)].join(', ')}` });
    const conflicts = mode === 'replace' ? [] : incomingIds.filter((id) => existingIds.has(id));
    const upsert = db.prepare(`
      INSERT INTO services (id, name, icon, url, category, accent, description, tags_json, sort_order, featured, enabled, health_check_enabled, health_check_url, health_check_interval_minutes)
      VALUES (@id, @name, @icon, @url, @category, @accent, @description, @tags_json, @sort_order, @featured, @enabled, @health_check_enabled, @health_check_url, @health_check_interval_minutes)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, icon=excluded.icon, url=excluded.url, category=excluded.category, accent=excluded.accent, description=excluded.description, tags_json=excluded.tags_json, sort_order=excluded.sort_order, featured=excluded.featured, enabled=excluded.enabled, health_check_enabled=excluded.health_check_enabled, health_check_url=excluded.health_check_url, health_check_interval_minutes=excluded.health_check_interval_minutes, updated_at=CURRENT_TIMESTAMP
    `);
    const tx = db.transaction(() => {
      if (mode === 'replace') db.prepare('DELETE FROM services').run();
      services.forEach((service, index) => {
        const normalized = servicePayload({ sortOrder: index * 10, ...service });
        upsert.run({
          id: slug(service.id || normalized.name),
          name: normalized.name,
          icon: normalized.icon,
          url: normalized.url,
          category: normalized.category,
          accent: normalized.accent,
          description: normalized.description,
          tags_json: JSON.stringify(normalized.tags),
          sort_order: normalized.sortOrder,
          featured: normalized.featured ? 1 : 0,
          enabled: normalized.enabled ? 1 : 0,
          health_check_enabled: normalized.healthCheckEnabled ? 1 : 0,
          health_check_url: normalized.healthCheckUrl,
          health_check_interval_minutes: normalized.healthCheckIntervalMinutes
        });
      });
    });
    try { tx(); } catch (error) { return res.status(400).json({ error: error.message }); }
    const summary = { total: services.length, created: mode === 'replace' ? services.length : services.length - conflicts.length, updated: conflicts.length, conflicts };
    logEvent(db, req, 'services.imported', { count: services.length, mode, summary });
    res.json({ ok: true, count: services.length, mode, summary });
  });

}

module.exports = { registerServiceRoutes };
