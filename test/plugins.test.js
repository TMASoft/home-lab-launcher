const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PluginManager, parseGithubRepo } = require('../src/server/plugins');

test('parseGithubRepo supports repository roots and plugin subdirectory tree URLs', () => {
  assert.deepEqual(parseGithubRepo('owner/repo'), {
    owner: 'owner',
    repo: 'repo',
    pluginPath: '',
    sourceUrl: 'https://github.com/owner/repo'
  });

  assert.deepEqual(parseGithubRepo('https://github.com/TMASoft/home-lab-launcher-plugins/tree/main/uptime-kuma'), {
    owner: 'TMASoft',
    repo: 'home-lab-launcher-plugins',
    pluginPath: 'uptime-kuma',
    treeRef: 'main',
    sourceUrl: 'https://github.com/TMASoft/home-lab-launcher-plugins/tree/main/uptime-kuma'
  });
});

test('parseGithubRepo rejects unsupported GitHub subdirectory URLs', () => {
  assert.throws(
    () => parseGithubRepo('https://github.com/owner/repo/uptime-kuma'),
    /subdirectories must use a \/tree\/<branch>\/<path> URL/
  );
});

test('discoverGithubVersions falls back to explicit tree branch for subdirectory plugins', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  global.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith('/releases')) return { ok: true, json: async () => [] };
    if (value.includes('/tags?')) return { ok: true, json: async () => [] };
    if (value.endsWith('/branches/main')) return { ok: true, json: async () => ({ name: 'main' }) };
    return { ok: false, json: async () => ({}) };
  };

  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hll-plugin-test-'));
  const manager = new PluginManager({ app: {}, db: {}, pluginDir });
  const versions = await manager.discoverGithubVersions('https://github.com/TMASoft/home-lab-launcher-plugins/tree/main/uptime-kuma');

  assert.equal(versions.length, 1);
  assert.equal(versions[0].version, 'main');
  assert.equal(versions[0].type, 'branch');
});

test('redactPluginConfigForRole hides admin-scoped and undeclared fields from non-admin roles', () => {
  const { redactPluginConfigForRole } = require('../src/server/plugins');
  const manifest = {
    configSchema: {
      apiToken: { type: 'string', scope: 'admin' },
      url: { type: 'string', scope: 'admin' },
      sectionTitle: { type: 'string', scope: 'editor' },
      showCategories: { type: 'boolean', scope: 'user' }
    }
  };
  const config = {
    apiToken: 'super-secret-token',
    url: 'http://miniflux.internal:8080',
    sectionTitle: 'My Feeds',
    showCategories: true,
    legacyUndeclaredField: 'admin-only-by-default'
  };

  assert.deepEqual(redactPluginConfigForRole(manifest, config, 'admin'), config);
  assert.deepEqual(redactPluginConfigForRole(manifest, config, 'editor'), { sectionTitle: 'My Feeds', showCategories: true });
  assert.deepEqual(redactPluginConfigForRole(manifest, config, 'user'), { showCategories: true });
  assert.deepEqual(redactPluginConfigForRole({}, config, 'user'), {});
  assert.deepEqual(redactPluginConfigForRole(manifest, null, 'admin'), {});
});

test('cleanupSupersededInstalls removes unreferenced install dirs and orphaned tarballs', () => {
  const { openDb } = require('../src/server/db');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hll-plugin-cleanup-'));
  try {
    const db = openDb(dataDir);
    const pluginDir = path.join(dataDir, 'plugins');
    const manager = new PluginManager({ app: { use() {} }, db, pluginDir });

    const activeDir = path.join(pluginDir, 'owner-repo-v2.0.0');
    const staleDir = path.join(pluginDir, 'owner-repo-v1.0.0');
    const nestedActiveExtract = path.join(pluginDir, 'owner-monorepo-v1.0.0');
    fs.mkdirSync(activeDir, { recursive: true });
    fs.mkdirSync(staleDir, { recursive: true });
    fs.mkdirSync(path.join(nestedActiveExtract, 'subdir'), { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'owner-repo-v2.0.0.tgz'), 'leftover');

    const insert = db.prepare(`
      INSERT INTO plugins (id, name, source_url, source_type, version, install_path, enabled, manifest_json, config_json, installed_hash, lifecycle, last_error)
      VALUES (?, ?, 'https://github.com/o/r', 'github', ?, ?, 1, '{}', '{}', 'hash', 'enabled', NULL)
    `);
    insert.run('active-plugin', 'Active', 'v2.0.0', activeDir);
    // install_path pointing at a subdirectory keeps the whole extract alive
    insert.run('nested-plugin', 'Nested', 'v1.0.0', path.join(nestedActiveExtract, 'subdir'));

    const removed = manager.cleanupSupersededInstalls().sort();
    assert.deepEqual(removed, ['owner-repo-v1.0.0', 'owner-repo-v2.0.0.tgz']);
    assert.ok(fs.existsSync(activeDir));
    assert.ok(fs.existsSync(path.join(nestedActiveExtract, 'subdir')));
    assert.ok(!fs.existsSync(staleDir));
    assert.ok(!fs.existsSync(path.join(pluginDir, 'owner-repo-v2.0.0.tgz')));
    db.close();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
