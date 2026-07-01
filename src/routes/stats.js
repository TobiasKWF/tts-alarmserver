'use strict';

/**
 * @file routes/stats.js
 * @description GET /stats – Serverstatistiken und Queue-Status.
 */

const { Router } = require('express');
const { AlarmService } = require('../services/alarmService');
const { getClientCount } = require('../services/websocketService');
const config = require('../config');

const router = Router();

/**
 * GET /stats
 * Gibt aktuelle Serverstatistiken zurück.
 */
router.get('/', (req, res) => {
  const alarmService = AlarmService.getInstance();
  const stats = alarmService.getStats();

  res.json({
    ok: true,
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
    pid: process.pid,
    memory: process.memoryUsage(),
    alarm: {
      total: stats.total,
      errors: stats.errors,
      queueSize: stats.queueSize,
      isProcessing: stats.isProcessing,
    },
    websocket: {
      clients: getClientCount(),
    },
    config: {
      rtp: {
        host: config.rtp.host,
        port: config.rtp.port,
        codec: config.rtp.codec,
      },
      piper: {
        defaultVoice: config.piper.defaultVoice,
        speed: config.piper.speed,
      },
      queue: {
        maxSize: config.queue.maxSize,
      },
    },
    requestId: req.requestId,
  });
});

/**
 * GET /stats/history
 * Gibt die Alarm-Historie zurück.
 */
router.get('/history', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  const alarmService = AlarmService.getInstance();
  const history = alarmService.getHistory(Math.min(limit, 100));

  res.json({
    ok: true,
    count: history.length,
    history,
    requestId: req.requestId,
  });
});

/**
 * GET /stats/queue
 * Gibt den aktuellen Queue-Status zurück.
 */
router.get('/queue', (req, res) => {
  const alarmService = AlarmService.getInstance();
  const stats = alarmService.getStats();

  res.json({
    ok: true,
    queueSize: stats.queueSize,
    isProcessing: stats.isProcessing,
    requestId: req.requestId,
  });
});

module.exports = router;
