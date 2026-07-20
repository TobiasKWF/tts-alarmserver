'use strict';

/**
 * RTP-Streaming-Modul.
 *
 * Streamt eine fertige Audio-Datei per ffmpeg als RTP-Multicast-Stream.
 * Unterstützt Unicast und Multicast.
 */

const { spawn } = require('child_process');
const config = require('../config');
const logger = require('../logging/logger');

/**
 * Streamt eine WAV-Datei als RTP.
 * @param {string} audioFile  - Pfad zur WAV-Quelldatei
 * @returns {Promise<void>}
 */
async function streamRtp(audioFile) {
  const rtpUrl = `rtp://${config.rtp.host}:${config.rtp.port}`;

  return new Promise((resolve, reject) => {
    const args = [
      '-re',
      '-i', audioFile,
      '-ar', String(config.rtp.sampleRate),
      '-ac', String(config.rtp.channels),
      '-acodec', config.rtp.codec,
      '-f', 'rtp',
      rtpUrl,
    ];

    logger.debug(`RTP-Stream: ffmpeg ${args.join(' ')}`);

    const proc = spawn(config.ffmpeg.binary, args);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`RTP-Stream Timeout nach ${config.ffmpeg.timeoutMs}ms`));
    }, config.ffmpeg.timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`RTP-Stream ffmpeg Exitcode ${code}: ${stderr.slice(-300)}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`RTP-Stream Prozessfehler: ${err.message}`));
    });
  });
}

module.exports = { streamRtp };
