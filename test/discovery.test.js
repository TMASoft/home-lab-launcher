const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Database = require('better-sqlite3');
const { startServer, Client } = require('./helpers');
const { composeCandidates, parseComposeDocument } = require('../src/server/discovery/compose');
const { dockerCandidates, parseDockerEndpoint } = require('../src/server/discovery/docker');
const { annotateConflicts, normalizeLabels, labelHints, safeCandidateUrl } = require('../src/server/discovery/candidates');

const COMPOSE_FIXTURE = `
services:
  jellyfin:
    image: jellyfin/jellyfin:10.9
    ports:
      - "8096:8096"
    environment:
      - JELLYFIN_API_SECRET=super-secret-value
      - PASSWORD=hunter2-do-not-leak
    labels:
      homepage.name: Jellyfin
      homepage.group: Media
      homepage.description: Media server
      homepage.icon: jellyfin.png
  proxied:
    image: nginx:alpine
    labels:
      - traefik.http.routers.proxied.rule=Host(\`app.example.com\`)
      - home-lab-launcher.tags=web,infra
      - home-lab-launcher.token=should-never-be-read
  opted-out:
    image: internal/tool
    labels:
      home-lab-launcher.ignore: "true"
  with-credentials:
    image: authelia/authelia
    labels:
      home-lab-launcher.url: https://user:secretpass@auth.example.com/
`;

test('compose candidates redact secrets and honor labels', () => {
  const { candidates, ignored } = composeCandidates(COMPOSE_FIXTURE, { defaultHost: 'server.lan' });
  const serialized = JSON.stringify(candidates);

  assert.equal(ignored, 1);
  assert.equal(candidates.length, 3);
  assert.ok(!serialized.includes('super-secret-value'), 'environment values must never appear in candidates');
  assert.ok(!serialized.includes('hunter2'), 'environment values must never appear in candidates');
  assert.ok(!serialized.includes('should-never-be-read'), 'secret-like launcher labels must be dropped');
  assert.ok(!serialized.includes('secretpass'), 'URL credentials must be stripped');

  const jellyfin = candidates.find((c) => c.key.endsWith(':jellyfin'));
  assert.equal(jellyfin.name, 'Jellyfin');
  assert.equal(jellyfin.url, 'http://server.lan:8096/');
  assert.equal(jellyfin.category, 'media');
  assert.equal(jellyfin.description, 'Media server');
  assert.equal(jellyfin.icon, '🔗', 'dashboard-icons file names are not usable icons');
  assert.equal(jellyfin.details.urlSource, 'port');

  const proxied = candidates.find((c) => c.key.endsWith(':proxied'));
  assert.equal(proxied.url, 'https://app.example.com/');
  assert.equal(proxied.details.urlSource, 'traefik');
  assert.deepEqual(proxied.tags, ['web', 'infra']);

  const credentialed = candidates.find((c) => c.key.endsWith(':with-credentials'));
  assert.equal(credentialed.url, 'https://auth.example.com/');
});

test('compose parser rejects malformed and malicious YAML', () => {
  assert.throws(() => parseComposeDocument(''), /empty/);
  assert.throws(() => parseComposeDocument('- just\n- a\n- list'), /mapping/);
  assert.throws(() => parseComposeDocument('version: "3"'), /no services/);
  assert.throws(() => parseComposeDocument(`x: ${'x'.repeat(600 * 1024)}`), /512 KiB/);

  // Billion-laughs style alias bomb must fail fast instead of expanding.
  const bomb = [
    'a: &a ["x","x","x","x","x","x","x","x","x","x"]',
    'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]',
    'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]',
    'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]',
    'e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d,*d]',
    'services: {}'
  ].join('\n');
  assert.throws(() => parseComposeDocument(bomb), /could not be parsed/);

  // Unknown/custom tags must not resolve to anything executable.
  const tagged = 'services:\n  evil:\n    image: !!js/function "function(){return 1}"\n';
  const result = composeCandidates(tagged, { defaultHost: 'server.lan' });
  const evil = result.candidates.find((c) => c.key.endsWith(':evil'));
  assert.ok(!evil || typeof evil.details.image === 'string');
});

