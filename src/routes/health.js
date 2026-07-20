'use strict';

/**
 * @file routes/health.js
 * @description GET /api/health – Liveness- und Readiness-Probe.
 */

const { Router } = require('express');
const queueService = require('../services/queueService');
const logger       = require('../utils/logger').child({ service: 'HealthRoute' });

const router    = Router();
const startTime = Date.now();

// GET /api/health  – Liveness
router.get('/', (_req, res) => {
  res.status(200).json({
    ok:        true,
    status:    'up',
    uptime:    Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  });
});

// GET /api/health/ready  – Readiness
router.get('/ready', (_req, res) => {
  const checks = {};
  let allOk = true;

  try {
    const qs = queueService.status();
    checks.queue = (typeof qs.running === 'number') ? 'ok' : 'paused';
  } catch (err) {
    checks.queue = 'error';
    allOk = false;
    logger.warn('Readiness-Check: Queue-Fehler', { error: err.message });
  }

  res.status(allOk ? 200 : 503).json({
    ok:        allOk,
    status:    allOk ? 'ready' : 'not_ready',
    checks,
    uptime:    Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
