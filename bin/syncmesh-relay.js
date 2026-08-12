#!/usr/bin/env node
/**
 * @fileoverview syncmesh-relay — standalone GunDB relay server.
 *
 * Architect: Omindu Dissanayaka (https://github.com/OminduDissanayaka)
 *
 * A pure real-time relay: holds messages in memory and signals updates
 * between connected peers. Never persists to disk, never talks to R2 or
 * your metadata DB directly — SyncMesh's archiver (running inside your
 * own app, as a Gun *client* pointed at this relay) handles archiving.
 *
 * Run directly:
 *   npx syncmesh-relay
 *
 * Or add to your own package.json:
 *   "scripts": { "relay": "syncmesh-relay" }
 *
 * Env vars:
 *   PORT — defaults to 8081
 */

'use strict';

const express = require('express');
const Gun = require('gun');

const app = express();
const PORT = process.env.PORT || 8081;

app.get('/ping', (_req, res) => {
  res.status(200).send('Pong! SyncMesh relay is awake.');
});

const server = app.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] SyncMesh relay listening on port=${PORT}`);
  console.log(`Gun endpoint: http://localhost:${PORT}/gun`);
});

// radisk: false / multicast: false keep this a thin RAM-only signalling
// layer that fits comfortably on small dynos/instances.
Gun({
  web: server,
  radisk: false,
  localStorage: false,
  multicast: false,
  axe: false,
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing relay gracefully.');
  server.close(() => process.exit(0));
});
