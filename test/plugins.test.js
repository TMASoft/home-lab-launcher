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
