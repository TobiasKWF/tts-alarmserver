'use strict';

/**
 * @file tts/diveraAdapter.js
 * @description Divera-Adapter: Wandelt Divera 24/7 Webhook-JSON in TTS-Text um.
 *
 * Pipeline:
 *   1. title  – Alarmstichwort (z.B. "H V U-1")
 *   2. text   – Freitextbeschreibung (z.B. "V U mit VP auslaufende Betriebsflüssigkeiten")
 *              Metadaten-Zeilen (Datum, Zeit, Einsatznummer …) werden herausgefiltert.
 *   3. address – Einsatzort
 *   4. Einsatzortzusatz aus text-Block wenn vorhanden
 */

const { buildSpeechText } = require('./alarmCleaner');
const { enhanceSpeech }   = require('./speechEnhancer');
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

function adaptDiveraPayload(payload) {
  const title   = (payload.title   || '').trim();
  const rawText = (payload.text    || '').trim();
  const address = (payload.address || '').trim();

  // text-Block zeilenweise aufteilen und filtern
  const textLines    = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const descLines    = [];   // Freitext-Beschreibung (wird hinter Titel gestellt)
  const zusatzLines  = [];   // Einsatzortzusatz-Zeilen

  for (const line of textLines) {
    if (TEXT_DROP_PATTERNS.some(p => p.test(line))) continue;

    if (ORT_ZUSATZ_PATTERN.test(line)) {
      // Wert nach dem Schlüssel extrahieren
      const val = line.replace(ORT_ZUSATZ_PATTERN, '').trim();
      if (val) zusatzLines.push(val);
      continue;
    }

    descLines.push(line);
  }

  // Rohtext für alarmCleaner aufbauen:
  //   Zeile 1: Titel + Beschreibung (kommagetrennt)
  //   dann Einsatzort-Sektion
  //   dann ggf. Einsatzortzusatz-Sektion
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

  const cleanText  = buildSpeechText(combined);
  const spokenText = enhanceSpeech(cleanText);

  logger.debug('DiveraAdapter Ergebnis', { cleanText, spokenText });
  return spokenText;
}

module.exports = { adaptDiveraPayload };
