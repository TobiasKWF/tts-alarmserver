'use strict';

/**
 * @file services/ffmpegService.js
 * @description FFmpeg-Service für RTP-Audio-Streaming.
 *
 * Streamt WAV-Audiodateien per RTP an eine Multicast- oder Unicast-Adresse.
 * Unterstützt optionales Voranstellen einer Gong-Datei (concat).
 *
 * FFmpeg-Aufruf (ohne Gong):
 *   ffmpeg -i <audioFile> -acodec <codec> -b:a <bitrate> -ar <sampleRate>
 *          -f rtp "rtp://<host>:<port>?ttl=<ttl>"
 *
 * FFmpeg-Aufruf (mit Gong, concat filter):
 *   ffmpeg -i <gongFile> -i <audioFile>
 *          -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[aout]"
 *          -map "[aout]" -acodec <codec> ...
 */

const { spawn } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger').child({ service: 'FFmpegService' });

/** @type {FFmpegService|null} */
let instance = null;

class FFmpegService {
  constructor() {
    this._ffmpegBin = process.env.FFMPEG_BINARY || 'ffmpeg';
  }

  /**
   * Gibt die Singleton-Instanz zurück.
   * @returns {FFmpegService}
   */
  static getInstance() {
    if (!instance) instance = new FFmpegService();
    return instance;
  }

  /**
   * Streamt eine Audio-Datei (mit optionalem Gong davor) per RTP.
   *
   * @param {object} opts
   * @param {string}      opts.audioFile   - Absoluter Pfad zur WAV-Datei
   * @param {string|null} opts.gongFile    - Absoluter Pfad zur Gong-WAV (oder null)
   * @param {string}      opts.rtpHost     - RTP-Zieladresse
   * @param {number}      opts.rtpPort     - RTP-Zielport
   * @param {string}      [opts.codec]     - FFmpeg-Audio-Codec
   * @param {string}      [opts.bitrate]   - Audio-Bitrate
   * @param {number}      [opts.volume]    - Lautstärke in Prozent (0–100)
   * @returns {Promise<void>}
   * @throws {FFmpegError} Bei FFmpeg-Fehler
   */
  async streamToRtp({
    audioFile,
    gongFile = null,
    rtpHost,
    rtpPort,
    codec = config.rtp.codec,
    bitrate = config.rtp.bitrate,
    volume = config.piper.volume,
  }) {
    const rtpUrl = `rtp://${rtpHost}:${rtpPort}?ttl=${config.rtp.ttl}`;
    const sampleRate = config.rtp.sampleRate;

    const args = _buildFfmpegArgs({
      audioFile,
      gongFile,
      rtpUrl,
      codec,
      bitrate,
      sampleRate,
      volume,
    });

    logger.debug('FFmpeg RTP-Stream gestartet', { rtpUrl, codec, bitrate, gongFile: !!gongFile });

    await this._runFfmpeg(args, rtpUrl);

    logger.debug('FFmpeg RTP-Stream abgeschlossen', { rtpUrl });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Führt den FFmpeg-Prozess aus und wartet auf Beendigung.
   * @param {string[]} args
   * @param {string}   rtpUrl   (für Logging)
   * @returns {Promise<void>}
   */
  _runFfmpeg(args, rtpUrl) {
    return new Promise((resolve, reject) => {
      const proc = spawn(this._ffmpegBin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';

      proc.stderr.on('data', (chunk) => {
        const line = chunk.toString();
        stderr += line;
        // FFmpeg schreibt Progress auf stderr – nur echte Fehler weiterloggen
        if (line.toLowerCase().includes('error') || line.toLowerCase().includes('invalid')) {
          logger.warn('FFmpeg stderr', { line: line.trim(), rtpUrl });
        }
      });

      proc.on('error', (err) => {
        reject(Object.assign(
          new Error(`FFmpeg konnte nicht gestartet werden: ${err.message}`),
          { code: 'FFMPEG_SPAWN_ERROR', cause: err }
        ));
      });

      proc.on('close', (code) => {
        if (code !== 0 && code !== null) {
          reject(Object.assign(
            new Error(`FFmpeg beendet mit Exit-Code ${code}: ${stderr.slice(0, 500)}`),
            { code: 'FFMPEG_EXIT_ERROR', exitCode: code, stderr }
          ));
          return;
        }
        resolve();
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------

/**
 * Baut die FFmpeg-Argumente für den RTP-Stream auf.
 * Mit Gong wird ein concat-Filter verwendet.
 *
 * @param {object} opts
 * @returns {string[]}
 */
function _buildFfmpegArgs({ audioFile, gongFile, rtpUrl, codec, bitrate, sampleRate, volume }) {
  const volumeFilter = `volume=${volume / 100}`;

  if (gongFile) {
    // Gong + TTS-Audio zusammenfügen
    return [
      '-y',
      '-i', gongFile,
      '-i', audioFile,
      '-filter_complex',
      `[0:a]${volumeFilter}[g];[1:a]${volumeFilter}[a];[g][a]concat=n=2:v=0:a=1[aout]`,
      '-map', '[aout]',
      '-acodec', codec,
      '-b:a', bitrate,
      '-ar', String(sampleRate),
      '-f', 'rtp',
      rtpUrl,
    ];
  }

  // Nur TTS-Audio
  return [
    '-y',
    '-i', audioFile,
    '-af', volumeFilter,
    '-acodec', codec,
    '-b:a', bitrate,
    '-ar', String(sampleRate),
    '-f', 'rtp',
    rtpUrl,
  ];
}

module.exports = { FFmpegService };
