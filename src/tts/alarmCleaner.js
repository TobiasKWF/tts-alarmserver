'use strict';

/**
 * Alarmtext-Bereinigung.
 *
 * Entfernt alle nicht-relevanten Sektionen aus einem Alarmtext.
 * Behalten werden NUR:
 *   - Alarmtext (erste Zeile / Einsatzstichwort)
 *   - Einsatzort
 *
 * Alles andere (Datum, Zeit, Einheiten, Fahrzeuge, Status …) wird verworfen.
 *
 * Die Regeln sind in SECTION_PATTERNS gepflegt und leicht erweiterbar.
 */

/**
 * Regex-Muster für Sektions-Header, die den Beginn einer zu entfernenden Sektion markieren.
 * Alles von diesem Header bis zum nächsten bekannten Header (oder Dateiende) wird verworfen.
 */
const SECTION_PATTERNS = [
  /^-{3,}\s*Einheiten\s*-{3,}/i,
  /^-{3,}\s*Fahrzeuge\s*-{3,}/i,
  /^-{3,}\s*Kräfte\s*-{3,}/i,
  /^-{3,}\s*Schleifen\s*-{3,}/i,
  /^-{3,}\s*Rückmeldungen\s*-{3,}/i,
  /^-{3,}\s*Status\s*-{3,}/i,
  /^-{3,}\s*Alarmierung\s*-{3,}/i,
];

/**
 * Einzelzeilen-Muster: Zeilen, die diesem Muster entsprechen, werden vollständig entfernt.
 */
const LINE_PATTERNS = [
  /^Datum[:\s]/i,
  /^Zeit[:\s]/i,
  /^Einsatznummer[:\s]/i,
  /^Einsatz(?:nummer)?[:\s]/i,
  /^Priorität[:\s]/i,
  /^Sondersignal[:\s]/i,
  /^Alarmierung[:\s]/i,
  /^Status[:\s]/i,
  /^Rückmeldung/i,
  /^Schleifen?[:\s]/i,
  /^Kräfte[:\s]/i,
  // Fahrzeugkennzeichen-Muster: z.B. "WF 21-43-8", "LF 10", "HLF 20"
  /^(?:WF|LF|HLF|TLF|DLK|RW|GW|KTW|RTW|NEF|ELW|MTF|TSF|MLF)\s+\d/i,
  // Rufnamen/Funkrufnamen
  /^Florian\s/i,
  /^Heros\s/i,
  /^Rotkreuz\s/i,
  // leere Zeilen oder nur Trennstriche
  /^[-=*_]{3,}$/,
];

/**
 * Markiert den Beginn des Ortsbereichs.
 */
const ORT_PATTERN = /^(?:Ort|Einsatzort|Adresse)[:\s]/i;

/**
 * Extrahiert Alarmtext und Einsatzort aus dem Rohtext.
 * @param {string} rawText - Ungefilterte Alarm-Nachricht
 * @returns {{ alarmText: string, location: string }}
 */
function extractAlarmInfo(rawText) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim());

  let alarmText = '';
  let locationLines = [];
  let inLocation = false;
  let inRemovedSection = false;

  for (const line of lines) {
    // Leere Zeile
    if (!line) {
      if (inLocation) locationLines.push('');
      continue;
    }

    // Beginn einer zu entfernenden Sektion
    if (SECTION_PATTERNS.some(p => p.test(line))) {
      inRemovedSection = true;
      inLocation = false;
      continue;
    }

    // Ende einer entfernten Sektion: nächste bekannte Sektion
    if (inRemovedSection) {
      if (ORT_PATTERN.test(line)) {
        inRemovedSection = false;
        inLocation = true;
        continue;
      }
      continue;
    }

    // Einsatzort-Sektion beginnt
    if (ORT_PATTERN.test(line)) {
      inLocation = true;
      continue;
    }

    // Zeilen-basiertes Filtern
    if (LINE_PATTERNS.some(p => p.test(line))) {
      inLocation = false;
      continue;
    }

    if (inLocation) {
      locationLines.push(line);
    } else if (!alarmText) {
      // Erste relevante Zeile = Alarmtext
      alarmText = line;
    }
  }

  const location = locationLines.filter(Boolean).join(', ');
  return { alarmText: alarmText.trim(), location: location.trim() };
}

/**
 * Baut den finalen Sprechtext aus Alarmtext und Einsatzort zusammen.
 * @param {string} rawText
 * @returns {string}
 */
function buildSpeechText(rawText) {
  const { alarmText, location } = extractAlarmInfo(rawText);

  let speech = '';
  if (alarmText) speech += alarmText + '. ';
  if (location) speech += 'Einsatzort: ' + location + '.';

  return speech.trim();
}

module.exports = { extractAlarmInfo, buildSpeechText };
