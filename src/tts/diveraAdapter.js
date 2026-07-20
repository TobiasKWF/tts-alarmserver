'use strict';

/**
 * @file tts/diveraAdapter.js
 * @description Divera-Adapter: Wandelt Divera 24/7 Webhook-JSON in einen
 * assemblierten Rohtext um, der anschließend von processAlarm() verarbeitet wird.
 *
 * Der Adapter:
 *   1. Filtert Metadaten-Zeilen aus dem text-Feld (Datum, Zeit, Einheiten …)
 *   2. Hängt die Freitextbeschreibung hinter den Titel
 *   3. Fügt Einsatzort und Einsatzortzusatz als eigene Sektionen an
 *
 * buildSpeechText() und enhanceSpeech() werden NICHT hier aufgerufen –
 * das übernimmt processAlarm() in einem einzigen Durchlauf.
 */

const logger = require('../utils/logger').child({ service: 'DiveraAdapter' });

/** Zeilen im text-Feld die NICHT vorgelesen werden sollen. */
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
  /^(?:WF|LF|HLF|TLF|DLK|RW|GW|KTW|RTW|NEF|ELW|MTF|TSF|MLF)\s+\d/i,
  /^Florian\s/i,
  /^Heros\s/i,
];

/** Zeilen die als Einsatzortzusatz behandelt werden. */
const ORT_ZUSATZ_PATTERN = /^(?:Ortzusatz|Einsatzortzusatz|Zusatz|Objekt|Gebäude|Etage|Stockwerk)[:\s]/i;

/**
 * Baut aus dem Divera-Webhook-Payload einen Rohtext für processAlarm() zusammen.
 *
 * @param {object} payload
 * @param {string} [payload.title]   - Alarmstichwort (z.B. "H V U-1")
 * @param {string} [payload.text]    - Freitext (kann Metadaten + Einsatzortzusatz enthalten)
 * @param {string} [payload.address] - Einsatzadresse
 * @returns {string} Rohtext für buildSpeechText()
 */
function adaptDiveraPayload(payload) {
  const title    = (payload.title   || '').trim();
  const rawText  = (payload.text    || '').trim();
  const address  = (payload.address || '').trim();

  const textLines   = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const descLines   = [];
  const zusatzLines = [];

  for (const line of textLines) {
    if (TEXT_DROP_PATTERNS.some(p => p.test(line))) continue;

    if (ORT_ZUSATZ_PATTERN.test(line)) {
      const val = line.replace(ORT_ZUSATZ_PATTERN, '').trim();
      if (val) zusatzLines.push(val);
      continue;
    }

    descLines.push(line);
  }

  // Rohtext aufbauen: Titel + Beschreibung, dann Einsatzort, dann Zusatz
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

module.exports = { adaptDiveraPayload };