test('docker candidates map containers and endpoint parsing is strict', () => {
  const containers = [
    {
      Id: 'abcdef123456',
      Names: ['/jellyfin'],
      Image: 'jellyfin/jellyfin:10.9',
      State: 'running',
      Labels: {
        'com.docker.compose.project': 'media',
        'com.docker.compose.service': 'jellyfin',
        'homepage.name': 'Jellyfin',
        'home-lab-launcher.api-key': 'never-surface-this'
      },
      Ports: [{ PrivatePort: 8096, PublicPort: 8096, Type: 'tcp' }]
    },
    { Id: 'ffff00001111', Names: ['/hidden'], Image: 'x', Labels: { 'home-lab-launcher.ignore': 'yes' }, Ports: [] }
  ];
  const result = dockerCandidates(containers, { defaultHost: 'dockerhost.lan' });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.ignored, 1);
  const [candidate] = result.candidates;
  assert.equal(candidate.key, 'docker:media:jellyfin');
  assert.equal(candidate.url, 'http://dockerhost.lan:8096/');
  assert.equal(candidate.details.project, 'media');
  assert.ok(!JSON.stringify(result).includes('never-surface-this'));

  assert.deepEqual(parseDockerEndpoint('http://proxy:2375'), { kind: 'http', base: 'http://proxy:2375' });
  assert.deepEqual(parseDockerEndpoint('unix:///var/run/docker.sock'), { kind: 'socket', socketPath: '/var/run/docker.sock' });
  assert.deepEqual(parseDockerEndpoint('/var/run/docker.sock'), { kind: 'socket', socketPath: '/var/run/docker.sock' });
  assert.equal(parseDockerEndpoint('ftp://nope'), null);
  assert.equal(parseDockerEndpoint('relative/path'), null);
  assert.equal(parseDockerEndpoint(''), null);
});

test('label hints only read allowlisted namespaces', () => {
  const hints = labelHints(normalizeLabels({
    'home-lab-launcher.name': 'Named',
    'home-lab-launcher.password': 'nope',
    'homepage.href': 'https://a.example.com',
    'homepage.widget.token': 'nope-2',
    'random.label': 'ignored entirely',
    'traefik.http.routers.web.rule': 'Host(`b.example.com`) && PathPrefix(`/x`)'
  }));
  assert.equal(hints.launcher.name, 'Named');
  assert.equal(hints.launcher.password, undefined);
  assert.equal(hints.homepage.href, 'https://a.example.com');
  assert.deepEqual(hints.traefikHosts, ['b.example.com']);
  assert.ok(!JSON.stringify(hints).includes('nope'));
  assert.equal(safeCandidateUrl('javascript:alert(1)'), '');
});

test('conflict annotation matches by URL and suggested id', () => {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE services (id TEXT PRIMARY KEY, name TEXT, url TEXT)");
  db.prepare('INSERT INTO services (id, name, url) VALUES (?, ?, ?)').run('jellyfin', 'Jellyfin', 'http://server.lan:8096');
  db.prepare('INSERT INTO services (id, name, url) VALUES (?, ?, ?)').run('grafana', 'Grafana', 'https://grafana.example.com/');
  const candidates = [
    { key: 'a', name: 'Jellyfin Fresh', suggestedId: 'jellyfin-fresh', url: 'http://server.lan:8096/', conflict: null },
    { key: 'b', name: 'Grafana', suggestedId: 'grafana', url: 'https://other.example.com', conflict: null },
    { key: 'c', name: 'Brand New', suggestedId: 'brand-new', url: 'https://new.example.com', conflict: null }
  ];
  annotateConflicts(db, candidates);
  assert.equal(candidates[0].conflict.serviceId, 'jellyfin');
  assert.equal(candidates[0].conflict.matchedBy, 'url');
  assert.equal(candidates[1].conflict.serviceId, 'grafana');
  assert.equal(candidates[1].conflict.matchedBy, 'id');
  assert.equal(candidates[2].conflict, null);
  db.close();
});

