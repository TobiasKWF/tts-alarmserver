'use strict';

/**
 * @file config/index.js
 * @description Zentrale Konfiguration des Alarmservers.
 * Liest Umgebungsvariablen, validiert Typen und liefert typsichere
 * Konfigurationsobjekte. Wirft beim Start, wenn Pflichtfelder fehlen.
 */

const path = require('path');

/**
 * Liest eine Umgebungsvariable und wandelt sie in einen Integer um.
 * @param {string} key
 * @param {number} defaultValue
 * @returns {number}
 */
function envInt(key, defaultValue) {
  const val = process.env[key];
  if (val === undefined || val === '') return defaultValue;
  const parsed = parseInt(val, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Konfigurationsfehler: ${key} muss eine Ganzzahl sein, erhielt: "${val}"`);
  }
  return parsed;
}

/**
 * Liest eine Umgebungsvariable und wandelt sie in einen Float um.
 * @param {string} key
 * @param {number} defaultValue
 * @returns {number}
 */
function envFloat(key, defaultValue) {
  const val = process.env[key];
  if (val === undefined || val === '') return defaultValue;
  const parsed = parseFloat(val);
  if (Number.isNaN(parsed)) {
    throw new Error(`Konfigurationsfehler: ${key} muss eine Zahl sein, erhielt: "${val}"`);
  }
  return parsed;
}

/**
 * Liest eine Boolean-Umgebungsvariable.
 * @param {string} key
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
function envBool(key, defaultValue) {
  const val = process.env[key];
  if (val === undefined || val === '') return defaultValue;
  return val.toLowerCase() === 'true' || val === '1';
}

const config = {
  server: {
    nodeEnv: process.env.NODE_ENV || 'production',
    port: envInt('PORT', 3000),
    host: process.env.HOST || '0.0.0.0',
    apiKey: process.env.API_KEY || '',
  },

  piper: {
    binary: process.env.PIPER_BINARY || '/usr/local/bin/piper',
    voicesDir: process.env.PIPER_VOICES_DIR || path.join(process.cwd(), 'voices'),
    defaultVoice: process.env.PIPER_DEFAULT_VOICE || 'de_DE-thorsten-high',
    speed: envFloat('PIPER_SPEED', 1.0),
    volume: envInt('PIPER_VOLUME', 90),
  },

  audio: {
    gongDir: process.env.AUDIO_GONG_DIR || path.join(process.cwd(), 'gong'),
    gongDelayMs: envInt('AUDIO_GONG_DELAY_MS', 500),
    postDelayMs: envInt('AUDIO_POST_DELAY_MS', 1000),
  },

  rtp: {
    host: process.env.RTP_HOST || '239.255.0.1',
    port: envInt('RTP_PORT', 5004),
    bitrate: process.env.RTP_BITRATE || '128k',
    codec: process.env.RTP_CODEC || 'libopus',
    sampleRate: envInt('RTP_SAMPLE_RATE', 48000),
    ttl: envInt('RTP_TTL', 32),
    timeoutSec: envInt('RTP_TIMEOUT_SEC', 30),
  },

  queue: {
    maxSize: envInt('QUEUE_MAX_SIZE', 50),
    defaultPriority: envInt('QUEUE_DEFAULT_PRIORITY', 5),
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || path.join(process.cwd(), 'logs'),
    maxSize: process.env.LOG_MAX_SIZE || '20m',
    maxFiles: process.env.LOG_MAX_FILES || '14',
  },

  websocket: {
    pingIntervalMs: envInt('WS_PING_INTERVAL_MS', 30000),
  },

  history: {
    maxEntries: envInt('HISTORY_MAX_ENTRIES', 100),
  },

  divera: {
    baseUrl: process.env.DIVERA_BASE_URL || 'https://www.divera247.com/api/v2',
    accessToken: process.env.DIVERA_ACCESS_TOKEN || '',
  },

  metrics: {
    enabled: envBool('METRICS_ENABLED', false),
    path: process.env.METRICS_PATH || '/metrics',
  },
};

module.exports = config;
