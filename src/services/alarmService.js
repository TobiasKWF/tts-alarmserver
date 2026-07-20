'use strict';

/**
 * Alarm-Service – Haupt-Orchestrierung.
 * Pipeline: rawText → clean → enhance → TTS(WAV) → merge WAV → RTP-Stream
 */

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

async function processAlarm(rawText, requestId) {
  const startTime   = Date.now();
  const tempFiles   = [];
  let   cleanText   = '';
  let   spokenText  = '';

  await ensureTmpDir();

  const dashState = DashboardState.getInstance();

  try {
    // 1. Text bereinigen
    cleanText = buildSpeechText(rawText);
    if (!cleanText) throw new Error('Kein verwertbarer Alarmtext nach Bereinigung');

    // 2. Sprachoptimierung
    spokenText = enhanceSpeech(cleanText);

    // 3. TTS → WAV-Chunks
    const wavChunks = await textToWavFiles(spokenText);
    tempFiles.push(...wavChunks);

    // 4. WAV-Chunks zusammenführen (bei einem Chunk: direktes Copy)
    const mergedWav = makeTempPath('_merged.wav');
    tempFiles.push(mergedWav);
    await mergeWavFiles(wavChunks, mergedWav);

    // 5. Dashboard: Durchsage aktiv markieren
    const wordCount   = spokenText.split(/\s+/).length;
    const estimatedMs = Math.max(2000, wordCount * 400);
    dashState.setCurrentSpeech({
      text:       spokenText,
      alarmId:    requestId,
      voice:      (process.env.PIPER_MODEL || 'piper').split('/').pop(),
      startedAt:  Date.now(),
      durationMs: estimatedMs,
    });

    // 6. WAV direkt per RTP streamen (eine ffmpeg-Instanz: WAV → rtp://)
    await streamRtp(mergedWav);

    // 7. Protokollieren
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
    dashState.addToHistory({
      alarmId:    requestId,
      text:       spokenText || cleanText,
      finishedAt: endTime,
      success:    false,
    });
    dashState.addError({ message: err.message, ts: new Date().toISOString() });
    throw err;

  } finally {
    await removeTempFiles(tempFiles);
  }
}

module.exports = { processAlarm };
