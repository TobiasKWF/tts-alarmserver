'use strict';

/**
 * Alarm-Service – Haupt-Orchestrierung.
 * Pipeline: rawText → extractAlarmInfo → buildAlarmSpeech → TTS(WAV) → [Gong] → merge WAV → RTP-Stream
 *
 * Neue Architektur:
 *   extractAlarmInfo()  → { stichwort, beschreibung, location, locationAdditional }
 *   buildAlarmSpeech()  → Stichwort buchstäblich + Beschreibung/Adresse/Bemerkung enhanced
 */

const path                           = require('path');
const fs                             = require('fs');
const { extractAlarmInfo,
        deduplicateRoadRefs }        = require('../tts/alarmCleaner');
const { buildAlarmSpeech }           = require('../tts/speechEnhancer');
const { textToWavFiles }             = require('./piperService');
const { mergeWavFiles }              = require('./ffmpegService');
const { streamRtp }                  = require('../streaming/rtpStreamer');
const { ensureTmpDir,
        makeTempPath,
        removeTempFiles }            = require('../utils/tempFiles');
const { logAlarm }                   = require('../logging/alarmLog');
const historyService                 = require('./historyService');
const DashboardState                 = require('./dashboardState');
const logger                         = require('../logging/logger');
const config                         = require('../config');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

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

async function processAlarm(rawText, requestId) {
  const startTime  = Date.now();
  const tempFiles  = [];
  let   cleanText  = '';
  let   spokenText = '';

  await ensureTmpDir();
  const dashState = DashboardState.getInstance();

  try {
    // 1. Felder extrahieren
    const info = extractAlarmInfo(rawText);

    if (!info.stichwort && !info.location) {
      throw new Error('Kein verwertbarer Alarmtext nach Bereinigung');
    }

    // cleanText für Logging: kompakte menschenlesbare Zusammenfassung
    cleanText = [
      info.stichwort,
      info.beschreibung,
      info.location ? 'Einsatzort: ' + info.location : '',
      info.locationAdditional ? 'Einsatzobjekt: ' + info.locationAdditional : '',
    ].filter(Boolean).join(' | ');

    // 2. Sprachtext aufbauen
    spokenText = buildAlarmSpeech(info);

    // 3. TTS → WAV-Chunks
    const wavChunks = await textToWavFiles(spokenText);
    tempFiles.push(...wavChunks);

    // 4. Gong voranstellen
    const gongPath  = resolveGongPath();
    const allChunks = gongPath ? [gongPath, ...wavChunks] : wavChunks;
    if (gongPath) logger.info(`[${requestId}] Gong vorangestellt: ${gongPath}`);

    // 5. Merge + Stream
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

async function streamFanfare(file, requestId) {
  const startTime = Date.now();
  const dashState = DashboardState.getInstance();

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
