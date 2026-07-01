'use strict';

/**
 * @file routes/health.js
 * @description GET /health – Liveness/Readiness-Endpunkt.
 * Genutzt von Docker Healthcheck, systemd und Load Balancern.
 */

const { Router } = require('express');
const config = require('../config');

const router = Router();

/**
 * GET /health
 * Liefert den Serverstatus mit Uptime, Version und Umgebung.
 */
router.get('/', (req, res) => {
  const uptime = process.uptime();
  const mem = process.memoryUsage();

  res.json({
    ok: true,
    status: 'healthy',
    version: process.env.npm_package_version || '1.0.0',
    nodeEnv: config.server.nodeEnv,
    uptime: Math.floor(uptime),
    uptimeHuman: _formatUptime(uptime),
    memory: {
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      rssMB: Math.round(mem.rss / 1024 / 1024),
    },
    pid: process.pid,
    requestId: req.requestId,
  });
});

/**
 * Formatiert Sekunden in eine lesbare Zeitangabe.
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
