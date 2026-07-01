'use strict';

/**
 * @file utils/logger.js
 * @description Winston-Logger mit rotierenden Datei-Transporten.
 * Alle Services nutzen diesen Logger für strukturiertes JSON-Logging.
 */

const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const fs   = require('fs');

const config = {
  level:    process.env.LOG_LEVEL    || 'info',
  dir:      process.env.LOG_DIR      || path.join(process.cwd(), 'logs'),
  maxSize:  process.env.LOG_MAX_SIZE || '20m',
  maxFiles: process.env.LOG_MAX_FILES || '14',
  nodeEnv:  process.env.NODE_ENV     || 'production',
};

// Log-Verzeichnis erstellen wenn nicht vorhanden
if (!fs.existsSync(config.dir)) {
  fs.mkdirSync(config.dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Formate
// ---------------------------------------------------------------------------

const baseFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  format.errors({ stack: true }),
  format.json()
);

const consoleFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'HH:mm:ss.SSS' }),
  format.printf(({ timestamp, level, message, requestId, ...meta }) => {
    const rid     = requestId ? ` [${requestId.slice(0, 8)}]` : '';
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp}${rid} ${level}: ${message}${metaStr}`;
  })
);

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

/**
 * Erstellt einen DailyRotateFile-Transport und deaktiviert das
 * EventEmitter-Listener-Limit sofort, da der Transport von mehreren
 * Child-Loggern gemeinsam genutzt wird.
 */
function makeRotateTransport(opts) {
  const t = new transports.DailyRotateFile({
    datePattern: 'YYYY-MM-DD',
    maxSize:     config.maxSize,
    maxFiles:    config.maxFiles,
    format:      baseFormat,
    ...opts,
  });
  // 0 = unlimitiert – sicher, da die Transports Singletons sind
  t.setMaxListeners(0);
  return t;
}

const serverFileTransport  = makeRotateTransport({
  filename: path.join(config.dir, 'server-%DATE%.log'),
  level:    config.level,
});

const errorFileTransport   = makeRotateTransport({
  filename: path.join(config.dir, 'error-%DATE%.log'),
  level:    'error',
});

const requestFileTransport = makeRotateTransport({
  filename: path.join(config.dir, 'requests-%DATE%.log'),
  level:    'http',
});

const loggerTransports = [
  serverFileTransport,
  errorFileTransport,
  requestFileTransport,
];

if (config.nodeEnv !== 'production') {
  const consoleTransport = new transports.Console({
    format: consoleFormat,
    level:  'debug',
  });
  consoleTransport.setMaxListeners(0);
  loggerTransports.push(consoleTransport);
} else {
  const consoleTransport = new transports.Console({
    format: baseFormat,
    level:  'warn',
  });
  consoleTransport.setMaxListeners(0);
  loggerTransports.push(consoleTransport);
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = createLogger({
  level:  config.level,
  levels: {
    error: 0,
    warn:  1,
    info:  2,
    http:  3,
    debug: 4,
  },
  transports:  loggerTransports,
  exitOnError: false,
});

/**
 * Erstellt einen Child-Logger mit zusätzlichen Kontextinformationen.
 * Nutzt Winston’s nativen child()-Mechanismus, der nur defaultMeta
 * erweitert und keine neuen Transport-Instanzen erzeugt.
 *
 * @param {object} meta - Zusätzliche Metadaten (z.B. { service: 'PiperService' })
 * @returns {winston.Logger}
 */
logger.child = (meta) => {
  // Winston’s eingebautes child() überschreibt nur defaultMeta
  const child = Object.create(logger);
  child.defaultMeta = { ...(logger.defaultMeta || {}), ...meta };
  return child;
};

module.exports = logger;
