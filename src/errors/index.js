'use strict';

/**
 * @file errors/index.js
 * @description Eigene Fehler-Hierarchie für den tts-alarmserver.
 *
 * Alle Service-Fehler erben von AlarmServerError (= AppError).
 * Jeder Fehler trägt:
 *   - message       Menschenlesbare Beschreibung
 *   - statusCode    HTTP-Statuscode für die API-Antwort
 *   - code          Maschinenlesbarer Fehlercode (ALL_CAPS_SNAKE)
 *   - details       Strukturierte Zusatzinfos (optional)
 *   - cause         Ursprünglicher Fehler (optional, für Error Chaining)
 *   - isOperational true = bekannter Betriebsfehler; false = Programmierfehler
 */

/**
 * Basis-Fehlerklasse. Kann mit positionalem oder options-basiertem
 * Konstruktor aufgerufen werden:
 *
 *   new AlarmServerError('msg', 500, 'CODE', { detail: 1 })
 *   new AlarmServerError('msg', { code: 'CODE', statusCode: 500, cause: err })
 */
class AlarmServerError extends Error {
  /**
   * @param {string} message
   * @param {number|object} [statusCodeOrOpts=500]
   * @param {string}  [code='INTERNAL_ERROR']
   * @param {object}  [details={}]
   */
  constructor(message, statusCodeOrOpts = 500, code = 'INTERNAL_ERROR', details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);

    if (statusCodeOrOpts !== null && typeof statusCodeOrOpts === 'object') {
      // Options-Objekt: new AlarmServerError('msg', { code, statusCode, cause, details })
      const opts = statusCodeOrOpts;
      this.statusCode = opts.statusCode ?? 500;
      this.code       = opts.code       ?? 'INTERNAL_ERROR';
      this.details    = opts.details    ?? {};
      this.cause      = opts.cause      ?? undefined;
    } else {
      // Positional: new AlarmServerError('msg', 500, 'CODE', {})
      this.statusCode = typeof statusCodeOrOpts === 'number' ? statusCodeOrOpts : 500;
      this.code       = code;
      this.details    = details;
      this.cause      = undefined;
    }
  }

  toJSON() {
    return {
      error:   this.name,
      code:    this.code,
      message: this.message,
      details: this.details,
      ...(this.cause ? { cause: this.cause.message } : {}),
    };
  }
}

/** Alias – piperService und ffmpegService importieren AppError */
const AppError = AlarmServerError;

// ---------------------------------------------------------------------------
// HTTP-Fehler
// ---------------------------------------------------------------------------

/** 400 – Ungültige Anfrage (Validierungsfehler). */
class ValidationError extends AlarmServerError {
  constructor(message, details = {}) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

/** 401 – Nicht authentifiziert. */
class AuthenticationError extends AlarmServerError {
  constructor(message = 'Authentifizierung erforderlich') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

/** 404 – Ressource nicht gefunden. */
class NotFoundError extends AlarmServerError {
  constructor(message = 'Ressource nicht gefunden', details = {}) {
    super(message, 404, 'NOT_FOUND', details);
  }
}

/** 409 – Konflikt (z.B. Queue voll). */
class ConflictError extends AlarmServerError {
  constructor(message, details = {}) {
    super(message, 409, 'CONFLICT', details);
  }
}

/** 429 – Rate-Limit überschritten. */
class RateLimitError extends AlarmServerError {
  constructor(message = 'Zu viele Anfragen') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

/** 503 – Service nicht verfügbar. */
class ServiceUnavailableError extends AlarmServerError {
  constructor(message, details = {}) {
    super(message, 503, 'SERVICE_UNAVAILABLE', details);
  }
}

// ---------------------------------------------------------------------------
// Domain-Fehler
// ---------------------------------------------------------------------------

/** Fehler bei der Piper TTS-Verarbeitung. */
class PiperError extends AlarmServerError {
  constructor(message, details = {}) {
    super(message, 500, 'PIPER_ERROR', details);
  }
}

/** Piper TTS hat Timeout überschritten. */
class PiperTimeoutError extends PiperError {
  constructor(timeoutMs) {
    super(`Piper TTS Timeout nach ${timeoutMs}ms`, { timeoutMs });
    this.code = 'PIPER_TIMEOUT';
  }
}

/** Fehler beim FFmpeg RTP-Streaming. */
class StreamError extends AlarmServerError {
  constructor(message, details = {}) {
    super(message, 500, 'STREAM_ERROR', details);
  }
}

/** FFmpeg RTP-Stream hat Timeout überschritten. */
class StreamTimeoutError extends StreamError {
  constructor(timeoutSec) {
    super(`FFmpeg Stream-Timeout nach ${timeoutSec}s`, { timeoutSec });
    this.code = 'STREAM_TIMEOUT';
  }
}

/** Queue ist voll. */
class QueueFullError extends ConflictError {
  constructor(maxSize) {
    super(`Warteschlange ist voll (Maximum: ${maxSize})`, { maxSize });
    this.code = 'QUEUE_FULL';
  }
}

module.exports = {
  // Basis
  AlarmServerError,
  AppError,          // Alias
  // HTTP
  ValidationError,
  AuthenticationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServiceUnavailableError,
  // Domain
  PiperError,
  PiperTimeoutError,
  StreamError,
  StreamTimeoutError,
  QueueFullError,
};
