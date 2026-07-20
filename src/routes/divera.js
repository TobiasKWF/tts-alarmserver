'use strict';

/**
 * @file routes/divera.js
 * @description POST /api/divera – Divera 24/7 Webhook-Adapter.
 */

const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const logger = require('../utils/logger').child({ service: 'DiveraRoute' });
const queueService = require('../services/queueService');
const eventBus = require('../events/eventBus');
const { ValidationError, QueueFullError } = require('../errors');
const config = require('../config');
const { adaptDiveraPayload } = require('../tts/diveraAdapter');

const router = Router();

// ---------------------------------------------------------------------------
// Divera Webhook-Validierung
// ---------------------------------------------------------------------------

const diveraValidation = [
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

router.post('/', diveraValidation, (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const details = errors.array().reduce((acc, e) => { acc[e.path] = e.msg; return acc; }, {});
      throw new ValidationError('Ungültige Divera-Webhook-Daten', details);
    }

    const { title, text, address, priority } = req.body;

    if (!title && !text) {
      throw new ValidationError(
        'Divera-Webhook muss mindestens title oder text enthalten',
        { title: 'Fehlt', text: 'Fehlt' }
      );
    }

    const spokenText = adaptDiveraPayload({ title, text, address });
    const alarmId = uuidv4();

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

    const prio = priority || config.queue.defaultPriority;

    queueService.enqueue(
      () => Promise.resolve(payload),
      { id: alarmId, priority: prio, source: 'divera', text: spokenText }
    ).then(({ }) => {
      // position not available from AlarmQueue – use queue status
      const position = queueService.status().waiting + 1;

      logger.info('Divera-Alarm eingereiht', {
        alarmId,
        spokenText: spokenText.slice(0, 100),
      });

      res.status(202).json({
        ok: true,
        alarmId,
        position,
        spokenText,
        message: `Divera-Alarm in Queue eingereiht (Position ${position})`,
      });
    }).catch(err => {
      if (err.statusCode === 429) return next(new QueueFullError(config.queue.maxSize));
      next(err);
    });

  } catch (err) {
    if (err.code === 'QUEUE_FULL') return next(new QueueFullError(config.queue.maxSize));
    next(err);
  }
});

module.exports = router;
