'use strict';

/**
 * @file routes/announce.js
 * @description POST /announce – Manuelle TTS-Durchsage.
 *              POST /announce/fanfare – Direktes Abspielen einer Audiodatei.
 */

const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const logger           = require('../utils/logger').child({ service: 'AnnounceRoute' });
const queueService     = require('../services/queueService');
const { processAlarm } = require('../services/alarmService');
const eventBus         = require('../events/eventBus');
const { ValidationError, QueueFullError } = require('../errors');
const config           = require('../config');

const router = Router();

const announceValidation = [
  body('text').isString().trim().notEmpty().isLength({ max: 2000 }),
  body('priority').optional().isInt({ min: 1, max: 10 }),
  body('voice').optional().isString().isLength({ max: 200 }),
  body('speed').optional().isFloat({ min: 0.5, max: 2.0 }),
  body('volume').optional().isInt({ min: 0, max: 100 }),
  body('gong').optional().isString().isLength({ max: 200 }),
  body('rtpHost').optional().isString(),
  body('rtpPort').optional().isInt({ min: 1, max: 65535 }),
];

// ---------------------------------------------------------------------------
// POST /announce
// ---------------------------------------------------------------------------

router.post('/', announceValidation, (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const details = errors.array().reduce((acc, e) => { acc[e.path] = e.msg; return acc; }, {});
      throw new ValidationError('Ungültige Anfrageparameter', details);
    }

    const { text, priority } = req.body;
    const alarmId = uuidv4();
    const prio    = priority || config.queue.defaultPriority;

    eventBus.emit('alarm.received', {
      alarmId,
      requestId: req.requestId,
      text,
      source: 'announce',
      priority: prio,
    });

    // Text über processAlarm – TTS + RTP + DashboardState
    queueService.enqueue(
      () => processAlarm(text, alarmId),
      { id: alarmId, priority: prio, source: 'announce', text }
    ).catch(err => {
      logger.error('Announce Queue-Fehler', { alarmId, error: err.message });
    });

    logger.info('Durchsage eingereiht', { alarmId, text: text.slice(0, 80) });

    res.status(202).json({
      ok: true,
      alarmId,
      position: queueService.status().waiting,
      message: 'Durchsage in Queue eingereiht',
    });

  } catch (err) {
    if (err.code === 'QUEUE_FULL') return next(new QueueFullError(config.queue.maxSize));
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /announce/fanfare
// ---------------------------------------------------------------------------

router.post('/fanfare', [
  body('file').isString().trim().notEmpty().isLength({ max: 200 }),
  body('priority').optional().isInt({ min: 1, max: 10 }),
  body('rtpHost').optional().isString(),
  body('rtpPort').optional().isInt({ min: 1, max: 65535 }),
], (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const details = errors.array().reduce((acc, e) => { acc[e.path] = e.msg; return acc; }, {});
      throw new ValidationError('Ungültige Anfrageparameter', details);
    }

    const { file, priority, rtpHost, rtpPort } = req.body;
    const alarmId = uuidv4();
    const prio    = priority || config.queue.defaultPriority;

    eventBus.emit('alarm.received', {
      alarmId,
      requestId: req.requestId,
      text: `[Fanfare: ${file}]`,
      source: 'fanfare',
      priority: prio,
    });

    // Fanfare als leeren Text mit Gong über processAlarm
    queueService.enqueue(
      () => processAlarm('', alarmId, { gong: file, fanfareOnly: true, rtpHost, rtpPort }),
      { id: alarmId, priority: prio, source: 'fanfare', text: `[Fanfare: ${file}]` }
    ).catch(err => {
      logger.error('Fanfare Queue-Fehler', { alarmId, error: err.message });
    });

    logger.info('Fanfare eingereiht', { alarmId, file });

    res.status(202).json({
      ok: true,
      alarmId,
      position: queueService.status().waiting,
      message: `Fanfare "${file}" in Queue eingereiht`,
    });

  } catch (err) {
    if (err.code === 'QUEUE_FULL') return next(new QueueFullError(config.queue.maxSize));
    next(err);
  }
});

module.exports = router;
