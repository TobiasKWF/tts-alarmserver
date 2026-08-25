'use strict';

/**
 * @file services/normalizationService.js
 * @description Feuerwehr-Textnormalisierung für TTS-Ausgaben.
 *
 * Wandelt Feuerwehr-Kürzel, Straßencodes und Einsatzstichwörter in
 * sprachlich korrekte Langformen um, bevor der Text an Piper übergeben wird.
 */

const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger').child({ service: 'NormalizationService' });

const BASE_REPLACEMENTS = {
  'F1': 'Feuer eins', 'F2': 'Feuer zwei', 'F3': 'Feuer drei', 'FEU': 'Feuer',
  'HH1': 'Hilfeleistung eins', 'HH2': 'Hilfeleistung zwei', 'HH3': 'Hilfeleistung drei',
  'HHU': 'Hilfeleistung Unfall', 'THL': 'Technische Hilfeleistung',
  'BMA': 'Brandmeldeanlage', 'RD': 'Rettungsdienst', 'RTW': 'Rettungswagen',
  'KTW': 'Krankentransportwagen', 'NEF': 'Notarzteinsatzfahrzeug', 'NAW': 'Notarztwagen',
  'NKTW': 'Notfall-Krankentransportwagen', 'MZF': 'Mehrzweckfahrzeug',
  'THW': 'Technisches Hilfswerk', 'POL': 'Polizei', 'DRK': 'Deutsches Rotes Kreuz',
  'ASB': 'Arbeiter-Samariter-Bund', 'JUH': 'Johanniter-Unfall-Hilfe',
  'MHD': 'Malteser Hilfsdienst', 'BAB': 'Bundesautobahn', 'AS': 'Anschlussstelle',
  'AK': 'Autobahnkreuz', 'AD': 'Autobahndreieck', 'Str.': 'Straße',
  'Pl.': 'Platz', 'Nr.': 'Nummer',
};

// Das komplette Alarmstichwort "B BMA" muss vor der allgemeinen BMA-Ersetzung
// behandelt werden: B BMA => Brandmeldeanlage (nicht "Brand Brandmeldeanlage").
const SPECIAL_PHRASES = [
  [/\bB\s+BMA\b/gi, 'Brandmeldeanlage'],
];

let _customReplacements = {};
let _rulesLoaded = false;

function _loadCustomRules() {
  if (_rulesLoaded) return;
  _rulesLoaded = true;
  const rulesPath = path.join(process.cwd(), 'config', 'normalization.json');
  if (!fs.existsSync(rulesPath)) return;
  try {
    _customReplacements = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
  } catch (err) {
    logger.warn('normalization.json konnte nicht geladen werden', { error: err.message });
  }
}

const RE_AUTOBAHN = /\bA(\d{1,3})\b/g;
const RE_BUNDESSTRASSE = /\bB(\d{1,3})\b/g;
const RE_LANDESSTRASSE = /\bL(\d{1,4})\b/g;
const RE_KREISSTRASSE = /\bK(\d{1,4})\b/g;
const RE_RANGE = /\b(\d+)-(\d+)\b/g;

function normalizeText(text) {
  _loadCustomRules();
  if (!text || typeof text !== 'string') return '';

  let result = text;

  // Spezifische Stichwörter zuerst normalisieren.
  for (const [re, replacement] of SPECIAL_PHRASES) {
    result = result.replace(re, replacement);
  }

  const allReplacements = { ...BASE_REPLACEMENTS, ..._customReplacements };
  for (const [pattern, replacement] of Object.entries(allReplacements)) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    result = result.replace(re, replacement);
  }

  result = result.replace(RE_AUTOBAHN, (_, num) => `Autobahn ${_numberToWords(parseInt(num, 10))}`);
  result = result.replace(RE_BUNDESSTRASSE, (_, num) => `Bundesstraße ${_numberToWords(parseInt(num, 10))}`);
  result = result.replace(RE_LANDESSTRASSE, (_, num) => `Landesstraße ${_numberToWords(parseInt(num, 10))}`);
  result = result.replace(RE_KREISSTRASSE, (_, num) => `Kreisstraße ${_numberToWords(parseInt(num, 10))}`);
  result = result.replace(RE_RANGE, (_, from, to) => `${_numberToWords(parseInt(from, 10))} bis ${_numberToWords(parseInt(to, 10))}`);

  return result.trim();
}

function _numberToWords(n) {
  if (n < 0 || n > 9999) return String(n);
  const ones = ['null','eins','zwei','drei','vier','fünf','sechs','sieben','acht','neun',
    'zehn','elf','zwölf','dreizehn','vierzehn','fünfzehn','sechzehn','siebzehn','achtzehn','neunzehn'];
  const tens = ['','','zwanzig','dreißig','vierzig','fünfzig','sechzig','siebzig','achtzig','neunzig'];
  if (n < 20) return ones[n];
  if (n < 100) {
    const t = Math.floor(n / 10), o = n % 10;
    return o === 0 ? tens[t] : `${ones[o]}und${tens[t]}`;
  }
  if (n < 1000) {
    const h = Math.floor(n / 100), rest = n % 100;
    const hStr = h === 1 ? 'einhundert' : `${ones[h]}hundert`;
    return rest === 0 ? hStr : `${hStr}${_numberToWords(rest)}`;
  }
  const th = Math.floor(n / 1000), rest = n % 1000;
  const thStr = th === 1 ? 'eintausend' : `${ones[th]}tausend`;
  return rest === 0 ? thStr : `${thStr}${_numberToWords(rest)}`;
}

module.exports = { normalizeText, _numberToWords };
