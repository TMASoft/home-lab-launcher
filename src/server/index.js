require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const { BetterSqliteSessionStore } = require('./session-store');
const { openDb, getSetting } = require('./db');
const { registerCoreRoutes } = require('./routes');
const { PluginManager } = require('./plugins');
const { securityHeaders, csrfProtection } = require('./security');

const app = express();
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const pluginDir = process.env.PLUGIN_DIR || path.join(dataDir, 'plugins');
const db = openDb(dataDir);

app.set('trust proxy', 1);
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
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.includes('change-this') || process.env.SESSION_SECRET.includes('dev-only')) warnings.push('SESSION_SECRET is missing or still set to a default value.');
  if (process.env.BOOTSTRAP_ADMIN_PASSWORD && ['change-me-immediately', 'change-me', 'password'].includes(process.env.BOOTSTRAP_ADMIN_PASSWORD)) warnings.push('Bootstrap admin password still appears to be a default value.');
  if (!process.env.APP_BASE_URL) warnings.push('APP_BASE_URL is not configured in the environment.');
  if (nodeEnv === 'production' && appBaseUrl && appBaseUrl.startsWith('http://')) warnings.push('Production is configured over plain HTTP. Use HTTPS behind a reverse proxy when possible.');
  if (publicReadEnabled) warnings.push('Anonymous read-only public access is enabled.');
  if (nodeEnv !== 'production' || process.env.ENABLE_LOCAL_PLUGIN_INSTALL === 'true') warnings.push('Local plugin install is enabled; plugins are trusted Admin-installed server-side code.');
  return warnings;
}

app.listen(port, host, () => {
  console.log(`Home Lab Launcher listening on http://${host}:${port}`);
  for (const warning of startupWarnings()) console.warn(`[beta-readiness] ${warning}`);
});
