'use strict';

/**
 * Alarmtext-Bereinigung.
 *
 * Behalten werden NUR:
 *   - Alarmtext (erste Zeile / Einsatzstichwort)
 *   - Einsatzort
 *   - Einsatzortzusatz (z.B. "OG 2", "Hinterhaus", "Bauwagen Kindergarten")
 *
 * Alles andere (Datum, Zeit, Einheiten, Fahrzeuge, Status …) wird verworfen.
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
  /^(?:WF|LF|HLF|TLF|DLK|RW|GW|KTW|RTW|NEF|ELW|MTF|TSF|MLF)\s+\d/i,
  /^Florian\s/i,
  /^Heros\s/i,
  /^Rotkreuz\s/i,
  /^[-=*_]{3,}$/,
];

const ORT_PATTERN             = /^(?:Ort|Einsatzort|Adresse)[:\s]/i;
const ORT_ADDITIONAL_PATTERN  = /^(?:Ortzusatz|Einsatzortzusatz|Zusatz|Objekt|Gebäude|Etage|Stockwerk)[:\s]/i;
const ORT_INLINE_ZUSATZ_PATTERN =
  /\b(EG|UG|DG|(?:OG|UG|Stock)\s*\d*|Hinterhaus|Vorderhaus|Seitenflügel|Tor\s*\d+|Aufgang\s*\d+|Eingang\s*\w+|Halle\s*\d*)$/i;

function extractAlarmInfo(rawText) {
  const lines = rawText.split(/\r?\n/).map(l => l.trim());

  let alarmText              = '';
  let locationLines          = [];
  let locationAdditionalLines = [];
  let inLocation             = false;
  let inLocationAdditional   = false;
  let inRemovedSection       = false;

  for (const line of lines) {
    if (!line) {
      if (inLocation) locationLines.push('');
      continue;
    }

    // Beginn einer zu entfernenden Sektion
    if (SECTION_PATTERNS.some(p => p.test(line))) {
      inRemovedSection       = true;
      inLocation             = false;
      inLocationAdditional   = false;
      continue;
    }

    // Innerhalb entfernter Sektion: nur bekannte Header lassen uns raus
    if (inRemovedSection) {
      if (ORT_PATTERN.test(line)) {
        inRemovedSection = false; inLocation = true; inLocationAdditional = false;
      } else if (ORT_ADDITIONAL_PATTERN.test(line)) {
        inRemovedSection = false; inLocationAdditional = true; inLocation = false;
      }
      continue;
    }

    // Einsatzortzusatz-Sektion beginnt
    if (ORT_ADDITIONAL_PATTERN.test(line)) {
      inLocationAdditional = true;
      inLocation           = false;
      // Wert nach dem Doppelpunkt direkt auf dieser Zeile mitnehmen
      const val = line.replace(ORT_ADDITIONAL_PATTERN, '').trim();
      if (val) locationAdditionalLines.push(val);
      continue;
    }

    // Einsatzort-Sektion beginnt
    if (ORT_PATTERN.test(line)) {
      inLocation           = true;
      inLocationAdditional = false;
      continue;
    }

    // LINE_PATTERNS: gefilterte Zeile –
    // WICHTIG: inLocationAdditional bleibt erhalten, nur inLocation wird zurückgesetzt.
    // So bleiben Folgezeilen eines Einsatzortzusatz-Blocks erhalten.
    if (LINE_PATTERNS.some(p => p.test(line))) {
      inLocation = false;
      // inLocationAdditional bleibt absichtlich unverändert
      continue;
    }

    if (inLocationAdditional) {
      locationAdditionalLines.push(line);
    } else if (inLocation) {
      locationLines.push(line);
    } else if (!alarmText) {
      alarmText = line;
    }
  }

  return {
    alarmText:           alarmText.trim(),
    location:            locationLines.filter(Boolean).join(', ').trim(),
    locationAdditional:  locationAdditionalLines.filter(Boolean).join(', ').trim(),
  };
}

function extractOrtZusatz(addressLine) {
  const match = addressLine.match(ORT_INLINE_ZUSATZ_PATTERN);
  if (!match) return { base: addressLine.trim(), zusatz: '' };
  const zusatz = match[0].trim();
  const base   = addressLine.slice(0, addressLine.lastIndexOf(zusatz)).trim();
  return { base, zusatz };
}

function buildSpeechText(rawText) {
  const { alarmText, location, locationAdditional } = extractAlarmInfo(rawText);

  let speech = '';
  if (alarmText) speech += alarmText + '. ';
  if (location) {
    speech += 'Einsatzort: ' + location;
    if (locationAdditional) speech += ', ' + locationAdditional;
    speech += '.';
  }

  return speech.trim();
}

module.exports = { extractAlarmInfo, extractOrtZusatz, buildSpeechText };
