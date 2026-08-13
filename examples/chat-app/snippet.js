/**
 * Recipe: Basic chat
 *
 * Two users in one room, writing and reading messages through SyncMesh.
 * Run the relay first: npx syncmesh-relay
 */

'use strict';

const crypto = require('crypto');
const Gun = require('gun');
const { SyncMesh } = require('syncmesh');

const gun = Gun({ peers: [process.env.GUN_PEER_URL || 'http://localhost:8081/gun'] });

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

async function sendMessage(roomId, userId, text) {
  const messageId = crypto.randomUUID();

  gun.get(`room:${roomId}`).get('messages').get(messageId).put({
    ts: Date.now(),
    userId,
    text,
  });

  // Cheap no-op unless this room just crossed room.hotWindow.
  await mesh.archiveRoomIfNeeded(roomId);
}

async function loadRecentMessages(roomId) {
  return mesh.getHistory(roomId, { limit: 50 });
}

async function main() {
  await mesh.init();

  const roomId = 'general';
  await sendMessage(roomId, 'user_1', 'Hey, anyone around?');
  await sendMessage(roomId, 'user_2', 'Yep, here!');

  console.log(await loadRecentMessages(roomId));
}

main().catch(console.error);
