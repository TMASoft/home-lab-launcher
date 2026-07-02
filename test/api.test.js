const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Database = require('better-sqlite3');
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
  const openapi = await anon.request('/api/openapi.json');
  assert.equal(openapi.openapi, '3.1.0');
  assert.ok(openapi.paths['/services']);
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

  // Test appearance reset
  const resetAppearance = await admin.request('/api/admin/appearance/reset', { method: 'POST' });
  assert.deepEqual(resetAppearance.appearance.theme.colors, {});
  assert.equal(resetAppearance.appearance.brand.appName, 'Theme Test');

  // Test hero subheading HTML sanitization
  const testSubheadingInput = '<p>Hello <strong>World</strong>! <script>alert(1)</script> <a href="javascript:alert(2)">XSS</a> <a href="https://example.com" onclick="steal()">Safe Link</a></p>';
  const sanitizedAppearanceObj = await admin.request('/api/admin/appearance', {
    method: 'PUT',
    body: {
      appearance: {
        ...resetAppearance.appearance,
        hero: {
          ...resetAppearance.appearance.hero,
          subheading: testSubheadingInput
        }
      }
    }
  });
  assert.equal(
    sanitizedAppearanceObj.appearance.hero.subheading,
    '<p>Hello <strong>World</strong>! alert(1) <a>XSS</a> <a href="https://example.com">Safe Link</a></p>'
  );



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

  // Test backup and restore of services with health checks
  const backupData = await admin.request('/api/admin/backup');
  assert.equal(backupData.format, 'home-lab-launcher-config-v1');
  
  // Create a service with health check
  await admin.request('/api/services', {
    method: 'POST',
    body: {
      name: 'Health Check Svc',
      url: 'https://healthcheck.example.com',
      healthCheckEnabled: true,
      healthCheckUrl: 'https://healthcheck.example.com/status',
      healthCheckIntervalMinutes: 5
    }
  });

  const backupDataWithSvc = await admin.request('/api/admin/backup');
  const restored = await admin.request('/api/admin/restore', {
    method: 'POST',
    body: backupDataWithSvc
  });
  assert.equal(restored.ok, true);

  const servicesAfterRestore = await admin.request('/api/services');
  const restoredSvc = servicesAfterRestore.services.find(s => s.name === 'Health Check Svc');
  assert.ok(restoredSvc);
  assert.equal(restoredSvc.healthCheckEnabled, true);
  assert.equal(restoredSvc.healthCheckUrl, 'https://healthcheck.example.com/status');
  assert.equal(restoredSvc.healthCheckIntervalMinutes, 5);
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

  // Service icons and app assets access controls check
  const dummyFilename = '0000000000000000000000000000000000000000000000000000000000000000.png';
  await assert.rejects(
    async () => { await anon.request(`/api/service-icons/${dummyFilename}`); },
    (err) => err.status === 401
  );
  await assert.rejects(
    async () => { await anon.request(`/api/app-assets/${dummyFilename}`); },
    (err) => err.status === 404
  );

  const admin = new Client(server.baseUrl);
  const adminLogin = await admin.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change' } });
  assert.equal(adminLogin.user.role, 'admin');

  await assert.rejects(
    async () => { await admin.request(`/api/service-icons/${dummyFilename}`); },
    (err) => err.status === 404
  );

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
  let launchpadPrefs = await basic.request('/api/me/preferences');
  assert.deepEqual(launchpadPrefs.preferences.launchpad, {
    hiddenCategories: ['Ops', 'Media'],
    viewMode: 'list',
    hideMetadata: false,
    layoutOrder: ['hero', 'services'],
    sortBy: 'custom',
    servicesOrder: []
  });

  await basic.request('/api/me/preferences/launchpad', {
    method: 'PUT',
    body: {
      value: {
        layoutOrder: ['services', 'plugin:demo:status', 'hero', 'invalid-section', 'services'],
        viewMode: 'compact',
        hideMetadata: true,
        hiddenCategories: ['Media']
      }
    }
  });
  launchpadPrefs = await basic.request('/api/me/preferences');
  assert.deepEqual(launchpadPrefs.preferences.launchpad, {
    hiddenCategories: ['Media'],
    viewMode: 'compact',
    hideMetadata: true,
    layoutOrder: ['services', 'plugin:demo:status', 'hero'],
    sortBy: 'custom',
    servicesOrder: []
  });

  await basic.request('/api/me/preferences/launchpad', {
    method: 'PUT',
    body: {
      value: {
        viewMode: 'cards',
        sortBy: 'category',
        servicesOrder: ['editor-created-service', 'Bad ID With Spaces', '', ...Array.from({ length: 505 }, (_, i) => `service-${i}`)]
      }
    }
  });
  launchpadPrefs = await basic.request('/api/me/preferences');
  assert.equal(launchpadPrefs.preferences.launchpad.sortBy, 'category');
  assert.equal(launchpadPrefs.preferences.launchpad.servicesOrder.length, 500);
  assert.deepEqual(launchpadPrefs.preferences.launchpad.servicesOrder.slice(0, 2), ['editor-created-service', 'bad-id-with-spaces']);

  await basic.request('/api/me/preferences/launchpad', { method: 'PUT', body: { value: { sortBy: 'invalid', servicesOrder: 'not-array' } } });
  launchpadPrefs = await basic.request('/api/me/preferences');
  assert.equal(launchpadPrefs.preferences.launchpad.sortBy, 'custom');
  assert.deepEqual(launchpadPrefs.preferences.launchpad.servicesOrder, []);

  await basic.request('/api/me/preferences/plugins', {
    method: 'PUT',
    body: {
      value: {
        'hll-weather': { theme: 'pixel', animations: true, 'bad key': '<script>' },
        'Bad Plugin ID': { theme: 'default' },
        nope: ['not', 'object']
      }
    }
  });
  const pluginPrefs = await basic.request('/api/me/preferences');
  assert.deepEqual(pluginPrefs.preferences.plugins['hll-weather'], { theme: 'pixel', animations: true, 'bad-key': '<script>' });
  assert.deepEqual(pluginPrefs.preferences.plugins['bad-plugin-id'], { theme: 'default' });
  assert.equal(pluginPrefs.preferences.plugins.nope, undefined);

  await assert.rejects(() => basic.request('/api/me/preferences/adminTheme', { method: 'PUT', body: { value: true } }), /Unsupported preference key/);

  await admin.request('/api/settings', { method: 'PATCH', body: { public_read_enabled: true } });
  const unlockedSettings = await anon.request('/api/settings/public');
  assert.equal(unlockedSettings.publicReadEnabled, true);

  const anonSettings = await anon.request('/api/settings/public');
  assert.equal(anonSettings.weather, undefined);

  const adminSettings = await admin.request('/api/settings/public');
  assert.equal(adminSettings.weather, undefined);

  const anonServices = await anon.request('/api/services');
  assert.ok(anonServices.services.length > 0);
  await admin.request('/api/settings', { method: 'PATCH', body: { public_read_enabled: false } });
  await assert.rejects(() => anon.request('/api/services'), /Authentication required/);

  const csrfRoutes = [
    ['POST', '/api/auth/logout'],
    ['PATCH', '/api/me/password'],
    ['DELETE', '/api/me/sessions/not-a-session'],
    ['DELETE', '/api/me/sessions'],
    ['POST', '/api/me/totp/setup'],
    ['POST', '/api/me/totp/enable'],
    ['POST', '/api/me/totp/disable'],
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
  assert.equal(setup.secret.length, 20);

  await assert.rejects(
    () => admin.request('/api/me/totp/enable', { method: 'POST', body: { secret: setup.secret, code: '000000' } }),
    /Invalid verification code/
  );

  const totp = require('../src/server/totp');
  const secretBuffer = totp.decodeBase32(setup.secret);
  // Each verification below must use a strictly increasing counter because a
  // consumed counter can no longer be reused (replay protection). The verify
  // window is +/-1, so enable at counter-1, login at counter, disable at counter+1.
  const baseCounter = Math.floor(Date.now() / 1000 / 30);
  const correctCode = totp.generateHOTP(secretBuffer, baseCounter - 1);

  const enableRes = await admin.request('/api/me/totp/enable', { method: 'POST', body: { secret: setup.secret, code: totp.formatToken(correctCode) } });
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

  const correctCode2 = totp.generateHOTP(secretBuffer, baseCounter);
  const loginAttempt2 = await client2.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change', code: totp.formatToken(correctCode2) } });
  assert.equal(loginAttempt2.user.role, 'admin');

  // Replaying the code that was just consumed at login must be rejected.
  const replayClient = new Client(server.baseUrl);
  await assert.rejects(
    () => replayClient.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change', code: totp.formatToken(correctCode2) } }),
    /Invalid 2FA code/
  );

  const createdUser = await client2.request('/api/users', { method: 'POST', body: { username: 'editor-user', password: 'test-editor-password', role: 'editor' } });
  const userId = createdUser.user.id;

  const editor = new Client(server.baseUrl);
  await editor.request('/api/auth/login', { method: 'POST', body: { username: 'editor-user', password: 'test-editor-password' } });
  const editorSetup = await editor.request('/api/me/totp/setup', { method: 'POST' });
  const editorSecretBuffer = totp.decodeBase32(editorSetup.secret);
  const editorCode = totp.generateHOTP(editorSecretBuffer, Math.floor(Date.now() / 1000 / 30));
  await editor.request('/api/me/totp/enable', { method: 'POST', body: { secret: editorSetup.secret, code: totp.formatToken(editorCode) } });

  const userListBefore = await client2.request('/api/users');
  const listedEditor = userListBefore.users.find(u => u.id === userId);
  assert.equal(listedEditor.totpEnabled, 1);

  await client2.request(`/api/users/${userId}`, { method: 'PATCH', body: { username: 'editor-user', role: 'editor', resetTotp: true } });

  const userListAfter = await client2.request('/api/users');
  const listedEditorAfter = userListAfter.users.find(u => u.id === userId);
  assert.equal(listedEditorAfter.totpEnabled, 0);

  // Disable fails without password/code
  await assert.rejects(
    () => client2.request('/api/me/totp/disable', { method: 'POST', body: {} }),
    /Current password is incorrect/
  );

  // Disable fails with incorrect password
  await assert.rejects(
    () => client2.request('/api/me/totp/disable', { method: 'POST', body: { password: 'wrong-password', code: '000000' } }),
    /Current password is incorrect/
  );

  // Disable fails with incorrect code
  await assert.rejects(
    () => client2.request('/api/me/totp/disable', { method: 'POST', body: { password: 'test-admin-password-please-change', code: '000000' } }),
    /Invalid verification code/
  );

  // Disable succeeds with valid password and a not-yet-consumed code
  const correctCodeDisable = totp.generateHOTP(secretBuffer, baseCounter + 1);
  await client2.request('/api/me/totp/disable', {
    method: 'POST',
    body: {
      password: 'test-admin-password-please-change',
      code: totp.formatToken(correctCodeDisable)
    }
  });

  const meAfterDisable = await client2.request('/api/me');
  assert.equal(meAfterDisable.user.totpEnabled, 0);

  const logs = await client2.request('/api/admin/logs?limit=20');
  assert.ok(logs.logs.some((entry) => entry.action === 'profile.totp_disabled'));
});

