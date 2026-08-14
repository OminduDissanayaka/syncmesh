/**
 * @fileoverview SyncMesh — real-time GunDB sync + tiered storage.
 *
 * Architect: Omindu Dissanayaka (https://github.com/OminduDissanayaka)
 * https://github.com/OminduDissanayaka/syncmesh
 *
 * SyncMesh combines three layers behind one small API:
 *   - GunDB (hot)     — real-time, in-memory, hard-capped per room
 *   - Cloudflare R2 (cold) — write-once JSON archive chunks + file blobs
 *   - Metadata DB (index) — pluggable: D1 / MongoDB / MySQL / PostgreSQL
 *
 * Why the rolling window matters: GunDB has no true delete — nulling a
 * node leaves a tombstone in the graph forever (needed for distributed
 * consistency). So SyncMesh doesn't rely on "archive then delete = free
 * RAM" as its primary defense. Instead every room is capped at
 * `room.hotWindow` live messages; whenever a room crosses that cap, the
 * oldest overflow is archived to R2, indexed in the metadata DB, and only
 * then nulled out of Gun — keeping the live *content* footprint bounded
 * even though small tombstones still accumulate over time.
 *
 * See README.md for the full data-model contract (how messages must be
 * written to Gun for the archiver to find them).
 */

'use strict';

const crypto = require('crypto');
const Gun = require('gun');
const R2Store = require('./r2Client');
const { createAdapter } = require('./db');
const BaseAdapter = require('./db/BaseAdapter');

class SyncMesh {
  /**
   * @param {object} options
   * @param {string} options.gunPeerUrl - URL of your GunDB relay, e.g. https://your-relay.example.com/gun
   * @param {object} options.r2 - { accountId, accessKeyId, secretAccessKey, bucketName }
   * @param {object} options.db - { provider: 'd1'|'mongodb'|'mysql'|'postgres', ...providerOptions } or { adapter: <BaseAdapter instance> }
   * @param {object} [options.room]
   * @param {number} [options.room.hotWindow=300] - Max live messages kept per room in Gun before archiving overflow.
   * @param {number} [options.room.archiveBatchSize=150] - Max messages archived in a single sweep.
   */
  constructor(options = {}) {
    if (!options.gunPeerUrl) throw new Error('SyncMesh requires options.gunPeerUrl');
    if (!options.r2) throw new Error('SyncMesh requires options.r2 config');
    if (!options.db) throw new Error('SyncMesh requires options.db config');

    this.gunPeerUrl = options.gunPeerUrl;
    this.roomHotWindow = options.room?.hotWindow ?? 300;
    this.archiveBatchSize = options.room?.archiveBatchSize ?? 150;

    this.r2 = new R2Store(options.r2);
    this.db = createAdapter(options.db);
    this.gun = null;
  }

  /**
   * Connects the metadata DB and the Gun client. Call once at startup.
   * @returns {Promise<void>}
   */
  async init() {
    await this.db.init();
    this.gun = Gun({ peers: [this.gunPeerUrl], radisk: false, localStorage: false });
  }

  /**
   * Releases the metadata DB's pooled connections. Gun itself has no
   * explicit close — just stop referencing this instance.
   * @returns {Promise<void>}
   */
  async close() {
    await this.db.close();
  }

  // ────────────────────────────────────────────────────────────────────
  // Chat archival & history
  // ────────────────────────────────────────────────────────────────────

  /**
   * @private
   * Reads every message node currently held for a room, sorted oldest-first.
   * Expects messages written at gun.get(`room:${roomId}`).get('messages').get(messageId)
   * with at least a numeric `ts` field.
   */
  _readRoomMessages(roomId) {
    return new Promise((resolve) => {
      const messages = [];
      this.gun
        .get(`room:${roomId}`)
        .get('messages')
        .map()
        .once((data, id) => {
          if (data && typeof data.ts === 'number') {
            messages.push({ ...data, id });
          }
        });
      // .map().once() is fire-and-forget per node; a short settle delay is
      // the pragmatic way to know a graph walk over a bounded set is done.
      setTimeout(() => resolve(messages.sort((a, b) => a.ts - b.ts)), 800);
    });
  }

  /** @private */
  _nullMessage(roomId, messageId) {
    this.gun.get(`room:${roomId}`).get('messages').get(messageId).put(null);
  }

