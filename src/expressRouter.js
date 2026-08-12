/**
 * @fileoverview Optional Express integration for SyncMesh.
 *
 * Architect: Omindu Dissanayaka (https://github.com/OminduDissanayaka)
 *
 * Not required to use SyncMesh — call the SyncMesh methods directly from
 * any framework (Fastify, Koa, a raw http server, etc). This is a
 * convenience wrapper for people already using Express.
 *
 * Usage:
 *   const { createExpressRouter } = require('syncmesh/express');
 *   app.use(createExpressRouter(mesh));
 */

'use strict';

/**
 * @param {import('./index').SyncMesh} mesh - An already-`init()`ed SyncMesh instance.
 * @returns {import('express').Router}
 */
function createExpressRouter(mesh) {
  let express;
  try {
    express = require('express');
  } catch (error) {
    throw new Error('createExpressRouter() needs express installed: npm install express');
  }

  const router = express.Router();

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
      const before = req.query.before ? Number(req.query.before) : Date.now();
      const limit = req.query.limit ? Number(req.query.limit) : 50;
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
