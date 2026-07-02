const express = require('express');
const bcrypt = require('bcryptjs');
const { getSetting } = require('../db');
const { issueCsrfToken } = require('../security');
const totp = require('../totp');

// Compared against when a username does not exist so response timing does not
// reveal which usernames are registered. Hash of a long random throwaway value.
const DUMMY_PASSWORD_HASH = '$2a$12$abdPSDFEQ.WRYzarpYqmJu0afTCOpyv4fG9xbQI8nu4G02ROd13WW';

function verifyTotpForUser(db, user, code) {
  const result = totp.verifyTOTPWithCounter(user.totp_secret, code);
  if (!result) return false;
  if (user.totp_last_counter !== null && user.totp_last_counter !== undefined && result.counter <= user.totp_last_counter) return false;
  db.prepare('UPDATE users SET totp_last_counter = ? WHERE id = ?').run(result.counter, user.id);
  return true;
}

function registerAuthRoutes(router, { db, requireAuth, logEvent, isLoginLimited, recordLoginFailure, clearLoginFailures, refreshSessionUser }) {
  router.get('/bootstrap-status', (req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    res.json({ needsBootstrap: count === 0 });
  });

  router.post('/bootstrap', express.json(), async (req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    if (count !== 0) return res.apiError(409, 'Bootstrap already completed');
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (username.length < 3 || password.length < 10) return res.apiError(400, 'Username must be 3+ chars and password 10+ chars');
    const hash = await bcrypt.hash(password, 12);

    let totpSecret = null;
    let totpEnabled = 0;
    let totpCounter = null;

    if (req.body.totpSecret && req.body.totpCode) {
      const codeResult = totp.verifyTOTPWithCounter(req.body.totpSecret, req.body.totpCode);
      if (!codeResult) {
        return res.apiError(400, 'Invalid 2FA verification code');
      }
      totpSecret = req.body.totpSecret;
      totpEnabled = 1;
      totpCounter = codeResult.counter;
    }

    const info = db.prepare('INSERT INTO users (username, password_hash, role, totp_secret, totp_enabled, totp_last_counter) VALUES (?, ?, ?, ?, ?, ?)').run(username, hash, 'admin', totpSecret, totpEnabled, totpCounter);
    req.session.user = { id: info.lastInsertRowid, username, role: 'admin' };
    req.session.createdAt = new Date().toISOString();
    issueCsrfToken(req);
    logEvent(db, req, 'bootstrap.admin_created', { username, totpEnabled: Boolean(totpEnabled) });
    res.json({ user: req.session.user });
  });

  router.post('/auth/login', express.json(), async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const code = String(req.body.code || '').trim();

    if (isLoginLimited(db, req, username)) {
      logEvent(db, req, 'auth.login_rate_limited', { username }, 'warn');
      return res.apiError(429, 'Too many failed login attempts. Try again later.');
    }
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    const passwordMatches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);
    if (!user || !passwordMatches) {
      recordLoginFailure(db, req, username);
      logEvent(db, req, 'auth.login_failed', { username }, 'warn');
      return res.apiError(401, 'Invalid username or password');
    }

    if (user.totp_enabled === 1) {
      if (!code) {
        return res.json({ requiresTotp: true });
      }
      if (!verifyTotpForUser(db, user, code)) {
        recordLoginFailure(db, req, username);
        logEvent(db, req, 'auth.login_failed_2fa', { username }, 'warn');
        return res.apiError(401, 'Invalid 2FA code');
      }
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
    const user = refreshSessionUser(req, db);
    if (req.session.user && !user) {
      return req.session.destroy(() => res.json({ user: null, publicReadEnabled: getSetting(db, 'public_read_enabled', true), csrfToken: null }));
    }
    res.json({ user, publicReadEnabled: getSetting(db, 'public_read_enabled', true), csrfToken: user ? issueCsrfToken(req) : null });
  });

  router.get('/me', requireAuth, (req, res) => {
    const user = db.prepare('SELECT id, username, role, totp_enabled AS totpEnabled, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE id = ?').get(req.session.user.id);
    res.json({ user });
  });

  router.patch('/me/password', requireAuth, express.json(), async (req, res) => {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 10) return res.apiError(400, 'New password must be at least 10 characters');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
    if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) return res.apiError(401, 'Current password is incorrect');
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(await bcrypt.hash(newPassword, 12), user.id);
    const revokedSessions = req.sessionStore.destroyForUser(user.id, { exceptSid: req.sessionID });
    logEvent(db, req, 'profile.password_changed', { revokedSessions });
    res.apiOk({ revokedSessions });
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

  router.post('/me/totp/setup', requireAuth, (req, res) => {
    const secret = totp.generateSecret();
    res.json({ secret });
  });

  router.post('/me/totp/enable', requireAuth, express.json(), (req, res) => {
    const secret = String(req.body.secret || '').trim();
    const code = String(req.body.code || '').trim();
    if (!secret || !code) return res.apiError(400, 'Secret and verification code are required');
    const codeResult = totp.verifyTOTPWithCounter(secret, code);
    if (!codeResult) return res.apiError(400, 'Invalid verification code');

    db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 1, totp_last_counter = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(secret, codeResult.counter, req.session.user.id);
    logEvent(db, req, 'profile.totp_enabled');
    res.apiOk();
  });

  router.post('/me/totp/disable', requireAuth, express.json(), async (req, res) => {
    const password = String(req.body.password || '');
    const code = String(req.body.code || '').trim();

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.apiError(401, 'Current password is incorrect');
    }

    if (user.totp_enabled === 1) {
      if (!code) {
        return res.apiError(400, 'Verification code is required');
      }
      if (!verifyTotpForUser(db, user, code)) {
        return res.apiError(401, 'Invalid verification code');
      }
    }

    db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_last_counter = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.session.user.id);
    req.sessionStore.destroyForUser(req.session.user.id, { exceptSid: req.sessionID });
    logEvent(db, req, 'profile.totp_disabled');
    res.apiOk();
  });
}

module.exports = { registerAuthRoutes };
