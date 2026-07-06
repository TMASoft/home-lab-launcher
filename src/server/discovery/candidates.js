const { cleanText, slugId, stringList } = require('../validation');

const MAX_CANDIDATES = 200;

/* Discovery reads only these label namespaces. Everything else on a container or
   Compose service — environment values, arbitrary labels, secrets — is never
   inspected, so secret material cannot leak into candidates even by accident. */
const LAUNCHER_LABEL_PREFIX = 'home-lab-launcher.';
const HOMEPAGE_LABEL_PREFIX = 'homepage.';
const TRAEFIK_RULE_RE = /^traefik\.http\.routers\.[a-z0-9_.-]+\.rule$/i;
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';

/* Belt-and-braces: even inside the allowlisted namespaces, drop keys that look
   like credentials (e.g. home-lab-launcher.token set by a confused operator). */
const SECRETISH_KEY_RE = /(password|passwd|secret|token|api[-_]?key|credential|private[-_]?key|auth)/i;

const COMMON_WEB_PORTS = new Set([80, 443, 3000, 5000, 7575, 8000, 8080, 8081, 8096, 8123, 8443, 8888, 9000, 9090, 9443]);

function normalizeLabels(raw) {
  const out = {};
  if (Array.isArray(raw)) {
    for (const entry of raw.slice(0, 500)) {
      if (typeof entry !== 'string') continue;
      const eq = entry.indexOf('=');
      if (eq <= 0) continue;
      out[entry.slice(0, eq).trim().toLowerCase()] = entry.slice(eq + 1);
    }
    return out;
  }
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw).slice(0, 500)) {
      if (value === null || value === undefined || typeof value === 'object') continue;
      out[String(key).trim().toLowerCase()] = String(value);
    }
  }
  return out;
}

