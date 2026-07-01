'use strict';

/**
 * @file routes/voices.js
 * @description GET /voices – Auflistung und Prüfung verfügbarer Piper-Stimmen.
 *              POST /voice  – Aktive Standard-Stimme setzen (zur Laufzeit).
 */

const { Router } = require('express');
const { body, validationResult } = require('express-validator');

const { listVoices, voiceExists } = require('../services/piperService');
const { ValidationError, NotFoundError } = require('../errors');
const config = require('../config');

const router = Router();

/**
 * GET /voices
 * Listet alle verfügbaren Piper-Stimmen auf.
 */
router.get('/', (req, res) => {
  const voices = listVoices();

  res.json({
    ok: true,
    defaultVoice: config.piper.defaultVoice,
    count: voices.length,
    voices,
    requestId: req.requestId,
  });
});

/**
 * GET /voices/:name
 * Gibt Details zu einer Stimme zurück.
 */
router.get('/:name', (req, res, next) => {
  try {
    const { name } = req.params;
    const exists = voiceExists(name);

    if (!exists) {
      throw new NotFoundError(`Stimme nicht gefunden: ${name}`, { voice: name });
    }

    res.json({
      ok: true,
      voice: name,
      isDefault: name === config.piper.defaultVoice,
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /voice
 * Setzt die Standard-Stimme zur Laufzeit (nicht persistent).
 * Body: { voice: string }
 */
router.post(
  '/set-default',
  [
    body('voice')
      .trim()
      .notEmpty().withMessage('voice ist erforderlich')
      .isLength({ min: 1, max: 100 }).withMessage('voice darf maximal 100 Zeichen lang sein'),
  ],
  (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new ValidationError('Ungültige Anfrage', { fields: errors.array() });
      }

      const { voice } = req.body;

      if (!voiceExists(voice)) {
        throw new NotFoundError(`Stimme nicht gefunden: ${voice}`, {
          voice,
          available: listVoices(),
        });
      }

      // Laufzeit-Änderung (nicht persistent über Neustart)
      config.piper.defaultVoice = voice;

      res.json({
        ok: true,
        defaultVoice: voice,
        message: 'Standard-Stimme geändert (gilt bis zum nächsten Neustart)',
        requestId: req.requestId,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
