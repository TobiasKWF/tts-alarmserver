'use strict';

/**
 * Alarmtext-Bereinigung.
 *
 * Unterstützte Eingangsformate:
 *   1. Leitstellen-Hash-Format (eine Zeile, #-getrennt)
 *   2. Mehrzeiliges Label-Format
 *   3. Divera-Rohtext: erste Zeile Stichwort, folgende Zeilen Beschreibung
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
  /^#{3,}\s*STORNO\s*/i,
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

const ORT_PATTERN            = /^(?:Ort|Einsatzort|Adresse)[:\s]/i;
const ORT_ADDITIONAL_PATTERN = /^(?:Ortzusatz|Einsatzortzusatz|Zusatz|Objekt|Gebäude|Etage|Stockwerk)[:\s]/i;
const ORT_INLINE_ZUSATZ_PATTERN =
  /\b(EG|UG|DG|(?:OG|UG|Stock)\s*\d*|Hinterhaus|Vorderhaus|Seitenflügel|Tor\s*\d+|Aufgang\s*\d+|Eingang\s*\w+|Halle\s*\d*)$/i;

function isHashFormat(text) {
  const line = text.split(/\r?\n/)[0];
  return (line.match(/#/g) || []).length >= 2 && !ORT_PATTERN.test(text);
}

function deduplicateBemerkung(beschreibung, bemerkung) {
  if (!beschreibung || !bemerkung) return bemerkung;
  const norm = s => s.toLowerCase().replace(/[\s,;]+/g, ' ').trim();
  if (norm(bemerkung).startsWith(norm(beschreibung))) {
    const rest = bemerkung.slice(beschreibung.length).replace(/^[\s,;]+/, '').trim();
    return rest || '';
  }
  return bemerkung;
}

function normalizeStichwort(stichwort) {
  const value = String(stichwort || '').trim();

  const hVu = value.match(/^H\s*V\s*U\s*[- ]?([0-9]+)$/i);
  if (hVu) {
    const levels = { 1: 'klein', 2: 'mittel', 3: 'schwer' };
    return `Hilfeleistung Verkehrsunfall ${levels[Number(hVu[1])] || hVu[1]}`;
  }

  const brand = value.match(/^B\s*([0-9]+)$/i);
  if (brand) {
    const numbers = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
    const spoken = brand[1].split('').map(d => numbers[Number(d)] ?? d).join(' ');
    return `Brand ${spoken}`;
  }

  if (/^V\s*U$/i.test(value)) return 'Verkehrsunfall';

  const vu = value.match(/^V\s*U\s*[- ]?([0-9]+)$/i);
  if (vu) {
    const levels = { 1: 'klein', 2: 'mittel', 3: 'schwer' };
    return `Verkehrsunfall ${levels[Number(vu[1])] || vu[1]}`;
  }

  return value;
}

function parseHashFields(text) {
  const firstLine = text.split(/\r?\n/)[0];
  const parts = firstLine.split('#').map(p => p.trim());

  const stichwort    = normalizeStichwort(parts[0] || '');
  const beschreibung = parts[1] || '';
  const adresse      = parts[2] || '';
  const bemerkungRaw = parts.slice(5).filter(Boolean).join(', ');
  const bemerkung    = deduplicateBemerkung(beschreibung, bemerkungRaw);

  let adresseBase   = adresse;
  let adresseZusatz = bemerkung;

  const spitzMatch = adresse.match(/^(.+?)\s*<([^>]+)>\s*$/);
  if (spitzMatch) {
    adresseBase   = spitzMatch[1].trim();
    adresseZusatz = [spitzMatch[2].trim(), bemerkung].filter(Boolean).join(', ');
  } else {
    const rundMatch = adresse.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (rundMatch) {
      adresseBase   = rundMatch[1].trim();
      adresseZusatz = [rundMatch[2].trim(), bemerkung].filter(Boolean).join(', ');
    }
  }

  return { stichwort, beschreibung, adresseBase, adresseZusatz };
}

function extractAlarmInfo(rawText) {
  if (isHashFormat(rawText)) {
    const { stichwort, beschreibung, adresseBase, adresseZusatz } = parseHashFields(rawText);
    return {
      stichwort,
      beschreibung,
      location:           adresseBase,
      locationAdditional: adresseZusatz,
    };
  }

  const lines = rawText.split(/\r?\n/).map(l => l.trim());
  let stichwort               = '';
  let beschreibungLines       = [];
  let locationLines           = [];
  let locationAdditionalLines = [];
  let inLocation              = false;
  let inLocationAdditional    = false;
  let inRemovedSection        = false;

  for (const line of lines) {
    if (!line) {
      if (inLocation) locationLines.push('');
      continue;
    }

    if (SECTION_PATTERNS.some(p => p.test(line))) {
      inRemovedSection = true;
      inLocation = false;
      inLocationAdditional = false;
      continue;
    }

    if (inRemovedSection) {
      if (ORT_PATTERN.test(line)) {
        inRemovedSection = false; inLocation = true; inLocationAdditional = false;
      } else if (ORT_ADDITIONAL_PATTERN.test(line)) {
        inRemovedSection = false; inLocationAdditional = true; inLocation = false;
      }
      continue;
    }

    if (ORT_ADDITIONAL_PATTERN.test(line)) {
      inLocationAdditional = true;
      inLocation = false;
      const val = line.replace(ORT_ADDITIONAL_PATTERN, '').trim();
      if (val) locationAdditionalLines.push(val);
      continue;
    }

    if (ORT_PATTERN.test(line)) {
      inLocation = true;
      inLocationAdditional = false;
      continue;
    }

    if (LINE_PATTERNS.some(p => p.test(line))) {
      inLocation = false;
      continue;
    }

    if (inLocationAdditional) {
      locationAdditionalLines.push(line);
    } else if (inLocation) {
      locationLines.push(line);
    } else if (!stichwort) {
      stichwort = normalizeStichwort(line);
    } else {
      // Divera: Nach dem Stichwort folgen die Beschreibungzeilen.
      beschreibungLines.push(line);
    }
  }

  return {
    stichwort: stichwort.trim(),
    beschreibung: beschreibungLines.join(', ').trim(),
    location: locationLines.filter(Boolean).join(', ').trim(),
    locationAdditional: locationAdditionalLines.filter(Boolean).join(', ').trim(),
  };
}

function extractOrtZusatz(addressLine) {
  const match = addressLine.match(ORT_INLINE_ZUSATZ_PATTERN);
  if (!match) return { base: addressLine.trim(), zusatz: '' };
  const zusatz = match[0].trim();
  const base = addressLine.slice(0, addressLine.lastIndexOf(zusatz)).trim();
  return { base, zusatz };
}

function deduplicateRoadRefs(text) {
  const seen = new Set();
  return text.replace(/\b([ABLKSE]\d{1,4})\b/g, (match) => {
    if (seen.has(match)) return '';
    seen.add(match);
    return match;
  }).replace(/\s{2,}/g, ' ').trim();
}

module.exports = {
  extractAlarmInfo,
  extractOrtZusatz,
  deduplicateRoadRefs,
  isHashFormat,
  parseHashFields,
  normalizeStichwort,
};
