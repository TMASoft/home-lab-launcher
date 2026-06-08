const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, Client } = require('./helpers');

test('core API supports auth, services, settings, logs, and plugin health', async (t) => {
  const server = startServer({ port: 19101 });
  await server.ready();
  t.after(() => server.stop());

  const anon = new Client(server.baseUrl);
  const healthz = await anon.request('/api/healthz');
  assert.equal(healthz.ok, true);
  assert.equal(typeof healthz.version, 'string');
  assert.equal(typeof healthz.uptimeSeconds, 'number');
  assert.deepEqual(Object.keys(healthz).sort(), ['ok', 'uptimeSeconds', 'version']);
  const publicSettings = await anon.request('/api/settings/public');
  assert.equal(publicSettings.publicReadEnabled, true);

  const admin = new Client(server.baseUrl);
  const login = await admin.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change' } });
  assert.equal(login.user.role, 'admin');
  assert.ok(admin.csrfToken);

  const csrfProbe = new Client(server.baseUrl);
  csrfProbe.cookie = admin.cookie;
  await assert.rejects(() => csrfProbe.request('/api/settings', { method: 'PATCH', body: { app_name: 'CSRF Probe' } }), /Invalid CSRF token/);

  const created = await admin.request('/api/services', { method: 'POST', body: { id: 'api-test-service', name: 'API Test Service', url: `${server.baseUrl}/api/auth/session`, icon: '🧪', category: 'test', healthCheckEnabled: true, healthCheckIntervalMinutes: 1 } });
  assert.equal(created.service.id, 'api-test-service');
  assert.equal(created.service.healthCheckEnabled, true);

  const urlTest = await admin.request('/api/services/test-url', { method: 'POST', body: { url: `${server.baseUrl}/api/healthz` } });
  assert.equal(urlTest.ok, true);
  assert.equal(urlTest.status, 'up');

  const health = await admin.request('/api/services/api-test-service/check', { method: 'POST', body: {} });
  assert.equal(health.health.status, 'up');

  const services = await admin.request('/api/services');
  assert.ok(services.services.some((service) => service.id === 'api-test-service' && service.health));

  await admin.request('/api/settings', { method: 'PATCH', body: { app_name: 'Test Launcher' } });
  const overview = await admin.request('/api/admin/overview');
  assert.equal(overview.settings.appName, 'Test Launcher');

  const appearance = await admin.request('/api/admin/appearance');
  assert.equal(appearance.appearance.version, 1);
  const updatedAppearance = await admin.request('/api/admin/appearance', {
    method: 'PUT',
    body: {
      appearance: {
        ...appearance.appearance,
        brand: { ...appearance.appearance.brand, appName: 'Theme Test', pageTitle: 'Theme Test Page', brandText: 'Theme Test' },
        hero: { ...appearance.appearance.hero, heading: 'Custom hero' },
        theme: { ...appearance.appearance.theme, mode: 'light', colors: { primary: '#123abc', background: '#ffffff' } }
      }
    }
  });
  assert.equal(updatedAppearance.appearance.brand.appName, 'Theme Test');
  assert.equal(updatedAppearance.appearance.theme.colors.primary, '#123abc');
  const publicAfterAppearance = await anon.request('/api/settings/public');
  assert.equal(publicAfterAppearance.appearance.hero.heading, 'Custom hero');
  assert.equal(publicAfterAppearance.appearance.brand.pageTitle, 'Theme Test Page');

  const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
  const asset = await admin.request('/api/app-assets', { method: 'POST', body: { assetData: onePixelPng } });
  assert.match(asset.url, /^\/api\/app-assets\/[a-f0-9]{64}\.png$/);
  const fetchedAsset = await fetch(`${server.baseUrl}${asset.url}`);
  assert.equal(fetchedAsset.status, 200);
  await assert.rejects(() => admin.request('/api/app-assets', { method: 'POST', body: { assetData: 'data:image/svg+xml;base64,PHN2Zy8+' } }), /JPEG, PNG, GIF, or WebP/);
  await assert.rejects(() => admin.request('/api/app-assets', { method: 'POST', body: { assetData: 'data:image/png;base64,PGh0bWw+' } }), /JPEG, PNG, GIF, or WebP/);

  const sanitizedAppearance = await admin.request('/api/admin/appearance', {
    method: 'PUT',
    body: {
      appearance: {
        ...updatedAppearance.appearance,
        brand: {
          ...updatedAppearance.appearance.brand,
          faviconUrl: 'javascript:alert(1)',
          brandIconUrl: '/api/app-assets/not-a-real-file.png',
          heroImageUrl: asset.url
        }
      }
    }
  });
  assert.equal(sanitizedAppearance.appearance.brand.faviconUrl, '');
  assert.equal(sanitizedAppearance.appearance.brand.brandIconUrl, '');
  assert.equal(sanitizedAppearance.appearance.brand.heroImageUrl, asset.url);

  const preset = await admin.request('/api/admin/theme-presets', { method: 'POST', body: { name: 'Midnight Lab', description: 'Safe theme pack', appearance: updatedAppearance.appearance } });
  assert.equal(preset.preset.name, 'Midnight Lab');
  const exportedPreset = await admin.request(`/api/admin/theme-presets/${preset.preset.id}/export`);
  assert.equal(exportedPreset.format, 'home-lab-launcher-theme-v1');
  assert.deepEqual(Object.keys(exportedPreset).sort(), ['appearance', 'description', 'format', 'name']);
  const importedPreset = await admin.request('/api/admin/theme-presets/import', { method: 'POST', body: exportedPreset });
  assert.equal(importedPreset.preset.name, 'Midnight Lab');
  await assert.rejects(() => admin.request('/api/admin/theme-presets/import', { method: 'POST', body: { format: 'wrong', appearance: {} } }), /Unsupported theme preset format/);
  await assert.rejects(() => admin.request('/api/admin/appearance', { method: 'PUT', body: { appearance: { theme: { colors: { primary: 'javascript:alert(1)' } } } } }), /Invalid theme color/);

  await admin.request('/api/users', { method: 'POST', body: { username: 'basic', password: 'change-me-basic', role: 'user' } });
  const basic = new Client(server.baseUrl);
  await basic.request('/api/auth/login', { method: 'POST', body: { username: 'basic', password: 'change-me-basic' } });
  await assert.rejects(() => basic.request('/api/admin/appearance', { method: 'PUT', body: { appearance: updatedAppearance.appearance } }), /Insufficient permissions/);

  await admin.request('/api/settings', { method: 'PATCH', body: { public_read_enabled: false } });
  const anonPublicWhileLocked = await anon.request('/api/settings/public');
  assert.equal(anonPublicWhileLocked.publicReadEnabled, false);
  await assert.rejects(() => anon.request('/api/services'), /Authentication required/);
  const fetchedLockedAsset = await fetch(`${server.baseUrl}${asset.url}`);
  assert.equal(fetchedLockedAsset.status, 200);
  await admin.request('/api/settings', { method: 'PATCH', body: { public_read_enabled: true } });

  const pluginHealth = await admin.request('/api/admin/health');
  assert.ok(pluginHealth.plugins);
  assert.ok(pluginHealth.warnings.some((warning) => warning.message.includes('public access') || warning.message.includes('Anonymous read-only')));
  await assert.rejects(() => admin.request('/api/plugins/install', { method: 'POST', body: { repoUrl: 'owner/repo', version: 'v1.0.0' } }), /trust confirmation/);
  await assert.rejects(() => admin.request('/api/plugins/install', { method: 'POST', body: { repoUrl: 'owner/repo', version: 'v1.0.0', expectedSha256: 'not-a-sha', trustConfirmed: true } }), /64 hexadecimal characters/);

  const logs = await admin.request('/api/admin/logs?limit=10');
  assert.ok(Array.isArray(logs.logs));

  await admin.request('/api/services/api-test-service', { method: 'DELETE' });

  const restorePayload = {
    format: 'home-lab-launcher-config-v1',
    settings: { appearance: { theme: { colors: { primary: 'not-a-color' } } } },
    services: []
  };
  const preview = await admin.request('/api/admin/restore/preview', { method: 'POST', body: restorePayload });
  assert.equal(preview.preview.counts.settings, 1);
  assert.equal(preview.preview.counts.services, 0);
  assert.ok(preview.preview.warnings.every((warning) => !warning.includes('password_hash')));
  await admin.request('/api/admin/restore', {
    method: 'POST',
    body: restorePayload
  });
  const fallbackSettings = await anon.request('/api/settings/public');
  assert.equal(fallbackSettings.appearance.brand.appName, 'Home Lab Launcher');
});


