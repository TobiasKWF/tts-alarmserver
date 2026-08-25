'use strict';

/**
 * Sprachoptimierung – Pipeline für natürliche TTS-Ausgabe.
 */

const { cleanUnicode } = require('../utils/unicode');
const { replaceNumbers } = require('../utils/numbers');
const { replaceRoadCodes, replaceAbbreviations } = require('./mappings/roadMapping');

const POSTAL_CODE_DIGITS = {
  '0': 'null', '1': 'eins', '2': 'zwei', '3': 'drei', '4': 'vier',
  '5': 'fünf', '6': 'sechs', '7': 'sieben', '8': 'acht', '9': 'neun',
};

function replacePostalCodes(text) {
  return text.replace(/(?<!\d)\d{5}(?!\d)/g, (postalCode) =>
    postalCode.split('').map(d => POSTAL_CODE_DIGITS[d]).join(' ')
  );
}

/**
 * Stichwort-Mapping für die Wolfenbütteler Alarmstichworte.
 * H + Zahl bedeutet Hilfeleistung; H 1Y ist Hilfeleistung klein mit Person
 * in Gefahr. H VU-1 bleibt ein eigener Sonderfall.
 */
function enhanceStichwort(text) {
  let r = cleanUnicode(text).trim();

  const hVuMatch = r.match(/^H\s*V\s*U\s*[- ]?([0-9]+)$/i);
  if (hVuMatch) {
    const level = parseInt(hVuMatch[1], 10);
    const levels = { 1: 'klein', 2: 'mittel', 3: 'groß' };
    return 'Hilfeleistung Verkehrsunfall ' + (levels[level] || replaceNumbers(String(level)));
  }

  // H 1Y = Hilfeleistung klein mit Person in Gefahr
  if (/^H\s*1Y$/i.test(r)) {
    return 'Hilfeleistung klein mit Person in Gefahr';
  }

  // H + Zahl = Hilfeleistung. H 1/2/3 entsprechen klein/mittel/groß.
  const hMatch = r.match(/^H\s*([0-9]+)$/i);
  if (hMatch) {
    const level = parseInt(hMatch[1], 10);
    const levels = { 1: 'klein', 2: 'mittel', 3: 'groß' };
    return 'Hilfeleistung ' + (levels[level] || replaceNumbers(String(level)));
  }

  const brandMatch = r.match(/^B\s*([0-9]+)$/i);
  if (brandMatch) {
    return 'Brand ' + replaceNumbers(brandMatch[1]);
  }

  // B BMA = Brandmeldeanlage
  if (/^B\s*BMA$/i.test(r)) {
    return 'Brand Brandmeldeanlage';
  }

  if (/^V\s*U$/i.test(r)) {
    return 'Verkehrsunfall';
  }

  const vuMatch = r.match(/^V\s*U\s*[- ]?([0-9]+)$/i);
  if (vuMatch) {
    const level = parseInt(vuMatch[1], 10);
    const levels = { 1: 'klein', 2: 'mittel', 3: 'groß' };
    return 'Verkehrsunfall ' + (levels[level] || replaceNumbers(String(level)));
  }

  r = replaceNumbers(r);
  return r.replace(/\s+/g, ' ').trim();
}

function enhanceSpeech(text) {
  let r = cleanUnicode(text);
  r = replaceRoadCodes(r);
  r = replaceAbbreviations(r);
  r = replaceNumbers(r);
  return r.replace(/\s+/g, ' ').trim();
}

function enhanceLocation(text) {
  let r = cleanUnicode(text);
  // WF steht in den Einsatzorten für Wolfenbüttel, nicht für Feuerwehr.
  r = r.replace(/\bWF(?=[-\s])/g, 'Wolfenbüttel');
  r = replaceRoadCodes(r);
  r = replaceAbbreviations(r);
  r = replacePostalCodes(r);
  r = replaceNumbers(r);
  return r.replace(/\s+/g, ' ').trim();
}

function buildAlarmSpeech(info) {
  const { stichwort, beschreibung, location, locationAdditional } = info;
  const parts = [];

  if (stichwort) parts.push(enhanceStichwort(stichwort) + '.');
  if (beschreibung) parts.push(enhanceSpeech(beschreibung) + '.');

  if (location) {
    const { deduplicateRoadRefs } = require('./alarmCleaner');
    parts.push('Einsatzort: ' + enhanceLocation(deduplicateRoadRefs(location)) + '.');
  }

  if (locationAdditional) {
    parts.push('Einsatzobjekt: ' + enhanceSpeech(locationAdditional) + '.');
  }

  return parts.join(' ').trim();
}

module.exports = { enhanceSpeech, enhanceStichwort, buildAlarmSpeech, enhanceLocation, replacePostalCodes };
