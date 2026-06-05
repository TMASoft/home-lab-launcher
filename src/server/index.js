require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const { BetterSqliteSessionStore } = require('./session-store');
const { openDb, getSetting } = require('./db');
const { registerCoreRoutes } = require('./routes');
const { PluginManager } = require('./plugins');
const { securityHeaders, csrfProtection } = require('./security');
const { parsePrivateNetworkAccess } = require('./server-fetch');


const UNSAFE_SESSION_SECRET_PATTERNS = [
  'change-this',
  'changeme',
  'example',
  'dev-only'
];
const UNSAFE_BOOTSTRAP_PASSWORDS = new Set([
  'admin',
  'change-me',
  'change-me-immediately',
  'changeme',
  'password',
  'password123'
]);

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function sessionSecretIsSafe(value) {
  const secret = String(value || '').trim();
  if (secret.length < 32) return false;
  const lower = secret.toLowerCase();
  return !UNSAFE_SESSION_SECRET_PATTERNS.some((pattern) => lower.includes(pattern));
}

function bootstrapPasswordIsUnsafe(value) {
  if (!value) return false;
  return UNSAFE_BOOTSTRAP_PASSWORDS.has(String(value).trim().toLowerCase());
}

function validateStartupEnvironment() {
  const errors = [];
  if (isProduction() && !sessionSecretIsSafe(process.env.SESSION_SECRET)) {
    errors.push('SESSION_SECRET must be set to a unique random value of at least 32 characters in production.');
  }
  if (process.env.BOOTSTRAP_ADMIN_PASSWORD && bootstrapPasswordIsUnsafe(process.env.BOOTSTRAP_ADMIN_PASSWORD)) {
    errors.push('BOOTSTRAP_ADMIN_PASSWORD is set to a known default/example value; leave bootstrap credentials empty for browser setup or use a unique temporary password.');
  }
  return errors;
}

const startupErrors = validateStartupEnvironment();
if (startupErrors.length > 0) {
  for (const error of startupErrors) console.error(`[startup] ${error}`);
  process.exit(1);
}

const app = express();
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const pluginDir = process.env.PLUGIN_DIR || path.join(dataDir, 'plugins');
const db = openDb(dataDir);

function parseTrustProxy(value) {
  const raw = String(value ?? 'false').trim();
  if (!raw || raw === 'false' || raw === '0' || raw === 'off') return false;
  if (raw === 'true' || raw === 'on') return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
app.set('trust proxy', trustProxy);
app.use(securityHeaders);
app.use(session({
  store: new BetterSqliteSessionStore(db),
  secret: process.env.SESSION_SECRET || 'dev-only-change-this-session-secret',
  name: 'hll.sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.APP_BASE_URL?.startsWith('https://') || false,
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
}));
app.use(csrfProtection);

const pluginManager = new PluginManager({ app, db, pluginDir });
registerCoreRoutes(app, { db, pluginManager, dataDir, pluginDir });

pluginManager.reload().catch((error) => {
  console.error('Plugin reload failed:', error);
});

app.use(express.static(path.join(__dirname, '../public')));
app.get(/^\/(?!api\/|plugins\/).*/, (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

function startupWarnings() {
  const warnings = [];
  const nodeEnv = process.env.NODE_ENV || 'development';
  const appBaseUrl = process.env.APP_BASE_URL || getSetting(db, 'app_base_url', '');
  const publicReadEnabled = getSetting(db, 'public_read_enabled', true);
  if (!sessionSecretIsSafe(process.env.SESSION_SECRET)) warnings.push('SESSION_SECRET is missing, too short, or still set to a default/example value.');
  if (bootstrapPasswordIsUnsafe(process.env.BOOTSTRAP_ADMIN_PASSWORD)) warnings.push('Bootstrap admin password still appears to be a default/example value.');
  if (!process.env.APP_BASE_URL) warnings.push('APP_BASE_URL is not configured in the environment.');
  if (nodeEnv === 'production' && appBaseUrl && appBaseUrl.startsWith('http://')) warnings.push('Production is configured over plain HTTP. Use HTTPS behind a reverse proxy when possible.');
  if (appBaseUrl && appBaseUrl.startsWith('https://') && !trustProxy) warnings.push('APP_BASE_URL uses HTTPS but TRUST_PROXY is disabled; enable TRUST_PROXY=loopback or TRUST_PROXY=1 when TLS terminates at a reverse proxy.');
  if (publicReadEnabled) warnings.push('Anonymous read-only public access is enabled.');
  if (nodeEnv !== 'production' || process.env.ENABLE_LOCAL_PLUGIN_INSTALL === 'true') warnings.push('Local plugin install is enabled; plugins are trusted Admin-installed server-side code.');
  if (nodeEnv === 'production' && parsePrivateNetworkAccess().roles.has('editor')) warnings.push('Editors can trigger server-side fetches to private-network URLs; set SERVER_FETCH_PRIVATE_NETWORK_ACCESS=admin or disabled for stricter shared deployments.');
  return warnings;
}

app.listen(port, host, () => {
  console.log(`Home Lab Launcher listening on http://${host}:${port}`);
  console.log(`Trust proxy setting: ${JSON.stringify(trustProxy)}`);
  for (const warning of startupWarnings()) console.warn(`[beta-readiness] ${warning}`);
});
