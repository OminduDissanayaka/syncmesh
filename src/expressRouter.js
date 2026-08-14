/**
 * @fileoverview Optional Express integration for SyncMesh.
 *
 * Architect: Omindu Dissanayaka (https://github.com/OminduDissanayaka)
 *
 * Not required to use SyncMesh — call the SyncMesh methods directly from
 * any framework (Fastify, Koa, a raw http server, etc). This is a
 * convenience wrapper for people already using Express.
 *
 * SECURITY: this router has no built-in concept of users or permissions
 * (see README.md → Security). Pass `middleware` to apply your own
 * authentication/authorization in front of every route it defines — for
 * per-resource checks (e.g. "does this user own this fileId/roomId?"),
 * write your own routes calling the SyncMesh methods directly instead of
 * using this router at all; see README.md → Security → "Recommended
 * request flow" for an example.
 *
 * Usage:
 *   const { createExpressRouter } = require('syncmesh/express');
 *   app.use(createExpressRouter(mesh, { middleware: [requireAuth] }));
 */

'use strict';

const MAX_HISTORY_LIMIT = 200;
const DEFAULT_HISTORY_LIMIT = 50;

/**
 * Clamps a client-supplied "limit" query param to a safe, finite,
 * positive integer within [0, MAX_HISTORY_LIMIT] — guards against NaN
 * (e.g. ?limit=abc), negative values, and unbounded values that would
 * force SyncMesh/R2 to fetch an unreasonable number of archive chunks.
 * @param {unknown} raw
 * @returns {number}
 */
function clampLimit(raw) {
  if (raw === undefined) return DEFAULT_HISTORY_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_HISTORY_LIMIT;
  return Math.min(Math.max(Math.floor(n), 0), MAX_HISTORY_LIMIT);
}

/**
 * Parses a client-supplied "before" query param into a valid timestamp,
 * falling back to now on anything non-finite (e.g. ?before=abc).
 * @param {unknown} raw
 * @returns {number}
 */
function parseBefore(raw) {
  if (raw === undefined) return Date.now();
  const n = Number(raw);
  return Number.isFinite(n) ? n : Date.now();
}

/**
 * @param {import('./index').SyncMesh} mesh - An already-`init()`ed SyncMesh instance.
 * @param {object} [options]
 * @param {import('express').RequestHandler[]} [options.middleware] - Applied to every route before it runs, e.g. your own auth check.
 * @returns {import('express').Router}
 */
function createExpressRouter(mesh, options = {}) {
  let express;
  try {
    express = require('express');
  } catch (error) {
    throw new Error('createExpressRouter() needs express installed: npm install express');
  }

  const { middleware = [] } = options;
  const router = express.Router();

  if (middleware.length) {
    router.use(...middleware);
  }

  router.post('/start-upload', async (req, res) => {
    try {
      const result = await mesh.startUpload(req.body);
      res.status(200).json(result);
    } catch (error) {
      console.error('start-upload error:', error);
      res.status(500).json({ error: 'Failed to initiate upload' });
    }
  });

  router.post('/get-upload-urls', async (req, res) => {
    try {
      const urls = await mesh.getUploadUrls(req.body);
      res.status(200).json({ urls });
    } catch (error) {
      console.error('get-upload-urls error:', error);
      res.status(500).json({ error: 'Failed to generate upload URLs' });
    }
  });

  router.post('/complete-upload', async (req, res) => {
    try {
      await mesh.completeUpload(req.body);
      res.status(200).json({ message: 'File uploaded successfully', fileId: req.body.fileId });
    } catch (error) {
      console.error('complete-upload error:', error);
      res.status(500).json({ error: 'Failed to complete upload' });
    }
  });

  router.post('/abort-upload', async (req, res) => {
    try {
      await mesh.abortUpload(req.body);
      res.status(200).json({ message: 'Upload aborted' });
    } catch (error) {
      console.error('abort-upload error:', error);
      res.status(500).json({ error: 'Failed to abort upload' });
    }
  });

  router.get('/file/:fileId', async (req, res) => {
    try {
      const result = await mesh.getFile(req.params.fileId);
      if (!result) return res.status(404).json({ error: 'File not found' });
      res.status(200).json(result);
    } catch (error) {
      console.error('get-file error:', error);
      res.status(500).json({ error: 'Failed to retrieve file' });
    }
  });

  router.get('/chat/:roomId/history', async (req, res) => {
    try {
      const before = parseBefore(req.query.before);
      const limit = clampLimit(req.query.limit);
      const messages = await mesh.getHistory(req.params.roomId, { before, limit });
      res.status(200).json({ roomId: req.params.roomId, messages });
    } catch (error) {
      console.error('chat history error:', error);
      res.status(500).json({ error: 'Failed to load chat history' });
    }
  });

  router.post('/chat/:roomId/archive-check', async (req, res) => {
    try {
      const result = await mesh.archiveRoomIfNeeded(req.params.roomId);
      res.status(200).json(result);
    } catch (error) {
      console.error('archive-check error:', error);
      res.status(500).json({ error: 'Failed to run archive check' });
    }
  });

  return router;
}

module.exports = { createExpressRouter };
