'use strict';

/**
 * @file utils/normalize.js
 * @description Feuerwehr-Normalisierungs-Engine.
 * Wandelt Abkürzungen, Einsatzcodes und Straßenbezeichnungen
 * in natürlichsprachliche Formulierungen für TTS um.
 *
 * Regeln sind in src/config/normalization-rules.json definiert und
 * können zur Laufzeit erweitert werden ohne Code-Änderungen.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger').child({ service: 'NormalizeEngine' });

/**
 * Integrierte Basis-Regeln.
 * Format: { pattern: string|RegExp, replacement: string|function }
 * Reihenfolge ist relevant – spezifischere Regeln vor allgemeineren.
 */
const BASE_RULES = [
  // --- Einsatzarten ---
  { pattern: /\bTHL\b/gi, replacement: 'Technische Hilfeleistung' },
  { pattern: /\bHH(\d+)/gi, replacement: (_, n) => `Hilfeleistung ${_numberToWords(n)}` },
  { pattern: /\bF(\d+)/gi, replacement: (_, n) => `Feuer ${_numberToWords(n)}` },
  { pattern: /\bB(\d+)/gi, replacement: (_, n) => `Brand ${_numberToWords(n)}` },
  { pattern: /\bY(\d+)/gi, replacement: (_, n) => `Person in Not ${_numberToWords(n)}` },
  { pattern: /\bRD\b/gi, replacement: 'Rettungsdienst' },
  { pattern: /\bRTW\b/gi, replacement: 'Rettungswagen' },
  { pattern: /\bKTW\b/gi, replacement: 'Krankentransportwagen' },
  { pattern: /\bNEF\b/gi, replacement: 'Notarzteinsatzfahrzeug' },
  { pattern: /\bNA\b/g, replacement: 'Notarzt' },
  { pattern: /\bNAW\b/gi, replacement: 'Notarztwagen' },
  { pattern: /\bMTF\b/gi, replacement: 'Mannschaftstransportfahrzeug' },
  { pattern: /\bLF\b/gi, replacement: 'Löschfahrzeug' },
  { pattern: /\bHLF\b/gi, replacement: 'Hilfslöschfahrzeug' },
  { pattern: /\bTLF\b/gi, replacement: 'Tankerlöschfahrzeug' },
  { pattern: /\bDLK\b/gi, replacement: 'Drehleiterkranich' },
  { pattern: /\bRW\b/g, replacement: 'Rüstwagen' },

  // --- Organisationen ---
  { pattern: /\bFW\b/g, replacement: 'Feuerwehr' },
  { pattern: /\bTHW\b/gi, replacement: 'Technisches Hilfswerk' },
  { pattern: /\bPOL\b/gi, replacement: 'Polizei' },
  { pattern: /\bDRK\b/gi, replacement: 'Deutsches Rotes Kreuz' },
  { pattern: /\bMHD\b/gi, replacement: 'Malteser Hilfsdienst' },
  { pattern: /\bJUH\b/gi, replacement: 'Johanniter Unfall Hilfe' },
  { pattern: /\bASB\b/gi, replacement: 'Arbeiter Samariter Bund' },
  { pattern: /\bBGS\b/gi, replacement: 'Bundesgrenzschutz' },
  { pattern: /\bBW\b/g, replacement: 'Bundeswehr' },

  // --- Straßenbezeichnungen (Reihenfolge wichtig: spezifisch vor generisch) ---
  { pattern: /\bBAB\b/gi, replacement: 'Bundesautobahn' },
  { pattern: /\bAS\b/g, replacement: 'Anschlussstelle' },
  { pattern: /\bAK\b/g, replacement: 'Autobahnkreuz' },
  { pattern: /\bAD\b/g, replacement: 'Autobahndreieck' },
  // A + Zahl: A36 → Autobahn sechsunddreißig
  { pattern: /\bA(\d{1,3})\b/g, replacement: (_, n) => `Autobahn ${_numberToWords(n)}` },
  // L + Zahl: L495 → Landesstraße vierhundertfünfundneunzig
  { pattern: /\bL(\d{2,4})\b/g, replacement: (_, n) => `Landesstraße ${_numberToWords(n)}` },
  // B + Zahl (Bundesstraße): B6 → Bundesstraße sechs
  { pattern: /\bB(\d{1,3})\b/g, replacement: (_, n) => `Bundesstraße ${_numberToWords(n)}` },
  // K + Zahl (Kreisstraße)
  { pattern: /\bK(\d{2,4})\b/g, replacement: (_, n) => `Kreisstraße ${_numberToWords(n)}` },

  // --- Zahlenbereiche (z.B. 10-15 → zehn bis fünfzehn) ---
  { pattern: /(\d+)-(\d+)/g, replacement: (_, a, b) => `${_numberToWords(a)} bis ${_numberToWords(b)}` },

  // --- Himmelsrichtungen ---
  { pattern: /\bFR\b/g, replacement: 'Fahrtrichtung' },
  { pattern: /\bFrankfurt\/M\b/g, replacement: 'Frankfurt am Main' },
];

