const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const LOCAL_PRESETS = require('./presets.json');

const DEFAULT_SERVICES = [
  { id: 'ha', name: 'Home Assistant', icon: '🏠', url: 'https://ha.example.local:8123', category: 'core', accent: '#2f55e0', description: 'Primary home automation dashboard.', tags: ['automation', 'home', 'core'], sort_order: 10, featured: 1, enabled: 1 },
  { id: 'kuma', name: 'Uptime Kuma', icon: '📈', url: 'https://kuma.example.local', category: 'core', accent: '#17834e', description: 'Status dashboard and service availability history.', tags: ['status', 'monitoring'], sort_order: 20, featured: 1, enabled: 1 },
  { id: 'router', name: 'Router', icon: '📶', url: 'http://192.168.1.1', category: 'core', accent: '#0e7490', description: 'Network gateway management.', tags: ['network', 'gateway'], sort_order: 30, featured: 0, enabled: 1 },
  { id: 'media', name: 'Media Server', icon: '🎬', url: 'http://media.local', category: 'media', accent: '#7c3aed', description: 'Streaming and media library.', tags: ['media', 'streaming'], sort_order: 40, featured: 1, enabled: 1 }
];

const DEFAULT_APPEARANCE = {
  version: 1,
  brand: {
    appName: 'Home Lab Launcher',
    pageTitle: 'Home Lab Launcher',
    brandText: 'Home Lab Launcher',
    brandSubtitle: 'Home lab control plane',
    brandMarkText: 'HL',
    faviconUrl: '',
    brandIconUrl: '',
    heroImageUrl: '',
    footerNote: ''
  },
  hero: {
    enabled: true,
    eyebrow: 'Home lab operations',
    heading: 'Launch and manage your internal services.',
    subheading: 'A role-aware launcher for the tools, dashboards, and dynamic sections that make up your home lab.'
  },
  theme: {
    mode: 'light',
    fontFamily: 'system',
    customFontFamily: '',
    density: 'comfortable',
    radius: 'soft',
    colors: {}
  }
};

/* Built-in theme presets, merged once into the stored preset list at startup
   (see seed()). After that they are ordinary stored presets: admins can apply,
   duplicate, export, or delete them, and deletions stay deleted. */
