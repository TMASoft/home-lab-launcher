const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const express = require('express');
const packageJson = require('../../package.json');
const { getSetting, setSetting } = require('./db');
const { issueCsrfToken } = require('./security');

function serviceFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    url: row.url,
    category: row.category,
    accent: row.accent,
    description: row.description,
    tags: JSON.parse(row.tags_json || '[]'),
    sortOrder: row.sort_order,
    featured: Boolean(row.featured),
    enabled: Boolean(row.enabled),
    healthCheckEnabled: Boolean(row.health_check_enabled),
    healthCheckUrl: row.health_check_url || '',
    healthCheckIntervalMinutes: row.health_check_interval_minutes || 15,
    health: row.health_status ? {
      status: row.health_status,
      statusCode: row.health_status_code,
      responseMs: row.health_response_ms,
      checkedAt: row.health_checked_at,
      nextCheckAt: row.health_next_check_at,
      error: row.health_error
    } : null
  };
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}


function logEvent(db, req, action, details = {}, level = 'info') {
  try {
    db.prepare(`
      INSERT INTO app_logs (level, action, actor_user_id, actor_username, ip, details_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(level, action, req.session?.user?.id || null, req.session?.user?.username || null, req.ip || null, JSON.stringify(details));
  } catch (error) {
    console.error('Could not write app log', error);
  }
}

function publicSettings(db) {
  return {
    appName: getSetting(db, 'app_name', 'Home Lab Launcher'),
    appBaseUrl: getSetting(db, 'app_base_url', ''),
    publicReadEnabled: getSetting(db, 'public_read_enabled', true),
    weather: getSetting(db, 'weather', null)
  };
}


function allServices(db, { includeDisabled = true } = {}) {
  const rows = db.prepare(serviceSelectSql('ORDER BY s.sort_order ASC, s.name ASC')).all();
  const services = rows.map(serviceFromRow);
  return includeDisabled ? services : services.filter((service) => service.enabled);
}

function validateUrl(value) {
  try {
    const parsed = new URL(String(value));
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return true;
  } catch {
    return false;
  }
}

function fileSize(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

const SERVICE_ICON_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

function serviceIconDir(dataDir) {
  return path.join(dataDir, 'service-icons');
}

function detectImageMime(buffer, contentType = '') {
  const hinted = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (IMAGE_MIME_EXTENSIONS[hinted]) return hinted;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value));
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function saveServiceIconBuffer(dataDir, buffer, contentType) {
  if (!buffer.length) throw new Error('Icon image is empty');
  if (buffer.length > SERVICE_ICON_MAX_BYTES) throw new Error('Icon image must be 5 MiB or smaller');
  const mime = detectImageMime(buffer, contentType);
  if (!mime) throw new Error('Icon image must be JPEG, PNG, GIF, or WebP');
  const dir = serviceIconDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const filename = `${hash}.${IMAGE_MIME_EXTENSIONS[mime]}`;
  const destination = path.join(dir, filename);
  if (!fs.existsSync(destination)) fs.writeFileSync(destination, buffer);
  return `/api/service-icons/${filename}`;
}

async function downloadServiceIcon(dataDir, value) {
  let parsed;
  try { parsed = new URL(String(value)); } catch { throw new Error('Icon URL is invalid'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Icon URL must use http or https');
  const response = await fetch(parsed, { redirect: 'follow', headers: { 'User-Agent': 'home-lab-launcher' } });
  if (!response.ok) throw new Error(`Could not download icon image: HTTP ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > SERVICE_ICON_MAX_BYTES) throw new Error('Icon image must be 5 MiB or smaller');
  const buffer = Buffer.from(await response.arrayBuffer());
  return saveServiceIconBuffer(dataDir, buffer, response.headers.get('content-type') || '');
}

function saveServiceIconDataUrl(dataDir, dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new Error('Uploaded icon image is invalid');
  const mime = match[1].toLowerCase();
  if (!IMAGE_MIME_EXTENSIONS[mime]) throw new Error('Icon image must be JPEG, PNG, GIF, or WebP');
  return saveServiceIconBuffer(dataDir, Buffer.from(match[2], 'base64'), mime);
}

async function normalizeServiceIcon(dataDir, body, fallback = '🔗') {
  if (body.iconImageData) return saveServiceIconDataUrl(dataDir, body.iconImageData);
  const icon = String(body.icon || fallback || '🔗').trim();
  if (!icon) return '🔗';
  if (isHttpUrl(icon)) return downloadServiceIcon(dataDir, icon);
  return icon.slice(0, 512);
}

function configWarnings(db, { dataDir, pluginDir }) {
  const settings = publicSettings(db);
  const warnings = [];
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('change-this') || process.env.SESSION_SECRET.includes('dev-only')) warnings.push({ level: 'high', message: 'SESSION_SECRET is missing or still set to a default value.' });
  if (process.env.BOOTSTRAP_ADMIN_PASSWORD && ['change-me-immediately', 'change-me', 'password'].includes(process.env.BOOTSTRAP_ADMIN_PASSWORD)) warnings.push({ level: 'high', message: 'Bootstrap admin password still appears to be a default value.' });
  if (settings.appBaseUrl && settings.appBaseUrl.startsWith('http://') && process.env.NODE_ENV === 'production') warnings.push({ level: 'medium', message: 'APP_BASE_URL uses HTTP in production. Use HTTPS behind a reverse proxy when possible.' });
  if (!settings.appBaseUrl) warnings.push({ level: 'medium', message: 'APP_BASE_URL is not configured.' });
  if (!fs.existsSync(dataDir)) warnings.push({ level: 'high', message: `Data directory does not exist: ${dataDir}` });
  if (!fs.existsSync(pluginDir)) warnings.push({ level: 'low', message: `Plugin directory does not exist yet: ${pluginDir}` });
  return warnings;
}


