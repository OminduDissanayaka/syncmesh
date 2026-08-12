#!/usr/bin/env node
/**
 * @fileoverview syncmesh-relay — standalone GunDB relay server.
 *
 * Architect: Omindu Dissanayaka (https://github.com/OminduDissanayaka)
 *
 * Uses GunDB's own canonical relay pattern — a raw http server with
 * Gun.serve() as the request handler, then Gun({web: server}) attached on
 * top. No Express dependency: a pure relay only needs to speak Gun's own
 * protocol plus a tiny health-check endpoint, so there's no reason to
 * carry a web framework here.
 *
 * A relay never persists to disk and never talks to R2 or your metadata
 * DB directly — SyncMesh's archiver (running inside your own app, as a
 * Gun *client* pointed at this relay) handles archiving.
 *
 * Run directly:
 *   npx syncmesh-relay
 *
 * Env vars:
 *   PORT — defaults to 8081
 */

'use strict';

const http = require('http');
const Gun = require('gun');

const PORT = process.env.PORT || 8081;
const gunHandler = Gun.serve(__dirname);

/**
 * Wraps Gun's own request handler with a lightweight /ping route, so an
 * external uptime pinger (cron-job.org etc.) can keep a free/hobby dyno
 * awake without needing any extra framework.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
function requestListener(req, res) {
  if (req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Pong! SyncMesh relay is awake.');
    return;
  }
  gunHandler(req, res);
}

const server = http.createServer(requestListener);

// radisk: false / multicast: false keep this a thin RAM-only signalling
// layer that fits comfortably on small dynos/instances.
Gun({
  web: server,
  radisk: false,
  localStorage: false,
  multicast: false,
  axe: false,
});

server.listen(PORT, () => {
  const ts = new Date().toISOString();
  process.stdout.write(`[${ts}] SyncMesh relay started | port=${PORT} | gun endpoint: /gun\n`);
});

server.on('error', (err) => {
  process.stderr.write(`Server error: ${err.message}\n`);
  process.exit(1);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
