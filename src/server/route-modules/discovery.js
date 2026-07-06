const express = require('express');
const { getSetting } = require('../db');
const { composeCandidates, MAX_COMPOSE_BYTES } = require('../discovery/compose');
const { parseDockerEndpoint, fetchContainers, dockerCandidates } = require('../discovery/docker');
const { annotateConflicts } = require('../discovery/candidates');

const MAX_APPLY_ITEMS = 50;

function hostnameOnly(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 253);
}

function baseUrlHost(db) {
  try { return new URL(String(getSetting(db, 'app_base_url', '') || '')).hostname; } catch { return ''; }
}

function registerDiscoveryRoutes(router, deps) {
  const { db, dataDir, requireRole, logEvent, servicePayload, normalizeServiceIcon, uniqueServiceId, slug, serviceFromRow, serviceSelectSql } = deps;

  router.get('/discovery/status', requireRole('admin'), (req, res) => {
    const endpoint = String(getSetting(db, 'discovery_docker_endpoint', '') || '');
    const parsed = parseDockerEndpoint(endpoint);
    res.json({
      dockerEndpoint: endpoint,
      dockerConfigured: Boolean(parsed),
      dockerEndpointKind: parsed ? parsed.kind : null,
      limits: { maxComposeBytes: MAX_COMPOSE_BYTES, maxApplyItems: MAX_APPLY_ITEMS }
    });
  });

  router.post('/discovery/docker/scan', requireRole('admin'), express.json({ limit: '16kb' }), async (req, res) => {
    const endpoint = String(getSetting(db, 'discovery_docker_endpoint', '') || '');
    const parsed = parseDockerEndpoint(endpoint);
    if (!parsed) return res.status(400).json({ error: 'Docker discovery endpoint is not configured. Set it under Admin → Discovery (an http(s) socket proxy is recommended).' });
    try {
      const containers = await fetchContainers(endpoint, { actorRole: req.session.user.role });
      let defaultHost = hostnameOnly(req.body?.defaultHost);
      if (!defaultHost && parsed.kind === 'http') {
        try { defaultHost = new URL(parsed.base).hostname; } catch {}
      }
      if (!defaultHost) defaultHost = baseUrlHost(db) || 'localhost';
      const result = dockerCandidates(containers, { defaultHost });
      annotateConflicts(db, result.candidates);
      logEvent(db, req, 'discovery.scanned', { source: 'docker', containers: result.containers, candidates: result.candidates.length, ignored: result.ignored });
      res.json({ source: 'docker', scannedAt: new Date().toISOString(), candidates: result.candidates, counts: { containers: result.containers, candidates: result.candidates.length, ignored: result.ignored, truncated: result.truncated } });
    } catch (error) {
      logEvent(db, req, 'discovery.scan_failed', { source: 'docker', error: error.message }, 'warn');
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/discovery/compose/preview', requireRole('admin'), express.json({ limit: '600kb' }), (req, res) => {
    try {
      const defaultHost = hostnameOnly(req.body?.defaultHost) || baseUrlHost(db) || 'localhost';
      const result = composeCandidates(String(req.body?.yaml || ''), { defaultHost });
      annotateConflicts(db, result.candidates);
      logEvent(db, req, 'discovery.scanned', { source: 'compose', candidates: result.candidates.length, ignored: result.ignored });
      res.json({ source: 'compose', scannedAt: new Date().toISOString(), candidates: result.candidates, counts: { candidates: result.candidates.length, ignored: result.ignored, truncated: result.truncated } });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/discovery/apply', requireRole('admin'), express.json({ limit: '1mb' }), async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: 'No discovery items supplied' });
    if (items.length > MAX_APPLY_ITEMS) return res.status(400).json({ error: `Import at most ${MAX_APPLY_ITEMS} services per apply` });
    const results = [];
    for (const item of items) {
      const action = item?.action === 'update' ? 'update' : item?.action === 'create' ? 'create' : 'skip';
      const source = ['docker', 'compose'].includes(item?.source) ? item.source : 'unknown';
      const key = String(item?.key || '').slice(0, 160);
      if (action === 'skip') { results.push({ key, action: 'skip', ok: true }); continue; }
      try {
        /* servicePayload allowlists the service fields, so extra properties an
           adapter or client attaches (label dumps, env values) are dropped here. */
        const body = item?.service && typeof item.service === 'object' ? item.service : {};
        if (action === 'update') {
          const targetId = String(item?.targetId || '');
          const existingRow = db.prepare(serviceSelectSql('WHERE s.id = ?')).get(targetId);
          if (!existingRow) throw new Error(`Service ${targetId || '(missing id)'} not found`);
          const current = serviceFromRow(existingRow);
          const next = servicePayload(body, current);
          const icon = await normalizeServiceIcon(db, req, dataDir, { actorRole: req.session.user.role, icon: Object.prototype.hasOwnProperty.call(body, 'icon') ? body.icon : current.icon }, current.icon);
          db.prepare(`
            UPDATE services SET name=?, icon=?, url=?, category=?, accent=?, description=?, tags_json=?, sort_order=?, featured=?, enabled=?, health_check_enabled=?, health_check_url=?, health_check_interval_minutes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
          `).run(next.name, icon, next.url, next.category, next.accent, next.description, JSON.stringify(next.tags), next.sortOrder, next.featured ? 1 : 0, next.enabled ? 1 : 0, next.healthCheckEnabled ? 1 : 0, next.healthCheckUrl, next.healthCheckIntervalMinutes, targetId);
          results.push({ key, action, ok: true, id: targetId, source });
        } else {
          const normalized = servicePayload(body);
          const id = uniqueServiceId(db, body.id || normalized.name);
          const icon = await normalizeServiceIcon(db, req, dataDir, { actorRole: req.session.user.role, icon: normalized.icon });
          db.prepare(`
            INSERT INTO services (id, name, icon, url, category, accent, description, tags_json, sort_order, featured, enabled, health_check_enabled, health_check_url, health_check_interval_minutes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(id, normalized.name, icon, normalized.url, normalized.category, normalized.accent, normalized.description, JSON.stringify(normalized.tags), normalized.sortOrder, normalized.featured ? 1 : 0, normalized.enabled ? 1 : 0, normalized.healthCheckEnabled ? 1 : 0, normalized.healthCheckUrl, normalized.healthCheckIntervalMinutes);
          results.push({ key, action, ok: true, id, source });
        }
      } catch (error) {
        results.push({ key, action, ok: false, error: error.message, source });
      }
    }
    const summary = {
      created: results.filter((r) => r.action === 'create' && r.ok).length,
      updated: results.filter((r) => r.action === 'update' && r.ok).length,
      skipped: results.filter((r) => r.action === 'skip').length,
      failed: results.filter((r) => !r.ok).length
    };
    logEvent(db, req, 'discovery.applied', { summary, services: results.filter((r) => r.ok && r.id).map((r) => ({ id: r.id, action: r.action, source: r.source, key: r.key })) });
    res.json({ ok: summary.failed === 0, summary, results });
  });
}

module.exports = { registerDiscoveryRoutes };
