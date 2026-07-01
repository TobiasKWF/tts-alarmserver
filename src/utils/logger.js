'use strict';

/**
 * @file utils/logger.js
 * @description Winston-Logger mit rotierenden Datei-Transporten.
 * Alle Services nutzen diesen Logger für strukturiertes JSON-Logging.
 */

const { createLogger, format, transports } = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

const config = {
  level: process.env.LOG_LEVEL || 'info',
  dir: process.env.LOG_DIR || path.join(process.cwd(), 'logs'),
  maxSize: process.env.LOG_MAX_SIZE || '20m',
  maxFiles: process.env.LOG_MAX_FILES || '14',
  nodeEnv: process.env.NODE_ENV || 'production',
};

// Log-Verzeichnis erstellen wenn nicht vorhanden
if (!fs.existsSync(config.dir)) {
  fs.mkdirSync(config.dir, { recursive: true });
}

/**
 * Basis-Format für alle Log-Einträge.
 * Erzeugt strukturiertes JSON mit Zeitstempel, Level und Request-ID.
 */
const baseFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  format.errors({ stack: true }),
  format.json()
);

/**
 * Lesbares Format für Konsolen-Ausgabe in der Entwicklung.
 */
const consoleFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'HH:mm:ss.SSS' }),
  format.printf(({ timestamp, level, message, requestId, ...meta }) => {
    const rid = requestId ? ` [${requestId.slice(0, 8)}]` : '';
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp}${rid} ${level}: ${message}${metaStr}`;
  })
);

/**
 * Rotierender Datei-Transport für alle Log-Levels.
 */
const serverFileTransport = new transports.DailyRotateFile({
  filename: path.join(config.dir, 'server-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: config.maxSize,
  maxFiles: config.maxFiles,
  format: baseFormat,
  level: config.level,
});

/**
 * Rotierender Datei-Transport nur für Fehler.
 */
const errorFileTransport = new transports.DailyRotateFile({
  filename: path.join(config.dir, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: config.maxSize,
  maxFiles: config.maxFiles,
  format: baseFormat,
  level: 'error',
});

/**
 * Rotierender Datei-Transport für HTTP-Requests.
 */
const requestFileTransport = new transports.DailyRotateFile({
  filename: path.join(config.dir, 'requests-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: config.maxSize,
  maxFiles: config.maxFiles,
  format: baseFormat,
  level: 'http',
});

const loggerTransports = [
  serverFileTransport,
  errorFileTransport,
  requestFileTransport,
];

// Konsolen-Transport für Nicht-Production-Umgebungen
if (config.nodeEnv !== 'production') {
  loggerTransports.push(
    new transports.Console({
      format: consoleFormat,
      level: 'debug',
    })
  );
} else {
  // In Production: Kurze JSON-Ausgabe auf stdout für Docker-Logs
  loggerTransports.push(
    new transports.Console({
      format: baseFormat,
      level: 'warn',
    })
  );
}

const logger = createLogger({
  level: config.level,
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
  },
  transports: loggerTransports,
  exitOnError: false,
});

/**
 * Erstellt einen Child-Logger mit zusätzlichen Kontextinformationen.
 * Wird von Services genutzt, um Komponenten-Kontext zu setzen.
 * @param {object} meta - Zusätzliche Metadaten (z.B. { service: 'PiperService' })
 * @returns {winston.Logger}
 */
logger.child = (meta) => {
  return logger.child ? createLogger({
    level: config.level,
    transports: loggerTransports,
    defaultMeta: meta,
  }) : logger;
};

module.exports = logger;
