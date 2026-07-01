# tts-alarmserver

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-active--development-orange)](#)

Modularer Open-Source-Alarmserver für **Feuerwehr, THW, Rettungsdienst, Werkfeuerwehren, Vereine und Unternehmen**.

Erzeugt Sprachausgaben mit **Piper TTS** und streamt diese per **RTP (via ffmpeg)** an Lautsprecheranlagen – mit priorisierter Warteschlange, Live-Dashboard und REST API.

---

## Inhaltsverzeichnis

- [Features](#features)
- [Architektur](#architektur)
- [Voraussetzungen](#voraussetzungen)
- [Installation (Debian/Ubuntu)](#installation-debianubuntu)
- [Konfiguration](#konfiguration)
- [Start](#start)
- [REST API](#rest-api)
- [Dashboard](#dashboard)
- [Feuerwehr-Normalisierung](#feuerwehr-normalisierung)
- [Divera 24/7 Integration](#divera-247-integration)
- [Logging](#logging)
- [systemd Service](#systemd-service)
- [Entwicklung](#entwicklung)
- [Projektstruktur](#projektstruktur)
- [Lizenz](#lizenz)

---

## Features

- 🔊 **Piper TTS** – hochwertige deutsche Sprachsynthese, mehrere Stimmen
- 📡 **RTP-Streaming** – Multicast und Unicast via ffmpeg, G.711/Opus
- 📋 **Priorisierte Queue** – Alarmierungen laufen asynchron, HTTP 202 sofort
- 🖥️ **Live-Dashboard** – WebSocket, Dark Mode, Alarmhistorie, Queue-Anzeige
- 🚒 **Feuerwehr-Normalisierung** – `HH1 → Hilfeleistung eins`, `BAB → Bundesautobahn` usw.
- 🔗 **Divera 24/7** – Webhook-Empfang für automatische Alarmierungen
- 📊 **REST API** – `/announce`, `/divera`, `/health`, `/stats`, `/voices`
- 🔑 **API-Key-Schutz** – optionaler Bearer-Token für alle Schreibendpunkte
- 📝 **Winston Logging** – JSON, Rotation, Request-IDs, separates Error-Log
- ⚡ **Event-System** – lose Kopplung aller Komponenten via EventEmitter

---

## Architektur

```
HTTP-Request
    │
    ▼
 Routes (Express)
    │
    ▼
 AlarmService          ← Normalisierung, Validierung, Gong
    │
    ▼
 QueueService          ← Priorisierte Warteschlange
    │
    ▼
 PiperService          ← TTS-Synthese → WAV-Datei
    │
    ▼
 FFmpegService         ← WAV → RTP-Stream
    │
    ▼
 RTP (Multicast/Unicast)

EventBus: tts.started · tts.finished · stream.started · stream.finished
          alarm.received · alarm.finished · queue.changed · server.started
```

Alle Komponenten sind **lose gekoppelt** und kommunizieren über den zentralen `EventBus`. Dashboard, Logger und Alarmhistorie reagieren ausschließlich auf Events.

---

## Voraussetzungen

| Komponente | Version | Hinweis |
|---|---|---|
| Node.js | ≥ 20 LTS | `node --version` |
| npm | ≥ 10 | `npm --version` |
| Piper | aktuell | [piper-tts/piper](https://github.com/rhasspy/piper) |
| ffmpeg | ≥ 4.x | `apt install ffmpeg` |
| Voice-Modell | `.onnx` + `.onnx.json` | [Piper Voices](https://github.com/rhasspy/piper/releases) |

---

## Installation (Debian/Ubuntu)

### 1. Repository klonen

```bash
git clone https://github.com/TobiasKWF/tts-alarmserver.git
cd tts-alarmserver
npm install
```

### 2. ffmpeg installieren

```bash
sudo apt update && sudo apt install -y ffmpeg
```

### 3. Piper installieren

```bash
# Aktuelle Version von https://github.com/rhasspy/piper/releases herunterladen
wget https://github.com/rhasspy/piper/releases/latest/download/piper_linux_x86_64.tar.gz
tar -xzf piper_linux_x86_64.tar.gz
sudo mv piper/piper /usr/local/bin/piper
sudo chmod +x /usr/local/bin/piper
piper --version
```

### 4. Voice-Modell herunterladen

```bash
mkdir -p voices
# Beispiel: Thorsten (Deutsch)
wget -P voices/ https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx
wget -P voices/ https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx.json
```

### 5. Konfiguration

```bash
cp .env.example .env
nano .env   # Werte anpassen
```

Mindest-Konfiguration:

```env
PIPER_BINARY=/usr/local/bin/piper
PIPER_VOICES_DIR=/pfad/zu/voices
FFMPEG_BINARY=/usr/bin/ffmpeg
RTP_HOST=239.255.0.1
RTP_PORT=5004
```

---

## Konfiguration

Alle Einstellungen werden über Umgebungsvariablen in `.env` gesetzt.  
Vollständige Referenz: [`.env.example`](.env.example)

| Variable | Standard | Beschreibung |
|---|---|---|
| `PORT` | `3000` | HTTP-Port |
| `API_KEY` | leer | Bearer-Token für geschützte Endpunkte |
| `PIPER_BINARY` | `/usr/local/bin/piper` | Pfad zur Piper-Binary |
| `PIPER_VOICES_DIR` | `./voices` | Verzeichnis mit `.onnx`-Dateien |
| `PIPER_DEFAULT_VOICE` | `de_DE-thorsten-high` | Standard-Stimme |
| `FFMPEG_BINARY` | `/usr/bin/ffmpeg` | Pfad zur ffmpeg-Binary |
| `RTP_HOST` | `239.255.0.1` | Ziel-IP (Multicast oder Unicast) |
| `RTP_PORT` | `5004` | Ziel-Port |
| `RTP_CODEC` | `libopus` | Audio-Codec (`libopus`, `pcm_mulaw`) |
| `RTP_TTL` | `32` | Multicast TTL |
| `QUEUE_MAX_SIZE` | `50` | Maximale Warteschlangengröße |
| `LOG_LEVEL` | `info` | `error`\|`warn`\|`info`\|`http`\|`debug` |

---

## Start

```bash
# Produktion
npm start

# Entwicklung (mit Auto-Reload)
npm run dev

# Dashboard öffnen
open http://localhost:3000/dashboard
```

---

## REST API

### POST /announce

Sprachausgabe in die Queue einstellen.

**Header:** `Authorization: Bearer <API_KEY>` (wenn `API_KEY` gesetzt)

```http
POST /announce
Content-Type: application/json

{
  "text": "Achtung, Feuerwehr ausgerückt zu: Hauptstraße 5",
  "voice": "de_DE-thorsten-high",
  "priority": 8,
  "gong": true,
  "normalize": true
}
```

**Antwort:** `202 Accepted`
```json
{
  "status": "queued",
  "alarmId": "a1b2c3d4-...",
  "queuePosition": 1,
  "estimatedWait": 0
}
```

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `text` | string | ✅ | Anzusagender Text (max. 2000 Zeichen) |
| `voice` | string | – | Stimme (Standard aus `PIPER_DEFAULT_VOICE`) |
| `priority` | 1–10 | – | Priorität (Standard: 5) |
| `gong` | boolean | – | Gong vor Durchsage abspielen |
| `normalize` | boolean | – | Feuerwehr-Normalisierung anwenden |

---

### POST /divera

Divera 24/7 Webhook-Empfänger.

```http
POST /divera
Content-Type: application/json

{
  "title": "B2 – Wohnungsbrand",
  "text": "Musterstraße 12, 12345 Musterstadt",
  "priority": 9
}
```

---

### POST /play-fanfare

Fanfare/Gong-Datei abspielen.

```http
POST /play-fanfare
Content-Type: application/json

{
  "file": "fanfare.wav",
  "priority": 7
}
```

---

### GET /health

Healthcheck für Monitoring und Load-Balancer.

```http
GET /health
```

```json
{
  "status": "ok",
  "uptime": 3600,
  "version": "1.0.0"
}
```

---

### GET /stats

Aktuelle Laufzeitstatistiken.

```http
GET /stats
```

```json
{
  "status": "ok",
  "uptime": 3600,
  "totalAlarms": 42,
  "totalErrors": 0,
  "queue": { "size": 0, "maxSize": 50 },
  "memory": { "heapUsedMB": 45 },
  "rtp": { "host": "239.255.0.1", "port": 5004 }
}
```

---

### GET /stats/history

Alarmhistorie (letzte 100 Einträge).

```http
GET /stats/history
```

---

### GET /voices

Verfügbare Stimmen auflisten.

```http
GET /voices
```

---

### POST /voice

Stimme wechseln (Laufzeit).

```http
POST /voice
Content-Type: application/json

{ "voice": "de_DE-kerstin-high" }
```

---

## Dashboard

Das Live-Dashboard ist erreichbar unter:

```
http://localhost:3000/dashboard
```

Funktionen:
- **Serverstatus** – Uptime, RAM, WebSocket-Verbindungen
- **Aktuelle Durchsage** – Text, Alarm-ID, Stimme, Fortschrittsbalken
- **Warteschlange** – Live-Liste mit Priorität und Quelle
- **Alarmhistorie** – letzte 50 Einträge mit Status
- **Fehlerlog** – letzte 20 Fehler
- **Dark/Light-Mode** – umschaltbar
- **Auto-Reconnect** – WebSocket mit exponentiellem Backoff

---

## Feuerwehr-Normalisierung

Der `NormalizationService` wandelt Kürzel in gesprochene Sprache um:

| Eingabe | Ausgabe |
|---|---|
| `HH1` | Hilfeleistung eins |
| `F2` | Feuer zwei |
| `THL` | Technische Hilfeleistung |
| `RD` | Rettungsdienst |
| `THW` | Technisches Hilfswerk |
| `POL` | Polizei |
| `BAB` | Bundesautobahn |
| `AS` | Anschlussstelle |
| `A36` | Autobahn sechsunddreißig |
| `L495` | Landesstraße vierhundertfünfundneunzig |
| `10-15` | zehn bis fünfzehn |

Regeln sind in `src/config/normalization-rules.json` definiert und jederzeit erweiterbar.

---

## Divera 24/7 Integration

In Divera 24/7 unter **Einstellungen → Alarmierung → Webhook** eintragen:

```
https://ihr-server:3000/divera
```

Optional: Divera-Zugangsdaten für aktive API-Abfragen in `.env`:

```env
DIVERA_BASE_URL=https://www.divera247.com/api/v2
DIVERA_ACCESS_TOKEN=ihr-token
```

---

## Logging

Log-Dateien werden in `LOG_DIR` (Standard: `./logs`) gespeichert:

| Datei | Inhalt |
|---|---|
| `server.log` | Alle Events ab konfiguriertem Level |
| `error.log` | Nur Fehler (level: error) |
| `requests.log` | HTTP-Requests mit Request-ID |

Alle Logs im **JSON-Format** mit `timestamp`, `level`, `message` und strukturierten Feldern.  
Rotation: täglich, max. `LOG_MAX_FILES` Dateien à `LOG_MAX_SIZE`.

---

## systemd Service

```ini
# /etc/systemd/system/tts-alarmserver.service
[Unit]
Description=TTS-Alarmserver
After=network.target

[Service]
Type=simple
User=tts
WorkingDirectory=/opt/tts-alarmserver
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
EnvironmentFile=/opt/tts-alarmserver/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable tts-alarmserver
sudo systemctl start tts-alarmserver
sudo systemctl status tts-alarmserver
```

---

## Entwicklung

```bash
# Entwicklungsserver mit Auto-Reload
npm run dev

# Tests
npm test

# Tests mit Coverage
npm run test:coverage

# Linting
npm run lint
npm run lint:fix
```

---

## Projektstruktur

```
tts-alarmserver/
├── src/
│   ├── server.js              # Einstiegspunkt, HTTP-Server, Graceful Shutdown
│   ├── app.js                 # Express Application Factory
│   ├── config.js              # Zentrale Konfiguration (ENV-Variablen)
│   ├── config/
│   │   ├── index.js           # Compat-Shim → config.js
│   │   └── normalization-rules.json  # Feuerwehr-Kürzel
│   ├── errors/
│   │   └── index.js           # Eigene Error-Klassen
│   ├── events/
│   │   └── eventBus.js        # Zentraler EventEmitter
│   ├── middleware/
│   │   ├── index.js           # Barrel-Export
│   │   ├── apiKeyAuth.js      # Bearer-Token-Prüfung
│   │   ├── corsMiddleware.js  # CORS
│   │   ├── errorHandler.js    # Zentraler Fehlerhandler
│   │   ├── notFoundHandler.js # 404
│   │   ├── rateLimiter.js     # Rate-Limiting (global, announce, divera)
│   │   ├── requestId.js       # UUID pro Request
│   │   ├── requestLogger.js   # HTTP-Logging
│   │   └── sanitize.js        # Eingabe-Sanitisierung
│   ├── routes/
│   │   ├── announce.js        # POST /announce, POST /fanfare
│   │   ├── divera.js          # POST /divera
│   │   ├── health.js          # GET /health
│   │   ├── stats.js           # GET /stats, GET /stats/history
│   │   └── voices.js          # GET /voices, POST /voice
│   ├── services/
│   │   ├── alarmService.js    # Orchestrierung: Normalize → Piper → FFmpeg
│   │   ├── ffmpegService.js   # RTP-Streaming
│   │   ├── historyService.js  # Alarmhistorie (in-memory)
│   │   ├── normalizationService.js  # Feuerwehr-Kürzel-Engine
│   │   ├── piperService.js    # TTS-Synthese
│   │   ├── queueService.js    # Priorisierte Warteschlange
│   │   └── websocketService.js  # Live-Dashboard WebSocket
│   └── utils/
│       ├── logger.js          # Winston-Logger
│       ├── normalize.js       # Normalisierungs-Hilfsfunktionen
│       ├── sanitize.js        # Text-Sanitisierung
│       └── sleep.js           # Promise-basiertes Sleep
├── public/
│   └── index.html             # Live-Dashboard
├── voices/                    # Piper Voice-Modelle (*.onnx)
├── gong/                      # Gong/Fanfare-Dateien (*.wav)
├── logs/                      # Log-Dateien (wird automatisch angelegt)
├── tmp/                       # Temporäre WAV-Dateien (wird automatisch angelegt)
├── .env.example               # Konfigurationsvorlage
├── .gitignore
├── package.json
└── README.md
```

---

## Lizenz

[MIT](LICENSE) © TobiasKWF
