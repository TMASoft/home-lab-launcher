const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('frontend shell exposes expected landmarks and controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src/public/index.html'), 'utf8');
  for (const id of ['brand-name', 'brand-subtitle', 'hero-heading', 'layout-root', 'layout-toolbar', 'site-note', 'service-search', 'service-grid', 'admin-panel', 'modal', 'toast']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /role="tablist"/);
  assert.match(html, /role="tab"/);
  assert.match(html, /aria-controls="admin-content"/);
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
});

test('frontend styles include reduced-motion and mobile layout safeguards', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src/public/styles.css'), 'utf8');
  for (const token of ['@media (prefers-reduced-motion: reduce)', 'animation: none !important', 'transition: none !important', '@media (max-width: 720px)', '.grid { grid-template-columns: 1fr; }', 'scroll-snap-type: x proximity', '-webkit-overflow-scrolling: touch', 'max-height: calc(100dvh - 16px)', '.checklist-link', 'overflow-wrap: anywhere']) {
    assert.ok(css.includes(token), `missing CSS quality token ${token}`);
  }
});
