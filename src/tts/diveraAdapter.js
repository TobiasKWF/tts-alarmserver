'use strict';

/**
 * @file tts/diveraAdapter.js
 * @description Divera-Adapter: Baut aus dem Divera-Webhook-Payload einen
 * Rohtext für processAlarm() zusammen.
 *
 * Titel und Beschreibung werden mit einem Zeilenumbruch getrennt, damit
 * extractAlarmInfo() das Stichwort vom Beschreibungstext unterscheiden kann.
 */

const logger = require('../utils/logger').child({ service: 'DiveraAdapter' });

const TEXT_DROP_PATTERNS = [
  /^Datum[:\s]/i, /^Zeit[:\s]/i, /^Einsatznummer[:\s]/i,
  /^Einsatz(?:nummer)?[:\s]/i, /^Priorität[:\s]/i, /^Sondersignal[:\s]/i,
  /^Alarmierung[:\s]/i, /^Status[:\s]/i, /^Rückmeldung/i,
  /^[-=*_]{3,}$/,
  /^(?:WF|LF|HLF|TLF|DLK|RW|GW|KTW|RTW|NEF|ELW|MTF|TSF|MLF)\s+/i,
  /^Florian\s/i, /^Heros\s/i,
];

const SECTION_PATTERNS = [
  /^-{3,}\s*Einheiten\s*-{3,}/i, /^-{3,}\s*Fahrzeuge\s*-{3,}/i,
  /^-{3,}\s*Kräfte\s*-{3,}/i, /^-{3,}\s*Schleifen\s*-{3,}/i,
  /^-{3,}\s*Rückmeldungen\s*-{3,}/i, /^-{3,}\s*Status\s*-{3,}/i,
  /^-{3,}\s*Alarmierung\s*-{3,}/i,
];

const ORT_ZUSATZ_PATTERN = /^(?:Ortzusatz|Einsatzortzusatz|Zusatz|Objekt|Gebäude|Etage|Stockwerk)[:\s]/i;

function normalizeUnitLabels(text) {
  return text
    .replace(/\b(WF|LF|HLF|TLF|FF|BF)-([A-ZäöüÄÖÜ][a-zA-ZäöüÄÖÜ]+)/g, '$1 $2')
    .replace(/\(0*(\d+)\)/g, '$1')
    .replace(/(\s)0+(\d)/g, '$1$2');
}

function adaptDiveraPayload(payload) {
  const title = (payload.title || '').trim();
  const rawText = (payload.text || '').trim();
  const address = normalizeUnitLabels((payload.address || '').trim());

  const textLines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const descLines = [];
  const zusatzLines = [];
  let inRemovedSection = false;

  for (const line of textLines) {
    if (SECTION_PATTERNS.some(p => p.test(line))) {
      inRemovedSection = true;
      continue;
    }
    if (inRemovedSection) {
      if (ORT_ZUSATZ_PATTERN.test(line)) {
        inRemovedSection = false;
        const val = normalizeUnitLabels(line.replace(ORT_ZUSATZ_PATTERN, '').trim());
        if (val) zusatzLines.push(val);
      }
      continue;
    }
    if (ORT_ZUSATZ_PATTERN.test(line)) {
      const val = normalizeUnitLabels(line.replace(ORT_ZUSATZ_PATTERN, '').trim());
      if (val) zusatzLines.push(val);
      continue;
    }
    if (TEXT_DROP_PATTERNS.some(p => p.test(line))) continue;
    descLines.push(normalizeUnitLabels(line));
  }

  const parts = [];
  if (title) parts.push(title);
  if (descLines.length) parts.push(descLines.join(', '));
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
