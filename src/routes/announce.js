'use strict';

/**
 * @file routes/announce.js
 * @description POST /announce – Manuelle TTS-Alarmierung.
 *
 * Nimmt einen Text entgegen, enqueued ihn mit optionaler Priorität
 * und antwortet sofort mit HTTP 202 (Accepted).
 * Die eigentliche Verarbeitung erfolgt asynchron über die Queue.
 */

const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const logger = require('../utils/logger').child({ service: 'AnnounceRoute' });
const { QueueService } = require('../services/queueService');
const { AlarmService } = require('../services/alarmService');
const eventBus = require('../events/eventBus');
const { ValidationError, QueueFullError } = require('../errors');
const config = require('../config');

const router = Router();

// ---------------------------------------------------------------------------
// Validierungsregeln
// ---------------------------------------------------------------------------

const announceValidation = [
  body('text')
    .isString().withMessage('text muss ein String sein')
    .trim()
    .notEmpty().withMessage('text darf nicht leer sein')
    .isLength({ max: 2000 }).withMessage('text darf maximal 2000 Zeichen lang sein'),

  body('priority')
    .optional()
    .isInt({ min: 1, max: 10 }).withMessage('priority muss eine Ganzzahl zwischen 1 und 10 sein'),

  body('voice')
    .optional()
    .isString().withMessage('voice muss ein String sein')
    .isLength({ max: 200 }).withMessage('voice darf maximal 200 Zeichen lang sein'),

  body('speed')
    .optional()
    .isFloat({ min: 0.5, max: 2.0 }).withMessage('speed muss zwischen 0.5 und 2.0 liegen'),

  body('volume')
    .optional()
    .isInt({ min: 0, max: 100 }).withMessage('volume muss zwischen 0 und 100 liegen'),

  body('gong')
    .optional()
    .isString().withMessage('gong muss ein String sein')
    .isLength({ max: 200 }).withMessage('gong darf maximal 200 Zeichen lang sein'),

  body('rtpHost')
    .optional()
    .isString().withMessage('rtpHost muss ein String sein'),

  body('rtpPort')
    .optional()
    .isInt({ min: 1, max: 65535 }).withMessage('rtpPort muss zwischen 1 und 65535 liegen'),
];

// ---------------------------------------------------------------------------
// POST /announce
// ---------------------------------------------------------------------------

/**
 * POST /announce
 * Enqueued eine neue TTS-Alarmierung.
 *
 * Body:
 *   text        {string}  – Pflicht. Zu sprechender Text.
 *   priority    {number}  – Optional. 1 (höchste) bis 10 (niedrigste). Default: 5
 *   voice       {string}  – Optional. Piper-Stimme (override).
 *   speed       {number}  – Optional. Sprechgeschwindigkeit 0.5–2.0.
 *   volume      {number}  – Optional. Lautstärke 0–100.
 *   gong        {string}  – Optional. Gong-Dateiname (aus gong/ Verzeichnis).
 *   rtpHost     {string}  – Optional. RTP-Zieladresse (override).
 *   rtpPort     {number}  – Optional. RTP-Zielport (override).
 *
 * Response 202:
 *   { ok: true, alarmId, position, message }
 *
 * Response 400:
 *   { error, code, message, details }
 *
 * Response 429:
 *   { error, code, message } – Queue voll
 */
router.post('/', announceValidation, (req, res, next) => {
  try {
    // Validierungsergebnis prüfen
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const details = errors.array().reduce((acc, e) => {
        acc[e.path] = e.msg;
        return acc;
      }, {});
      throw new ValidationError('Ungültige Anfrageparameter', details);
    }

    const alarmId = uuidv4();
    const { text, priority, voice, speed, volume, gong, rtpHost, rtpPort } = req.body;

    const payload = {
      id: alarmId,
      requestId: req.requestId,
      text,
      voice: voice || config.piper.defaultVoice,
      speed: speed || config.piper.speed,
      volume: volume !== undefined ? volume : config.piper.volume,
      gong: gong || null,
      rtpHost: rtpHost || config.rtp.host,
      rtpPort: rtpPort || config.rtp.port,
    };

    // Event vor dem Einreihen emittieren
    eventBus.emit('alarm.received', {
      alarmId,
      requestId: req.requestId,
      text,
      priority: priority || config.queue.defaultPriority,
    });

    const queueService = QueueService.getInstance();
    const { id, position } = queueService.enqueue(payload, priority || config.queue.defaultPriority);

    logger.info('Alarmierung angenommen', {
      alarmId: id,
      requestId: req.requestId,
      position,
      text: text.slice(0, 80),
    });

    res.status(202).json({
      ok: true,
      alarmId: id,
      position,
      message: `Alarmierung in Queue eingereiht (Position ${position})`,
    });
  } catch (err) {
    // QUEUE_FULL in QueueFullError umwandeln
    if (err.code === 'QUEUE_FULL') {
      return next(new QueueFullError(config.queue.maxSize));
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /announce/fanfare
// ---------------------------------------------------------------------------

/**
 * POST /play-fanfare
 * Spielt eine Audiodatei (Fanfare/Gong) ohne TTS-Synthese direkt ab.
 *
 * Body:
 *   file        {string}  – Pflicht. Dateiname aus gong/ Verzeichnis.
 *   priority    {number}  – Optional. Queue-Priorität.
 *   rtpHost     {string}  – Optional. RTP-Override.
 *   rtpPort     {number}  – Optional. RTP-Override.
 */
router.post('/fanfare', [
  body('file')
    .isString().withMessage('file muss ein String sein')
    .trim()
    .notEmpty().withMessage('file darf nicht leer sein')
    .isLength({ max: 200 }).withMessage('file darf maximal 200 Zeichen lang sein'),

  body('priority')
    .optional()
    .isInt({ min: 1, max: 10 }).withMessage('priority muss zwischen 1 und 10 liegen'),

  body('rtpHost').optional().isString(),
  body('rtpPort').optional().isInt({ min: 1, max: 65535 }),
], (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const details = errors.array().reduce((acc, e) => { acc[e.path] = e.msg; return acc; }, {});
      throw new ValidationError('Ungültige Anfrageparameter', details);
    }

    const alarmId = uuidv4();
    const { file, priority, rtpHost, rtpPort } = req.body;

    // Fanfare wird als leerer Text mit Gong verarbeitet
    const payload = {
      id: alarmId,
      requestId: req.requestId,
      text: '',           // Kein TTS-Text
      fanfareFile: file,  // Direkt als Audiodatei streamen
      gong: file,
      voice: config.piper.defaultVoice,
      speed: config.piper.speed,
      volume: config.piper.volume,
      rtpHost: rtpHost || config.rtp.host,
      rtpPort: rtpPort || config.rtp.port,
      fanfareOnly: true,  // Flag für AlarmService: kein Piper-Aufruf
    };

    eventBus.emit('alarm.received', {
      alarmId,
      requestId: req.requestId,
      text: `[Fanfare: ${file}]`,
      priority: priority || config.queue.defaultPriority,
    });

    const queueService = QueueService.getInstance();
    const { id, position } = queueService.enqueue(payload, priority || config.queue.defaultPriority);

    logger.info('Fanfare eingereiht', { alarmId: id, file, position });

    res.status(202).json({
      ok: true,
      alarmId: id,
      position,
      message: `Fanfare in Queue eingereiht (Position ${position})`,
    });
  } catch (err) {
    if (err.code === 'QUEUE_FULL') return next(new QueueFullError(config.queue.maxSize));
    next(err);
  }
});

module.exports = router;