  /**
   * Checks a room against the rolling window and archives overflow to R2
   * + the metadata DB if needed. Safe to call after every new message
   * write — it's a no-op when the room is under the window size.
   * @param {string} roomId
   * @returns {Promise<{ archived: boolean, chunkId?: string, count?: number }>}
   */
  async archiveRoomIfNeeded(roomId) {
    const messages = await this._readRoomMessages(roomId);

    if (messages.length <= this.roomHotWindow) {
      return { archived: false };
    }

    const overflowCount = messages.length - this.roomHotWindow;
    const batch = messages.slice(0, Math.min(overflowCount, this.archiveBatchSize));

    const chunkId = crypto.randomUUID();
    const chunkKey = `chat-archives/${roomId}/${chunkId}.json`;
    const startTs = batch[0].ts;
    const endTs = batch[batch.length - 1].ts;

    await this.r2.putJsonChunk(chunkKey, { roomId, chunkId, messages: batch });

    await this.db.insertChunkMetadata({
      chunkId,
      roomId,
      r2Key: chunkKey,
      startTs,
      endTs,
      messageCount: batch.length,
    });

    batch.forEach((message) => this._nullMessage(roomId, message.id));

    return { archived: true, chunkId, count: batch.length };
  }

  /**
   * Returns chat history for a room, blending hot (Gun) and cold
   * (R2 via metadata-DB index) messages. Archived messages are returned
   * as plain JSON for the caller to render directly — they are
   * intentionally NOT re-written back into the shared Gun relay, which
   * would just refill the RAM this whole system exists to protect.
   * @param {string} roomId
   * @param {{ before?: number, limit?: number }} [options]
   * @returns {Promise<Array<object>>}
   */
  async getHistory(roomId, { before = Date.now(), limit = 50 } = {}) {
    const safeBefore = Number.isFinite(before) ? before : Date.now();
    // Number.isFinite(limit) rejects NaN and Infinity; limit <= 0 (including
    // -0, which arr.slice(-0) treats as arr.slice(0) — the WHOLE array,
    // not an empty one) is clamped to 0 explicitly so `{ limit: 0 }` really
    // does return nothing.
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;

    if (safeLimit === 0) return [];

    const hot = (await this._readRoomMessages(roomId)).filter((m) => m.ts < safeBefore);

    if (hot.length >= safeLimit) {
      return hot.slice(-safeLimit);
    }

    const remaining = safeLimit - hot.length;
    const chunkRows = await this.db.getChunksForRoom(roomId, safeBefore, 5);

    const archivedMessages = [];
    for (const row of chunkRows) {
      const chunk = await this.r2.getJsonChunk(row.r2Key);
      archivedMessages.push(...chunk.messages);
      if (archivedMessages.length >= remaining) break;
    }

    return [...archivedMessages.slice(-remaining), ...hot];
  }

  // ────────────────────────────────────────────────────────────────────
  // File uploads (direct-to-R2, presigned multipart)
  // ────────────────────────────────────────────────────────────────────

  /**
   * @param {{ fileId: string, fileName: string, fileType: string }} params
   * @returns {Promise<{ uploadId: string, fileKey: string }>}
   */
  async startUpload({ fileId, fileName, fileType }) {
    const fileKey = `uploads/${fileId}/${fileName}`;
    const uploadId = await this.r2.startMultipartUpload(fileKey, fileType);
    return { uploadId, fileKey };
  }

  /**
   * @param {{ fileKey: string, uploadId: string, parts: number }} params
   * @returns {Promise<string[]>}
   */
  async getUploadUrls({ fileKey, uploadId, parts }) {
    return this.r2.getPresignedPartUrls(fileKey, uploadId, parts);
  }

  /**
   * @param {{ fileId: string, fileKey: string, uploadId: string, parts: Array<{ETag: string, PartNumber: number}>, fileName: string, fileType: string, fileSize: number }} params
   * @returns {Promise<void>}
   */
  async completeUpload({ fileId, fileKey, uploadId, parts, fileName, fileType, fileSize }) {
    await this.r2.completeMultipartUpload(fileKey, uploadId, parts);
    await this.db.insertFileMetadata({ fileId, fileName, fileType, fileSize, fileKey });
  }

  /**
   * @param {{ fileKey: string, uploadId: string }} params
   * @returns {Promise<void>}
   */
  async abortUpload({ fileKey, uploadId }) {
    return this.r2.abortMultipartUpload(fileKey, uploadId);
  }

  /**
   * @param {string} fileId
   * @returns {Promise<{ metadata: object, downloadUrl: string } | null>}
   */
  async getFile(fileId) {
    const metadata = await this.db.getFileMetadata(fileId);
    if (!metadata) return null;
    const downloadUrl = await this.r2.getDownloadUrl(metadata.fileKey);
    return { metadata, downloadUrl };
  }
}

module.exports = { SyncMesh, BaseAdapter };
