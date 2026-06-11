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
  applyAppearance(data.appearance || { brand: { appName: data.appName } });
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
  if (state.preferences.hideMetadata === undefined) {
    state.preferences.hideMetadata = !!state.preferences.hideHostnames;
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
  const [overview, health, config, notices, users, plugins, logs, appearance, presetCatalog] = await Promise.all([
    api('/api/admin/overview'),
    api('/api/admin/health'),
    api('/api/admin/config'),
    api('/api/admin/notices'),
    api('/api/users'),
    api('/api/plugins'),
    api('/api/admin/logs?limit=100'),
    api('/api/admin/appearance'),
    api('/api/admin/presets/settings').catch(() => ({}))
  ]);
  state.admin.overview = overview;
  state.admin.health = health;
  state.admin.config = config.config;
  state.admin.notices = notices.notices || [];
  state.admin.users = users.users;
  state.admin.plugins = plugins.plugins;
  state.admin.logs = logs.logs;
  state.admin.appearance = appearance.appearance;
  state.admin.presets = appearance.presets || [];
  state.admin.presetCatalog = presetCatalog;
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
    renderWeatherForecasts(data.weather);
  } catch (error) {
    card?.classList.add('is-error');
    $('weather-temp').textContent = '—°';
    $('weather-summary').textContent = 'Weather unavailable';
    $('weather-meta').textContent = `${error.message}. Retrying automatically every 5 minutes.`;
    $('weather-icon').textContent = '⚠️';
    $('weather-hourly').innerHTML = '';
    $('weather-daily').innerHTML = '';
  }
}

function renderWeatherForecasts(weather) {
  const hourly = weather.hourly || {};
  const daily = weather.daily || {};
  const now = Date.now();
  const hourlyItems = (hourly.time || [])
    .map((time, index) => ({
      time: new Date(time).getTime(),
      label: hourFormatter.format(new Date(time)),
      temp: Number((hourly.temperature_2m || [])[index]),
      code: (hourly.weather_code || [])[index],
      precip: Number((hourly.precipitation_probability || [])[index]),
      isDay: Number((hourly.is_day || [])[index])
    }))
    .filter((item) => item.time >= now - 60 * 60 * 1000)
    .slice(0, 8);
  $('weather-hourly').innerHTML = hourlyItems.map(weatherHourlyItemHtml).join('');

  const dailyItems = (daily.time || []).slice(0, 7).map((time, index) => ({
    label: index === 0 ? 'Today' : dayFormatter.format(new Date(`${time}T12:00:00`)),
    high: Number((daily.temperature_2m_max || [])[index]),
    low: Number((daily.temperature_2m_min || [])[index]),
    code: (daily.weather_code || [])[index],
    precip: Number((daily.precipitation_probability_max || [])[index])
  }));
  $('weather-daily').innerHTML = dailyItems.map(weatherDailyItemHtml).join('');
}

function weatherHourlyItemHtml(item) {
  const code = weatherCodes[item.code] || ['Forecast', '🌤️', '🌙'];
  const icon = item.isDay === 0 ? code[2] : code[1];
  const temp = Number.isFinite(item.temp) ? `${Math.round(item.temp)}°` : '—°';
  const precip = Number.isFinite(item.precip) ? `${Math.round(item.precip)}%` : '—';
  return `<article class="forecast-chip" title="${escapeHtml(code[0])}"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(icon)} ${escapeHtml(temp)}</strong><small>${escapeHtml(precip)}</small></article>`;
}

function weatherDailyItemHtml(item) {
  const code = weatherCodes[item.code] || ['Forecast', '🌤️', '🌙'];
  const high = Number.isFinite(item.high) ? Math.round(item.high) : '—';
  const low = Number.isFinite(item.low) ? Math.round(item.low) : '—';
  const precip = Number.isFinite(item.precip) ? `${Math.round(item.precip)}%` : '—';
  return `<article class="forecast-chip daily-chip" title="${escapeHtml(code[0])}"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(code[1])} ${escapeHtml(high)}°/${escapeHtml(low)}°</strong><small>${escapeHtml(precip)}</small></article>`;
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
  applyLayoutOrder();
  updateLayoutEditingUi();
  if (isAdmin()) renderAdminConsole();
}

