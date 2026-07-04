function renderAdminConsole() {
  const panel = $('admin-panel');
  if (!panel || !isAdmin()) return;
  document.querySelectorAll('.admin-tab').forEach((tab) => {
    const active = tab.dataset.adminTab === state.adminTab;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.tabIndex = active ? 0 : -1;
  });
  const content = $('admin-content');
  if (!state.admin.overview) { content.innerHTML = '<p>Loading admin console…</p>'; return; }
  const renderers = { overview: adminOverviewHtml, settings: adminSettingsHtml, appearance: adminAppearanceHtml, services: adminServicesHtml, users: adminUsersHtml, security: adminSecurityHtml, backups: adminBackupsHtml, plugins: adminPluginsHtml, logs: adminLogsHtml };
  content.innerHTML = renderers[state.adminTab]();
  bindAdminTabHandlers();
}
function statCard(label, value) { return `<div class="stat-card"><div class="tiny-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value)}</div></div>`; }
function checklistItem(done, label, detail, href) {
  const link = href ? `<a class="checklist-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Docs</a>` : '';
  return `<li class="checklist-item ${done ? 'done' : ''}"><strong>${done ? '✓' : '•'} ${escapeHtml(label)}</strong><span>${escapeHtml(detail)}</span>${link}</li>`;
}
function onboardingChecklistHtml() {
  const o = state.admin.overview || {};
  const h = state.admin.health || {};
  const c = state.admin.config || {};
  const highWarnings = (o.warnings || []).filter((w) => w.level === 'high');
  const backupLocation = Boolean(c.scheduledBackupLocation);
  const docsBase = 'https://github.com/TMASoft/home-lab-launcher/blob/main';
  return `<div class="settings-card beta-card"><div class="inline-between"><div><h3>Beta readiness checklist</h3><p>Use these links during first-run deployment review before exposing the launcher beyond a private LAN.</p></div><a class="ghost checklist-docs" href="${docsBase}/docs/release-checklist.md" target="_blank" rel="noopener noreferrer">Release checklist</a></div><ul class="checklist">${[
    checklistItem(highWarnings.length === 0, 'Secure bootstrap configuration', highWarnings.length ? 'Resolve high-severity configuration warnings.' : 'No high-severity warnings detected.', `${docsBase}/docs/deployment.md#first-admin-bootstrap`),
    checklistItem(Boolean(c.urls?.appBaseUrlValid), 'Set application base URL', c.urls?.appBaseUrl || 'Base URL is not configured.', `${docsBase}/docs/deployment.md#deployment-patterns`),
    checklistItem((o.counts?.services || 0) > 0, 'Add launchpad services', `${o.counts?.services || 0} services configured.`, `${docsBase}/README.md#launchpad-personalization-and-health`),
    checklistItem((h.plugins?.installed || 0) > 0, 'Review optional plugins', `${h.plugins?.installed || 0} plugins installed.`, `${docsBase}/docs/plugins.md`),
    checklistItem(backupLocation, 'Plan backups', backupLocation ? c.scheduledBackupLocation : 'Optional backup location is not configured yet.', `${docsBase}/docs/examples/backup-restore.md`),
    checklistItem(!c.security?.publicReadEnabled, 'Review public access', c.security?.publicReadEnabled ? 'Anonymous read-only access is enabled.' : 'Anonymous public read access is disabled.', `${docsBase}/docs/deployment.md#public-beta-hardening-notes`)
  ].join('')}</ul></div>`;
}
function adminOverviewHtml() {
  const o = state.admin.overview;
  const h = state.admin.health || {};
  const notices = (state.admin.notices || []).map((n) => `<li><strong>${escapeHtml(n.level)}</strong> — ${escapeHtml(n.title)}: ${escapeHtml(n.message)}</li>`).join('') || '<li>No active admin notices.</li>';
  const warnings = (o.warnings || []).map((w) => `<li><strong>${escapeHtml(w.level)}</strong> — ${escapeHtml(w.message)}</li>`).join('') || '<li>No configuration warnings detected.</li>';
  return `<div class="admin-stack"><div class="stats-row">${statCard('Users', o.counts.users)}${statCard('Services', o.counts.services)}${statCard('Plugins', `${h.plugins?.enabled ?? o.counts.plugins}/${h.plugins?.installed ?? o.counts.plugins} enabled`)}${statCard('Logs', o.counts.logs)}</div>
    <div class="settings-card"><h3>Runtime</h3><p><strong>Version:</strong> ${escapeHtml(o.runtime.appVersion || h.app?.version || 'unknown')} · <strong>Node:</strong> ${escapeHtml(o.runtime.node)} · <strong>Uptime:</strong> ${escapeHtml(o.runtime.uptimeSeconds)}s · <strong>Mode:</strong> ${escapeHtml(o.runtime.env)}</p><p><strong>Base URL:</strong> ${escapeHtml(o.settings.appBaseUrl || 'not set')}</p><p><strong>Database:</strong> ${formatBytes(o.runtime.databaseBytes || 0)}</p></div>
    ${onboardingChecklistHtml()}
    <div class="settings-card"><h3>Admin notices</h3><ul class="warning-list">${notices}</ul></div>
    <div class="settings-card"><h3>Configuration warnings</h3><ul class="warning-list">${warnings}</ul></div></div>`;
}
function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}
function getSyncStatusMessage(pc) {
  const status = pc.syncStatus;
  if (!status || !status.status || status.status === 'idle') return '';
  const timeStr = status.completedAt ? new Date(status.completedAt).toLocaleString() : '';
  const startStr = status.startedAt ? new Date(status.startedAt).toLocaleString() : '';
  if (status.status === 'running') {
    return `<span class="sync-status-text running">Syncing since ${escapeHtml(startStr)}...</span>`;
  }
  if (status.status === 'succeeded') {
    return `<span class="sync-status-text success">Catalog sync completed: ${status.synced} presets updated (at ${escapeHtml(timeStr)})</span>`;
  }
  if (status.status === 'failed') {
    return `<span class="sync-status-text danger">Catalog sync failed: ${escapeHtml(status.error || 'unknown error')} (at ${escapeHtml(timeStr)})</span>`;
  }
  return '';
}
function adminSettingsHtml() {
  const s = state.settings || {};
  const pc = state.admin.presetCatalog || {};
  const syncStatusHtml = getSyncStatusMessage(pc);
  const isSyncing = pc.syncStatus?.status === 'running';
  const isCooldown = pc.cooldownRemaining > 0;
  const isButtonDisabled = isSyncing || isCooldown;
  const updateBtnText = isCooldown ? `Update Catalog (${pc.cooldownRemaining}s)` : 'Update Catalog';
  const updateBtnDisabled = isButtonDisabled ? 'disabled' : '';

  return `<div class="admin-stack">
    <div class="settings-card"><h3>General</h3><div class="form-grid"><div class="row"><div class="field"><label>Application name</label><input id="admin-app-name" value="${escapeHtml(s.appName || '')}"></div><div class="field"><label>Base URL</label><input id="admin-base-url" value="${escapeHtml(s.appBaseUrl || '')}" placeholder="http://server-ip:8080 or https://portal.example.com"><small>Used for secure cookies, proxy checks, and beta readiness warnings.</small></div></div></div></div>
    <div class="settings-card"><h3>Access</h3><label class="check-line"><input id="admin-public-read" type="checkbox" ${s.publicReadEnabled ? 'checked' : ''}> Allow anonymous read-only access</label><p>Review this before exposing the launcher outside your LAN.</p><button class="primary" id="admin-save-settings" type="button">Save settings</button></div>
    <div class="settings-card"><h3>Health notifications</h3><p>POST a JSON notification when a monitored service goes down or recovers. The payload includes <code>title</code>, <code>message</code>, and <code>priority</code> (ntfy/Gotify) plus <code>content</code> (Discord), so most webhook receivers work directly.</p><div class="form-grid"><div class="row"><div class="field"><label>Webhook URL</label><input id="admin-health-webhook" value="${escapeHtml(state.admin.config?.healthWebhookUrl || '')}" placeholder="https://ntfy.sh/my-topic or a Discord webhook URL"><small>Leave empty to disable notifications.</small></div><div class="field"><label>Health history retention (days)</label><input id="admin-health-retention" type="number" min="1" max="90" value="${escapeHtml(state.admin.config?.healthHistoryRetentionDays ?? 7)}"><small>Health samples power the 24h uptime column and are pruned after this many days (1–90).</small></div></div><button class="primary" id="admin-save-health-settings" type="button">Save health settings</button></div></div>
    <div class="settings-card"><h3>Service preset catalog</h3><p>The preset catalog provides quick access to pre-configured service definitions when adding new services. Native presets are bundled with Home Lab Launcher. Heimdall presets are synced from the <a href="https://github.com/linuxserver/Heimdall-Apps" target="_blank" rel="noopener noreferrer">linuxserver/Heimdall-Apps</a> repository.</p><div class="stats-row">${statCard('Native presets', pc.counts?.local ?? '—')}${statCard('Heimdall presets', pc.counts?.heimdall ?? '—')}${statCard('Total presets', pc.counts?.total ?? '—')}</div><label class="check-line"><input id="admin-remote-presets" type="checkbox" ${pc.enableRemotePresets !== false ? 'checked' : ''}> Enable remote Heimdall presets</label><small>When disabled, only bundled native presets are available and the catalog will not sync from GitHub.</small><div class="inline-controls" style="margin-top: 12px;"><button class="ghost" id="catalog-update" type="button" ${updateBtnDisabled}>${updateBtnText}</button><span id="catalog-update-status" class="test-result">${syncStatusHtml}</span></div><button class="primary" id="save-preset-settings" type="button" style="margin-top: 10px;">Save preset settings</button></div>
  </div>`;
}


const themeColorFields = [
  ['background', 'Background'], ['surface', 'Surface'], ['surface2', 'Secondary surface'], ['text', 'Text'], ['mutedText', 'Muted text'], ['border', 'Border'], ['primary', 'Primary/accent'], ['success', 'Success'], ['warning', 'Warning'], ['danger', 'Danger']
];
function adminAppearanceHtml() {
  const a = state.admin.appearance || state.settings?.appearance || {};
  const b = a.brand || {};
  const h = a.hero || {};
  const t = a.theme || {};
  const colors = t.colors || {};
  const presets = state.admin.presets || [];
  return `<div class="admin-stack">
    <div class="settings-card"><div class="inline-between"><h3>Appearance & branding</h3><div class="inline-controls"><button class="ghost" id="appearance-preview" type="button">Preview without saving</button><button class="ghost" id="appearance-reset-unsaved" type="button">Reset unsaved</button><button class="ghost danger" id="appearance-restore-default" type="button">Restore default theme</button><button class="primary" id="appearance-save" type="button">Save appearance</button></div></div>
      <div class="appearance-preview" id="appearance-live-preview"><div class="brand"><span class="brand-mark">${escapeHtml(b.brandMarkText || 'HL')}</span><span><strong>${escapeHtml(b.brandText || b.appName || 'Home Lab Launcher')}</strong><small>${escapeHtml(b.brandSubtitle || 'Home lab control plane')}</small></span></div><h2>${escapeHtml(h.heading || '')}</h2><p>${h.subheading || ''}</p><article class="service-card"><div class="card-top"><span class="icon">🏠</span><span class="status-badge success">Preview</span></div><h3>Service tile</h3><p>Theme colors, radius, and density apply across the launcher.</p></article></div>
      <h3>Branding</h3><div class="form-grid">
        <div class="row"><div class="field"><label>Site/app name</label><input id="appearance-app-name" value="${escapeHtml(b.appName || '')}"></div><div class="field"><label>Browser page title</label><input id="appearance-page-title" value="${escapeHtml(b.pageTitle || '')}"></div></div>
        <div class="row"><div class="field"><label>Header brand text</label><input id="appearance-brand-text" value="${escapeHtml(b.brandText || '')}"></div><div class="field"><label>Header subtitle</label><input id="appearance-brand-subtitle" value="${escapeHtml(b.brandSubtitle || '')}"></div></div>
        <div class="row"><div class="field"><label>Brand mark initials</label><input id="appearance-brand-mark" value="${escapeHtml(b.brandMarkText || '')}" maxlength="8"></div><div class="field"><label>Footer/site note</label><input id="appearance-footer-note" value="${escapeHtml(b.footerNote || '')}"></div></div>
        ${assetFieldHtml('favicon', 'Favicon image', b.faviconUrl)}${assetFieldHtml('brand-icon', 'Brand icon image', b.brandIconUrl)}${assetFieldHtml('hero-image', 'Hero/header image', b.heroImageUrl)}
      </div>
      <div class="inline-between"><h3>Hero content</h3><button class="ghost" id="hero-visibility-toggle" type="button" data-enabled="${h.enabled === false ? 'false' : 'true'}">${h.enabled === false ? 'Show hero' : 'Hide hero'}</button></div><div class="form-grid"><div class="field"><label>Eyebrow</label><input id="appearance-hero-eyebrow" value="${escapeHtml(h.eyebrow || '')}"></div><div class="field"><label>Heading</label><input id="appearance-hero-heading" value="${escapeHtml(h.heading || '')}"></div><div class="field"><label>Subheading</label><small>Supported tags: <code>&lt;strong&gt;</code>, <code>&lt;em&gt;</code>, <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>, <code>&lt;code&gt;</code>, <code>&lt;br&gt;</code>, <code>&lt;p&gt;</code>, <code>&lt;ul&gt;</code>, <code>&lt;ol&gt;</code>, <code>&lt;li&gt;</code>, <code>&lt;a href&gt;</code> (http/https only).</small>
        <div class="rich-editor" id="subheading-rich-editor">
          <div class="rich-editor-toolbar">
            <div class="rich-editor-modes">
              <button type="button" class="ghost active" id="rich-editor-btn-visual">Visual</button>
              <button type="button" class="ghost" id="rich-editor-btn-code">HTML Code</button>
            </div>
            <div class="rich-editor-actions" id="rich-editor-actions">
              <button type="button" class="ghost" data-rich-command="bold" title="Bold"><b>B</b></button>
              <button type="button" class="ghost" data-rich-command="italic" title="Italic"><i>I</i></button>
              <button type="button" class="ghost" data-rich-command="underline" title="Underline"><u>U</u></button>
              <button type="button" class="ghost" data-rich-command="strikeThrough" title="Strikethrough"><s>S</s></button>
              <button type="button" class="ghost" data-rich-command="link" title="Insert Link">🔗</button>
              <button type="button" class="ghost" data-rich-command="unlink" title="Remove Link">🚫</button>
              <button type="button" class="ghost" data-rich-command="removeFormat" title="Clear Formatting">🧹</button>
            </div>
          </div>
          <div class="rich-editor-content-wrapper">
            <div id="appearance-hero-subheading-visual" class="rich-editor-visual" contenteditable="true" placeholder="Enter subheading HTML...">${h.subheading || ''}</div>
            <textarea id="appearance-hero-subheading-code" class="rich-editor-code" rows="4" style="display: none;">${escapeHtml(h.subheading || '')}</textarea>
          </div>
        </div>
      </div></div>
      <h3>Theme</h3><div class="form-grid"><div class="row"><div class="field"><label>Theme mode</label><select id="appearance-mode"><option value="dark" ${t.mode !== 'light' && t.mode !== 'system' ? 'selected' : ''}>Dark</option><option value="light" ${t.mode === 'light' ? 'selected' : ''}>Light</option><option value="system" ${t.mode === 'system' ? 'selected' : ''}>System</option></select></div><div class="field"><label>Font</label><select id="appearance-font"><option value="system" ${t.fontFamily === 'system' ? 'selected' : ''}>System default</option><option value="inter" ${t.fontFamily === 'inter' ? 'selected' : ''}>Inter/system sans</option><option value="serif" ${t.fontFamily === 'serif' ? 'selected' : ''}>Serif</option><option value="mono" ${t.fontFamily === 'mono' ? 'selected' : ''}>Mono</option><option value="custom" ${t.fontFamily === 'custom' ? 'selected' : ''}>Custom CSS font-family</option></select></div></div>
        <div class="field"><label>Custom font-family</label><input id="appearance-custom-font" value="${escapeHtml(t.customFontFamily || '')}" placeholder='ui-rounded, "SF Pro", sans-serif'></div>
        <div class="row"><div class="field"><label>Density</label><select id="appearance-density"><option value="compact" ${t.density === 'compact' ? 'selected' : ''}>Compact</option><option value="comfortable" ${t.density !== 'compact' && t.density !== 'spacious' ? 'selected' : ''}>Comfortable</option><option value="spacious" ${t.density === 'spacious' ? 'selected' : ''}>Spacious</option></select></div><div class="field"><label>Radius</label><select id="appearance-radius"><option value="square" ${t.radius === 'square' ? 'selected' : ''}>Square</option><option value="rounded" ${t.radius === 'rounded' ? 'selected' : ''}>Rounded</option><option value="soft" ${t.radius !== 'square' && t.radius !== 'rounded' ? 'selected' : ''}>Soft</option></select></div></div>
        <div class="color-grid">${themeColorFields.map(([key, label]) => `<div class="field"><label>${escapeHtml(label)}</label><input data-appearance-color="${escapeHtml(key)}" type="color" value="${escapeHtml(colors[key] || defaultColorFor(key))}"></div>`).join('')}</div></div></div>
    <div class="settings-card"><div class="inline-between"><h3>Theme presets</h3><div class="inline-controls"><button class="ghost" id="theme-save-preset" type="button">Save current as preset</button><button class="ghost" id="theme-import-preset" type="button">Import preset JSON</button></div></div><p>Preset exports include only appearance and branding data. They never include users, services, secrets, sessions, plugin configuration, or logs.</p><div class="log-list">${presets.map((p) => `<article class="log-item"><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.description || 'No description')}</span><div class="inline-controls"><button class="ghost" data-preset-apply="${escapeHtml(p.id)}" type="button">Apply</button><button class="ghost" data-preset-duplicate="${escapeHtml(p.id)}" type="button">Duplicate</button><button class="ghost" data-preset-export="${escapeHtml(p.id)}" type="button">Export</button><button class="ghost danger" data-preset-delete="${escapeHtml(p.id)}" type="button">Delete</button></div></article>`).join('') || '<p>No saved presets yet.</p>'}</div></div>
  </div>`;
}
function assetFieldHtml(id, label, value) {
  return `<div class="field"><label>${escapeHtml(label)}</label><div class="inline-controls"><input id="appearance-${id}-url" value="${escapeHtml(value || '')}" placeholder="/api/app-assets/..."><input id="appearance-${id}-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp"><button class="ghost" data-upload-app-asset="${escapeHtml(id)}" type="button">Upload</button></div><small>PNG, JPG, GIF, and WebP only. SVG is intentionally not accepted in this release.</small></div>`;
}
function defaultColorFor(key) {
  return { background: '#090c11', surface: '#0f141b', surface2: '#141a23', text: '#eef3f8', mutedText: '#a5afbb', border: '#273241', primary: '#8fd3ff', success: '#8ee6b0', warning: '#ffd27a', danger: '#ff8f9d' }[key] || '#8fd3ff';
}

function adminServicesHtml() {
  const categories = [...new Set(state.services.map((svc) => svc.category || 'general'))].sort();
  return `<div class="settings-card"><div class="inline-between"><h3>Service tools</h3><div><button class="ghost" id="export-services" type="button">Export services JSON</button></div></div>
    <p>Import services from a launcher export. Use upsert to add/update, or replace to delete existing services first.</p>
    <div class="field"><label>Import JSON</label><textarea id="services-import-json" rows="7" placeholder='{"services":[...]}'></textarea></div>
    <div class="inline-controls"><select id="services-import-mode"><option value="upsert">Upsert services</option><option value="replace">Replace all services</option></select><button class="primary" id="import-services" type="button">Import services</button></div>
    <h3>Manage services</h3><div class="inline-controls"><input id="admin-service-filter" placeholder="Filter services"><select id="bulk-action"><option value="enable">Enable selected</option><option value="disable">Disable selected</option><option value="feature">Feature selected</option><option value="unfeature">Unfeature selected</option><option value="delete">Delete selected</option></select><button class="ghost" id="apply-bulk-action" type="button">Apply</button><button class="primary" id="save-service-order" type="button">Save order</button></div>
    <div class="tag-row">${categories.map((cat) => `<button class="ghost service-category-chip" type="button" data-service-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`).join('')}<button class="ghost service-category-chip" type="button" data-service-category="">All</button></div>
    <div class="service-admin-list" id="service-admin-list">${serviceAdminRows(state.services)}</div></div>`;
}
function serviceAdminRows(services) {
  return services.map((svc) => `<article class="service-admin-row" tabindex="0" draggable="true" data-service-row="${escapeHtml(svc.id)}" data-service-search="${escapeHtml([svc.name, svc.url, svc.category, svc.description, ...(svc.tags || [])].join(' ').toLowerCase())}"><span class="drag-handle" title="Drag to reorder" aria-hidden="true">☰</span><input type="checkbox" aria-label="Select ${escapeHtml(svc.name)}" data-service-select="${escapeHtml(svc.id)}">${iconHtml(svc.icon, svc.name)}<div><strong>${escapeHtml(svc.name)}</strong><small>${escapeHtml(svc.category)} · ${svc.enabled ? 'enabled' : 'disabled'} · ${svc.featured ? 'featured' : 'not featured'}${serviceUptimeHtml(svc)}</small><small>${escapeHtml(svc.url)}</small></div><div class="service-row-actions"><button class="ghost" data-service-move="up" data-service-target="${escapeHtml(svc.id)}" type="button" aria-label="Move ${escapeHtml(svc.name)} up">↑</button><button class="ghost" data-service-move="down" data-service-target="${escapeHtml(svc.id)}" type="button" aria-label="Move ${escapeHtml(svc.name)} down">↓</button><button class="ghost" data-admin-edit-service="${escapeHtml(svc.id)}" type="button">Edit</button><button class="ghost" data-admin-duplicate-service="${escapeHtml(svc.id)}" type="button">Duplicate</button></div></article>`).join('');
}

function serviceUptimeHtml(svc) {
  const uptime = svc.health?.uptime24h;
  if (uptime === null || uptime === undefined) return '';
  const cls = uptime >= 99 ? 'success' : uptime >= 90 ? 'warning' : 'danger';
  return ` · <span class="uptime-badge ${cls}" title="Uptime over the last 24 hours">${escapeHtml(uptime)}% 24h</span>`;
}

function adminSecurityHtml() {
  const h = state.admin.health || {};
  const c = state.admin.config || {};
  const warnings = (h.warnings || []).map((w) => `<li><strong>${escapeHtml(w.level)}</strong> — ${escapeHtml(w.message)}</li>`).join('') || '<li>No security/config warnings detected.</li>';
  return `<div class="admin-stack"><div class="settings-card"><h3>Security posture</h3><ul class="warning-list">${warnings}</ul><div class="stats-row">${statCard('Active sessions', h.sessions?.active ?? '—')}${statCard('CSRF', state.csrfToken ? 'enabled' : 'missing')}${statCard('Headers', 'enabled')}${statCard('Cookie secure', c.security?.cookieSecure ? 'yes' : 'no')}</div><p>Security headers, CSRF checks, login throttling, and audit logging are enabled in this build.</p></div>
    <div class="settings-card"><h3>Effective configuration</h3><p><strong>Base URL valid:</strong> ${c.urls?.appBaseUrlValid ? 'yes' : 'no'} · <strong>Protocol:</strong> ${escapeHtml(c.urls?.appBaseUrlProtocol || 'unset')} · <strong>Behind proxy:</strong> ${c.urls?.behindProxy ? 'yes' : 'no'}</p><p><strong>Request:</strong> ${escapeHtml(c.urls?.requestProtocol || '')}://${escapeHtml(c.urls?.requestHost || '')} · <strong>Forwarded proto:</strong> ${escapeHtml(c.urls?.forwardedProto || 'none')}</p><p><strong>Log retention:</strong> ${escapeHtml(c.security?.logRetentionDays || 90)} days · <strong>Scheduled backup location:</strong> ${escapeHtml(c.scheduledBackupLocation || 'not configured')}</p></div>
    ${apiTokensCardHtml()}
    <div class="settings-card"><h3>Plugin and job health</h3><div class="stats-row">${statCard('Plugin failures', h.plugins?.failures?.length ?? 0)}${statCard('Plugin jobs', h.scheduledJobs?.plugins?.length ?? 0)}</div><div class="log-list">${(h.scheduledJobs?.plugins || []).map((j) => `<article class="log-item"><strong>${escapeHtml(j.name)}</strong><span>${escapeHtml(j.pluginId)} · every ${Math.round(j.intervalMs / 1000)}s · ${escapeHtml(j.lastStatus)}</span>${j.lastError ? `<code>${escapeHtml(j.lastError)}</code>` : ''}</article>`).join('') || '<p>No scheduled plugin jobs registered.</p>'}</div></div></div>`;
}

function apiTokensCardHtml() {
  const tokens = state.admin.apiTokens || [];
  const rows = tokens.map((t) => {
    const expires = t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : 'never';
    const lastUsed = t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'never';
    return `<tr><td><strong>${escapeHtml(t.name)}</strong><br><code>${escapeHtml(t.tokenPrefix)}…</code></td><td>${escapeHtml(roleLabel(t.role))}</td><td>${escapeHtml(expires)}</td><td>${escapeHtml(lastUsed)}</td><td><button class="ghost danger" data-api-token-revoke="${t.id}" data-api-token-name="${escapeHtml(t.name)}" type="button">Revoke</button></td></tr>`;
  }).join('');
  return `<div class="settings-card"><h3>API tokens</h3><p>Bearer tokens for automation (<code>Authorization: Bearer hll_…</code>). Tokens act with the selected role, cannot use session/profile endpoints, and are shown exactly once at creation.</p>
    <div class="table-wrap"><table><thead><tr><th>Token</th><th>Role</th><th>Expires</th><th>Last used</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5">No API tokens issued.</td></tr>'}</tbody></table></div>
    <h3>Create token</h3><div class="row"><input id="api-token-name" placeholder="name, e.g. ci-deploy" maxlength="80"><select id="api-token-role"><option value="user">Basic User (read)</option><option value="editor">Editor</option><option value="admin">Admin</option></select><input id="api-token-expires" type="number" min="1" max="3650" placeholder="expiry days (optional)"><button class="primary" id="api-token-create" type="button">Create token</button></div></div>`;
}

function adminBackupsHtml() {
  const h = state.admin.health || {};
  const c = state.admin.config || {};
  return `<div class="settings-card"><h3>Backups & storage</h3><p>Download a portable configuration backup containing settings, services, user names/roles, and plugin metadata. Password hashes, sessions, and private runtime data are not exported.</p><p class="callout"><strong>Note:</strong> backups include plugin configuration values, which may contain API tokens for connected services. Store backup files as secrets.</p><div class="inline-controls"><button class="primary" id="download-backup" type="button">Download config backup</button><button class="ghost" id="download-db" type="button">Download SQLite database</button></div><div class="stats-row">${statCard('Database', formatBytes(h.storage?.databaseBytes || 0))}${statCard('WAL', formatBytes(h.storage?.walBytes || 0))}</div><p><strong>Data dir:</strong> ${escapeHtml(h.storage?.dataDir || '')}</p><p><strong>Plugin dir:</strong> ${escapeHtml(h.storage?.pluginDir || '')}</p><h3>Scheduled backup location</h3><p>When set to a writable directory inside the container (mount a host volume for it), the launcher writes a daily config backup there and keeps the most recent 14 files. Leave empty to disable scheduled backups.</p><div class="inline-controls"><input id="scheduled-backup-location" value="${escapeHtml(c.scheduledBackupLocation || '')}" placeholder="/backups/home-lab-launcher"><button class="ghost" id="save-backup-location" type="button">Save path</button></div><h3>Restore configuration backup</h3><p>Restore settings and services from a Home Lab Launcher config backup. User passwords and active sessions are not changed.</p><div class="field"><label>Backup JSON</label><textarea id="restore-backup-json" rows="8" placeholder='{"format":"home-lab-launcher-config-v1",...}'></textarea></div><div class="inline-controls"><button class="ghost" id="preview-restore" type="button">Preview restore</button><button class="ghost danger" id="restore-backup" type="button">Restore backup</button></div><div id="restore-preview" class="restore-preview"></div></div>`;
}

function adminUsersHtml() {
  return `<div class="settings-card"><h3>User management</h3><div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>2FA</th><th>New password</th><th>Actions</th></tr></thead><tbody>${state.admin.users.map((u) => `
    <tr><td><input data-user-name="${u.id}" value="${escapeHtml(u.username)}"></td><td><select data-user-role="${u.id}"><option value="user" ${u.role === 'user' ? 'selected' : ''}>Basic User</option><option value="editor" ${u.role === 'editor' ? 'selected' : ''}>Editor</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select></td><td><span class="status-badge ${u.totpEnabled ? 'success' : ''}">${u.totpEnabled ? 'Enabled' : 'Disabled'}</span></td><td><input data-user-pass="${u.id}" type="password" placeholder="leave unchanged"></td><td><button class="ghost" data-user-save="${u.id}" type="button">Save</button>${u.totpEnabled ? `<button class="ghost warning" data-user-reset-2fa="${u.id}" type="button">Reset 2FA</button>` : ''}${u.id !== state.user.id ? `<button class="ghost danger" data-user-delete="${u.id}" type="button">Delete</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <h3>Add user</h3><div class="row"><input id="new-user" placeholder="username"><select id="new-role"><option value="user">Basic User</option><option value="editor">Editor</option><option value="admin">Admin</option></select></div><div class="row"><input id="new-pass" type="password" placeholder="temporary password, 10+ characters"><button class="primary" id="add-user" type="button" disabled>Add user</button></div><div id="add-user-error" class="form-error-banner" style="display: none;"></div></div>`;
}
function renderConfigFields(plugin) {
  const schema = plugin.manifest?.configSchema || {};
  const entries = Object.entries(schema);
  if (!entries.length) return '<p>No configurable settings exposed by this plugin.</p>';
  return entries.map(([key, spec]) => {
    const value = plugin.config?.[key] ?? spec.default ?? '';
    const scope = spec.scope || spec.access || spec.role || 'admin';
    const hint = `<small>Scope: ${escapeHtml(scope)}</small>`;
    if (spec.type === 'boolean') return `<label class="check-line"><input data-plugin-config-key="${escapeHtml(key)}" type="checkbox" ${value ? 'checked' : ''}> ${escapeHtml(spec.label || key)}</label>${hint}`;
    if (Array.isArray(spec.enum)) return `<div class="field"><label>${escapeHtml(spec.label || key)}</label><select data-plugin-config-key="${escapeHtml(key)}">${spec.enum.map((item) => `<option value="${escapeHtml(item)}" ${String(value) === String(item) ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></div>`;
    return `<div class="field"><label>${escapeHtml(spec.label || key)}</label><input data-plugin-config-key="${escapeHtml(key)}" type="${spec.type === 'number' ? 'number' : 'text'}" value="${escapeHtml(value)}"><small>${escapeHtml(spec.description || '')} Scope: ${escapeHtml(scope)}</small></div>`;
  }).join('');
}
function adminPluginsHtml() {
  const rows = state.admin.plugins.map((p) => {
    const permissions = (p.manifest?.permissions || []).map((perm) => `<span class="tag">${escapeHtml(perm)}</span>`).join('');
    const compat = p.compatibility?.compatible ? '<span class="status-badge success">Compatible</span>' : `<span class="status-badge danger">${escapeHtml(p.compatibility?.error || 'Incompatible')}</span>`;
    const update = p.update?.updateAvailable ? `<span class="status-badge warning">Update: ${escapeHtml(p.update.latest.version)}</span>` : '';
    return `<div class="plugin-row plugin-row-expanded" data-plugin-row="${escapeHtml(p.id)}"><div><strong>${escapeHtml(p.name)}</strong><br><small>${escapeHtml(p.sourceType)} · ${escapeHtml(p.sourceUrl)} · ${escapeHtml(p.version)} · ${escapeHtml(p.lifecycle || (p.enabled ? 'enabled' : 'disabled'))}</small><div class="service-meta">${compat}${update}<span class="status-badge">hash ${escapeHtml((p.installedHash || 'none').slice(0, 12))}</span></div><div class="tags">${permissions}</div>${p.lastError ? `<code>${escapeHtml(p.lastError)}</code>` : ''}</div><div class="service-row-actions"><button class="ghost" data-plugin-toggle="${escapeHtml(p.id)}" data-enabled="${p.enabled}" type="button">${p.enabled ? 'Disable' : 'Enable'}</button><button class="ghost" data-plugin-logs="${escapeHtml(p.id)}" type="button">Logs</button>${p.sourceType === 'github' ? `<button class="ghost" data-plugin-update="${escapeHtml(p.id)}" data-source="${escapeHtml(p.sourceUrl)}" type="button">Discover update</button>` : `<button class="ghost" data-plugin-reload-local="${escapeHtml(p.id)}" type="button">Reload</button>`}<button class="ghost danger" data-plugin-delete="${escapeHtml(p.id)}" type="button">Remove</button></div><div class="plugin-config"><h4>Configuration</h4><div class="form-grid" data-plugin-config="${escapeHtml(p.id)}">${renderConfigFields(p)}<button class="ghost" data-plugin-save-config="${escapeHtml(p.id)}" type="button">Save plugin config</button></div></div></div>`;
  }).join('') || '<p>No plugins installed.</p>';
  return `<div class="settings-card"><div class="inline-between"><h3>Plugin manager</h3><button class="ghost" id="plugins-reload" type="button">Reload plugins</button></div><div class="callout warning"><strong>Trusted code boundary</strong><p>Plugins are trusted code and can run server-side. Install or update plugins only from authors and commits you trust.</p><label class="check-line"><input id="plugin-trust-confirm" type="checkbox"> I understand plugins can run server-side code.</label></div>${rows}
    <h3>Install from GitHub</h3><div class="field"><label>Repository URL</label><input id="plugin-repo" placeholder="https://github.com/owner/repo"></div><div class="field"><label>Expected SHA-256 checksum (optional)</label><input id="plugin-expected-sha256" placeholder="64 hex characters from a trusted release note"><small>When provided, installation fails unless the downloaded archive matches exactly.</small></div><div class="inline-controls"><button class="ghost" id="plugin-discover" type="button">Discover versions</button><select id="plugin-version"></select><button class="primary" id="plugin-install" type="button">Install selected version</button></div><div id="plugin-release-notes" class="plugin-release-notes"></div>
    <h3>Local development plugin</h3><p id="local-plugin-help">Loading local plugin status…</p><div class="inline-controls"><input id="plugin-local-path" placeholder="/app/local-plugins/news"><button class="ghost" id="plugin-install-local" type="button">Install local plugin</button></div></div>`;
}

function adminLogsHtml() {
  const retention = state.admin.config?.security?.logRetentionDays || 90;
  return `<div class="settings-card"><div class="inline-between"><h3>Audit logs</h3><div class="inline-controls"><button class="ghost" id="export-logs" type="button">Export logs</button><button class="ghost" id="refresh-logs" type="button">Refresh logs</button></div></div><div class="inline-controls"><input id="log-query" placeholder="Search action, actor, or details"><select id="log-level"><option value="">All levels</option><option value="info">Info</option><option value="warn">Warn</option><option value="error">Error</option></select><button class="ghost" id="filter-logs" type="button">Filter</button></div><h3>Retention</h3><div class="inline-controls"><input id="log-retention-days" type="number" min="1" max="3650" value="${escapeHtml(retention)}"><button class="ghost" id="save-log-retention" type="button">Save retention</button><button class="ghost danger" id="prune-logs" type="button">Prune old logs</button></div><div class="log-list">${state.admin.logs.map((l) => `<article class="log-item"><strong>${escapeHtml(l.action)}</strong><span>${escapeHtml(l.level)} · ${escapeHtml(l.actorUsername || 'system')} · ${escapeHtml(l.ip || '')} · ${new Date(l.createdAt).toLocaleString()}</span><code>${escapeHtml(JSON.stringify(l.details || {}))}</code></article>`).join('') || '<p>No logs yet.</p>'}</div></div>`;
}

function bindAdminTabHandlers() {
  const content = $('admin-content');
  if (state.adminTab === 'settings') bindSettingsHandlers();
  if (state.adminTab === 'appearance') bindAppearanceHandlers(content);
  if (state.adminTab === 'services') bindServiceToolHandlers();
  if (state.adminTab === 'users') bindUserHandlers(content);
  if (state.adminTab === 'security') bindSecurityHandlers(content);
  if (state.adminTab === 'backups') bindBackupHandlers();
  if (state.adminTab === 'plugins') bindPluginHandlers(content);
  if (state.adminTab === 'logs') bindLogHandlers();
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function bindServiceToolHandlers() {
  $('export-services')?.addEventListener('click', async () => {
    const data = await api('/api/services/export');
    downloadJson(`home-lab-launcher-services-${new Date().toISOString().slice(0, 10)}.json`, data);
  });
  $('import-services')?.addEventListener('click', async () => {
    const payload = JSON.parse($('services-import-json').value || '{}');
    payload.mode = $('services-import-mode').value;
    const result = await api('/api/services/import', { method: 'POST', body: JSON.stringify(payload) });
    await Promise.all([loadServices(), loadAdminData()]);
    render(); toast(`Services imported: ${result.summary?.created ?? result.count} added, ${result.summary?.updated ?? 0} updated`);
  });
  bindServiceAdminList();
}
function bindServiceAdminList() {
  const list = $('service-admin-list');
  if (!list) return;
  let dragged = null;
  list.addEventListener('dragstart', (event) => { dragged = event.target.closest('[data-service-row]'); if (dragged) event.dataTransfer.effectAllowed = 'move'; });
  list.addEventListener('dragover', (event) => {
    event.preventDefault();
    const row = event.target.closest('[data-service-row]');
    if (!dragged || !row || row === dragged) return;
    const rect = row.getBoundingClientRect();
    list.insertBefore(dragged, event.clientY < rect.top + rect.height / 2 ? row : row.nextSibling);
  });
  list.addEventListener('dragend', () => { dragged = null; });
  list.addEventListener('click', async (event) => {
    const move = event.target.closest('[data-service-move]');
    const edit = event.target.closest('[data-admin-edit-service]');
    const duplicate = event.target.closest('[data-admin-duplicate-service]');
    if (move) {
      const row = move.closest('[data-service-row]');
      const sibling = move.dataset.serviceMove === 'up' ? row?.previousElementSibling : row?.nextElementSibling;
      if (row && sibling) {
        if (move.dataset.serviceMove === 'up') list.insertBefore(row, sibling);
        else list.insertBefore(sibling, row);
        row.focus?.();
      }
    }
    if (edit) showServiceModal(state.services.find((svc) => svc.id === edit.dataset.adminEditService));
    if (duplicate) {
      await api(`/api/services/${duplicate.dataset.adminDuplicateService}/duplicate`, { method: 'POST', body: JSON.stringify({}) });
      await Promise.all([loadServices(), loadAdminData()]);
      render(); toast('Service duplicated');
    }
  });
  $('save-service-order')?.addEventListener('click', async () => {
    const ids = [...list.querySelectorAll('[data-service-row]')].map((row) => row.dataset.serviceRow);
    await api('/api/services/reorder', { method: 'PATCH', body: JSON.stringify({ ids }) });
    await Promise.all([loadServices(), loadAdminData()]);
    render(); toast('Service order saved');
  });
  $('apply-bulk-action')?.addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('[data-service-select]:checked')].map((box) => box.dataset.serviceSelect);
    if (!ids.length) return toast('Select at least one service');
    const action = $('bulk-action').value;
    if (action === 'delete' && !confirm(`Delete ${ids.length} selected services?`)) return;
    await api('/api/services/bulk', { method: 'PATCH', body: JSON.stringify({ ids, action }) });
    await Promise.all([loadServices(), loadAdminData()]);
    render(); toast('Bulk action applied');
  });
  $('admin-service-filter')?.addEventListener('input', filterServiceAdminRows);
  document.querySelectorAll('[data-service-category]').forEach((button) => button.addEventListener('click', () => { $('admin-service-filter').value = button.dataset.serviceCategory || ''; filterServiceAdminRows(); }));
}
function filterServiceAdminRows() {
  const q = formValue('admin-service-filter').toLowerCase();
  document.querySelectorAll('[data-service-row]').forEach((row) => { row.hidden = q && !row.dataset.serviceSearch.includes(q); });
}

