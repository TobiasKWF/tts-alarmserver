'use strict';

/**
 * @file routes/voices.js
 * @description GET /voices, POST /voice – Stimmen-Verwaltung.
 *
 * Listet verfügbare Piper-Stimmen auf und erlaubt das
 * Umschalten der Standard-Stimme zur Laufzeit.
 */

const { Router } = require('express');
const { body, validationResult } = require('express-validator');

const logger = require('../utils/logger').child({ service: 'VoicesRoute' });
const { PiperService } = require('../services/piperService');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');
const { ValidationError, NotFoundError } = require('../errors');
const config = require('../config');

const router = Router();

// ---------------------------------------------------------------------------
// GET /voices
// ---------------------------------------------------------------------------

/**
 * GET /voices
 * Listet alle verfügbaren Piper-Stimmen auf.
 *
 * Response:
 *   { ok: true, defaultVoice, voices: ["de_DE-thorsten-high", ...] }
 */
router.get('/', (req, res) => {
  const piperService = PiperService.getInstance();
  const voices = piperService.listVoices();

  logger.debug('Stimmen abgerufen', { count: voices.length, requestId: req.requestId });

  res.json({
    ok: true,
    defaultVoice: config.piper.defaultVoice,
    voicesDir: config.piper.voicesDir,
    voices,
  });
});

// ---------------------------------------------------------------------------
// POST /voice
// ---------------------------------------------------------------------------

/**
 * POST /voice
 * Ändert die Standard-Stimme zur Laufzeit.
 * Erfordert API-Key-Authentifizierung.
 *
 * Body:
 *   voice {string} – Pflicht. Name der gewünschten Stimme.
 *
 * Response 200:
 *   { ok: true, voice, message }
 *
 * Response 400:
 *   Ungültige Parameter
 *
 * Response 404:
 *   Stimme nicht gefunden
 */
router.post('/', apiKeyAuth, [
  body('voice')
    .isString().withMessage('voice muss ein String sein')
    .trim()
    .notEmpty().withMessage('voice darf nicht leer sein')
    .isLength({ max: 200 }).withMessage('voice darf maximal 200 Zeichen lang sein'),
], (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const details = errors.array().reduce((acc, e) => { acc[e.path] = e.msg; return acc; }, {});
      throw new ValidationError('Ungültige Anfrageparameter', details);
    }

    const { voice } = req.body;
    const piperService = PiperService.getInstance();
    const available = piperService.listVoices();

    // Prüfen ob die Stimme existiert
    if (available.length > 0 && !available.includes(voice)) {
      throw new NotFoundError(
        `Stimme nicht gefunden: ${voice}`,
        { available, requested: voice }
      );
    }

    // Laufzeit-Override der Standard-Stimme
    config.piper.defaultVoice = voice;

    logger.info('Standard-Stimme geändert', {
      voice,
      requestId: req.requestId,
    });

    res.json({
      ok: true,
      voice,
      message: `Standard-Stimme auf "${voice}" gesetzt`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
