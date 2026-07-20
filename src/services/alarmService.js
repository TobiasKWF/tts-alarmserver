'use strict';

/**
 * Alarm-Service – Haupt-Orchestrierung.
 * Pipeline: rawText → clean → enhance → TTS(WAV) → [Gong voranstellen] → merge WAV → RTP-Stream
 *
 * Gong-Verhalten (wie in der alten server.js):
 *   - ALARM_GONG_FILE in .env setzen (z.B. gong.wav  oder absoluter Pfad)
 *   - Relativer Pfad wird gegen <projectRoot>/public/ aufgelöst
 *   - Existiert die Datei nicht, wird der Gong übersprungen (kein Fehler)
 */

const path             = require('path');
const fs               = require('fs');
const { buildSpeechText }  = require('../tts/alarmCleaner');
const { enhanceSpeech }    = require('../tts/speechEnhancer');
const { textToWavFiles }   = require('./piperService');
const { mergeWavFiles }    = require('./ffmpegService');
const { streamRtp }        = require('../streaming/rtpStreamer');
const { ensureTmpDir,
        makeTempPath,
        removeTempFiles }  = require('../utils/tempFiles');
const { logAlarm }         = require('../logging/alarmLog');
const historyService       = require('./historyService');
const DashboardState       = require('./dashboardState');
const logger               = require('../logging/logger');
const config               = require('../config');

// Wurzel des Projekts (zwei Ebenen über src/services/)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Gibt den absoluten Pfad zur Gong-Datei zurück,
 * oder null wenn kein Gong konfiguriert / Datei fehlt.
 */
function resolveGongPath() {
  const gongFile = config.alarm.gongFile;
  if (!gongFile) return null;

  const absPath = path.isAbsolute(gongFile)
    ? gongFile
    : path.join(PROJECT_ROOT, 'public', gongFile);

  if (!fs.existsSync(absPath)) {
    logger.warn(`Gong-Datei nicht gefunden, wird übersprungen: ${absPath}`);
    return null;
  }

  return absPath;
}

// ---------------------------------------------------------------------------
// processAlarm – TTS-Alarm
// ---------------------------------------------------------------------------

async function processAlarm(rawText, requestId) {
  const startTime   = Date.now();
  const tempFiles   = [];
  let   cleanText   = '';
  let   spokenText  = '';

  await ensureTmpDir();
  const dashState = DashboardState.getInstance();

  try {
    cleanText = buildSpeechText(rawText);
    if (!cleanText) throw new Error('Kein verwertbarer Alarmtext nach Bereinigung');

    spokenText = enhanceSpeech(cleanText);

    // TTS → WAV-Chunks
    const wavChunks = await textToWavFiles(spokenText);
    tempFiles.push(...wavChunks);

    // Gong-Datei als ersten Chunk einsetzen (wie alte server.js GONG_FILE-Logik)
    const gongPath = resolveGongPath();
    const allChunks = gongPath ? [gongPath, ...wavChunks] : wavChunks;

    if (gongPath) {
      logger.info(`[${requestId}] Gong vorangestellt: ${gongPath}`);
    }

    // Alle Chunks zu einer WAV zusammenführen
    const mergedWav = makeTempPath('_merged.wav');
    tempFiles.push(mergedWav);
    await mergeWavFiles(allChunks, mergedWav);

    const wordCount   = spokenText.split(/\s+/).length;
    const estimatedMs = Math.max(2000, wordCount * 400);
    dashState.setCurrentSpeech({
      text:       spokenText,
      alarmId:    requestId,
      voice:      (process.env.PIPER_MODEL || 'piper').split('/').pop(),
      startedAt:  Date.now(),
      durationMs: estimatedMs,
    });

    await streamRtp(mergedWav);

    const endTime = Date.now();
    logAlarm({ requestId, startTime, endTime, cleanText, spokenText, success: true });
    historyService.add({ requestId, startTime, endTime, cleanText, spokenText, success: true });
    dashState.clearCurrentSpeech();
    dashState.addToHistory({
      alarmId:    requestId,
      text:       spokenText,
      voice:      (process.env.PIPER_MODEL || 'piper').split('/').pop(),
      finishedAt: endTime,
      success:    true,
    });

    return { cleanText, spokenText };

  } catch (err) {
    const endTime = Date.now();
    logAlarm({ requestId, startTime, endTime, cleanText, spokenText, success: false, error: err.message });
    historyService.add({ requestId, startTime, endTime, cleanText, spokenText, success: false, error: err.message });
    dashState.clearCurrentSpeech();
    dashState.addToHistory({ alarmId: requestId, text: spokenText || cleanText, finishedAt: endTime, success: false });
    dashState.addError({ message: err.message, ts: new Date().toISOString() });
    throw err;
  } finally {
    await removeTempFiles(tempFiles);
  }
}

// ---------------------------------------------------------------------------
// streamFanfare – direktes Abspielen einer Audiodatei ohne TTS
// ---------------------------------------------------------------------------

async function streamFanfare(file, requestId) {
  const startTime = Date.now();
  const dashState = DashboardState.getInstance();

  // Pfad auflösen: absolut oder relativ zu public/
  const audioPath = path.isAbsolute(file)
    ? file
    : path.resolve(PROJECT_ROOT, 'public', file);

  logger.info(`[${requestId}] Fanfare: ${audioPath}`);

  dashState.setCurrentSpeech({
    text:       `🎺 Fanfare: ${file}`,
    alarmId:    requestId,
    voice:      'fanfare',
    startedAt:  Date.now(),
    durationMs: 10000,
  });

  try {
    await streamRtp(audioPath);

    const endTime = Date.now();
    historyService.add({ requestId, startTime, endTime, cleanText: file, spokenText: file, success: true });
    dashState.clearCurrentSpeech();
    dashState.addToHistory({ alarmId: requestId, text: `Fanfare: ${file}`, finishedAt: endTime, success: true });

    return { file };

  } catch (err) {
    const endTime = Date.now();
    historyService.add({ requestId, startTime, endTime, cleanText: file, spokenText: file, success: false, error: err.message });
    dashState.clearCurrentSpeech();
    dashState.addToHistory({ alarmId: requestId, text: `Fanfare: ${file}`, finishedAt: endTime, success: false });
    dashState.addError({ message: err.message, ts: new Date().toISOString() });
    throw err;
  }
}

module.exports = { processAlarm, streamFanfare };
