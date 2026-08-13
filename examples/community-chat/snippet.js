/**
 * Recipe: Community / public channel
 *
 * One shared channel (not a private 1:1 room) that anyone can read.
 * Same SyncMesh calls as a private chat — the "room" is just a public
 * topic id instead of a per-conversation id.
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
  // Public channels tend to be noisier than 1:1 chats — a larger window
  // keeps more recent history "hot" before it needs a round trip to R2.
  room: { hotWindow: 1000, archiveBatchSize: 300 },
});

async function post(channelId, userId, text) {
  const eventId = crypto.randomUUID();

  gun.get(`room:${channelId}`).get('messages').get(eventId).put({
    ts: Date.now(),
    userId,
    text,
  });

  await mesh.archiveRoomIfNeeded(channelId);
}

async function main() {
  await mesh.init();

  const channelId = 'programming';
  await post(channelId, 'user_1', 'Anyone using SyncMesh yet?');

  const events = await mesh.getHistory(channelId, { limit: 100 });
  console.log(events);
}

main().catch(console.error);