test('service creation falls back gracefully and logs warning on broken icon URL', async (t) => {
  const server = startServer({ port: 19106 });
  await server.ready();
  t.after(() => server.stop());

  const admin = new Client(server.baseUrl);
  await admin.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change' } });

  // Use a URL that will fail to connect/download (e.g. invalid domain or port)
  const res = await admin.request('/api/services', {
    method: 'POST',
    body: {
      name: 'Graceful Fallback Svc',
      url: 'https://example.com',
      icon: 'http://127.0.0.1:40999/non-existent-logo.png'
    }
  });

  assert.ok(res.service);
  assert.equal(res.service.name, 'Graceful Fallback Svc');
  assert.equal(res.service.icon, '🔗'); // Fallback icon applied

  // Verify the failure log is recorded in app logs
  const logsRes = await admin.request('/api/admin/logs?limit=5');
  const fallbackLog = logsRes.logs.find(log => log.action === 'service.icon_download_failed');
  assert.ok(fallbackLog);
  assert.equal(fallbackLog.level, 'warn');
  assert.equal(fallbackLog.details.iconUrl, 'http://127.0.0.1:40999/non-existent-logo.png');
  assert.ok(fallbackLog.details.error);
});

test('manual health checks persist down status for unresolved hosts', async (t) => {
  const server = startServer({ port: 19107 });
  await server.ready();
  t.after(() => server.stop());

  const admin = new Client(server.baseUrl);
  await admin.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change' } });

  await admin.request('/api/services', {
    method: 'POST',
    body: {
      id: 'bad-health-service',
      name: 'Bad Health Service',
      url: 'https://definitely-not-a-real-hostname.invalid',
      icon: '🔗',
      healthCheckEnabled: true
    }
  });

  const result = await admin.request('/api/services/bad-health-service/check', { method: 'POST', body: {} });
  assert.equal(result.health.status, 'down');
  assert.match(result.health.error, /could not be resolved/i);

  const services = await admin.request('/api/services');
  const service = services.services.find((item) => item.id === 'bad-health-service');
  assert.equal(service.health.status, 'down');
  assert.match(service.health.error, /could not be resolved/i);

  const logs = await admin.request('/api/admin/logs?limit=10');
  const failureLog = logs.logs.find((entry) => entry.action === 'service.health_check_failed');
  assert.ok(failureLog);
  assert.equal(failureLog.level, 'warn');
  assert.equal(failureLog.details.id, 'bad-health-service');
  assert.equal(failureLog.details.source, 'manual');
  assert.match(failureLog.details.error, /could not be resolved/i);
});

