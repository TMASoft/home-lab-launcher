const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const tar = require('tar');
const { XMLParser } = require('fast-xml-parser');

const LAUNCHER_PLUGIN_API_VERSION = 1;

function parseGithubRepo(input) {
  const value = String(input || '').trim();
  const match = value.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/) || value.match(/^([^/]+)\/([^/]+)$/);
  if (!match) throw new Error('Expected a GitHub repo URL or owner/repo');
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || '{}'); } catch { return fallback; }
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
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
    const { owner, repo } = parseGithubRepo(repoInput);
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

  async installFromGithub(repoUrl, version) {
    if (!version) throw new Error('A version/tag is required');
    const { owner, repo } = parseGithubRepo(repoUrl);
    const safeVersion = String(version).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const destination = path.join(this.pluginDir, `${owner}-${repo}-${safeVersion}`);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(destination, { recursive: true });
    const tarUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${encodeURIComponent(version)}`;
    const response = await fetch(tarUrl, { headers: { 'User-Agent': 'home-lab-launcher' } });
    if (!response.ok) throw new Error(`Could not download plugin tarball: ${response.status}`);
    const tarball = Buffer.from(await response.arrayBuffer());
    const installedHash = hashBuffer(tarball);
    const tmpFile = path.join(this.pluginDir, `${owner}-${repo}-${safeVersion}.tgz`);
    fs.writeFileSync(tmpFile, tarball);
    await tar.x({ file: tmpFile, cwd: destination, strip: 1 });
    fs.rmSync(tmpFile, { force: true });
    const manifestPath = path.join(destination, 'plugin.json');
    if (!fs.existsSync(manifestPath)) throw new Error('Plugin is missing plugin.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    validateManifest(manifest);
    this.db.prepare(`
      INSERT INTO plugins (id, name, source_url, source_type, version, install_path, enabled, manifest_json, config_json, installed_hash, lifecycle, last_error)
      VALUES (?, ?, ?, 'github', ?, ?, 1, ?, '{}', ?, 'installed', NULL)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, source_url=excluded.source_url, source_type='github', version=excluded.version, install_path=excluded.install_path, enabled=1, manifest_json=excluded.manifest_json, installed_hash=excluded.installed_hash, lifecycle='installed', last_error=NULL, updated_at=CURRENT_TIMESTAMP
    `).run(manifest.id, manifest.name, `https://github.com/${owner}/${repo}`, version, destination, JSON.stringify(manifest), installedHash);
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

module.exports = { PluginManager, parseGithubRepo, LAUNCHER_PLUGIN_API_VERSION, validateManifest };
