'use strict';

/**
 * Zentrale Konfiguration – liest .env, setzt sinnvolle Standardwerte.
 * Alle anderen Module importieren NUR diese Datei für Konfigurationswerte.
 */

require('dotenv').config();

const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
  },

 piper: {
   binary:         process.env.PIPER_BINARY       || '/usr/local/bin/piper',
   model:          process.env.PIPER_MODEL        || '/opt/piper/models/de_DE-thorsten-low.onnx',
   maxChunkLength: parseInt(process.env.PIPER_MAX_CHUNK || '500', 10),
   timeoutMs:      parseInt(process.env.PIPER_TIMEOUT_MS || '30000', 10),
   lengthScale:    parseFloat(process.env.PIPER_LENGTH_SCALE || '1.0'),
   outputSampleRate: parseInt(process.env.PIPER_OUTPUT_SAMPLE_RATE || '16000', 10),
  },

  ffmpeg: {
    binary:    process.env.FFMPEG_BINARY             || 'ffmpeg',
    timeoutMs: parseInt(process.env.FFMPEG_TIMEOUT_MS || '60000', 10),
  },

  alarm: {
    // Pfad zur Gong-WAV-Datei. Leer = kein Gong.
    // Relativer Pfad wird von alarmService gegen public/ aufgelöst.
    gongFile: process.env.ALARM_GONG_FILE || '',
  },

  rtp: {
    host:       process.env.RTP_HOST                          || '239.0.0.1',
    port:       parseInt(process.env.RTP_PORT        || '5004', 10),
    codec:      process.env.RTP_CODEC                         || 'pcm_mulaw',
    sampleRate: parseInt(process.env.RTP_SAMPLE_RATE || '8000', 10),
    channels:   parseInt(process.env.RTP_CHANNELS   || '1',    10),
  },

  tmpDir: process.env.TMP_DIR || '/tmp/tts-alarm',

  queue: {
    concurrency:     parseInt(process.env.QUEUE_CONCURRENCY  || '1',  10),
    maxSize:         parseInt(process.env.QUEUE_MAX_SIZE      || '20', 10),
    defaultPriority: parseInt(process.env.QUEUE_DEFAULT_PRIO  || '5',  10),
  },

  history: {
    maxEntries: parseInt(process.env.HISTORY_MAX_ENTRIES || '100', 10),
  },

  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

module.exports = config;