function bindSecurityHandlers(content) {
  $('api-token-create')?.addEventListener('click', async () => {
    const name = formValue('api-token-name');
    if (!name) return toast('Enter a token name');
    const body = { name, role: $('api-token-role').value };
    const days = formValue('api-token-expires');
    if (days) body.expiresDays = Number(days);
    const result = await api('/api/admin/api-tokens', { method: 'POST', body: JSON.stringify(body) });
    await loadAdminData();
    openModal(`<h2>API token created</h2><p>Copy this token now — it is shown exactly once and cannot be retrieved later.</p><p><code class="token-reveal" id="new-api-token">${escapeHtml(result.token)}</code></p><div class="inline-controls"><button class="primary" id="copy-api-token" type="button">Copy to clipboard</button></div>`);
    $('copy-api-token')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(result.token);
      toast('Token copied to clipboard');
    });
  });
  content?.addEventListener('click', async (event) => {
    const revoke = event.target.closest('[data-api-token-revoke]');
    if (!revoke) return;
    if (!confirm(`Revoke API token "${revoke.dataset.apiTokenName}"? Automation using it stops working immediately.`)) return;
    await api(`/api/admin/api-tokens/${revoke.dataset.apiTokenRevoke}`, { method: 'DELETE' });
    await loadAdminData();
    toast('API token revoked');
  });
}

