/**
 * Recipe: Collaborative app (live presence + durable edit log)
 *
 * Two different needs, two different patterns:
 *   - Presence/cursors: pure ephemeral Gun state, no archiving at all —
 *     nobody needs cursor position from an hour ago.
 *   - Edit history: goes through SyncMesh exactly like a chat room, so a
 *     long editing session doesn't grow the relay's RAM without bound.
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
 * Ephemeral — intentionally NOT archived. Just overwrite the same node
 * per user per document; there's nothing to keep once they disconnect.
 */
function updateCursor(documentId, userId, position) {
  gun.get(`presence:${documentId}`).get(userId).put({
    ts: Date.now(),
    position,
  });
}

/**
 * Durable — goes through SyncMesh's rolling window + archive, same as chat.
 * @param {string} documentId
 * @param {{ userId: string, op: string, range: [number, number], text: string }} edit
 */
async function recordEdit(documentId, edit) {
  const eventId = crypto.randomUUID();

  gun.get(`room:${documentId}`).get('messages').get(eventId).put({
    ts: Date.now(),
    ...edit,
  });

  await mesh.archiveRoomIfNeeded(documentId);
}

async function getEditHistory(documentId) {
  return mesh.getHistory(documentId, { limit: 200 });
}

async function main() {
  await mesh.init();

  updateCursor('doc_1', 'user_1', { line: 12, col: 4 });
  await recordEdit('doc_1', { userId: 'user_1', op: 'insert', range: [120, 120], text: 'hello' });

  console.log(await getEditHistory('doc_1'));
}

main().catch(console.error);
