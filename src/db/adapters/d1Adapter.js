/**
 * @fileoverview D1Adapter — implements BaseAdapter against Cloudflare D1.
 *
 * Architect: Omindu Dissanayaka (https://github.com/OminduDissanayaka)
 *
 * No extra npm package needed (uses the global `fetch`, Node 18+).
 *
 * Config (passed as `db` in the SyncMesh constructor):
 *   { provider: 'd1', proxyUrl: '...', proxyToken: '...' }
 *
 * IMPORTANT: Cloudflare D1 has no direct external protocol — it can only
 * be queried from inside a Cloudflare Worker via a binding. This adapter
 * therefore talks to a small Worker that holds the real D1 binding.
 * Scaffold one with: npx syncmesh-init-d1-proxy
 */

'use strict';

const BaseAdapter = require('../BaseAdapter');

class D1Adapter extends BaseAdapter {
  /**
   * @param {{ proxyUrl: string, proxyToken: string }} config
   */
  constructor({ proxyUrl, proxyToken } = {}) {
    super();
    if (!proxyUrl || !proxyToken) {
      throw new Error(
        'D1Adapter requires { proxyUrl, proxyToken } — scaffold and deploy the proxy Worker first: npx syncmesh-init-d1-proxy'
      );
    }
    this.proxyUrl = proxyUrl;
    this.proxyToken = proxyToken;
  }

  /**
   * @private
   * @param {string} sql
   * @param {Array<string|number|null>} [params]
   */
  async _query(sql, params = []) {
    const response = await fetch(`${this.proxyUrl}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.proxyToken}` },
      body: JSON.stringify({ sql, params }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`D1 proxy error: ${data.error || response.statusText}`);
    return data.result;
  }

  async init() {
    await this._query(`
      CREATE TABLE IF NOT EXISTS optimized_files (
        file_id TEXT PRIMARY KEY,
        file_name TEXT,
        file_type TEXT,
        file_size INTEGER,
        file_key TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this._query(`
      CREATE TABLE IF NOT EXISTS chat_archive_chunks (
        chunk_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        r2_key TEXT NOT NULL,
        start_ts INTEGER NOT NULL,
        end_ts INTEGER NOT NULL,
        message_count INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this._query(
      `CREATE INDEX IF NOT EXISTS idx_chunks_room_time ON chat_archive_chunks (room_id, start_ts, end_ts)`
    );
  }

  async insertFileMetadata({ fileId, fileName, fileType, fileSize, fileKey }) {
    await this._query(
      `INSERT INTO optimized_files (file_id, file_name, file_type, file_size, file_key) VALUES (?, ?, ?, ?, ?)`,
      [fileId, fileName, fileType, fileSize, fileKey]
    );
  }

  async getFileMetadata(fileId) {
    const { results } = await this._query('SELECT * FROM optimized_files WHERE file_id = ?', [fileId]);
    if (!results || results.length === 0) return null;
    const row = results[0];
    return {
      fileId: row.file_id,
      fileName: row.file_name,
      fileType: row.file_type,
      fileSize: row.file_size,
      fileKey: row.file_key,
      createdAt: row.created_at,
    };
  }

  async insertChunkMetadata({ chunkId, roomId, r2Key, startTs, endTs, messageCount }) {
    await this._query(
      `INSERT INTO chat_archive_chunks (chunk_id, room_id, r2_key, start_ts, end_ts, message_count) VALUES (?, ?, ?, ?, ?, ?)`,
      [chunkId, roomId, r2Key, startTs, endTs, messageCount]
    );
  }

  async getChunksForRoom(roomId, beforeTs, limit = 5) {
    const { results } = await this._query(
      `SELECT * FROM chat_archive_chunks WHERE room_id = ? AND end_ts < ? ORDER BY end_ts DESC LIMIT ?`,
      [roomId, beforeTs, limit]
    );
    return (results || []).map((row) => ({
      chunkId: row.chunk_id,
      roomId: row.room_id,
      r2Key: row.r2_key,
      startTs: row.start_ts,
      endTs: row.end_ts,
      messageCount: row.message_count,
    }));
  }
}

module.exports = D1Adapter;
