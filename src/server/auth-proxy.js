const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const VALID_ROLES = new Set(['admin', 'editor', 'user']);

function parseAuthProxyConfig(env = process.env) {
  const enabled = String(env.AUTH_PROXY_ENABLED || '').trim().toLowerCase() === 'true';
  const usernameHeader = String(env.AUTH_PROXY_USERNAME_HEADER || 'remote-user').trim().toLowerCase();
  const autoCreate = String(env.AUTH_PROXY_AUTO_CREATE || '').trim().toLowerCase() === 'true';
  const defaultRole = String(env.AUTH_PROXY_DEFAULT_ROLE || 'user').trim().toLowerCase();
  return { enabled, usernameHeader, autoCreate, defaultRole };
}

// Returns startup errors; forward-auth trusts an upstream proxy header, so a
// misconfiguration must stop the server rather than silently degrade.
function validateAuthProxyConfig(config, { trustProxy }) {
  const errors = [];
  if (!config.enabled) return errors;
  if (!trustProxy) {
    errors.push('AUTH_PROXY_ENABLED requires TRUST_PROXY to be set; forward-auth headers are only trustworthy behind a reverse proxy that strips client-supplied copies.');
  }
  if (!config.usernameHeader || /[^a-z0-9-]/.test(config.usernameHeader)) {
    errors.push(`AUTH_PROXY_USERNAME_HEADER is not a valid header name: "${config.usernameHeader}"`);
  }
  if (!VALID_ROLES.has(config.defaultRole)) {
    errors.push(`AUTH_PROXY_DEFAULT_ROLE must be admin, editor, or user (got "${config.defaultRole}")`);
  }
  return errors;
}

function normalizeProxyUsername(value) {
  return String(value || '').trim().slice(0, 120);
}

function authProxyMiddleware(db, config, { logEvent }) {
  return (req, res, next) => {
    if (!config.enabled) return next();
    if (req.apiToken) return next();
    if (!req.session || req.session.user) return next();
    const username = normalizeProxyUsername(req.get(config.usernameHeader));
    if (!username) return next();

    let user = db.prepare('SELECT id, username, role FROM users WHERE username = ?').get(username);
    if (!user && config.autoCreate) {
      // Auto-created accounts get an unguessable placeholder password; they
      // can only sign in through the proxy until an admin sets a real one.
      const placeholder = bcrypt.hashSync(crypto.randomBytes(32).toString('base64url'), 10);
      const info = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, placeholder, config.defaultRole);
      user = { id: info.lastInsertRowid, username, role: config.defaultRole };
      logEvent(db, req, 'auth_proxy.user_created', { username, role: config.defaultRole });
    }
    if (!user) return next();

    req.session.user = { id: user.id, username: user.username, role: user.role };
    req.session.createdAt = req.session.createdAt || new Date().toISOString();
    req.session.authProxy = true;
    logEvent(db, req, 'auth_proxy.login', { username: user.username });
    next();
  };
}

module.exports = { parseAuthProxyConfig, validateAuthProxyConfig, authProxyMiddleware, normalizeProxyUsername };
