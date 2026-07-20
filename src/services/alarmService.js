'use strict';

/**
 * Alarm-Service – Haupt-Orchestrierung.
 * Pipeline: rawText → clean → enhance → TTS(WAV) → merge WAV → RTP-Stream
 */

const path             = require('path');
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

    const wavChunks = await textToWavFiles(spokenText);
    tempFiles.push(...wavChunks);

    const mergedWav = makeTempPath('_merged.wav');
    tempFiles.push(mergedWav);
    await mergeWavFiles(wavChunks, mergedWav);

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
    : path.resolve(__dirname, '../../public', file);

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