test('server-side private-network fetches can be restricted by role', async (t) => {
  const server = startServer({ port: 19103, env: { SERVER_FETCH_PRIVATE_NETWORK_ACCESS: 'admin' } });
  await server.ready();
  t.after(() => server.stop());

  const admin = new Client(server.baseUrl);
  await admin.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change' } });
  await admin.request('/api/users', { method: 'POST', body: { username: 'editor', password: 'change-me-editor', role: 'editor' } });

  const editor = new Client(server.baseUrl);
  await editor.request('/api/auth/login', { method: 'POST', body: { username: 'editor', password: 'change-me-editor' } });

  const adminUrlTest = await admin.request('/api/services/test-url', { method: 'POST', body: { url: `${server.baseUrl}/api/healthz` } });
  assert.equal(adminUrlTest.status, 'up');

  const editorUrlTest = await editor.request('/api/services/test-url', { method: 'POST', body: { url: `${server.baseUrl}/api/healthz` } });
  assert.equal(editorUrlTest.ok, false);
  assert.match(editorUrlTest.error, /private, loopback, link-local, or reserved network address/);

  await assert.rejects(
    () => editor.request('/api/services', { method: 'POST', body: { name: 'Blocked Icon', url: 'https://example.com', icon: `${server.baseUrl}/api/healthz` } }),
    /private, loopback, link-local, or reserved network address/
  );

  const config = await admin.request('/api/admin/config');
  assert.equal(config.config.serverFetch.privateNetworkAccess, 'admin');
  assert.deepEqual(config.config.serverFetch.privateNetworkRoles, ['admin']);
});


