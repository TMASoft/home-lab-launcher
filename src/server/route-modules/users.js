const express = require('express');
const bcrypt = require('bcryptjs');

function registerUserRoutes(router, deps) {
  const { db, requireAuth, requireRole, logEvent, userPayload, preferencePayload } = deps;
  router.get('/users', requireRole('admin'), (req, res) => {
    const users = db.prepare('SELECT id, username, role, created_at AS createdAt FROM users ORDER BY username').all();
    res.json({ users });
  });

  router.post('/users', requireRole('admin'), express.json(), (req, res) => {
    try {
      const { username, password, role } = userPayload(req.body || {}, {}, { requirePassword: true });
      const hash = bcrypt.hashSync(password, 12);
      const info = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role);
      logEvent(db, req, 'user.created', { id: info.lastInsertRowid, username, role });
      res.status(201).json({ user: { id: info.lastInsertRowid, username, role } });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.patch('/users/:id', requireRole('admin'), express.json(), (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    try {
      const { username, password, role } = userPayload(req.body || {}, user);
      if (password) {
        db.prepare('UPDATE users SET username = ?, role = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(username, role, bcrypt.hashSync(password, 12), req.params.id);
      } else {
        db.prepare('UPDATE users SET username = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(username, role, req.params.id);
      }
      if (Number(req.params.id) === Number(req.session.user.id)) req.session.user = { ...req.session.user, username, role };
      logEvent(db, req, 'user.updated', { id: Number(req.params.id), username, role, passwordChanged: Boolean(password) });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.delete('/users/:id', requireRole('admin'), (req, res) => {
    if (Number(req.params.id) === Number(req.session.user.id)) return res.status(400).json({ error: 'Cannot delete your own account' });
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    logEvent(db, req, 'user.deleted', { id: Number(req.params.id) });
    res.json({ ok: true });
  });

  router.get('/me/preferences', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT key, value FROM user_preferences WHERE user_id = ?').all(req.session.user.id);
    const preferences = Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
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
    const allowed = new Set(['favorites', 'launchpad']);
    if (!allowed.has(req.params.key)) return res.status(400).json({ error: 'Unsupported preference key' });
    const result = db.prepare('DELETE FROM user_preferences WHERE user_id = ? AND key = ?').run(req.session.user.id, req.params.key);
    logEvent(db, req, 'profile.preferences_reset', { key: req.params.key, changed: result.changes });
    res.json({ ok: true, changed: result.changes });
  });


}

module.exports = { registerUserRoutes };
