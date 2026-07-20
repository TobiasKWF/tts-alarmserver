'use strict';

/**
 * Alarm-Service – Haupt-Orchestrierung.
 *
 * Ablauf:
 *   1. Rohen Alarmtext empfangen
 *   2. Alarmtext bereinigen (nur relevante Infos)
 *   3. Sprachoptimierung (Codes, Abkürzungen, Zahlen)
 *   4. TTS: Text → WAV-Dateien
 *   5. Streaming: WAV → RTP
 *   6. Temporäre Dateien aufräumen
 *   7. Alarmierung protokollieren
 */

const { buildSpeechText }    = require('../tts/alarmCleaner');
const { enhanceSpeech }      = require('../tts/speechEnhancer');
const { textToWavFiles }     = require('./piperService');
const { processToRtp }       = require('./ffmpegService');
const { streamRtp }          = require('../streaming/rtpStreamer');
const { removeTempFiles }    = require('../utils/tempFiles');
const { logAlarm }           = require('../logging/alarmLog');
const historyService         = require('./historyService');
const logger                 = require('../logging/logger');

/**
 * Verarbeitet eine eingehende Alarm-Anfrage vollständig.
 * @param {string} rawText    - Roher Alarmtext aus der HTTP-Anfrage
 * @param {string} requestId  - Eindeutige ID für Logging
 * @returns {Promise<{ cleanText: string, spokenText: string }>}
 */
async function processAlarm(rawText, requestId) {
  const startTime = Date.now();
  const tempFiles = [];
  let cleanText = '';
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

    // 5a. WAV → RTP-Datei zusammenführen + kodieren
    const rtpFile = await processToRtp(wavFiles);
    tempFiles.push(rtpFile);

    // 5b. RTP streamen
    await streamRtp(rtpFile);

    // 6. Protokollieren
    const endTime = Date.now();
    logAlarm({ requestId, startTime, endTime, cleanText, spokenText, success: true });
    historyService.add({ requestId, startTime, endTime, cleanText, spokenText, success: true });

    return { cleanText, spokenText };

  } catch (err) {
    const endTime = Date.now();
    logAlarm({
      requestId, startTime, endTime,
      cleanText, spokenText,
      success: false,
      error: err.message,
    });
    historyService.add({
      requestId, startTime, endTime,
      cleanText, spokenText,
      success: false, error: err.message,
    });
    throw err;

  } finally {
    // Immer: Temp-Dateien aufräumen
    await removeTempFiles(tempFiles);
  }
}

module.exports = { processAlarm };
