const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const packageJson = require('../../package.json');
const { getSetting, setSetting, DEFAULT_APPEARANCE } = require('./db');
const { guardedFetch, serverFetchConfig, parsePrivateNetworkAccess } = require('./server-fetch');
const { apiResponseMiddleware } = require('./api-response');
const { servicePayload, settingsPayload, userPayload, preferencePayload, weatherSettingsPayload, pluginInstallPayload } = require('./validation');
const { registerAuthRoutes } = require('./route-modules/auth');
const { registerAdminRoutes } = require('./route-modules/admin');
const { registerServiceRoutes } = require('./route-modules/services');
const { registerUserRoutes } = require('./route-modules/users');
const { registerWeatherRoutes } = require('./route-modules/weather');
const { registerPluginRoutes } = require('./route-modules/plugins');
const { registerPresetRoutes } = require('./route-modules/presets');
const { startPresetCatalogScheduler } = require('./preset-catalog');

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
    weather: getSetting(db, 'weather', null),
    appearance: getAppearance(db)
  };
}

const THEME_PRESET_FORMAT = 'home-lab-launcher-theme-v1';
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const APPEARANCE_COLOR_KEYS = ['background', 'surface', 'surface2', 'surface3', 'text', 'mutedText', 'quietText', 'border', 'borderStrong', 'primary', 'primaryInk', 'success', 'warning', 'danger'];
const CSS_COLOR_VARIABLES = {
  background: '--bg',
  surface: '--surface',
  surface2: '--surface-2',
  surface3: '--surface-3',
  text: '--ink',
  mutedText: '--muted',
  quietText: '--quiet',
  border: '--line',
  borderStrong: '--line-strong',
  primary: '--primary',
  primaryInk: '--primary-ink',
  success: '--success',
  warning: '--warning',
  danger: '--danger'
};

function deepMerge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) out[key] = deepMerge(base[key], value);
    else if (value !== undefined) out[key] = value;
  }
  return out;
}

function cleanText(value, fallback = '', max = 240) {
  const cleaned = String(value ?? fallback).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return cleaned || String(fallback || '').slice(0, max);
}

function cleanAssetUrl(value) {
  const str = String(value || '').trim();
  if (!str) return '';
  if (/^\/api\/app-assets\/[a-f0-9]{64}\.(jpg|png|gif|webp)$/i.test(str)) return str;
  return '';
}

function sanitizeAppearance(input = {}, { partial = false } = {}) {
  const merged = partial ? deepMerge(DEFAULT_APPEARANCE, input || {}) : deepMerge(DEFAULT_APPEARANCE, input || {});
  const brand = merged.brand || {};
  const hero = merged.hero || {};
  const theme = merged.theme || {};
  const colors = {};
  for (const key of APPEARANCE_COLOR_KEYS) {
    const color = theme.colors?.[key];
    if (color === '' || color === undefined || color === null) continue;
    if (!HEX_COLOR_RE.test(String(color))) throw new Error(`Invalid theme color: ${key}`);
    colors[key] = String(color);
  }
  const mode = ['dark', 'light', 'system'].includes(theme.mode) ? theme.mode : DEFAULT_APPEARANCE.theme.mode;
  const fontFamily = ['system', 'inter', 'serif', 'mono', 'custom'].includes(theme.fontFamily) ? theme.fontFamily : DEFAULT_APPEARANCE.theme.fontFamily;
  const density = ['compact', 'comfortable', 'spacious'].includes(theme.density) ? theme.density : DEFAULT_APPEARANCE.theme.density;
  const radius = ['square', 'rounded', 'soft'].includes(theme.radius) ? theme.radius : DEFAULT_APPEARANCE.theme.radius;
  return {
    version: 1,
    brand: {
      appName: cleanText(brand.appName, DEFAULT_APPEARANCE.brand.appName, 80),
      pageTitle: cleanText(brand.pageTitle, brand.appName || DEFAULT_APPEARANCE.brand.pageTitle, 120),
      brandText: cleanText(brand.brandText, brand.appName || DEFAULT_APPEARANCE.brand.brandText, 80),
      brandSubtitle: cleanText(brand.brandSubtitle, DEFAULT_APPEARANCE.brand.brandSubtitle, 120),
      brandMarkText: cleanText(brand.brandMarkText, DEFAULT_APPEARANCE.brand.brandMarkText, 8),
      faviconUrl: cleanAssetUrl(brand.faviconUrl),
      brandIconUrl: cleanAssetUrl(brand.brandIconUrl),
      heroImageUrl: cleanAssetUrl(brand.heroImageUrl),
      footerNote: cleanText(brand.footerNote, '', 180)
    },
    hero: {
      eyebrow: cleanText(hero.eyebrow, DEFAULT_APPEARANCE.hero.eyebrow, 80),
      heading: cleanText(hero.heading, DEFAULT_APPEARANCE.hero.heading, 140),
      subheading: cleanText(hero.subheading, DEFAULT_APPEARANCE.hero.subheading, 420)
    },
    theme: {
      mode,
      fontFamily,
      customFontFamily: cleanText(theme.customFontFamily, '', 160).replace(/[;{}<>]/g, ''),
      density,
      radius,
      colors,
      cssVariables: Object.fromEntries(Object.entries(colors).map(([key, value]) => [CSS_COLOR_VARIABLES[key], value]).filter(([key]) => key))
    }
  };
}

