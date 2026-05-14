require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const { BetterSqliteSessionStore } = require('./session-store');
const { openDb } = require('./db');
const { registerCoreRoutes } = require('./routes');
const { PluginManager } = require('./plugins');
const { securityHeaders, csrfProtection } = require('./security');

const app = express();
const port = Number(process.env.PORT || 8080);
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

app.listen(port, () => {
  console.log(`Home Lab Launcher listening on http://0.0.0.0:${port}`);
});