function labelHints(labels) {
  const hints = { launcher: {}, homepage: {}, traefikHosts: [], composeProject: '', composeService: '', ignored: false };
  for (const [key, rawValue] of Object.entries(labels)) {
    const value = cleanText(rawValue, '', 500);
    if (key.startsWith(LAUNCHER_LABEL_PREFIX)) {
      const field = key.slice(LAUNCHER_LABEL_PREFIX.length);
      if (field === 'ignore') { hints.ignored = ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()); continue; }
      if (SECRETISH_KEY_RE.test(field)) continue;
      if (['name', 'url', 'icon', 'category', 'description', 'tags'].includes(field)) hints.launcher[field] = value;
      continue;
    }
    if (key.startsWith(HOMEPAGE_LABEL_PREFIX)) {
      const field = key.slice(HOMEPAGE_LABEL_PREFIX.length);
      if (SECRETISH_KEY_RE.test(field)) continue;
      if (['name', 'href', 'icon', 'description', 'group'].includes(field)) hints.homepage[field] = value;
      continue;
    }
    if (TRAEFIK_RULE_RE.test(key)) {
      for (const match of value.matchAll(/Host\(\s*`([^`]+)`\s*\)/g)) {
        const host = cleanText(match[1], '', 253);
        if (host && !host.includes('{') && !hints.traefikHosts.includes(host)) hints.traefikHosts.push(host);
      }
      continue;
    }
    if (key === COMPOSE_PROJECT_LABEL) hints.composeProject = cleanText(value, '', 120);
    if (key === COMPOSE_SERVICE_LABEL) hints.composeService = cleanText(value, '', 120);
  }
  return hints;
}

/* URLs from labels may carry userinfo (https://user:pass@host); credentials are
   stripped rather than imported or displayed. */
function safeCandidateUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed;
  try { parsed = new URL(raw.includes('://') ? raw : `https://${raw}`); } catch { return ''; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return '';
  parsed.username = '';
  parsed.password = '';
  return parsed.toString();
}

function titleCase(value) {
  return String(value || '').replace(/[-_.]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

/* Icon guesses only keep values that are safe to store as-is: emoji/short text
   or an http(s) URL. Dashboard-icons style file names ("jellyfin.png") would
   render as literal text, so they are dropped. */
function iconGuess(value) {
  const raw = cleanText(value, '', 500);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return safeCandidateUrl(raw).slice(0, 500);
  if (/\.(png|svg|jpe?g|webp|gif|ico)$/i.test(raw)) return '';
  return raw.slice(0, 16);
}

function pickPublishedPort(ports) {
  const published = (ports || []).filter((p) => p.published > 0 && (!p.protocol || p.protocol === 'tcp'));
  if (!published.length) return null;
  published.sort((a, b) => {
    const aCommon = COMMON_WEB_PORTS.has(a.target) ? 0 : 1;
    const bCommon = COMMON_WEB_PORTS.has(b.target) ? 0 : 1;
    return aCommon - bCommon || a.published - b.published;
  });
  return published[0];
}

function guessUrl(hints, ports, defaultHost) {
  if (hints.launcher.url) {
    const url = safeCandidateUrl(hints.launcher.url);
    if (url) return { url, urlSource: 'label' };
  }
  if (hints.homepage.href) {
    const url = safeCandidateUrl(hints.homepage.href);
    if (url) return { url, urlSource: 'label' };
  }
  if (hints.traefikHosts.length) {
    const url = safeCandidateUrl(`https://${hints.traefikHosts[0]}`);
    if (url) return { url, urlSource: 'traefik' };
  }
  const port = pickPublishedPort(ports);
  if (port && defaultHost) {
    const scheme = [443, 8443, 9443].includes(port.target) ? 'https' : 'http';
    const url = safeCandidateUrl(`${scheme}://${defaultHost}:${port.published}`);
    if (url) return { url, urlSource: 'port' };
  }
  return { url: '', urlSource: 'none' };
}

function buildCandidate({ source, key, fallbackName, image = '', project = '', containerName = '', state = '', hints, ports = [], defaultHost = '' }) {
  const name = cleanText(hints.launcher.name || hints.homepage.name || titleCase(fallbackName), '', 120);
  const { url, urlSource } = guessUrl(hints, ports, defaultHost);
  const warnings = [];
  if (!url) warnings.push('No URL could be derived. Set a URL before importing.');
  return {
    key,
    source,
    name,
    suggestedId: slugId(name, ''),
    url,
    icon: iconGuess(hints.launcher.icon || hints.homepage.icon) || '🔗',
    category: cleanText(hints.launcher.category || hints.homepage.group, 'general', 80).toLowerCase(),
    description: cleanText(hints.launcher.description || hints.homepage.description || (image ? `Discovered from ${image}` : ''), '', 500),
    tags: stringList(hints.launcher.tags).slice(0, 20),
    details: {
      image: cleanText(image, '', 300),
      project: cleanText(project, '', 120),
      container: cleanText(containerName, '', 120),
      state: cleanText(state, '', 40),
      ports: ports.filter((p) => p.published > 0).slice(0, 20).map((p) => ({ published: p.published, target: p.target })),
      urlSource
    },
    warnings,
    conflict: null
  };
}

function normalizeUrlForMatch(value) {
  try {
    const parsed = new URL(String(value));
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}:${port}${parsed.pathname.replace(/\/+$/, '') || ''}`;
  } catch {
    return '';
  }
}

/* Marks candidates that collide with existing services (by URL first, then by
   the id the suggested name would slug to) so the review UI can offer
   skip/update/duplicate choices. Source metadata never overrides the database. */
function annotateConflicts(db, candidates) {
  const services = db.prepare('SELECT id, name, url FROM services').all();
  const byUrl = new Map();
  for (const service of services) {
    const match = normalizeUrlForMatch(service.url);
    if (match && !byUrl.has(match)) byUrl.set(match, service);
  }
  const byId = new Map(services.map((service) => [service.id, service]));
  for (const candidate of candidates) {
    const urlHit = candidate.url ? byUrl.get(normalizeUrlForMatch(candidate.url)) : null;
    const idHit = candidate.suggestedId ? byId.get(candidate.suggestedId) : null;
    const hit = urlHit || idHit;
    if (hit) candidate.conflict = { serviceId: hit.id, serviceName: hit.name, matchedBy: urlHit ? 'url' : 'id' };
  }
  return candidates;
}

module.exports = { MAX_CANDIDATES, normalizeLabels, labelHints, buildCandidate, annotateConflicts, safeCandidateUrl, pickPublishedPort };
