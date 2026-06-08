const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, Client } = require('./helpers');

test('Preset Catalog API & Logic', async (t) => {
  // 0. Spin up a mock Heimdall API server to test local crawls offline
  const mockServer = http.createServer((req, res) => {
    const url = req.url;
    if (url === '/contents') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([
        { name: 'mockapp', type: 'dir' }
      ]));
    } else if (url === '/mockapp/app.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'MockApp',
        description: 'A mock application',
        colour: '#123456',
        website: 'http://mockapp.local',
        category: 'testing'
      }));
    } else if (url === '/mockapp/logo.png') {
      const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(onePixelPng);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const mockPort = mockServer.address().port;
  t.after(() => mockServer.close());

  const server = startServer({
    port: 19119,
    env: {
      HEIMDALL_CONTENTS_URL: `http://127.0.0.1:${mockPort}/contents`,
      HEIMDALL_RAW_PREFIX: `http://127.0.0.1:${mockPort}/`,
      SERVER_FETCH_PRIVATE_NETWORK_ACCESS: 'admin' // Allow loopback fetches from mock server
    }
  });
  await server.ready();
  t.after(() => server.stop());

  // 1. Setup client & Authenticate as Admin
  const admin = new Client(server.baseUrl);
  const login = await admin.request('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'test-admin-password-please-change' }
  });
  assert.equal(login.user.role, 'admin');

  // 2. Fetch preset catalog settings
  const settings = await admin.request('/api/admin/presets/settings');
  assert.equal(settings.enableRemotePresets, true);
  assert.equal(settings.counts.local > 0, true);
  assert.ok(settings.syncStatus);
  assert.equal(settings.syncStatus.status, 'idle');

  // 3. Search presets (pi-hole)
  const search1 = await admin.request('/api/admin/presets/search?q=pi-hole');
  assert.ok(search1.presets.length > 0);
  const piHolePreset = search1.presets.find(p => p.id === 'pi-hole');
  assert.ok(piHolePreset);
  assert.equal(piHolePreset.name, 'Pi-hole');
  assert.equal(piHolePreset.source, 'local');

  // 4. Update preset settings (disable remote presets)
  await admin.request('/api/admin/presets/settings', {
    method: 'PUT',
    body: { enableRemotePresets: false }
  });
  const settingsAfter = await admin.request('/api/admin/presets/settings');
  assert.equal(settingsAfter.enableRemotePresets, false);

  // 5. Update catalog manual trigger (test throttling & async start)
  await admin.request('/api/admin/presets/settings', {
    method: 'PUT',
    body: { enableRemotePresets: true } // re-enable to allow manual sync check
  });
  const updateRes = await admin.request('/api/admin/presets/update', { method: 'POST' });
  assert.equal(updateRes.ok, true);
  assert.equal(updateRes.message, 'Sync started');

  // Check that the status is set to running immediately
  const settingsDuring = await admin.request('/api/admin/presets/settings');
  assert.equal(settingsDuring.syncStatus.status, 'running');
  assert.ok(settingsDuring.syncStatus.startedAt);
  assert.equal(settingsDuring.syncStatus.completedAt, null);

  // Immediate subsequent update should be throttled (returns 429)
  await assert.rejects(
    () => admin.request('/api/admin/presets/update', { method: 'POST' }),
    (err) => {
      assert.equal(err.status, 429);
      assert.match(err.message, /Please wait at least 60 seconds/);
      return true;
    }
  );

  // Wait/poll for completion (fetch timeout can be up to 15s)
  let finalStatus = null;
  for (let i = 0; i < 100; i++) {
    const statusSettings = await admin.request('/api/admin/presets/settings');
    if (statusSettings.syncStatus.status !== 'running') {
      finalStatus = statusSettings.syncStatus;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(finalStatus);
  assert.equal(finalStatus.status, 'succeeded');
  assert.equal(finalStatus.synced, 1);
  assert.ok(finalStatus.completedAt);
  assert.equal(finalStatus.error, null);

  // 5b. Search for the crawled Heimdall preset
  const searchMock = await admin.request('/api/admin/presets/search?q=mockapp');
  assert.ok(searchMock.presets.length > 0);
  const mockPreset = searchMock.presets.find(p => p.id === 'heimdall-mockapp');
  assert.ok(mockPreset);
  assert.equal(mockPreset.name, 'MockApp');
  assert.equal(mockPreset.source, 'heimdall');
  assert.equal(mockPreset.accent, '#123456');

  // 5c. Import the crawled Heimdall preset
  const importMockRes = await admin.request('/api/admin/presets/import', {
    method: 'POST',
    body: { presetId: 'heimdall-mockapp', customUrl: 'http://my-mock.local:8082' }
  });
  assert.equal(importMockRes.ok, true);

  const servicesResMock = await admin.request('/api/services');
  const mockSvc = servicesResMock.services.find(s => s.id === importMockRes.serviceId);
  assert.ok(mockSvc);
  assert.equal(mockSvc.name, 'MockApp');
  assert.equal(mockSvc.url, 'http://my-mock.local:8082');
  assert.equal(mockSvc.category, 'testing');
  assert.equal(mockSvc.accent, '#123456');
  assert.equal(mockSvc.description, 'A mock application');

  // 6. Import a preset (e.g. lidarr)
  const importRes = await admin.request('/api/admin/presets/import', {
    method: 'POST',
    body: { presetId: 'lidarr', customUrl: 'http://lidarr.local:8686' }
  });
  assert.equal(importRes.ok, true);
  assert.ok(importRes.serviceId);

  // Check that the imported service is in the services list
  const servicesRes = await admin.request('/api/services');
  const importedSvc = servicesRes.services.find(s => s.id === importRes.serviceId);
  assert.ok(importedSvc);
  assert.equal(importedSvc.name, 'Lidarr');
  assert.equal(importedSvc.url, 'http://lidarr.local:8686');
  assert.equal(importedSvc.category, 'media');
  assert.equal(importedSvc.accent, '#1db954');
  // 6b. Import a preset with an invalid/malicious icon URL (must catch error and fallback to default '🔗' icon)
  const Database = require('better-sqlite3');
  const path = require('path');
  const db = new Database(path.join(server.dataDir, 'launcher.sqlite'));
  db.prepare(`
    INSERT INTO preset_cache (id, name, website, description, category, accent, icon_url, source)
    VALUES ('test-bad-icon', 'Test Bad Icon', 'https://example.com', 'Description', 'general', '#ffffff', 'https://malicious.com/logo.png', 'local')
  `).run();
  db.close();

  const importBadIconRes = await admin.request('/api/admin/presets/import', {
    method: 'POST',
    body: { presetId: 'test-bad-icon' }
  });
  assert.equal(importBadIconRes.ok, true);

  const servicesRes2 = await admin.request('/api/services');
  const badIconSvc = servicesRes2.services.find(s => s.id === importBadIconRes.serviceId);
  assert.ok(badIconSvc);
  assert.equal(badIconSvc.icon, '🔗'); // Fallback applied due to URL validation failure

  // 7. Role Restrictions check (anonymous)
  const anon = new Client(server.baseUrl);
  await assert.rejects(() => anon.request('/api/admin/presets/settings'), /Authentication required/);
  await assert.rejects(() => anon.request('/api/admin/presets/search?q=pi-hole'), /Authentication required/);
  await assert.rejects(() => anon.request('/api/admin/presets/import', { method: 'POST', body: { presetId: 'lidarr' } }), /Authentication required|Invalid CSRF token/);
  await assert.rejects(() => anon.request('/api/admin/presets/update', { method: 'POST' }), /Authentication required|Invalid CSRF token/);

  // Editor role checks
  const editor = new Client(server.baseUrl);
  await admin.request('/api/users', {
    method: 'POST',
    body: { username: 'editor-user', password: 'test-editor-password', role: 'editor' }
  });
  await editor.request('/api/auth/login', {
    method: 'POST',
    body: { username: 'editor-user', password: 'test-editor-password' }
  });

  // Editor should be able to search and import
  const editorSearch = await editor.request('/api/admin/presets/search?q=pi-hole');
  assert.ok(editorSearch.presets.length > 0);

  const editorImport = await editor.request('/api/admin/presets/import', {
    method: 'POST',
    body: { presetId: 'plex', customUrl: 'http://plex.local:32400' }
  });
  assert.equal(editorImport.ok, true);

  // Editor should NOT be able to view/update settings or manually update/crawl catalog
  await assert.rejects(() => editor.request('/api/admin/presets/settings'), /Insufficient permissions/);
  await assert.rejects(() => editor.request('/api/admin/presets/settings', { method: 'PUT', body: { enableRemotePresets: false } }), /Insufficient permissions/);
  await assert.rejects(() => editor.request('/api/admin/presets/update', { method: 'POST' }), /Insufficient permissions/);
});
