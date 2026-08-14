/**
 * @fileoverview Example: wiring SyncMesh into your own Express app.
 *
 * Run the relay separately first:
 *   npx syncmesh-relay
 *
 * Then:
 *   npm install
 *   node server.js
 */

'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { SyncMesh } = require('syncmesh');
const { createExpressRouter } = require('syncmesh/express');

const app = express();

// SECURITY: this default is intentionally restrictive. An unauthenticated
// wildcard CORS origin on upload/history endpoints is a common way an
// "example" gets copy-pasted straight into production. Set CORS_ORIGIN to
// your actual frontend's origin(s); requests from anywhere else are
// rejected. See README.md → Security.
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
if (allowedOrigins.length === 0) {
  console.warn('⚠ CORS_ORIGIN is not set — all cross-origin requests will be blocked by default.');
}
app.use(
  cors({
    origin: allowedOrigins,
    exposedHeaders: ['ETag'],
  })
);
app.use(express.json());

const mesh = new SyncMesh({
  gunPeerUrl: process.env.GUN_PEER_URL, // e.g. http://localhost:8081/gun
  r2: {
    accountId: process.env.CF_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketName: process.env.R2_BUCKET_NAME,
  },
  db: {
    provider: process.env.DB_PROVIDER || 'mongodb', // 'd1' | 'mongodb' | 'mysql' | 'postgres'
    uri: process.env.DB_URI,
  },
  room: { hotWindow: 300, archiveBatchSize: 150 },
});

async function start() {
  await mesh.init();

  // SECURITY: this router has NO built-in auth. requireAuth below is a
  // stub — replace it with real session/JWT verification before this
  // touches production. See README.md → Security → "Recommended request
  // flow" for what a real implementation (auth → authorization → upload
  // limits → SyncMesh) should look like; this example only wires the
  // hook point, not the actual checks.
  function requireAuth(req, res, next) {
    if (!process.env.SKIP_AUTH_FOR_LOCAL_DEV) {
      return res.status(501).json({
        error: 'requireAuth is a stub in this example — implement real auth before deploying.',
      });
    }
    next();
  }

  // Mounts:
  //   POST /start-upload, /get-upload-urls, /complete-upload, /abort-upload
  //   GET  /file/:fileId
  //   GET  /chat/:roomId/history
  //   POST /chat/:roomId/archive-check
  app.use(createExpressRouter(mesh, { middleware: [requireAuth] }));

  app.get('/ping', (_req, res) => res.status(200).send('Pong!'));

  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => console.log(`Example app listening on port=${PORT}`));
}

start().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
