const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hll-test-'));
}

function startServer({ port = 19080, env: envOverrides = {} } = {}) {
  const dataDir = tempDir();
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    PLUGIN_DIR: path.join(dataDir, 'plugins'),
    SESSION_SECRET: 'test-session-secret-for-home-lab-launcher-tests',
    BOOTSTRAP_ADMIN_USERNAME: 'admin',
    BOOTSTRAP_ADMIN_PASSWORD: 'test-admin-password-please-change',
    APP_BASE_URL: `http://127.0.0.1:${port}`,
    PUBLIC_READ_ENABLED: 'true',
    ...envOverrides
  };
  const child = spawn(process.execPath, ['src/server/index.js'], {
    cwd: path.resolve(__dirname, '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  async function ready() {
    const started = Date.now();
    while (Date.now() - started < 10000) {
      if (child.exitCode !== null) throw new Error(`Server exited early: ${output}`);
      try {
        const response = await fetch(`${baseUrl}/api/bootstrap-status`);
        if (response.ok) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Server did not become ready: ${output}`);
  }
  async function stop() {
    if (child.exitCode === null) child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  return { child, baseUrl, dataDir, ready, stop, output: () => output };
}

class Client {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookie = '';
    this.csrfToken = '';
  }
  async request(pathname, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(this.csrfToken && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? { 'X-CSRF-Token': this.csrfToken } : {}),
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }
    }
    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    if (data.csrfToken) this.csrfToken = data.csrfToken;
    return data;
  }
}

module.exports = { startServer, Client, tempDir };
