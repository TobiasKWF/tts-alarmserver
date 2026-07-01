'use strict';

/**
 * @file routes/voices.js
 * @description GET /voices  – Verfügbare TTS-Stimmen auflisten.
 *              POST /voice  – Standard-Stimme setzen (Laufzeit-Änderung).
 */

const { Router } = require('express');
const { body, validationResult } = require('express-validator');
const fs = require('fs');
const path = require('path');

const config = require('../config');
const { apiKeyAuth } = require('../middleware/apiKeyAuth');
const { ValidationError, NotFoundError } = require('../errors');
const logger = require('../utils/logger').child({ service: 'VoicesRoute' });

const router = Router();

/**
 * GET /voices
 * Listet alle verfügbaren ONNX-Stimmmodelle auf.
 */
router.get('/', (req, res) => {
  const voicesDir = config.piper.voicesDir;

  if (!fs.existsSync(voicesDir)) {
    return res.json({ ok: true, voices: [], voicesDir });
  }

  let files;
  try {
    files = fs.readdirSync(voicesDir);
  } catch (err) {
    logger.error('Voices-Verzeichnis konnte nicht gelesen werden', {
      voicesDir,
      error: err.message,
    });
    return res.json({ ok: true, voices: [], voicesDir, error: err.message });
  }

  const voices = files
    .filter((f) => f.endsWith('.onnx') && !f.endsWith('.onnx.json'))
    .map((f) => {
      const name = path.basename(f, '.onnx');
      const configFile = path.join(voicesDir, `${f}.json`);
      let meta = {};
      if (fs.existsSync(configFile)) {
        try {
          const raw = JSON.parse(fs.readFileSync(configFile, 'utf8'));
          meta = {
            language: raw.language?.code || null,
            quality: raw.quality || null,
            numSpeakers: raw.num_speakers || 1,
          };
        } catch (e) {
          // Config-Parsing fehlgeschlagen – weiter ohne Metadaten
        }
      }
      return {
        name,
        file: f,
        isDefault: name === config.piper.defaultVoice,
        ...meta,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return res.json({
    ok: true,
    voices,
    default: config.piper.defaultVoice,
    voicesDir,
    count: voices.length,
  });
});

/**
 * POST /voice
 * Setzt die Standard-Stimme für neue Alarmierungen.
 * Benötigt API-Key.
 */
router.post(
  '/voice',
  apiKeyAuth,
  [
    body('voice')
      .isString().withMessage('voice muss ein String sein')
      .trim()
      .isLength({ min: 1, max: 100 }).withMessage('Ungültiger Voice-Name'),
  ],
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ValidationError('Ungültige Anfrage', { fields: errors.array() }));
    }

    const { voice } = req.body;
    const voicesDir = config.piper.voicesDir;
    const modelFile = path.join(voicesDir, `${voice}.onnx`);

    if (!fs.existsSync(modelFile)) {
      return next(new NotFoundError(`Stimme nicht gefunden: ${voice}`, { voice, voicesDir }));
    }

    // Laufzeit-Änderung der Standard-Stimme
    config.piper.defaultVoice = voice;

    logger.info('Standard-Stimme geändert', { voice, requestId: req.requestId });

    return res.json({
      ok: true,
      message: `Standard-Stimme geändert`,
      voice,
    });
  }
);

module.exports = router;