function serviceSelectSql(orderBy = 'ORDER BY s.sort_order ASC, s.name ASC') {
  return `
    SELECT s.*, h.status AS health_status, h.status_code AS health_status_code, h.response_ms AS health_response_ms,
      h.checked_at AS health_checked_at, h.next_check_at AS health_next_check_at, h.error AS health_error
    FROM services s
    LEFT JOIN service_health h ON h.service_id = s.id
    ${orderBy}
  `;
}

function healthStatusFrom(code) {
  if (code >= 200 && code < 400) return 'up';
  if (code >= 400) return 'down';
  return 'unknown';
}

async function checkServiceHealth(db, service) {
  const target = service.healthCheckUrl || service.url;
  const started = Date.now();
  const interval = Math.max(1, Number(service.healthCheckIntervalMinutes || 15));
  const nextCheckAt = new Date(Date.now() + interval * 60 * 1000).toISOString();
  let status = 'unknown';
  let statusCode = null;
  let error = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      response = await fetch(target, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
      if (response.status === 405 || response.status === 403) response = await fetch(target, { method: 'GET', redirect: 'follow', signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    statusCode = response.status;
    status = healthStatusFrom(response.status);
  } catch (err) {
    status = 'down';
    error = err.name === 'AbortError' ? 'Health check timed out' : err.message;
  }
  const responseMs = Date.now() - started;
  db.prepare(`
    INSERT INTO service_health (service_id, status, status_code, response_ms, checked_at, next_check_at, error)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
    ON CONFLICT(service_id) DO UPDATE SET status=excluded.status, status_code=excluded.status_code, response_ms=excluded.response_ms, checked_at=CURRENT_TIMESTAMP, next_check_at=excluded.next_check_at, error=excluded.error
  `).run(service.id, status, statusCode, responseMs, nextCheckAt, error);
  return db.prepare('SELECT status, status_code AS statusCode, response_ms AS responseMs, checked_at AS checkedAt, next_check_at AS nextCheckAt, error FROM service_health WHERE service_id = ?').get(service.id);
}

function servicesDueForHealthCheck(db) {
  return db.prepare(`${serviceSelectSql("WHERE s.enabled = 1 AND s.health_check_enabled = 1 AND (h.next_check_at IS NULL OR h.next_check_at <= CURRENT_TIMESTAMP)")}`).all().map(serviceFromRow);
}

function startServiceHealthScheduler(db) {
  const run = async () => {
    for (const service of servicesDueForHealthCheck(db)) {
      await checkServiceHealth(db, service).catch((error) => console.error(`Health check failed for ${service.id}:`, error));
    }
  };
  setTimeout(run, 5000);
  return setInterval(run, 60 * 1000);
}

function buildBackup(db) {
  return {
    exportedAt: new Date().toISOString(),
    format: 'home-lab-launcher-config-v1',
    appVersion: packageJson.version,
    settings: Object.fromEntries(db.prepare('SELECT key, value FROM settings ORDER BY key').all().map((row) => [row.key, JSON.parse(row.value)])),
    services: allServices(db),
    users: db.prepare('SELECT id, username, role, created_at AS createdAt, updated_at AS updatedAt FROM users ORDER BY username').all(),
    plugins: db.prepare('SELECT id, name, source_url AS sourceUrl, source_type AS sourceType, version, enabled, manifest_json AS manifestJson, config_json AS configJson, installed_at AS installedAt, updated_at AS updatedAt FROM plugins ORDER BY name').all().map((row) => ({
      ...row,
      enabled: Boolean(row.enabled),
      manifest: JSON.parse(row.manifestJson || '{}'),
      config: JSON.parse(row.configJson || '{}'),
      manifestJson: undefined,
      configJson: undefined
    }))
  };
}


function safeJsonParse(value, fallback = {}) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function applyConfigBackup(db, backup) {
  if (!backup || backup.format !== 'home-lab-launcher-config-v1') throw new Error('Unsupported backup format');
  const settings = backup.settings && typeof backup.settings === 'object' ? backup.settings : {};
  const services = Array.isArray(backup.services) ? backup.services : [];
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(settings)) setSetting(db, key, value);
    if (services.length) {
      db.prepare('DELETE FROM services').run();
      const stmt = db.prepare(`
        INSERT INTO services (id, name, icon, url, category, accent, description, tags_json, sort_order, featured, enabled)
        VALUES (@id, @name, @icon, @url, @category, @accent, @description, @tags_json, @sort_order, @featured, @enabled)
      `);
      for (const service of services) {
        if (!service.id || !service.name || !service.url || !validateUrl(service.url)) continue;
        stmt.run({
          id: slug(service.id),
          name: String(service.name),
          icon: String(service.icon || '🔗'),
          url: String(service.url),
          category: String(service.category || 'general'),
          accent: String(service.accent || '#4de7ff'),
          description: String(service.description || ''),
          tags_json: JSON.stringify(normalizeTags(service.tags)),
          sort_order: Number(service.sortOrder || service.sort_order || 0),
          featured: service.featured ? 1 : 0,
          enabled: service.enabled === false ? 0 : 1,
          health_check_enabled: service.healthCheckEnabled ? 1 : 0,
          health_check_url: String(service.healthCheckUrl || ''),
          health_check_interval_minutes: Number(service.healthCheckIntervalMinutes || 15)
        });
      }
    }
  });
  tx();
  return { settings: Object.keys(settings).length, services: services.length };
}

