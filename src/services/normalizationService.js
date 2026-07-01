'use strict';

/**
 * @file services/normalizationService.js
 * @description Feuerwehr-Textnormalisierung für TTS-Ausgaben.
 *
 * Wandelt Feuerwehr-Kürzel, Straßencodes und Einsatzstichwörter in
 * sprachlich korrekte Langformen um, bevor der Text an Piper übergeben wird.
 *
 * Regeln sind in config/normalization.json erweiterbar.
 *
 * Beispiele:
 *   HH1       → Hilfeleistung eins
 *   F2        → Feuer zwei
 *   POL       → Polizei
 *   RD        → Rettungsdienst
 *   THW       → Technisches Hilfswerk
 *   BAB       → Bundesautobahn
 *   AS        → Anschlussstelle
 *   L495      → Landesstraße vierhundertfünfundneunzig
 *   A36       → Autobahn sechsunddreißig
 *   10-15     → zehn bis fünfzehn
 */

const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger').child({ service: 'NormalizationService' });

// ---------------------------------------------------------------------------
// Statische Basis-Regeln (werden durch normalization.json ergänzt)
// ---------------------------------------------------------------------------

/** Wort-für-Wort Ersetzungstabelle (case-insensitive Schlüssel) */
const BASE_REPLACEMENTS = {
  // Feuerwehr-Einsatzstichwörter
  'F1':    'Feuer eins',
  'F2':    'Feuer zwei',
  'F3':    'Feuer drei',
  'FEU':   'Feuer',
  'HH1':   'Hilfeleistung eins',
  'HH2':   'Hilfeleistung zwei',
  'HH3':   'Hilfeleistung drei',
  'HHU':   'Hilfeleistung Unfall',
  'THL':   'Technische Hilfeleistung',
  'BMA':   'Brandmeldeanlage',
  'RD':    'Rettungsdienst',
  'RTW':   'Rettungswagen',
  'KTW':   'Krankentransportwagen',
  'NEF':   'Notarzteinsatzfahrzeug',
  'NAW':   'Notarztwagen',
  'NKTW':  'Notfall-Krankentransportwagen',
  'MZF':   'Mehrzweckfahrzeug',
  'THW':   'Technisches Hilfswerk',
  'POL':   'Polizei',
  'DRK':   'Deutsches Rotes Kreuz',
  'ASB':   'Arbeiter-Samariter-Bund',
  'JUH':   'Johanniter-Unfall-Hilfe',
  'MHD':   'Malteser Hilfsdienst',
  // Straßen
  'BAB':   'Bundesautobahn',
  'AS':    'Anschlussstelle',
  'AK':    'Autobahnkreuz',
  'AD':    'Autobahndreieck',
  // Richtungsangaben / Allgemeines
  'Str.':  'Straße',
  'Pl.':   'Platz',
  'Nr.':   'Nummer',
};

/** Geladene JSON-Regeln (aus config/normalization.json) */
let _customReplacements = {};
let _rulesLoaded = false;

/**
 * Lädt optionale JSON-Regeln aus config/normalization.json.
 * Fehler beim Laden werden gewarnt, aber nicht geworfen.
 */
function _loadCustomRules() {
  if (_rulesLoaded) return;
  _rulesLoaded = true;

  const rulesPath = path.join(process.cwd(), 'config', 'normalization.json');
  if (!fs.existsSync(rulesPath)) {
    logger.debug('Keine normalization.json gefunden – nur Basis-Regeln aktiv', { rulesPath });
    return;
  }

  try {
    const raw = fs.readFileSync(rulesPath, 'utf-8');
    _customReplacements = JSON.parse(raw);
    logger.info('Normalisierungsregeln geladen', {
      rulesPath,
      count: Object.keys(_customReplacements).length,
    });
  } catch (err) {
    logger.warn('normalization.json konnte nicht geladen werden', { error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Regex-Muster für strukturelle Ersetzungen
// ---------------------------------------------------------------------------

/** Autobahn: A1–A999 → "Autobahn eins" … */
const RE_AUTOBAHN = /\bA(\d{1,3})\b/g;

/** Bundesstraße: B1–B999 */
const RE_BUNDESSTRASSE = /\bB(\d{1,3})\b/g;

/** Landesstraße: L1–L9999 */
const RE_LANDESSTRASSE = /\bL(\d{1,4})\b/g;

/** Kreisstraße: K1–K9999 */
const RE_KREISSTRASSE = /\bK(\d{1,4})\b/g;

/** Bereich-Angabe: 10-15 → "zehn bis fünfzehn" */
const RE_RANGE = /\b(\d+)-(\d+)\b/g;

// ---------------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------------

/**
 * Normalisiert einen Alarmtext für die TTS-Ausgabe.
 *
 * @param {string} text - Originaler Alarmtext
 * @returns {string}     Normalisierter Text
 */
function normalizeText(text) {
  _loadCustomRules();

  if (!text || typeof text !== 'string') return '';

  let result = text;

  // 1. Custom-Regeln (überschreiben Basis-Regeln)
  const allReplacements = { ...BASE_REPLACEMENTS, ..._customReplacements };

  // 2. Wort-für-Wort Ersetzung (Ganzwort-Match, case-insensitive)
  for (const [pattern, replacement] of Object.entries(allReplacements)) {
    // Escapierte Regex für exakten Wortmatch
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'gi');
    result = result.replace(re, replacement);
  }

  // 3. Strukturelle Ersetzungen (Straßennummern etc.)
  result = result.replace(RE_AUTOBAHN, (_, num) => `Autobahn ${_numberToWords(parseInt(num, 10))}`);
  result = result.replace(RE_BUNDESSTRASSE, (_, num) => `Bundesstraße ${_numberToWords(parseInt(num, 10))}`);
  result = result.replace(RE_LANDESSTRASSE, (_, num) => `Landesstraße ${_numberToWords(parseInt(num, 10))}`);
  result = result.replace(RE_KREISSTRASSE, (_, num) => `Kreisstraße ${_numberToWords(parseInt(num, 10))}`);

  // 4. Bereichsangaben: 10-15 → zehn bis fünfzehn
  result = result.replace(RE_RANGE, (_, from, to) =>
    `${_numberToWords(parseInt(from, 10))} bis ${_numberToWords(parseInt(to, 10))}`
  );

  return result.trim();
}

/**
 * Wandelt eine Zahl bis 9999 in deutsche Wörter um.
 * @param {number} n
 * @returns {string}
 */
function _numberToWords(n) {
  if (n < 0 || n > 9999) return String(n);

  const ones = ['null','eins','zwei','drei','vier','fünf','sechs','sieben','acht','neun',
                 'zehn','elf','zwölf','dreizehn','vierzehn','fünfzehn','sechzehn',
                 'siebzehn','achtzehn','neunzehn'];
  const tens = ['','','zwanzig','dreißig','vierzig','fünfzig','sechzig','siebzig','achtzig','neunzig'];

  if (n < 20) return ones[n];

  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o === 0 ? tens[t] : `${ones[o]}und${tens[t]}`;
  }

  if (n < 1000) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    const hStr = h === 1 ? 'einhundert' : `${ones[h]}hundert`;
    return rest === 0 ? hStr : `${hStr}${_numberToWords(rest)}`;
  }

  // 1000–9999
  const th = Math.floor(n / 1000);
  const rest = n % 1000;
  const thStr = th === 1 ? 'eintausend' : `${ones[th]}tausend`;
  return rest === 0 ? thStr : `${thStr}${_numberToWords(rest)}`;
}

module.exports = { normalizeText, _numberToWords };
