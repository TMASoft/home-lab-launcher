const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('frontend shell exposes expected landmarks and controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src/public/index.html'), 'utf8');
  for (const id of ['brand-name', 'brand-subtitle', 'hero-heading', 'layout-root', 'layout-toolbar', 'site-note', 'service-search', 'service-grid', 'admin-panel', 'modal', 'command-palette', 'command-palette-input', 'command-palette-results', 'toast']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tab"/);
  assert.match(html, /aria-controls="admin-content"/);
  assert.match(html, /aria-controls="command-palette"/);
  assert.match(html, /aria-modal="true"/);
});

test('frontend script includes role-gated admin and launchpad behaviors', () => {
  const js = [
    fs.readFileSync(path.join(__dirname, '..', 'src/public/core.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'src/public/admin.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'src/public/app.js'), 'utf8')
  ].join('\n');
  for (const token of ['isAdmin()', 'canEditServices()', 'renderServices()', 'setLayoutEditing(', 'persistLayoutOrder(', 'adminAppearanceHtml()', 'applyAppearance(', 'healthCheckEnabled', 'saveLaunchpadPreferences', 'Beta readiness checklist', 'checklist-link', 'docs/release-checklist.md', 'docs/deployment.md#first-admin-bootstrap', 'docs/examples/backup-restore.md', 'plugin-trust-confirm', 'preview-restore', 'reset-layout-preferences', 'data-layout-move', 'test-service-url', 'data-toggle-metadata', 'showServiceHostnames()', 'showServiceTags()', '/api/admin/presets/import', 'svc-preset-id']) {
    assert.ok(js.includes(token), `missing ${token}`);
  }
  // v0.7.0 additions: recovery codes, API tokens, health webhook settings, uptime badges
  for (const token of ['showRecoveryCodesModal(', 'recoveryCodesRemaining', '/api/me/totp/recovery-codes', 'login-use-recovery', 'recoveryCode', 'apiTokensCardHtml()', '/api/admin/api-tokens', 'data-api-token-revoke', 'admin-health-webhook', 'health_webhook_url', 'health_history_retention_days', 'serviceUptimeHtml(', 'uptime24h']) {
    assert.ok(js.includes(token), `missing v0.7.0 token ${token}`);
  }
  const accessibilityTokens = [
    'lastFocusedBeforeModal',
    'firstFocusableIn(',
    "modal?.addEventListener('close'",
    'ArrowLeft',
    'ArrowRight',
    'data-service-move',
    'aria-label="Move ${escapeHtml(svc.name)} up"',
    'aria-label="Select ${escapeHtml(svc.name)}"'
  ];
  for (const token of accessibilityTokens) {
    assert.ok(js.includes(token), `missing accessibility token ${token}`);
  }
  for (const token of ['openCommandPalette(', 'buildCommandPaletteCommands()', 'runSelectedCommand(', 'data-command-index', 'event.key.toLowerCase() === \'k\'', "event.key === '/'", 'runServiceHealthCheck(', 'openAdminTab(', 'openPluginSettings(', 'exportConfigBackup(', 'exportAuditLogs(']) {
    assert.ok(js.includes(token), `missing command palette token ${token}`);
  }
  // Service discovery: review-before-apply UI and safety messaging
  for (const token of ['adminDiscoveryHtml()', 'bindDiscoveryHandlers(', 'readDiscoverySelections(', '/api/discovery/status', '/api/discovery/docker/scan', '/api/discovery/compose/preview', '/api/discovery/apply', 'discovery-docker-endpoint', 'data-discovery-action', 'Nothing changes until you import']) {
    assert.ok(js.includes(token), `missing discovery token ${token}`);
  }
  // Plugin catalog: browse, trust acknowledgement, pinned install
  for (const token of ['pluginCatalogEntryHtml(', 'loadPluginCatalog(', 'openCatalogInstallModal(', '/api/plugin-catalog', 'plugin-catalog-refresh', 'plugin-catalog-list', 'data-catalog-install', 'catalog-trust-confirm', 'catalog-expected-sha256', 'catalogId: entry.id', 'not sandboxed', 'Version to pin']) {
    assert.ok(js.includes(token), `missing plugin catalog token ${token}`);
  }
});

test('frontend styles include reduced-motion and mobile layout safeguards', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src/public/styles.css'), 'utf8');
  for (const token of ['@media (prefers-reduced-motion: reduce)', 'animation: none !important', 'transition: none !important', '@media (max-width: 720px)', '.grid { grid-template-columns: 1fr; }', 'scroll-snap-type: x proximity', '-webkit-overflow-scrolling: touch', 'max-height: calc(100dvh - 16px)', '.command-palette-card', '.command-result.active', '.checklist-link', 'overflow-wrap: anywhere', '.discovery-row-grid { grid-template-columns: 1fr; }']) {
    assert.ok(css.includes(token), `missing CSS quality token ${token}`);
  }
});