function bindBackupHandlers() {
  $('download-backup')?.addEventListener('click', async () => {
    const data = await api('/api/admin/backup');
    downloadJson(`home-lab-launcher-backup-${new Date().toISOString().slice(0, 10)}.json`, data);
  });
  $('download-db')?.addEventListener('click', () => { window.location.href = '/api/admin/database/export'; });
  $('save-backup-location')?.addEventListener('click', async () => {
    await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ scheduled_backup_location: formValue('scheduled-backup-location') }) });
    await loadAdminData(); toast('Backup path note saved');
  });
  $('preview-restore')?.addEventListener('click', async () => {
    const payload = JSON.parse($('restore-backup-json').value || '{}');
    const data = await api('/api/admin/restore/preview', { method: 'POST', body: JSON.stringify(payload) });
    const c = data.preview.counts;
    $('restore-preview').innerHTML = `<div class="callout"><strong>Restore preview</strong><p>${escapeHtml(c.settings)} settings, ${escapeHtml(c.validServices)}/${escapeHtml(c.services)} valid services, ${escapeHtml(c.serviceConflicts)} service conflicts, ${escapeHtml(c.plugins)} plugin metadata entries, ${escapeHtml(c.users)} user metadata entries.</p><ul>${data.preview.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>`;
  });
  $('restore-backup')?.addEventListener('click', async () => {
    const payload = JSON.parse($('restore-backup-json').value || '{}');
    const data = await api('/api/admin/restore/preview', { method: 'POST', body: JSON.stringify(payload) });
    const c = data.preview.counts;
    if (!confirm(`Restore backup? This applies ${c.settings} settings and replaces current services with ${c.validServices} valid services. Plugin code, users, and sessions will not be imported.`)) return;
    await api('/api/admin/restore', { method: 'POST', body: JSON.stringify(payload) });
    await Promise.all([loadSettings(), loadServices(), loadAdminData()]);
    render(); toast('Backup restored');
  });
}

