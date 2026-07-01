'use strict';

/**
 * @file routes/stats.js
 * @description GET /stats, GET /history – Statistik- und Historien-Endpunkte.
 *
 * Öffentlich zugänglich (kein API-Key erforderlich),
 * da sie nur Lese-Informationen liefern.
 */

const { Router } = require('express');
const { query, validationResult } = require('express-validator');

const logger = require('../utils/logger').child({ service: 'StatsRoute' });
const { QueueService } = require('../services/queueService');
const { AlarmService } = require('../services/alarmService');
const { getConnectedClients } = require('../services/websocketService');
const config = require('../config');

const router = Router();

// ---------------------------------------------------------------------------
// GET /stats
// ---------------------------------------------------------------------------

/**
 * GET /stats
 * Liefert kombinierte Statistiken über Server, Queue und Alarmverarbeitung.
 *
 * Response:
 *   {
 *     ok: true,
 *     server: { uptime, uptimeHuman, version, nodeEnv, pid, memory },
 *     queue:  { size, processedTotal, failedTotal, running, paused },
 *     alarm:  { totalAlarms, failedAlarms, current },
 *     websocket: { connectedClients },
 *     rtp: { host, port, codec, bitrate },
 *     timestamp: ISO-String
 *   }
 */
router.get('/', (req, res) => {
  const uptime = process.uptime();
  const mem = process.memoryUsage();

  const queueStats = QueueService.getInstance().getStats();
  const alarmStats = AlarmService.getInstance().getStats();
  const connectedClients = getConnectedClients();

  logger.debug('Stats abgerufen', { requestId: req.requestId });

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
    queue: queueStats,
    alarm: alarmStats,
    websocket: { connectedClients },
    rtp: {
      host: config.rtp.host,
      port: config.rtp.port,
      codec: config.rtp.codec,
      bitrate: config.rtp.bitrate,
    },
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// GET /history
// ---------------------------------------------------------------------------

/**
 * GET /history
 * Gibt die letzten Alarmierungen zurück.
 *
 * Query:
 *   limit {number} – Optional. Anzahl Einträge (1–100). Default: 50.
 *
 * Response:
 *   { ok: true, total, limit, history: [...] }
 */
router.get('/history', [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('limit muss zwischen 1 und 100 liegen'),
], (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        ok: false,
        errors: errors.array(),
      });
    }

    const limit = parseInt(req.query.limit, 10) || 50;
    const history = AlarmService.getInstance().getHistory(limit);

    res.json({
      ok: true,
      total: history.length,
      limit,
      history,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/**
 * Formatiert Sekunden als lesbare Zeitangabe.
 * @param {number} seconds
 * @returns {string}
 */
function _formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

module.exports = router;
