const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, Client } = require('./helpers');

test('Preset Catalog API & Logic', async (t) => {
  const server = startServer({ port: 19105 });
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

  // Immediate subsequent update should be throttled (returns 429)
  await assert.rejects(
    () => admin.request('/api/admin/presets/update', { method: 'POST' }),
    (err) => {
      assert.equal(err.status, 429);
      assert.match(err.message, /Please wait at least 60 seconds/);
      return true;
    }
  );

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
