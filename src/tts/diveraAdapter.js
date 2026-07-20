'use strict';

/**
 * @file tts/diveraAdapter.js
 * @description Divera-Adapter: Baut aus dem Divera-Webhook-Payload einen
 * Rohtext für processAlarm() zusammen.
 *
 * buildSpeechText() und enhanceSpeech() werden NICHT hier aufgerufen.
 * Das übernimmt processAlarm() in einem einzigen Durchlauf.
 */

const logger = require('../utils/logger').child({ service: 'DiveraAdapter' });

/** Metadaten-Zeilen die komplett verworfen werden. */
const TEXT_DROP_PATTERNS = [
  /^Datum[:\s]/i,
  /^Zeit[:\s]/i,
  /^Einsatznummer[:\s]/i,
  /^Einsatz(?:nummer)?[:\s]/i,
  /^Priorität[:\s]/i,
  /^Sondersignal[:\s]/i,
  /^Alarmierung[:\s]/i,
  /^Status[:\s]/i,
  /^Rückmeldung/i,
  /^[-=*_]{3,}$/,
  /^(?:WF|LF|HLF|TLF|DLK|RW|GW|KTW|RTW|NEF|ELW|MTF|TSF|MLF)\s+/i,
  /^Florian\s/i,
  /^Heros\s/i,
];

/** Sektions-Header die eine zu verwerfende Sektion einleiten. */
const SECTION_PATTERNS = [
  /^-{3,}\s*Einheiten\s*-{3,}/i,
  /^-{3,}\s*Fahrzeuge\s*-{3,}/i,
  /^-{3,}\s*Kräfte\s*-{3,}/i,
  /^-{3,}\s*Schleifen\s*-{3,}/i,
  /^-{3,}\s*Rückmeldungen\s*-{3,}/i,
  /^-{3,}\s*Status\s*-{3,}/i,
  /^-{3,}\s*Alarmierung\s*-{3,}/i,
];

/** Einsatzortzusatz-Header. */
const ORT_ZUSATZ_PATTERN = /^(?:Ortzusatz|Einsatzortzusatz|Zusatz|Objekt|Gebäude|Etage|Stockwerk)[:\s]/i;

/**
 * Normalisiert Einheitenzusätze im Adress-/Ortstext für bessere TTS-Ausgabe.
 *
 * Beispiele:
 *   "WF-Halchter"   → "WF Halchter"
 *   "WF-Süd (07)"  → "WF Süd 7"
 *   "WF-Süd 07"    → "WF Süd 7"
 *
 * Der Bindestrich wird entfernt; führende Nullen in Klammer-/Freizahlen
 * ebenfalls, damit replaceNumbers() später "sieben" daraus macht.
 * @param {string} text
 * @returns {string}
 */
function normalizeUnitLabels(text) {
  return text
    // WF-Halchter → WF Halchter  (allgemeiner Bindestrich nach Einheitenpräfix)
    .replace(/\b(WF|LF|HLF|TLF|FF|BF)-([A-ZäöüÄÖÜ][a-zA-ZäöüÄÖÜ]+)/g, '$1 $2')
    // Klammern mit führenden Nullen: (07) → 7
    .replace(/\(0*(\d+)\)/g, '$1')
    // Führende Nullen vor Ziffern: 07 → 7 (nur nach Leerzeichen / Zeilenstart)
    .replace(/(\s)0+(\d)/g, '$1$2');
}

/**
 * Baut aus dem Divera-Webhook-Payload einen Rohtext für processAlarm() zusammen.
 * @param {object} payload
 * @returns {string} Rohtext
 */
function adaptDiveraPayload(payload) {
  const title   = (payload.title   || '').trim();
  const rawText = (payload.text    || '').trim();
  const address = normalizeUnitLabels((payload.address || '').trim());

  const textLines      = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const descLines      = [];
  const zusatzLines    = [];
  let inRemovedSection = false;

  for (const line of textLines) {
    // Sektions-Header erkannt → ab hier Einheiten/Fahrzeuge etc. nicht sammeln
    if (SECTION_PATTERNS.some(p => p.test(line))) {
      inRemovedSection = true;
      continue;
    }

    // Innerhalb verworfener Sektion: nur Einsatzortzusatz-Header lässt uns raus
    if (inRemovedSection) {
      if (ORT_ZUSATZ_PATTERN.test(line)) {
        inRemovedSection = false;
        const val = normalizeUnitLabels(line.replace(ORT_ZUSATZ_PATTERN, '').trim());
        if (val) zusatzLines.push(val);
      }
      continue;
    }

    // Einsatzortzusatz
    if (ORT_ZUSATZ_PATTERN.test(line)) {
      const val = normalizeUnitLabels(line.replace(ORT_ZUSATZ_PATTERN, '').trim());
      if (val) zusatzLines.push(val);
      continue;
    }

    // Metadaten-Zeile verwerfen
    if (TEXT_DROP_PATTERNS.some(p => p.test(line))) continue;

    // Freitext-Beschreibung sammeln
    descLines.push(normalizeUnitLabels(line));
  }

  // Rohtext aufbauen
  const parts = [];

  const titleLine = [title, ...descLines].filter(Boolean).join(', ');
  if (titleLine) parts.push(titleLine);

  if (address) {
    parts.push('');
    parts.push('Einsatzort:');
    parts.push(address);
  }

  if (zusatzLines.length) {
    parts.push('');
    parts.push('Einsatzortzusatz:');
    parts.push(...zusatzLines);
  }

  const combined = parts.join('\n');
  logger.debug('DiveraAdapter Rohtext', { combined });
  return combined;
}

module.exports = { adaptDiveraPayload, normalizeUnitLabels };
