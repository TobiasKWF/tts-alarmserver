'use strict';

/**
 * @file routes/divera.js
 * @description POST /api/divera – Divera 24/7 Webhook-Adapter.
 *
 * Empfängt Webhook-Calls von Divera 24/7 (direkt oder via Node-RED)
 * und wandelt sie in Alarmierungs-Payloads um, die in die Queue eingereiht werden.
 *
 * Der unveränderte Node-RED msg.payload wird entgegengenommen.
 * Felder title, text und address werden bereinigt verarbeitet:
 *   - title   → Einsatzstichwort (erste gesprochene Information)
 *   - text    → Einsatzbeschreibung (zweite Information)
 *   - address → Einsatzort inkl. optionalem Einsatzortzusatz (OG 2, EG, Tor 3 …)
 *
 * Die Bereinigung und Sprachoptimierung übernimmt diveraAdapter.js.
 *
 * Divera Webhook-Dokumentation:
 *   https://api.divera247.com/#tag/Alarmierung/operation/postAlarm
 *
 * Vorab-Gong Konfiguration:
 *   DIVERA_GONG=<gong-dateiname-ohne-.wav>  in .env
 *   Fallback: AUDIO_DEFAULT_GONG oder kein Gong (null)
 */

const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const logger = require('../utils/logger').child({ service: 'DiveraRoute' });
const { QueueService } = require('../services/queueService');
const eventBus = require('../events/eventBus');
const { ValidationError, QueueFullError } = require('../errors');
const config = require('../config');
const { adaptDiveraPayload } = require('../tts/diveraAdapter');

const router = Router();

// ---------------------------------------------------------------------------
// Divera Webhook-Validierung
// ---------------------------------------------------------------------------

/**
 * Divera sendet entweder ein flaches Objekt oder ein verschachteltes.
 * Wir prüfen nur Pflichtfelder die für die TTS-Ausgabe nötig sind.
 */
const diveraValidation = [
  // Mindestens title oder text muss vorhanden sein
  body('title')
    .optional()
    .isString().withMessage('title muss ein String sein')
    .isLength({ max: 500 }),

  body('text')
    .optional()
    .isString().withMessage('text muss ein String sein')
    .isLength({ max: 2000 }),

  body('address')
    .optional()
    .isString().withMessage('address muss ein String sein')
    .isLength({ max: 500 }),

  body('priority')
    .optional()
    .isInt({ min: 1, max: 10 }).withMessage('priority muss zwischen 1 und 10 liegen'),

  body('ucr_self_status_id')
    .optional()
    .isInt(),
];

// ---------------------------------------------------------------------------
// POST /api/divera
// ---------------------------------------------------------------------------

/**
 * POST /api/divera
 * Divera 24/7 Webhook-Empfänger.
 *
 * Akzeptiert den unveränderten Node-RED msg.payload aus dem Divera-Webhook.
 * Extrahiert Einsatzart (title), Einsatztext (text) und Adresse (address),
 * bereinigt und optimiert den Text für TTS und reiht ihn in die Queue ein.
 *
 * Body (Divera / Node-RED msg.payload Format):
 *   title       {string} – Einsatzart/Stichwort
 *   text        {string} – Einsatzbeschreibung
 *   address     {string} – Einsatzadresse (kann Einsatzortzusatz enthalten)
 *   priority    {number} – Optionale Queue-Priorität (1–10)
 *
 * Response 202:
 *   { ok: true, alarmId, position, message, spokenText }
 */
router.post('/', diveraValidation, (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const details = errors.array().reduce((acc, e) => { acc[e.path] = e.msg; return acc; }, {});
      throw new ValidationError('Ungültige Divera-Webhook-Daten', details);
    }

    const { title, text, address, priority } = req.body;

    // Mindestens title oder text muss vorhanden sein
    if (!title && !text) {
      throw new ValidationError(
        'Divera-Webhook muss mindestens title oder text enthalten',
        { title: 'Fehlt', text: 'Fehlt' }
      );
    }

    // TTS-Text über diveraAdapter bereinigt aufbereiten
    const spokenText = adaptDiveraPayload({ title, text, address });
    const alarmId = uuidv4();

    // Vorab-Gong: config.divera.gong → config.audio.defaultGong → null
    const gong = (config.divera && config.divera.gong)
      ? config.divera.gong
      : (config.audio && config.audio.defaultGong)
        ? config.audio.defaultGong
        : null;

    logger.info('Divera-Webhook empfangen', {
      alarmId,
      requestId: req.requestId,
      title,
      address,
      gong: gong || '(kein Gong)',
      spokenText: spokenText.slice(0, 120),
    });

    const payload = {
      id: alarmId,
      requestId: req.requestId,
      text: spokenText,
      voice: config.piper.defaultVoice,
      speed: config.piper.speed,
      volume: config.piper.volume,
      gong,
      rtpHost: config.rtp.host,
      rtpPort: config.rtp.port,
      source: 'divera',
      diveraData: { title, text, address },
    };

    eventBus.emit('alarm.received', {
      alarmId,
      requestId: req.requestId,
      text: spokenText,
      source: 'divera',
      priority: priority || config.queue.defaultPriority,
    });

    const queueService = QueueService.getInstance();
    const { id, position } = queueService.enqueue(
      payload,
      priority || config.queue.defaultPriority
    );

    logger.info('Divera-Alarm eingereiht', {
      alarmId: id,
      position,
      spokenText: spokenText.slice(0, 100),
    });

    res.status(202).json({
      ok: true,
      alarmId: id,
      position,
      spokenText,
      message: `Divera-Alarm in Queue eingereiht (Position ${position})`,
    });
  } catch (err) {
    if (err.code === 'QUEUE_FULL') return next(new QueueFullError(config.queue.maxSize));
    next(err);
  }
});

module.exports = router;
