function error(res, status, message, extra = {}) {
  return res.status(status).json({ error: String(message), ...extra });
}

function ok(res, payload = {}) {
  return res.json({ ok: true, ...payload });
}

function created(res, payload = {}) {
  return res.status(201).json(payload);
}

function apiResponseMiddleware(req, res, next) {
  // API responses may include session-scoped or secret data; individual routes
  // that serve immutable content-hashed files override this with long-lived caching.
  res.setHeader('Cache-Control', 'no-store');
  res.apiError = (status, message, extra) => error(res, status, message, extra);
  res.apiOk = (payload) => ok(res, payload);
  res.apiCreated = (payload) => created(res, payload);
  next();
}

module.exports = { apiResponseMiddleware, error, ok, created };