/** Geladene externe Regeln aus JSON-Datei */
let externalRules = [];

/**
 * Lädt externe Normalisierungsregeln aus JSON-Datei.
 * Wird einmalig beim ersten Aufruf geladen.
 */
function _loadExternalRules() {
  const rulesFile = path.join(process.cwd(), 'src', 'config', 'normalization-rules.json');
  if (!fs.existsSync(rulesFile)) return;

  try {
    const raw = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
    externalRules = raw.map((rule) => ({
      pattern: new RegExp(rule.pattern, rule.flags || 'gi'),
      replacement: rule.replacement,
    }));
    logger.info('Externe Normalisierungsregeln geladen', { count: externalRules.length, file: rulesFile });
  } catch (err) {
    logger.error('Fehler beim Laden der Normalisierungsregeln', { error: err.message, file: rulesFile });
  }
}

// Regeln beim Laden des Moduls einmalig laden
_loadExternalRules();

/**
 * Normalisiert einen Alarmtext für natürlichsprachliche TTS-Ausgabe.
 * Externe Regeln haben Vorrang vor den Basis-Regeln.
 *
 * @param {string} text - Roher Alarmtext
 * @returns {string} - Normalisierter Text
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';

  let result = text.trim();

  // Externe Regeln zuerst (höhere Spezifizität)
  for (const rule of externalRules) {
    result = result.replace(rule.pattern, rule.replacement);
  }

  // Basis-Regeln
  for (const rule of BASE_RULES) {
    result = result.replace(rule.pattern, rule.replacement);
  }

  // Mehrfache Leerzeichen normalisieren
  result = result.replace(/\s+/g, ' ').trim();

  logger.debug('Text normalisiert', { original: text, normalized: result });

  return result;
}

/**
 * Wandelt eine Zahlzeichenkette in ihre deutsche Wortform um.
 * Unterstützt Zahlen von 0 bis 9999.
 * @param {string|number} num
 * @returns {string}
 */
function _numberToWords(num) {
  const n = parseInt(String(num), 10);
  if (Number.isNaN(n)) return String(num);

  if (n === 0) return 'null';
  if (n < 0) return `minus ${_numberToWords(Math.abs(n))}`;

  const ones = ['', 'ein', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun',
    'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn',
    'siebzehn', 'achtzehn', 'neunzehn'];
  const tens = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];

  if (n < 20) return ones[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o === 0 ? tens[t] : `${ones[o]}und${tens[t]}`;
  }
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    const hStr = h === 1 ? 'hundert' : `${ones[h]}hundert`;
    return rest === 0 ? hStr : `${hStr}${_numberToWords(rest)}`;
  }
  if (n < 10000) {
    const th = Math.floor(n / 1000);
    const rest = n % 1000;
    const thStr = th === 1 ? 'tausend' : `${_numberToWords(th)}tausend`;
    return rest === 0 ? thStr : `${thStr}${_numberToWords(rest)}`;
  }

  return String(n);
}

module.exports = { normalizeText, _numberToWords };
