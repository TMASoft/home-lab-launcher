const http = require('http');
const { guardedFetch } = require('../server-fetch');
const { MAX_CANDIDATES, normalizeLabels, labelHints, buildCandidate } = require('./candidates');

const DOCKER_TIMEOUT_MS = 8000;
const MAX_DOCKER_RESPONSE_BYTES = 10 * 1024 * 1024;

/* The Docker socket is never mounted or assumed by default. Discovery only
   talks to an endpoint the admin configured explicitly: an http(s) socket
   proxy (preferred; see docs/deployment.md) or a unix socket path. */
function parseDockerEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      return { kind: 'http', base: `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}` };
    } catch {
      return null;
    }
  }
  const socketPath = raw.replace(/^unix:\/\//i, '');
  if (socketPath.startsWith('/')) return { kind: 'socket', socketPath };
  return null;
}

function unixSocketJson(socketPath, apiPath) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, path: apiPath, method: 'GET', headers: { Host: 'docker', Accept: 'application/json' } }, (response) => {
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_DOCKER_RESPONSE_BYTES) {
          request.destroy(new Error('Docker endpoint response is too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Docker endpoint returned HTTP ${response.statusCode}`));
          return;
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('Docker endpoint returned invalid JSON')); }
      });
    });
    request.setTimeout(DOCKER_TIMEOUT_MS, () => request.destroy(new Error('Docker endpoint timed out')));
    request.on('error', (error) => reject(new Error(`Docker endpoint request failed: ${error.message}`)));
    request.end();
  });
}

async function fetchContainers(endpoint, { actorRole = 'admin' } = {}) {
  const parsed = parseDockerEndpoint(endpoint);
  if (!parsed) throw new Error('Docker discovery endpoint is not configured');
  if (parsed.kind === 'socket') return unixSocketJson(parsed.socketPath, '/containers/json');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOCKER_TIMEOUT_MS);
  try {
    const response = await guardedFetch(`${parsed.base}/containers/json`, { signal: controller.signal, headers: { Accept: 'application/json' } }, { actorRole, label: 'Docker endpoint' });
    if (!response.ok) throw new Error(`Docker endpoint returned HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Docker endpoint timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function containerPorts(container) {
  const out = [];
  for (const port of Array.isArray(container.Ports) ? container.Ports.slice(0, 50) : []) {
    const published = Number(port?.PublicPort);
    const target = Number(port?.PrivatePort);
    if (Number.isInteger(published) && published > 0 && Number.isInteger(target) && target > 0) {
      out.push({ published, target, protocol: String(port.Type || 'tcp').toLowerCase() });
    }
  }
  return out;
}

function dockerCandidates(containers, { defaultHost = '' } = {}) {
  const list = Array.isArray(containers) ? containers : [];
  const candidates = [];
  let ignored = 0;
  let truncated = 0;
  for (const container of list) {
    if (!container || typeof container !== 'object') continue;
    if (candidates.length >= MAX_CANDIDATES) { truncated += 1; continue; }
    const hints = labelHints(normalizeLabels(container.Labels));
    if (hints.ignored) { ignored += 1; continue; }
    const containerName = String(Array.isArray(container.Names) ? container.Names[0] || '' : '').replace(/^\//, '');
    const fallbackName = hints.composeService || containerName || String(container.Id || '').slice(0, 12);
    candidates.push(buildCandidate({
      source: 'docker',
      key: hints.composeProject && hints.composeService
        ? `docker:${hints.composeProject}:${hints.composeService}`
        : `docker:${String(container.Id || containerName || Math.random().toString(36).slice(2)).slice(0, 64)}`,
      fallbackName,
      image: typeof container.Image === 'string' ? container.Image : '',
      project: hints.composeProject,
      containerName,
      state: typeof container.State === 'string' ? container.State : '',
      hints,
      ports: containerPorts(container),
      defaultHost
    }));
  }
  return { candidates, ignored, truncated, containers: list.length };
}

module.exports = { parseDockerEndpoint, fetchContainers, dockerCandidates };
