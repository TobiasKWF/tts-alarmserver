'use strict';

/**
 * @file routes/divera.js
 * @description POST /api/divera – Divera 24/7 Webhook-Adapter.
 */

const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const logger            = require('../utils/logger').child({ service: 'DiveraRoute' });
const queueService      = require('../services/queueService');
const { processAlarm }  = require('../services/alarmService');
const eventBus          = require('../events/eventBus');
const { ValidationError, QueueFullError } = require('../errors');
const config            = require('../config');
const { adaptDiveraPayload } = require('../tts/diveraAdapter');

const router = Router();

const diveraValidation = [
  body('title').optional().isString().isLength({ max: 500 }),
  body('text').optional().isString().isLength({ max: 2000 }),
  body('address').optional().isString().isLength({ max: 500 }),
  body('priority').optional().isInt({ min: 1, max: 10 }),
  body('ucr_self_status_id').optional().isInt(),
];

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
    const alarmId    = uuidv4();
    const prio       = priority || config.queue.defaultPriority;

    logger.info('Divera-Webhook empfangen', {
      alarmId,
      requestId: req.requestId,
      title,
      address,
      spokenText: spokenText.slice(0, 120),
    });

    eventBus.emit('alarm.received', {
      alarmId,
      requestId: req.requestId,
      text: spokenText,
      source: 'divera',
      priority: prio,
    });

    // Alarm asynchron über Queue verarbeiten (TTS + RTP + DashboardState)
    queueService.enqueue(
      () => processAlarm(spokenText, alarmId),
      { id: alarmId, priority: prio, source: 'divera', text: spokenText }
    ).catch(err => {
      logger.error('Divera Queue-Fehler', { alarmId, error: err.message });
    });

    res.status(202).json({
      ok: true,
      alarmId,
      position: queueService.status().waiting,
      spokenText,
      message: 'Divera-Alarm in Queue eingereiht',
    });

  } catch (err) {
    if (err.code === 'QUEUE_FULL') return next(new QueueFullError(config.queue.maxSize));
    next(err);
  }
});

module.exports = router;
