const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('frontend shell exposes expected landmarks and controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src/public/index.html'), 'utf8');
  for (const id of ['brand-name', 'service-search', 'service-grid', 'admin-panel', 'modal', 'toast']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('frontend script includes role-gated admin and launchpad behaviors', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src/public/app.js'), 'utf8');
  for (const token of ['isAdmin()', 'canEditServices()', 'renderServices()', 'adminPluginsHtml()', 'healthCheckEnabled', 'saveLaunchpadPreferences']) {
    assert.ok(js.includes(token), `missing ${token}`);
  }
});