test('service creation stores remote SVG icons locally', async (t) => {
  const mockServer = http.createServer((req, res) => {
    if (req.url !== '/icon.svg') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><circle cx="0.5" cy="0.5" r="0.5" fill="#0af"/></svg>');
  });
  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const mockPort = mockServer.address().port;
  t.after(() => mockServer.close());

  const server = startServer({ port: 19108, env: { SERVER_FETCH_PRIVATE_NETWORK_ACCESS: 'admin' } });
  await server.ready();
  t.after(() => server.stop());

  const admin = new Client(server.baseUrl);
  await admin.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change' } });

  const created = await admin.request('/api/services', {
    method: 'POST',
    body: {
      id: 'svg-icon-service',
      name: 'SVG Icon Service',
      url: 'https://example.com',
      icon: `http://127.0.0.1:${mockPort}/icon.svg`
    }
  });

  assert.match(created.service.icon, /^\/api\/service-icons\/[a-f0-9]{64}\.svg$/);
  const response = await fetch(`${server.baseUrl}${created.service.icon}`, { headers: { Cookie: admin.cookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /image\/svg\+xml/);
});

test('account security changes revalidate and revoke stale sessions', async (t) => {
  const server = startServer({ port: 19109 });
  await server.ready();
  t.after(() => server.stop());

  const admin = new Client(server.baseUrl);
  await admin.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change' } });

  await assert.rejects(
    () => admin.request(`/api/users/${1}`, { method: 'PATCH', body: { username: 'admin', role: 'user' } }),
    /At least one admin account is required/
  );

  await admin.request('/api/users', { method: 'POST', body: { username: 'target-admin', password: 'target-admin-password', role: 'admin' } });
  await admin.request('/api/users', { method: 'POST', body: { username: 'target-user', password: 'target-user-password', role: 'user' } });
  const users = await admin.request('/api/users');
  const targetAdmin = users.users.find((user) => user.username === 'target-admin');
  const targetUser = users.users.find((user) => user.username === 'target-user');

  const staleAdmin = new Client(server.baseUrl);
  await staleAdmin.request('/api/auth/login', { method: 'POST', body: { username: 'target-admin', password: 'target-admin-password' } });
  await admin.request(`/api/users/${targetAdmin.id}`, { method: 'PATCH', body: { username: 'target-admin', role: 'user' } });
  const staleSession = await staleAdmin.request('/api/auth/session');
  assert.equal(staleSession.user, null);
  await assert.rejects(() => staleAdmin.request('/api/users'), /Authentication required/);

  const targetUserA = new Client(server.baseUrl);
  const targetUserB = new Client(server.baseUrl);
  await targetUserA.request('/api/auth/login', { method: 'POST', body: { username: 'target-user', password: 'target-user-password' } });
  await targetUserB.request('/api/auth/login', { method: 'POST', body: { username: 'target-user', password: 'target-user-password' } });

  const passwordReset = await admin.request(`/api/users/${targetUser.id}`, {
    method: 'PATCH',
    body: { username: 'target-user', role: 'user', password: 'target-user-password-2' }
  });
  assert.ok(passwordReset.revokedSessions >= 2);
  await assert.rejects(() => targetUserA.request('/api/me'), /Authentication required/);
  await assert.rejects(() => targetUserB.request('/api/me'), /Authentication required/);

  const targetUserC = new Client(server.baseUrl);
  const targetUserD = new Client(server.baseUrl);
  await targetUserC.request('/api/auth/login', { method: 'POST', body: { username: 'target-user', password: 'target-user-password-2' } });
  await targetUserD.request('/api/auth/login', { method: 'POST', body: { username: 'target-user', password: 'target-user-password-2' } });
  const selfChange = await targetUserC.request('/api/me/password', {
    method: 'PATCH',
    body: { currentPassword: 'target-user-password-2', newPassword: 'target-user-password-3' }
  });
  assert.ok(selfChange.revokedSessions >= 1);
  const currentMe = await targetUserC.request('/api/me');
  assert.equal(currentMe.user.username, 'target-user');
  await assert.rejects(() => targetUserD.request('/api/me'), /Authentication required/);

  const deleteUser = new Client(server.baseUrl);
  await deleteUser.request('/api/auth/login', { method: 'POST', body: { username: 'target-user', password: 'target-user-password-3' } });
  await admin.request(`/api/users/${targetUser.id}`, { method: 'DELETE' });
  await assert.rejects(() => deleteUser.request('/api/me'), /Authentication required/);
});

test('stale cached sessions are revalidated on read and profile routes', async (t) => {
  const server = startServer({ port: 19111 });
  await server.ready();
  t.after(() => server.stop());

  const admin = new Client(server.baseUrl);
  await admin.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change' } });
  await admin.request('/api/users', { method: 'POST', body: { username: 'stale-admin', password: 'stale-admin-password', role: 'admin' } });
  await admin.request('/api/services', { method: 'POST', body: { id: 'hidden-service', name: 'Hidden Service', url: 'https://hidden.example.test', enabled: false } });

  const users = await admin.request('/api/users');
  const staleAdminUser = users.users.find((user) => user.username === 'stale-admin');
  const staleAdmin = new Client(server.baseUrl);
  await staleAdmin.request('/api/auth/login', { method: 'POST', body: { username: 'stale-admin', password: 'stale-admin-password' } });

  const db = new Database(`${server.dataDir}/launcher.sqlite`);
  t.after(() => db.close());
  db.prepare("UPDATE users SET role = 'user', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(staleAdminUser.id);

  const demotedServices = await staleAdmin.request('/api/services');
  assert.equal(demotedServices.services.some((service) => service.id === 'hidden-service'), false);
  await assert.rejects(() => staleAdmin.request('/api/users'), /Insufficient permissions/);

  db.prepare('DELETE FROM users WHERE id = ?').run(staleAdminUser.id);
  await assert.rejects(() => staleAdmin.request('/api/me'), /Authentication required/);
  await assert.rejects(() => staleAdmin.request('/api/plugins'), /Authentication required/);
  const publicServices = await staleAdmin.request('/api/services');
  assert.equal(publicServices.services.some((service) => service.id === 'hidden-service'), false);
});

test('admin TOTP reset revokes sessions and preset imports validate URLs', async (t) => {
  const server = startServer({ port: 19110 });
  await server.ready();
  t.after(() => server.stop());

  const admin = new Client(server.baseUrl);
  await admin.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change' } });
  await admin.request('/api/users', { method: 'POST', body: { username: 'totp-user', password: 'totp-user-password', role: 'user' } });
  const users = await admin.request('/api/users');
  const target = users.users.find((user) => user.username === 'totp-user');

  const targetA = new Client(server.baseUrl);
  const targetB = new Client(server.baseUrl);
  await targetA.request('/api/auth/login', { method: 'POST', body: { username: 'totp-user', password: 'totp-user-password' } });
  await targetB.request('/api/auth/login', { method: 'POST', body: { username: 'totp-user', password: 'totp-user-password' } });
  const reset = await admin.request(`/api/users/${target.id}`, { method: 'PATCH', body: { username: 'totp-user', role: 'user', resetTotp: true } });
  assert.ok(reset.revokedSessions >= 2);
  await assert.rejects(() => targetA.request('/api/me'), /Authentication required/);
  await assert.rejects(() => targetB.request('/api/me'), /Authentication required/);

  const db = new Database(`${server.dataDir}/launcher.sqlite`);
  t.after(() => db.close());
  db.prepare(`
    INSERT INTO preset_cache (id, name, website, description, category, accent, icon_url, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('no-url-preset', 'No URL Preset', '', 'Preset without a website fallback.', 'test', '#4de7ff', 'https://raw.githubusercontent.com/linuxserver/Heimdall-Apps/master/Plex/logo.png', 'local');

  await assert.rejects(
    () => admin.request('/api/admin/presets/import', { method: 'POST', body: { presetId: 'no-url-preset' } }),
    /Service URL must be a valid URL/
  );
  await assert.rejects(
    () => admin.request('/api/admin/presets/import', { method: 'POST', body: { presetId: 'no-url-preset', customUrl: '   ' } }),
    /Service URL must be a valid URL/
  );
  const afterNoUrlReject = await admin.request('/api/services');
  assert.equal(afterNoUrlReject.services.some((service) => service.name === 'No URL Preset'), false);

  await assert.rejects(
    () => admin.request('/api/admin/presets/import', { method: 'POST', body: { presetId: 'lidarr', customUrl: 'javascript:alert(1)' } }),
    /Service URL must be http or https/
  );
  await assert.rejects(
    () => admin.request('/api/admin/presets/import', { method: 'POST', body: { presetId: 'lidarr', customUrl: 'ftp://example.test' } }),
    /Service URL must be http or https/
  );
  await assert.rejects(
    () => admin.request('/api/admin/presets/import', { method: 'POST', body: { presetId: 'lidarr', customUrl: 'not a url' } }),
    /Service URL must be a valid URL/
  );
  const imported = await admin.request('/api/admin/presets/import', { method: 'POST', body: { presetId: 'lidarr', customUrl: 'https://lidarr.example.test' } });
  assert.equal(imported.ok, true);
  const services = await admin.request('/api/services');
  assert.ok(services.services.some((service) => service.id === imported.serviceId && service.url === 'https://lidarr.example.test/'));

  const csrfProbe = new Client(server.baseUrl);
  csrfProbe.cookie = admin.cookie;
  csrfProbe.csrfToken = `${admin.csrfToken}x`;
  await assert.rejects(() => csrfProbe.request('/api/settings', { method: 'PATCH', body: { app_name: 'Bad CSRF' } }), /Invalid CSRF token/);
});

test('per-IP login throttle blocks username spraying across many usernames', async (t) => {
  const server = startServer({ port: 19140 });
  await server.ready();
  t.after(() => server.stop());

  const client = new Client(server.baseUrl);
  for (let i = 0; i < 20; i += 1) {
    await assert.rejects(
      () => client.request('/api/auth/login', { method: 'POST', body: { username: `sprayed-user-${i}`, password: 'not-the-password' } }),
      /Invalid username or password/
    );
  }

  // The 21st attempt from the same IP is limited even for valid credentials
  // and a username that has not itself hit the per-username limit.
  await assert.rejects(
    () => client.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change' } }),
    /Too many failed login attempts/
  );
});
