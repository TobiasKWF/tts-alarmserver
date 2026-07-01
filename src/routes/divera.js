'use strict';

/**
 * @file routes/divera.js
 * @description POST /divera – Divera 24/7 Webhook-Endpunkt.
 * Verarbeitet eingehende Divera-Alarm-Webhooks und wandelt sie
 * in TTS-Alarmierungen um.
 */

const { Router } = require('express');
const { body, validationResult } = require('express-validator');

const logger = require('../utils/logger').child({ service: 'Route:divera' });
const { AlarmService } = require('../services/alarmService');
const { ValidationError } = require('../errors');

const router = Router();

/**
 * Baut den Ansagetext aus dem Divera-Payload auf.
 * @param {object} payload
 * @returns {string}
 */
function buildAnnouncement(payload) {
  const parts = [];

  if (payload.title) parts.push(payload.title);
  if (payload.text) parts.push(payload.text);
  if (payload.address) parts.push(`Adresse: ${payload.address}`);

  return parts.join('. ').trim() || 'Alarm ohne Beschreibung';
}

/**
 * POST /divera
 * Erwartet einen Divera 24/7 Webhook-Payload:
 * { title?, text?, address?, priority?, voice?, gong? }
 */
router.post(
  '/',
  [
    body('title').optional().trim().isLength({ max: 200 }),
    body('text').optional().trim().isLength({ max: 800 }),
    body('address').optional().trim().isLength({ max: 200 }),
    body('priority').optional().isInt({ min: 1, max: 10 }),
    body('voice').optional().trim().isLength({ max: 100 }),
    body('gong').optional().trim().matches(/^[a-zA-Z0-9_\-\.]+$/),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Ungültiger Divera-Payload', { fields: errors.array() });
      }

      const { title, text, address, priority, voice, gong } = req.body;

      if (!title && !text && !address) {
        throw new ValidationError('Divera-Payload muss mindestens title, text oder address enthalten');
      }

      const announcementText = buildAnnouncement({ title, text, address });
      const alarmService = AlarmService.getInstance();

      const result = alarmService.receive({
        text: announcementText,
        voice,
        priority: priority ? parseInt(priority, 10) : 1, // Divera-Alarme haben höchste Priorität
        gong,
        source: 'divera',
        requestId: req.requestId,
      });

      logger.info('Divera-Alarm empfangen', {
        id: result.id,
        title,
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
