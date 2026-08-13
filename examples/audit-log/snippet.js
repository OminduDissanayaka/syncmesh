/**
 * Recipe: Organization audit log
 *
 * Audit entries are append-only and rarely re-read in bulk, but still
 * benefit from the same bounded-RAM + archive pattern as chat — an
 * active org can generate a lot of events over time.
 *
 * Note: unlike chat, you may want a much larger hotWindow (or to archive
 * eagerly) since audit logs are usually read rarely but must never be
 * lost — tune room.hotWindow based on your own write volume.
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
 * @param {string} organizationId
 * @param {{ actorId: string, action: string, targetId: string }} entry
 */
async function recordAuditEvent(organizationId, entry) {
  const auditId = `audit:${organizationId}`;
  const eventId = crypto.randomUUID();

  gun.get(`room:${auditId}`).get('messages').get(eventId).put({
    ts: Date.now(),
    ...entry,
  });

  await mesh.archiveRoomIfNeeded(auditId);
}

async function getAuditTrail(organizationId, { before, limit = 100 } = {}) {
  const auditId = `audit:${organizationId}`;
  return mesh.getHistory(auditId, { before, limit });
}

async function main() {
  await mesh.init();

  await recordAuditEvent('org_9', {
    actorId: 'user_3',
    action: 'file.deleted',
    targetId: 'file_abc123',
  });

  console.log(await getAuditTrail('org_9'));
}

main().catch(console.error);
