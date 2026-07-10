const dns = require('dns').promises;
const net = require('net');

const PRIVATE_ACCESS_DEFAULT = 'admin-editor';
const MAX_REDIRECTS_DEFAULT = 5;

function parsePrivateNetworkAccess(value = process.env.SERVER_FETCH_PRIVATE_NETWORK_ACCESS) {
  const raw = String(value || PRIVATE_ACCESS_DEFAULT).trim().toLowerCase();
  if (['0', 'false', 'off', 'none', 'disabled', 'deny'].includes(raw)) return { mode: 'disabled', roles: new Set() };
  if (['admin', 'admins', 'admin-only'].includes(raw)) return { mode: 'admin', roles: new Set(['admin']) };
  if (['all', 'true', 'on', 'enabled', 'admin-editor', 'editor', 'editors'].includes(raw)) return { mode: 'admin-editor', roles: new Set(['admin', 'editor']) };
  const roles = new Set(raw.split(',').map((part) => part.trim()).filter(Boolean));
  return { mode: raw, roles };
}

function privateNetworkFetchAllowed(role, value) {
  const access = parsePrivateNetworkAccess(value);
  return access.roles.has(String(role || '').toLowerCase());
}

function ipv4ToInt(address) {
  return address.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}

function isPrivateIpv4(address) {
  const value = ipv4ToInt(address);
  const inRange = (cidrBase, bits) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(cidrBase) & mask);
  };
  return [
    ['0.0.0.0', 8],       // current network / unspecified
    ['10.0.0.0', 8],      // RFC1918
    ['100.64.0.0', 10],   // carrier-grade NAT
    ['127.0.0.0', 8],     // loopback
    ['169.254.0.0', 16],  // link-local
    ['172.16.0.0', 12],   // RFC1918
    ['192.0.0.0', 24],    // IETF protocol assignments
    ['192.0.2.0', 24],    // TEST-NET
    ['192.168.0.0', 16],  // RFC1918
    ['198.18.0.0', 15],   // benchmarking
    ['198.51.100.0', 24], // TEST-NET
    ['203.0.113.0', 24],  // TEST-NET
    ['224.0.0.0', 4],     // multicast/reserved
    ['240.0.0.0', 4]      // reserved
  ].some(([base, bits]) => inRange(base, bits));
}

function isPrivateIpv6(address) {
  const lower = address.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
  if (lower.startsWith('ff')) return true; // multicast
  if (lower.startsWith('2001:db8:')) return true; // documentation
  const mapped = mappedIpv4FromIpv6(lower);
  if (mapped) return isPrivateIpv4(mapped);
  return false;
}

