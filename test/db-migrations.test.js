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
    const userColumns = upgraded.prepare('PRAGMA table_info(users)').all().map((row) => row.name);
    assert.ok(userColumns.includes('totp_secret'));
    assert.ok(userColumns.includes('totp_enabled'));
    const presetCacheColumns = upgraded.prepare('PRAGMA table_info(preset_cache)').all().map((row) => row.name);
    assert.ok(presetCacheColumns.includes('id'));
    assert.ok(presetCacheColumns.includes('name'));
    assert.ok(presetCacheColumns.includes('icon_url'));
    assert.ok(presetCacheColumns.includes('source'));
    assert.equal(upgraded.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE id IN (1, 2, 3, 4, 5)").get().count, 5);
    assert.equal(upgraded.pragma('user_version', { simple: true }), 5);
    upgraded.close();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('openDb refreshes bundled local preset metadata on existing databases', () => {
  const dataDir = tempDir();
  let db;
  try {
    db = openDb(dataDir);
    db.prepare("UPDATE preset_cache SET icon_url = ? WHERE id = ? AND source = 'local'").run('https://example.invalid/old-qbit-logo.png', 'qbittorrent');
    db.close();

    db = openDb(dataDir);
    const preset = db.prepare("SELECT icon_url FROM preset_cache WHERE id = ? AND source = 'local'").get('qbittorrent');
    assert.ok(preset);
    assert.match(preset.icon_url, /\/qBittorrent\/qbittorrent\.svg$/);
    db.close();
  } finally {
    try { db?.close(); } catch {}
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
