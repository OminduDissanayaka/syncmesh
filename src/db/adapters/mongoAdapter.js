/**
 * @fileoverview MongoAdapter — implements BaseAdapter against MongoDB.
 *
 * Architect: Omindu Dissanayaka (https://github.com/OminduDissanayaka)
 *
 * Install:  npm install mongodb
 *
 * Config (passed as `db` in the SyncMesh constructor):
 *   { provider: 'mongodb', uri: 'mongodb+srv://...', dbName: 'syncmesh' }
 *
 * Runs anywhere Node.js runs — no Workers/Cloudflare dependency, unlike D1.
 */

'use strict';

const BaseAdapter = require('../BaseAdapter');

class MongoAdapter extends BaseAdapter {
  /**
   * @param {{ uri: string, dbName?: string }} config
   */
  constructor({ uri, dbName = 'syncmesh' } = {}) {
    super();
    if (!uri) {
      throw new Error('MongoAdapter requires { uri } — a mongodb:// or mongodb+srv:// connection string.');
    }
    this.uri = uri;
    this.dbName = dbName;
    this.client = null;
    this.db = null;
  }

  async init() {
    let MongoClient;
    try {
      ({ MongoClient } = require('mongodb'));
    } catch (error) {
      throw new Error('MongoAdapter needs the "mongodb" package. Install it with: npm install mongodb');
    }

    this.client = new MongoClient(this.uri);
    await this.client.connect();
    this.db = this.client.db(this.dbName);

    await this.db.collection('optimized_files').createIndex({ fileId: 1 }, { unique: true });
    await this.db.collection('chat_archive_chunks').createIndex({ roomId: 1, endTs: -1 });
  }

  async insertFileMetadata({ fileId, fileName, fileType, fileSize, fileKey }) {
    await this.db.collection('optimized_files').insertOne({
      fileId,
      fileName,
      fileType,
      fileSize,
      fileKey,
      createdAt: new Date(),
    });
  }

  async getFileMetadata(fileId) {
    const doc = await this.db.collection('optimized_files').findOne({ fileId }, { projection: { _id: 0 } });
    return doc || null;
  }

  async insertChunkMetadata({ chunkId, roomId, r2Key, startTs, endTs, messageCount }) {
    await this.db.collection('chat_archive_chunks').insertOne({
      chunkId,
      roomId,
      r2Key,
      startTs,
      endTs,
      messageCount,
      createdAt: new Date(),
    });
  }

  async getChunksForRoom(roomId, beforeTs, limit = 5) {
    return this.db
      .collection('chat_archive_chunks')
      .find({ roomId, endTs: { $lt: beforeTs } }, { projection: { _id: 0 } })
      .sort({ endTs: -1 })
      .limit(limit)
      .toArray();
  }

  async close() {
    await this.client?.close();
  }
}

module.exports = MongoAdapter;
