/**
 * Recipe: IoT device event stream
 *
 * Each device gets its own bounded "room" — sensor readings pile up fast,
 * so a rolling window keeps the relay's live footprint predictable no
 * matter how many devices are reporting.
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
  // High-frequency sensor data — keep the hot window small so the relay
  // never has to hold more than a few minutes of readings per device.
  room: { hotWindow: 200, archiveBatchSize: 100 },
});

/**
 * @param {string} sensorId
 * @param {{ temperature: number, humidity: number, voltage: number }} reading
 */
async function recordReading(sensorId, reading) {
  const deviceId = `device:${sensorId}`;
  const eventId = crypto.randomUUID();

  gun.get(`room:${deviceId}`).get('messages').get(eventId).put({
    ts: Date.now(),
    ...reading,
  });

  await mesh.archiveRoomIfNeeded(deviceId);
}

async function getRecentReadings(sensorId) {
  const deviceId = `device:${sensorId}`;
  return mesh.getHistory(deviceId, { limit: 100 });
}

async function main() {
  await mesh.init();

  await recordReading('sensor_01', { temperature: 22.4, humidity: 48, voltage: 3.7 });
  console.log(await getRecentReadings('sensor_01'));
}

main().catch(console.error);
