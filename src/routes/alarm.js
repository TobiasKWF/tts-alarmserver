'use strict';

/**
 * Route: POST /api/alarm
 *
 * Empfängt einen Alarmtext und startet die Verarbeitungs-Pipeline.
 * Antwort: 200 OK mit JSON-Ergebnis oder 4xx/5xx mit Fehlerbeschreibung.
 */

const express = require('express');
const router = express.Router();
const { processAlarm } = require('../services/alarmService');
const queue = require('../services/queueService');
const { generateRequestId } = require('../utils/requestId');
const { ensureTmpDir } = require('../utils/tempFiles');
const logger = require('../logging/logger');

/**
 * POST /api/alarm
 * Body: { "text": "<Alarmtext>" }  oder plain-text body
 */
router.post('/', async (req, res, next) => {
  const requestId = generateRequestId();
  let rawText = '';

  if (typeof req.body === 'string') {
    rawText = req.body;
  } else if (req.body && typeof req.body.text === 'string') {
    rawText = req.body.text;
  } else if (req.body && typeof req.body.alarmtext === 'string') {
    rawText = req.body.alarmtext;
  } else {
    return res.status(400).json({ error: 'Kein Alarmtext übergeben. Erwartet: { "text": "..." }', requestId });
  }

  rawText = rawText.trim();
  if (!rawText) {
    return res.status(400).json({ error: 'Alarmtext ist leer.', requestId });
  }

  logger.info(`[${requestId}] Alarm empfangen (${rawText.length} Zeichen)`);

  try {
    await ensureTmpDir();

    const result = await queue.enqueue(() => processAlarm(rawText, requestId));

    return res.status(200).json({
      requestId,
      success: true,
      cleanText: result.cleanText,
      spokenText: result.spokenText,
    });
  } catch (err) {
    if (err.statusCode === 429) {
      return res.status(429).json({ error: err.message, requestId });
    }
    logger.error(`[${requestId}] Fehler bei Alarmverarbeitung: ${err.message}`);
    next(err);
  }
});

module.exports = router;
