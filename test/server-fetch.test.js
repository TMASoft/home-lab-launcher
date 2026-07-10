const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const dns = require('node:dns').promises;
const { guardedFetch, isPrivateAddress, parsePrivateNetworkAccess } = require('../src/server/server-fetch');

test('server-fetch - isPrivateAddress detects private/reserved IPs', () => {
  // IPv4
  assert.ok(isPrivateAddress('127.0.0.1'));
  assert.ok(isPrivateAddress('10.0.0.1'));
  assert.ok(isPrivateAddress('192.168.1.50'));
  assert.ok(isPrivateAddress('172.16.31.254'));
  assert.ok(isPrivateAddress('169.254.169.254'));
  assert.ok(isPrivateAddress('0.0.0.0'));
  assert.ok(!isPrivateAddress('8.8.8.8'));
  assert.ok(!isPrivateAddress('1.1.1.1'));

  // IPv6
  assert.ok(isPrivateAddress('::1'));
  assert.ok(isPrivateAddress('::'));
  assert.ok(isPrivateAddress('fd00::1')); // Unique Local Address
  assert.ok(isPrivateAddress('fe80::1')); // Link-Local
  assert.ok(isPrivateAddress('::ffff:127.0.0.1')); // IPv4-mapped loopback
  assert.ok(isPrivateAddress('::ffff:7f00:1')); // Hexadecimal IPv4-mapped loopback
  assert.ok(isPrivateAddress('0:0:0:0:0:ffff:7f00:1')); // Expanded IPv4-mapped loopback
  assert.ok(!isPrivateAddress('2001:4860:4860::8888')); // Google Public DNS
});

test('server-fetch - parsePrivateNetworkAccess parses roles correctly', () => {
  assert.deepEqual(parsePrivateNetworkAccess('disabled'), { mode: 'disabled', roles: new Set() });
  assert.deepEqual(parsePrivateNetworkAccess('admin-only'), { mode: 'admin', roles: new Set(['admin']) });
  assert.deepEqual(parsePrivateNetworkAccess('editor'), { mode: 'admin-editor', roles: new Set(['admin', 'editor']) });
});

test('server-fetch - guardedFetch reject/allow private IP based on policy', async () => {
  // Try fetching loopback address (private)
  await assert.rejects(
    guardedFetch('http://127.0.0.1/foo', {}, { actorRole: 'user', label: 'Test' }),
    /resolves to a private, loopback, link-local, or reserved network address/
  );

  // If role is admin and process.env.SERVER_FETCH_PRIVATE_NETWORK_ACCESS allows it:
  const prevEnv = process.env.SERVER_FETCH_PRIVATE_NETWORK_ACCESS;
  process.env.SERVER_FETCH_PRIVATE_NETWORK_ACCESS = 'admin';
  try {
    // Should fail for editor
    await assert.rejects(
      guardedFetch('http://127.0.0.1/foo', {}, { actorRole: 'editor', label: 'Test' }),
      /resolves to a private/
    );
  } finally {
    process.env.SERVER_FETCH_PRIVATE_NETWORK_ACCESS = prevEnv;
  }
});

test('server-fetch - integration with mock HTTP server', async (t) => {
  // Spawn a mock HTTP server on a random port
  const server = http.createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Test-Header': 'hello' });
      res.end(JSON.stringify({ status: 'success' }));
    } else if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/ok' });
      res.end();
    } else if (req.url === '/infinite-redirect') {
      res.writeHead(302, { Location: '/infinite-redirect' });
      res.end();
    } else if (req.url === '/redirect-to-private') {
      res.writeHead(302, { Location: 'http://127.0.0.1/target' });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
  });

  // Temporarily override private network access to allow connecting to localhost for tests
  const prevEnv = process.env.SERVER_FETCH_PRIVATE_NETWORK_ACCESS;
  process.env.SERVER_FETCH_PRIVATE_NETWORK_ACCESS = 'all';

  try {
    // 1. Success fetch
    const response = await guardedFetch(`${baseUrl}/ok`, {}, { actorRole: 'admin' });
    assert.equal(response.status, 200);
    assert.equal(response.ok, true);
    assert.equal(response.headers.get('x-test-header'), 'hello');
    const json = await response.json();
    assert.deepEqual(json, { status: 'success' });

    // 2. Redirect following
    const response2 = await guardedFetch(`${baseUrl}/redirect`, {}, { actorRole: 'admin' });
    assert.equal(response2.status, 200);
    const json2 = await response2.json();
    assert.deepEqual(json2, { status: 'success' });

    // 3. Infinite redirect limit
    await assert.rejects(
      guardedFetch(`${baseUrl}/infinite-redirect`, { maxRedirects: 2 }, { actorRole: 'admin' }),
      /Too many redirects/
    );

    // 4. Redirect to private rejection (re-enable restriction first)
    process.env.SERVER_FETCH_PRIVATE_NETWORK_ACCESS = 'disabled';
    await assert.rejects(
      guardedFetch(`${baseUrl}/redirect-to-private`, {}, { actorRole: 'admin' }),
      /resolves to a private/
    );
  } finally {
    process.env.SERVER_FETCH_PRIVATE_NETWORK_ACCESS = prevEnv;
  }
});

test('server-fetch - guardedFetch resolves once per request hop', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/ok' });
      res.end();
      return;
    }
    assert.equal(req.headers.host, `single-lookup.test:${server.address().port}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(() => server.close());

  const originalLookup = dns.lookup;
  let lookupCount = 0;
  dns.lookup = async (hostname, options) => {
    if (hostname === 'single-lookup.test') {
      lookupCount += 1;
      return options?.all ? [{ address: '127.0.0.1', family: 4 }] : { address: '127.0.0.1', family: 4 };
    }
    return originalLookup.call(dns, hostname, options);
  };

  const prevEnv = process.env.SERVER_FETCH_PRIVATE_NETWORK_ACCESS;
  process.env.SERVER_FETCH_PRIVATE_NETWORK_ACCESS = 'all';

  t.after(() => {
    dns.lookup = originalLookup;
    process.env.SERVER_FETCH_PRIVATE_NETWORK_ACCESS = prevEnv;
  });

  const response = await guardedFetch(`http://single-lookup.test:${port}/ok`, {}, { actorRole: 'admin' });
  assert.equal(response.status, 200);
  assert.equal(lookupCount, 1);

  lookupCount = 0;
  const redirected = await guardedFetch(`http://single-lookup.test:${port}/redirect`, {}, { actorRole: 'admin' });
  assert.equal(redirected.status, 200);
  assert.equal(lookupCount, 2);
});

test('server-fetch - AbortSignal handles abortion', async (t) => {
  // We use a slow response to test abort
  const server = http.createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200);
      res.end('done');
    }, 200);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(() => {
    server.close();
  });

  const prevEnv = process.env.SERVER_FETCH_PRIVATE_NETWORK_ACCESS;
  process.env.SERVER_FETCH_PRIVATE_NETWORK_ACCESS = 'all';

  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    await assert.rejects(
      guardedFetch(`${baseUrl}/slow`, { signal: controller.signal }, { actorRole: 'admin' }),
      (err) => err.name === 'AbortError'
    );
  } finally {
    process.env.SERVER_FETCH_PRIVATE_NETWORK_ACCESS = prevEnv;
  }
});
