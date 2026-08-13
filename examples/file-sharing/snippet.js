/**
 * Recipe: File sharing (no Gun events involved)
 *
 * A pure upload/download flow — some use cases only need SyncMesh's R2
 * layer, not the chat/event layer at all.
 *
 * IMPORTANT: see README.md → Security. Every call here must sit behind
 * your own authentication + authorization first — this file omits that
 * to keep the R2 flow itself readable.
 */

'use strict';

const crypto = require('crypto');
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

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];
const MAX_PARTS = 20; // 20 * 5MB parts = up to 100MB per file in this example

/**
 * Server-side: issue upload URLs for a client-side multipart upload.
 * @param {{ fileName: string, fileType: string, partCount: number }} params
 */
async function requestUpload({ fileName, fileType, partCount }) {
  if (!ALLOWED_TYPES.includes(fileType)) {
    throw new Error(`Unsupported file type: ${fileType}`);
  }
  if (partCount > MAX_PARTS) {
    throw new Error(`Too many parts requested: ${partCount} > ${MAX_PARTS}`);
  }

  const fileId = crypto.randomUUID();
  const { uploadId, fileKey } = await mesh.startUpload({ fileId, fileName, fileType });
  const urls = await mesh.getUploadUrls({ fileKey, uploadId, parts: partCount });

  return { fileId, uploadId, fileKey, urls };
}

/**
 * Server-side: called once the client has PUT every part directly to R2
 * and collected each response's ETag header.
 * @param {{ fileId, fileKey, uploadId, parts, fileName, fileType, fileSize }} params
 */
async function finishUpload(params) {
  await mesh.completeUpload(params);
}

async function getDownloadLink(fileId) {
  return mesh.getFile(fileId); // -> { metadata, downloadUrl } | null
}

module.exports = { mesh, requestUpload, finishUpload, getDownloadLink };
