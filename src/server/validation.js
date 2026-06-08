const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function cleanText(value, fallback = '', max = 240) {
  const cleaned = String(value ?? fallback).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  return cleaned || String(fallback || '').slice(0, max);
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const raw = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function intInRange(value, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function httpUrl(value, label = 'URL') {
  const raw = String(value || '').trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${label} must be http or https`);
  return parsed.toString();
}

function optionalHttpUrl(value, label = 'URL') {
  if (value === undefined || value === null || String(value).trim() === '') return '';
  return httpUrl(value, label);
}

function color(value, fallback = '#4de7ff') {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  if (!HEX_COLOR_RE.test(raw)) throw new Error('Color must be a hex value such as #4de7ff');
  return raw;
}

function stringList(value) {
  if (Array.isArray(value)) return value.map((item) => cleanText(item, '', 40)).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => cleanText(item, '', 40)).filter(Boolean);
  return [];
}

function slugId(value, fallback = '') {
  return cleanText(value, fallback, 80).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function servicePayload(input = {}, existing = {}) {
  const name = cleanText(input.name ?? existing.name, '', 120);
  const url = httpUrl(input.url ?? existing.url, 'Service URL');
  if (!name || !url) throw new Error('name and url are required');
  return {
    id: slugId(input.id ?? existing.id ?? name),
    name,
    icon: cleanText(input.icon ?? existing.icon, '🔗', 80),
    url,
    category: cleanText(input.category ?? existing.category, 'general', 80),
    accent: color(input.accent ?? existing.accent, '#4de7ff'),
    description: cleanText(input.description ?? existing.description, '', 500),
    tags: stringList(input.tags ?? existing.tags),
    sortOrder: intInRange(input.sortOrder ?? existing.sortOrder, { min: 0, max: 100000, fallback: 0 }),
    featured: bool(input.featured ?? existing.featured, false),
    enabled: bool(input.enabled ?? existing.enabled, true),
    healthCheckEnabled: bool(input.healthCheckEnabled ?? existing.healthCheckEnabled, false),
    healthCheckUrl: optionalHttpUrl(input.healthCheckUrl ?? existing.healthCheckUrl, 'Health check URL'),
    healthCheckIntervalMinutes: intInRange(input.healthCheckIntervalMinutes ?? existing.healthCheckIntervalMinutes, { min: 1, max: 1440, fallback: 15 })
  };
}

const ROLES = new Set(['admin', 'editor', 'user']);

function role(value, fallback = 'user') {
  return ROLES.has(value) ? value : fallback;
}

function userPayload(input = {}, existing = {}, { requirePassword = false } = {}) {
  const username = cleanText(input.username ?? existing.username, '', 80);
  const nextRole = role(input.role, existing.role || 'user');
  const password = input.password === undefined || input.password === null ? '' : String(input.password);
  if (username.length < 3) throw new Error(requirePassword ? 'Username must be 3+ chars and password 10+ chars' : 'Username must be at least 3 characters');
  if ((requirePassword || password) && password.length < 10) throw new Error(requirePassword ? 'Username must be 3+ chars and password 10+ chars' : 'Password must be at least 10 characters');
  return { username, role: nextRole, password };
}

function preferencePayload(key, value) {
  const allowed = new Set(['favorites', 'launchpad']);
  if (!allowed.has(key)) throw new Error('Unsupported preference key');
  if (key === 'favorites') {
    if (!Array.isArray(value)) throw new Error('Favorites preference must be an array');
    return value.map((item) => slugId(item, '')).filter(Boolean).slice(0, 500);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Launchpad preference must be an object');
  const out = {};
  if (Object.prototype.hasOwnProperty.call(value, 'hiddenCategories')) out.hiddenCategories = stringList(value.hiddenCategories).slice(0, 200);
  if (Object.prototype.hasOwnProperty.call(value, 'density')) out.density = ['compact', 'comfortable', 'spacious'].includes(value.density) ? value.density : 'comfortable';
  if (Object.prototype.hasOwnProperty.call(value, 'view')) out.view = ['grid', 'list'].includes(value.view) ? value.view : 'grid';
  return out;
}

function coordinate(value, label, { min, max }) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Valid ${label} is required`);
  return n;
}

function weatherSettingsPayload(input = {}) {
  const latitude = coordinate(input.latitude, 'latitude', { min: -90, max: 90 });
  const longitude = coordinate(input.longitude, 'longitude', { min: -180, max: 180 });
  return {
    label: cleanText(input.label, `${latitude}, ${longitude}`, 120),
    latitude,
    longitude,
    units: input.units === 'celsius' ? 'celsius' : 'fahrenheit',
    resolvedAt: new Date().toISOString()
  };
}

function sha256(value) {
  const raw = cleanText(value, '', 64).toLowerCase();
  if (!raw) return '';
  if (!/^[a-f0-9]{64}$/.test(raw)) throw new Error('Expected SHA-256 must be 64 hexadecimal characters');
  return raw;
}

function pluginInstallPayload(input = {}) {
  return {
    repoUrl: cleanText(input.repoUrl, '', 300),
    version: cleanText(input.version, '', 120),
    expectedSha256: sha256(input.expectedSha256),
    trustConfirmed: input.trustConfirmed === true,
    path: cleanText(input.path, '', 500)
  };
}

function settingsPayload(input = {}) {
  const out = {};
  if (Object.prototype.hasOwnProperty.call(input, 'app_name')) out.app_name = cleanText(input.app_name, 'Home Lab Launcher', 80);
  if (Object.prototype.hasOwnProperty.call(input, 'app_base_url')) out.app_base_url = input.app_base_url ? httpUrl(input.app_base_url, 'APP_BASE_URL') : '';
  if (Object.prototype.hasOwnProperty.call(input, 'public_read_enabled')) out.public_read_enabled = bool(input.public_read_enabled, false);
  if (Object.prototype.hasOwnProperty.call(input, 'scheduled_backup_location')) out.scheduled_backup_location = cleanText(input.scheduled_backup_location, '', 300);
  return out;
}

module.exports = { cleanText, bool, intInRange, httpUrl, optionalHttpUrl, color, stringList, slugId, servicePayload, settingsPayload, userPayload, preferencePayload, weatherSettingsPayload, pluginInstallPayload, HEX_COLOR_RE };
