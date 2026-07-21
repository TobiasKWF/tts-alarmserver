'use strict';

/**
 * Alarmtext-Bereinigung.
 *
 * Behalten werden NUR:
 *   - Alarmtext (erste Zeile / Einsatzstichwort)
 *   - Einsatzort
 *   - Einsatzortzusatz / Objekt  → wird als "Einsatzobjekt:" ausgegeben
 *
 * Alles andere (Datum, Zeit, Einheiten, Fahrzeuge, Status, STORNO …) wird verworfen.
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
  /^#{3,}\s*STORNO\s*/i,          // ### STORNO ### und Folgeformat → ignorieren
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

    // Innerhalb entfernter Sektion
    if (inRemovedSection) {
      if (ORT_PATTERN.test(line)) {
        inRemovedSection = false; inLocation = true; inLocationAdditional = false;
      } else if (ORT_ADDITIONAL_PATTERN.test(line)) {
        inRemovedSection = false; inLocationAdditional = true; inLocation = false;
      }
      continue;
    }

    // Einsatzortzusatz-Sektion
    if (ORT_ADDITIONAL_PATTERN.test(line)) {
      inLocationAdditional = true;
      inLocation           = false;
      const val = line.replace(ORT_ADDITIONAL_PATTERN, '').trim();
      if (val) locationAdditionalLines.push(val);
      continue;
    }

    // Einsatzort-Sektion
    if (ORT_PATTERN.test(line)) {
      inLocation           = true;
      inLocationAdditional = false;
      continue;
    }

    // Gefilterte Zeilen (inkl. STORNO)
    if (LINE_PATTERNS.some(p => p.test(line))) {
      inLocation = false;
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

/**
 * Entfernt doppelt genannte Straßenkennzeichnungen (z. B. zweimal L495)
 */
function deduplicateRoadRefs(text) {
  const seen = new Set();
  return text.replace(/\b([ABLKSE]\d{1,4})\b/g, (match) => {
    if (seen.has(match)) return '';
    seen.add(match);
    return match;
  }).replace(/\s{2,}/g, ' ').trim();
}

function buildSpeechText(rawText) {
  const { alarmText, location, locationAdditional } = extractAlarmInfo(rawText);
  const locationClean = deduplicateRoadRefs(location);

  let speech = '';
  if (alarmText) speech += alarmText + '. ';
  if (locationClean) speech += 'Einsatzort: ' + locationClean + '.';
  if (locationAdditional) speech += ' Einsatzobjekt: ' + locationAdditional + '.';

  return speech.trim();
}

module.exports = { extractAlarmInfo, extractOrtZusatz, deduplicateRoadRefs, buildSpeechText };
