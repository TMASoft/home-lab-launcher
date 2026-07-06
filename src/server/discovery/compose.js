const YAML = require('yaml');
const { MAX_CANDIDATES, normalizeLabels, labelHints, buildCandidate } = require('./candidates');

const MAX_COMPOSE_BYTES = 512 * 1024;

/* Compose YAML is untrusted operator input (pasted or uploaded). It is parsed
   with the core schema only — no custom tags, no code execution — with alias
   expansion capped to block billion-laughs style documents. Only the fields
   discovery needs are ever read; environment, env_file, and secrets sections
   are deliberately never touched. */
function parseComposeDocument(text) {
  const raw = String(text || '');
  if (!raw.trim()) throw new Error('Compose YAML is empty');
  if (Buffer.byteLength(raw, 'utf8') > MAX_COMPOSE_BYTES) throw new Error('Compose YAML must be 512 KiB or smaller');
  let doc;
  try {
    doc = YAML.parse(raw, { schema: 'core', maxAliasCount: 100, prettyErrors: false });
  } catch (error) {
    throw new Error(`Compose YAML could not be parsed: ${String(error.message || error).slice(0, 200)}`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('Compose YAML must be a mapping at the top level');
  const services = doc.services;
  if (!services || typeof services !== 'object' || Array.isArray(services)) throw new Error('Compose YAML has no services section');
  return { services, projectName: typeof doc.name === 'string' ? doc.name : '' };
}

function normalizePorts(raw) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  for (const entry of raw.slice(0, 50)) {
    if (typeof entry === 'number') continue; // container port only, nothing published
    if (typeof entry === 'string') {
      // Formats: "8080:80", "127.0.0.1:8080:80", "8080:80/tcp", "80" (not published)
      const [spec, protocol = 'tcp'] = entry.split('/', 2);
      const parts = spec.split(':');
      if (parts.length < 2) continue;
      const target = Number(parts[parts.length - 1]);
      const published = Number(parts[parts.length - 2]);
      if (Number.isInteger(published) && published > 0 && Number.isInteger(target) && target > 0) {
        out.push({ published, target, protocol: protocol.toLowerCase() });
      }
      continue;
    }
    if (entry && typeof entry === 'object') {
      const published = Number(entry.published);
      const target = Number(entry.target);
      if (Number.isInteger(published) && published > 0 && Number.isInteger(target) && target > 0) {
        out.push({ published, target, protocol: String(entry.protocol || 'tcp').toLowerCase() });
      }
    }
  }
  return out;
}

function composeCandidates(text, { defaultHost = '' } = {}) {
  const { services, projectName } = parseComposeDocument(text);
  const candidates = [];
  let ignored = 0;
  let truncated = 0;
  for (const [serviceKey, definition] of Object.entries(services)) {
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) continue;
    if (candidates.length >= MAX_CANDIDATES) { truncated += 1; continue; }
    const hints = labelHints(normalizeLabels(definition.labels));
    if (hints.ignored) { ignored += 1; continue; }
    candidates.push(buildCandidate({
      source: 'compose',
      key: `compose:${projectName || 'default'}:${serviceKey}`,
      fallbackName: serviceKey,
      image: typeof definition.image === 'string' ? definition.image : '',
      project: projectName,
      containerName: typeof definition.container_name === 'string' ? definition.container_name : '',
      hints,
      ports: normalizePorts(definition.ports),
      defaultHost
    }));
  }
  return { candidates, ignored, truncated };
}

module.exports = { composeCandidates, parseComposeDocument, MAX_COMPOSE_BYTES };
