const state = {
  user: null,
  services: [],
  favorites: [],
  preferences: { viewMode: 'cards', hiddenCategories: [] },
  selectedCategory: '',
  settings: null,
  pluginSections: [],
  csrfToken: null,
  adminTab: 'overview',
  admin: { overview: null, health: null, config: null, notices: [], users: [], plugins: [], logs: [] }
};

const $ = (id) => document.getElementById(id);
const modal = $('modal');
const modalContent = $('modal-content');

const api = async (path, options = {}) => {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(state.csrfToken && ['POST','PUT','PATCH','DELETE'].includes(String(options.method || 'GET').toUpperCase()) ? { 'X-CSRF-Token': state.csrfToken } : {}), ...(options.headers || {}) },
    ...options
  });
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try { message = (await res.json()).error || message; } catch {}
    throw new Error(message);
  }
  return res.json();
};

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const getHost = (url) => { try { return new URL(url).host; } catch { return String(url).replace(/^https?:\/\//, ''); } };
const isHttpUrl = (value) => { try { const parsed = new URL(String(value)); return ['http:', 'https:'].includes(parsed.protocol); } catch { return false; } };
const isStoredIconImage = (value) => String(value || '').startsWith('/api/service-icons/');
function iconHtml(icon, label = 'Service icon') {
  const value = String(icon || '🔗');
  if (isStoredIconImage(value)) return `<span class="icon image-icon"><img src="${escapeHtml(value)}" alt="" loading="lazy"></span>`;
  if (isHttpUrl(value)) return `<span class="icon" title="This service has an external icon URL that has not been downloaded yet"><span class="icon-fallback">IMG</span></span>`;
  return `<span class="icon" aria-hidden="true" title="${escapeHtml(label)}">${escapeHtml(value)}</span>`;
}
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}
const canEditServices = () => ['admin', 'editor'].includes(state.user?.role);
const isAdmin = () => state.user?.role === 'admin';
const roleLabel = (role) => ({ admin: 'Admin', editor: 'Editor', user: 'Basic User' }[role] || 'Anonymous');
const weatherCodes = { 0: ['Clear', '☀️', '🌙'], 1: ['Mostly clear', '🌤️', '🌙'], 2: ['Partly cloudy', '⛅', '☁️'], 3: ['Overcast', '☁️', '☁️'], 45: ['Fog', '🌫️', '🌫️'], 48: ['Freezing fog', '🌫️', '🌫️'], 51: ['Light drizzle', '🌦️', '🌧️'], 53: ['Drizzle', '🌦️', '🌧️'], 55: ['Heavy drizzle', '🌧️', '🌧️'], 61: ['Light rain', '🌦️', '🌧️'], 63: ['Rain', '🌧️', '🌧️'], 65: ['Heavy rain', '⛈️', '⛈️'], 71: ['Light snow', '🌨️', '🌨️'], 73: ['Snow', '❄️', '❄️'], 75: ['Heavy snow', '❄️', '❄️'], 80: ['Rain showers', '🌦️', '🌧️'], 81: ['Rain showers', '🌧️', '🌧️'], 82: ['Heavy showers', '⛈️', '⛈️'], 95: ['Thunderstorm', '⛈️', '⛈️'] };

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}
function openModal(html) { modalContent.innerHTML = html; modal.showModal(); }
function closeModal() { modal.close(); }
function formValue(id) { return $(id)?.value?.trim() || ''; }

async function init() {
  await loadSession();
  const boot = await api('/api/bootstrap-status');
  if (boot.needsBootstrap) { showBootstrapModal(); return; }
  try {
    await Promise.all([loadSettings(), loadServices(), loadPreferences(), loadWeather(), loadPluginSections()]);
  } catch (error) {
    showAccessError(error);
  }
  render();
  if (isAdmin()) await loadAdminData();
  setInterval(loadWeather, 5 * 60 * 1000);
}

async function loadSession() {
  const data = await api('/api/auth/session');
  state.user = data.user;
  state.csrfToken = data.csrfToken || null;
}
async function loadSettings() {
  const data = await api('/api/settings/public');
  state.settings = data;
  document.title = data.appName || 'Home Lab Launcher';
  $('brand-name').textContent = data.appName || 'Home Lab Launcher';
}
async function loadServices() { state.services = (await api('/api/services')).services; }
async function loadPreferences() {
  if (state.user) {
    const prefs = (await api('/api/me/preferences')).preferences;
    state.favorites = prefs.favorites || [];
    state.preferences = { ...state.preferences, ...(prefs.launchpad || {}) };
  } else {
    state.favorites = JSON.parse(localStorage.getItem('hll.favorites') || '[]');
    state.preferences = { ...state.preferences, ...JSON.parse(localStorage.getItem('hll.launchpad') || '{}') };
  }
}
async function saveFavorites() {
  if (state.user) await api('/api/me/preferences/favorites', { method: 'PUT', body: JSON.stringify({ value: state.favorites }) });
  else localStorage.setItem('hll.favorites', JSON.stringify(state.favorites));
}
async function saveLaunchpadPreferences() {
  if (state.user) await api('/api/me/preferences/launchpad', { method: 'PUT', body: JSON.stringify({ value: state.preferences }) });
  else localStorage.setItem('hll.launchpad', JSON.stringify(state.preferences));
}
async function loadPluginSections() {
  try { state.pluginSections = (await api('/api/plugins/enabled-sections')).sections || []; }
  catch { state.pluginSections = []; }
}
async function loadAdminData() {
  if (!isAdmin()) return;
  const [overview, health, config, notices, users, plugins, logs] = await Promise.all([
    api('/api/admin/overview'),
    api('/api/admin/health'),
    api('/api/admin/config'),
    api('/api/admin/notices'),
    api('/api/users'),
    api('/api/plugins'),
    api('/api/admin/logs?limit=100')
  ]);
  state.admin.overview = overview;
  state.admin.health = health;
  state.admin.config = config.config;
  state.admin.notices = notices.notices || [];
  state.admin.users = users.users;
  state.admin.plugins = plugins.plugins;
  state.admin.logs = logs.logs;
  renderAdminConsole();
}
async function loadWeather() {
  const card = $('weather-card');
  try {
    const data = await api('/api/weather');
    const current = data.weather.current || {};
    const daily = data.weather.daily || {};
    const code = weatherCodes[current.weather_code] || ['Conditions unavailable', '🌤️', '🌙'];
    const unit = data.location.units === 'celsius' ? 'C' : 'F';
    card?.classList.remove('is-error');
    const temp = Number(current.temperature_2m);
    const feelsLike = Number(current.apparent_temperature);
    const high = Number((daily.temperature_2m_max || [])[0]);
    const low = Number((daily.temperature_2m_min || [])[0]);
    $('weather-location').textContent = data.location.label || 'Weather';
    $('weather-temp').textContent = Number.isFinite(temp) ? `${Math.round(temp)}°` : '—°';
    $('weather-summary').textContent = `${code[0]} · Feels like ${Number.isFinite(feelsLike) ? Math.round(feelsLike) : '—'}°${unit}`;
    $('weather-meta').textContent = `H ${Number.isFinite(high) ? Math.round(high) : '—'}° · L ${Number.isFinite(low) ? Math.round(low) : '—'}° · Updated ${new Date(data.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    $('weather-icon').textContent = Number(current.is_day) === 1 ? code[1] : code[2];
  } catch (error) {
    card?.classList.add('is-error');
    $('weather-temp').textContent = '—°';
    $('weather-summary').textContent = 'Weather unavailable';
    $('weather-meta').textContent = `${error.message}. Retrying automatically every 5 minutes.`;
    $('weather-icon').textContent = '⚠️';
  }
}

function render() {
  const sessionText = state.user ? `${state.user.username} · ${roleLabel(state.user.role)}` : 'Anonymous';
  $('user-label').textContent = state.user ? state.user.username : 'Anonymous';
  $('access-label').textContent = state.user ? `${roleLabel(state.user.role)} access` : (state.settings?.publicReadEnabled ? 'Read-only public access' : 'Login required');
  $('session-button').textContent = sessionText;
  $('session-button').classList.toggle('signed-in', Boolean(state.user));
  $('login-button').hidden = Boolean(state.user);
  $('user-menu').hidden = !state.user;
  $('side-profile-button').hidden = !state.user;
  $('admin-nav-link').hidden = !isAdmin();
  $('dropdown-admin-link').hidden = !isAdmin();
  $('side-admin-link').hidden = !isAdmin();
  $('admin-panel').hidden = !isAdmin();
  $('add-service-button').hidden = !canEditServices();
  $('settings-button').hidden = !isAdmin();
  $('users-button').hidden = !isAdmin();
  $('plugin-manager-button').hidden = !isAdmin();
  renderServices();
  renderPluginSections();
  if (isAdmin()) renderAdminConsole();
}

function showAccessError(error) {
  $('service-grid').innerHTML = '';
  $('services-empty').hidden = false;
  $('services-empty').textContent = error.message === 'Authentication required' ? 'Login required to view this launcher.' : error.message;
}

function renderServices() {
  const q = $('service-search').value.trim().toLowerCase();
  const categories = [...new Set(state.services.map((s) => s.category || 'general'))].sort();
  const hidden = new Set(state.preferences.hiddenCategories || []);
  const controls = $('launchpad-controls');
  if (controls) {
    controls.innerHTML = `<div class="control-group" aria-label="Category filters"><button class="ghost service-category-chip ${!state.selectedCategory ? 'active-filter' : ''}" type="button" data-launch-category="">All</button>${categories.map((cat) => `<button class="ghost service-category-chip ${state.selectedCategory === cat ? 'active-filter' : ''} ${hidden.has(cat) ? 'muted-filter' : ''}" type="button" data-launch-category="${escapeHtml(cat)}">${hidden.has(cat) ? 'Hidden: ' : ''}${escapeHtml(cat)}</button>`).join('')}</div><div class="control-group" aria-label="Layout"><button class="ghost ${state.preferences.viewMode === 'cards' ? 'active-filter' : ''}" type="button" data-view-mode="cards">Cards</button><button class="ghost ${state.preferences.viewMode === 'compact' ? 'active-filter' : ''}" type="button" data-view-mode="compact">Compact</button><button class="ghost ${state.preferences.viewMode === 'list' ? 'active-filter' : ''}" type="button" data-view-mode="list">List</button></div>`;
  }
  const visible = state.services.filter((s) => {
    const category = s.category || 'general';
    if (hidden.has(category)) return false;
    if (state.selectedCategory && category !== state.selectedCategory) return false;
    return [s.name, s.url, s.category, s.description, ...(s.tags || [])].join(' ').toLowerCase().includes(q);
  });
  const serviceCount = $('service-count');
  if (serviceCount) {
    const total = state.services.filter((s) => !hidden.has(s.category || 'general')).length;
    const label = total === 1 ? '1 visible service' : `${total} visible services`;
    serviceCount.textContent = q || state.selectedCategory ? `${visible.length} of ${label} match the current view` : `${label} available based on your access`;
  }

  const favoriteServices = state.favorites.map((id) => state.services.find((s) => s.id === id)).filter((s) => s && !hidden.has(s.category || 'general')).slice(0, 8);
  const favorites = $('favorites');
  favorites.hidden = favoriteServices.length === 0;
  favorites.innerHTML = favoriteServices.map((s, index) => `
    <article class="favorite-tile">
      <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(s.name)}">${iconHtml(s.icon, s.name)}<span><strong>${escapeHtml(s.name)}</strong><br><small>${escapeHtml(getHost(s.url))}</small></span></a>
      <span class="favorite-actions"><button class="icon-btn" data-fav-move="up" data-fav-id="${escapeHtml(s.id)}" ${index === 0 ? 'disabled' : ''} aria-label="Move favorite up">↑</button><button class="icon-btn" data-fav-move="down" data-fav-id="${escapeHtml(s.id)}" ${index === favoriteServices.length - 1 ? 'disabled' : ''} aria-label="Move favorite down">↓</button></span>
    </article>`).join('');

  const grid = $('service-grid');
  grid.className = `grid view-${escapeHtml(state.preferences.viewMode || 'cards')}`;
  if (state.preferences.viewMode === 'compact') grid.innerHTML = renderGroupedServices(visible);
  else grid.innerHTML = visible.map(serviceCardHtml).join('');
  const empty = $('services-empty');
  empty.hidden = visible.length > 0;
  if (!visible.length) {
    const canAdd = canEditServices();
    empty.innerHTML = state.services.length === 0
      ? `<h3>No services configured</h3><p>${canAdd ? 'Add your first service link to make this launcher useful.' : 'An admin or editor has not added any services yet.'}</p>${canAdd ? '<div class="hero-actions"><button class="primary" type="button" data-empty-add-service>Add first service</button></div>' : ''}`
      : `<h3>No services match this view</h3><p>Try another search, switch category, or unhide a category from the category menu.</p>`;
  }
}
function renderGroupedServices(services) {
  const groups = new Map();
  for (const service of services) {
    const key = service.category || 'general';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(service);
  }
  return [...groups.entries()].map(([category, items]) => `<section class="service-group"><div class="service-group-head"><h3>${escapeHtml(category)}</h3><button class="ghost" type="button" data-hide-category="${escapeHtml(category)}">Hide category</button></div><div class="service-group-grid">${items.map(serviceCardHtml).join('')}</div></section>`).join('');
}
function healthBadgeHtml(health) {
  if (!health) return '';
  const status = health.status || 'unknown';
  const cls = status === 'up' ? 'success' : status === 'down' ? 'danger' : 'warning';
  const label = status === 'up' ? 'Online' : status === 'down' ? 'Down' : 'Unknown';
  const detail = health.checkedAt ? ` title="Checked ${escapeHtml(new Date(health.checkedAt).toLocaleString())}${health.responseMs ? ` · ${health.responseMs}ms` : ''}${health.error ? ` · ${health.error}` : ''}"` : '';
  return `<span class="status-badge ${cls}"${detail}>${label}</span>`;
}
function serviceCardHtml(s) {
  const editable = canEditServices();
  const disabled = !s.enabled;
  const meta = [
    `<span class="status-badge">${escapeHtml(s.category || 'general')}</span>`,
    s.featured ? '<span class="status-badge success">Featured</span>' : '',
    s.healthCheckEnabled ? healthBadgeHtml(s.health) || '<span class="status-badge warning">Pending check</span>' : '',
    disabled ? '<span class="status-badge danger">Disabled</span>' : ''
  ].filter(Boolean).join('');
  return `<article class="service-card ${disabled ? 'is-disabled' : ''}" style="--accent:${hexToRgba(s.accent, .1)}">
    <div><div class="card-top">${iconHtml(s.icon, s.name)}<span class="actions">
      <button class="icon-btn" data-copy="${escapeHtml(s.url)}" title="Copy URL" aria-label="Copy ${escapeHtml(s.name)} URL">⧉</button>
      <button class="icon-btn ${state.favorites.includes(s.id) ? 'active' : ''}" data-fav="${escapeHtml(s.id)}" title="Favorite" aria-label="${state.favorites.includes(s.id) ? 'Remove from' : 'Add to'} favorites">★</button>
      ${editable ? `<button class="icon-btn" data-check-service="${escapeHtml(s.id)}" title="Check health" aria-label="Check ${escapeHtml(s.name)} health">●</button><button class="icon-btn" data-edit="${escapeHtml(s.id)}" title="Edit" aria-label="Edit ${escapeHtml(s.name)}">✎</button><button class="icon-btn" data-delete="${escapeHtml(s.id)}" title="Delete" aria-label="Delete ${escapeHtml(s.name)}">×</button>` : ''}
    </span></div><h3 title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</h3><p>${escapeHtml(s.description || 'No description provided.')}</p><a class="service-link" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(getHost(s.url))}</span></a></div>
    <div><div class="service-meta">${meta}</div><div class="tags">${(s.tags || []).slice(0, 4).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div></div>
  </article>`;
}

function hexToRgba(hex, a) {
  const clean = String(hex || '#4de7ff').replace('#', '');
  const n = parseInt(clean, 16);
  if (Number.isNaN(n)) return `rgba(77,231,255,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

async function renderPluginSections() {
  const wrapper = $('plugins');
  const host = $('plugin-sections');
  const head = $('plugin-section-head');
  host.innerHTML = '';
  document.querySelectorAll('script[data-plugin]').forEach((script) => script.remove());
  const hasSections = state.pluginSections.length > 0;
  wrapper.hidden = !hasSections && !isAdmin();
  head.hidden = !hasSections && !isAdmin();
  window.HomeLabLauncher = { api, currentUser: state.user, registerPluginSection(section) {
    wrapper.hidden = false;
    head.hidden = false;
    const el = document.createElement('section');
    el.className = 'plugin-panel';
    el.innerHTML = `<h2>${escapeHtml(section.title || section.id)}</h2><div class="plugin-body"></div>`;
    host.appendChild(el);
    section.render({ container: el.querySelector('.plugin-body'), api, user: state.user });
  }};
  for (const section of state.pluginSections) {
    if (section.script) {
      const script = document.createElement('script');
      script.src = section.script;
      script.dataset.plugin = section.pluginId;
      document.body.appendChild(script);
    }
  }
}

function renderAdminConsole() {
  const panel = $('admin-panel');
  if (!panel || !isAdmin()) return;
  document.querySelectorAll('.admin-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.adminTab === state.adminTab));
  const content = $('admin-content');
  if (!state.admin.overview) { content.innerHTML = '<p>Loading admin console…</p>'; return; }
  const renderers = { overview: adminOverviewHtml, settings: adminSettingsHtml, services: adminServicesHtml, users: adminUsersHtml, security: adminSecurityHtml, backups: adminBackupsHtml, plugins: adminPluginsHtml, logs: adminLogsHtml };
  content.innerHTML = renderers[state.adminTab]();
  bindAdminTabHandlers();
}
function statCard(label, value) { return `<div class="stat-card"><div class="tiny-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value)}</div></div>`; }
function checklistItem(done, label, detail) { return `<li class="checklist-item ${done ? 'done' : ''}"><strong>${done ? '✓' : '•'} ${escapeHtml(label)}</strong><span>${escapeHtml(detail)}</span></li>`; }
function onboardingChecklistHtml() {
  const o = state.admin.overview || {};
  const h = state.admin.health || {};
  const c = state.admin.config || {};
  const highWarnings = (o.warnings || []).filter((w) => w.level === 'high');
  const weatherConfigured = Boolean(h.weatherProvider?.configured);
  const backupLocation = Boolean(c.scheduledBackupLocation);
  return `<div class="settings-card"><h3>Onboarding checklist</h3><ul class="checklist">${[
    checklistItem(highWarnings.length === 0, 'Secure bootstrap configuration', highWarnings.length ? 'Resolve high-severity configuration warnings.' : 'No high-severity warnings detected.'),
    checklistItem(Boolean(c.urls?.appBaseUrlValid), 'Set application base URL', c.urls?.appBaseUrl || 'Base URL is not configured.'),
    checklistItem((o.counts?.services || 0) > 0, 'Add launchpad services', `${o.counts?.services || 0} services configured.`),
    checklistItem(weatherConfigured, 'Configure weather', h.weatherProvider?.location || 'Weather location is not configured.'),
    checklistItem(backupLocation, 'Plan backups', backupLocation ? c.scheduledBackupLocation : 'Optional backup location is not configured yet.')
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
function adminSettingsHtml() {
  const s = state.settings || {};
  return `<div class="settings-card"><h3>Application settings</h3><div class="form-grid">
    <div class="row"><div class="field"><label>Application name</label><input id="admin-app-name" value="${escapeHtml(s.appName || '')}"></div><div class="field"><label>Base URL</label><input id="admin-base-url" value="${escapeHtml(s.appBaseUrl || '')}" placeholder="http://server-ip:8080 or https://portal.example.com"></div></div>
    <label class="check-line"><input id="admin-public-read" type="checkbox" ${s.publicReadEnabled ? 'checked' : ''}> Allow anonymous read-only access</label>
    <h3>Weather</h3><div class="field"><label>Search ZIP or city</label><div class="inline-controls"><input id="weather-query" placeholder="05101 or Bellows Falls"><button class="ghost" id="weather-search" type="button">Search</button></div></div><div id="weather-results" class="result-list"></div>
    <div class="row"><div class="field"><label>Latitude</label><input id="weather-lat" value="${escapeHtml(s.weather?.latitude || '')}"></div><div class="field"><label>Longitude</label><input id="weather-lon" value="${escapeHtml(s.weather?.longitude || '')}"></div></div>
    <div class="row"><div class="field"><label>Weather label</label><input id="weather-label-input" value="${escapeHtml(s.weather?.label || '')}"></div><div class="field"><label>Units</label><select id="weather-units"><option value="fahrenheit" ${s.weather?.units !== 'celsius' ? 'selected' : ''}>Fahrenheit</option><option value="celsius" ${s.weather?.units === 'celsius' ? 'selected' : ''}>Celsius</option></select></div></div>
    <button class="primary" id="admin-save-settings" type="button">Save settings</button></div></div>`;
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
  return services.map((svc) => `<article class="service-admin-row" draggable="true" data-service-row="${escapeHtml(svc.id)}" data-service-search="${escapeHtml([svc.name, svc.url, svc.category, svc.description, ...(svc.tags || [])].join(' ').toLowerCase())}"><span class="drag-handle" title="Drag to reorder">☰</span><input type="checkbox" data-service-select="${escapeHtml(svc.id)}">${iconHtml(svc.icon, svc.name)}<div><strong>${escapeHtml(svc.name)}</strong><small>${escapeHtml(svc.category)} · ${svc.enabled ? 'enabled' : 'disabled'} · ${svc.featured ? 'featured' : 'not featured'}</small><small>${escapeHtml(svc.url)}</small></div><div class="service-row-actions"><button class="ghost" data-admin-edit-service="${escapeHtml(svc.id)}" type="button">Edit</button><button class="ghost" data-admin-duplicate-service="${escapeHtml(svc.id)}" type="button">Duplicate</button></div></article>`).join('');
}

function adminSecurityHtml() {
  const h = state.admin.health || {};
  const c = state.admin.config || {};
  const warnings = (h.warnings || []).map((w) => `<li><strong>${escapeHtml(w.level)}</strong> — ${escapeHtml(w.message)}</li>`).join('') || '<li>No security/config warnings detected.</li>';
  return `<div class="admin-stack"><div class="settings-card"><h3>Security posture</h3><ul class="warning-list">${warnings}</ul><div class="stats-row">${statCard('Active sessions', h.sessions?.active ?? '—')}${statCard('CSRF', state.csrfToken ? 'enabled' : 'missing')}${statCard('Headers', 'enabled')}${statCard('Cookie secure', c.security?.cookieSecure ? 'yes' : 'no')}</div><p>Security headers, CSRF checks, login throttling, and audit logging are enabled in this build.</p></div>
    <div class="settings-card"><h3>Effective configuration</h3><p><strong>Base URL valid:</strong> ${c.urls?.appBaseUrlValid ? 'yes' : 'no'} · <strong>Protocol:</strong> ${escapeHtml(c.urls?.appBaseUrlProtocol || 'unset')} · <strong>Behind proxy:</strong> ${c.urls?.behindProxy ? 'yes' : 'no'}</p><p><strong>Request:</strong> ${escapeHtml(c.urls?.requestProtocol || '')}://${escapeHtml(c.urls?.requestHost || '')} · <strong>Forwarded proto:</strong> ${escapeHtml(c.urls?.forwardedProto || 'none')}</p><p><strong>Log retention:</strong> ${escapeHtml(c.security?.logRetentionDays || 90)} days · <strong>Scheduled backup location:</strong> ${escapeHtml(c.scheduledBackupLocation || 'not configured')}</p></div>
    <div class="settings-card"><h3>Plugin and job health</h3><div class="stats-row">${statCard('Plugin failures', h.plugins?.failures?.length ?? 0)}${statCard('Plugin jobs', h.scheduledJobs?.length ?? 0)}${statCard('Weather provider', h.weatherProvider?.configured ? 'configured' : 'not configured')}</div><div class="log-list">${(h.scheduledJobs || []).map((j) => `<article class="log-item"><strong>${escapeHtml(j.name)}</strong><span>${escapeHtml(j.pluginId)} · every ${Math.round(j.intervalMs / 1000)}s · ${escapeHtml(j.lastStatus)}</span>${j.lastError ? `<code>${escapeHtml(j.lastError)}</code>` : ''}</article>`).join('') || '<p>No scheduled plugin jobs registered.</p>'}</div></div></div>`;
}

function adminBackupsHtml() {
  const h = state.admin.health || {};
  const c = state.admin.config || {};
  return `<div class="settings-card"><h3>Backups & storage</h3><p>Download a portable configuration backup containing settings, services, user names/roles, and plugin metadata. Password hashes, sessions, and private runtime data are not exported.</p><div class="inline-controls"><button class="primary" id="download-backup" type="button">Download config backup</button><button class="ghost" id="download-db" type="button">Download SQLite database</button></div><div class="stats-row">${statCard('Database', formatBytes(h.storage?.databaseBytes || 0))}${statCard('WAL', formatBytes(h.storage?.walBytes || 0))}</div><p><strong>Data dir:</strong> ${escapeHtml(h.storage?.dataDir || '')}</p><p><strong>Plugin dir:</strong> ${escapeHtml(h.storage?.pluginDir || '')}</p><h3>Scheduled backup planning</h3><p>The app records the desired backup location for operators. Automated backup execution can be wired to this path in a later milestone.</p><div class="inline-controls"><input id="scheduled-backup-location" value="${escapeHtml(c.scheduledBackupLocation || '')}" placeholder="/backups/home-lab-launcher"><button class="ghost" id="save-backup-location" type="button">Save location</button></div><h3>Restore configuration backup</h3><p>Restore settings and services from a Home Lab Launcher config backup. User passwords and active sessions are not changed.</p><div class="field"><label>Backup JSON</label><textarea id="restore-backup-json" rows="8" placeholder='{"format":"home-lab-launcher-config-v1",...}'></textarea></div><button class="ghost danger" id="restore-backup" type="button">Restore backup</button></div>`;
}

function adminUsersHtml() {
  return `<div class="settings-card"><h3>User management</h3><div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>New password</th><th>Actions</th></tr></thead><tbody>${state.admin.users.map((u) => `
    <tr><td><input data-user-name="${u.id}" value="${escapeHtml(u.username)}"></td><td><select data-user-role="${u.id}"><option value="user" ${u.role === 'user' ? 'selected' : ''}>Basic User</option><option value="editor" ${u.role === 'editor' ? 'selected' : ''}>Editor</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select></td><td><input data-user-pass="${u.id}" type="password" placeholder="leave unchanged"></td><td><button class="ghost" data-user-save="${u.id}" type="button">Save</button>${u.id !== state.user.id ? `<button class="ghost danger" data-user-delete="${u.id}" type="button">Delete</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <h3>Add user</h3><div class="row"><input id="new-user" placeholder="username"><select id="new-role"><option value="user">Basic User</option><option value="editor">Editor</option><option value="admin">Admin</option></select></div><div class="row"><input id="new-pass" type="password" placeholder="temporary password, 10+ characters"><button class="primary" id="add-user" type="button">Add user</button></div></div>`;
}
function renderConfigFields(plugin) {
  const schema = plugin.manifest?.configSchema || {};
  const entries = Object.entries(schema);
  if (!entries.length) return '<p>No configurable settings exposed by this plugin.</p>';
  return entries.map(([key, spec]) => {
    const value = plugin.config?.[key] ?? spec.default ?? '';
    if (spec.type === 'boolean') return `<label class="check-line"><input data-plugin-config-key="${escapeHtml(key)}" type="checkbox" ${value ? 'checked' : ''}> ${escapeHtml(spec.label || key)}</label>`;
    if (Array.isArray(spec.enum)) return `<div class="field"><label>${escapeHtml(spec.label || key)}</label><select data-plugin-config-key="${escapeHtml(key)}">${spec.enum.map((item) => `<option value="${escapeHtml(item)}" ${String(value) === String(item) ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></div>`;
    return `<div class="field"><label>${escapeHtml(spec.label || key)}</label><input data-plugin-config-key="${escapeHtml(key)}" type="${spec.type === 'number' ? 'number' : 'text'}" value="${escapeHtml(value)}"><small>${escapeHtml(spec.description || '')}</small></div>`;
  }).join('');
}
function adminPluginsHtml() {
  const rows = state.admin.plugins.map((p) => {
    const permissions = (p.manifest?.permissions || []).map((perm) => `<span class="tag">${escapeHtml(perm)}</span>`).join('');
    const compat = p.compatibility?.compatible ? '<span class="status-badge success">Compatible</span>' : `<span class="status-badge danger">${escapeHtml(p.compatibility?.error || 'Incompatible')}</span>`;
    const update = p.update?.updateAvailable ? `<span class="status-badge warning">Update: ${escapeHtml(p.update.latest.version)}</span>` : '';
    return `<div class="plugin-row plugin-row-expanded" data-plugin-row="${escapeHtml(p.id)}"><div><strong>${escapeHtml(p.name)}</strong><br><small>${escapeHtml(p.sourceType)} · ${escapeHtml(p.sourceUrl)} · ${escapeHtml(p.version)} · ${escapeHtml(p.lifecycle || (p.enabled ? 'enabled' : 'disabled'))}</small><div class="service-meta">${compat}${update}<span class="status-badge">hash ${escapeHtml((p.installedHash || 'none').slice(0, 12))}</span></div><div class="tags">${permissions}</div>${p.lastError ? `<code>${escapeHtml(p.lastError)}</code>` : ''}</div><div class="service-row-actions"><button class="ghost" data-plugin-toggle="${escapeHtml(p.id)}" data-enabled="${p.enabled}" type="button">${p.enabled ? 'Disable' : 'Enable'}</button><button class="ghost" data-plugin-logs="${escapeHtml(p.id)}" type="button">Logs</button>${p.sourceType === 'github' ? `<button class="ghost" data-plugin-update="${escapeHtml(p.id)}" data-source="${escapeHtml(p.sourceUrl)}" type="button">Discover update</button>` : `<button class="ghost" data-plugin-reload-local="${escapeHtml(p.id)}" type="button">Reload</button>`}<button class="ghost danger" data-plugin-delete="${escapeHtml(p.id)}" type="button">Remove</button></div><div class="plugin-config"><h4>Configuration</h4><div class="form-grid" data-plugin-config="${escapeHtml(p.id)}">${renderConfigFields(p)}<button class="ghost" data-plugin-save-config="${escapeHtml(p.id)}" type="button">Save plugin config</button></div></div></div>`;
  }).join('') || '<p>No plugins installed.</p>';
  return `<div class="settings-card"><div class="inline-between"><h3>Plugin manager</h3><button class="ghost" id="plugins-reload" type="button">Reload plugins</button></div>${rows}
    <h3>Install from GitHub</h3><div class="field"><label>Repository URL</label><input id="plugin-repo" placeholder="https://github.com/owner/repo"></div><div class="inline-controls"><button class="ghost" id="plugin-discover" type="button">Discover versions</button><select id="plugin-version"></select><button class="primary" id="plugin-install" type="button">Install selected version</button></div><div id="plugin-release-notes" class="plugin-release-notes"></div>
    <h3>Local development plugin</h3><p>Available outside production, or when ENABLE_LOCAL_PLUGIN_INSTALL=true.</p><div class="inline-controls"><input id="plugin-local-path" placeholder="/mnt/storage/code/home-lab-launcher-plugins/news"><button class="ghost" id="plugin-install-local" type="button">Install local plugin</button></div></div>`;
}

function adminLogsHtml() {
  const retention = state.admin.config?.security?.logRetentionDays || 90;
  return `<div class="settings-card"><div class="inline-between"><h3>Audit logs</h3><div class="inline-controls"><button class="ghost" id="export-logs" type="button">Export logs</button><button class="ghost" id="refresh-logs" type="button">Refresh logs</button></div></div><div class="inline-controls"><input id="log-query" placeholder="Search action, actor, or details"><select id="log-level"><option value="">All levels</option><option value="info">Info</option><option value="warn">Warn</option><option value="error">Error</option></select><button class="ghost" id="filter-logs" type="button">Filter</button></div><h3>Retention</h3><div class="inline-controls"><input id="log-retention-days" type="number" min="1" max="3650" value="${escapeHtml(retention)}"><button class="ghost" id="save-log-retention" type="button">Save retention</button><button class="ghost danger" id="prune-logs" type="button">Prune old logs</button></div><div class="log-list">${state.admin.logs.map((l) => `<article class="log-item"><strong>${escapeHtml(l.action)}</strong><span>${escapeHtml(l.level)} · ${escapeHtml(l.actorUsername || 'system')} · ${escapeHtml(l.ip || '')} · ${new Date(l.createdAt).toLocaleString()}</span><code>${escapeHtml(JSON.stringify(l.details || {}))}</code></article>`).join('') || '<p>No logs yet.</p>'}</div></div>`;
}

function bindAdminTabHandlers() {
  const content = $('admin-content');
  if (state.adminTab === 'settings') bindSettingsHandlers();
  if (state.adminTab === 'services') bindServiceToolHandlers();
  if (state.adminTab === 'users') bindUserHandlers(content);
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
    await api('/api/services/import', { method: 'POST', body: JSON.stringify(payload) });
    await Promise.all([loadServices(), loadAdminData()]);
    render(); toast('Services imported');
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
    const edit = event.target.closest('[data-admin-edit-service]');
    const duplicate = event.target.closest('[data-admin-duplicate-service]');
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

function bindBackupHandlers() {
  $('download-backup')?.addEventListener('click', async () => {
    const data = await api('/api/admin/backup');
    downloadJson(`home-lab-launcher-backup-${new Date().toISOString().slice(0, 10)}.json`, data);
  });
  $('download-db')?.addEventListener('click', () => { window.location.href = '/api/admin/database/export'; });
  $('save-backup-location')?.addEventListener('click', async () => {
    await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ scheduled_backup_location: formValue('scheduled-backup-location') }) });
    await loadAdminData(); toast('Backup location saved');
  });
  $('restore-backup')?.addEventListener('click', async () => {
    if (!confirm('Restore settings and services from this backup? Current services will be replaced.')) return;
    const payload = JSON.parse($('restore-backup-json').value || '{}');
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
  $('weather-search')?.addEventListener('click', async () => {
    const data = await api(`/api/weather/search?q=${encodeURIComponent(formValue('weather-query'))}`);
    $('weather-results').innerHTML = data.results.map((r, i) => `<button class="ghost" type="button" data-result="${i}">${escapeHtml(r.label)}</button>`).join(' ');
    $('weather-results').onclick = (e) => {
      const b = e.target.closest('[data-result]'); if (!b) return;
      const r = data.results[Number(b.dataset.result)];
      $('weather-lat').value = r.latitude; $('weather-lon').value = r.longitude; $('weather-label-input').value = r.label;
    };
  });
  $('admin-save-settings')?.addEventListener('click', async () => {
    await api('/api/settings', { method: 'PATCH', body: JSON.stringify({ app_name: formValue('admin-app-name'), app_base_url: formValue('admin-base-url'), public_read_enabled: $('admin-public-read').checked }) });
    await api('/api/weather/settings', { method: 'PUT', body: JSON.stringify({ label: formValue('weather-label-input'), latitude: formValue('weather-lat'), longitude: formValue('weather-lon'), units: $('weather-units').value }) });
    await Promise.all([loadSettings(), loadWeather(), loadAdminData()]);
    render(); toast('Settings saved');
  });
}
function bindUserHandlers(content) {
  content.querySelector('#add-user')?.addEventListener('click', async () => {
    await api('/api/users', { method: 'POST', body: JSON.stringify({ username: formValue('new-user'), password: formValue('new-pass'), role: $('new-role').value }) });
    await loadAdminData(); toast('User added');
  });
  content.querySelectorAll('[data-user-save]').forEach((button) => button.addEventListener('click', async () => {
    const id = button.dataset.userSave;
    const body = { username: document.querySelector(`[data-user-name="${id}"]`).value, role: document.querySelector(`[data-user-role="${id}"]`).value };
    const password = document.querySelector(`[data-user-pass="${id}"]`).value;
    if (password) body.password = password;
    await api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    await loadSession(); await loadAdminData(); render(); toast('User saved');
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
    $('confirm-plugin-update').onclick = async () => { await api(`/api/plugins/${button.dataset.pluginUpdate}/update`, { method: 'POST', body: JSON.stringify({ version: latest.version }) }); closeModal(); await Promise.all([loadAdminData(), loadPluginSections()]); render(); toast('Plugin updated'); };
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
  });
  $('plugin-version')?.addEventListener('change', () => {
    const option = $('plugin-version').selectedOptions[0];
    $('plugin-release-notes').innerHTML = option ? `<pre class="release-notes">${escapeHtml((option.dataset.notes || 'No release notes available.').slice(0, 2000))}</pre>` : '';
  });
  $('plugin-install')?.addEventListener('click', async () => {
    await api('/api/plugins/install', { method: 'POST', body: JSON.stringify({ repoUrl: formValue('plugin-repo'), version: $('plugin-version').value }) });
    await Promise.all([loadAdminData(), loadPluginSections()]); render(); toast('Plugin installed');
  });
  $('plugin-install-local')?.addEventListener('click', async () => {
    await api('/api/plugins/install-local', { method: 'POST', body: JSON.stringify({ path: formValue('plugin-local-path') }) });
    await Promise.all([loadAdminData(), loadPluginSections()]); render(); toast('Local plugin installed');
  });
}


$('launchpad-controls').addEventListener('click', async (event) => {
  const categoryButton = event.target.closest('[data-launch-category]');
  const viewButton = event.target.closest('[data-view-mode]');
  const hideButton = event.target.closest('[data-hide-category]');
  if (categoryButton) {
    const category = categoryButton.dataset.launchCategory;
    if (event.altKey || event.shiftKey) {
      const hidden = new Set(state.preferences.hiddenCategories || []);
      hidden.has(category) ? hidden.delete(category) : hidden.add(category);
      state.preferences.hiddenCategories = [...hidden].filter(Boolean);
      if (hidden.has(state.selectedCategory)) state.selectedCategory = '';
      await saveLaunchpadPreferences();
    } else {
      state.selectedCategory = category;
    }
    renderServices();
  }
  if (viewButton) {
    state.preferences.viewMode = viewButton.dataset.viewMode;
    await saveLaunchpadPreferences();
    renderServices();
  }
  if (hideButton) {
    const hidden = new Set(state.preferences.hiddenCategories || []);
    hidden.add(hideButton.dataset.hideCategory);
    state.preferences.hiddenCategories = [...hidden];
    if (state.selectedCategory === hideButton.dataset.hideCategory) state.selectedCategory = '';
    await saveLaunchpadPreferences();
    renderServices();
  }
});
$('favorites').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-fav-move]');
  if (!button) return;
  const id = button.dataset.favId;
  const index = state.favorites.indexOf(id);
  const next = button.dataset.favMove === 'up' ? index - 1 : index + 1;
  if (index < 0 || next < 0 || next >= state.favorites.length) return;
  [state.favorites[index], state.favorites[next]] = [state.favorites[next], state.favorites[index]];
  await saveFavorites();
  renderServices();
});
$('service-search').addEventListener('input', renderServices);
$('service-grid').addEventListener('click', async (e) => {
  const copy = e.target.closest('[data-copy]'); const fav = e.target.closest('[data-fav]'); const edit = e.target.closest('[data-edit]'); const del = e.target.closest('[data-delete]'); const check = e.target.closest('[data-check-service]');
  if (copy) { await navigator.clipboard.writeText(copy.dataset.copy); toast('Copied URL'); }
  if (fav) { const id = fav.dataset.fav; state.favorites = state.favorites.includes(id) ? state.favorites.filter((x) => x !== id) : [id, ...state.favorites]; await saveFavorites(); renderServices(); }
  if (edit) showServiceModal(state.services.find((s) => s.id === edit.dataset.edit));
  if (check) { await api(`/api/services/${check.dataset.checkService}/check`, { method: 'POST' }); await loadServices(); renderServices(); toast('Health check complete'); }
  if (del && confirm('Delete this service?')) { await api(`/api/services/${del.dataset.delete}`, { method: 'DELETE' }); await loadServices(); if (isAdmin()) await loadAdminData(); renderServices(); toast('Service deleted'); }
});
$('services-empty').addEventListener('click', (event) => { if (event.target.closest('[data-empty-add-service]')) showServiceModal(); });
$('add-service-button').addEventListener('click', () => showServiceModal());
$('login-button').addEventListener('click', showLoginModal);
$('session-button').addEventListener('click', () => { const dd = $('user-dropdown'); const open = dd.hidden; dd.hidden = !open; $('session-button').setAttribute('aria-expanded', String(open)); });
$('user-dropdown').addEventListener('click', async (event) => { const action = event.target.closest('[data-profile-action]')?.dataset.profileAction; if (action === 'profile') { $('user-dropdown').hidden = true; $('session-button').setAttribute('aria-expanded', 'false'); showProfileModal(); } if (action === 'logout') await logout(); });
document.addEventListener('click', (event) => { if (!$('user-menu').contains(event.target)) { $('user-dropdown').hidden = true; $('session-button').setAttribute('aria-expanded', 'false'); } });
$('side-profile-button').addEventListener('click', showProfileModal);
async function logout() { await api('/api/auth/logout', { method: 'POST' }); location.reload(); }
$('settings-button').addEventListener('click', () => { location.hash = 'admin-panel'; state.adminTab = 'settings'; renderAdminConsole(); });
$('users-button').addEventListener('click', () => { location.hash = 'admin-panel'; state.adminTab = 'users'; renderAdminConsole(); });
$('plugin-manager-button').addEventListener('click', () => { location.hash = 'admin-panel'; state.adminTab = 'plugins'; renderAdminConsole(); });
$('admin-refresh-button').addEventListener('click', loadAdminData);
document.querySelectorAll('.admin-tab').forEach((tab) => tab.addEventListener('click', () => { state.adminTab = tab.dataset.adminTab; renderAdminConsole(); }));

const iconChoices = ['🔗','🏠','📈','📶','🎬','🧰','🖥️','☁️','🔒','📦','🧪','📰'];
const colorChoices = ['#8fd3ff','#8ee6b0','#ffd27a','#ff8f9d','#b99cff','#6da8ff','#4de7ff','#94a3b8'];
function serviceForm(s = {}) { return `<h2>${s.id ? 'Edit' : 'Add'} service</h2><div class="form-grid"><div class="row"><div class="field"><label>Name</label><input id="svc-name" value="${escapeHtml(s.name || '')}"></div><div class="field"><label>Icon</label><input id="svc-icon" value="${escapeHtml(s.icon || '🔗')}" placeholder="Emoji or https://... image URL"><small>Use an emoji, paste an image URL, or choose a local JPEG, PNG, GIF, or WebP. Remote/local images are stored by the launcher.</small><div class="choice-row">${iconChoices.map((icon) => `<button class="ghost choice-btn" type="button" data-icon-choice="${escapeHtml(icon)}">${escapeHtml(icon)}</button>`).join('')}</div></div></div><div class="field"><label>Local icon image</label><input id="svc-icon-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp"><small>Animated GIFs/WebP and transparent images are preserved. Maximum size: 5 MiB.</small></div><div class="field"><label>URL</label><input id="svc-url" value="${escapeHtml(s.url || '')}"></div><div class="field"><label>Description</label><textarea id="svc-description">${escapeHtml(s.description || '')}</textarea></div><div class="row"><div class="field"><label>Category</label><input id="svc-category" value="${escapeHtml(s.category || 'general')}"></div><div class="field"><label>Accent color</label><input id="svc-accent" type="color" value="${escapeHtml(s.accent || '#8fd3ff')}"><div class="choice-row">${colorChoices.map((color) => `<button class="color-choice" type="button" data-color-choice="${escapeHtml(color)}" style="--swatch:${escapeHtml(color)}" aria-label="Use ${escapeHtml(color)}"></button>`).join('')}</div></div></div><div class="field"><label>Tags, comma-separated</label><input id="svc-tags" value="${escapeHtml((s.tags || []).join(', '))}"></div><div class="row"><div class="field"><label>Sort order</label><input id="svc-sort" type="number" value="${escapeHtml(s.sortOrder || 0)}"></div><div class="field"><label>Health interval minutes</label><input id="svc-health-interval" type="number" min="1" value="${escapeHtml(s.healthCheckIntervalMinutes || 15)}"></div></div><label class="check-line"><input id="svc-health-enabled" type="checkbox" ${s.healthCheckEnabled ? 'checked' : ''}> Enable HTTP health checks</label><div class="field"><label>Health check URL</label><input id="svc-health-url" value="${escapeHtml(s.healthCheckUrl || '')}" placeholder="Defaults to service URL"><small>Leave blank to check the main service URL. Checks run in the background and can also be triggered manually.</small></div><div class="row"><label><input id="svc-featured" type="checkbox" ${s.featured ? 'checked' : ''}> Featured</label><label><input id="svc-enabled" type="checkbox" ${s.enabled !== false ? 'checked' : ''}> Enabled</label></div><button class="primary" id="save-service" type="button">Save service</button></div>`; }
async function readServiceForm() {
  const file = $('svc-icon-file')?.files?.[0];
  const payload = { name: formValue('svc-name'), icon: formValue('svc-icon') || '🔗', url: formValue('svc-url'), description: formValue('svc-description'), category: formValue('svc-category') || 'general', accent: $('svc-accent').value, tags: formValue('svc-tags'), sortOrder: Number(formValue('svc-sort') || 0), featured: $('svc-featured').checked, enabled: $('svc-enabled').checked, healthCheckEnabled: $('svc-health-enabled').checked, healthCheckUrl: formValue('svc-health-url'), healthCheckIntervalMinutes: Number(formValue('svc-health-interval') || 15) };
  if (file) {
    if (file.size > 5 * 1024 * 1024) throw new Error('Icon image must be 5 MiB or smaller');
    payload.iconImageData = await readFileAsDataUrl(file);
    payload.iconImageName = file.name;
  }
  return payload;
}
function showServiceModal(s) {
  openModal(serviceForm(s));
  modalContent.querySelectorAll('[data-icon-choice]').forEach((button) => button.addEventListener('click', () => { $('svc-icon').value = button.dataset.iconChoice; }));
  modalContent.querySelectorAll('[data-color-choice]').forEach((button) => button.addEventListener('click', () => { $('svc-accent').value = button.dataset.colorChoice; }));
  $('save-service').onclick = async () => { try { const body = await readServiceForm(); await api(s?.id ? `/api/services/${s.id}` : '/api/services', { method: s?.id ? 'PATCH' : 'POST', body: JSON.stringify(body) }); closeModal(); await loadServices(); if (isAdmin()) await loadAdminData(); renderServices(); toast('Service saved'); } catch (error) { toast(error.message); } };
}

function showLoginModal() { openModal(`<h2>Login</h2><div class="form-grid"><div class="field"><label>Username</label><input id="login-username"></div><div class="field"><label>Password</label><input id="login-password" type="password"></div><button class="primary" id="login-submit" type="button">Login</button></div>`); $('login-submit').onclick = async () => { await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: formValue('login-username'), password: formValue('login-password') }) }); location.reload(); }; }
function showBootstrapModal() { openModal(`<h2>Create first Admin</h2><p>No users exist yet. Create the base Admin account to finish setup.</p><div class="form-grid"><div class="field"><label>Username</label><input id="boot-username"></div><div class="field"><label>Password</label><input id="boot-password" type="password" placeholder="10+ characters"></div><button class="primary" id="boot-submit" type="button">Create Admin</button></div>`); $('boot-submit').onclick = async () => { await api('/api/bootstrap', { method: 'POST', body: JSON.stringify({ username: formValue('boot-username'), password: formValue('boot-password') }) }); location.reload(); }; }
async function showProfileModal() {
  const [me, sessions] = await Promise.all([api('/api/me'), api('/api/me/sessions')]);
  openModal(`<h2>Profile</h2><div class="settings-card"><p><strong>${escapeHtml(me.user.username)}</strong></p><p>${escapeHtml(roleLabel(me.user.role))} · Created ${new Date(me.user.createdAt).toLocaleString()}</p></div><h3>Change password</h3><div class="form-grid"><div class="field"><label>Current password</label><input id="profile-current" type="password"></div><div class="field"><label>New password</label><input id="profile-new" type="password" placeholder="10+ characters"></div><button class="primary" id="profile-save-password" type="button">Change password</button></div><h3>Active sessions</h3><div class="log-list">${sessions.sessions.map((item) => `<article class="log-item"><strong>${item.current ? 'Current session' : 'Other session'}</strong><span>${escapeHtml(item.ip)} · expires ${new Date(item.expiresAt).toLocaleString()}</span><small>${escapeHtml(item.userAgent)}</small>${item.current ? '' : `<button class="ghost danger" data-revoke-session="${escapeHtml(item.sid)}" type="button">Revoke</button>`}</article>`).join('')}</div><button class="ghost danger" id="revoke-other-sessions" type="button">Revoke all other sessions</button>`);
  $('profile-save-password').onclick = async () => { await api('/api/me/password', { method: 'PATCH', body: JSON.stringify({ currentPassword: formValue('profile-current'), newPassword: formValue('profile-new') }) }); closeModal(); toast('Password changed'); };
  $('revoke-other-sessions').onclick = async () => { await api('/api/me/sessions', { method: 'DELETE' }); closeModal(); toast('Other sessions revoked'); };
  modalContent.querySelectorAll('[data-revoke-session]').forEach((button) => button.addEventListener('click', async () => { await api(`/api/me/sessions/${button.dataset.revokeSession}`, { method: 'DELETE' }); closeModal(); toast('Session revoked'); }));
}

init();
