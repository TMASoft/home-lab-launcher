const state = {
  user: null,
  services: [],
  favorites: [],
  preferences: { viewMode: 'cards', hiddenCategories: [], hideMetadata: false, sortBy: 'custom', servicesOrder: [], plugins: {} },
  selectedCategory: '',
  settings: null,
  version: '',
  repositoryUrl: '',
  pluginSections: [],
  csrfToken: null,
  adminTab: 'overview',
  layoutEditing: false,
  draggedLayoutId: '',
  admin: { overview: null, health: null, config: null, notices: [], users: [], plugins: [], logs: [], appearance: null, presets: [] }
};

const $ = (id) => document.getElementById(id);
const modal = $('modal');
const modalContent = $('modal-content');
let lastFocusedBeforeModal = null;
const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

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
const isStoredAppAsset = (value) => /^\/api\/app-assets\/[a-f0-9]{64}\.(jpg|png|gif|webp)$/i.test(String(value || ''));
const appearanceCssVariables = ['--bg', '--surface', '--surface-2', '--surface-3', '--ink', '--muted', '--quiet', '--line', '--line-strong', '--primary', '--primary-ink', '--success', '--warning', '--danger'];
const sanitizeClientFontFamily = (value) => String(value || '').replace(/[\u0000-\u001f\u007f;{}<>]/g, '').trim().slice(0, 160);
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
const defaultLayoutOrder = ['hero', 'services'];
const layoutLabels = { hero: 'Hero', services: 'Service launchpad' };

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}
function firstFocusableIn(root) {
  return [...root.querySelectorAll(focusableSelector)].find((el) => !el.disabled && !el.hidden && el.offsetParent !== null);
}
function restoreModalFocus() {
  const target = lastFocusedBeforeModal;
  lastFocusedBeforeModal = null;
  if (target && document.contains(target) && typeof target.focus === 'function') setTimeout(() => target.focus({ preventScroll: true }), 0);
}
function openModal(html) {
  lastFocusedBeforeModal = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modalContent.innerHTML = html;
  modal.showModal();
  const target = firstFocusableIn(modalContent) || modal.querySelector('.close') || modal;
  requestAnimationFrame(() => target.focus({ preventScroll: true }));
}
function closeModal() { if (modal.open) modal.close(); else restoreModalFocus(); }
modal?.addEventListener('close', restoreModalFocus);
modal?.querySelector('form')?.addEventListener('submit', (event) => event.preventDefault());
modal?.querySelector('.close')?.addEventListener('click', (e) => {
  e.preventDefault();
  closeModal();
});
function formValue(id) { return $(id)?.value?.trim() || ''; }

function applyAppearance(appearance = {}) {
  const brand = appearance.brand || {};
  const hero = appearance.hero || {};
  const theme = appearance.theme || {};
  document.title = brand.pageTitle || brand.appName || 'Home Lab Launcher';
  $('brand-name').textContent = brand.brandText || brand.appName || 'Home Lab Launcher';
  $('brand-subtitle').textContent = brand.brandSubtitle || 'Home lab control plane';
  if ($('app-version')) $('app-version').textContent = state.version ? `v${state.version}` : '';
  if ($('repo-link')) {
    $('repo-link').href = state.repositoryUrl || 'https://github.com/TMASoft/home-lab-launcher';
    $('repo-link').hidden = !state.repositoryUrl;
  }
  const mark = $('brand-mark');
  if (mark) {
    mark.replaceChildren();
    if (isStoredAppAsset(brand.brandIconUrl)) {
      const img = document.createElement('img');
      img.src = brand.brandIconUrl;
      img.alt = '';
      mark.appendChild(img);
    } else {
      mark.textContent = brand.brandMarkText || 'HL';
    }
  }
  $('hero-eyebrow').textContent = hero.eyebrow || 'Home lab operations';
  $('hero-heading').textContent = hero.heading || 'Launch and manage your internal services.';
  $('hero-subheading').innerHTML = hero.subheading || '';
  const siteNote = $('site-note');
  if (siteNote) {
    siteNote.textContent = brand.footerNote || '';
    siteNote.hidden = !brand.footerNote;
  }
  const favicon = document.querySelector('link[rel="icon"]');
  if (isStoredAppAsset(brand.faviconUrl)) {
    const link = favicon || document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'icon' }));
    link.href = brand.faviconUrl;
  } else if (favicon) {
    favicon.remove();
  }
  const heroCard = document.querySelector('.hero-card');
  if (heroCard) {
    if (isStoredAppAsset(brand.heroImageUrl)) {
      heroCard.style.backgroundImage = `linear-gradient(90deg, var(--surface) 0%, color-mix(in srgb, var(--surface) 88%, transparent) 58%, color-mix(in srgb, var(--surface) 48%, transparent)), url("${brand.heroImageUrl}")`;
      heroCard.style.backgroundSize = 'cover';
      heroCard.style.backgroundPosition = 'center';
    } else {
      heroCard.style.removeProperty('background-image');
      heroCard.style.removeProperty('background-size');
      heroCard.style.removeProperty('background-position');
    }
  }
  const root = document.documentElement;
  appearanceCssVariables.forEach((key) => root.style.removeProperty(key));
  Object.entries(theme.cssVariables || {}).forEach(([key, value]) => root.style.setProperty(key, value));
  document.body.classList.remove('theme-light', 'theme-dark', 'theme-system', 'density-compact', 'density-comfortable', 'density-spacious', 'radius-square', 'radius-rounded', 'radius-soft', 'font-system', 'font-inter', 'font-serif', 'font-mono', 'font-custom');
  document.body.classList.add(`theme-${theme.mode || 'dark'}`, `density-${theme.density || 'comfortable'}`, `radius-${theme.radius || 'soft'}`, `font-${theme.fontFamily || 'system'}`);
  if (theme.fontFamily === 'custom' && theme.customFontFamily) document.body.style.fontFamily = sanitizeClientFontFamily(theme.customFontFamily);
  else document.body.style.fontFamily = '';
}
