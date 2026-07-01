'use strict';

/**
 * @file services/ffmpegService.js
 * @description FFmpeg-Service für RTP-Audio-Streaming.
 *
 * Streamt WAV-Audiodateien per RTP an eine Multicast- oder Unicast-Adresse.
 * Unterstützt optionales Voranstellen einer Gong-Datei (concat filter),
 * Multicast-Interface-Bindung, Stream-Timeout und Lautstärkeregelung.
 *
 * FFmpeg-Aufruf (ohne Gong):
 *   ffmpeg -y -i <audioFile>
 *          -af "volume=<vol>"
 *          -acodec <codec> -b:a <bitrate> -ar <sampleRate>
 *          -f rtp "rtp://<host>:<port>?ttl=<ttl>[&localaddr=<interface>]"
 *
 * FFmpeg-Aufruf (mit Gong, concat filter):
 *   ffmpeg -y -i <gongFile> -i <audioFile>
 *          -filter_complex "[0:a]volume=<vol>[g];[1:a]volume=<vol>[a];[g][a]concat=n=2:v=0:a=1[out]"
 *          -map "[out]" -acodec <codec> ...
 *
 * Events (via EventBus):
 *   stream.started  { alarmId, rtpUrl }
 *   stream.finished { alarmId, rtpUrl, durationMs }
 *   stream.error    { alarmId, rtpUrl, error }
 */

const { spawn } = require('child_process');
const config    = require('../config');
const logger    = require('../utils/logger').child({ service: 'FFmpegService' });
const eventBus  = require('../events/eventBus');
const { AppError } = require('../errors');

/** @type {FFmpegService|null} */
let instance = null;