test('plugin config scopes preserve admin-only fields from editor updates', async (t) => {
  const server = startServer({ port: 19104 });
  await server.ready();
  t.after(() => server.stop());

  const admin = new Client(server.baseUrl);
  await admin.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change' } });
  await admin.request('/api/users', { method: 'POST', body: { username: 'editor', password: 'change-me-editor', role: 'editor' } });

  const pluginDir = require('node:path').join(server.dataDir, 'local-plugin');
  require('node:fs').mkdirSync(pluginDir, { recursive: true });
  require('node:fs').writeFileSync(require('node:path').join(pluginDir, 'plugin.json'), JSON.stringify({
    id: 'scoped-config',
    name: 'Scoped Config',
    version: 'local',
    launcherApiVersion: 1,
    configSchema: {
      adminSecret: { type: 'string', label: 'Admin secret', scope: 'admin' },
      refreshMinutes: { type: 'number', label: 'Refresh minutes', scope: 'editor' },
      compactMode: { type: 'boolean', label: 'Compact mode', scope: 'user' }
    }
  }));

  await admin.request('/api/plugins/install-local', { method: 'POST', body: { path: pluginDir, trustConfirmed: true } });
  await admin.request('/api/plugins/scoped-config/config', { method: 'PUT', body: { config: { adminSecret: 'keep-me', refreshMinutes: 15, compactMode: false } } });

  const editor = new Client(server.baseUrl);
  await editor.request('/api/auth/login', { method: 'POST', body: { username: 'editor', password: 'change-me-editor' } });
  const update = await editor.request('/api/plugins/scoped-config/config', { method: 'PUT', body: { config: { adminSecret: 'stolen', refreshMinutes: 30, compactMode: true, unknown: 'ignored' } } });
  assert.deepEqual(update.updatedFields.sort(), ['compactMode', 'refreshMinutes']);
  assert.deepEqual(update.rejectedFields.sort(), ['adminSecret', 'unknown']);

  const plugins = await admin.request('/api/plugins');
  const plugin = plugins.plugins.find((item) => item.id === 'scoped-config');
  assert.equal(plugin.config.adminSecret, 'keep-me');
  assert.equal(plugin.config.refreshMinutes, 30);
  assert.equal(plugin.config.compactMode, true);
});