function normalizeLayoutOrder(order = []) {
  const seen = new Set();
  const valid = [];
  for (const id of Array.isArray(order) ? order : []) {
    if (defaultLayoutOrder.includes(id) && !seen.has(id)) {
      seen.add(id);
      valid.push(id);
    }
  }
  for (const id of defaultLayoutOrder) if (!seen.has(id)) valid.push(id);
  return valid;
}

function applyLayoutOrder() {
  const root = $('layout-root');
  if (!root) return;
  const order = normalizeLayoutOrder(state.preferences.layoutOrder);
  state.preferences.layoutOrder = order;
  for (const id of order) {
    const item = root.querySelector(`[data-layout-id="${CSS.escape(id)}"]`);
    if (item) root.appendChild(item);
  }
}

function updateLayoutEditingUi() {
  document.body.classList.toggle('layout-editing', state.layoutEditing);
  $('layout-toolbar').hidden = !state.layoutEditing;
  document.querySelectorAll('[data-layout-id]').forEach((item) => {
    item.draggable = state.layoutEditing;
    item.classList.toggle('is-layout-editable', state.layoutEditing);
    let handle = item.querySelector(':scope > .layout-drag-handle');
    if (state.layoutEditing && !handle) {
      handle = document.createElement('div');
      handle.className = 'layout-drag-handle';
      handle.innerHTML = `<span>☰ ${escapeHtml(layoutLabels[item.dataset.layoutId] || 'Section')}</span><span class="layout-keyboard-controls"><button class="ghost" type="button" data-layout-move="up" data-layout-target="${escapeHtml(item.dataset.layoutId)}" aria-label="Move ${escapeHtml(layoutLabels[item.dataset.layoutId] || 'section')} up">↑</button><button class="ghost" type="button" data-layout-move="down" data-layout-target="${escapeHtml(item.dataset.layoutId)}" aria-label="Move ${escapeHtml(layoutLabels[item.dataset.layoutId] || 'section')} down">↓</button></span>`;
      item.prepend(handle);
    } else if (!state.layoutEditing && handle) {
      handle.remove();
    }
  });
}

async function setLayoutEditing(enabled) {
  state.layoutEditing = enabled;
  updateLayoutEditingUi();
  if (enabled) toast('Drag sections to rearrange your layout');
  else {
    await persistLayoutOrder();
    toast('Layout saved');
  }
}

async function persistLayoutOrder() {
  const root = $('layout-root');
  if (!root) return;
  state.preferences.layoutOrder = normalizeLayoutOrder([...root.querySelectorAll('[data-layout-id]')].map((item) => item.dataset.layoutId));
  await saveLaunchpadPreferences();
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
    controls.innerHTML = `<div class="control-group" aria-label="Category filters"><button class="ghost service-category-chip ${!state.selectedCategory ? 'active-filter' : ''}" type="button" data-launch-category="">All</button>${categories.map((cat) => `<button class="ghost service-category-chip ${state.selectedCategory === cat ? 'active-filter' : ''} ${hidden.has(cat) ? 'muted-filter' : ''}" type="button" data-launch-category="${escapeHtml(cat)}">${hidden.has(cat) ? 'Hidden: ' : ''}${escapeHtml(cat)}</button>`).join('')}</div><div class="control-group" aria-label="Layout"><button class="ghost ${state.preferences.viewMode === 'cards' ? 'active-filter' : ''}" type="button" data-view-mode="cards">Cards</button><button class="ghost ${state.preferences.viewMode === 'compact' ? 'active-filter' : ''}" type="button" data-view-mode="compact">Compact</button><button class="ghost ${state.preferences.viewMode === 'list' ? 'active-filter' : ''}" type="button" data-view-mode="list">List</button></div>${isAdmin() ? `<div class="control-group" aria-label="Options"><button class="ghost ${state.preferences.hideMetadata ? 'active-filter' : ''}" type="button" data-toggle-metadata>${state.preferences.hideMetadata ? 'Show Metadata' : 'Hide Metadata'}</button></div>` : ''}`;
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
      <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(s.name)}">${iconHtml(s.icon, s.name)}<span><strong>${escapeHtml(s.name)}</strong>${state.preferences.hideMetadata ? '' : `<br><small>${escapeHtml(getHost(s.url))}</small>`}</span></a>
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
    </span></div><h3 title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</h3><p>${escapeHtml(s.description || 'No description provided.')}</p><a class="service-link ${state.preferences.hideMetadata ? 'link-only-overlay' : ''}" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer"><span>${state.preferences.hideMetadata ? '' : escapeHtml(getHost(s.url))}</span></a></div>
    <div><div class="service-meta">${meta}</div>${state.preferences.hideMetadata ? '' : `<div class="tags">${(s.tags || []).slice(0, 4).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>`}</div>
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

