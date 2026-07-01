require("dotenv").config();

module.exports = {

    port: Number(process.env.PORT || 3000),

    logLevel: process.env.LOG_LEVEL || "info",

    logDir: process.env.LOG_DIR || "./logs",

    tmpDir: process.env.TMP_DIR || "./tmp",

    piper: {

        bin: process.env.PIPER_BIN,

        model: process.env.PIPER_MODEL,

        threads: Number(process.env.PIPER_THREADS || 2)

    },

    rtp: {

        target: process.env.RTP_TARGET,

        port: Number(process.env.RTP_PORT),

        ttl: Number(process.env.RTP_TTL)

    },

    ffmpeg: {

        codec: process.env.FFMPEG_CODEC || "pcm_alaw",

        sampleRate: Number(process.env.SAMPLE_RATE || 8000),

        volume: Number(process.env.AUDIO_VOLUME || 1.0)

    }

};
