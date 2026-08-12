/**
 * @fileoverview PostgresAdapter — implements BaseAdapter against PostgreSQL.
 *
 * Architect: Omindu Dissanayaka (https://github.com/OminduDissanayaka)
 *
 * Install:  npm install pg
 *
 * Config (passed as `db` in the SyncMesh constructor) — either a URI:
 *   { provider: 'postgres', uri: 'postgres://user:password@host:5432/database' }
 * ...or discrete fields:
 *   { provider: 'postgres', host, user, password, database, port }
 */

'use strict';

const BaseAdapter = require('../BaseAdapter');

class PostgresAdapter extends BaseAdapter {
  /**
   * @param {{ uri?: string, host?: string, user?: string, password?: string, database?: string, port?: number }} config
   */
  constructor(config = {}) {
    super();
    this.config = config;
    this.pool = null;
  }

  async init() {
    let Pool;
    try {
      ({ Pool } = require('pg'));
    } catch (error) {
      throw new Error('PostgresAdapter needs the "pg" package. Install it with: npm install pg');
    }

    const { uri, host, user, password, database, port } = this.config;
    this.pool = uri
      ? new Pool({ connectionString: uri })
      : new Pool({ host, user, password, database, port: port || 5432 });

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS optimized_files (
        file_id TEXT PRIMARY KEY,
        file_name TEXT,
        file_type TEXT,
        file_size BIGINT,
        file_key TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS chat_archive_chunks (
        chunk_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        r2_key TEXT NOT NULL,
        start_ts BIGINT NOT NULL,
        end_ts BIGINT NOT NULL,
        message_count INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS idx_chunks_room_time ON chat_archive_chunks (room_id, start_ts, end_ts)`
    );
  }

  async insertFileMetadata({ fileId, fileName, fileType, fileSize, fileKey }) {
    await this.pool.query(
      `INSERT INTO optimized_files (file_id, file_name, file_type, file_size, file_key) VALUES ($1, $2, $3, $4, $5)`,
      [fileId, fileName, fileType, fileSize, fileKey]
    );
  }

  async getFileMetadata(fileId) {
    const { rows } = await this.pool.query('SELECT * FROM optimized_files WHERE file_id = $1', [fileId]);
    if (!rows.length) return null;
    const row = rows[0];
    return {
      fileId: row.file_id,
      fileName: row.file_name,
      fileType: row.file_type,
      fileSize: Number(row.file_size),
      fileKey: row.file_key,
      createdAt: row.created_at,
    };
  }

  async insertChunkMetadata({ chunkId, roomId, r2Key, startTs, endTs, messageCount }) {
    await this.pool.query(
      `INSERT INTO chat_archive_chunks (chunk_id, room_id, r2_key, start_ts, end_ts, message_count) VALUES ($1, $2, $3, $4, $5, $6)`,
      [chunkId, roomId, r2Key, startTs, endTs, messageCount]
    );
  }

  async getChunksForRoom(roomId, beforeTs, limit = 5) {
    const { rows } = await this.pool.query(
      `SELECT * FROM chat_archive_chunks WHERE room_id = $1 AND end_ts < $2 ORDER BY end_ts DESC LIMIT $3`,
      [roomId, beforeTs, limit]
    );
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      roomId: row.room_id,
      r2Key: row.r2_key,
      startTs: Number(row.start_ts),
      endTs: Number(row.end_ts),
      messageCount: row.message_count,
    }));
  }

  async close() {
    await this.pool?.end();
  }
}

module.exports = PostgresAdapter;
