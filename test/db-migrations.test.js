const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { tempDir } = require('./helpers');
const { openDb } = require('../src/server/db');

test('openDb upgrades a pre-migration schema and records versions', () => {
  const dataDir = tempDir();
  try {
    const dbPath = path.join(dataDir, 'launcher.sqlite');
    const old = new Database(dbPath);
    old.exec(`
      CREATE TABLE services (
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
      CREATE TABLE plugins (
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
    `);
    old.close();

    const upgraded = openDb(dataDir);
    const serviceColumns = upgraded.prepare('PRAGMA table_info(services)').all().map((row) => row.name);
    assert.ok(serviceColumns.includes('health_check_enabled'));
    assert.ok(serviceColumns.includes('health_check_url'));
    assert.ok(serviceColumns.includes('health_check_interval_minutes'));
    const pluginColumns = upgraded.prepare('PRAGMA table_info(plugins)').all().map((row) => row.name);
    assert.ok(pluginColumns.includes('installed_hash'));
    assert.ok(pluginColumns.includes('lifecycle'));
    assert.ok(pluginColumns.includes('last_error'));
    assert.equal(upgraded.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE id IN (1, 2, 3)").get().count, 3);
    assert.equal(upgraded.pragma('user_version', { simple: true }), 3);
    upgraded.close();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
