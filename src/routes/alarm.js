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
const historyService = require('../services/historyService');
const DashboardState = require('../services/dashboardState');
const logger = require('../logging/logger');

/**
 * POST /api/alarm/repeat-last
 * Spielt die letzte erfolgreich verarbeitete Alarmierung erneut ab.
 */
router.post('/repeat-last', async (req, res, next) => {
  const history = DashboardState.getInstance().history;
  const fallbackHistory = history.length > 0 ? history : historyService.getLast(50);
  const lastAlarm = fallbackHistory.find(entry =>
    entry.source === 'alarm' && entry.success !== false && typeof entry.rawText === 'string' && entry.rawText.trim()
  );

  if (!lastAlarm) {
    return res.status(404).json({ error: 'Keine wiederholbare Alarmierung vorhanden.' });
  }

  const requestId = generateRequestId();

  try {
    await ensureTmpDir();
    await queue.enqueue(() => processAlarm(lastAlarm.rawText, requestId), {
      id: requestId,
      priority: 1,
      source: 'alarm-repeat',
      text: lastAlarm.text || lastAlarm.rawText,
    });

    logger.info(`[${requestId}] Letzte Alarmierung erneut eingereiht`, {
      originalAlarmId: lastAlarm.alarmId,
    });

    return res.status(202).json({
      requestId,
      success: true,
      message: 'Letzte Alarmierung wurde zur Wiedergabe eingereiht.',
      originalAlarmId: lastAlarm.alarmId,
    });
  } catch (err) {
    logger.error(`[${requestId}] Fehler beim Wiederholen der letzten Alarmierung: ${err.message}`);
    next(err);
  }
});

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
