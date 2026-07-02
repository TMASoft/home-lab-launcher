const express = require('express');
const bcrypt = require('bcryptjs');

function registerUserRoutes(router, deps) {
  const { db, requireAuth, requireRole, logEvent, userPayload, preferencePayload, normalizeLaunchpad } = deps;
  const adminCountExcluding = (userId) => db.prepare('SELECT COUNT(*) AS count FROM users WHERE role = ? AND id != ?').get('admin', userId).count;

  router.get('/users', requireRole('admin'), (req, res) => {
    const users = db.prepare('SELECT id, username, role, totp_enabled AS totpEnabled, created_at AS createdAt FROM users ORDER BY username').all();
    res.json({ users });
  });

  router.post('/users', requireRole('admin'), express.json(), async (req, res) => {
    try {
      const { username, password, role } = userPayload(req.body || {}, {}, { requirePassword: true });
      const hash = await bcrypt.hash(password, 12);
      const info = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role);
      logEvent(db, req, 'user.created', { id: info.lastInsertRowid, username, role });
      res.status(201).json({ user: { id: info.lastInsertRowid, username, role } });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.patch('/users/:id', requireRole('admin'), express.json(), async (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    try {
      const { username, password, role } = userPayload(req.body || {}, user);
      const resetTotp = Boolean(req.body.resetTotp);
      if (user.role === 'admin' && role !== 'admin' && adminCountExcluding(req.params.id) < 1) {
        return res.status(400).json({ error: 'At least one admin account is required' });
      }
      if (password) {
        db.prepare('UPDATE users SET username = ?, role = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(username, role, await bcrypt.hash(password, 12), req.params.id);
      } else {
        db.prepare('UPDATE users SET username = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(username, role, req.params.id);
      }
      if (resetTotp) {
        db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_counter = NULL WHERE id = ?').run(req.params.id);
        logEvent(db, req, 'user.totp_reset', { id: Number(req.params.id), username });
      }
      const targetIsCurrentUser = Number(req.params.id) === Number(req.session.user.id);
      const shouldRevokeSessions = Boolean(password) || resetTotp || user.role !== role;
      const revokedSessions = shouldRevokeSessions ? req.sessionStore.destroyForUser(req.params.id, { exceptSid: targetIsCurrentUser ? req.sessionID : undefined }) : 0;
      if (targetIsCurrentUser) req.session.user = { ...req.session.user, username, role };
      logEvent(db, req, 'user.updated', { id: Number(req.params.id), username, role, passwordChanged: Boolean(password), totpReset: resetTotp, revokedSessions });
      res.json({ ok: true, revokedSessions });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.delete('/users/:id', requireRole('admin'), (req, res) => {
    if (Number(req.params.id) === Number(req.session.user.id)) return res.status(400).json({ error: 'Cannot delete your own account' });
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.role === 'admin' && adminCountExcluding(req.params.id) < 1) return res.status(400).json({ error: 'At least one admin account is required' });
    const revokedSessions = req.sessionStore.destroyForUser(req.params.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    logEvent(db, req, 'user.deleted', { id: Number(req.params.id), username: user.username, revokedSessions });
    res.json({ ok: true, revokedSessions });
  });

  router.get('/me/preferences', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT key, value FROM user_preferences WHERE user_id = ?').all(req.session.user.id);
    const preferences = Object.fromEntries(rows.map(r => {
      let val = JSON.parse(r.value);
      if (r.key === 'launchpad') {
        val = normalizeLaunchpad(val);
      }
      return [r.key, val];
    }));
    res.json({ preferences });
  });

  router.put('/me/preferences/:key', requireAuth, express.json(), (req, res) => {
    try {
      const value = preferencePayload(req.params.key, req.body.value);
      db.prepare(`
        INSERT INTO user_preferences (user_id, key, value) VALUES (?, ?, ?)
        ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
      `).run(req.session.user.id, req.params.key, JSON.stringify(value));
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.delete('/me/preferences/:key', requireAuth, (req, res) => {
    const allowed = new Set(['favorites', 'launchpad', 'plugins']);
    if (!allowed.has(req.params.key)) return res.status(400).json({ error: 'Unsupported preference key' });
    const result = db.prepare('DELETE FROM user_preferences WHERE user_id = ? AND key = ?').run(req.session.user.id, req.params.key);
    logEvent(db, req, 'profile.preferences_reset', { key: req.params.key, changed: result.changes });
    res.json({ ok: true, changed: result.changes });
  });


}

module.exports = { registerUserRoutes };