function effectiveConfig(db, req, { dataDir, pluginDir }) {
  const settings = publicSettings(db);
  const baseUrl = settings.appBaseUrl || '';
  let parsedBaseUrl = null;
  try { parsedBaseUrl = baseUrl ? new URL(baseUrl) : null; } catch {}
  return {
    app: { name: packageJson.name, version: packageJson.version, nodeEnv: process.env.NODE_ENV || 'development' },
    urls: {
      appBaseUrl: baseUrl,
      appBaseUrlValid: Boolean(parsedBaseUrl),
      appBaseUrlProtocol: parsedBaseUrl?.protocol?.replace(':', '') || null,
      requestProtocol: req.protocol,
      requestHost: req.get('host') || null,
      behindProxy: Boolean(req.get('x-forwarded-for') || req.get('x-forwarded-proto')),
      forwardedProto: req.get('x-forwarded-proto') || null
    },
    storage: { dataDir, pluginDir },
    security: {
      sessionSecretConfigured: Boolean(process.env.SESSION_SECRET && !process.env.SESSION_SECRET.includes('change-this') && !process.env.SESSION_SECRET.includes('dev-only')),
      cookieSecure: Boolean(process.env.APP_BASE_URL?.startsWith('https://')),
      publicReadEnabled: settings.publicReadEnabled,
      logRetentionDays: getSetting(db, 'log_retention_days', 90)
    },
    weather: settings.weather,
    scheduledBackupLocation: getSetting(db, 'scheduled_backup_location', '')
  };
}

function adminNotices(db, pluginManager, paths) {
  const notices = configWarnings(db, paths).map((warning) => ({ level: warning.level, source: 'configuration', title: 'Configuration warning', message: warning.message }));
  for (const failure of pluginManager.health().failures) notices.push({ level: 'high', source: 'plugin', title: `Plugin failed: ${failure.pluginId}`, message: failure.message });
  const recentErrors = db.prepare("SELECT action, details_json AS detailsJson, created_at AS createdAt FROM app_logs WHERE level = 'error' ORDER BY id DESC LIMIT 5").all();
  for (const row of recentErrors) notices.push({ level: 'medium', source: 'audit', title: row.action, message: JSON.stringify(safeJsonParse(row.detailsJson, {})), createdAt: row.createdAt });
  return notices;
}

function slug(value) {
  return String(value || crypto.randomUUID()).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || crypto.randomUUID();
}

