const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { openDb, setSetting } = require('../src/server/db');
const { registerWeatherRoutes } = require('../src/server/route-modules/weather');

test('weather caching, timeout, and stale fallback', async (t) => {
  const db = openDb(':memory:');
  t.after(() => db.close());

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  setSetting(db, 'weather', {
    latitude: 40.7128,
    longitude: -74.0060,
    label: 'Cache Test City',
    units: 'fahrenheit'
  });

  const app = express();
  const deps = {
    db,
    requireRole: () => (req, res, next) => next(),
    canRead: () => true,
    logEvent: () => {},
    weatherSettingsPayload: (input) => input
  };

  const router = express.Router();
  registerWeatherRoutes(router, deps);
  app.use(router);

  const server = app.listen(0);
  const port = server.address().port;
  t.after(() => server.close());

  const originalFetch = global.fetch;
  let fetchCount = 0;
  let shouldTimeout = false;
  let shouldFail = false;

  global.fetch = async (url, options) => {
    const urlStr = String(url);
    if (urlStr.startsWith('https://api.open-meteo.com/')) {
      fetchCount++;
      if (shouldTimeout) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const err = new Error('The operation was aborted.');
        err.name = 'TimeoutError';
        throw err;
      }
      if (shouldFail) {
        return { ok: false };
      }
      return {
        ok: true,
        json: async () => ({
          current: { temperature_2m: 72, weather_code: 0, is_day: 1 },
          hourly: {},
          daily: {}
        })
      };
    }
    return originalFetch(url, options);
  };

  t.after(() => {
    global.fetch = originalFetch;
  });

  // First request: goes to network
  const response1 = await fetch(`http://127.0.0.1:${port}/weather`);
  const res1 = await response1.json();
  assert.equal(res1.source, 'network');
  assert.equal(fetchCount, 1);
  assert.equal(res1.weather.current.temperature_2m, 72);
  assert.equal(res1.location.label, 'Cache Test City');
  assert.equal(res1.location.latitude, undefined);

  // Second request: hits cache
  const response2 = await fetch(`http://127.0.0.1:${port}/weather`);
  const res2 = await response2.json();
  assert.equal(res2.source, 'cache');
  assert.equal(fetchCount, 1);

  // Simulate upstream failure with cache still present
  shouldFail = true;
  const originalDateNow = Date.now;
  t.after(() => { Date.now = originalDateNow; });

  // Advance time by 6 minutes to expire the cache
  Date.now = () => originalDateNow() + 6 * 60 * 1000;

  // Third request: cache has expired, fetch fails, returns stale cache
  const response3 = await fetch(`http://127.0.0.1:${port}/weather`);
  const res3 = await response3.json();
  assert.equal(res3.source, 'stale_cache');
  assert.equal(fetchCount, 2);
  assert.equal(res3.weather.current.temperature_2m, 72);

  // Change location to clear matching cache key
  setSetting(db, 'weather', {
    latitude: 34.0522,
    longitude: -118.2437,
    label: 'No Cache City',
    units: 'fahrenheit'
  });

  // Fetch fails when no cache is available
  const response4 = await fetch(`http://127.0.0.1:${port}/weather`);
  assert.equal(response4.status, 502);
});
