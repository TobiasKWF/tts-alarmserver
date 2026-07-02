'use strict';

/**
 * @file config.js
 * @description Zentrale Konfiguration des TTS-Alarmservers.
 *
 * Liest alle Einstellungen aus Umgebungsvariablen (via dotenv).
 * Stellt ein typisiertes, strukturiertes Konfigurationsobjekt bereit.
 *
 * Alle Services importieren dieses Modul – niemals direkt process.env nutzen.
 *
 * Validierung:
 *   config.validate() prüft Pflichtfelder und wirft bei fehlendem
 *   PIPER_BINARY oder FFMPEG_BINARY einen erklärenden Fehler.
 */

require('dotenv').config();

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/**
 * Liest einen String-Wert aus ENV.
 * @param {string} key
 * @param {string} [defaultValue]
 * @returns {string}
 */
function str(key, defaultValue = '') {
  const val = process.env[key];
  return (val !== undefined && val !== '') ? val : defaultValue;
}

/**
 * Liest einen Integer-Wert aus ENV.
 * @param {string} key
 * @param {number} defaultValue
 * @returns {number}
 */
function int(key, defaultValue) {
  const val = parseInt(process.env[key], 10);
  return Number.isFinite(val) ? val : defaultValue;
}

/**
 * Liest einen Float-Wert aus ENV.
 * @param {string} key
 * @param {number} defaultValue
 * @returns {number}
 */
function float(key, defaultValue) {
  const val = parseFloat(process.env[key]);
  return Number.isFinite(val) ? val : defaultValue;
}

/**
 * Liest einen Boolean-Wert aus ENV.
 * 'true', '1', 'yes' → true; alles andere → false.
 * @param {string} key
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
function bool(key, defaultValue) {
  const val = process.env[key];
  if (val === undefined) return defaultValue;
  return ['true', '1', 'yes'].includes(val.toLowerCase());
}

// ---------------------------------------------------------------------------
// Konfigurationsobjekt
// ---------------------------------------------------------------------------

const config = {

  // --- Server ----------------------------------------------------------------
  server: {
    /** HTTP-Port */
    port:    int('PORT', 3000),
    /** Bind-Adresse */
    host:    str('HOST', '0.0.0.0'),
    /** Betriebsumgebung */
    nodeEnv: str('NODE_ENV', 'development'),
    /** API-Key für geschützte Endpunkte (leer = kein Schutz) */
    apiKey:  str('API_KEY', ''),
  },

  // --- CORS ------------------------------------------------------------------
  cors: {
    /** Einzelner erlaubter Origin */
    origin:  str('CORS_ORIGIN', ''),
    /** Kommaseparierte Liste erlaubter Origins (hat Vorrang vor origin) */
    origins: str('CORS_ORIGINS', ''),
  },

  // --- Rate Limiting ---------------------------------------------------------
  rateLimit: {
    /** Zeitfenster in ms */
    windowMs: int('RATE_LIMIT_WINDOW_MS', 60_000),
    /** Max. Anfragen global */
    global:   int('RATE_LIMIT_GLOBAL', 200),
    /** Max. Anfragen für /announce */
    announce: int('RATE_LIMIT_ANNOUNCE', 30),
    /** Max. Anfragen für /divera */
    divera:   int('RATE_LIMIT_DIVERA', 60),
  },

  // --- Piper TTS -------------------------------------------------------------
  piper: {
    /** Pfad zur Piper-Binary */
    binary:       str('PIPER_BINARY', '/usr/local/bin/piper'),
    /** Verzeichnis mit Voice-Modellen (*.onnx) */
    voicesDir:    str('PIPER_VOICES_DIR', './voices'),
    /** Standard-Stimme (Dateiname ohne Erweiterung) */
    defaultVoice: str('PIPER_DEFAULT_VOICE', 'de_DE-thorsten-high'),
    /** Sprechgeschwindigkeit 0.5 – 2.0 */
    speed:        float('PIPER_SPEED', 1.0),
    /** Lautstärke 0 – 100 */
    volume:       int('PIPER_VOLUME', 90),
    /** Timeout für Piper-Synthese in ms */
    timeoutMs:    int('PIPER_TIMEOUT_MS', 30_000),
    /** Maximale Wiederholungsversuche bei Fehler */
    maxRetries:   int('PIPER_MAX_RETRIES', 2),
  },

  // --- FFmpeg ----------------------------------------------------------------
  ffmpeg: {
    /** Pfad zur ffmpeg-Binary */
    binary: str('FFMPEG_BINARY', '/usr/bin/ffmpeg'),
  },

  // --- Audio -----------------------------------------------------------------
  audio: {
    /** Verzeichnis für Gong-/Fanfare-Dateien */
    gongDir:      str('AUDIO_GONG_DIR', './gong'),
    /** Standard-Gong als Fallback für alle Quellen (Dateiname ohne .wav, leer = kein Gong) */
    defaultGong:  str('AUDIO_DEFAULT_GONG', ''),
    /** Pause zwischen Gong und TTS in ms */
    gongDelayMs:  int('AUDIO_GONG_DELAY_MS', 500),
    /** Pause nach TTS in ms */
    postDelayMs:  int('AUDIO_POST_DELAY_MS', 1_000),
  },

  // --- RTP Streaming ---------------------------------------------------------
  rtp: {
    /** Ziel-IP (Multicast oder Unicast) */
    host:       str('RTP_HOST', '239.255.0.1'),
    /** Ziel-Port */
    port:       int('RTP_PORT', 5004),
    /** Bitrate */
    bitrate:    str('RTP_BITRATE', '128k'),
    /** Codec (libopus, pcm_mulaw, aac) */
    codec:      str('RTP_CODEC', 'libopus'),
    /** Abtastrate in Hz */
    sampleRate: int('RTP_SAMPLE_RATE', 48_000),
    /** Multicast TTL */
    ttl:        int('RTP_TTL', 32),
    /** Stream-Timeout in Sekunden */
    timeoutSec: int('RTP_TIMEOUT_SEC', 30),
    /** Netzwerkinterface für Multicast (leer = Standard) */
    interface:  str('RTP_INTERFACE', ''),
  },

  // --- Queue -----------------------------------------------------------------
  queue: {
    /** Maximale Warteschlangengröße */
    maxSize:        int('QUEUE_MAX_SIZE', 50),
    /** Standard-Priorität (1 niedrig – 10 kritisch) */
    defaultPriority: int('QUEUE_DEFAULT_PRIORITY', 5),
    /** Wartezeit vor Wiederholung nach Fehler in ms */
    retryDelayMs:   int('QUEUE_RETRY_DELAY_MS', 1_000),
  },

  // --- Logging ---------------------------------------------------------------
  logging: {
    /** Log-Level: error | warn | info | http | debug */
    level:       str('LOG_LEVEL', 'info'),
    /** Verzeichnis für Log-Dateien */
    dir:         str('LOG_DIR', './logs'),
    /** Max. Dateigröße pro Log-Datei */
    maxSize:     str('LOG_MAX_SIZE', '20m'),
    /** Max. Anzahl rotierter Log-Dateien */
    maxFiles:    str('LOG_MAX_FILES', '14'),
    /** Health-Requests aus Log ausschließen */
    skipHealth:  bool('LOG_SKIP_HEALTH', true),
  },

  // --- WebSocket / Dashboard -------------------------------------------------
  websocket: {
    /** Ping-Interval in ms */
    pingIntervalMs:    int('WS_PING_INTERVAL_MS', 30_000),
    /** Maximale Einträge in der Alarmhistorie */
    historyMaxEntries: int('HISTORY_MAX_ENTRIES', 100),
  },

  // --- Divera 24/7 -----------------------------------------------------------
  divera: {
    /** Basis-URL der Divera-API */
    baseUrl:     str('DIVERA_BASE_URL', 'https://www.divera247.com/api/v2'),
    /** Divera Access-Token */
    accessToken: str('DIVERA_ACCESS_TOKEN', ''),
    /** Vorab-Gong für Divera-Alarme (Dateiname ohne .wav, leer = kein Gong) */
    gong:        str('DIVERA_GONG', ''),
  },

  // --- Prometheus (optional) -------------------------------------------------
  metrics: {
    /** Metriken aktivieren */
    enabled: bool('METRICS_ENABLED', false),
    /** Pfad für /metrics Endpunkt */
    path:    str('METRICS_PATH', '/metrics'),
  },

  // --- Verzeichnisse ---------------------------------------------------------
  dirs: {
    /** Temporäres Verzeichnis für WAV-Dateien */
    tmp: str('TMP_DIR', './tmp'),
  },

};