function bindLogHandlers() {
  $('refresh-logs')?.addEventListener('click', loadAdminData);
  $('export-logs')?.addEventListener('click', async () => {
    const data = await api('/api/admin/logs/export');
    downloadJson(`home-lab-launcher-logs-${new Date().toISOString().slice(0, 10)}.json`, data);
  });
  $('save-log-retention')?.addEventListener('click', async () => {
    await api('/api/admin/logs/retention', { method: 'PATCH', body: JSON.stringify({ days: Number($('log-retention-days').value || 90) }) });
    await loadAdminData(); toast('Log retention updated');
  });
  $('prune-logs')?.addEventListener('click', async () => {
    if (!confirm('Delete audit logs older than the retention window?')) return;
    const result = await api('/api/admin/logs/prune', { method: 'POST' });
    await loadAdminData(); toast(`Pruned ${result.deleted} old logs`);
  });
  $('filter-logs')?.addEventListener('click', async () => {
    const params = new URLSearchParams({ limit: '100' });
    if (formValue('log-query')) params.set('q', formValue('log-query'));
    if ($('log-level').value) params.set('level', $('log-level').value);
    state.admin.logs = (await api(`/api/admin/logs?${params.toString()}`)).logs;
    renderAdminConsole();
  });
}

function bindSettingsHandlers() {
  $('admin-save-settings')?.addEventListener('click', async () => {
    await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ app_name: formValue('admin-app-name'), app_base_url: formValue('admin-base-url'), public_read_enabled: $('admin-public-read').checked }) });
    await Promise.all([loadSettings(), loadAdminData()]);
    render(); toast('Settings saved');
  });
  $('admin-save-health-settings')?.addEventListener('click', async () => {
    await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ health_webhook_url: formValue('admin-health-webhook'), health_history_retention_days: Number($('admin-health-retention').value || 7) }) });
    await loadAdminData();
    toast('Health settings saved');
  });
  $('save-preset-settings')?.addEventListener('click', async () => {
    await api('/api/admin/presets/settings', { method: 'PUT', body: JSON.stringify({ enableRemotePresets: $('admin-remote-presets').checked }) });
    await loadAdminData();
    toast('Preset settings saved');
  });

  const pc = state.admin.presetCatalog || {};
  if (pc.cooldownRemaining > 0 && !catalogCooldownTimer) {
    startCatalogCooldown(pc.cooldownRemaining);
  }
  if (pc.syncStatus?.status === 'running' && !catalogSyncPollInterval) {
    startSyncStatusPolling();
  }

  $('catalog-update')?.addEventListener('click', async () => {
    const status = $('catalog-update-status');
    try {
      await api('/api/admin/presets/update', { method: 'POST' });
      status.innerHTML = `<span class="sync-status-text running">Sync started...</span>`;
      
      // Start cooldown countdown (60s)
      startCatalogCooldown(60);
      
      // Start status polling
      startSyncStatusPolling();
    } catch (error) {
      status.innerHTML = `<span class="sync-status-text danger">${escapeHtml(error.message)}</span>`;
    }
  });
}