test('roles, public/private read modes, preferences, and CSRF boundaries are enforced', async (t) => {
  const server = startServer({ port: 19105, env: { PUBLIC_READ_ENABLED: 'false' } });
  await server.ready();
  t.after(() => server.stop());

  const anon = new Client(server.baseUrl);
  const lockedSettings = await anon.request('/api/settings/public');
  assert.equal(lockedSettings.publicReadEnabled, false);
  await assert.rejects(() => anon.request('/api/services'), /Authentication required/);
  await assert.rejects(() => anon.request('/api/service-health'), /Authentication required/);
  await assert.rejects(() => anon.request('/api/weather'), /Authentication required/);

  const admin = new Client(server.baseUrl);
  const adminLogin = await admin.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change' } });
  assert.equal(adminLogin.user.role, 'admin');

  await admin.request('/api/users', { method: 'POST', body: { username: 'editor-role', password: 'change-me-editor', role: 'editor' } });
  await admin.request('/api/users', { method: 'POST', body: { username: 'basic-role', password: 'change-me-basic', role: 'user' } });

  const editor = new Client(server.baseUrl);
  await editor.request('/api/auth/login', { method: 'POST', body: { username: 'editor-role', password: 'change-me-editor' } });
  const editorService = await editor.request('/api/services', {
    method: 'POST',
    body: { id: 'editor-created-service', name: 'Editor Created Service', url: 'https://editor.example.test', icon: '🛠️', category: 'test' }
  });
  assert.equal(editorService.service.id, 'editor-created-service');
  await assert.rejects(() => editor.request('/api/settings', { method: 'PATCH', body: { app_name: 'Editor Should Not Change This' } }), /Insufficient permissions/);
  await assert.rejects(() => editor.request('/api/users', { method: 'POST', body: { username: 'nope', password: 'change-me-nope', role: 'user' } }), /Insufficient permissions/);
  await assert.rejects(() => editor.request('/api/plugins/reload', { method: 'POST', body: {} }), /Insufficient permissions/);

  const basic = new Client(server.baseUrl);
  await basic.request('/api/auth/login', { method: 'POST', body: { username: 'basic-role', password: 'change-me-basic' } });
  const basicServices = await basic.request('/api/services');
  assert.ok(basicServices.services.some((service) => service.id === 'editor-created-service'));
  await assert.rejects(() => basic.request('/api/services', { method: 'POST', body: { name: 'Basic Cannot Create', url: 'https://basic.example.test' } }), /Insufficient permissions/);

  await basic.request('/api/me/preferences/favorites', { method: 'PUT', body: { value: ['editor-created-service', 'bad id with spaces', '', ...Array.from({ length: 505 }, (_, i) => `svc-${i}`)] } });
  const basicPrefs = await basic.request('/api/me/preferences');
  assert.equal(basicPrefs.preferences.favorites.length, 500);
  assert.ok(basicPrefs.preferences.favorites.includes('editor-created-service'));
  assert.ok(basicPrefs.preferences.favorites.includes('bad-id-with-spaces'));
  await basic.request('/api/me/preferences/launchpad', { method: 'PUT', body: { value: { view: 'list', density: 'spacious', hiddenCategories: ['Ops', 'Media'] } } });
  const launchpadPrefs = await basic.request('/api/me/preferences');
  assert.deepEqual(launchpadPrefs.preferences.launchpad, { hiddenCategories: ['Ops', 'Media'], density: 'spacious', view: 'list' });
  await assert.rejects(() => basic.request('/api/me/preferences/adminTheme', { method: 'PUT', body: { value: true } }), /Unsupported preference key/);

  await admin.request('/api/settings', { method: 'PATCH', body: { public_read_enabled: true } });
  const unlockedSettings = await anon.request('/api/settings/public');
  assert.equal(unlockedSettings.publicReadEnabled, true);
  const anonServices = await anon.request('/api/services');
  assert.ok(anonServices.services.length > 0);
  await admin.request('/api/settings', { method: 'PATCH', body: { public_read_enabled: false } });
  await assert.rejects(() => anon.request('/api/services'), /Authentication required/);

  const csrfRoutes = [
    ['POST', '/api/auth/logout'],
    ['PATCH', '/api/me/password'],
    ['DELETE', '/api/me/sessions/not-a-session'],
    ['DELETE', '/api/me/sessions'],
    ['PATCH', '/api/settings'],
    ['PUT', '/api/admin/appearance'],
    ['POST', '/api/admin/appearance/reset'],
    ['POST', '/api/app-assets'],
    ['POST', '/api/admin/theme-presets'],
    ['PATCH', '/api/admin/theme-presets/not-a-preset'],
    ['POST', '/api/admin/theme-presets/not-a-preset/apply'],
    ['DELETE', '/api/admin/theme-presets/not-a-preset'],
    ['POST', '/api/admin/theme-presets/import'],
    ['POST', '/api/admin/restore'],
    ['POST', '/api/admin/restore/preview'],
    ['PATCH', '/api/admin/logs/retention'],
    ['POST', '/api/admin/logs/prune'],
    ['POST', '/api/services'],
    ['PATCH', '/api/services/reorder'],
    ['POST', '/api/services/ha/duplicate'],
    ['PATCH', '/api/services/bulk'],
    ['PATCH', '/api/services/ha'],
    ['POST', '/api/services/test-url'],
    ['POST', '/api/services/ha/check'],
    ['DELETE', '/api/services/ha'],
    ['POST', '/api/services/import'],
    ['POST', '/api/users'],
    ['PATCH', `/api/users/${adminLogin.user.id}`],
    ['DELETE', '/api/users/999999'],
    ['PUT', '/api/me/preferences/favorites'],
    ['DELETE', '/api/me/preferences/favorites'],
    ['PUT', '/api/weather/settings'],
    ['POST', '/api/plugins/reload'],
    ['POST', '/api/plugins/install'],
    ['POST', '/api/plugins/install-local'],
    ['POST', '/api/plugins/not-installed/update'],
    ['PATCH', '/api/plugins/not-installed'],
    ['PUT', '/api/plugins/not-installed/config'],
    ['DELETE', '/api/plugins/not-installed']
  ];

  for (const [method, pathname] of csrfRoutes) {
    const response = await fetch(`${server.baseUrl}${pathname}`, {
      method,
      headers: {
        Cookie: admin.cookie,
        'Content-Type': 'application/json'
      },
      body: ['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined
    });
    assert.equal(response.status, 403, `${method} ${pathname} should require CSRF`);
    const data = await response.json();
    assert.equal(data.error, 'Invalid CSRF token', `${method} ${pathname} should return CSRF error`);
  }
});

test('optional 2FA/TOTP flow (setup, enable, enforce, reset, disable)', async (t) => {
  const server = startServer({ port: 19102 });
  await server.ready();
  t.after(() => server.stop());

  const admin = new Client(server.baseUrl);
  await admin.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change' } });

  const setup = await admin.request('/api/me/totp/setup', { method: 'POST' });
  assert.ok(setup.secret);
  assert.equal(setup.secret.length, 10);

  await assert.rejects(
    () => admin.request('/api/me/totp/enable', { method: 'POST', body: { secret: setup.secret, code: '000000' } }),
    /Invalid verification code/
  );

  const totp = require('../src/server/totp');
  const secretBuffer = totp.decodeBase32(setup.secret);
  const correctCode = totp.generateHOTP(secretBuffer, Math.floor(Date.now() / 1000 / 30));

  const enableRes = await admin.request('/api/me/totp/enable', { method: 'POST', body: { secret: setup.secret, code: String(correctCode) } });
  assert.equal(enableRes.ok, true);

  const me = await admin.request('/api/me');
  assert.equal(me.user.totpEnabled, 1);

  await admin.request('/api/auth/logout', { method: 'POST' });

  const client2 = new Client(server.baseUrl);
  const loginAttempt1 = await client2.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change' } });
  assert.equal(loginAttempt1.requiresTotp, true);

  await assert.rejects(
    () => client2.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change', code: '000000' } }),
    /Invalid 2FA code/
  );

  const correctCode2 = totp.generateHOTP(secretBuffer, Math.floor(Date.now() / 1000 / 30));
  const loginAttempt2 = await client2.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change', code: String(correctCode2) } });
  assert.equal(loginAttempt2.user.role, 'admin');

  const createdUser = await client2.request('/api/users', { method: 'POST', body: { username: 'editor-user', password: 'test-editor-password', role: 'editor' } });
  const userId = createdUser.user.id;

  const editor = new Client(server.baseUrl);
  await editor.request('/api/auth/login', { method: 'POST', body: { username: 'editor-user', password: 'test-editor-password' } });
  const editorSetup = await editor.request('/api/me/totp/setup', { method: 'POST' });
  const editorSecretBuffer = totp.decodeBase32(editorSetup.secret);
  const editorCode = totp.generateHOTP(editorSecretBuffer, Math.floor(Date.now() / 1000 / 30));
  await editor.request('/api/me/totp/enable', { method: 'POST', body: { secret: editorSetup.secret, code: String(editorCode) } });

  const userListBefore = await client2.request('/api/users');
  const listedEditor = userListBefore.users.find(u => u.id === userId);
  assert.equal(listedEditor.totpEnabled, 1);

  await client2.request(`/api/users/${userId}`, { method: 'PATCH', body: { username: 'editor-user', role: 'editor', resetTotp: true } });

  const userListAfter = await client2.request('/api/users');
  const listedEditorAfter = userListAfter.users.find(u => u.id === userId);
  assert.equal(listedEditorAfter.totpEnabled, 0);

  await client2.request('/api/me/totp/disable', { method: 'POST' });
  const meAfterDisable = await client2.request('/api/me');
  assert.equal(meAfterDisable.user.totpEnabled, 0);
});

