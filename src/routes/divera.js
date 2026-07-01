'use strict';

/**
 * @file routes/divera.js
 * @description POST /divera – Divera 24/7 Webhook-Adapter.
 *
 * Empfängt Webhook-Calls von Divera 24/7 und wandelt sie in
 * Alarmierungs-Payloads um, die in die Queue eingereiht werden.
 *
 * Divera sendet bei einem Alarm ein JSON-Objekt mit Einsatzdaten.
 * Dieser Adapter extrahiert die relevanten Felder und erstellt
 * einen TTS-Text, der über die Standard-Announce-Pipeline verarbeitet wird.
 *
 * Divera Webhook-Dokumentation:
 *   https://api.divera247.com/#tag/Alarmierung/operation/postAlarm
 */

const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');

const logger = require('../utils/logger').child({ service: 'DiveraRoute' });
const { QueueService } = require('../services/queueService');
const eventBus = require('../events/eventBus');
const { ValidationError, QueueFullError } = require('../errors');
const config = require('../config');

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
// POST /divera
// ---------------------------------------------------------------------------

/**
 * POST /divera
 * Divera 24/7 Webhook-Empfänger.
 *
 * Erwartet JSON-Body aus dem Divera-Webhook.
 * Extrahiert Einsatzart (title), Einsatztext (text) und Adresse (address)
 * und erstellt daraus einen sprechbaren TTS-Text.
 *
 * Body (Divera-Format):
 *   title       {string} – Einsatzart/Stichwort
 *   text        {string} – Einsatzbeschreibung
 *   address     {string} – Einsatzadresse
 *   priority    {number} – Optionale Queue-Priorität (1–10)
 *
 * Response 202:
 *   { ok: true, alarmId, position, message }
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

    // TTS-Text aus Divera-Feldern zusammenbauen
    const ttsText = _buildDiveraTtsText({ title, text, address });
    const alarmId = uuidv4();

    logger.info('Divera-Webhook empfangen', {
      alarmId,
      requestId: req.requestId,
      title,
      address,
      textLength: text ? text.length : 0,
    });

    const payload = {
      id: alarmId,
      requestId: req.requestId,
      text: ttsText,
      voice: config.piper.defaultVoice,
      speed: config.piper.speed,
      volume: config.piper.volume,
      gong: null,           // Kein Standard-Gong – kann per Konfiguration ergänzt werden
      rtpHost: config.rtp.host,
      rtpPort: config.rtp.port,
      source: 'divera',
      diveraData: { title, text, address },
    };

    eventBus.emit('alarm.received', {
      alarmId,
      requestId: req.requestId,
      text: ttsText,
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
      ttsText: ttsText.slice(0, 100),
    });

    res.status(202).json({
      ok: true,
      alarmId: id,
      position,
      message: `Divera-Alarm in Queue eingereiht (Position ${position})`,
    });
  } catch (err) {
    if (err.code === 'QUEUE_FULL') return next(new QueueFullError(config.queue.maxSize));
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/**
 * Baut einen sprechbaren TTS-Text aus den Divera-Feldern zusammen.
 *
 * Reihenfolge der Ausgabe:
 *   1. Alarmierung! (Einleitung)
 *   2. Einsatzart/Stichwort (title)
 *   3. Einsatzbeschreibung (text)
 *   4. Einsatzadresse (address)
 *
 * @param {object} opts
 * @param {string|undefined} opts.title
 * @param {string|undefined} opts.text
 * @param {string|undefined} opts.address
 * @returns {string}
 */
function _buildDiveraTtsText({ title, text, address }) {
  const parts = ['Alarmierung!'];

  if (title) {
    parts.push(title.trim());
  }

  if (text) {
    parts.push(text.trim());
  }

  if (address) {
    parts.push(`Einsatzort: ${address.trim()}`);
  }

  return parts.join(' ');
}

module.exports = router;
