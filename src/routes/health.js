'use strict';

/**
 * @file routes/health.js
 * @description GET /health – Liveness- und Readiness-Probe.
 *
 * Wird von Docker-Healthcheck, Kubernetes-Probes und Load-Balancern genutzt.
 * Antwortet immer schnell ohne schwere Service-Initialisierung.
 *
 * /health         – Liveness:  Ist der Prozess noch am Leben?
 * /health/ready   – Readiness: Sind alle Services betriebsbereit?
 */

const { Router } = require('express');
const { QueueService } = require('../services/queueService');
const logger = require('../utils/logger').child({ service: 'HealthRoute' });

const router = Router();
const startTime = Date.now();

// ---------------------------------------------------------------------------
// GET /health  (Liveness)
// ---------------------------------------------------------------------------

/**
 * GET /health
 * Liveness-Probe – prüft nur ob der Node-Prozess antwortet.
 * Kein Service-Check, kein DB-Check – maximale Performance.
 *
 * Response 200:
 *   { ok: true, status: "up", uptime, timestamp }
 */
router.get('/', (_req, res) => {
  res.status(200).json({
    ok: true,
    status: 'up',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// GET /health/ready  (Readiness)
// ---------------------------------------------------------------------------

/**
 * GET /health/ready
 * Readiness-Probe – prüft ob alle kritischen Services bereit sind.
 * Gibt 503 zurück wenn die Queue nicht läuft.
 *
 * Response 200:
 *   { ok: true, status: "ready", checks: { queue: "ok" }, uptime, timestamp }
 *
 * Response 503:
 *   { ok: false, status: "not_ready", checks: { queue: "error" }, ... }
 */
router.get('/ready', (req, res) => {
  const checks = {};
  let allOk = true;

  try {
    const queueService = QueueService.getInstance();
    const stats = queueService.getStats();
    checks.queue = stats.running ? 'ok' : 'paused';
  } catch (err) {
    checks.queue = 'error';
    allOk = false;
    logger.warn('Readiness-Check: Queue-Fehler', { error: err.message });
  }

  const statusCode = allOk ? 200 : 503;

  res.status(statusCode).json({
    ok: allOk,
    status: allOk ? 'ready' : 'not_ready',
    checks,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
