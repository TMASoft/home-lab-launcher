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
  const login = await admin.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'change-me-immediately' } });
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
