'use strict';

/**
 * @file errors/index.js
 * @description Eigene Fehler-Hierarchie für den Alarmserver.
 * Ermöglicht präzise Fehlerbehandlung und strukturiertes Logging.
 */

/**
 * Basis-Fehlerklasse für alle Alarmserver-Fehler.
 */
class AlarmServerError extends Error {
  /**
   * @param {string} message - Fehlermeldung
   * @param {number} [statusCode=500] - HTTP-Statuscode
   * @param {string} [code='INTERNAL_ERROR'] - Maschinenlesbarer Fehlercode
   * @param {object} [details={}] - Zusätzliche Fehlerdetails
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true; // Unterscheidet operationale von Programm-Fehlern
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

/**
 * 400 – Ungültige Anfrage (Validierungsfehler).
 */
class ValidationError extends AlarmServerError {
  constructor(message, details = {}) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

/**
 * 401 – Nicht authentifiziert.
 */
class AuthenticationError extends AlarmServerError {
  constructor(message = 'Authentifizierung erforderlich') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

/**
 * 404 – Ressource nicht gefunden.
 */
class NotFoundError extends AlarmServerError {
  constructor(message = 'Ressource nicht gefunden', details = {}) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

/**
 * 409 – Konflikt (z.B. Queue voll).
 */
class ConflictError extends AlarmServerError {
  constructor(message, details = {}) {
    super(message, 409, 'CONFLICT', details);
  }
}

/**
 * 429 – Rate-Limit überschritten.
 */
class RateLimitError extends AlarmServerError {
  constructor(message = 'Zu viele Anfragen') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

/**
 * 503 – Service nicht verfügbar (z.B. Piper nicht erreichbar).
 */
class ServiceUnavailableError extends AlarmServerError {
  constructor(message, details = {}) {
    super(message, 503, 'SERVICE_UNAVAILABLE', details);
  }
}

/**
 * Fehler bei der Piper TTS-Verarbeitung.
 */
class PiperError extends AlarmServerError {
  constructor(message, details = {}) {
    super(message, 500, 'PIPER_ERROR', details);
  }
}

/**
 * Fehler beim FFmpeg RTP-Streaming.
 */
class StreamError extends AlarmServerError {
  constructor(message, details = {}) {
    super(message, 500, 'STREAM_ERROR', details);
  }
}

/**
 * Queue ist voll.
 */
class QueueFullError extends ConflictError {
  constructor(maxSize) {
    super(`Warteschlange ist voll (Maximum: ${maxSize})`, { maxSize });
    this.code = 'QUEUE_FULL';
  }
}

module.exports = {
  AlarmServerError,
  ValidationError,
  AuthenticationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServiceUnavailableError,
  PiperError,
  StreamError,
  QueueFullError,
};
