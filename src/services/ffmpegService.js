'use strict';

/**
 * @file services/ffmpegService.js
 * @description FFmpeg-Wrapper für RTP-Audio-Streaming.
 * Streamt WAV-Dateien via ffmpeg als RTP-Multicast oder Unicast.
 * Emittiert stream.started, stream.finished, stream.failed Events.
 */

const { spawn } = require('child_process');
const fs = require('fs');

const logger = require('../utils/logger').child({ service: 'FFmpegService' });
const eventBus = require('../events/eventBus');
const config = require('../config');
const { StreamError } = require('../errors');

/**
 * Streamt eine Audio-Datei via RTP.
 * @param {object} params
 * @param {string} params.inputFile - Absoluter Pfad zur Eingabedatei (WAV)
 * @param {string} [params.rtpHost] - RTP-Zieladresse (Multicast oder Unicast)
 * @param {number} [params.rtpPort] - RTP-Port
 * @param {string} [params.bitrate] - Audio-Bitrate (z.B. '128k')
 * @param {string} [params.codec] - Audio-Codec (z.B. 'libopus', 'pcm_alaw')
 * @param {number} [params.ttl] - Multicast TTL
 * @param {string} [params.requestId] - Tracing-ID
 * @returns {Promise<void>}
 * @throws {StreamError}
 */
async function streamRtp({
  inputFile,
  rtpHost,
  rtpPort,
  bitrate,
  codec,
  ttl,
  requestId,
}) {
  const resolvedHost = rtpHost || config.rtp.host;
  const resolvedPort = rtpPort || config.rtp.port;
  const resolvedBitrate = bitrate || config.rtp.bitrate;
  const resolvedCodec = codec || config.rtp.codec;
  const resolvedTtl = ttl !== undefined ? ttl : config.rtp.ttl;
  const rtpUrl = `rtp://${resolvedHost}:${resolvedPort}?ttl=${resolvedTtl}`;

  if (!fs.existsSync(inputFile)) {
    throw new StreamError(`Eingabedatei nicht gefunden: ${inputFile}`, { inputFile });
  }

  logger.debug('FFmpeg RTP-Stream starten', {
    inputFile,
    rtpUrl,
    codec: resolvedCodec,
    bitrate: resolvedBitrate,
    requestId,
  });

  eventBus.emit('stream.started', { rtpUrl, codec: resolvedCodec, requestId });

  return new Promise((resolve, reject) => {
    const args = [
      '-y',                          // Überschreiben ohne Nachfrage
      '-hide_banner',
      '-loglevel', 'error',
      '-i', inputFile,               // Eingabedatei
      '-acodec', resolvedCodec,      // Audio-Codec
      '-b:a', resolvedBitrate,       // Bitrate
      '-ar', String(config.rtp.sampleRate), // Sample-Rate
      '-f', 'rtp',                   // RTP-Output-Format
      rtpUrl,
    ];

    const ffmpeg = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderrOutput = '';
    let stdoutOutput = '';

    ffmpeg.stdout.on('data', (data) => { stdoutOutput += data.toString(); });
    ffmpeg.stderr.on('data', (data) => { stderrOutput += data.toString(); });

    ffmpeg.on('error', (err) => {
      const errMsg = `FFmpeg konnte nicht gestartet werden: ${err.message}`;
      logger.error(errMsg, { error: err.message, requestId });
      eventBus.emit('stream.failed', { error: errMsg, requestId });
      reject(new StreamError(errMsg, { error: err.message }));
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        const errMsg = `FFmpeg beendet mit Code ${code}`;
        logger.error(errMsg, {
          code,
          stderr: stderrOutput.trim(),
          rtpUrl,
          requestId,
        });
        eventBus.emit('stream.failed', { error: errMsg, code, requestId });
        reject(new StreamError(errMsg, { exitCode: code, stderr: stderrOutput.trim() }));
        return;
      }

      logger.debug('FFmpeg RTP-Stream abgeschlossen', { rtpUrl, requestId });
      eventBus.emit('stream.finished', { rtpUrl, requestId });
      resolve();
    });
  });
}

module.exports = { streamRtp };