const BUILTIN_THEME_PRESETS = [
  {
    id: 'daybreak',
    name: 'Daybreak',
    description: 'The default look — bright cool paper with cobalt accents.',
    appearance: { theme: { mode: 'light' } },
    createdAt: '2026-07-04T00:00:00.000Z'
  },
  {
    id: 'daybreak-night',
    name: 'Daybreak Night',
    description: 'The dark counterpart — deep blue-slate surfaces, same cobalt.',
    appearance: { theme: { mode: 'dark' } },
    createdAt: '2026-07-04T00:00:00.000Z'
  },
  {
    id: 'vaporwave',
    name: 'Vaporwave',
    description: 'Dusk violet surfaces with neon pink. Same components, different sunset.',
    appearance: {
      theme: {
        mode: 'dark',
        colors: {
          background: '#17102e',
          surface: '#201741',
          surface2: '#2a1f55',
          surface3: '#352969',
          text: '#f2ecff',
          mutedText: '#b3a6d9',
          quietText: '#9a8fc2',
          border: '#352a63',
          borderStrong: '#4d3f86',
          primary: '#ff71ce',
          primaryInk: '#33081f',
          success: '#5fe3a1',
          warning: '#ffd86b',
          danger: '#ff7b9c'
        }
      }
    },
    createdAt: '2026-07-04T00:00:00.000Z'
  }
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function openDb(dataDir) {
  ensureDir(dataDir);
  const db = new Database(path.join(dataDir, 'launcher.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seed(db);
  return db;
}

const MIGRATIONS = [
  {
    id: 1,
    name: 'initial-core-schema',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('admin', 'editor', 'user')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS services (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          icon TEXT NOT NULL DEFAULT '🔗',
          url TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'general',
          accent TEXT NOT NULL DEFAULT '#4de7ff',
          description TEXT NOT NULL DEFAULT '',
          tags_json TEXT NOT NULL DEFAULT '[]',
          sort_order INTEGER NOT NULL DEFAULT 0,
          featured INTEGER NOT NULL DEFAULT 0,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS user_preferences (
          user_id INTEGER NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (user_id, key),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS plugins (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          source_url TEXT NOT NULL,
          source_type TEXT NOT NULL DEFAULT 'github',
          version TEXT NOT NULL,
          install_path TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          manifest_json TEXT NOT NULL,
          config_json TEXT NOT NULL DEFAULT '{}',
          installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS app_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          level TEXT NOT NULL DEFAULT 'info',
          action TEXT NOT NULL,
          actor_user_id INTEGER,
          actor_username TEXT,
          ip TEXT,
          details_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs(created_at);

        CREATE TABLE IF NOT EXISTS login_throttle (
          key TEXT PRIMARY KEY,
          count INTEGER NOT NULL DEFAULT 0,
          reset_at INTEGER NOT NULL
        );
      `);
    }
  },
  {
    id: 2,
    name: 'plugin-install-metadata',
    up(db) {
      addColumnIfMissing(db, 'plugins', 'installed_hash', 'TEXT');
      addColumnIfMissing(db, 'plugins', 'lifecycle', "TEXT NOT NULL DEFAULT 'installed'");
      addColumnIfMissing(db, 'plugins', 'last_error', 'TEXT');
    }
  },
  {
    id: 3,
    name: 'service-health-checks',
    up(db) {
      addColumnIfMissing(db, 'services', 'health_check_enabled', 'INTEGER NOT NULL DEFAULT 0');
      addColumnIfMissing(db, 'services', 'health_check_url', 'TEXT');
      addColumnIfMissing(db, 'services', 'health_check_interval_minutes', 'INTEGER NOT NULL DEFAULT 15');
      db.exec(`
        CREATE TABLE IF NOT EXISTS service_health (
          service_id TEXT PRIMARY KEY,
          status TEXT NOT NULL DEFAULT 'unknown',
          status_code INTEGER,
          response_ms INTEGER,
          checked_at TEXT,
          next_check_at TEXT,
          error TEXT,
          FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
        );
      `);
    }
  },
  {
    id: 4,
    name: 'totp-authentication',
    up(db) {
      addColumnIfMissing(db, 'users', 'totp_secret', 'TEXT');
      addColumnIfMissing(db, 'users', 'totp_enabled', 'INTEGER NOT NULL DEFAULT 0');
    }
  },
  {
    id: 5,
    name: 'preset-catalog',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS preset_cache (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          website TEXT,
          description TEXT,
          category TEXT NOT NULL DEFAULT 'general',
          accent TEXT NOT NULL DEFAULT '#4de7ff',
          icon_url TEXT,
          source TEXT NOT NULL,
          cached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_preset_cache_name ON preset_cache(name);
      `);
    }
  },
  {
    id: 6,
    name: 'totp-replay-protection',
    up(db) {
      addColumnIfMissing(db, 'users', 'totp_last_counter', 'INTEGER');
    }
  },
  {
    id: 7,
    name: 'totp-recovery-codes',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS totp_recovery_codes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          code_hash TEXT NOT NULL,
          used_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_totp_recovery_codes_user ON totp_recovery_codes(user_id);
      `);
    }
  },
  {
    id: 8,
    name: 'api-tokens',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS api_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          token_prefix TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          role TEXT NOT NULL CHECK(role IN ('admin', 'editor', 'user')),
          created_by INTEGER,
          expires_at TEXT,
          last_used_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );
      `);
    }
  },
  {
    id: 9,
    name: 'service-health-history',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS service_health_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          service_id TEXT NOT NULL,
          status TEXT NOT NULL,
          status_code INTEGER,
          response_ms INTEGER,
          error TEXT,
          checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_service_health_history_service_time ON service_health_history(service_id, checked_at);
      `);
    }
  },
  {
    id: 10,
    name: 'canonical-health-check-timestamps',
    up(db) {
      // Previous releases persisted ISO timestamps while SQLite generates
      // space-separated timestamps, which breaks lexical due-date checks.
      db.prepare("UPDATE service_health SET next_check_at = replace(substr(next_check_at, 1, 19), 'T', ' ') WHERE next_check_at LIKE '%T%'").run();
    }
  }
];

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((row) => row.id));
  const tx = db.transaction(() => {
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) continue;
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)').run(migration.id, migration.name);
      db.pragma(`user_version = ${migration.id}`);
    }
  });
  tx();
}

function addColumnIfMissing(db, table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function getSetting(db, key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, JSON.stringify(value));
}

function seed(db) {
  const serviceCount = db.prepare('SELECT COUNT(*) AS count FROM services').get().count;
  if (serviceCount === 0) {
    const stmt = db.prepare(`
      INSERT INTO services (id, name, icon, url, category, accent, description, tags_json, sort_order, featured, enabled)
      VALUES (@id, @name, @icon, @url, @category, @accent, @description, @tags_json, @sort_order, @featured, @enabled)
    `);
    const tx = db.transaction(() => {
      for (const svc of DEFAULT_SERVICES) stmt.run({ ...svc, tags_json: JSON.stringify(svc.tags || []) });
    });
    tx();
  }

  const defaults = {
    app_name: process.env.APP_NAME || 'Home Lab Launcher',
    app_base_url: process.env.APP_BASE_URL || 'http://localhost:8080',
    public_read_enabled: process.env.PUBLIC_READ_ENABLED === 'true',
    log_retention_days: Number(process.env.LOG_RETENTION_DAYS || 90),
    scheduled_backup_location: process.env.SCHEDULED_BACKUP_LOCATION || ''
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (getSetting(db, key, undefined) === undefined) setSetting(db, key, value);
  }
  if (getSetting(db, 'appearance', undefined) === undefined) {
    const appName = getSetting(db, 'app_name', DEFAULT_APPEARANCE.brand.appName);
    setSetting(db, 'appearance', {
      ...DEFAULT_APPEARANCE,
      brand: {
        ...DEFAULT_APPEARANCE.brand,
        appName,
        pageTitle: appName,
        brandText: appName
      }
    });
  }
  if (getSetting(db, 'theme_presets', undefined) === undefined) setSetting(db, 'theme_presets', []);
  if (getSetting(db, 'builtin_theme_presets_seeded', undefined) === undefined) {
    const stored = getSetting(db, 'theme_presets', []);
    const existing = Array.isArray(stored) ? stored : [];
    const existingIds = new Set(existing.map((preset) => preset && preset.id));
    setSetting(db, 'theme_presets', [
      ...BUILTIN_THEME_PRESETS.filter((preset) => !existingIds.has(preset.id)),
      ...existing
    ]);
    setSetting(db, 'builtin_theme_presets_seeded', 1);
  }

  seedPresets(db);

  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount === 0 && process.env.BOOTSTRAP_ADMIN_USERNAME && process.env.BOOTSTRAP_ADMIN_PASSWORD) {
    const hash = bcrypt.hashSync(process.env.BOOTSTRAP_ADMIN_PASSWORD, 12);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(process.env.BOOTSTRAP_ADMIN_USERNAME, hash, 'admin');
  }
}

function seedPresets(db) {
  const stmt = db.prepare(`
    INSERT INTO preset_cache (id, name, website, description, category, accent, icon_url, source)
    VALUES (@id, @name, @website, @description, @category, @accent, @icon_url, @source)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      website = excluded.website,
      description = excluded.description,
      category = excluded.category,
      accent = excluded.accent,
      icon_url = excluded.icon_url,
      cached_at = CURRENT_TIMESTAMP
    WHERE preset_cache.source = 'local' AND excluded.source = 'local'
  `);
  const tx = db.transaction(() => {
    for (const preset of LOCAL_PRESETS) {
      stmt.run({
        id: preset.id,
        name: preset.name,
        website: preset.website || '',
        description: preset.description || '',
        category: preset.category || 'general',
        accent: preset.accent || '#4de7ff',
        icon_url: preset.icon || null,
        source: 'local'
      });
    }
  });
  tx();
}

module.exports = { openDb, getSetting, setSetting, DEFAULT_APPEARANCE, BUILTIN_THEME_PRESETS };
