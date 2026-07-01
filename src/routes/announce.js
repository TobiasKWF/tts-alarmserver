'use strict';

/**
 * @file routes/announce.js
 * @description POST /announce – Direkter TTS-Alarm.
 * POST /play-fanfare – Fanfare abspielen.
 * GET  /history     – Alarmhistorie.
 */

const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const { AlarmService } = require('../services/alarmService');
const HistoryService = require('../services/historyService');
const { ValidationError } = require('../errors');
const config = require('../config');
const logger = require('../utils/logger').child({ service: 'AnnounceRoute' });
const path = require('path');
const fs = require('fs');

const router = Router();

/** Rate-Limiter: max. 30 Alarmierungen pro Minute */
const alarmRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMIT_EXCEEDED', message: 'Zu viele Anfragen. Bitte warten.' },
});

/**
 * POST /announce
 * Körper: { text, voice?, priority?, speed?, volume?, gong?, normalize? }
 * Antwort: 202 Accepted mit Alarm-ID und Queue-Position
 */
router.post(
  '/',
  alarmRateLimit,
  [
    body('text')
      .isString().withMessage('text muss ein String sein')
      .trim()
      .isLength({ min: 1, max: 2000 }).withMessage('text muss zwischen 1 und 2000 Zeichen lang sein'),
    body('voice')
      .optional()
      .isString().withMessage('voice muss ein String sein')
      .trim()
      .isLength({ min: 1, max: 100 }),
    body('priority')
      .optional()
      .isInt({ min: 1, max: 10 }).withMessage('priority muss eine Zahl zwischen 1 und 10 sein'),
    body('speed')
      .optional()
      .isFloat({ min: 0.5, max: 2.0 }).withMessage('speed muss zwischen 0.5 und 2.0 liegen'),
    body('volume')
      .optional()
      .isInt({ min: 0, max: 100 }).withMessage('volume muss zwischen 0 und 100 liegen'),
    body('gong')
      .optional()
      .isBoolean().withMessage('gong muss ein Boolean sein'),
    body('normalize')
      .optional()
      .isBoolean().withMessage('normalize muss ein Boolean sein'),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ValidationError('Ungültige Anfrage', { fields: errors.array() }));
    }

    try {
      const alarmService = AlarmService.getInstance();
      const result = alarmService.receive({
        ...req.body,
        source: 'api',
        requestId: req.requestId,
      });

      logger.info('Alarm über /announce angenommen', {
        alarmId: result.id,
        requestId: req.requestId,
        queueSize: result.queueSize,
      });

      return res.status(202).json({
        ok: true,
        message: 'Alarm in Warteschlange eingereiht',
        alarmId: result.id,
        queuePosition: result.position,
        queueSize: result.queueSize,
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * POST /play-fanfare
 * Körper: { file?, volume? }
 * Spielt eine Fanfare-Datei aus dem gong-Verzeichnis ab.
 */
router.post(
  '/play-fanfare',
  alarmRateLimit,
  [
    body('file').optional().isString().trim().isLength({ min: 1, max: 100 }),
    body('volume').optional().isInt({ min: 0, max: 100 }),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ValidationError('Ungültige Anfrage', { fields: errors.array() }));
    }

    try {
      const fanfareFile = req.body.file || 'fanfare.wav';
      const gongDir = config.audio.gongDir;
      const fullPath = path.resolve(gongDir, fanfareFile);

      // Path-Traversal-Schutz: Datei muss im gong-Verzeichnis liegen
      if (!fullPath.startsWith(path.resolve(gongDir))) {
        return next(new ValidationError('Ungültiger Dateipfad'));
      }

      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({
          ok: false,
          error: 'FILE_NOT_FOUND',
          message: `Fanfare-Datei nicht gefunden: ${fanfareFile}`,
        });
      }

      const alarmService = AlarmService.getInstance();
      const result = alarmService.receive({
        text: '',
        gong: false,
        normalize: false,
        source: 'fanfare',
        fanfareFile: fullPath,
        volume: req.body.volume || config.piper.volume,
        priority: 8,
        requestId: req.requestId,
      });

      return res.status(202).json({
        ok: true,
        message: 'Fanfare wird abgespielt',
        alarmId: result.id,
      });
    } catch (err) {
      return next(err);
    }
  }
);

/**
 * GET /history
 * Gibt die Alarmhistorie zurück.
 */
router.get('/history', (req, res) => {
  res.json({
    ok: true,
    history: HistoryService.getAll(),
    stats: HistoryService.getStats(),
  });
});

module.exports = router;