function layoutDropTarget(event) {
  const root = $('layout-root');
  const target = event.target.closest('[data-layout-id]');
  if (!root || !target || !root.contains(target) || target.dataset.layoutId === state.draggedLayoutId) return null;
  return target;
}

$('layout-root').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-layout-move]');
  if (!button || !state.layoutEditing) return;
  const item = document.querySelector(`[data-layout-id="${CSS.escape(button.dataset.layoutTarget)}"]`);
  const root = $('layout-root');
  if (!item || !root) return;
  if (button.dataset.layoutMove === 'up' && item.previousElementSibling) root.insertBefore(item, item.previousElementSibling);
  if (button.dataset.layoutMove === 'down' && item.nextElementSibling) root.insertBefore(item.nextElementSibling, item);
  await persistLayoutOrder();
  toast('Layout saved');
});

$('layout-root').addEventListener('dragstart', (event) => {
  if (!state.layoutEditing) return;
  const item = event.target.closest('[data-layout-id]');
  if (!item) return;
  state.draggedLayoutId = item.dataset.layoutId;
  item.classList.add('is-dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', state.draggedLayoutId);
});
$('layout-root').addEventListener('dragover', (event) => {
  if (!state.layoutEditing || !state.draggedLayoutId) return;
  const target = layoutDropTarget(event);
  if (!target) return;
  event.preventDefault();
  const dragged = document.querySelector(`[data-layout-id="${CSS.escape(state.draggedLayoutId)}"]`);
  if (!dragged) return;
  const rect = target.getBoundingClientRect();
  const after = event.clientY > rect.top + rect.height / 2 || (Math.abs(event.clientY - (rect.top + rect.height / 2)) < 20 && event.clientX > rect.left + rect.width / 2);
  target.parentNode.insertBefore(dragged, after ? target.nextSibling : target);
});
$('layout-root').addEventListener('drop', async (event) => {
  if (!state.layoutEditing) return;
  event.preventDefault();
  await persistLayoutOrder();
});
$('layout-root').addEventListener('dragend', async () => {
  document.querySelectorAll('.is-dragging').forEach((item) => item.classList.remove('is-dragging'));
  state.draggedLayoutId = '';
  if (state.layoutEditing) await persistLayoutOrder();
});

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
  const toggleMetadataButton = event.target.closest('[data-toggle-metadata]');
  if (toggleMetadataButton && isAdmin()) {
    state.preferences.hideMetadata = !state.preferences.hideMetadata;
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
  if (del) {
    const service = state.services.find((s) => s.id === del.dataset.delete);
    const name = service ? service.name : 'this service';
    if (confirm(`Delete "${name}"?`)) {
      await api(`/api/services/${del.dataset.delete}`, { method: 'DELETE' });
      await loadServices();
      if (isAdmin()) await loadAdminData();
      renderServices();
      toast('Service deleted');
    }
  }
});
$('services-empty').addEventListener('click', (event) => { if (event.target.closest('[data-empty-add-service]')) showServiceModal(); });
$('add-service-button').addEventListener('click', () => showServiceModal());
$('login-button').addEventListener('click', showLoginModal);
$('session-button').addEventListener('click', () => { const dd = $('user-dropdown'); const open = dd.hidden; dd.hidden = !open; $('session-button').setAttribute('aria-expanded', String(open)); });
$('user-dropdown').addEventListener('click', async (event) => {
  const action = event.target.closest('[data-profile-action]')?.dataset.profileAction;
  if (action === 'profile') { $('user-dropdown').hidden = true; $('session-button').setAttribute('aria-expanded', 'false'); showProfileModal(); }
  if (action === 'layout') { $('user-dropdown').hidden = true; $('session-button').setAttribute('aria-expanded', 'false'); await setLayoutEditing(!state.layoutEditing); }
  if (action === 'logout') await logout();
});
document.addEventListener('click', (event) => { if (!$('user-menu').contains(event.target)) { $('user-dropdown').hidden = true; $('session-button').setAttribute('aria-expanded', 'false'); } });
$('side-profile-button').addEventListener('click', showProfileModal);
async function logout() { await api('/api/auth/logout', { method: 'POST' }); location.reload(); }
$('layout-done').addEventListener('click', () => setLayoutEditing(false));
$('layout-reset').addEventListener('click', async () => { state.preferences.layoutOrder = [...defaultLayoutOrder]; applyLayoutOrder(); await persistLayoutOrder(); toast('Layout reset'); });
$('settings-button').addEventListener('click', () => { location.hash = 'admin-panel'; state.adminTab = 'settings'; renderAdminConsole(); });
$('users-button').addEventListener('click', () => { location.hash = 'admin-panel'; state.adminTab = 'users'; renderAdminConsole(); });
$('plugin-manager-button').addEventListener('click', () => { location.hash = 'admin-panel'; state.adminTab = 'plugins'; renderAdminConsole(); });
$('admin-refresh-button').addEventListener('click', loadAdminData);
document.querySelectorAll('.admin-tab').forEach((tab) => {
  tab.addEventListener('click', () => { state.adminTab = tab.dataset.adminTab; renderAdminConsole(); });
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll('.admin-tab')];
    const current = tabs.indexOf(tab);
    let next = current;
    if (event.key === 'ArrowLeft') next = current <= 0 ? tabs.length - 1 : current - 1;
    if (event.key === 'ArrowRight') next = current >= tabs.length - 1 ? 0 : current + 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    event.preventDefault();
    state.adminTab = tabs[next].dataset.adminTab;
    renderAdminConsole();
    tabs[next].focus({ preventScroll: true });
  });
});