function uniqueServiceId(db, base) {
  const root = slug(base);
  let id = root;
  let i = 2;
  while (db.prepare('SELECT 1 FROM services WHERE id = ?').get(id)) {
    id = `${root}-${i}`;
    i += 1;
  }
  return id;
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

function canRead(req, db) {
  return Boolean(req.session.user) || getSetting(db, 'public_read_enabled', true) === true;
}


const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

function loginKey(req, username) {
  return `${req.ip || 'unknown'}:${String(username || '').toLowerCase()}`;
}

function isLoginLimited(req, username) {
  const key = loginKey(req, username);
  const item = loginAttempts.get(key);
  if (!item) return false;
  if (Date.now() > item.resetAt) {
    loginAttempts.delete(key);
    return false;
  }
  return item.count >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(req, username) {
  const key = loginKey(req, username);
  const item = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + LOGIN_WINDOW_MS };
  item.count += 1;
  loginAttempts.set(key, item);
}

function clearLoginFailures(req, username) {
  loginAttempts.delete(loginKey(req, username));
}

function registerCoreRoutes(app, { db, pluginManager, dataDir, pluginDir }) {
  const router = express.Router();
  startServiceHealthScheduler(db);

  router.use((req, res, next) => {
    res.locals.canRead = canRead(req, db);
    if (req.session) {
      req.session.ip = req.ip;
      req.session.userAgent = req.get('user-agent') || '';
    }
    next();
  });

  router.get('/bootstrap-status', (req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    res.json({ needsBootstrap: count === 0 });
  });

  router.post('/bootstrap', express.json(), (req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    if (count !== 0) return res.status(409).json({ error: 'Bootstrap already completed' });
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (username.length < 3 || password.length < 10) return res.status(400).json({ error: 'Username must be 3+ chars and password 10+ chars' });
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
    if (isLoginLimited(req, username)) {
      logEvent(db, req, 'auth.login_rate_limited', { username }, 'warn');
      return res.status(429).json({ error: 'Too many failed login attempts. Try again later.' });
    }
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      recordLoginFailure(req, username);
      logEvent(db, req, 'auth.login_failed', { username }, 'warn');
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    clearLoginFailures(req, username);
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Could not create session' });
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
    req.session.destroy(() => res.json({ ok: true }));
  });

  router.get('/auth/session', (req, res) => {
    res.json({ user: req.session.user || null, publicReadEnabled: getSetting(db, 'public_read_enabled', true), csrfToken: req.session.user ? issueCsrfToken(req) : null });
  });

  router.get('/settings/public', (req, res) => {
    if (!canRead(req, db)) return res.status(401).json({ error: 'Authentication required' });
    res.json(publicSettings(db));
  });

  router.get('/me', requireAuth, (req, res) => {
    const user = db.prepare('SELECT id, username, role, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE id = ?').get(req.session.user.id);
    res.json({ user });
  });

  router.patch('/me/password', requireAuth, express.json(), (req, res) => {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 10) return res.status(400).json({ error: 'New password must be at least 10 characters' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
    if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) return res.status(401).json({ error: 'Current password is incorrect' });
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(bcrypt.hashSync(newPassword, 12), user.id);
    logEvent(db, req, 'profile.password_changed');
    res.json({ ok: true });
  });


  router.get('/me/sessions', requireAuth, (req, res) => {
    const sessions = req.sessionStore.listForUser(req.session.user.id).map((item) => ({ ...item, current: item.sid === req.sessionID }));
    res.json({ sessions });
  });

  router.delete('/me/sessions/:sid', requireAuth, (req, res) => {
    if (req.params.sid === req.sessionID) return res.status(400).json({ error: 'Use logout to end the current session' });
    const sessions = req.sessionStore.listForUser(req.session.user.id);
    if (!sessions.some((item) => item.sid === req.params.sid)) return res.status(404).json({ error: 'Session not found' });
    req.sessionStore.destroy(req.params.sid, () => {});
    logEvent(db, req, 'profile.session_revoked', { sid: req.params.sid });
    res.json({ ok: true });
  });

  router.delete('/me/sessions', requireAuth, (req, res) => {
    const count = req.sessionStore.destroyForUser(req.session.user.id, { exceptSid: req.sessionID });
    logEvent(db, req, 'profile.other_sessions_revoked', { count });
    res.json({ ok: true, count });
  });

  router.patch('/settings', requireRole('admin'), express.json(), (req, res) => {
    const allowed = ['app_name', 'app_base_url', 'public_read_enabled', 'scheduled_backup_location'];
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) setSetting(db, key, req.body[key]);
    }
    logEvent(db, req, 'settings.updated', req.body);
    res.json({ ok: true });
  });

  router.get('/admin/overview', requireRole('admin'), (req, res) => {
    res.json({
      settings: publicSettings(db),
      counts: {
        users: db.prepare('SELECT COUNT(*) AS count FROM users').get().count,
        services: db.prepare('SELECT COUNT(*) AS count FROM services').get().count,
        plugins: db.prepare('SELECT COUNT(*) AS count FROM plugins').get().count,
        logs: db.prepare('SELECT COUNT(*) AS count FROM app_logs').get().count
      },
      runtime: {
        appVersion: packageJson.version,
        node: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        env: process.env.NODE_ENV || 'development',
        databaseBytes: fileSize(path.join(dataDir, 'launcher.sqlite')),
        pluginDir
      },
      warnings: configWarnings(db, { dataDir, pluginDir }),
      notices: adminNotices(db, pluginManager, { dataDir, pluginDir }).slice(0, 8)
    });
  });


  router.get('/admin/health', requireRole('admin'), (req, res) => {
    const weather = getSetting(db, 'weather', {});
    res.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      app: { name: packageJson.name, version: packageJson.version },
      warnings: configWarnings(db, { dataDir, pluginDir }),
      storage: {
        dataDir,
        pluginDir,
        databaseBytes: fileSize(path.join(dataDir, 'launcher.sqlite')),
        walBytes: fileSize(path.join(dataDir, 'launcher.sqlite-wal'))
      },
      runtime: { node: process.version, uptimeSeconds: Math.round(process.uptime()), platform: process.platform, arch: process.arch },
      sessions: {
        active: db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?').get(Date.now()).count
      },
      plugins: pluginManager.health(),
      weatherProvider: { provider: 'Open-Meteo', configured: Number.isFinite(Number(weather.latitude)) && Number.isFinite(Number(weather.longitude)), location: weather.label || null },
      scheduledJobs: pluginManager.health().jobs
    });
  });

  router.get('/admin/config', requireRole('admin'), (req, res) => {
    res.json({ config: effectiveConfig(db, req, { dataDir, pluginDir }) });
  });

  router.get('/admin/notices', requireRole('admin'), (req, res) => {
    res.json({ notices: adminNotices(db, pluginManager, { dataDir, pluginDir }) });
  });

  router.get('/admin/backup', requireRole('admin'), (req, res) => {
    logEvent(db, req, 'backup.exported');
    res.setHeader('Content-Disposition', `attachment; filename="home-lab-launcher-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(buildBackup(db));
  });

  router.get('/admin/database/export', requireRole('admin'), (req, res) => {
    db.pragma('wal_checkpoint(TRUNCATE)');
    logEvent(db, req, 'database.exported');
    res.download(path.join(dataDir, 'launcher.sqlite'), `home-lab-launcher-db-${new Date().toISOString().slice(0, 10)}.sqlite`);
  });

  router.post('/admin/restore', requireRole('admin'), express.json({ limit: '5mb' }), async (req, res) => {
    try {
      const result = applyConfigBackup(db, req.body);
      await pluginManager.reload();
      logEvent(db, req, 'backup.restored', result, 'warn');
      res.json({ ok: true, restored: result });
    } catch (error) {
      logEvent(db, req, 'backup.restore_failed', { error: error.message }, 'error');
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/admin/logs/export', requireRole('admin'), (req, res) => {
    const rows = db.prepare(`
      SELECT id, level, action, actor_user_id AS actorUserId, actor_username AS actorUsername, ip, details_json AS detailsJson, created_at AS createdAt
      FROM app_logs ORDER BY id DESC LIMIT 5000
    `).all().map((row) => ({ ...row, details: safeJsonParse(row.detailsJson, {}), detailsJson: undefined }));
    logEvent(db, req, 'logs.exported', { count: rows.length });
    res.json({ exportedAt: new Date().toISOString(), logs: rows });
  });

  router.patch('/admin/logs/retention', requireRole('admin'), express.json(), (req, res) => {
    const days = Math.min(3650, Math.max(1, Number(req.body.days || 90)));
    setSetting(db, 'log_retention_days', days);
    logEvent(db, req, 'logs.retention_updated', { days });
    res.json({ days });
  });

  router.post('/admin/logs/prune', requireRole('admin'), (req, res) => {
    const days = Math.min(3650, Math.max(1, Number(getSetting(db, 'log_retention_days', 90))));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = db.prepare('DELETE FROM app_logs WHERE created_at < ?').run(cutoff);
    logEvent(db, req, 'logs.pruned', { days, deleted: result.changes }, 'warn');
    res.json({ ok: true, deleted: result.changes, days });
  });

  router.get('/admin/logs', requireRole('admin'), (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    const clauses = [];
    const params = [];
    if (req.query.level) { clauses.push('level = ?'); params.push(String(req.query.level)); }
    if (req.query.action) { clauses.push('action LIKE ?'); params.push(`%${String(req.query.action)}%`); }
    if (req.query.actor) { clauses.push('actor_username LIKE ?'); params.push(`%${String(req.query.actor)}%`); }
    if (req.query.q) { clauses.push('(action LIKE ? OR actor_username LIKE ? OR details_json LIKE ?)'); params.push(`%${String(req.query.q)}%`, `%${String(req.query.q)}%`, `%${String(req.query.q)}%`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT id, level, action, actor_user_id AS actorUserId, actor_username AS actorUsername, ip, details_json AS detailsJson, created_at AS createdAt
      FROM app_logs ${where} ORDER BY id DESC LIMIT ?
    `).all(...params, limit).map((row) => ({ ...row, details: safeJsonParse(row.detailsJson, {}), detailsJson: undefined }));
    res.json({ logs: rows });
  });

  router.get('/service-icons/:filename', (req, res) => {
    if (!canRead(req, db)) return res.status(401).end();
    const filename = path.basename(req.params.filename || '');
    if (!/^[a-f0-9]{64}\.(jpg|png|gif|webp)$/.test(filename)) return res.status(404).end();
    res.sendFile(path.join(serviceIconDir(dataDir), filename));
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
      const id = body.id && !db.prepare('SELECT 1 FROM services WHERE id = ?').get(slug(body.id)) ? slug(body.id) : uniqueServiceId(db, body.id || body.name);
      if (!body.name || !body.url) return res.status(400).json({ error: 'name and url are required' });
      if (!validateUrl(body.url)) return res.status(400).json({ error: 'Service URL must be http or https' });
      const icon = await normalizeServiceIcon(dataDir, body);
      db.prepare(`
        INSERT INTO services (id, name, icon, url, category, accent, description, tags_json, sort_order, featured, enabled, health_check_enabled, health_check_url, health_check_interval_minutes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, String(body.name), icon, String(body.url), String(body.category || 'general'), String(body.accent || '#4de7ff'), String(body.description || ''), JSON.stringify(normalizeTags(body.tags)), Number(body.sortOrder || 0), body.featured ? 1 : 0, body.enabled === false ? 0 : 1, body.healthCheckEnabled ? 1 : 0, String(body.healthCheckUrl || ''), Number(body.healthCheckIntervalMinutes || 15));
      logEvent(db, req, 'service.created', { id, name: body.name, iconImage: icon.startsWith('/api/service-icons/') });
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
      const next = { ...current, ...req.body };
      if (!validateUrl(next.url)) return res.status(400).json({ error: 'Service URL must be http or https' });
      const icon = await normalizeServiceIcon(dataDir, { ...req.body, icon: Object.prototype.hasOwnProperty.call(req.body, 'icon') ? req.body.icon : current.icon }, current.icon);
      db.prepare(`
        UPDATE services SET name=?, icon=?, url=?, category=?, accent=?, description=?, tags_json=?, sort_order=?, featured=?, enabled=?, health_check_enabled=?, health_check_url=?, health_check_interval_minutes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
      `).run(String(next.name), icon, String(next.url), String(next.category || 'general'), String(next.accent || '#4de7ff'), String(next.description || ''), JSON.stringify(normalizeTags(next.tags)), Number(next.sortOrder || 0), next.featured ? 1 : 0, next.enabled === false ? 0 : 1, next.healthCheckEnabled ? 1 : 0, String(next.healthCheckUrl || ''), Number(next.healthCheckIntervalMinutes || 15), req.params.id);
      logEvent(db, req, 'service.updated', { id: req.params.id, iconImage: icon.startsWith('/api/service-icons/') });
      res.json({ service: serviceFromRow(db.prepare(serviceSelectSql('WHERE s.id = ?')).get(req.params.id)) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/services/:id/check', requireRole('admin', 'editor'), async (req, res) => {
    const row = db.prepare(serviceSelectSql('WHERE s.id = ?')).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Service not found' });
    try {
      const health = await checkServiceHealth(db, serviceFromRow(row));
      logEvent(db, req, 'service.health_checked', { id: req.params.id, status: health.status, statusCode: health.statusCode });
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
    const upsert = db.prepare(`
      INSERT INTO services (id, name, icon, url, category, accent, description, tags_json, sort_order, featured, enabled, health_check_enabled, health_check_url, health_check_interval_minutes)
      VALUES (@id, @name, @icon, @url, @category, @accent, @description, @tags_json, @sort_order, @featured, @enabled, @health_check_enabled, @health_check_url, @health_check_interval_minutes)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, icon=excluded.icon, url=excluded.url, category=excluded.category, accent=excluded.accent, description=excluded.description, tags_json=excluded.tags_json, sort_order=excluded.sort_order, featured=excluded.featured, enabled=excluded.enabled, health_check_enabled=excluded.health_check_enabled, health_check_url=excluded.health_check_url, health_check_interval_minutes=excluded.health_check_interval_minutes, updated_at=CURRENT_TIMESTAMP
    `);
    const tx = db.transaction(() => {
      if (mode === 'replace') db.prepare('DELETE FROM services').run();
      services.forEach((service, index) => {
        if (!service.name || !service.url || !validateUrl(service.url)) throw new Error(`Invalid service at index ${index}`);
        upsert.run({
          id: slug(service.id || service.name),
          name: String(service.name),
          icon: String(service.icon || '🔗'),
          url: String(service.url),
          category: String(service.category || 'general'),
          accent: String(service.accent || '#4de7ff'),
          description: String(service.description || ''),
          tags_json: JSON.stringify(normalizeTags(service.tags)),
          sort_order: Number(service.sortOrder ?? index * 10),
          featured: service.featured ? 1 : 0,
          enabled: service.enabled === false ? 0 : 1,
          health_check_enabled: service.healthCheckEnabled ? 1 : 0,
          health_check_url: String(service.healthCheckUrl || ''),
          health_check_interval_minutes: Number(service.healthCheckIntervalMinutes || 15)
        });
      });
    });
    try { tx(); } catch (error) { return res.status(400).json({ error: error.message }); }
    logEvent(db, req, 'services.imported', { count: services.length, mode });
    res.json({ ok: true, count: services.length, mode });
  });
  router.get('/users', requireRole('admin'), (req, res) => {
    const users = db.prepare('SELECT id, username, role, created_at AS createdAt FROM users ORDER BY username').all();
    res.json({ users });
  });

  router.post('/users', requireRole('admin'), express.json(), (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const role = ['admin', 'editor', 'user'].includes(req.body.role) ? req.body.role : 'user';
    if (username.length < 3 || password.length < 10) return res.status(400).json({ error: 'Username must be 3+ chars and password 10+ chars' });
    const hash = bcrypt.hashSync(password, 12);
    const info = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role);
    logEvent(db, req, 'user.created', { id: info.lastInsertRowid, username, role });
    res.status(201).json({ user: { id: info.lastInsertRowid, username, role } });
  });

  router.patch('/users/:id', requireRole('admin'), express.json(), (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const role = ['admin', 'editor', 'user'].includes(req.body.role) ? req.body.role : user.role;
    const username = String(req.body.username || user.username).trim();
    if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (req.body.password) {
      const password = String(req.body.password);
      if (password.length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters' });
      db.prepare('UPDATE users SET username = ?, role = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(username, role, bcrypt.hashSync(password, 12), req.params.id);
    } else {
      db.prepare('UPDATE users SET username = ?, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(username, role, req.params.id);
    }
    if (Number(req.params.id) === Number(req.session.user.id)) req.session.user = { ...req.session.user, username, role };
    logEvent(db, req, 'user.updated', { id: Number(req.params.id), username, role, passwordChanged: Boolean(req.body.password) });
    res.json({ ok: true });
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
    db.prepare(`
      INSERT INTO user_preferences (user_id, key, value) VALUES (?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
    `).run(req.session.user.id, req.params.key, JSON.stringify(req.body.value));
    res.json({ ok: true });
  });

  router.get('/weather', async (req, res) => {
    if (!canRead(req, db)) return res.status(401).json({ error: 'Authentication required' });
    try {
      const cfg = getSetting(db, 'weather', {});
      const units = cfg.units === 'celsius' ? 'celsius' : 'fahrenheit';
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', cfg.latitude);
      url.searchParams.set('longitude', cfg.longitude);
      url.searchParams.set('current', 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m');
      url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min');
      url.searchParams.set('temperature_unit', units);
      url.searchParams.set('wind_speed_unit', units === 'fahrenheit' ? 'mph' : 'kmh');
      url.searchParams.set('forecast_days', '1');
      url.searchParams.set('timezone', 'auto');
      const response = await fetch(url);
      if (!response.ok) throw new Error('weather lookup failed');
      const payload = await response.json();
      res.json({ location: cfg, weather: payload, fetchedAt: new Date().toISOString() });
    } catch (error) {
      res.status(502).json({ error: 'Weather unavailable' });
    }
  });

  router.get('/weather/search', requireRole('admin'), async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (query.length < 2) return res.json({ results: [] });
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', query);
    url.searchParams.set('count', '8');
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');
    const response = await fetch(url);
    if (!response.ok) return res.status(502).json({ error: 'Geocoding unavailable' });
    const payload = await response.json();
    const results = (payload.results || []).map(r => ({
      label: [r.name, r.admin1, r.country, r.postcodes?.[0]].filter(Boolean).join(', '),
      latitude: r.latitude,
      longitude: r.longitude,
      timezone: r.timezone
    }));
    res.json({ results });
  });

  router.put('/weather/settings', requireRole('admin'), express.json(), (req, res) => {
    const body = req.body || {};
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return res.status(400).json({ error: 'Valid latitude and longitude are required' });
    const cfg = {
      label: String(body.label || `${latitude}, ${longitude}`),
      latitude,
      longitude,
      units: body.units === 'celsius' ? 'celsius' : 'fahrenheit',
      resolvedAt: new Date().toISOString()
    };
    setSetting(db, 'weather', cfg);
    logEvent(db, req, 'weather.updated', cfg);
    res.json({ weather: cfg });
  });

  router.get('/plugins', requireAuth, async (req, res) => {
    let updates = [];
    if (req.session.user?.role === 'admin' && req.query.updates === '1') updates = await pluginManager.checkUpdates();
    const plugins = pluginManager.list().map((plugin) => ({ ...plugin, update: updates.find((item) => item.id === plugin.id) || null }));
    res.json({ plugins });
  });

  router.get('/plugins/enabled-sections', (req, res) => {
    if (!canRead(req, db)) return res.status(401).json({ error: 'Authentication required' });
    res.json({ sections: pluginManager.sections() });
  });

  router.get('/plugins/:id/logs', requireRole('admin'), (req, res) => {
    const actionPrefix = `plugin.${req.params.id}.`;
    const logs = db.prepare(`
      SELECT id, level, action, actor_user_id AS actorUserId, actor_username AS actorUsername, ip, details_json AS detailsJson, created_at AS createdAt
      FROM app_logs WHERE action LIKE ? ORDER BY id DESC LIMIT 200
    `).all(`${actionPrefix}%`).map((row) => ({ ...row, details: safeJsonParse(row.detailsJson, {}), detailsJson: undefined }));
    res.json({ logs });
  });

  router.post('/plugins/reload', requireRole('admin'), async (req, res) => {
    await pluginManager.reload();
    logEvent(db, req, 'plugins.reloaded');
    res.json({ ok: true, health: pluginManager.health() });
  });

  router.get('/plugin-sources/github/versions', requireRole('admin'), async (req, res) => {
    try {
      const versions = await pluginManager.discoverGithubVersions(String(req.query.repo || ''));
      res.json({ versions });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.get('/plugin-sources/updates', requireRole('admin'), async (req, res) => {
    res.json({ updates: await pluginManager.checkUpdates() });
  });

  router.post('/plugins/install', requireRole('admin'), express.json(), async (req, res) => {
    try {
      const plugin = await pluginManager.installFromGithub(req.body.repoUrl, req.body.version);
      await pluginManager.reload();
      const failed = pluginManager.health().failures.find((item) => item.pluginId === plugin.id);
      if (failed) return res.status(400).json({ error: `Plugin installed but failed to load: ${failed.message}`, plugin });
      logEvent(db, req, 'plugin.installed', plugin);
      res.status(201).json({ plugin });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/plugins/install-local', requireRole('admin'), express.json(), async (req, res) => {
    try {
      const plugin = await pluginManager.installFromLocal(req.body.path);
      await pluginManager.reload();
      const failed = pluginManager.health().failures.find((item) => item.pluginId === plugin.id);
      if (failed) return res.status(400).json({ error: `Plugin installed but failed to load: ${failed.message}`, plugin });
      logEvent(db, req, 'plugin.local_installed', plugin);
      res.status(201).json({ plugin });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/plugins/:id/update', requireRole('admin'), express.json(), async (req, res) => {
    const previous = db.prepare('SELECT * FROM plugins WHERE id = ?').get(req.params.id);
    if (!previous) return res.status(404).json({ error: 'Plugin not found' });
    if (previous.source_type !== 'github') return res.status(400).json({ error: 'Only GitHub plugins can be updated through this flow' });
    try {
      const plugin = await pluginManager.installFromGithub(previous.source_url, req.body.version || previous.version);
      await pluginManager.reload();
      const failed = pluginManager.health().failures.find((item) => item.pluginId === plugin.id);
      if (failed) {
        db.prepare(`UPDATE plugins SET name=?, source_url=?, source_type=?, version=?, install_path=?, enabled=?, manifest_json=?, config_json=?, installed_hash=?, lifecycle=?, last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(previous.name, previous.source_url, previous.source_type, previous.version, previous.install_path, previous.enabled, previous.manifest_json, previous.config_json, previous.installed_hash, 'enabled', null, previous.id);
        await pluginManager.reload();
        logEvent(db, req, 'plugin.update_rolled_back', { id: req.params.id, attemptedVersion: req.body.version, error: failed.message }, 'error');
        return res.status(400).json({ error: `Update failed and was rolled back: ${failed.message}` });
      }
      logEvent(db, req, 'plugin.updated', { id: req.params.id, from: previous.version, to: plugin.version });
      res.json({ plugin, rolledBack: false });
    } catch (error) {
      db.prepare(`UPDATE plugins SET name=?, source_url=?, source_type=?, version=?, install_path=?, enabled=?, manifest_json=?, config_json=?, installed_hash=?, lifecycle=?, last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(previous.name, previous.source_url, previous.source_type, previous.version, previous.install_path, previous.enabled, previous.manifest_json, previous.config_json, previous.installed_hash, 'enabled', null, previous.id);
      await pluginManager.reload();
      logEvent(db, req, 'plugin.update_failed', { id: req.params.id, attemptedVersion: req.body.version, error: error.message }, 'error');
      res.status(400).json({ error: `Update failed and was rolled back: ${error.message}` });
    }
  });

  router.patch('/plugins/:id', requireRole('admin'), express.json(), async (req, res) => {
    const row = db.prepare('SELECT * FROM plugins WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Plugin not found' });
    if (Object.prototype.hasOwnProperty.call(req.body, 'enabled')) {
      db.prepare('UPDATE plugins SET enabled = ?, lifecycle = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.body.enabled ? 1 : 0, req.body.enabled ? 'enabled' : 'disabled', req.params.id);
      await pluginManager.reload();
      logEvent(db, req, 'plugin.toggled', { id: req.params.id, enabled: Boolean(req.body.enabled) });
    }
    res.json({ ok: true });
  });

  router.put('/plugins/:id/config', requireRole('admin', 'editor'), express.json(), (req, res) => {
    const row = db.prepare('SELECT * FROM plugins WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Plugin not found' });
    db.prepare('UPDATE plugins SET config_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(req.body.config || {}), req.params.id);
    logEvent(db, req, 'plugin.config_updated', { id: req.params.id });
    res.json({ ok: true });
  });

  router.delete('/plugins/:id', requireRole('admin'), async (req, res) => {
    db.prepare('DELETE FROM plugins WHERE id = ?').run(req.params.id);
    await pluginManager.reload();
    logEvent(db, req, 'plugin.deleted', { id: req.params.id });
    res.json({ ok: true });
  });

  app.use('/api', router);
  return { requireAuth, requireRole };
}

module.exports = { registerCoreRoutes, requireRole, requireAuth };
