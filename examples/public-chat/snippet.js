/**
 * Recipe: Public chat (read access for anonymous visitors)
 *
 * Same as community-chat, but the key difference is on your API layer:
 * reading history can be open to anyone, while posting still requires
 * authentication. This file only shows the read side — see the Security
 * section in README.md for why posting must stay gated.
 */

'use strict';

const { SyncMesh } = require('syncmesh');

const mesh = new SyncMesh({
  gunPeerUrl: process.env.GUN_PEER_URL || 'http://localhost:8081/gun',
  r2: {
    accountId: process.env.CF_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketName: process.env.R2_BUCKET_NAME,
  },
  db: { provider: process.env.DB_PROVIDER || 'mongodb', uri: process.env.DB_URI },
});

/**
 * Express-style handler: no auth required to read a PUBLIC room's
 * history. Contrast with a private room, which needs a membership check
 * before this call (see README.md → Security → "Room authorization").
 */
async function handlePublicHistoryRequest(req, res) {
  const { roomId } = req.params;
  const before = req.query.before ? Number(req.query.before) : Date.now();

  const messages = await mesh.getHistory(roomId, { before, limit: 50 });
  res.status(200).json({ roomId, messages });
}

module.exports = { mesh, handlePublicHistoryRequest };