const iconChoices = ['🔗','🏠','📈','📶','🎬','🧰','🖥️','☁️','🔒','📦','🧪','📰'];
const colorChoices = ['#8fd3ff','#8ee6b0','#ffd27a','#ff8f9d','#b99cff','#6da8ff','#4de7ff','#94a3b8'];
function presetSearchHtml() {
  return `<div class="field preset-search-field"><label>Search presets</label><input id="preset-search" placeholder="Type Plex, Pi-hole, Home Assistant…" autocomplete="off"><div id="preset-results" class="preset-results" hidden></div><small>Search the service preset catalog to auto-fill the form. You can also fill in everything manually below.</small></div>`;
}
function presetResultHtml(p) {
  const badge = p.source === 'heimdall'
    ? '<span class="preset-badge preset-badge-heimdall" title="From Heimdall community catalog">⛏ Heimdall</span>'
    : '<span class="preset-badge preset-badge-native" title="Bundled with Home Lab Launcher">★ Native</span>';
  return `<button class="preset-result" type="button" data-preset-id="${escapeHtml(p.id)}"><span class="preset-result-name">${escapeHtml(p.name)}</span>${badge}<span class="preset-result-desc">${escapeHtml(p.description || p.category || '')}</span></button>`;
}
function serviceForm(s = {}) { return `<h2>${s.id ? 'Edit' : 'Add'} service</h2><div class="form-grid">${!s.id && canEditServices() ? presetSearchHtml() : ''}<div class="row"><div class="field"><label>Name</label><input id="svc-name" value="${escapeHtml(s.name || '')}"></div><div class="field"><label>Icon</label><input id="svc-icon" value="${escapeHtml(s.icon || '🔗')}" placeholder="Emoji or https://... image URL"><small>Use an emoji, paste an image URL, or choose a local JPEG, PNG, GIF, or WebP. Remote/local images are stored by the launcher.</small><div class="choice-row">${iconChoices.map((icon) => `<button class="ghost choice-btn" type="button" data-icon-choice="${escapeHtml(icon)}">${escapeHtml(icon)}</button>`).join('')}</div></div></div><div class="field"><label>Local icon image</label><input id="svc-icon-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp"><small>Animated GIFs/WebP and transparent images are preserved. Maximum size: 5 MiB.</small></div><div class="field"><label>URL</label><input id="svc-url" value="${escapeHtml(s.url || '')}"></div><div class="field"><label>Description</label><textarea id="svc-description">${escapeHtml(s.description || '')}</textarea></div><div class="row"><div class="field"><label>Category</label><input id="svc-category" value="${escapeHtml(s.category || 'general')}"></div><div class="field"><label>Accent color</label><input id="svc-accent" type="color" value="${escapeHtml(s.accent || '#8fd3ff')}"><div class="choice-row">${colorChoices.map((color) => `<button class="color-choice" type="button" data-color-choice="${escapeHtml(color)}" style="--swatch:${escapeHtml(color)}" aria-label="Use ${escapeHtml(color)}"></button>`).join('')}</div></div></div><div class="field"><label>Tags, comma-separated</label><input id="svc-tags" value="${escapeHtml((s.tags || []).join(', '))}"></div><div class="row"><div class="field"><label>Sort order</label><input id="svc-sort" type="number" value="${escapeHtml(s.sortOrder || 0)}"></div><div class="field"><label>Health interval minutes</label><input id="svc-health-interval" type="number" min="1" value="${escapeHtml(s.healthCheckIntervalMinutes || 15)}"></div></div><label class="check-line"><input id="svc-health-enabled" type="checkbox" ${s.healthCheckEnabled ? 'checked' : ''}> Enable HTTP health checks</label><div class="field"><label>Health check URL</label><input id="svc-health-url" value="${escapeHtml(s.healthCheckUrl || '')}" placeholder="Defaults to service URL"><small>Leave blank to check the main service URL. Checks run in the background and can also be triggered manually.</small></div><div class="inline-controls"><button class="ghost" id="test-service-url" type="button">Test URL</button><span id="service-url-test-result" class="test-result"></span></div><div class="row"><label><input id="svc-featured" type="checkbox" ${s.featured ? 'checked' : ''}> Featured</label><label><input id="svc-enabled" type="checkbox" ${s.enabled !== false ? 'checked' : ''}> Enabled</label></div><div id="service-form-error" class="form-error-banner" style="display: none;"></div><button class="primary" id="save-service" type="button">Save service</button></div>`; }
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
function bindPresetSearch() {
  const input = $('preset-search');
  const resultsEl = $('preset-results');
  if (!input || !resultsEl) return;
  let debounceTimer = null;
  let lastResults = [];
  resultsEl.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-preset-id]');
    if (!btn) return;
    const preset = lastResults.find((p) => p.id === btn.dataset.presetId);
    if (preset) applyPresetToForm(preset);
    resultsEl.hidden = true;
    input.value = '';
  });
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const query = input.value.trim();
    if (query.length < 2) { resultsEl.hidden = true; resultsEl.innerHTML = ''; lastResults = []; return; }
    debounceTimer = setTimeout(async () => {
      try {
        const data = await api(`/api/admin/presets/search?q=${encodeURIComponent(query)}`);
        lastResults = data.presets || [];
        if (!lastResults.length) { resultsEl.innerHTML = '<div class="preset-empty">No matching presets found</div>'; resultsEl.hidden = false; return; }
        resultsEl.innerHTML = lastResults.map(presetResultHtml).join('');
        resultsEl.hidden = false;
      } catch { resultsEl.hidden = true; }
    }, 250);
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.preset-search-field')) resultsEl.hidden = true;
  });
}
function applyPresetToForm(preset) {
  $('svc-name').value = preset.name;
  $('svc-description').value = preset.description || '';
  $('svc-category').value = preset.category || 'general';
  $('svc-accent').value = preset.accent || '#8fd3ff';
  $('svc-url').value = preset.website || '';
  if (preset.iconUrl) $('svc-icon').value = preset.iconUrl;
  toast(`Preset "${preset.name}" applied — update the URL to your local address`);
}

