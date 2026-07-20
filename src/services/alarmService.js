'use strict';

/**
 * Alarm-Service – Haupt-Orchestrierung.
 *
 * Ablauf:
 *   1. Rohen Alarmtext empfangen
 *   2. Alarmtext bereinigen (nur relevante Infos)
 *   3. Sprachoptimierung (Codes, Abkuerzungen, Zahlen)
 *   4. TTS: Text → WAV-Dateien
 *   5. Streaming: WAV → RTP
 *   6. Temporaere Dateien aufraeumen
 *   7. Alarmierung protokollieren
 *   8. DashboardState aktualisieren (v3.1)
 */

const { buildSpeechText }    = require('../tts/alarmCleaner');
const { enhanceSpeech }      = require('../tts/speechEnhancer');
const { textToWavFiles }     = require('./piperService');
const { processToRtp }       = require('./ffmpegService');
const { streamRtp }          = require('../streaming/rtpStreamer');
const { removeTempFiles }    = require('../utils/tempFiles');
const { logAlarm }           = require('../logging/alarmLog');
const historyService         = require('./historyService');
const dashboardState         = require('./dashboardState').getInstance();
const logger                 = require('../logging/logger');

/**
 * Verarbeitet eine eingehende Alarm-Anfrage vollstaendig.
 * @param {string} rawText    - Roher Alarmtext aus der HTTP-Anfrage
 * @param {string} requestId  - Eindeutige ID fuer Logging
 * @returns {Promise<{ cleanText: string, spokenText: string }>}
 */
async function processAlarm(rawText, requestId) {
  const startTime = Date.now();
  const tempFiles = [];
  let cleanText  = '';
  let spokenText = '';

  try {
    // 1+2. Bereinigen und aufbauen
    cleanText = buildSpeechText(rawText);
    if (!cleanText) {
      throw new Error('Kein verwertbarer Alarmtext nach Bereinigung');
    }
    logger.debug(`[${requestId}] Bereinigter Text: ${cleanText}`);

    // 3. Sprachoptimierung
    spokenText = enhanceSpeech(cleanText);
    logger.debug(`[${requestId}] Optimierter Text: ${spokenText}`);

    // 4. TTS → WAV
    const wavFiles = await textToWavFiles(spokenText);
    tempFiles.push(...wavFiles);

    // 5a. WAV → RTP-Datei zusammenfuehren + kodieren
    const rtpFile = await processToRtp(wavFiles);
    tempFiles.push(rtpFile);

    // Dashboard: Durchsage als aktiv markieren (Dauer wird geschaetzt mit 100ms/Wort)
    const wordCount    = spokenText.split(/\s+/).length;
    const estimatedMs  = Math.max(2000, wordCount * 400);
    dashboardState.setCurrentSpeech({
      text:       spokenText,
      alarmId:    requestId,
      voice:      process.env.PIPER_MODEL ? process.env.PIPER_MODEL.split('/').pop() : 'piper',
      startedAt:  Date.now(),
      durationMs: estimatedMs,
    });

    // 5b. RTP streamen
    await streamRtp(rtpFile);

    // 6. Protokollieren
    const endTime = Date.now();
    logAlarm({ requestId, startTime, endTime, cleanText, spokenText, success: true });
    const historyEntry = { requestId, startTime, endTime, cleanText, spokenText, success: true };
    historyService.add(historyEntry);

    // Dashboard: Durchsage abgeschlossen, Historie aktualisieren
    dashboardState.clearCurrentSpeech();
    dashboardState.addToHistory({
      alarmId:    requestId,
      text:       spokenText,
      voice:      process.env.PIPER_MODEL ? process.env.PIPER_MODEL.split('/').pop() : 'piper',
      finishedAt: endTime,
      success:    true,
    });

    return { cleanText, spokenText };

  } catch (err) {
    const endTime = Date.now();
    logAlarm({ requestId, startTime, endTime, cleanText, spokenText, success: false, error: err.message });
    historyService.add({ requestId, startTime, endTime, cleanText, spokenText, success: false, error: err.message });

    // Dashboard: Fehler und Durchsage beenden
    dashboardState.clearCurrentSpeech();
    dashboardState.addToHistory({
      alarmId:    requestId,
      text:       spokenText || cleanText,
      finishedAt: endTime,
      success:    false,
    });
    dashboardState.addError(err);

    throw err;

  } finally {
    // Immer: Temp-Dateien aufraeumen
    await removeTempFiles(tempFiles);
  }
}

module.exports = { processAlarm };
