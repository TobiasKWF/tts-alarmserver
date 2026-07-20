'use strict';

/**
 * Route: GET /api/status
 * Gibt den aktuellen Queue-Status und Server-Uptime zurück.
 */

const express = require('express');
const router = express.Router();
const queue = require('../services/queueService');

const startTime = Date.now();

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    version: '3.0.0',
    uptimeMs: Date.now() - startTime,
    queue: queue.status(),
  });
});

module.exports = router;