function showServiceModal(s) {
  openModal(serviceForm(s));
  modalContent.querySelectorAll('[data-icon-choice]').forEach((button) => button.addEventListener('click', () => { $('svc-icon').value = button.dataset.iconChoice; }));
  modalContent.querySelectorAll('[data-color-choice]').forEach((button) => button.addEventListener('click', () => { $('svc-accent').value = button.dataset.colorChoice; }));
  if (!s) bindPresetSearch();
  $('test-service-url').onclick = async () => {
    const target = formValue('svc-health-url') || formValue('svc-url');
    const result = $('service-url-test-result');
    result.textContent = 'Testing…';
    try {
      const data = await api('/api/services/test-url', { method: 'POST', body: JSON.stringify({ url: target }) });
      result.textContent = data.ok ? `OK · HTTP ${data.statusCode} · ${data.responseMs}ms` : `Failed · ${data.error || data.status || 'unreachable'}`;
      result.className = `test-result ${data.ok ? 'success' : 'danger'}`;
    } catch (error) {
      result.textContent = error.message;
      result.className = 'test-result danger';
    }
  };
  $('save-service').onclick = async () => {
    const errorEl = $('service-form-error');
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }
    try {
      const body = await readServiceForm();
      await api(s?.id ? `/api/services/${s.id}` : '/api/services', { method: s?.id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      closeModal();
      await loadServices();
      if (isAdmin()) await loadAdminData();
      renderServices();
      toast('Service saved');
    } catch (error) {
      if (errorEl) {
        errorEl.textContent = error.message;
        errorEl.style.display = 'flex';
      } else {
        toast(error.message);
      }
    }
  };
}


function showLoginModal() {
  openModal(`<h2>Login</h2><div class="form-grid"><div id="login-user-field" class="field"><label>Username</label><input id="login-username"></div><div id="login-pass-field" class="field"><label>Password</label><input id="login-password" type="password"></div><div id="login-code-field" class="field" hidden><label>2FA Code</label><input id="login-code" type="text" placeholder="123456" pattern="[0-9]{6}" inputmode="numeric"></div><div id="login-form-error" class="form-error-banner" style="display: none;"></div><button class="primary" id="login-submit" type="button">Login</button></div>`);
  let requiresTotp = false;
  $('login-submit').onclick = async () => {
    const username = formValue('login-username');
    const password = formValue('login-password');
    const code = requiresTotp ? formValue('login-code') : '';
    const errorEl = $('login-form-error');
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }
    try {
      const res = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password, code }) });
      if (res.requiresTotp) {
        requiresTotp = true;
        $('login-user-field').hidden = true;
        $('login-pass-field').hidden = true;
        $('login-code-field').hidden = false;
        $('login-submit').textContent = 'Verify & Login';
        $('login-code').focus();
      } else {
        location.reload();
      }
    } catch (error) {
      if (errorEl) {
        errorEl.textContent = error.message;
        errorEl.style.display = 'flex';
      } else {
        toast(error.message);
      }
    }
  };
}
function showBootstrapModal() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = new Uint8Array(20);
  window.crypto.getRandomValues(bytes);
  let generatedSecret = '';
  for (let i = 0; i < bytes.length; i++) generatedSecret += alphabet[bytes[i] % 32];
  const formattedSecret = generatedSecret.match(/.{1,4}/g).join(' ');
  openModal(`<h2>Create first Admin</h2><p>No users exist yet. Create the base Admin account to finish setup.</p><div class="form-grid"><div class="field"><label>Username</label><input id="boot-username"></div><div class="field"><label>Password</label><input id="boot-password" type="password" placeholder="10+ characters"></div><label class="check-line"><input id="boot-enable-totp" type="checkbox"> Enable 2FA (TOTP) immediately</label><div id="boot-totp-setup" hidden class="settings-card" style="margin-top: 10px;"><p>Add this secret key to your authenticator app:</p><p style="font-family: monospace; font-size: 1.25rem; font-weight: bold; text-align: center; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; letter-spacing: 2px;">${formattedSecret}</p><div class="field"><label>Enter the 6-digit code to verify</label><input id="boot-totp-code" type="text" placeholder="123456" pattern="[0-9]{6}" inputmode="numeric"></div></div><div id="boot-form-error" class="form-error-banner" style="display: none;"></div><button class="primary" style="margin-top: 15px;" id="boot-submit" type="button">Create Admin</button></div>`);
  $('boot-enable-totp').addEventListener('change', (e) => { $('boot-totp-setup').hidden = !e.target.checked; });
  $('boot-submit').onclick = async () => {
    const username = formValue('boot-username');
    const password = formValue('boot-password');
    const enableTotp = $('boot-enable-totp').checked;
    const totpCode = enableTotp ? formValue('boot-totp-code') : '';
    const payload = { username, password };
    const errorEl = $('boot-form-error');
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }
    if (enableTotp) {
      if (!totpCode) {
        if (errorEl) {
          errorEl.textContent = 'Please enter the 2FA code to verify setup';
          errorEl.style.display = 'flex';
        } else {
          toast('Please enter the 2FA code to verify setup');
        }
        return;
      }
      payload.totpSecret = generatedSecret;
      payload.totpCode = totpCode;
    }
    try {
      await api('/api/bootstrap', { method: 'POST', body: JSON.stringify(payload) });
      location.reload();
    } catch (error) {
      if (errorEl) {
        errorEl.textContent = error.message;
        errorEl.style.display = 'flex';
      } else {
        toast(error.message);
      }
    }
  };
}
async function showProfileModal() {
  const [me, sessions] = await Promise.all([api('/api/me'), api('/api/me/sessions')]);
  const totpSection = me.user.totpEnabled ? `
    <div class="settings-card">
      <p><strong>Status:</strong> Enabled</p>
      <button class="ghost danger" id="profile-disable-2fa" type="button">Disable 2FA</button>
    </div>
  ` : `
    <div class="settings-card">
      <p><strong>Status:</strong> Disabled</p>
      <button class="ghost" id="profile-setup-2fa" type="button">Setup 2FA</button>
      <div id="profile-2fa-setup-area" hidden style="margin-top: 15px;">
        <p>Scan or add this secret key to your authenticator app:</p>
        <p id="profile-2fa-secret" style="font-family: monospace; font-size: 1.15rem; font-weight: bold; text-align: center; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; letter-spacing: 2px;"></p>
        <div class="field" style="margin-top: 10px;">
          <label>Enter the 6-digit verification code</label>
          <input id="profile-2fa-code" type="text" placeholder="123456" pattern="[0-9]{6}" inputmode="numeric">
        </div>
        <button class="primary" style="margin-top: 10px;" id="profile-confirm-2fa" type="button">Verify & Enable</button>
      </div>
    </div>
  `;
  openModal(`<h2>Profile</h2><div class="settings-card"><p><strong>${escapeHtml(me.user.username)}</strong></p><p>${escapeHtml(roleLabel(me.user.role))} · Created ${new Date(me.user.createdAt).toLocaleString()}</p></div><div id="profile-form-error" class="form-error-banner" style="display: none;"></div><h3>Two-factor authentication (2FA)</h3>${totpSection}<h3>Change password</h3><div class="form-grid"><div class="field"><label>Current password</label><input id="profile-current" type="password"></div><div class="field"><label>New password</label><input id="profile-new" type="password" placeholder="10+ characters"></div><button class="primary" id="profile-save-password" type="button">Change password</button></div><h3>Active sessions</h3><div class="log-list">${sessions.sessions.map((item) => `<article class="log-item"><strong>${item.current ? 'Current session' : 'Other session'}</strong><span>${escapeHtml(item.ip)} · expires ${new Date(item.expiresAt).toLocaleString()}</span><small>${escapeHtml(item.userAgent)}</small>${item.current ? '' : `<button class="ghost danger" data-revoke-session="${escapeHtml(item.sid)}" type="button">Revoke</button>`}</article>`).join('')}</div><button class="ghost danger" id="revoke-other-sessions" type="button">Revoke all other sessions</button><h3>Preferences</h3><div class="inline-controls"><button class="ghost" id="reset-layout-preferences" type="button">Reset layout/preferences</button><button class="ghost" id="reset-favorites" type="button">Reset favorites</button></div><p class="muted-copy">Reset layout order, hidden categories, and view mode separately from favorites.</p>`);
  
  const showError = (msg) => {
    const errorEl = $('profile-form-error');
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.style.display = msg ? 'flex' : 'none';
    }
  };

  $('profile-save-password').onclick = async () => {
    showError('');
    try {
      await api('/api/me/password', { method: 'PATCH', body: JSON.stringify({ currentPassword: formValue('profile-current'), newPassword: formValue('profile-new') }) });
      closeModal();
      toast('Password changed');
    } catch (error) {
      showError(error.message);
    }
  };
  $('revoke-other-sessions').onclick = async () => {
    showError('');
    try {
      await api('/api/me/sessions', { method: 'DELETE' });
      closeModal();
      toast('Other sessions revoked');
    } catch (error) {
      showError(error.message);
    }
  };
  if (me.user.totpEnabled) {
    $('profile-disable-2fa').onclick = async () => {
      if (confirm('Are you sure you want to disable 2FA? This will lower your account security.')) {
        showError('');
        try {
          await api('/api/me/totp/disable', { method: 'POST' });
          toast('2FA disabled');
          await showProfileModal();
        } catch (error) {
          showError(error.message);
        }
      }
    };
  } else {
    let activeSecret = '';
    $('profile-setup-2fa').onclick = async () => {
      showError('');
      try {
        const res = await api('/api/me/totp/setup', { method: 'POST' });
        activeSecret = res.secret;
        const formatted = res.secret.match(/.{1,4}/g).join(' ');
        $('profile-2fa-secret').textContent = formatted;
        $('profile-2fa-setup-area').hidden = false;
        $('profile-setup-2fa').hidden = true;
      } catch (error) {
        showError(error.message);
      }
    };
    $('profile-confirm-2fa').onclick = async () => {
      const code = formValue('profile-2fa-code');
      if (!code) {
        showError('Please enter verification code');
        return;
      }
      showError('');
      try {
        await api('/api/me/totp/enable', { method: 'POST', body: JSON.stringify({ secret: activeSecret, code }) });
        toast('2FA enabled successfully');
        await showProfileModal();
      } catch (error) {
        showError(error.message);
      }
    };
  }
  $('reset-layout-preferences').onclick = async () => {
    showError('');
    try {
      if (state.user) await api('/api/me/preferences/launchpad', { method: 'DELETE' });
      else localStorage.removeItem('hll.launchpad');
      state.preferences = { viewMode: 'cards', hiddenCategories: [], layoutOrder: [...defaultLayoutOrder], hideMetadata: false };
      closeModal(); render(); await setLayoutEditing(false); toast('Layout and launchpad preferences reset');
    } catch (error) {
      showError(error.message);
    }
  };
  $('reset-favorites').onclick = async () => {
    showError('');
    try {
      if (state.user) await api('/api/me/preferences/favorites', { method: 'DELETE' });
      else localStorage.removeItem('hll.favorites');
      state.favorites = [];
      closeModal(); renderServices(); toast('Favorites reset');
    } catch (error) {
      showError(error.message);
    }
  };
  modalContent.querySelectorAll('[data-revoke-session]').forEach((button) => button.addEventListener('click', async () => {
    showError('');
    try {
      await api(`/api/me/sessions/${button.dataset.revokeSession}`, { method: 'DELETE' });
      closeModal();
      toast('Session revoked');
    } catch (error) {
      showError(error.message);
    }
  }));
}

init();
