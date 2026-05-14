const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, Client } = require('./helpers');

test('core API supports auth, services, settings, logs, and plugin health', async (t) => {
  const server = startServer({ port: 19101 });
  await server.ready();
  t.after(() => server.stop());

  const anon = new Client(server.baseUrl);
  const publicSettings = await anon.request('/api/settings/public');
  assert.equal(publicSettings.publicReadEnabled, true);

  const admin = new Client(server.baseUrl);
  const login = await admin.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'change-me-immediately' } });
  assert.equal(login.user.role, 'admin');
  assert.ok(admin.csrfToken);

  const created = await admin.request('/api/services', { method: 'POST', body: { id: 'api-test-service', name: 'API Test Service', url: `${server.baseUrl}/api/auth/session`, icon: '🧪', category: 'test', healthCheckEnabled: true, healthCheckIntervalMinutes: 1 } });
  assert.equal(created.service.id, 'api-test-service');
  assert.equal(created.service.healthCheckEnabled, true);

  const health = await admin.request('/api/services/api-test-service/check', { method: 'POST', body: {} });
  assert.equal(health.health.status, 'up');

  const services = await admin.request('/api/services');
  assert.ok(services.services.some((service) => service.id === 'api-test-service' && service.health));

  await admin.request('/api/settings', { method: 'PATCH', body: { app_name: 'Test Launcher' } });
  const overview = await admin.request('/api/admin/overview');
  assert.equal(overview.settings.appName, 'Test Launcher');

  const pluginHealth = await admin.request('/api/admin/health');
  assert.ok(pluginHealth.plugins);

  const logs = await admin.request('/api/admin/logs?limit=10');
  assert.ok(Array.isArray(logs.logs));

  await admin.request('/api/services/api-test-service', { method: 'DELETE' });
});
