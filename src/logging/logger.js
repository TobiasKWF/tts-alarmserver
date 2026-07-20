'use strict';

/**
 * Zentrales Logging-Modul.
 * Gibt strukturierte Log-Zeilen mit Timestamp, Level und optionaler Request-ID aus.
 * Kein Winston-Overhead – bewusst schlank für Edge-Deployments.
 */

const config = require('../config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const configuredLevel = LEVELS[config.log.level] ?? LEVELS.info;

function format(level, message, meta) {
  const ts = new Date().toISOString();
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  return `[${ts}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

function log(level, message, meta) {
  if ((LEVELS[level] ?? 99) > configuredLevel) return;
  const line = format(level, message, meta);
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

const logger = {
  error: (msg, meta) => log('error', msg, meta),
  warn:  (msg, meta) => log('warn',  msg, meta),
  info:  (msg, meta) => log('info',  msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),
};

module.exports = logger;
