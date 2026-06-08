#!/usr/bin/env node
const path = require('path');
const { openDb, setSetting, DEFAULT_APPEARANCE } = require('../src/server/db');

const repoRoot = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(repoRoot, 'data'));
const db = openDb(dataDir);

const demoServices = [
  {
    id: 'demo-home-automation',
    name: 'Home Automation',
    icon: '🏠',
    url: 'https://automation.launcher.example.test',
    category: 'Operations',
    accent: '#4de7ff',
    description: 'Example smart-home dashboard for screenshots and demos.',
    tags: ['automation', 'demo'],
    sort_order: 10,
    featured: 1,
    enabled: 1
  },
  {
    id: 'demo-status',
    name: 'Status Monitor',
    icon: '📈',
    url: 'https://status.launcher.example.test',
    category: 'Operations',
    accent: '#79f2c0',
    description: 'Example uptime and incident dashboard.',
    tags: ['status', 'monitoring'],
    sort_order: 20,
    featured: 1,
    enabled: 1
  },
  {
    id: 'demo-media',
    name: 'Media Library',
    icon: '🎬',
    url: 'https://media.launcher.example.test',
    category: 'Media',
    accent: '#b99cff',
    description: 'Example streaming and library service.',
    tags: ['media', 'library'],
    sort_order: 30,
    featured: 1,
    enabled: 1
  },
  {
    id: 'demo-docs',
    name: 'Documentation',
    icon: '📚',
    url: 'https://docs.launcher.example.test',
    category: 'Reference',
    accent: '#ffd166',
    description: 'Example internal docs/wiki link.',
    tags: ['docs', 'wiki'],
    sort_order: 40,
    featured: 0,
    enabled: 1
  },
  {
    id: 'demo-files',
    name: 'File Browser',
    icon: '🗂️',
    url: 'https://files.launcher.example.test',
    category: 'Storage',
    accent: '#ff8fab',
    description: 'Example file-management service.',
    tags: ['files', 'storage'],
    sort_order: 50,
    featured: 0,
    enabled: 1
  }
];

const upsert = db.prepare(`
  INSERT INTO services (id, name, icon, url, category, accent, description, tags_json, sort_order, featured, enabled, updated_at)
  VALUES (@id, @name, @icon, @url, @category, @accent, @description, @tags_json, @sort_order, @featured, @enabled, CURRENT_TIMESTAMP)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    icon = excluded.icon,
    url = excluded.url,
    category = excluded.category,
    accent = excluded.accent,
    description = excluded.description,
    tags_json = excluded.tags_json,
    sort_order = excluded.sort_order,
    featured = excluded.featured,
    enabled = excluded.enabled,
    updated_at = CURRENT_TIMESTAMP
`);

const tx = db.transaction(() => {
  for (const service of demoServices) {
    upsert.run({ ...service, tags_json: JSON.stringify(service.tags) });
  }
});
tx();

setSetting(db, 'app_name', 'Home Lab Launcher Demo');
setSetting(db, 'app_base_url', process.env.APP_BASE_URL || 'http://localhost:8080');
setSetting(db, 'public_read_enabled', true);
setSetting(db, 'weather', {
  label: 'Example City',
  latitude: 40.7128,
  longitude: -74.006,
  units: 'fahrenheit',
  resolvedAt: new Date().toISOString()
});
setSetting(db, 'appearance', {
  ...DEFAULT_APPEARANCE,
  brand: {
    ...DEFAULT_APPEARANCE.brand,
    appName: 'Home Lab Launcher Demo',
    pageTitle: 'Home Lab Launcher Demo',
    brandText: 'Launcher Demo',
    brandSubtitle: 'Example self-hosted portal',
    brandMarkText: 'LD'
  },
  hero: {
    eyebrow: 'Demo workspace',
    heading: 'One place for every internal service.',
    subheading: 'Neutral sample data for screenshots, local demos, and repeatable UI checks.'
  },
  theme: {
    ...DEFAULT_APPEARANCE.theme,
    colors: {
      primary: '#8fd3ff',
      surface: '#101827'
    }
  }
});

db.close();
console.log(`Seeded neutral demo data in ${dataDir}`);
console.log('Create the first Admin in the browser, or set BOOTSTRAP_ADMIN_USERNAME/PASSWORD before the first start.');
