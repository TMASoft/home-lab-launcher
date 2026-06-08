const express = require('express');
const { getSetting, setSetting } = require('../db');

function registerWeatherRoutes(router, deps) {
  const { db, requireRole, canRead, logEvent, weatherSettingsPayload } = deps;
  router.get('/weather', async (req, res) => {
    if (!canRead(req, db)) return res.status(401).json({ error: 'Authentication required' });
    try {
      const cfg = getSetting(db, 'weather', {});
      if (!Number.isFinite(Number(cfg.latitude)) || !Number.isFinite(Number(cfg.longitude))) {
        return res.status(400).json({ error: 'Weather location is not configured' });
      }
      const units = cfg.units === 'celsius' ? 'celsius' : 'fahrenheit';
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', cfg.latitude);
      url.searchParams.set('longitude', cfg.longitude);
      url.searchParams.set('current', 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m');
      url.searchParams.set('hourly', 'temperature_2m,weather_code,precipitation_probability,is_day');
      url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
      url.searchParams.set('temperature_unit', units);
      url.searchParams.set('wind_speed_unit', units === 'fahrenheit' ? 'mph' : 'kmh');
      url.searchParams.set('forecast_days', '7');
      url.searchParams.set('timezone', 'auto');
      const response = await fetch(url);
      if (!response.ok) throw new Error('weather lookup failed');
      const payload = await response.json();
      res.json({ location: cfg, weather: payload, fetchedAt: new Date().toISOString() });
    } catch (error) {
      res.status(502).json({ error: 'Weather unavailable' });
    }
  });

  router.get('/weather/search', requireRole('admin'), async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (query.length < 2) return res.json({ results: [] });
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', query);
    url.searchParams.set('count', '8');
    url.searchParams.set('language', 'en');
    url.searchParams.set('format', 'json');
    const response = await fetch(url);
    if (!response.ok) return res.status(502).json({ error: 'Geocoding unavailable' });
    const payload = await response.json();
    const results = (payload.results || []).map(r => ({
      label: [r.name, r.admin1, r.country, r.postcodes?.[0]].filter(Boolean).join(', '),
      latitude: r.latitude,
      longitude: r.longitude,
      timezone: r.timezone
    }));
    res.json({ results });
  });

  router.put('/weather/settings', requireRole('admin'), express.json(), (req, res) => {
    try {
      const cfg = weatherSettingsPayload(req.body || {});
      setSetting(db, 'weather', cfg);
      logEvent(db, req, 'weather.updated', cfg);
      res.json({ weather: cfg });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });


}

module.exports = { registerWeatherRoutes };