test('discovery API enforces admin access and supports preview/apply', async (t) => {
  const server = startServer({ port: 19160 });
  await server.ready();
  t.after(() => server.stop());

  const admin = new Client(server.baseUrl);
  await admin.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-password-please-change' } });

  await admin.request('/api/users', { method: 'POST', body: { username: 'editor-user', password: 'editor-password-123', role: 'editor' } });
  await admin.request('/api/users', { method: 'POST', body: { username: 'basic-user', password: 'basic-password-1234', role: 'user' } });
  const editor = new Client(server.baseUrl);
  await editor.request('/api/auth/login', { method: 'POST', body: { username: 'editor-user', password: 'editor-password-123' } });
  const basic = new Client(server.baseUrl);
  await basic.request('/api/auth/login', { method: 'POST', body: { username: 'basic-user', password: 'basic-password-1234' } });
  const anon = new Client(server.baseUrl);

  // Role gates: discovery is admin-only in this release.
  for (const [client, expected] of [[editor, 403], [basic, 403]]) {
    for (const [method, path, body] of [
      ['GET', '/api/discovery/status', undefined],
      ['POST', '/api/discovery/docker/scan', {}],
      ['POST', '/api/discovery/compose/preview', { yaml: 'services: {}' }],
      ['POST', '/api/discovery/apply', { items: [{ action: 'create', service: { name: 'X', url: 'https://x.example.com' } }] }]
    ]) {
      await assert.rejects(() => client.request(path, { method, body }), (error) => error.status === expected, `${method} ${path} should be ${expected}`);
    }
  }
  await assert.rejects(() => anon.request('/api/discovery/status'), (error) => error.status === 401);

  const status = await admin.request('/api/discovery/status');
  assert.equal(status.dockerConfigured, false);
  assert.equal(status.dockerEndpointKind, null);

  // Docker scan without a configured endpoint fails cleanly.
  await assert.rejects(() => admin.request('/api/discovery/docker/scan', { method: 'POST', body: {} }), /not configured/);

  // Endpoint setting is validated and normalized.
  await assert.rejects(() => admin.request('/api/settings', { method: 'PATCH', body: { discovery_docker_endpoint: 'ftp://bad' } }), /http|absolute/);
  await admin.request('/api/settings', { method: 'PATCH', body: { discovery_docker_endpoint: '/var/run/docker.sock' } });
  const configured = await admin.request('/api/discovery/status');
  assert.equal(configured.dockerConfigured, true);
  assert.equal(configured.dockerEndpointKind, 'socket');
  assert.equal(configured.dockerEndpoint, 'unix:///var/run/docker.sock');

  // Compose preview: candidates come back, secrets do not.
  const preview = await admin.request('/api/discovery/compose/preview', { method: 'POST', body: { yaml: COMPOSE_FIXTURE, defaultHost: 'server.lan' } });
  assert.equal(preview.source, 'compose');
  assert.equal(preview.candidates.length, 3);
  assert.ok(!JSON.stringify(preview).includes('super-secret-value'));
  assert.ok(!JSON.stringify(preview).includes('hunter2'));

  // Preview alone must not change existing services (the server seeds demo services on first boot).
  const before = await admin.request('/api/services');
  const baselineCount = before.services.length;
  const afterPreview = await admin.request('/api/services');
  assert.equal(afterPreview.services.length, baselineCount);

  // Malicious and malformed YAML are rejected without side effects.
  await assert.rejects(() => admin.request('/api/discovery/compose/preview', { method: 'POST', body: { yaml: '- a\n- b' } }), /mapping/);
  const bomb = [
    'a: &a ["x","x","x","x","x","x","x","x","x","x"]',
    'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]',
    'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]',
    'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]',
    'services: {}'
  ].join('\n');
  await assert.rejects(() => admin.request('/api/discovery/compose/preview', { method: 'POST', body: { yaml: bomb } }), /could not be parsed/);

  // Oversized payloads are rejected by the body limit before parsing.
  await assert.rejects(
    () => admin.request('/api/discovery/compose/preview', { method: 'POST', body: { yaml: 'x'.repeat(700 * 1024) } }),
    (error) => error.status === 413
  );

  // Apply creates services through the normal validation path.
  const jellyfin = preview.candidates.find((c) => c.key.endsWith(':jellyfin'));
  const applied = await admin.request('/api/discovery/apply', {
    method: 'POST',
    body: { items: [{ key: jellyfin.key, source: 'compose', action: 'create', service: { name: jellyfin.name, url: jellyfin.url, category: jellyfin.category, icon: jellyfin.icon, description: jellyfin.description, tags: jellyfin.tags, environment: ['SHOULD_BE=dropped'] } }] }
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.summary.created, 1);
  const afterCreate = await admin.request('/api/services');
  const created = afterCreate.services.find((s) => s.name === 'Jellyfin');
  assert.ok(created);
  assert.equal(created.url, 'http://server.lan:8096/');
  assert.equal(created.environment, undefined, 'non-service fields must be dropped by validation');

  // Re-preview: the imported service is now reported as a conflict.
  const rePreview = await admin.request('/api/discovery/compose/preview', { method: 'POST', body: { yaml: COMPOSE_FIXTURE, defaultHost: 'server.lan' } });
  const conflicted = rePreview.candidates.find((c) => c.key.endsWith(':jellyfin'));
  assert.ok(conflicted.conflict);
  assert.equal(conflicted.conflict.serviceId, created.id);

  // Update action modifies the existing service instead of duplicating it.
  const updated = await admin.request('/api/discovery/apply', {
    method: 'POST',
    body: { items: [{ key: conflicted.key, source: 'compose', action: 'update', targetId: created.id, service: { name: 'Jellyfin Media', url: conflicted.url, category: 'media' } }] }
  });
  assert.equal(updated.summary.updated, 1);
  const afterUpdate = await admin.request('/api/services');
  assert.equal(afterUpdate.services.length, baselineCount + 1, 'update must not create another service');
  assert.equal(afterUpdate.services.find((s) => s.id === created.id).name, 'Jellyfin Media');

  // Invalid items fail per-item without aborting the batch.
  const mixed = await admin.request('/api/discovery/apply', {
    method: 'POST',
    body: { items: [
      { key: 'ok', source: 'compose', action: 'create', service: { name: 'Valid Extra', url: 'https://extra.example.com' } },
      { key: 'bad', source: 'compose', action: 'create', service: { name: 'No URL Service' } },
      { key: 'missing', source: 'compose', action: 'update', targetId: 'does-not-exist', service: { name: 'X', url: 'https://x.example.com' } }
    ] }
  });
  assert.equal(mixed.ok, false);
  assert.equal(mixed.summary.created, 1);
  assert.equal(mixed.summary.failed, 2);

  // Apply size limit.
  const tooMany = Array.from({ length: 51 }, (_, i) => ({ key: `k${i}`, action: 'create', source: 'compose', service: { name: `S${i}`, url: `https://s${i}.example.com` } }));
  await assert.rejects(() => admin.request('/api/discovery/apply', { method: 'POST', body: { items: tooMany } }), /at most 50/);

  // Docker scan over HTTP against a mock socket-proxy endpoint.
  const mockDocker = http.createServer((req, res) => {
    if (req.url.startsWith('/containers/json')) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([
        {
          Id: 'cafe00112233',
          Names: ['/grafana'],
          Image: 'grafana/grafana:11',
          State: 'running',
          Labels: { 'com.docker.compose.project': 'observability', 'com.docker.compose.service': 'grafana', 'homepage.group': 'Monitoring' },
          Ports: [{ PrivatePort: 3000, PublicPort: 3001, Type: 'tcp' }]
        }
      ]));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((resolve) => mockDocker.listen(19161, '127.0.0.1', resolve));
  t.after(() => mockDocker.close());
  await admin.request('/api/settings', { method: 'PATCH', body: { discovery_docker_endpoint: 'http://127.0.0.1:19161' } });
  const scan = await admin.request('/api/discovery/docker/scan', { method: 'POST', body: { defaultHost: 'dockerhost.lan' } });
  assert.equal(scan.source, 'docker');
  assert.equal(scan.counts.containers, 1);
  const grafana = scan.candidates.find((c) => c.key === 'docker:observability:grafana');
  assert.ok(grafana);
  assert.equal(grafana.url, 'http://dockerhost.lan:3001/');
  assert.equal(grafana.category, 'monitoring');
  assert.equal(grafana.conflict, null);

  // Discovery runs and imports are audited.
  const logs = await admin.request('/api/admin/logs?action=discovery&limit=50');
  const actions = logs.logs.map((l) => l.action);
  assert.ok(actions.includes('discovery.scanned'));
  assert.ok(actions.includes('discovery.applied'));
  const scanLogs = logs.logs.filter((l) => l.action === 'discovery.scanned');
  assert.ok(!JSON.stringify(scanLogs).includes('super-secret-value'));
});
