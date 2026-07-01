'use strict';

/**
 * @file routes/announce.js
 * @description POST /announce – Direkte TTS-Alarmierung.
 * Nimmt Text entgegen, reiht ihn in die Queue ein und antwortet mit HTTP 202.
 */

const { Router } = require('express');
const { body, validationResult } = require('express-validator');

const logger = require('../utils/logger').child({ service: 'Route:announce' });
const { AlarmService } = require('../services/alarmService');
const { ValidationError } = require('../errors');

const router = Router();

/**
 * POST /announce
 * Body: { text, voice?, priority?, gong? }
 */
router.post(
  '/',
  [
    body('text')
      .trim()
      .notEmpty().withMessage('text ist erforderlich')
      .isLength({ min: 1, max: 1000 }).withMessage('text muss zwischen 1 und 1000 Zeichen lang sein'),
    body('voice')
      .optional()
      .trim()
      .isLength({ min: 1, max: 100 }).withMessage('voice darf maximal 100 Zeichen lang sein'),
    body('priority')
      .optional()
      .isInt({ min: 1, max: 10 }).withMessage('priority muss eine Ganzzahl zwischen 1 und 10 sein'),
    body('gong')
      .optional()
      .trim()
      .matches(/^[a-zA-Z0-9_\-\.]+$/).withMessage('gong darf nur alphanumerische Zeichen, Binde- und Unterstriche enthalten'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Ungültige Anfrage', { fields: errors.array() });
      }

      const { text, voice, priority, gong } = req.body;
      const alarmService = AlarmService.getInstance();

      const result = alarmService.receive({
        text,
        voice,
        priority: priority ? parseInt(priority, 10) : undefined,
        gong,
        source: 'api',
        requestId: req.requestId,
      });

      logger.info('Alarm angenommen', {
        id: result.id,
        queuePosition: result.queuePosition,
        requestId: req.requestId,
      });

      res.status(202).json({
        ok: true,
        id: result.id,
        queued: result.queued,
        queuePosition: result.queuePosition,
        requestId: req.requestId,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
