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
app.use(cors({ exposedHeaders: ['ETag'] }));
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

  // Mounts:
  //   POST /start-upload, /get-upload-urls, /complete-upload, /abort-upload
  //   GET  /file/:fileId
  //   GET  /chat/:roomId/history
  //   POST /chat/:roomId/archive-check
  app.use(createExpressRouter(mesh));

  app.get('/ping', (_req, res) => res.status(200).send('Pong!'));

  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => console.log(`Example app listening on port=${PORT}`));
}

start().catch((error) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
