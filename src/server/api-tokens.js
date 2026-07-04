const crypto = require('crypto');

const TOKEN_PREFIX = 'hll_';

function generateApiToken() {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

// Tokens carry enough entropy that a fast, deterministic hash is the right
// storage form: it allows an indexed equality lookup, unlike bcrypt.
function hashApiToken(token) {
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function tokenPrefix(token) {
  return String(token).slice(0, TOKEN_PREFIX.length + 8);
}

function apiTokenPayload(row) {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    role: row.role,
    createdBy: row.created_by,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at
  };
}

function resolveApiToken(db, token) {
  const row = db.prepare('SELECT * FROM api_tokens WHERE token_hash = ?').get(hashApiToken(token));
  if (!row) return null;
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return null;
  db.prepare('UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
  return row;
}

// Authenticates Authorization: Bearer hll_... requests. Runs before the
// session middleware; a request authenticated here never gets (or needs) a
// session, so token auth stays cookie- and CSRF-free.
function apiTokenAuth(db) {
  return (req, res, next) => {
    const header = String(req.get('authorization') || '');
    if (!header.toLowerCase().startsWith('bearer ')) return next();
    const token = header.slice(7).trim();
    if (!token.startsWith(TOKEN_PREFIX)) return next();
    const row = resolveApiToken(db, token);
    if (!row) return res.status(401).json({ error: 'Invalid or expired API token' });
    req.apiToken = {
      id: row.id,
      name: row.name,
      role: row.role,
      user: { id: null, username: `token:${row.name}`, role: row.role }
    };
    next();
  };
}

module.exports = { TOKEN_PREFIX, generateApiToken, hashApiToken, tokenPrefix, apiTokenPayload, resolveApiToken, apiTokenAuth };
