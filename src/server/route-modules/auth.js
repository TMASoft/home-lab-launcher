const express = require('express');
const bcrypt = require('bcryptjs');
const { getSetting } = require('../db');
const { issueCsrfToken } = require('../security');

function registerAuthRoutes(router, { db, requireAuth, logEvent, isLoginLimited, recordLoginFailure, clearLoginFailures }) {
  router.get('/bootstrap-status', (req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    res.json({ needsBootstrap: count === 0 });
  });

  router.post('/bootstrap', express.json(), (req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    if (count !== 0) return res.apiError(409, 'Bootstrap already completed');
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (username.length < 3 || password.length < 10) return res.apiError(400, 'Username must be 3+ chars and password 10+ chars');
    const hash = bcrypt.hashSync(password, 12);
    const info = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, 'admin');
    req.session.user = { id: info.lastInsertRowid, username, role: 'admin' };
    req.session.createdAt = new Date().toISOString();
    issueCsrfToken(req);
    logEvent(db, req, 'bootstrap.admin_created', { username });
    res.json({ user: req.session.user });
  });

  router.post('/auth/login', express.json(), (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (isLoginLimited(db, req, username)) {
      logEvent(db, req, 'auth.login_rate_limited', { username }, 'warn');
      return res.apiError(429, 'Too many failed login attempts. Try again later.');
    }
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      recordLoginFailure(db, req, username);
      logEvent(db, req, 'auth.login_failed', { username }, 'warn');
      return res.apiError(401, 'Invalid username or password');
    }
    clearLoginFailures(db, req, username);
    req.session.regenerate((err) => {
      if (err) return res.apiError(500, 'Could not create session');
      req.session.user = { id: user.id, username: user.username, role: user.role };
      req.session.createdAt = new Date().toISOString();
      req.session.ip = req.ip;
      req.session.userAgent = req.get('user-agent') || '';
      issueCsrfToken(req);
      logEvent(db, req, 'auth.login');
      res.json({ user: req.session.user, csrfToken: req.session.csrfToken });
    });
  });

  router.post('/auth/logout', (req, res) => {
    logEvent(db, req, 'auth.logout');
    req.session.destroy(() => res.apiOk());
  });

  router.get('/auth/session', (req, res) => {
    res.json({ user: req.session.user || null, publicReadEnabled: getSetting(db, 'public_read_enabled', true), csrfToken: req.session.user ? issueCsrfToken(req) : null });
  });

  router.get('/me', requireAuth, (req, res) => {
    const user = db.prepare('SELECT id, username, role, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE id = ?').get(req.session.user.id);
    res.json({ user });
  });

  router.patch('/me/password', requireAuth, express.json(), (req, res) => {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 10) return res.apiError(400, 'New password must be at least 10 characters');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) return res.apiError(401, 'Current password is incorrect');
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(bcrypt.hashSync(newPassword, 12), user.id);
    logEvent(db, req, 'profile.password_changed');
    res.apiOk();
  });

  router.get('/me/sessions', requireAuth, (req, res) => {
    const sessions = req.sessionStore.listForUser(req.session.user.id).map((item) => ({ ...item, current: item.sid === req.sessionID }));
    res.json({ sessions });
  });

  router.delete('/me/sessions/:sid', requireAuth, (req, res) => {
    if (req.params.sid === req.sessionID) return res.apiError(400, 'Use logout to end the current session');
    const sessions = req.sessionStore.listForUser(req.session.user.id);
    if (!sessions.some((item) => item.sid === req.params.sid)) return res.apiError(404, 'Session not found');
    req.sessionStore.destroy(req.params.sid, () => {});
    logEvent(db, req, 'profile.session_revoked', { sid: req.params.sid });
    res.apiOk();
  });

  router.delete('/me/sessions', requireAuth, (req, res) => {
    const count = req.sessionStore.destroyForUser(req.session.user.id, { exceptSid: req.sessionID });
    logEvent(db, req, 'profile.other_sessions_revoked', { count });
    res.apiOk({ count });
  });
}

module.exports = { registerAuthRoutes };
