'use strict';

/**
 * @file routes/stats.js
 * @description GET /stats – Server- und Alarmstatistiken.
 */

const { Router } = require('express');
const { QueueService } = require('../services/queueService');
const HistoryService = require('../services/historyService');
const { getClientCount } = require('../services/websocketService');
const config = require('../config');

const router = Router();

/**
 * GET /stats
 * Gibt aktuelle Statistiken über Server, Queue und Alarmhistorie zurück.
 */
router.get('/', (req, res) => {
  const mem = process.memoryUsage();
  const uptime = process.uptime();
  const queueService = QueueService.getInstance();

  res.json({
    ok: true,
    server: {
      version: process.env.npm_package_version || '1.0.0',
      nodeEnv: config.server.nodeEnv,
      uptime: Math.floor(uptime),
      uptimeHuman: _formatUptime(uptime),
      pid: process.pid,
      memory: {
        heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB: Math.round(mem.rss / 1024 / 1024),
      },
    },
    queue: {
      size: queueService.size,
      entries: queueService._getPublicQueue(),
    },
    alarms: HistoryService.getStats(),
    websocket: {
      connectedClients: getClientCount(),
    },
    config: {
      rtpHost: config.rtp.host,
      rtpPort: config.rtp.port,
      defaultVoice: config.piper.defaultVoice,
      queueMaxSize: config.queue.maxSize,
    },
  });
});

function _formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

module.exports = router;
