'use strict';

/**
 * @file routes/announce.js
 * @description POST /announce – Manuelle TTS-Alarmierung.
 *              POST /announce/fanfare – Direktes Abspielen einer Audiodatei.
 */

const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const logger       = require('../utils/logger').child({ service: 'AnnounceRoute' });
const queueService = require('../services/queueService');
const eventBus     = require('../events/eventBus');
const { ValidationError, QueueFullError } = require('../errors');
const config       = require('../config');

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
    .isLength({ max: 200 }),

  body('speed')
    .optional()
    .isFloat({ min: 0.5, max: 2.0 }).withMessage('speed muss zwischen 0.5 und 2.0 liegen'),

  body('volume')
    .optional()
    .isInt({ min: 0, max: 100 }).withMessage('volume muss zwischen 0 und 100 liegen'),

  body('gong')
    .optional()
    .isString().withMessage('gong muss ein String sein')
    .isLength({ max: 200 }),

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

    const alarmId = uuidv4();
    const { text, priority, voice, speed, volume, gong, rtpHost, rtpPort } = req.body;
    const prio = priority || config.queue.defaultPriority;

    const payload = {
      id: alarmId,
      requestId: req.requestId,
      text,
      voice:   voice   || config.piper.defaultVoice,
      speed:   speed   || config.piper.speed,
      volume:  volume  !== undefined ? volume : config.piper.volume,
      gong:    gong    || null,
      rtpHost: rtpHost || config.rtp.host,
      rtpPort: rtpPort || config.rtp.port,
    };

    eventBus.emit('alarm.received', {
      alarmId,
      requestId: req.requestId,
      text,
      priority: prio,
    });

    queueService.enqueue(
      () => Promise.resolve(payload),
      { id: alarmId, priority: prio, source: 'announce', text }
    ).then(() => {
      const position = queueService.status().waiting + 1;
      logger.info('Alarmierung angenommen', { alarmId, requestId: req.requestId, position, text: text.slice(0, 80) });
      res.status(202).json({
        ok: true,
        alarmId,
        position,
        message: `Alarmierung in Queue eingereiht (Position ${position})`,
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

// ---------------------------------------------------------------------------
// POST /announce/fanfare
// ---------------------------------------------------------------------------

router.post('/fanfare', [
  body('file')
    .isString().withMessage('file muss ein String sein')
    .trim()
    .notEmpty().withMessage('file darf nicht leer sein')
    .isLength({ max: 200 }),

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

    const alarmId = uuidv4();
    const { file, priority, rtpHost, rtpPort } = req.body;
    const prio = priority || config.queue.defaultPriority;

    const payload = {
      id: alarmId,
      requestId: req.requestId,
      text: '',
      fanfareFile: file,
      gong: file,
      voice:   config.piper.defaultVoice,
      speed:   config.piper.speed,
      volume:  config.piper.volume,
      rtpHost: rtpHost || config.rtp.host,
      rtpPort: rtpPort || config.rtp.port,
      fanfareOnly: true,
    };

    eventBus.emit('alarm.received', {
      alarmId,
      requestId: req.requestId,
      text: `[Fanfare: ${file}]`,
      priority: prio,
    });

    queueService.enqueue(
      () => Promise.resolve(payload),
      { id: alarmId, priority: prio, source: 'fanfare', text: `[Fanfare: ${file}]` }
    ).then(() => {
      const position = queueService.status().waiting + 1;
      logger.info('Fanfare eingereiht', { alarmId, file, position });
      res.status(202).json({
        ok: true,
        alarmId,
        position,
        message: `Fanfare in Queue eingereiht (Position ${position})`,
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