// ---------------------------------------------------------------------------
// Validierung
// ---------------------------------------------------------------------------

/**
 * Prüft ob Pflichtfelder gesetzt sind.
 * Wird von server.js beim Start aufgerufen.
 *
 * Gibt Warnungen aus wenn optionale aber wichtige Felder fehlen.
 * Wirft einen Error nur wenn der Server definitiv nicht funktionieren kann.
 *
 * @throws {Error} Wenn PIPER_BINARY oder FFMPEG_BINARY nicht gesetzt sind.
 */
config.validate = function validate() {
  const errors   = [];
  const warnings = [];

  // Pflicht: Piper-Binary
  if (!config.piper.binary) {
    errors.push('PIPER_BINARY ist nicht gesetzt. Piper TTS kann nicht gestartet werden.');
  }

  // Pflicht: FFmpeg-Binary
  if (!config.ffmpeg.binary) {
    errors.push('FFMPEG_BINARY ist nicht gesetzt. RTP-Streaming ist nicht möglich.');
  }

  // Warnung: kein API-Key in Production
  if (config.server.nodeEnv === 'production' && !config.server.apiKey) {
    warnings.push('API_KEY ist nicht gesetzt. Alle Endpunkte sind öffentlich zugänglich.');
  }

  // Warnung: Standard-Stimme prüfen
  if (!config.piper.defaultVoice) {
    warnings.push('PIPER_DEFAULT_VOICE ist nicht gesetzt. Fallback auf de_DE-thorsten-high.');
    config.piper.defaultVoice = 'de_DE-thorsten-high';
  }

  // Warnungen ausgeben (kein Abbruch)
  if (warnings.length > 0) {
    warnings.forEach((w) => console.warn(`[config] WARNUNG: ${w}`));
  }

  // Fehler: Abbruch
  if (errors.length > 0) {
    throw new Error(
      `[config] Konfigurationsfehler beim Start:\n${errors.map((e) => `  - ${e}`).join('\n')}\n` +
      'Bitte .env prüfen. Vorlage: .env.example'
    );
  }
};

module.exports = config;