class FFmpegService {
  constructor() {
    this._binary = config.ffmpeg.binary;
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
   * Streamt eine Audio-Datei (mit optionalem Gong) per RTP.
   *
   * @param {object}      opts
   * @param {string}      opts.audioFile    - Absoluter Pfad zur WAV-Datei
   * @param {string|null} [opts.gongFile]   - Absoluter Pfad zur Gong-WAV oder null
   * @param {string}      [opts.rtpHost]    - RTP-Zieladresse (Standard aus config)
   * @param {number}      [opts.rtpPort]    - RTP-Zielport (Standard aus config)
   * @param {string}      [opts.codec]      - FFmpeg-Audio-Codec (Standard aus config)
   * @param {string}      [opts.bitrate]    - Audio-Bitrate (Standard aus config)
   * @param {number}      [opts.volume]     - Lautstärke 0–100 (Standard aus config)
   * @param {string}      [opts.alarmId]    - Alarm-ID für Events und Logging
   * @returns {Promise<void>}
   * @throws {AppError} Bei FFmpeg-Fehler oder Timeout
   */
  async streamToRtp({
    audioFile,
    gongFile    = null,
    rtpHost     = config.rtp.host,
    rtpPort     = config.rtp.port,
    codec       = config.rtp.codec,
    bitrate     = config.rtp.bitrate,
    volume      = config.piper.volume,
    alarmId     = 'unknown',
  }) {
    const rtpUrl = _buildRtpUrl({ rtpHost, rtpPort });

    const args = _buildFfmpegArgs({
      audioFile,
      gongFile,
      rtpUrl,
      codec,
      bitrate,
      sampleRate: config.rtp.sampleRate,
      volume,
    });

    logger.info('RTP-Stream gestartet', { alarmId, rtpUrl, codec, bitrate, hasGong: !!gongFile });
    eventBus.emit('stream.started', { alarmId, rtpUrl });

    const startMs = Date.now();

    try {
      await this._runFfmpegWithTimeout(args, rtpUrl, alarmId);
    } catch (err) {
      eventBus.emit('stream.error', { alarmId, rtpUrl, error: err.message });
      throw err;
    }

    const durationMs = Date.now() - startMs;
    logger.info('RTP-Stream abgeschlossen', { alarmId, rtpUrl, durationMs });
    eventBus.emit('stream.finished', { alarmId, rtpUrl, durationMs });
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Führt FFmpeg mit Stream-Timeout aus.
   * @param {string[]} args
   * @param {string}   rtpUrl
   * @param {string}   alarmId
   * @returns {Promise<void>}
   */
  async _runFfmpegWithTimeout(args, rtpUrl, alarmId) {
    const timeoutMs  = config.rtp.timeoutSec * 1_000;
    let   timeoutRef = null;
    let   proc       = null;

    const ffmpegPromise = this._runFfmpeg(args, rtpUrl).then((p) => { proc = p; });

    // Da _runFfmpeg intern spawn verwendet und das proc-Objekt zurückgeben
    // müsste, vereinfachen wir: Race gegen separaten Timer mit Kill.
    const runPromise = new Promise((resolve, reject) => {
      const procPromise = this._spawnFfmpeg(args, rtpUrl, alarmId);

      timeoutRef = setTimeout(() => {
        procPromise.kill && procPromise.kill();
        reject(new AppError(
          `FFmpeg Stream-Timeout nach ${config.rtp.timeoutSec}s`,
          { code: 'FFMPEG_TIMEOUT', statusCode: 500 }
        ));
      }, timeoutMs);

      procPromise.promise
        .then(() => { clearTimeout(timeoutRef); resolve(); })
        .catch((err) => { clearTimeout(timeoutRef); reject(err); });
    });

    return runPromise;
  }

  /**
   * Spawnt FFmpeg und gibt ein Objekt mit { promise, kill } zurück.
   * @param {string[]} args
   * @param {string}   rtpUrl
   * @param {string}   alarmId
   * @returns {{ promise: Promise<void>, kill: Function }}
   */
  _spawnFfmpeg(args, rtpUrl, alarmId) {
    let proc = null;

    const promise = new Promise((resolve, reject) => {
      proc = spawn(this._binary, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const errorLines = [];
      let   settled    = false;

      const settle = (fn) => {
        if (settled) return;
        settled = true;
        fn();
      };

      proc.stderr.on('data', (chunk) => {
        // FFmpeg schreibt Progress-Info auf stderr – nur echte Fehler sammeln
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          const l = line.toLowerCase();
          if (l.includes('error') || l.includes('invalid') || l.includes('no such file')) {
            errorLines.push(line.trim());
            logger.warn('FFmpeg Fehler-Zeile', { line: line.trim(), rtpUrl, alarmId });
          }
        }
      });

      proc.on('error', (err) => {
        settle(() => reject(new AppError(
          `FFmpeg konnte nicht gestartet werden: ${err.message}`,
          { code: 'FFMPEG_SPAWN_ERROR', cause: err, statusCode: 500 }
        )));
      });

      proc.on('close', (code) => {
        // code === null bei SIGKILL (Timeout-Kill) – kein Fehler falls Timeout
        // bereits abgefangen. code === 0 = ok.
        if (code !== 0 && code !== null) {
          settle(() => reject(new AppError(
            `FFmpeg beendet mit Exit-Code ${code}${errorLines.length ? ': ' + errorLines.slice(-3).join(' | ') : ''}`,
            { code: 'FFMPEG_EXIT_ERROR', statusCode: 500 }
          )));
          return;
        }
        settle(() => resolve());
      });
    });

    return {
      promise,
      kill: () => {
        if (proc && !proc.killed) {
          logger.warn('FFmpeg-Prozess wird durch Timeout beendet', { rtpUrl, alarmId });
          proc.kill('SIGKILL');
        }
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------

/**
 * Baut die RTP-URL mit optionalem Interface-Parameter auf.
 * @param {{ rtpHost: string, rtpPort: number }} opts
 * @returns {string}
 */
function _buildRtpUrl({ rtpHost, rtpPort }) {
  let url = `rtp://${rtpHost}:${rtpPort}?ttl=${config.rtp.ttl}&sdp_flags=disable_timestamps`;
  if (config.rtp.interface) {
    url += `&localaddr=${config.rtp.interface}`;
  }
  return url;
}

/**
 * Baut die FFmpeg-Argumente für den RTP-Stream auf.
 * Mit Gong wird ein concat-Filter verwendet.
 *
 * @param {object} opts
 * @returns {string[]}
 */
function _buildFfmpegArgs({ audioFile, gongFile, rtpUrl, codec, bitrate, sampleRate, volume }) {
  // Lautstärke: 0–100 → 0.0–1.0 für FFmpeg volume-Filter
  const vol = Math.min(100, Math.max(0, volume)) / 100;

  const outputArgs = [
    '-acodec', codec,
    '-b:a',    bitrate,
    '-ar',     String(sampleRate),
    '-f',      'rtp',
    rtpUrl,
  ];

  if (gongFile) {
    return [
      '-y',
      '-i', gongFile,
      '-i', audioFile,
      '-filter_complex',
      `[0:a]volume=${vol}[g];[1:a]volume=${vol}[a];[g][a]concat=n=2:v=0:a=1[out]`,
      '-map', '[out]',
      ...outputArgs,
    ];
  }

  return [
    '-y',
    '-i',  audioFile,
    '-af', `volume=${vol}`,
    ...outputArgs,
  ];
}

module.exports = { FFmpegService };
