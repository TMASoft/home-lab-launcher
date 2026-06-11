const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const tar = require('tar');
const { XMLParser } = require('fast-xml-parser');

const LAUNCHER_PLUGIN_API_VERSION = 1;
const MAX_PLUGIN_TARBALL_BYTES = 25 * 1024 * 1024;
const MAX_PLUGIN_EXTRACTED_BYTES = 100 * 1024 * 1024;
const MAX_PLUGIN_FILES = 2000;

function parseGithubRepo(input) {
  const value = String(input || '').trim();
  const shorthand = value.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (shorthand) return { owner: shorthand[1], repo: shorthand[2].replace(/\.git$/, ''), pluginPath: '', sourceUrl: `https://github.com/${shorthand[1]}/${shorthand[2].replace(/\.git$/, '')}` };

  let url;
  try {
    url = new URL(value.replace(/^git\+/, ''));
  } catch {
    const scpLike = value.match(/^git@github\.com:([^/]+)\/(.+)$/);
    if (scpLike) url = new URL(`https://github.com/${scpLike[1]}/${scpLike[2]}`);
  }
  if (!url || url.hostname !== 'github.com') throw new Error('Expected a GitHub repo URL or owner/repo');

  const parts = url.pathname.split('/').filter(Boolean);
  const owner = parts[0];
  const repo = String(parts[1] || '').replace(/\.git$/, '');
  if (!owner || !repo) throw new Error('Expected a GitHub repo URL or owner/repo');

  let pluginPath = '';
  let treeRef = 'main';
  if (parts[2] === 'tree' && parts.length > 4) {
    treeRef = parts[3];
    pluginPath = parts.slice(4).join('/');
    validateTarEntryPath(pluginPath);
  }
  if (parts[2] && parts[2] !== 'tree' && !String(parts[1] || '').endsWith('.git')) throw new Error('GitHub plugin subdirectories must use a /tree/<branch>/<path> URL');

  return { owner, repo, pluginPath, treeRef, sourceUrl: `https://github.com/${owner}/${repo}${pluginPath ? `/tree/${treeRef}/${pluginPath}` : ''}` };
}

function safePathSlug(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'root';
}

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || '{}'); } catch { return fallback; }
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeSha256(value) {
  const hash = String(value || '').trim().toLowerCase();
  if (!hash) return '';
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Expected SHA-256 checksum must be 64 hexadecimal characters');
  return hash;
}

function verifyExpectedSha256(buffer, expectedSha256) {
  const expected = normalizeSha256(expectedSha256);
  if (!expected) return hashBuffer(buffer);
  const actual = hashBuffer(buffer);
  if (actual !== expected) throw new Error(`Plugin archive SHA-256 mismatch: expected ${expected}, got ${actual}`);
  return actual;
}

function configFieldScope(spec = {}) {
  const scope = String(spec.scope || spec.access || spec.role || 'admin').trim().toLowerCase();
  if (['editor', 'editor-safe'].includes(scope)) return 'editor';
  if (['user', 'user-preference', 'preference'].includes(scope)) return 'user';
  return 'admin';
}

function canRoleWriteConfigScope(role, scope) {
  if (role === 'admin') return true;
  if (role === 'editor') return scope === 'editor' || scope === 'user';
  if (role === 'user') return scope === 'user';
  return false;
}

function coerceConfigValue(key, spec = {}, value) {
  if (value === undefined) return undefined;
  const type = spec.type || (Array.isArray(spec.enum) ? 'enum' : 'string');
  if (Array.isArray(spec.enum)) {
    const allowed = spec.enum.map(String);
    const stringValue = String(value);
    if (!allowed.includes(stringValue)) throw new Error(`Invalid value for plugin config field ${key}`);
    return stringValue;
  }
  if (type === 'boolean') return Boolean(value);
  if (type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`Invalid number for plugin config field ${key}`);
    return number;
  }
  return String(value ?? '');
}

