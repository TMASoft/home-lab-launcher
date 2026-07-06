const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, Client } = require('./helpers');

const CATALOG_FORMAT = 'home-lab-launcher-plugin-catalog-v1';

function catalogFixture() {
  return {
    format: CATALOG_FORMAT,
    updatedAt: '2026-07-06',
    plugins: [
      {
        id: 'hll-weather',
        name: 'HLL Weather',
        description: 'Weather dashboard section.',
        repo: 'https://github.com/TMASoft/hll-weather',
        homepage: 'https://github.com/TMASoft/hll-weather#readme',
        trust: 'official',
        launcherApiVersion: 1,
        latestVersion: 'v0.3.0',
        permissions: ['routes', 'storage', 'jobs', 'dashboard-section'],
        tags: ['weather'],
        sha256: { 'v0.3.0': 'a'.repeat(64), 'v0.2.0': 'not-a-hash' }
      },
      {
        id: 'future-plugin',
        name: 'Future Plugin',
        description: 'Needs a newer launcher.',
        repo: 'TMASoft/hll-future',
        launcherApiVersion: 99
      }
    ]
  };
}

test('normalizeCatalog validates entries and collects warnings for bad ones', () => {
  const { normalizeCatalog, PLUGIN_CATALOG_FORMAT } = require('../src/server/plugin-catalog');
  assert.equal(PLUGIN_CATALOG_FORMAT, CATALOG_FORMAT);

  assert.throws(() => normalizeCatalog({ format: 'nope', plugins: [] }), /format must be/);
  assert.throws(() => normalizeCatalog({ format: CATALOG_FORMAT }), /plugins array/);

  const { entries, warnings } = normalizeCatalog({
    format: CATALOG_FORMAT,
    plugins: [
      ...catalogFixture().plugins,
      { id: 'bad id!', name: 'Bad', repo: 'TMASoft/x' },
      { id: 'no-name', repo: 'TMASoft/x' },
      { id: 'bad-repo', name: 'Bad repo', repo: 'https://gitlab.com/owner/repo' },
      { id: 'hll-weather', name: 'Duplicate', repo: 'TMASoft/dup' }
    ]
  });

  assert.deepEqual(entries.map((entry) => entry.id), ['hll-weather', 'future-plugin']);
  assert.equal(warnings.length, 4);

  const weather = entries[0];
  assert.equal(weather.repo, 'https://github.com/TMASoft/hll-weather');
  assert.equal(weather.trust, 'official');
  // invalid hash values are dropped, valid ones kept
  assert.deepEqual(weather.sha256, { 'v0.3.0': 'a'.repeat(64) });
  // shorthand repo is canonicalized, trust defaults to community
  assert.equal(entries[1].repo, 'https://github.com/TMASoft/hll-future');
  assert.equal(entries[1].trust, 'community');
});

test('annotateCatalogEntries flags compatibility and installed plugins', () => {
  const { normalizeCatalog, annotateCatalogEntries } = require('../src/server/plugin-catalog');
  const { entries } = normalizeCatalog(catalogFixture());
  const installed = [
    { id: 'hll-weather', version: 'v0.2.0', enabled: true, lifecycle: 'enabled', sourceType: 'github', sourceUrl: 'https://github.com/TMASoft/hll-weather' }
  ];
  const annotated = annotateCatalogEntries(entries, installed);

  const weather = annotated.find((entry) => entry.id === 'hll-weather');
  assert.equal(weather.compatibility.compatible, true);
  assert.equal(weather.installed.version, 'v0.2.0');
  assert.equal(weather.installed.updateHint, true, 'catalog latestVersion v0.3.0 is newer than installed v0.2.0');

  const future = annotated.find((entry) => entry.id === 'future-plugin');
  assert.equal(future.compatibility.compatible, false);
  assert.match(future.compatibility.error, /requires launcher API 99/);
  assert.equal(future.installed, null);

  // repo-URL fallback matching when the manifest id differs from the catalog id
  const byRepo = annotateCatalogEntries(entries, [{ id: 'renamed', version: 'v0.3.0', enabled: true, lifecycle: 'enabled', sourceType: 'github', sourceUrl: 'https://github.com/TMASoft/hll-weather' }]);
  assert.equal(byRepo.find((entry) => entry.id === 'hll-weather').installed.id, 'renamed');
});

