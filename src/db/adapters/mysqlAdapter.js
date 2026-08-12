/**
 * @fileoverview MySQLAdapter — implements BaseAdapter against MySQL.
 *
 * Architect: Omindu Dissanayaka (https://github.com/OminduDissanayaka)
 *
 * Install:  npm install mysql2
 *
 * Config (passed as `db` in the SyncMesh constructor) — either a URI:
 *   { provider: 'mysql', uri: 'mysql://user:password@host:3306/database' }
 * ...or discrete fields:
 *   { provider: 'mysql', host, user, password, database, port }
 */

'use strict';

const BaseAdapter = require('../BaseAdapter');

class MySQLAdapter extends BaseAdapter {
  /**
   * @param {{ uri?: string, host?: string, user?: string, password?: string, database?: string, port?: number }} config
   */
  constructor(config = {}) {
    super();
    this.config = config;
    this.pool = null;
  }

  async init() {
    let mysql;
    try {
      mysql = require('mysql2/promise');
    } catch (error) {
      throw new Error('MySQLAdapter needs the "mysql2" package. Install it with: npm install mysql2');
    }

    const { uri, host, user, password, database, port } = this.config;
    this.pool = uri
      ? mysql.createPool(uri)
      : mysql.createPool({ host, user, password, database, port: port || 3306 });

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS optimized_files (
        file_id VARCHAR(64) PRIMARY KEY,
        file_name VARCHAR(512),
        file_type VARCHAR(255),
        file_size BIGINT,
        file_key VARCHAR(1024),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS chat_archive_chunks (
        chunk_id VARCHAR(64) PRIMARY KEY,
        room_id VARCHAR(255) NOT NULL,
        r2_key VARCHAR(1024) NOT NULL,
        start_ts BIGINT NOT NULL,
        end_ts BIGINT NOT NULL,
        message_count INT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_chunks_room_time (room_id, start_ts, end_ts)
      )
    `);
  }

  async insertFileMetadata({ fileId, fileName, fileType, fileSize, fileKey }) {
    await this.pool.query(
      `INSERT INTO optimized_files (file_id, file_name, file_type, file_size, file_key) VALUES (?, ?, ?, ?, ?)`,
      [fileId, fileName, fileType, fileSize, fileKey]
    );
  }

  async getFileMetadata(fileId) {
    const [rows] = await this.pool.query('SELECT * FROM optimized_files WHERE file_id = ?', [fileId]);
    if (!rows.length) return null;
    const row = rows[0];
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
    await this.pool.query(
      `INSERT INTO chat_archive_chunks (chunk_id, room_id, r2_key, start_ts, end_ts, message_count) VALUES (?, ?, ?, ?, ?, ?)`,
      [chunkId, roomId, r2Key, startTs, endTs, messageCount]
    );
  }

  async getChunksForRoom(roomId, beforeTs, limit = 5) {
    const [rows] = await this.pool.query(
      `SELECT * FROM chat_archive_chunks WHERE room_id = ? AND end_ts < ? ORDER BY end_ts DESC LIMIT ?`,
      [roomId, beforeTs, limit]
    );
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      roomId: row.room_id,
      r2Key: row.r2_key,
      startTs: row.start_ts,
      endTs: row.end_ts,
      messageCount: row.message_count,
    }));
  }

  async close() {
    await this.pool?.end();
  }
}

module.exports = MySQLAdapter;