function mappedIpv4FromIpv6(address) {
  let normalized = address;
  if (normalized.includes('.')) {
    const separator = normalized.lastIndexOf(':');
    const dottedIpv4 = normalized.slice(separator + 1);
    if (net.isIP(dottedIpv4) !== 4) return null;
    const value = ipv4ToInt(dottedIpv4);
    normalized = `${normalized.slice(0, separator)}:${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }

  const parts = normalized.split('::');
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  if (left.length + right.length > 8) return null;
  const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  if (!groups.slice(0, 5).every((group) => Number.parseInt(group, 16) === 0) || Number.parseInt(groups[5], 16) !== 0xffff) return null;

  const value = (Number.parseInt(groups[6], 16) << 16) + Number.parseInt(groups[7], 16);
  return `${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`;
}

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return false;
}

async function resolveHostAddresses(hostname) {
  if (net.isIP(hostname)) return [{ address: hostname, family: net.isIP(hostname) }];
  return dns.lookup(hostname, { all: true, verbatim: true });
}

async function resolveAllowedServerFetch(input, { actorRole = '', label = 'URL' } = {}) {
  let parsed;
  try { parsed = new URL(String(input)); } catch { throw new Error(`${label} is invalid`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${label} must use http or https`);
  const addresses = await resolveHostAddresses(parsed.hostname);
  if (!addresses.length) throw new Error(`${label} host could not be resolved`);
  const privateHits = addresses.filter((item) => isPrivateAddress(item.address));
  if (privateHits.length && !privateNetworkFetchAllowed(actorRole)) {
    throw new Error(`${label} resolves to a private, loopback, link-local, or reserved network address; set SERVER_FETCH_PRIVATE_NETWORK_ACCESS to permit this role`);
  }
  return { parsed, addresses };
}

async function assertServerFetchAllowed(input, options = {}) {
  const { parsed } = await resolveAllowedServerFetch(input, options);
  return parsed;
}

function redirectLocation(response, currentUrl) {
  const location = response.headers.get('location');
  if (!location) return null;
  return new URL(location, currentUrl).toString();
}

const http = require('http');
const https = require('https');
const tls = require('tls');

class HeadersWrapper {
  constructor(headers) {
    this._headers = {};
    for (const [key, val] of Object.entries(headers)) {
      this._headers[key.toLowerCase()] = Array.isArray(val) ? val.join(', ') : val;
    }
  }

  get(name) {
    return this._headers[name.toLowerCase()] || null;
  }
}

class ResponseWrapper {
  constructor(status, headers, bodyBuffer) {
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.headers = new HeadersWrapper(headers);
    this._bodyBuffer = bodyBuffer;
  }

  async arrayBuffer() {
    return this._bodyBuffer.buffer.slice(
      this._bodyBuffer.byteOffset,
      this._bodyBuffer.byteOffset + this._bodyBuffer.byteLength
    );
  }

  async json() {
    return JSON.parse(this._bodyBuffer.toString('utf8'));
  }

  async text() {
    return this._bodyBuffer.toString('utf8');
  }
}

function createAbortError() {
  const err = new Error('The user aborted a request.');
  err.name = 'AbortError';
  return err;
}

function singleRequest(parsedUrl, resolvedIp, options = {}) {
  return new Promise((resolve, reject) => {
    const protocol = parsedUrl.protocol;
    const isHttps = protocol === 'https:';
    const transport = isHttps ? https : http;

    const hostname = parsedUrl.hostname;
    const port = parsedUrl.port || (isHttps ? 443 : 80);
    const path = parsedUrl.pathname + parsedUrl.search;

    const headers = { ...options.headers };
    const lowerHeaders = {};
    for (const [key, val] of Object.entries(headers)) {
      lowerHeaders[key.toLowerCase()] = val;
    }

    if (!lowerHeaders['user-agent']) {
      lowerHeaders['user-agent'] = 'home-lab-launcher';
    }
    if (!lowerHeaders['host']) {
      lowerHeaders['host'] = parsedUrl.host;
    }

    const reqOpts = {
      host: resolvedIp,
      port: port,
      path: path,
      method: options.method || 'GET',
      headers: lowerHeaders
    };

    if (parsedUrl.username || parsedUrl.password) {
      reqOpts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
    }

    if (isHttps) {
      reqOpts.servername = hostname;
      reqOpts.checkServerIdentity = (host, cert) => {
        return tls.checkServerIdentity(hostname, cert);
      };
    }

    if (options.rejectUnauthorized !== undefined) {
      reqOpts.rejectUnauthorized = options.rejectUnauthorized;
    }

    let aborted = false;
    let abortListener;

    const cleanup = () => {
      if (options.signal && abortListener) {
        options.signal.removeEventListener('abort', abortListener);
      }
    };

    if (options.signal) {
      if (options.signal.aborted) {
        reject(createAbortError());
        return;
      }
      abortListener = () => {
        aborted = true;
        req.destroy(createAbortError());
        reject(createAbortError());
      };
      options.signal.addEventListener('abort', abortListener);
    }

    const req = transport.request(reqOpts, (res) => {
      const chunks = [];
      let totalLength = 0;
      const maxLimit = 15 * 1024 * 1024; // 15MB safety limit

      res.on('data', (chunk) => {
        if (aborted) return;
        totalLength += chunk.length;
        if (totalLength > maxLimit) {
          req.destroy(new Error('Response body exceeds safety limit of 15MB'));
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        if (aborted) return;
        cleanup();
        const bodyBuffer = Buffer.concat(chunks);
        resolve(new ResponseWrapper(res.statusCode, res.headers, bodyBuffer));
      });

      res.on('error', (err) => {
        if (aborted) return;
        cleanup();
        reject(err);
      });
    });

    req.on('error', (err) => {
      if (aborted) return;
      cleanup();
      reject(err);
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function guardedFetch(input, options = {}, guard = {}) {
  let current = String(input);
  const maxRedirects = Number.isFinite(Number(options.maxRedirects)) ? Number(options.maxRedirects) : MAX_REDIRECTS_DEFAULT;
  const fetchOptions = { ...options };
  delete fetchOptions.maxRedirects;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const { parsed: parsedUrl, addresses } = await resolveAllowedServerFetch(current, guard);
    const resolvedIp = addresses[0].address;
    const response = await singleRequest(parsedUrl, resolvedIp, fetchOptions);

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const next = redirectLocation(response, current);
    if (!next) return response;
    if (redirectCount === maxRedirects) throw new Error('Too many redirects');

    current = next;
    if (response.status === 303 && fetchOptions.method && fetchOptions.method !== 'HEAD') {
      fetchOptions.method = 'GET';
    }
  }
  throw new Error('Too many redirects');
}

function serverFetchConfig() {
  const access = parsePrivateNetworkAccess();
  return { privateNetworkAccess: access.mode, privateNetworkRoles: [...access.roles] };
}

module.exports = {
  assertServerFetchAllowed,
  guardedFetch,
  isPrivateAddress,
  parsePrivateNetworkAccess,
  privateNetworkFetchAllowed,
  serverFetchConfig
};
