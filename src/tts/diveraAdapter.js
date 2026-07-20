'use strict';

/**
 * @file tts/diveraAdapter.js
 * @description Divera-Adapter: Wandelt den unveränderten Node-RED msg.payload
 * (Divera 24/7 Webhook-JSON) in einen bereinigten, sprechbaren TTS-Text um.
 *
 * Verarbeitungs-Pipeline:
 *   1. Felder title, text, address aus dem Payload extrahieren
 *   2. address auf Einsatzortzusatz prüfen (alarmCleaner.extractOrtZusatz)
 *   3. Kombinierten Rohtext an alarmCleaner.buildSpeechText übergeben
 *   4. Ergebnis an speechEnhancer übergeben (Alarm-Codes, Zahlen, Abkürzungen)
 *
 * Unterstütztes Payload-Format (Node-RED / Divera 24/7 Webhook):
 * {
 *   title:   "B2 Wohnungsbrand",          // Einsatzstichwort
 *   text:    "Rauch aus dem Dachgeschoss", // Einsatzbeschreibung
 *   address: "Musterstraße 12, 38533 Vordorf OG 2" // Einsatzadresse
 * }
 */

const { buildSpeechText } = require('./alarmCleaner');
const { enhance } = require('./speechEnhancer');
const logger = require('../utils/logger').child({ service: 'DiveraAdapter' });

/**
 * Wandelt einen Divera-Webhook-Payload in einen sprechbaren TTS-Text um.
 *
 * @param {object} payload - Der unveränderte Node-RED msg.payload
 * @param {string} [payload.title]   - Einsatzstichwort
 * @param {string} [payload.text]    - Einsatzbeschreibung
 * @param {string} [payload.address] - Einsatzadresse (kann Ortzusatz enthalten)
 * @returns {string} Bereinigter, sprechbarer TTS-Text
 */
function adaptDiveraPayload(payload) {
  const title   = (payload.title   || '').trim();
  const text    = (payload.text    || '').trim();
  const address = (payload.address || '').trim();

  // Rohtext für alarmCleaner zusammenbauen:
  // title als erste Zeile (Einsatzstichwort), text als Folgezeile,
  // address als "Einsatzort:"-Sektion damit alarmCleaner sie korrekt zuordnet.
  const parts = [];

  if (title) parts.push(title);
  if (text)  parts.push(text);
  if (address) {
    parts.push('');
    parts.push('Einsatzort:');
    parts.push(address);
  }

  const rawText = parts.join('\n');

  logger.debug('DiveraAdapter Rohtext', { rawText });

  // Bereinigung + Sprachoptimierung
  const cleanText  = buildSpeechText(rawText);
  const spokenText = enhance(cleanText);

  logger.debug('DiveraAdapter Ergebnis', { cleanText, spokenText });

  return spokenText;
}

module.exports = { adaptDiveraPayload };
