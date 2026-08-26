'use strict';

const express = require('express');
const { ALARM_MAPPING } = require('../tts/mappings/alarmMapping');

const router = express.Router();

// Liefert die Stichworte direkt aus alarmMapping.js fuer die manuelle Alarmierung.
router.get('/', (_req, res) => {
  const aliases = {
    'B BMA': 'Brandmeldeanlage',
    'B WALD-1': 'Brand Wald klein',
    'B WALD-2': 'Brand Wald mittel',
    'H ÖL-1': 'Hilfeleistung Ölspur klein',
    'H ÖL-2': 'Hilfeleistung Ölspur mittel',
    'H ÖL-3': 'Hilfeleistung Ölspur groß',
    'H GAS': 'Hilfeleistung Gas',
    'H VU-1': 'Hilfeleistung Verkehrsunfall leicht',
    'H VU-2Y': 'Hilfeleistung Verkehrsunfall zwei verletzte Personen',
    'U WASSER': 'Unwetter',
  };

  const items = Object.entries(ALARM_MAPPING)
    .filter(([code]) => code !== 'Y' && code !== 'BBMA')
    .map(([code, label]) => ({ code, label }));

  for (const [code, label] of Object.entries(aliases)) {
    if (!items.some(item => item.code === code)) items.push({ code, label });
  }

  items.sort((a, b) => a.code.localeCompare(b.code, 'de'));
  res.json(items);
});

module.exports = router;