test('plugin catalog API: fetch, cache, role access, audit logging, and failure resilience', async (t) => {
  let catalogRequests = 0;
  const mockServer = http.createServer((req, res) => {
    if (req.url === '/catalog.json') {
      catalogRequests += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(catalogFixture()));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const mockPort = mockServer.address().port;
  t.after(() => mockServer.close());

  const server = startServer({
    port: 19121,
    env: {
      PLUGIN_CATALOG_URL: `http://127.0.0.1:${mockPort}/catalog.json`,
      SERVER_FETCH_PRIVATE_NETWORK_ACCESS: 'admin'
    }
  });
  await server.ready();
  t.after(() => server.stop());

  const admin = new Client(server.baseUrl);
  await admin.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change' } });

  // Admin can browse the catalog with annotations
  const first = await admin.request('/api/plugin-catalog');
  assert.equal(first.catalog.error, null);
  assert.equal(first.catalog.stale, false);
  assert.equal(first.catalog.entries.length, 2);
  const weather = first.catalog.entries.find((entry) => entry.id === 'hll-weather');
  assert.equal(weather.trust, 'official');
  assert.deepEqual(weather.permissions, ['routes', 'storage', 'jobs', 'dashboard-section']);
  assert.equal(weather.compatibility.compatible, true);
  assert.equal(weather.installed, null);
  const future = first.catalog.entries.find((entry) => entry.id === 'future-plugin');
  assert.equal(future.compatibility.compatible, false);
  assert.equal(catalogRequests, 1);

  // Second request is served from cache, no new remote fetch
  await admin.request('/api/plugin-catalog');
  assert.equal(catalogRequests, 1);

  // refresh=1 forces a remote fetch
  await admin.request('/api/plugin-catalog?refresh=1');
  assert.equal(catalogRequests, 2);

  // Remote fetches are audit-logged
  const logs = await admin.request('/api/admin/logs?action=plugin_catalog');
  const fetchLogs = logs.logs.filter((row) => row.action === 'plugin_catalog.fetched');
  assert.equal(fetchLogs.length, 2);
  assert.equal(fetchLogs[0].details.entries, 2);

  // Role access: anonymous and editor are rejected
  const anon = new Client(server.baseUrl);
  await assert.rejects(() => anon.request('/api/plugin-catalog'), /Authentication required/);
  await admin.request('/api/users', { method: 'POST', body: { username: 'editor-user', password: 'test-editor-password', role: 'editor' } });
  const editor = new Client(server.baseUrl);
  await editor.request('/api/auth/login', { method: 'POST', body: { username: 'editor-user', password: 'test-editor-password' } });
  await assert.rejects(() => editor.request('/api/plugin-catalog'), /Insufficient permissions/);

  // Catalog source going away: refresh serves the stale cache and keeps /api/plugins working
  await new Promise((resolve) => mockServer.close(resolve));
  const staleResult = await admin.request('/api/plugin-catalog?refresh=1');
  assert.equal(staleResult.catalog.stale, true);
  assert.ok(staleResult.catalog.error);
  assert.equal(staleResult.catalog.entries.length, 2, 'cached entries survive a fetch failure');
  const plugins = await admin.request('/api/plugins');
  assert.deepEqual(plugins.plugins, []);
  const failLogs = await admin.request('/api/admin/logs?action=plugin_catalog.fetch_failed');
  assert.ok(failLogs.logs.length >= 1);
});

test('plugin catalog API: unreachable catalog with no cache returns empty entries, not an error status', async (t) => {
  const server = startServer({
    port: 19122,
    env: {
      PLUGIN_CATALOG_URL: 'http://127.0.0.1:9/catalog.json',
      SERVER_FETCH_PRIVATE_NETWORK_ACCESS: 'admin'
    }
  });
  await server.ready();
  t.after(() => server.stop());

  const admin = new Client(server.baseUrl);
  await admin.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change' } });
  const result = await admin.request('/api/plugin-catalog');
  assert.ok(result.catalog.error);
  assert.equal(result.catalog.stale, false);
  assert.deepEqual(result.catalog.entries, []);
  const plugins = await admin.request('/api/plugins');
  assert.deepEqual(plugins.plugins, []);
});

test('installFromGithub pins a catalog version and enforces the catalog sha256', async (t) => {
  const tar = require('tar');
  const { PluginManager } = require('../src/server/plugins');
  const { openDb } = require('../src/server/db');
  const crypto = require('node:crypto');

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hll-catalog-install-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  // Build a plugin tarball the way GitHub serves them (single top-level directory)
  const stageDir = path.join(dataDir, 'stage', 'TMASoft-hll-weather-abc123');
  fs.mkdirSync(stageDir, { recursive: true });
  fs.writeFileSync(path.join(stageDir, 'plugin.json'), JSON.stringify({ id: 'hll-weather', name: 'HLL Weather', version: '0.3.0', launcherApiVersion: 1 }));
  const tarballPath = path.join(dataDir, 'release.tgz');
  await tar.c({ gzip: true, file: tarballPath, cwd: path.join(dataDir, 'stage') }, ['TMASoft-hll-weather-abc123']);
  const tarball = fs.readFileSync(tarballPath);
  const tarballSha256 = crypto.createHash('sha256').update(tarball).digest('hex');

  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url) => {
    assert.match(String(url), /api\.github\.com\/repos\/TMASoft\/hll-weather\/tarball\/v0\.3\.0/);
    return {
      ok: true,
      headers: { get: () => String(tarball.length) },
      arrayBuffer: async () => tarball.buffer.slice(tarball.byteOffset, tarball.byteOffset + tarball.byteLength)
    };
  };

  const db = openDb(dataDir);
  t.after(() => db.close());
  const manager = new PluginManager({ app: { use() {} }, db, pluginDir: path.join(dataDir, 'plugins') });

  // Catalog-provided sha256 mismatch fails before extraction
  await assert.rejects(
    () => manager.installFromGithub('https://github.com/TMASoft/hll-weather', 'v0.3.0', { expectedSha256: 'b'.repeat(64) }),
    /SHA-256 mismatch/
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plugins').get().count, 0);

  // Matching hash installs and records the installed hash
  const plugin = await manager.installFromGithub('https://github.com/TMASoft/hll-weather', 'v0.3.0', { expectedSha256: tarballSha256 });
  assert.equal(plugin.id, 'hll-weather');
  assert.equal(plugin.installedHash, tarballSha256);
  const row = db.prepare('SELECT * FROM plugins WHERE id = ?').get('hll-weather');
  assert.equal(row.version, 'v0.3.0');
  assert.equal(row.source_url, 'https://github.com/TMASoft/hll-weather');
  assert.equal(row.installed_hash, tarballSha256);
});

test('shipped catalog.json format documentation matches the parser', () => {
  // Guards the format contract documented in docs/plugins.md
  const { normalizeCatalog } = require('../src/server/plugin-catalog');
  const sample = {
    format: CATALOG_FORMAT,
    updatedAt: '2026-07-06',
    plugins: [{
      id: 'example',
      name: 'Example',
      description: 'Example plugin.',
      repo: 'owner/example',
      homepage: 'https://example.com/docs',
      trust: 'community',
      launcherApiVersion: 1,
      latestVersion: 'v1.0.0',
      permissions: ['routes'],
      tags: ['example'],
      sha256: { 'v1.0.0': 'c'.repeat(64) }
    }]
  };
  const { entries, warnings } = normalizeCatalog(sample);
  assert.equal(warnings.length, 0);
  assert.equal(entries[0].homepage, 'https://example.com/docs');
});
