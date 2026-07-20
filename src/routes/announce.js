'use strict';

/**
 * @file routes/announce.js
 * @description POST /announce       – Manuelle TTS-Durchsage.
 *              POST /announce/fanfare – Direktes Abspielen einer Audiodatei.
 */

const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const logger                          = require('../utils/logger').child({ service: 'AnnounceRoute' });
const queueService                    = require('../services/queueService');
const { processAlarm, streamFanfare } = require('../services/alarmService');
const eventBus                        = require('../events/eventBus');
const { ValidationError, QueueFullError } = require('../errors');
const config                          = require('../config');

const router = Router();

// ---------------------------------------------------------------------------
// POST /announce  – TTS-Durchsage
// ---------------------------------------------------------------------------

router.post('/', [
  body('text').isString().trim().notEmpty().isLength({ max: 2000 }),
  body('priority').optional().isInt({ min: 1, max: 10 }),
], (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const details = errors.array().reduce((acc, e) => { acc[e.path] = e.msg; return acc; }, {});
      throw new ValidationError('Ungültige Anfrageparameter', details);
    }

    const { text, priority } = req.body;
    const alarmId = uuidv4();
    const prio    = priority || config.queue.defaultPriority;

    eventBus.emit('alarm.received', { alarmId, requestId: req.requestId, text, source: 'announce', priority: prio });

    queueService.enqueue(
      () => processAlarm(text, alarmId),
      { id: alarmId, priority: prio, source: 'announce', text }
    ).catch(err => logger.error('Announce Queue-Fehler', { alarmId, error: err.message }));

    logger.info('Durchsage eingereiht', { alarmId, text: text.slice(0, 80) });

    res.status(202).json({
      ok: true, alarmId,
      position: queueService.status().waiting,
      message: 'Durchsage in Queue eingereiht',
    });
  } catch (err) {
    if (err.code === 'QUEUE_FULL') return next(new QueueFullError(config.queue.maxSize));
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /announce/fanfare  – Audiodatei direkt streamen (kein TTS)
// ---------------------------------------------------------------------------

router.post('/fanfare', [
  body('file').isString().trim().notEmpty().isLength({ max: 200 }),
  body('priority').optional().isInt({ min: 1, max: 10 }),
], (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const details = errors.array().reduce((acc, e) => { acc[e.path] = e.msg; return acc; }, {});
      throw new ValidationError('Ungültige Anfrageparameter', details);
    }

    const { file, priority } = req.body;
    const alarmId = uuidv4();
    const prio    = priority || config.queue.defaultPriority;

    eventBus.emit('alarm.received', {
      alarmId, requestId: req.requestId,
      text: `[Fanfare: ${file}]`, source: 'fanfare', priority: prio,
    });

    // streamFanfare – kein TTS, direkt WAV → RTP
    queueService.enqueue(
      () => streamFanfare(file, alarmId),
      { id: alarmId, priority: prio, source: 'fanfare', text: `[Fanfare: ${file}]` }
    ).catch(err => logger.error('Fanfare Queue-Fehler', { alarmId, error: err.message }));

    logger.info('Fanfare eingereiht', { alarmId, file });

    res.status(202).json({
      ok: true, alarmId,
      position: queueService.status().waiting,
      message: `Fanfare "${file}" in Queue eingereiht`,
    });
  } catch (err) {
    if (err.code === 'QUEUE_FULL') return next(new QueueFullError(config.queue.maxSize));
    next(err);
  }
});

module.exports = router;
