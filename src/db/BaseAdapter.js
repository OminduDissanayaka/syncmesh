/**
 * @fileoverview BaseAdapter — the contract every SyncMesh database adapter implements.
 *
 * Architect: Omindu Dissanayaka (https://github.com/OminduDissanayaka)
 *
 * SyncMesh's metadata layer only ever needs two things persisted: file
 * attachment metadata and chat-archive-chunk index rows. Any database can
 * back this as long as it implements the methods below — SyncMesh's core
 * (src/index.js) only ever talks to this interface, never to a specific
 * driver.
 *
 * All field names at this boundary are camelCase regardless of the
 * underlying store's native naming convention (SQL adapters map to/from
 * snake_case columns internally; Mongo stores camelCase directly).
 *
 * To write a custom adapter (e.g. SQLite, Turso, DynamoDB), extend this
 * class, implement every method, and pass an instance directly as
 * `db: { adapter: new MyAdapter(...) }` in the SyncMesh constructor —
 * see README.md → "Writing a custom adapter".
 */

'use strict';

class BaseAdapter {
  /**
   * Connects and ensures tables/collections/indexes exist. Called once by
   * SyncMesh#init().
   * @returns {Promise<void>}
   */
  async init() {
    throw new Error('init() not implemented');
  }

  /**
   * @param {{ fileId: string, fileName: string, fileType: string, fileSize: number, fileKey: string }} file
   * @returns {Promise<void>}
   */
  async insertFileMetadata(file) {
    throw new Error('insertFileMetadata() not implemented');
  }

  /**
   * @param {string} fileId
   * @returns {Promise<{ fileId: string, fileName: string, fileType: string, fileSize: number, fileKey: string, createdAt: string } | null>}
   */
  async getFileMetadata(fileId) {
    throw new Error('getFileMetadata() not implemented');
  }

  /**
   * @param {{ chunkId: string, roomId: string, r2Key: string, startTs: number, endTs: number, messageCount: number }} chunk
   * @returns {Promise<void>}
   */
  async insertChunkMetadata(chunk) {
    throw new Error('insertChunkMetadata() not implemented');
  }

  /**
   * Returns the most recent archive chunks for a room ending before a
   * given timestamp, newest first.
   * @param {string} roomId
   * @param {number} beforeTs
   * @param {number} [limit=5]
   * @returns {Promise<Array<{ chunkId: string, roomId: string, r2Key: string, startTs: number, endTs: number, messageCount: number }>>}
   */
  async getChunksForRoom(roomId, beforeTs, limit = 5) {
    throw new Error('getChunksForRoom() not implemented');
  }

  /**
   * Releases pooled connections. Called by SyncMesh#close().
   * @returns {Promise<void>}
   */
  async close() {
    // No-op by default (stateless HTTP adapters like D1 don't need this).
  }
}

module.exports = BaseAdapter;
