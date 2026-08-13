/**
 * Recipe: Per-user activity feed
 *
 * A "room" here is one user's personal activity stream — bounded and
 * archived exactly like a chat room, just with a different id shape and
 * event fields.
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

/**
 * @param {string} userId - Owner of the feed.
 * @param {string} type - e.g. 'followed_user', 'liked_post', 'commented'
 * @param {string} targetId - Whatever entity the activity refers to.
 */
async function recordActivity(userId, type, targetId) {
  const feedId = `user:${userId}:activity`;
  const eventId = crypto.randomUUID();

  gun.get(`room:${feedId}`).get('messages').get(eventId).put({
    ts: Date.now(),
    type,
    targetId,
  });

  await mesh.archiveRoomIfNeeded(feedId);
}

async function getActivity(userId) {
  const feedId = `user:${userId}:activity`;
  return mesh.getHistory(feedId, { limit: 50 });
}

async function main() {
  await mesh.init();

  await recordActivity('user_42', 'followed_user', 'user_7');
  console.log(await getActivity('user_42'));
}

main().catch(console.error);
