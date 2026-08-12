#!/usr/bin/env node
/**
 * @fileoverview syncmesh-init-d1-proxy — scaffolds the Cloudflare Worker
 * that's required only if you choose db.provider = 'd1'.
 *
 * Architect: Omindu Dissanayaka (https://github.com/OminduDissanayaka)
 *
 * Cloudflare D1 has no external protocol — it can only be queried from
 * inside a Worker via a binding. This copies a ready-to-deploy Worker
 * project (templates/d1-worker-proxy) into your current directory.
 *
 * Run:
 *   npx syncmesh-init-d1-proxy
 */

'use strict';

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'templates', 'd1-worker-proxy');
const dest = path.join(process.cwd(), 'd1-worker-proxy');

/**
 * @param {string} srcDir
 * @param {string} destDir
 */
function copyRecursive(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyRecursive(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

if (fs.existsSync(dest)) {
  console.error(`✖ ${dest} already exists — remove it first or run this in a clean directory.`);
  process.exit(1);
}

copyRecursive(src, dest);

console.log(`✔ Scaffolded d1-worker-proxy/`);
console.log('');
console.log('Next steps:');
console.log('  cd d1-worker-proxy');
console.log('  npm install');
console.log('  npx wrangler d1 create syncmesh-db      # copy the database_id into wrangler.toml');
console.log('  npm run db:init                         # applies schema.sql');
console.log('  npx wrangler secret put D1_PROXY_TOKEN   # generate a long random secret');
console.log('  npm run deploy');
console.log('');
console.log('Then in your app: db: { provider: "d1", proxyUrl: "<worker-url>", proxyToken: "<same secret>" }');
