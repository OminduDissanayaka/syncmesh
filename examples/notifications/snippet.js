/**
 * Recipe: Per-user notifications
 *
 * Similar shape to an activity feed, but read/unread state lives in your
 * own app data, not in SyncMesh — SyncMesh only owns "what happened and
 * when", not per-user read state.
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
  // Notifications are usually short-lived — a smaller window is fine.
  room: { hotWindow: 100, archiveBatchSize: 50 },
});

/**
 * @param {string} userId - Recipient.
 * @param {string} kind - e.g. 'mention', 'reply', 'invite'
 * @param {object} payload - Whatever fields your notification UI needs.
 */
async function notify(userId, kind, payload) {
  const notifId = `user:${userId}:notifications`;
  const eventId = crypto.randomUUID();

  gun.get(`room:${notifId}`).get('messages').get(eventId).put({
    ts: Date.now(),
    kind,
    ...payload,
  });

  await mesh.archiveRoomIfNeeded(notifId);
}

async function getNotifications(userId) {
  const notifId = `user:${userId}:notifications`;
  return mesh.getHistory(notifId, { limit: 30 });
}

async function main() {
  await mesh.init();

  await notify('user_42', 'mention', { fromUserId: 'user_7', postId: 'post_101' });
  console.log(await getNotifications('user_42'));
}

main().catch(console.error);
