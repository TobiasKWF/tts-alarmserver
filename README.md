# tts-alarmserver

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-brightgreen)](https://nodejs.org)
[![Version](https://img.shields.io/badge/version-3.1.0-blue)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-production--ready-brightgreen)](#)

Modularer Open-Source-Alarmserver fuer **Feuerwehr, THW, Rettungsdienst, Werkfeuerwehren und Vereine**.

Erzeugt Sprachausgaben mit **Piper TTS** und streamt diese per **RTP (via ffmpeg)** an Lautsprecheranlagen.
Die Durchsage enthaelt **ausschliesslich** Alarmstichwort und Einsatzort – alle Metadaten werden automatisch herausgefiltert.

Ab **v3.1** steht ein Live-Dashboard unter `/dashboard` bereit, das per WebSocket in Echtzeit ueber Serverstatus, aktuelle Durchsage, Queue, Alarmhistorie und Fehlerlog informiert.

---

## Inhaltsverzeichnis

- [Features](#features)
- [Dashboard (v3.1)](#dashboard-v31)
- [Durchsage-Beispiel](#durchsage-beispiel)
- [Architektur](#architektur)
- [Projektstruktur](#projektstruktur)
- [Voraussetzungen](#voraussetzungen)
- [Installation](#installation)
- [Konfiguration](#konfiguration)
- [Start](#start)
- [REST API](#rest-api)
- [Sprachoptimierung](#sprachoptimierung)
- [Logging](#logging)
- [systemd Service](#systemd-service)
- [Lizenz](#lizenz)

---

## Features

- 🔊 **Piper TTS** – hochwertige deutsche Sprachsynthese (Thorsten-Stimme)
- 📡 **RTP-Streaming** – Multicast und Unicast via ffmpeg, G.711 µ-law
- 🚒 **Intelligente Alarmtext-Bereinigung** – nur Alarmstichwort + Einsatzort werden gesprochen
- 🏢 **Einsatzortzusatz-Erkennung** – OG 2, EG, Hinterhaus, Tor 3 etc. werden erkannt und gesprochen
- 🗣️ **Sprachoptimierung** – `B2 → Brand zwei`, `A39 → Autobahn neununddreissig`, `Str. → Strasse`
- 🔢 **Zahlenkonvertierung** – `43 → dreiundvierzig`, `105 → einhundertfuenf`
- 🔤 **Unicode-Reparatur** – Windows-1252-Fehlkodierungen, Zero-Width-Zeichen, NFC-Normalisierung
- 📋 **Serialisierungsqueue** – Alarmierungen laufen nacheinander, kein Audio-Ueberlapp
- 📝 **Strukturiertes Logging** – Request-ID, Dauer, bereinigter/gesprochener Text pro Alarm
- 🛡️ **Fehlertoleranz** – Timeouts auf allen externen Prozessen, kein Server-Absturz bei Einzelfehlern
- 📊 **REST API** – `/api/alarm`, `/api/divera`, `/api/status`, `/api/history`
- 🔔 **Divera 24/7 Integration** – Direkter Webhook-Empfang inkl. Node-RED msg.payload
- 🖥️ **Live-Dashboard** – WebSocket-basierte Echtzeit-Oberfläche unter `/dashboard` (v3.1)

---

## Dashboard (v3.1)

Das Dashboard ist nach dem Start unter `http://localhost:3000/dashboard` erreichbar.

### Panels

| Panel | Inhalt |
|---|---|
| **Serverstatus** | Uptime (Live-Ticker), RAM, aktive WS-Verbindungen |
| **Aktuelle Durchsage** | Text, Alarm-ID, Stimme, Fortschrittsbalken |
| **Warteschlange** | Alle wartenden Alarme mit Prioritaet und Quelle |
| **Alarmhistorie** | Letzte 50 abgeschlossene Alarmierungen |
| **Fehlerlog** | Letzte 20 Fehler mit Zeitstempel |

### Funktionen

- **Dark/Light-Mode** – per Button umschaltbar, Einstellung wird in `localStorage` gespeichert
- **Auto-Reconnect** – WebSocket-Verbindung wird mit exponentiellem Backoff (1 s → 30 s) automatisch wiederhergestellt
- **Delta-Updates** – nur geaenderte Panels werden aktualisiert, kein Full-Reload
- **Snapshot on Connect** – neuer Browser-Tab erhaelt sofort den vollstaendigen Serverstatus

### WebSocket-Endpoint

```
ws://localhost:3000/ws/dashboard
```

Getrennt vom REST-WebSocket-Endpoint. Nachrichten-Schema:

```jsonc
// Snapshot (on connect)
{ "type": "snapshot", "uptime": 3600, "wsClients": 2, "currentSpeech": null, "queue": [], "history": [...], "errors": [] }

// Delta-Updates
{ "type": "speech",  "payload": { "text": "Brand zwei. ...", "alarmId": "a3f9c1", "voice": "de_DE-thorsten-high.onnx", "startedAt": 1721475600000, "durationMs": 4800 } }
{ "type": "queue",   "payload": [ { "id": "b2e4f1", "priority": 5, "source": "api", "text": "...", "queuedAt": 1721475601000 } ] }
{ "type": "history", "payload": [ ... ] }
{ "type": "error",   "payload": [ { "message": "Piper timeout", "ts": 1721475602000 } ] }
```

---

## Durchsage-Beispiel

Eingehender Rohalarmtext:

```
B2 Verdaechtiger Rauch

Sondersignal: Ja
Datum: 20.07.2026
Zeit: 10:02

Einheiten:
WF 99-99-1
WF 99-99-2

Ort:
Bienenwald Bauwagen
```

Resultierende Durchsage:

```
Brand zwei. Einsatzort: Bienenwald Bauwagen.
```

Mehr wird **nicht** gesprochen.

---

## Architektur

```
HTTP POST /api/alarm          HTTP POST /api/divera
        │                              │
        │                    diveraAdapter.js   ← title / text / address bereinigen
        │                              │
        └──────────────────────────────┘
                          │
                          ▼
                  alarmCleaner.js       ← Alarmtext bereinigen (nur Stichwort + Ort + Zusatz)
                          │
                          ▼
                  speechEnhancer.js     ← Unicode · Alarm-Codes · Strassen · Abkuerzungen · Zahlen
                          │
                          ▼
                  queueService.js       ← Serialisierung (Concurrency = 1) + Dashboard-Notify
                          │
                          ▼
                  piperService.js       ← Text → WAV (mit Timeout + intelligentem Chunk-Split)
                          │
                          ▼
                  ffmpegService.js      ← WAV-Merge + RTP-Konvertierung (G.711 µ-law)
                          │
                          ▼
                  rtpStreamer.js        ← RTP-Stream an Lautsprecheranlage
                          │
                          ▼
                  alarmService.js       ← Dashboard-State: setCurrentSpeech / addToHistory / addError
                          │
                          ▼
                  alarmLog.js           ← Protokollierung: requestId · Dauer · Texte · Status
```

```
                  dashboardState.js     ← In-Memory-State (Singleton + EventEmitter)
                          │
                          ▼
                  websocket/server.js   ← WS-Push an alle /ws/dashboard-Clients
                          │
                          ▼
                  public/dashboard/     ← Browser-UI (Dark/Light, Auto-Reconnect)
```

---

## Projektstruktur

```
tts-alarmserver/
├── server.js                        # Einstiegspunkt, SIGTERM/SIGINT-Handling
├── src/
│   ├── app.js                       # Express-Setup, Middleware-Chain, /dashboard-Route
│   ├── config/
│   │   ├── index.js                 # Zentrale Konfiguration (.env)
│   │   └── dashboard.js             # Dashboard-Optionen (Reconnect, Limits)
│   ├── logging/
│   │   ├── logger.js                # Schlankes strukturiertes Logging
│   │   └── alarmLog.js              # Alarm-spezifisches Protokoll
│   ├── tts/
│   │   ├── alarmCleaner.js
│   │   ├── diveraAdapter.js
│   │   ├── speechEnhancer.js
│   │   └── mappings/
│   │       ├── alarmMapping.js
│   │       └── roadMapping.js
│   ├── utils/
│   │   ├── unicode.js
│   │   ├── numbers.js
│   │   ├── textSplitter.js
│   │   ├── tempFiles.js
│   │   └── requestId.js
│   ├── services/
│   │   ├── alarmService.js          # Haupt-Orchestrierung + Dashboard-Hooks
│   │   ├── dashboardState.js        # In-Memory-State fuer Dashboard (v3.1)
│   │   ├── piperService.js
│   │   ├── ffmpegService.js
│   │   ├── historyService.js
│   │   ├── queueService.js          # Queue + Dashboard-Notify (v3.1)
│   │   └── websocketService.js      # Bestehender WS-Service (REST-Clients)
│   ├── streaming/
│   │   └── rtpStreamer.js
│   ├── routes/
│   │   ├── alarm.js
│   │   ├── divera.js
│   │   ├── status.js
│   │   ├── history.js
│   │   └── dashboard.js             # GET /dashboard → HTML-Shell (v3.1)
│   ├── websocket/
│   │   └── server.js                # WS-Endpoint /ws/dashboard (v3.1)
│   └── middleware/
│       ├── requestLogger.js
│       └── errorHandler.js
├── public/
│   ├── index.html                   # Redirect → /dashboard
│   └── dashboard/                   # Live-Dashboard-Frontend (v3.1)
│       ├── index.html
│       ├── dashboard.js
│       └── dashboard.css
├── .env.example
├── package.json
└── README.md
```

---

## Voraussetzungen

| Komponente | Version | Hinweis |
|---|---|---|
| Node.js | ≥ 20 LTS | `node --version` |
| Piper | aktuell | [rhasspy/piper](https://github.com/rhasspy/piper) |
| ffmpeg | ≥ 4.x | `apt install ffmpeg` |
| Voice-Modell | `.onnx` + `.onnx.json` | [Piper Voices](https://github.com/rhasspy/piper/releases) |

---

## Installation

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
wget https://github.com/rhasspy/piper/releases/latest/download/piper_linux_x86_64.tar.gz
tar -xzf piper_linux_x86_64.tar.gz
sudo mv piper/piper /usr/local/bin/piper
sudo chmod +x /usr/local/bin/piper
piper --version
```

### 4. Voice-Modell herunterladen

```bash
mkdir -p /opt/piper/models
wget -P /opt/piper/models/ https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx
wget -P /opt/piper/models/ https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx.json
```

### 5. Konfiguration

```bash
cp .env.example .env
nano .env
```

---

## Konfiguration

Alle Einstellungen in `.env`. Vollstaendige Referenz: [`.env.example`](.env.example)

| Variable | Standard | Beschreibung |
|---|---|---|
| `PORT` | `3000` | HTTP-Port |
| `HOST` | `0.0.0.0` | Bind-Adresse |
| `PIPER_BINARY` | `/usr/local/bin/piper` | Pfad zur Piper-Binary |
| `PIPER_MODEL` | `/opt/piper/models/de_DE-thorsten-high.onnx` | Voice-Modell |
| `PIPER_MAX_CHUNK` | `500` | Max. Zeichen pro TTS-Chunk |
| `PIPER_TIMEOUT_MS` | `30000` | Timeout fuer Piper (ms) |
| `FFMPEG_BINARY` | `ffmpeg` | Pfad zu ffmpeg |
| `FFMPEG_TIMEOUT_MS` | `60000` | Timeout fuer ffmpeg (ms) |
| `RTP_HOST` | `239.0.0.1` | Ziel-IP (Multicast oder Unicast) |
| `RTP_PORT` | `5004` | Ziel-Port |
| `RTP_CODEC` | `pcm_mulaw` | Audio-Codec (G.711) |
| `RTP_SAMPLE_RATE` | `8000` | Sample-Rate (Hz) |
| `RTP_CHANNELS` | `1` | Kanaele (Mono) |
| `TMP_DIR` | `/tmp/tts-alarm` | Verzeichnis fuer temporaere Dateien |
| `QUEUE_CONCURRENCY` | `1` | Parallele Alarmierungen |
| `QUEUE_MAX_SIZE` | `20` | Max. Warteschlangengroesse |
| `HISTORY_MAX_ENTRIES` | `100` | Max. Eintraege in der Alarmhistorie |
| `LOG_LEVEL` | `info` | `error`\|`warn`\|`info`\|`debug` |
| `DIVERA_GONG` | *(leer)* | Gong-Dateiname (ohne `.wav`) fuer Divera-Alarme |

---

## Start

```bash
# Produktion
npm start

# Entwicklung (mit Auto-Reload, Node.js >= 18)
npm run dev
```

Nach dem Start:
- **Dashboard:** `http://localhost:3000/dashboard`
- **API:** `http://localhost:3000/api/status`
- **WS:** `ws://localhost:3000/ws/dashboard`

---

## REST API

### POST /api/alarm

Alarmtext senden und Durchsage ausloesen.

```http
POST /api/alarm
Content-Type: application/json

{
  "text": "B2 Verdaechtiger Rauch\n\nSondersignal: Ja\nDatum: 20.07.2026\n\nOrt:\nOderwald Bauwagen Kindergarten"
}
```

**Antwort:** `200 OK`
```json
{
  "requestId": "a3f9c1",
  "success": true,
  "cleanText": "Brand zwei. Einsatzort: Oderwald Bauwagen Kindergarten.",
  "spokenText": "Brand zwei. Einsatzort: Oderwald Bauwagen Kindergarten."
}
```

---

### POST /api/divera

Divera 24/7 Webhook-Empfaenger.

```http
POST /api/divera
Content-Type: application/json

{
  "title": "B2 Wohnungsbrand",
  "text": "Rauch aus dem Dachgeschoss, Personen gemeldet",
  "address": "Musterstrasse 12, 38533 Vordorf OG 2",
  "priority": 1
}
```

**Antwort:** `202 Accepted`

---

### GET /api/status

```json
{ "status": "ok", "version": "3.1.0", "uptimeMs": 36000, "queue": { "running": 0, "waiting": 0 } }
```

---

### GET /api/history

```http
GET /api/history?limit=10
```

---

## Sprachoptimierung

### Alarmstichworte

| Eingabe | Ausgabe |
|---|---|
| `B1` | Brand eins |
| `B2` | Brand zwei |
| `TH1` | Technische Hilfe eins |
| `MANV1` | Massenanfall von Verletzten eins |

### Strassen & Abkuerzungen

| Eingabe | Ausgabe |
|---|---|
| `A39` | Autobahn neununddreissig |
| `B6` | Bundesstrasse sechs |
| `Str.` | Strasse |
| `OG2` | Obergeschoss zwei |

---

## Logging

```json
{
  "requestId": "a3f9c1",
  "durationMs": 1423,
  "success": true,
  "cleanText": "Brand zwei. Einsatzort: Oderwald Bauwagen Kindergarten.",
  "spokenText": "Brand zwei. Einsatzort: Oderwald Bauwagen Kindergarten."
}
```

---

## systemd Service

```ini
[Unit]
Description=TTS-Alarmserver v3.1
After=network.target

[Service]
Type=simple
User=tts
WorkingDirectory=/opt/tts-alarmserver
ExecStart=/usr/bin/node server.js
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
```

---

## Lizenz

[MIT](LICENSE) © TobiasKWF
