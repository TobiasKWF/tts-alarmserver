'use strict';

/**
 * @file routes/voices.js
 * @description GET /api/voices, POST /api/voices – Stimmen-Verwaltung.
 */

const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const fs   = require('fs');
const path = require('path');

const logger = require('../utils/logger').child({ service: 'VoicesRoute' });
const { apiKeyAuth } = require('../middleware/apiKeyAuth');
const { ValidationError, NotFoundError } = require('../errors');
const config = require('../config');

const router = Router();

/**
 * Liest alle verfügbaren Piper-Stimmen aus dem voicesDir.
 * Eine Stimme = eine .onnx-Datei (ohne Endung).
 * @returns {string[]}
 */
function listVoices() {
  try {
    const dir = config.piper.voicesDir;
    if (!dir || !fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.onnx'))
      .map(f => path.basename(f, '.onnx'))
      .sort();
  } catch (_) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// GET /api/voices
// ---------------------------------------------------------------------------

router.get('/', (req, res) => {
  const voices = listVoices();

  logger.debug('Stimmen abgerufen', { count: voices.length, requestId: req.requestId });

  res.json({
    ok:           true,
    defaultVoice: config.piper.defaultVoice,
    voicesDir:    config.piper.voicesDir,
    voices,
  });
});

// ---------------------------------------------------------------------------
// POST /api/voices  – Standard-Stimme ändern (API-Key erforderlich)
// ---------------------------------------------------------------------------

router.post('/', apiKeyAuth, [
  body('voice')
    .isString().withMessage('voice muss ein String sein')
    .trim()
    .notEmpty().withMessage('voice darf nicht leer sein')
    .isLength({ max: 200 }),
], (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const details = errors.array().reduce((acc, e) => { acc[e.path] = e.msg; return acc; }, {});
      throw new ValidationError('Ungültige Anfrageparameter', details);
    }

    const { voice } = req.body;
    const available = listVoices();

    if (available.length > 0 && !available.includes(voice)) {
      throw new NotFoundError(
        `Stimme nicht gefunden: ${voice}`,
        { available, requested: voice }
      );
    }

    config.piper.defaultVoice = voice;

    logger.info('Standard-Stimme geändert', { voice, requestId: req.requestId });

    res.json({
      ok:      true,
      voice,
      message: `Standard-Stimme auf "${voice}" gesetzt`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
