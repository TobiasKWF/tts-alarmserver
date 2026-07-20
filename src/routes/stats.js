'use strict';

/**
 * @file routes/stats.js
 * @description GET /api/stats, GET /api/stats/history
 */

const { Router } = require('express');
const { query, validationResult } = require('express-validator');

const logger         = require('../utils/logger').child({ service: 'StatsRoute' });
const queueService   = require('../services/queueService');
const historyService = require('../services/historyService');
const { getConnectedClients } = require('../services/websocketService');
const config = require('../config');

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/stats
// ---------------------------------------------------------------------------

router.get('/', (req, res) => {
  const uptime = process.uptime();
  const mem    = process.memoryUsage();
  const qs     = queueService.status();

  logger.debug('Stats abgerufen', { requestId: req.requestId });

  res.json({
    ok: true,
    server: {
      version:     process.env.npm_package_version || '1.0.0',
      nodeEnv:     config.server.nodeEnv,
      uptime:      Math.floor(uptime),
      uptimeHuman: _formatUptime(uptime),
      pid:         process.pid,
      memory: {
        heapUsedMB:  Math.round(mem.heapUsed  / 1_048_576),
        heapTotalMB: Math.round(mem.heapTotal / 1_048_576),
        rssMB:       Math.round(mem.rss       / 1_048_576),
      },
    },
    queue: {
      running:  qs.running,
      waiting:  qs.waiting,
      maxSize:  qs.maxSize,
    },
    websocket: {
      connectedClients: getConnectedClients(),
    },
    rtp: {
      host:    config.rtp.host,
      port:    config.rtp.port,
      codec:   config.rtp.codec,
      bitrate: config.rtp.bitrate,
    },
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// GET /api/stats/history
// ---------------------------------------------------------------------------

router.get('/history', [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('limit muss zwischen 1 und 100 liegen'),
], (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ ok: false, errors: errors.array() });
    }

    const limit   = parseInt(req.query.limit, 10) || 50;
    const history = historyService.getLast(limit);

    res.json({
      ok:      true,
      total:   history.length,
      limit,
      history,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------

function _formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

module.exports = router;
