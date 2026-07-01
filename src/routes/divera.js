'use strict';

/**
 * @file routes/divera.js
 * @description POST /divera – Divera 24/7 Webhook-Empfang.
 * Empfängt Alarm-Webhooks von Divera 24/7 und leitet sie
 * als TTS-Alarmierung weiter.
 */

const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

const { AlarmService } = require('../services/alarmService');
const { ValidationError } = require('../errors');
const logger = require('../utils/logger').child({ service: 'DiveraRoute' });

const router = Router();

/** Rate-Limiter für Divera-Webhooks */
const diveraRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMIT_EXCEEDED', message: 'Zu viele Anfragen.' },
});

/**
 * POST /divera
 * Erwartet Divera-Webhook-Payload:
 * {
 *   title: string,        // Alarmtitel (z.B. "H1 - Türöffnung")
 *   text?: string,        // Alarmtext / Meldungstext
 *   address?: string,     // Einsatzort
 *   keywords?: string,    // Stichwort (z.B. "HH1", "F2")
 *   priority?: number,
 *   ucr_self_status_id?: number  // Divera-interner Status
 * }
 */
router.post(
  '/',
  diveraRateLimit,
  [
    body('title')
      .isString().withMessage('title muss ein String sein')
      .trim()
      .isLength({ min: 1, max: 500 }),
    body('text').optional().isString().trim().isLength({ max: 2000 }),
    body('address').optional().isString().trim().isLength({ max: 500 }),
    body('keywords').optional().isString().trim().isLength({ max: 200 }),
    body('priority').optional().isInt({ min: 1, max: 10 }),
  ],
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ValidationError('Ungültiger Divera-Webhook', { fields: errors.array() }));
    }

    try {
      const { title, text, address, keywords, priority } = req.body;

      // TTS-Text aus Divera-Daten zusammenstellen
      const parts = [];

      if (keywords) parts.push(keywords);
      if (title) parts.push(title);
      if (address) parts.push(`Einsatzort: ${address}`);
      if (text && text !== title) parts.push(text);

      const ttsText = parts.join('. ');

      logger.info('Divera-Webhook empfangen', {
        title,
        keywords,
        address,
        requestId: req.requestId,
      });

      const alarmService = AlarmService.getInstance();
      const result = alarmService.receive({
        text: ttsText,
        priority: priority || 8, // Divera-Alarme haben standardmäßig hohe Priorität
        gong: true,
        normalize: true,
        source: 'divera',
        diveraTitle: title,
        diveraKeywords: keywords,
        diveraAddress: address,
        requestId: req.requestId,
      });

      return res.status(202).json({
        ok: true,
        message: 'Divera-Alarm angenommen',
        alarmId: result.id,
        queuePosition: result.position,
        text: ttsText,
      });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
