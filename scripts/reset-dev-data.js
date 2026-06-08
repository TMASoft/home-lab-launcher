#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(repoRoot, 'data'));
const force = process.argv.includes('--force');

function isInsideRepo(target) {
  const relative = path.relative(repoRoot, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

if (!isInsideRepo(dataDir) && !force) {
  console.error(`Refusing to remove DATA_DIR outside this repository without --force: ${dataDir}`);
  process.exit(1);
}

if (dataDir === repoRoot) {
  console.error('Refusing to remove the repository root. Set DATA_DIR to a development data directory.');
  process.exit(1);
}

fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });
console.log(`Reset development data directory: ${dataDir}`);