let catalogCooldownTimer = null;
let catalogSyncPollInterval = null;

function startCatalogCooldown(remaining) {
  if (catalogCooldownTimer) clearInterval(catalogCooldownTimer);
  const btn = $('catalog-update');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = `Update Catalog (${remaining}s)`;

  let time = remaining;
  catalogCooldownTimer = setInterval(() => {
    time -= 1;
    if (time <= 0) {
      clearInterval(catalogCooldownTimer);
      catalogCooldownTimer = null;
      // Only enable if sync is not running
      const currentSyncStatus = state.admin.presetCatalog?.syncStatus?.status;
      if (currentSyncStatus !== 'running') {
        const updateBtn = $('catalog-update');
        if (updateBtn) updateBtn.disabled = false;
      }
      const updateBtn = $('catalog-update');
      if (updateBtn) updateBtn.textContent = 'Update Catalog';
    } else {
      const updateBtn = $('catalog-update');
      if (updateBtn) updateBtn.textContent = `Update Catalog (${time}s)`;
    }
  }, 1000);
}

function startSyncStatusPolling() {
  if (catalogSyncPollInterval) clearInterval(catalogSyncPollInterval);
  const btn = $('catalog-update');
  if (btn) btn.disabled = true;

  catalogSyncPollInterval = setInterval(async () => {
    try {
      const data = await api('/api/admin/presets/settings');
      state.admin.presetCatalog = data;
      const status = data.syncStatus || {};

      const statusEl = $('catalog-update-status');
      if (statusEl) {
        statusEl.innerHTML = getSyncStatusMessage(data);
      }

      if (status.status !== 'running') {
        clearInterval(catalogSyncPollInterval);
        catalogSyncPollInterval = null;

        // Reload data and re-render the admin console
        await Promise.all([loadSettings(), loadAdminData()]);
        render();
      }
    } catch (err) {
      console.error('Error polling preset catalog sync status:', err);
    }
  }, 2000);
}