function applyPluginConfigUpdate(manifest, existingConfig, incomingConfig, actorRole) {
  const schema = manifest?.configSchema && typeof manifest.configSchema === 'object' ? manifest.configSchema : {};
  const incoming = incomingConfig && typeof incomingConfig === 'object' && !Array.isArray(incomingConfig) ? incomingConfig : {};
  const next = { ...(existingConfig && typeof existingConfig === 'object' && !Array.isArray(existingConfig) ? existingConfig : {}) };
  const allowed = [];
  const rejected = [];
  for (const [key, value] of Object.entries(incoming)) {
    const spec = schema[key];
    if (!spec) {
      if (actorRole === 'admin') { next[key] = value; allowed.push(key); }
      else rejected.push(key);
      continue;
    }
    const scope = configFieldScope(spec);
    if (!canRoleWriteConfigScope(actorRole, scope)) { rejected.push(key); continue; }
    next[key] = coerceConfigValue(key, spec, value);
    allowed.push(key);
  }
  return { config: next, allowed, rejected };
}


function strippedTarPath(entryPath, strip = 1) {
  const parts = String(entryPath || '').split('/').filter(Boolean).slice(strip);
  return parts.join('/');
}

function validateTarEntryPath(relativePath) {
  if (!relativePath) return true;
  if (path.isAbsolute(relativePath)) throw new Error('Plugin archive contains an absolute path');
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`) || normalized.includes(`${path.sep}..${path.sep}`)) {
    throw new Error('Plugin archive contains a parent-directory traversal path');
  }
  return true;
}

function createPluginTarSafetyFilter({ strip = 1 } = {}) {
  let fileCount = 0;
  let totalSize = 0;
  return (entryPath, entry) => {
    const relativePath = strippedTarPath(entryPath, strip);
    validateTarEntryPath(relativePath);
    if (!relativePath) return true;
    fileCount += 1;
    if (fileCount > MAX_PLUGIN_FILES) throw new Error(`Plugin archive contains more than ${MAX_PLUGIN_FILES} entries`);
    const type = entry?.type || 'File';
    if (['SymbolicLink', 'Link'].includes(type)) throw new Error('Plugin archive may not contain symbolic or hard links');
    if (!['File', 'Directory'].includes(type)) throw new Error(`Plugin archive contains unsupported entry type: ${type}`);
    totalSize += Number(entry?.size || 0);
    if (totalSize > MAX_PLUGIN_EXTRACTED_BYTES) throw new Error(`Plugin archive expands beyond ${Math.round(MAX_PLUGIN_EXTRACTED_BYTES / 1024 / 1024)} MiB`);
    return true;
  };
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('Plugin manifest must be an object');
  if (!manifest.id || !manifest.name) throw new Error('Plugin manifest requires id and name');
  if (!/^[a-zA-Z0-9_.-]+$/.test(manifest.id)) throw new Error('Plugin id may only contain letters, numbers, underscore, dot, and hyphen');
  const apiVersion = Number(manifest.launcherApiVersion || 1);
  if (!Number.isFinite(apiVersion)) throw new Error('Plugin launcherApiVersion must be numeric');
  if (apiVersion > LAUNCHER_PLUGIN_API_VERSION) throw new Error(`Plugin requires launcher API ${apiVersion}; this launcher supports ${LAUNCHER_PLUGIN_API_VERSION}`);
  return { apiVersion, compatible: true };
}

function compareVersions(a, b) {
  const clean = (v) => String(v || '').replace(/^v/i, '').split(/[.-]/).map((part) => Number(part) || part);
  const aa = clean(a); const bb = clean(b);
  for (let i = 0; i < Math.max(aa.length, bb.length); i += 1) {
    const x = aa[i] ?? 0; const y = bb[i] ?? 0;
    if (typeof x === 'number' && typeof y === 'number' && x !== y) return x > y ? 1 : -1;
    const xs = String(x); const ys = String(y);
    if (xs !== ys) return xs > ys ? 1 : -1;
  }
  return 0;
}

async function fetchBufferWithLimit(url, { maxBytes = 20 * 1024 * 1024, timeoutMs = 15000, headers = {} } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) throw new Error(`Download is larger than ${Math.round(maxBytes / 1024 / 1024)} MiB`);
    const chunks = [];
    let total = 0;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          controller.abort();
          throw new Error(`Download is larger than ${Math.round(maxBytes / 1024 / 1024)} MiB`);
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks, total);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`Download is larger than ${Math.round(maxBytes / 1024 / 1024)} MiB`);
    return buffer;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Download timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

class PluginManager {
  constructor({ app, db, pluginDir }) {
    this.app = app;
    this.db = db;
    this.pluginDir = pluginDir;
    this.sectionsByPlugin = new Map();
    this.routers = [];
    this.loadErrors = new Map();
    this.jobs = new Map();
    fs.mkdirSync(pluginDir, { recursive: true });
  }

  mount(pluginId, mountPath, middleware) {
    this.app.use(mountPath, middleware);
    const stack = this.app._router?.stack;
    if (stack?.length) stack[stack.length - 1].hllPluginId = pluginId;
  }

  unmountPluginRoutes() {
    const stack = this.app._router?.stack;
    if (!stack) return;
    this.app._router.stack = stack.filter((layer) => !layer.hllPluginId);
  }

  list() {
    return this.db.prepare('SELECT id, name, source_url AS sourceUrl, source_type AS sourceType, version, install_path AS installPath, enabled, manifest_json AS manifestJson, config_json AS configJson, installed_hash AS installedHash, lifecycle, last_error AS lastError, installed_at AS installedAt, updated_at AS updatedAt FROM plugins ORDER BY name').all().map(row => {
      const manifest = safeJson(row.manifestJson, {});
      let compatibility;
      try { compatibility = validateManifest(manifest); } catch (error) { compatibility = { compatible: false, error: error.message }; }
      const failed = this.loadErrors.get(row.id);
      const lifecycle = failed ? 'failed' : (row.enabled ? (row.lifecycle || 'enabled') : 'disabled');
      return {
        ...row,
        enabled: Boolean(row.enabled),
        lifecycle,
        lastError: failed?.message || row.lastError || null,
        manifest,
        config: safeJson(row.configJson, {}),
        compatibility,
        manifestJson: undefined,
        configJson: undefined
      };
    });
  }

  sections() {
    return [...this.sectionsByPlugin.values()].flat();
  }

  async reload() {
    this.sectionsByPlugin.clear();
    this.unmountPluginRoutes();
    this.loadErrors.clear();
    for (const timer of this.jobs.values()) clearInterval(timer.handle);
    this.jobs.clear();
    const rows = this.db.prepare('SELECT * FROM plugins WHERE enabled = 1 ORDER BY name').all();
    for (const row of rows) {
      try {
        await this.load(row);
        this.db.prepare("UPDATE plugins SET lifecycle = 'enabled', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
      } catch (error) {
        const manifest = safeJson(row.manifest_json, {});
        const pluginId = manifest.id || row.id;
        this.loadErrors.set(pluginId, { pluginId, message: error.message, checkedAt: new Date().toISOString() });
        this.db.prepare("UPDATE plugins SET lifecycle = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(error.message, row.id);
        console.error(`Plugin ${pluginId} failed to load:`, error);
      }
    }
  }

  health() {
    const installed = this.list();
    return {
      installed: installed.length,
      enabled: installed.filter((plugin) => plugin.enabled).length,
      sections: this.sections().length,
      failures: [...this.loadErrors.values()],
      plugins: installed.map((plugin) => ({ id: plugin.id, name: plugin.name, lifecycle: plugin.lifecycle, compatible: plugin.compatibility.compatible, lastError: plugin.lastError })),
      jobs: [...this.jobs.values()].map(({ handle, ...job }) => job)
    };
  }

  async load(row) {
    const manifest = safeJson(row.manifest_json, {});
    validateManifest(manifest);
    const pluginId = manifest.id || row.id;
    const publicScriptUrl = manifest.frontend ? `/plugins/${pluginId}/${manifest.frontend.replace(/^public\//, '')}` : null;
    if (manifest.frontend) {
      this.mount(pluginId, `/plugins/${pluginId}`, express.static(path.join(row.install_path, 'public')));
    }
    if (!manifest.backend) return;
    const backendPath = path.join(row.install_path, manifest.backend);
    delete require.cache[require.resolve(backendPath)];
    const mod = require(backendPath);
    const router = express.Router();
    const context = {
      id: pluginId,
      manifest,
      launcherApiVersion: LAUNCHER_PLUGIN_API_VERSION,
      db: this.db,
      fetch,
      XMLParser,
      publicScriptUrl,
      createRouter: () => router,
      json: express.json,
      mountRouter: (r = router) => this.mount(pluginId, `/api/plugins/${pluginId}`, r),
      registerDashboardSection: (section) => {
        const current = this.sectionsByPlugin.get(pluginId) || [];
        current.push({ pluginId, ...section, script: section.script || publicScriptUrl });
        this.sectionsByPlugin.set(pluginId, current);
      },
      log: (level, action, details = {}) => {
        try {
          this.db.prepare(`INSERT INTO app_logs (level, action, actor_username, details_json) VALUES (?, ?, ?, ?)`).run(level, `plugin.${pluginId}.${action}`, `plugin:${pluginId}`, JSON.stringify(details));
        } catch {}
      },
      getConfig: () => safeJson(this.db.prepare('SELECT config_json FROM plugins WHERE id = ?').get(row.id)?.config_json, {}),
      setInterval: (fn, ms, name = 'scheduled job') => {
        const jobId = `${pluginId}:${name}:${this.jobs.size + 1}`;
        const wrapped = async () => {
          const job = this.jobs.get(jobId);
          if (job) job.lastRunAt = new Date().toISOString();
          try {
            await fn();
            const current = this.jobs.get(jobId);
            if (current) { current.lastStatus = 'ok'; current.lastError = null; }
          } catch (error) {
            const current = this.jobs.get(jobId);
            if (current) { current.lastStatus = 'error'; current.lastError = error.message; }
            context.log('error', 'job_failed', { name, error: error.message });
          }
        };
        const handle = setInterval(wrapped, ms);
        this.jobs.set(jobId, { id: jobId, pluginId, name, intervalMs: ms, lastRunAt: null, lastStatus: 'pending', lastError: null, handle });
        return handle;
      }
    };
    await mod.register(context);
  }

  async discoverGithubVersions(repoInput) {
    const { owner, repo, pluginPath, treeRef } = parseGithubRepo(repoInput);
    const headers = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'home-lab-launcher' };
    const releasesRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, { headers });
    let versions = [];
    if (releasesRes.ok) {
      const releases = await releasesRes.json();
      versions = releases.map(r => ({ name: r.name || r.tag_name, version: r.tag_name, type: 'release', publishedAt: r.published_at, tarballUrl: r.tarball_url, body: r.body || '', htmlUrl: r.html_url || '' }));
    }
    const tagsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/tags?per_page=50`, { headers });
    if (tagsRes.ok) {
      const tags = await tagsRes.json();
      for (const tag of tags) {
        if (!versions.some(v => v.version === tag.name)) versions.push({ name: tag.name, version: tag.name, type: 'tag', tarballUrl: tag.tarball_url, body: '', htmlUrl: '' });
      }
    }
    if (!versions.length && pluginPath && treeRef) {
      const branchRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(treeRef)}`, { headers });
      if (branchRes.ok) versions.push({ name: treeRef, version: treeRef, type: 'branch', body: 'No releases or tags were found. Installing from this branch is useful for development, but releases or tags are recommended for production installs.', htmlUrl: `https://github.com/${owner}/${repo}/tree/${treeRef}/${pluginPath}` });
    }
    return versions;
  }

  async checkUpdates() {
    const plugins = this.list().filter((plugin) => plugin.sourceType === 'github');
    const updates = [];
    for (const plugin of plugins) {
      try {
        const versions = await this.discoverGithubVersions(plugin.sourceUrl);
        const latest = versions[0] || null;
        updates.push({ id: plugin.id, currentVersion: plugin.version, latest, updateAvailable: latest ? compareVersions(latest.version, plugin.version) > 0 && latest.version !== plugin.version : false });
      } catch (error) {
        updates.push({ id: plugin.id, currentVersion: plugin.version, latest: null, updateAvailable: false, error: error.message });
      }
    }
    return updates;
  }

  async installFromGithub(repoUrl, version, { expectedSha256 = '' } = {}) {
    if (!version) throw new Error('A version/tag is required');
    const normalizedExpectedSha256 = normalizeSha256(expectedSha256);
    const { owner, repo, pluginPath, sourceUrl } = parseGithubRepo(repoUrl);
    const safeVersion = String(version).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const pluginPathSlug = pluginPath ? `-${safePathSlug(pluginPath)}` : '';
    const destination = path.join(this.pluginDir, `${owner}-${repo}${pluginPathSlug}-${safeVersion}`);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(destination, { recursive: true });
    const tarUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${encodeURIComponent(version)}`;
    const tarball = await fetchBufferWithLimit(tarUrl, { maxBytes: MAX_PLUGIN_TARBALL_BYTES, timeoutMs: 20000, headers: { 'User-Agent': 'home-lab-launcher' } });
    const installedHash = verifyExpectedSha256(tarball, normalizedExpectedSha256);
    const tmpFile = path.join(this.pluginDir, `${owner}-${repo}-${safeVersion}.tgz`);
    fs.writeFileSync(tmpFile, tarball);
    await tar.x({ file: tmpFile, cwd: destination, strip: 1, filter: createPluginTarSafetyFilter({ strip: 1 }) });
    fs.rmSync(tmpFile, { force: true });
    const installRoot = pluginPath ? path.join(destination, pluginPath) : destination;
    const manifestPath = path.join(installRoot, 'plugin.json');
    if (!fs.existsSync(manifestPath)) throw new Error('Plugin is missing plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    validateManifest(manifest);
    this.db.prepare(`
      INSERT INTO plugins (id, name, source_url, source_type, version, install_path, enabled, manifest_json, config_json, installed_hash, lifecycle, last_error)
      VALUES (?, ?, ?, 'github', ?, ?, 1, ?, '{}', ?, 'installed', NULL)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, source_url=excluded.source_url, source_type='github', version=excluded.version, install_path=excluded.install_path, enabled=1, manifest_json=excluded.manifest_json, installed_hash=excluded.installed_hash, lifecycle='installed', last_error=NULL, updated_at=CURRENT_TIMESTAMP
    `).run(manifest.id, manifest.name, sourceUrl, version, installRoot, JSON.stringify(manifest), installedHash);
    return { id: manifest.id, name: manifest.name, version, enabled: true, installedHash };
  }

  resolveLocalPluginPath(localPath) {
    const requested = String(localPath || '').trim();
    if (!requested) throw new Error('Local plugin path is required');
    let resolved = path.resolve(requested);
    if (!fs.existsSync(resolved)) {
      const hostDir = process.env.LOCAL_PLUGIN_HOST_DIR ? path.resolve(process.env.LOCAL_PLUGIN_HOST_DIR) : '';
      const containerDir = process.env.LOCAL_PLUGIN_CONTAINER_DIR || '/app/local-plugins';
      if (hostDir && resolved.startsWith(hostDir)) {
        const relative = path.relative(hostDir, resolved);
        const mapped = path.resolve(containerDir, relative);
        if (fs.existsSync(mapped)) return mapped;
      }
      if (!path.isAbsolute(requested)) {
        const mapped = path.resolve(containerDir, requested);
        if (fs.existsSync(mapped)) return mapped;
      }
    }
    return resolved;
  }

  async installFromLocal(localPath) {
    if (process.env.NODE_ENV === 'production' && process.env.ENABLE_LOCAL_PLUGIN_INSTALL !== 'true') throw new Error('Local plugin install is disabled. Set ENABLE_LOCAL_PLUGIN_INSTALL=true and mount LOCAL_PLUGIN_HOST_DIR into the launcher container.');
    const resolved = this.resolveLocalPluginPath(localPath);
    const manifestPath = path.join(resolved, 'plugin.json');
    if (!fs.existsSync(manifestPath)) throw new Error(`Local plugin is missing plugin.json at ${manifestPath}. If running in Docker, mount the host plugin directory and use the container path, usually /app/local-plugins/<plugin>.`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    validateManifest(manifest);
    const installedHash = hashBuffer(Buffer.from(JSON.stringify(manifest)));
    this.db.prepare(`
      INSERT INTO plugins (id, name, source_url, source_type, version, install_path, enabled, manifest_json, config_json, installed_hash, lifecycle, last_error)
      VALUES (?, ?, ?, 'local', ?, ?, 1, ?, '{}', ?, 'installed', NULL)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, source_url=excluded.source_url, source_type='local', version=excluded.version, install_path=excluded.install_path, enabled=1, manifest_json=excluded.manifest_json, installed_hash=excluded.installed_hash, lifecycle='installed', last_error=NULL, updated_at=CURRENT_TIMESTAMP
    `).run(manifest.id, manifest.name, resolved, manifest.version || 'local', resolved, JSON.stringify(manifest), installedHash);
    return { id: manifest.id, name: manifest.name, version: manifest.version || 'local', enabled: true, installedHash };
  }
}

module.exports = { PluginManager, parseGithubRepo, LAUNCHER_PLUGIN_API_VERSION, validateManifest, applyPluginConfigUpdate, configFieldScope };
