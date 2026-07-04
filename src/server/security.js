const crypto = require('crypto');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_EXEMPT_PATHS = new Set(['/api/auth/login', '/api/bootstrap']);

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join('; '));
  next();
}

function issueCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  if (!MUTATING_METHODS.has(req.method)) return next();
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();
  // Bearer-token requests carry no ambient cookie credentials, so CSRF does
  // not apply; req.apiToken is only set after the token validated.
  if (req.apiToken) return next();
  const expected = req.session?.csrfToken;
  const actual = req.get('x-csrf-token');
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  const actualBuffer = Buffer.from(String(actual || ''), 'utf8');
  if (!expected || !actual || expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) return res.status(403).json({ error: 'Invalid CSRF token' });
  next();
}

module.exports = { securityHeaders, csrfProtection, issueCsrfToken };