function readAppearanceForm() {
  const colors = {};
  document.querySelectorAll('[data-appearance-color]').forEach((input) => { colors[input.dataset.appearanceColor] = input.value; });
  return {
    version: 1,
    brand: {
      appName: formValue('appearance-app-name') || 'Home Lab Launcher',
      pageTitle: formValue('appearance-page-title') || formValue('appearance-app-name') || 'Home Lab Launcher',
      brandText: formValue('appearance-brand-text') || formValue('appearance-app-name') || 'Home Lab Launcher',
      brandSubtitle: formValue('appearance-brand-subtitle'),
      brandMarkText: formValue('appearance-brand-mark') || 'HL',
      faviconUrl: formValue('appearance-favicon-url'),
      brandIconUrl: formValue('appearance-brand-icon-url'),
      heroImageUrl: formValue('appearance-hero-image-url'),
      footerNote: formValue('appearance-footer-note')
    },
    hero: {
      enabled: $('hero-visibility-toggle')?.dataset.enabled !== 'false',
      eyebrow: formValue('appearance-hero-eyebrow'),
      heading: formValue('appearance-hero-heading'),
      subheading: (() => {
        const visual = $('appearance-hero-subheading-visual');
        const code = $('appearance-hero-subheading-code');
        if (!visual || !code) return '';
        const isCodeActive = code.style.display !== 'none';
        return isCodeActive ? code.value : visual.innerHTML;
      })()
    },
    theme: {
      mode: $('appearance-mode')?.value || 'dark',
      fontFamily: $('appearance-font')?.value || 'system',
      customFontFamily: formValue('appearance-custom-font'),
      density: $('appearance-density')?.value || 'comfortable',
      radius: $('appearance-radius')?.value || 'soft',
      colors
    }
  };
}
async function uploadAppearanceAsset(id) {
  const file = $(`appearance-${id}-file`)?.files?.[0];
  if (!file) throw new Error('Choose an image file first');
  if (file.size > 5 * 1024 * 1024) throw new Error('Asset image must be 5 MiB or smaller');
  const data = await api('/api/app-assets', { method: 'POST', body: JSON.stringify({ assetData: await readFileAsDataUrl(file), name: file.name }) });
  $(`appearance-${id}-url`).value = data.url;
  return data.url;
}
function bindAppearanceHandlers(content) {
  $('hero-visibility-toggle')?.addEventListener('click', () => {
    const button = $('hero-visibility-toggle');
    const enabled = button.dataset.enabled !== 'false';
    const nextEnabled = !enabled;
    button.disabled = true;
    const appearance = readAppearanceForm();
    appearance.hero.enabled = nextEnabled;
    api('/api/admin/appearance', { method: 'PUT', body: JSON.stringify({ appearance }) })
      .then(async (data) => {
        button.dataset.enabled = nextEnabled ? 'true' : 'false';
        button.textContent = nextEnabled ? 'Hide hero' : 'Show hero';
        state.admin.appearance = data.appearance;
        await Promise.all([loadSettings(), loadAdminData()]);
        render();
        toast(nextEnabled ? 'Hero shown' : 'Hero hidden');
      })
      .catch((error) => toast(error.message))
      .finally(() => { button.disabled = false; });
  });
  // Subheading rich editor tab switching and toolbar logic
  const visualBtn = $('rich-editor-btn-visual');
  const codeBtn = $('rich-editor-btn-code');
  const visualEl = $('appearance-hero-subheading-visual');
  const codeEl = $('appearance-hero-subheading-code');
  const toolbarActions = $('rich-editor-actions');

  visualBtn?.addEventListener('click', () => {
    if (visualBtn.classList.contains('active')) return;
    visualBtn.classList.add('active');
    codeBtn.classList.remove('active');
    visualEl.innerHTML = codeEl.value;
    codeEl.style.display = 'none';
    visualEl.style.display = 'block';
    if (toolbarActions) {
      toolbarActions.style.pointerEvents = 'auto';
      toolbarActions.style.opacity = '1';
    }
  });

  codeBtn?.addEventListener('click', () => {
    if (codeBtn.classList.contains('active')) return;
    codeBtn.classList.add('active');
    visualBtn.classList.remove('active');
    codeEl.value = visualEl.innerHTML;
    visualEl.style.display = 'none';
    codeEl.style.display = 'block';
    if (toolbarActions) {
      toolbarActions.style.pointerEvents = 'none';
      toolbarActions.style.opacity = '0.5';
    }
  });

  toolbarActions?.querySelectorAll('[data-rich-command]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent losing focus/selection
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const command = btn.dataset.richCommand;
      if (command === 'link') {
        const url = prompt('Enter the link URL (e.g. https://google.com):');
        if (url) {
          document.execCommand('createLink', false, url);
        }
      } else {
        document.execCommand(command, false, null);
      }
      visualEl?.focus();
    });
  });

  content.querySelectorAll('[data-upload-app-asset]').forEach((button) => button.addEventListener('click', async () => {
    try { await uploadAppearanceAsset(button.dataset.uploadAppAsset); toast('Asset uploaded'); } catch (error) { toast(error.message); }
  }));
  $('appearance-preview')?.addEventListener('click', () => { applyAppearance(readAppearanceForm()); toast('Preview applied locally'); });
  $('appearance-reset-unsaved')?.addEventListener('click', () => {
    applyAppearance(state.admin.appearance || state.settings?.appearance || {});
    renderAdminConsole();
  });
  $('appearance-restore-default')?.addEventListener('click', async () => {
    if (!confirm('Restore the default theme and branding?')) return;
    const data = await api('/api/admin/appearance/reset', { method: 'POST' });
    state.admin.appearance = data.appearance;
    await loadSettings();
    renderAdminConsole();
    toast('Default theme restored');
  });
  $('appearance-save')?.addEventListener('click', async () => {
    const data = await api('/api/admin/appearance', { method: 'PUT', body: JSON.stringify({ appearance: readAppearanceForm() }) });
    state.admin.appearance = data.appearance;
    await Promise.all([loadSettings(), loadAdminData()]);
    render(); toast('Appearance saved');
  });
  $('theme-save-preset')?.addEventListener('click', async () => {
    const name = prompt('Preset name', 'My theme');
    if (!name) return;
    const description = prompt('Preset description', '') || '';
    await api('/api/admin/theme-presets', { method: 'POST', body: JSON.stringify({ name, description, appearance: readAppearanceForm() }) });
    await loadAdminData(); toast('Preset saved');
  });
  $('theme-import-preset')?.addEventListener('click', () => {
    openModal(`<h2>Import theme preset</h2><p>Only safe appearance fields are imported.</p><div class="field"><label>Preset JSON</label><textarea id="theme-import-json" rows="10" placeholder='{"format":"home-lab-launcher-theme-v1",...}'></textarea></div><div id="theme-import-error" class="form-error-banner" style="display: none;"></div><button class="primary" id="theme-import-confirm" type="button">Import preset</button>`);
    $('theme-import-confirm').onclick = async () => {
      const errorEl = $('theme-import-error');
      if (errorEl) {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
      }
      try {
        const payload = JSON.parse($('theme-import-json').value || '{}');
        if (!confirm(`Import preset "${payload.name || 'Untitled'}"?`)) return;
        await api('/api/admin/theme-presets/import', { method: 'POST', body: JSON.stringify(payload) });
        closeModal(); await loadAdminData(); toast('Preset imported');
      } catch (error) {
        if (errorEl) {
          errorEl.textContent = error.message;
          errorEl.style.display = 'flex';
        } else {
          toast(error.message);
        }
      }
    };
  });
  content.querySelectorAll('[data-preset-apply]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Apply this preset to the global site appearance?')) return;
    const data = await api(`/api/admin/theme-presets/${button.dataset.presetApply}/apply`, { method: 'POST' });
    state.admin.appearance = data.appearance;
    await Promise.all([loadSettings(), loadAdminData()]);
    render(); toast('Preset applied');
  }));
  content.querySelectorAll('[data-preset-duplicate]').forEach((button) => button.addEventListener('click', async () => {
    const preset = state.admin.presets.find((p) => p.id === button.dataset.presetDuplicate);
    if (!preset) return;
    await api('/api/admin/theme-presets', { method: 'POST', body: JSON.stringify({ name: `${preset.name} Copy`, description: preset.description, appearance: preset.appearance }) });
    await loadAdminData(); toast('Preset duplicated');
  }));
  content.querySelectorAll('[data-preset-export]').forEach((button) => button.addEventListener('click', async () => {
    const data = await api(`/api/admin/theme-presets/${button.dataset.presetExport}/export`);
    downloadJson(`${(data.name || 'theme').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'theme'}-theme.json`, data);
  }));
  content.querySelectorAll('[data-preset-delete]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Delete this theme preset?')) return;
    await api(`/api/admin/theme-presets/${button.dataset.presetDelete}`, { method: 'DELETE' });
    await loadAdminData(); toast('Preset deleted');
  }));
}
function bindUserHandlers(content) {
  const newUserInput = content.querySelector('#new-user');
  const newPassInput = content.querySelector('#new-pass');
  const addUserButton = content.querySelector('#add-user');
  const addUserError = content.querySelector('#add-user-error');
  const setAddUserError = (message) => {
    if (!addUserError) return;
    addUserError.textContent = message || '';
    addUserError.style.display = message ? 'flex' : 'none';
  };
  const addUserValidationMessage = () => {
    if ((newUserInput?.value || '').trim().length < 3) return 'Username must be at least 3 characters.';
    if ((newPassInput?.value || '').length < 10) return 'Password must be at least 10 characters.';
    return '';
  };
  const updateAddUserState = () => {
    const message = addUserValidationMessage();
    if (addUserButton) addUserButton.disabled = Boolean(message);
    setAddUserError(message && (newUserInput?.value || newPassInput?.value) ? message : '');
  };
  [newUserInput, newPassInput].forEach((input) => input?.addEventListener('input', updateAddUserState));
  updateAddUserState();
  content.querySelector('#add-user')?.addEventListener('click', async () => {
    const validationMessage = addUserValidationMessage();
    if (validationMessage) {
      setAddUserError(validationMessage);
      toast(validationMessage);
      return;
    }
    try {
      await api('/api/users', { method: 'POST', body: JSON.stringify({ username: formValue('new-user'), password: formValue('new-pass'), role: $('new-role').value }) });
      await loadAdminData(); toast('User added');
    } catch (error) {
      setAddUserError(error.message);
      toast(error.message);
    }
  });
  content.querySelectorAll('[data-user-save]').forEach((button) => button.addEventListener('click', async () => {
    const id = button.dataset.userSave;
    const body = { username: document.querySelector(`[data-user-name="${id}"]`).value, role: document.querySelector(`[data-user-role="${id}"]`).value };
    const password = document.querySelector(`[data-user-pass="${id}"]`).value;
    if (password) body.password = password;
    await api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    await loadSession(); await loadAdminData(); render(); toast('User saved');
  }));
  content.querySelectorAll('[data-user-reset-2fa]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Reset 2FA for this user? This will disable 2FA immediately.')) return;
    const id = button.dataset.userReset2fa;
    await api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ resetTotp: true }) });
    await loadAdminData(); toast('2FA reset for user');
  }));
  content.querySelectorAll('[data-user-delete]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Delete this user?')) return;
    await api(`/api/users/${button.dataset.userDelete}`, { method: 'DELETE' });
    await loadAdminData(); toast('User deleted');
  }));
}
function readPluginConfig(id) {
  const root = document.querySelector(`[data-plugin-config="${CSS.escape(id)}"]`);
  const config = {};
  root?.querySelectorAll('[data-plugin-config-key]').forEach((input) => {
    const key = input.dataset.pluginConfigKey;
    if (input.type === 'checkbox') config[key] = input.checked;
    else if (input.type === 'number') config[key] = Number(input.value);
    else config[key] = input.value;
  });
  return config;
}
function bindPluginHandlers(content) {
  $('plugins-reload')?.addEventListener('click', async () => { await api('/api/plugins/reload', { method: 'POST' }); await Promise.all([loadAdminData(), loadPluginSections()]); render(); toast('Plugins reloaded'); });
  content.querySelectorAll('[data-plugin-save-config]').forEach((button) => button.addEventListener('click', async () => {
    await api(`/api/plugins/${button.dataset.pluginSaveConfig}/config`, { method: 'PUT', body: JSON.stringify({ config: readPluginConfig(button.dataset.pluginSaveConfig) }) });
    await Promise.all([loadAdminData(), loadPluginSections()]); render(); toast('Plugin config saved');
  }));
  content.querySelectorAll('[data-plugin-logs]').forEach((button) => button.addEventListener('click', async () => {
    const data = await api(`/api/plugins/${button.dataset.pluginLogs}/logs`);
    openModal(`<h2>Plugin logs: ${escapeHtml(button.dataset.pluginLogs)}</h2><div class="log-list">${data.logs.map((l) => `<article class="log-item"><strong>${escapeHtml(l.action)}</strong><span>${escapeHtml(l.level)} · ${new Date(l.createdAt).toLocaleString()}</span><code>${escapeHtml(JSON.stringify(l.details || {}))}</code></article>`).join('') || '<p>No plugin logs yet.</p>'}</div>`);
  }));
  content.querySelectorAll('[data-plugin-update]').forEach((button) => button.addEventListener('click', async () => {
    const data = await api(`/api/plugin-sources/github/versions?repo=${encodeURIComponent(button.dataset.source)}`);
    const latest = data.versions[0];
    if (!latest) return toast('No versions found');
    openModal(`<h2>Update ${escapeHtml(button.dataset.pluginUpdate)}</h2><p><strong>Latest:</strong> ${escapeHtml(latest.version)} (${escapeHtml(latest.type)})</p><pre class="release-notes">${escapeHtml((latest.body || 'No release notes available.').slice(0, 4000))}</pre><button class="primary" id="confirm-plugin-update" type="button">Update to ${escapeHtml(latest.version)}</button>`);
    $('confirm-plugin-update').onclick = async () => { const expectedSha256 = prompt('Optional expected SHA-256 checksum for this archive. Leave blank to skip verification.', '') || ''; await api(`/api/plugins/${button.dataset.pluginUpdate}/update`, { method: 'POST', body: JSON.stringify({ version: latest.version, expectedSha256, trustConfirmed: true }) }); closeModal(); await Promise.all([loadAdminData(), loadPluginSections()]); render(); toast('Plugin updated'); };
  }));
  content.querySelectorAll('[data-plugin-reload-local]').forEach((button) => button.addEventListener('click', async () => { await api('/api/plugins/reload', { method: 'POST' }); await Promise.all([loadAdminData(), loadPluginSections()]); render(); toast('Local plugin reloaded'); }));
  content.querySelectorAll('[data-plugin-toggle]').forEach((button) => button.addEventListener('click', async () => {
    await api(`/api/plugins/${button.dataset.pluginToggle}`, { method: 'PATCH', body: JSON.stringify({ enabled: button.dataset.enabled !== 'true' }) });
    await Promise.all([loadAdminData(), loadPluginSections()]); render(); toast('Plugin updated');
  }));
  content.querySelectorAll('[data-plugin-delete]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('Remove this plugin?')) return;
    await api(`/api/plugins/${button.dataset.pluginDelete}`, { method: 'DELETE' });
    await Promise.all([loadAdminData(), loadPluginSections()]); render(); toast('Plugin removed');
  }));
  $('plugin-discover')?.addEventListener('click', async () => {
    const data = await api(`/api/plugin-sources/github/versions?repo=${encodeURIComponent(formValue('plugin-repo'))}`);
    $('plugin-version').innerHTML = data.versions.map((v, i) => `<option value="${escapeHtml(v.version)}" data-notes="${escapeHtml(v.body || '')}">${escapeHtml(v.version)} (${escapeHtml(v.type)})</option>`).join('');
    const first = data.versions[0];
    $('plugin-release-notes').innerHTML = first ? `<pre class="release-notes">${escapeHtml((first.body || 'No release notes available.').slice(0, 2000))}</pre>` : '';
    if (!first) toast('No releases or tags found for this GitHub repository');
  });
  $('plugin-version')?.addEventListener('change', () => {
    const option = $('plugin-version').selectedOptions[0];
    $('plugin-release-notes').innerHTML = option ? `<pre class="release-notes">${escapeHtml((option.dataset.notes || 'No release notes available.').slice(0, 2000))}</pre>` : '';
  });
  $('plugin-install')?.addEventListener('click', async () => {
    if (!$('plugin-trust-confirm')?.checked) return toast('Confirm the plugin trust boundary before installing');
    await api('/api/plugins/install', { method: 'POST', body: JSON.stringify({ repoUrl: formValue('plugin-repo'), version: $('plugin-version').value, expectedSha256: formValue('plugin-expected-sha256'), trustConfirmed: true }) });
    await Promise.all([loadAdminData(), loadPluginSections()]); render(); toast('Plugin installed');
  });
  api('/api/plugin-sources/local/status').then((status) => {
    const help = $('local-plugin-help');
    if (help) help.textContent = status.enabled
      ? `Enabled. Docker users should mount ${status.hostDir} to ${status.containerDir} and enter ${status.containerDir}/<plugin-id>. Host paths under ${status.hostDir} are auto-mapped when possible.`
      : `Disabled. Set ENABLE_LOCAL_PLUGIN_INSTALL=true and mount LOCAL_PLUGIN_HOST_DIR to enable local plugin installs.`;
  }).catch(() => {});
  $('plugin-install-local')?.addEventListener('click', async () => {
    const button = $('plugin-install-local');
    try {
      button.disabled = true;
      button.textContent = 'Installing…';
      if (!$('plugin-trust-confirm')?.checked) throw new Error('Confirm the plugin trust boundary before installing');
      await api('/api/plugins/install-local', { method: 'POST', body: JSON.stringify({ path: formValue('plugin-local-path'), trustConfirmed: true }) });
      await Promise.all([loadAdminData(), loadPluginSections()]); render(); toast('Local plugin installed');
    } catch (error) {
      toast(error.message);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Install local plugin'; }
    }
  });
}