function getAppearance(db) {
  try {
    return sanitizeAppearance(getSetting(db, 'appearance', DEFAULT_APPEARANCE));
  } catch {
    return sanitizeAppearance(DEFAULT_APPEARANCE);
  }
}

function getThemePresets(db) {
  const stored = getSetting(db, 'theme_presets', []);
  const presets = Array.isArray(stored) ? stored : [];
  return presets.map((preset) => {
    try {
      return {
        id: slug(preset.id || preset.name || crypto.randomUUID()),
        name: cleanText(preset.name, 'Untitled theme', 80),
        description: cleanText(preset.description, '', 240),
        appearance: sanitizeAppearance(preset.appearance || {}),
        createdAt: preset.createdAt || new Date().toISOString(),
        updatedAt: preset.updatedAt || preset.createdAt || new Date().toISOString()
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
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
const APP_ASSET_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp'
};

function serviceIconDir(dataDir) {
  return path.join(dataDir, 'service-icons');
}

function appAssetDir(dataDir) {
  return path.join(dataDir, 'app-assets');
}

function detectImageMime(buffer, contentType = '') {
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

async function downloadServiceIcon(dataDir, value, actorRole = 'editor') {
  let parsed;
  try { parsed = new URL(String(value)); } catch { throw new Error('Icon URL is invalid'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Icon URL must use http or https');
  const { buffer, contentType } = await downloadImageWithLimit(parsed, SERVICE_ICON_MAX_BYTES, 'Icon', actorRole);
  return saveServiceIconBuffer(dataDir, buffer, contentType);
}

function saveServiceIconDataUrl(dataDir, dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new Error('Uploaded icon image is invalid');
  const mime = match[1].toLowerCase();
  if (!IMAGE_MIME_EXTENSIONS[mime]) throw new Error('Icon image must be JPEG, PNG, GIF, or WebP');
  return saveServiceIconBuffer(dataDir, Buffer.from(match[2], 'base64'), mime);
}

async function normalizeServiceIcon(db, req, dataDir, body, fallback = '🔗') {
  if (body.iconImageData) return saveServiceIconDataUrl(dataDir, body.iconImageData);
  const icon = String(body.icon || fallback || '🔗').trim();
  if (!icon) return '🔗';
  if (isHttpUrl(icon)) {
    try {
      return await downloadServiceIcon(dataDir, icon, body.actorRole || 'editor');
    } catch (err) {
      if (err.message.includes('resolves to a private, loopback, link-local, or reserved network address')) {
        throw err;
      }
      console.warn(`[service-icon] Could not download icon from ${icon}:`, err.message);
      logEvent(db, req, 'service.icon_download_failed', { iconUrl: icon, error: err.message }, 'warn');
      return fallback || '🔗';
    }
  }
  return icon.slice(0, 512);
}

function saveAppAssetBuffer(dataDir, buffer, contentType) {
  if (!buffer.length) throw new Error('Asset image is empty');
  if (buffer.length > APP_ASSET_MAX_BYTES) throw new Error('Asset image must be 5 MiB or smaller');
  const mime = detectImageMime(buffer, contentType);
  if (!mime) throw new Error('Asset image must be JPEG, PNG, GIF, or WebP');
  const dir = appAssetDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const filename = `${hash}.${IMAGE_MIME_EXTENSIONS[mime]}`;
  const destination = path.join(dir, filename);
  if (!fs.existsSync(destination)) fs.writeFileSync(destination, buffer);
  return `/api/app-assets/${filename}`;
}

function saveAppAssetDataUrl(dataDir, dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new Error('Uploaded asset image is invalid');
  const mime = match[1].toLowerCase();
  if (!IMAGE_MIME_EXTENSIONS[mime]) throw new Error('Asset image must be JPEG, PNG, GIF, or WebP');
  return saveAppAssetBuffer(dataDir, Buffer.from(match[2], 'base64'), mime);
}

async function downloadAppAsset(dataDir, value, actorRole = 'admin') {
  let parsed;
  try { parsed = new URL(String(value)); } catch { throw new Error('Asset URL is invalid'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Asset URL must use http or https');
  const { buffer, contentType } = await downloadImageWithLimit(parsed, APP_ASSET_MAX_BYTES, 'Asset', actorRole);
  return saveAppAssetBuffer(dataDir, buffer, contentType);
}

async function downloadImageWithLimit(url, maxBytes, label, actorRole = 'editor') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await guardedFetch(url, { signal: controller.signal, headers: { 'User-Agent': 'home-lab-launcher' } }, { actorRole, label });
    if (!response.ok) throw new Error(`Could not download ${label.toLowerCase()} image: HTTP ${response.status}`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) throw new Error(`${label} image must be 5 MiB or smaller`);
    const chunks = [];
    let total = 0;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          controller.abort();
          throw new Error(`${label} image must be 5 MiB or smaller`);
        }
        chunks.push(Buffer.from(value));
      }
      return { buffer: Buffer.concat(chunks, total), contentType: response.headers.get('content-type') || '' };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`${label} image must be 5 MiB or smaller`);
    return { buffer, contentType: response.headers.get('content-type') || '' };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`${label} image download timed out`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseTrustProxySetting() {
  const raw = String(process.env.TRUST_PROXY ?? 'false').trim();
  if (!raw || raw === 'false' || raw === '0' || raw === 'off') return { enabled: false, value: false };
  if (raw === 'true' || raw === 'on') return { enabled: true, value: true };
  if (/^\d+$/.test(raw)) return { enabled: Number(raw) > 0, value: Number(raw) };
  return { enabled: true, value: raw };
}

function configWarnings(db, { dataDir, pluginDir }) {
  const settings = publicSettings(db);
  const warnings = [];
  const nodeEnv = process.env.NODE_ENV || 'development';
  const localPluginEnabled = nodeEnv !== 'production' || process.env.ENABLE_LOCAL_PLUGIN_INSTALL === 'true';
  const trustProxy = parseTrustProxySetting();
  const sessionSecret = String(process.env.SESSION_SECRET || '').trim().toLowerCase();
  if (sessionSecret.length < 32 || ['change-this', 'changeme', 'example', 'dev-only'].some((value) => sessionSecret.includes(value))) warnings.push({ level: 'high', message: 'SESSION_SECRET is missing, too short, or still set to a default/example value.' });
  if (process.env.BOOTSTRAP_ADMIN_PASSWORD && ['admin', 'change-me-immediately', 'change-me', 'changeme', 'password', 'password123'].includes(String(process.env.BOOTSTRAP_ADMIN_PASSWORD).trim().toLowerCase())) warnings.push({ level: 'high', message: 'Bootstrap admin password still appears to be a default/example value.' });
  if (!process.env.APP_BASE_URL) warnings.push({ level: 'medium', message: 'APP_BASE_URL is not configured in the environment.' });
  if (settings.appBaseUrl && settings.appBaseUrl.startsWith('http://') && nodeEnv === 'production') warnings.push({ level: 'medium', message: 'Production is configured over plain HTTP. Use HTTPS behind a reverse proxy when possible.' });
  if (settings.appBaseUrl && settings.appBaseUrl.startsWith('https://') && !trustProxy.enabled) warnings.push({ level: 'medium', message: 'APP_BASE_URL uses HTTPS but TRUST_PROXY is disabled. Set TRUST_PROXY=loopback or TRUST_PROXY=1 when TLS terminates at a reverse proxy.' });
  if (settings.publicReadEnabled) warnings.push({ level: 'low', message: 'Anonymous read-only access is enabled. Review this before exposing the launcher publicly.' });
  if (localPluginEnabled) warnings.push({ level: nodeEnv === 'production' ? 'high' : 'low', message: 'Local plugin install is enabled. Plugins are trusted Admin-installed server-side code.' });
  const serverFetchAccess = parsePrivateNetworkAccess();
  if (nodeEnv === 'production' && serverFetchAccess.roles.has('editor')) warnings.push({ level: 'low', message: 'Editors can trigger server-side fetches to private-network URLs. Set SERVER_FETCH_PRIVATE_NETWORK_ACCESS=admin or disabled for stricter shared deployments.' });
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
      response = await guardedFetch(target, { method: 'HEAD', signal: controller.signal }, { actorRole: 'editor', label: 'Health check URL' });
      if (response.status === 405 || response.status === 403) response = await guardedFetch(target, { method: 'GET', signal: controller.signal }, { actorRole: 'editor', label: 'Health check URL' });
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

function startServiceHealthScheduler(db, scheduler) {
  const run = async () => {
    for (const service of servicesDueForHealthCheck(db)) {
      await checkServiceHealth(db, service).catch((error) => console.error(`Health check failed for ${service.id}:`, error));
    }
  };
  if (scheduler) {
    scheduler.addInterval('service-health-checks', run, { intervalMs: 60 * 1000, initialDelayMs: 5000 });
    return scheduler;
  }
  const timeout = setTimeout(run, 5000);
  const interval = setInterval(run, 60 * 1000);
  return { stop: () => { clearTimeout(timeout); clearInterval(interval); } };
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


function previewConfigBackup(db, backup) {
  if (!backup || backup.format !== 'home-lab-launcher-config-v1') throw new Error('Unsupported backup format');
  const settings = backup.settings && typeof backup.settings === 'object' ? backup.settings : {};
  const services = Array.isArray(backup.services) ? backup.services : [];
  const plugins = Array.isArray(backup.plugins) ? backup.plugins : [];
  const users = Array.isArray(backup.users) ? backup.users : [];
  const currentServiceIds = new Set(db.prepare('SELECT id FROM services').all().map((row) => row.id));
  const incomingServiceIds = new Set();
  let validServices = 0;
  let invalidServices = 0;
  let serviceConflicts = 0;
  for (const service of services) {
    const id = slug(service?.id || service?.name || '');
    if (!service?.name || !service?.url || !validateUrl(service.url) || incomingServiceIds.has(id)) {
      invalidServices += 1;
      continue;
    }
    validServices += 1;
    incomingServiceIds.add(id);
    if (currentServiceIds.has(id)) serviceConflicts += 1;
  }
  return {
    format: backup.format,
    appVersion: backup.appVersion || null,
    exportedAt: backup.exportedAt || null,
    counts: {
      settings: Object.keys(settings).length,
      services: services.length,
      validServices,
      invalidServices,
      serviceConflicts,
      servicesToAdd: [...incomingServiceIds].filter((id) => !currentServiceIds.has(id)).length,
      servicesToReplace: serviceConflicts,
      currentServices: currentServiceIds.size,
      plugins: plugins.length,
      users: users.length
    },
    warnings: [
      'Restore applies settings and services only; users, password hashes, sessions, and plugin code are not imported.',
      services.length ? 'Current services will be replaced by valid services from the backup.' : 'Backup contains no services; existing services will be left unchanged.'
    ].concat(invalidServices ? [`${invalidServices} invalid or duplicate service entries will be skipped.`] : [])
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
      forwardedProto: req.get('x-forwarded-proto') || null,
    },
    proxy: { trustProxy: parseTrustProxySetting().value },
    serverFetch: serverFetchConfig(),
    storage: { dataDir, pluginDir },
    security: {
      sessionSecretConfigured: Boolean(process.env.SESSION_SECRET && String(process.env.SESSION_SECRET).trim().length >= 32 && !['change-this', 'changeme', 'example', 'dev-only'].some((value) => String(process.env.SESSION_SECRET).toLowerCase().includes(value))),
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


const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

function loginKey(req, username) {
  return `${req.ip || 'unknown'}:${String(username || '').toLowerCase()}`;
}

function pruneExpiredLoginFailures(db) {
  db.prepare('DELETE FROM login_throttle WHERE reset_at <= ?').run(Date.now());
}

function isLoginLimited(db, req, username) {
  pruneExpiredLoginFailures(db);
  const item = db.prepare('SELECT count, reset_at AS resetAt FROM login_throttle WHERE key = ?').get(loginKey(req, username));
  return Boolean(item && item.count >= LOGIN_MAX_FAILURES);
}

function recordLoginFailure(db, req, username) {
  pruneExpiredLoginFailures(db);
  const key = loginKey(req, username);
  const resetAt = Date.now() + LOGIN_WINDOW_MS;
  const item = db.prepare('SELECT count, reset_at AS resetAt FROM login_throttle WHERE key = ?').get(key);
  if (!item) db.prepare('INSERT INTO login_throttle (key, count, reset_at) VALUES (?, 1, ?)').run(key, resetAt);
  else db.prepare('UPDATE login_throttle SET count = ?, reset_at = ? WHERE key = ?').run(Number(item.count || 0) + 1, item.resetAt > Date.now() ? item.resetAt : resetAt, key);
}

function clearLoginFailures(db, req, username) {
  db.prepare('DELETE FROM login_throttle WHERE key = ?').run(loginKey(req, username));
}

function registerCoreRoutes(app, { db, pluginManager, dataDir, pluginDir, scheduler }) {
  const router = express.Router();
  startServiceHealthScheduler(db, scheduler);

  router.use(apiResponseMiddleware);
  router.use((req, res, next) => {
    res.locals.canRead = canRead(req, db);
    if (req.session) {
      req.session.ip = req.ip;
      req.session.userAgent = req.get('user-agent') || '';
    }
    next();
  });

  router.get('/healthz', (req, res) => {
    res.json({ ok: true, version: packageJson.version, uptimeSeconds: Math.round(process.uptime()) });
  });

  registerAuthRoutes(router, { db, requireAuth, logEvent, isLoginLimited, recordLoginFailure, clearLoginFailures });

  router.get('/settings/public', (req, res) => {
    res.json(publicSettings(db));
  });

  registerAdminRoutes(router, { db, dataDir, pluginDir, requireRole, logEvent, publicSettings, settingsPayload, getAppearance, sanitizeAppearance, getThemePresets, saveAppAssetDataUrl, downloadAppAsset, slug, cleanText, THEME_PRESET_FORMAT, packageJson, fileSize, configWarnings, adminNotices, pluginManager, effectiveConfig, buildBackup, applyConfigBackup, previewConfigBackup, safeJsonParse, scheduler });

  registerServiceRoutes(router, { db, dataDir, requireRole, canRead, logEvent, allServices, serviceFromRow, serviceSelectSql, serviceIconDir, appAssetDir, slug, uniqueServiceId, normalizeServiceIcon, validateUrl, guardedFetch, healthStatusFrom, checkServiceHealth, servicePayload, normalizeTags });

  registerUserRoutes(router, { db, requireAuth, requireRole, logEvent, userPayload, preferencePayload });

  registerWeatherRoutes(router, { db, requireRole, canRead, logEvent, weatherSettingsPayload });

  registerPluginRoutes(router, { db, requireAuth, requireRole, canRead, logEvent, pluginManager, safeJsonParse, pluginInstallPayload });

  registerPresetRoutes(router, { db, dataDir, requireRole, logEvent, downloadServiceIcon, saveServiceIconBuffer, detectImageMime, IMAGE_MIME_EXTENSIONS, uniqueServiceId, slug, guardedFetch });

  startPresetCatalogScheduler(db, scheduler);

  app.use('/api', router);
  return { requireAuth, requireRole };
}

module.exports = { registerCoreRoutes, requireRole, requireAuth };
