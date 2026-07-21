# tts-alarmserver

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-brightgreen)](https://nodejs.org)
[![Version](https://img.shields.io/badge/version-3.1.0-blue)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-production--ready-brightgreen)](#)

Modularer Open-Source-Alarmserver für **Feuerwehr, THW, Rettungsdienst, Werkfeuerwehren und Vereine**.

Erzeugt Sprachausgaben mit **Piper TTS** und streamt diese per **RTP (via ffmpeg)** an Lautsprecheranlagen.
Die Durchsage enthält die **vollständige erste Alarmzeile** – also Alarmstichwort inklusive Einsatzbeschreibung – sowie Einsatzort und optionales Einsatzobjekt. Metadaten wie Datum, Zeit, Einheiten und Fahrzeuge werden automatisch herausgefiltert.

Ab **v3.1** steht ein Live-Dashboard unter `/dashboard` bereit, das per WebSocket in Echtzeit über Serverstatus, aktuelle Durchsage, Queue, Alarmhistorie und Fehlerlog informiert.

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

- 🔊 **Piper TTS** – hochwertige deutsche Sprachsynthese (Thorsten-Stimme: low / medium / high)
- 📡 **RTP-Streaming** – Multicast und Unicast via ffmpeg, G.711 µ-law
- 🚒 **Intelligente Alarmtext-Bereinigung** – nur Alarmstichwort + Einsatzort werden gesprochen
- 🏢 **Einsatzortzusatz-Erkennung** – OG 2, EG, Hinterhaus, Tor 3 etc. werden erkannt und gesprochen
- 🗣️ **Sprachoptimierung** – `B2 → Brand zwei`, `A39 → Autobahn neununddreißig`, `Str. → Straße`
- 🔢 **Zahlenkonvertierung** – `43 → dreiundvierzig`, `105 → einhundertfünf`
- 🔤 **Unicode-Reparatur** – Windows-1252-Fehlkodierungen, Zero-Width-Zeichen, NFC-Normalisierung
- 📋 **Serialisierungsqueue** – Alarmierungen laufen nacheinander, kein Audio-Überlapp
- 📝 **Strukturiertes Logging** – Winston + tägliche Rotation, Request-ID pro Alarm
- 🛡️ **Fehlertoleranz** – Timeouts auf allen externen Prozessen, kein Server-Absturz bei Einzelfehlern
- 📊 **REST API** – `/api/alarm`, `/api/divera`, `/api/status`, `/api/health`, `/api/history`, `/api/stats`, `/api/voices`
- 🎙️ **Direkte Durchsage** – `/announce` (TTS ohne Bereinigung) und `/announce/fanfare` (Audio-Datei direkt streamen)
- 🔔 **Divera 24/7 Integration** – Direkter Webhook-Empfang inkl. Node-RED `msg.payload`
- 🖥️ **Live-Dashboard** – WebSocket-basierte Echtzeit-Oberfläche unter `/dashboard` (v3.1)

---

## Dashboard (v3.1)

Das Dashboard ist nach dem Start unter `http://<IP>:3000/dashboard` erreichbar.

### Panels

| Panel | Inhalt |
|---|---|
| **Serverstatus** | Uptime (Live-Ticker), RAM, aktive WS-Verbindungen |
| **Aktuelle Durchsage** | Text, Alarm-ID, Stimme, Fortschrittsbalken |
| **Warteschlange** | Alle wartenden Alarme mit Priorität und Quelle |
| **Alarmhistorie** | Letzte 50 abgeschlossene Alarmierungen |
| **Fehlerlog** | Letzte 20 Fehler mit Zeitstempel |

### Funktionen

- **Dark/Light-Mode** – per Button umschaltbar, Einstellung wird in `localStorage` gespeichert
- **Auto-Reconnect** – WebSocket-Verbindung wird mit exponentiellem Backoff (1 s → 30 s) automatisch wiederhergestellt
- **Delta-Updates** – nur geänderte Panels werden aktualisiert, kein Full-Reload
- **Snapshot on Connect** – neuer Browser-Tab erhält sofort den vollständigen Serverstatus

### WebSocket-Endpoint

```
ws://<IP>:3000/ws/dashboard
```

Nachrichten-Schema:

```jsonc
// Snapshot (on connect)
{ "type": "snapshot", "server": { "uptime": 3600, "wsClients": 2, "memory": { ... } }, "currentSpeech": null, "queue": [], "history": [...], "errors": [] }

// Delta-Updates
{ "type": "speech",       "payload": { "text": "Brand zwei. ...", "alarmId": "a3f9c1", "voice": "de_DE-thorsten-high.onnx", "startedAt": 1721475600000, "durationMs": 4800 } }
{ "type": "speech:clear", "payload": null }
{ "type": "queue",        "payload": [ { "id": "b2e4f1", "priority": 5, "source": "api", "text": "..." } ] }
{ "type": "history",      "payload": [ ... ] }
{ "type": "error",        "payload": [ { "message": "Piper timeout", "ts": 1721475602000 } ] }
{ "type": "server",       "payload": { "uptime": 3610, "wsClients": 1, "memory": { ... } } }
```

---

## Durchsage-Beispiel

Eingehender Rohalarmtext:

```
B2 Verdächtiger Rauch

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

```text
Brand zwei Verdächtiger Rauch. Einsatzort: Bienenwald Bauwagen.
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
                  speechEnhancer.js     ← Unicode · Alarm-Codes · Straßen · Abkürzungen · Zahlen
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
├── server.js                        # Einstiegspunkt, HTTP-Server-Wrapper, SIGTERM/SIGINT
├── src/
│   ├── app.js                       # Express-Setup, Middleware-Chain, Routen
│   ├── config/
│   │   ├── index.js                 # Zentrale Konfiguration (.env)
│   │   └── dashboard.js             # Dashboard-Optionen (Reconnect, Limits)
│   ├── logging/
│   │   ├── logger.js                # Schlankes strukturiertes Logging (kein ext. Dep.)
│   │   └── alarmLog.js              # Alarm-spezifisches Protokoll
│   ├── utils/
│   │   ├── logger.js                # Winston-Logger mit täglicher Log-Rotation
│   │   ├── unicode.js
│   │   ├── numbers.js
│   │   ├── textSplitter.js
│   │   ├── tempFiles.js
│   │   └── requestId.js
│   ├── tts/
│   │   ├── alarmCleaner.js
│   │   ├── diveraAdapter.js
│   │   ├── speechEnhancer.js
│   │   └── mappings/
│   │       ├── alarmMapping.js
│   │       └── roadMapping.js
│   ├── services/
│   │   ├── alarmService.js          # Haupt-Orchestrierung + Dashboard-Hooks
│   │   ├── dashboardState.js        # In-Memory-State für Dashboard (v3.1)
│   │   ├── piperService.js
│   │   ├── piperDaemon.js           # Persistenter Piper-Prozess
│   │   ├── ffmpegService.js
│   │   ├── historyService.js
│   │   ├── normalizationService.js
│   │   ├── queueService.js          # Queue + Dashboard-Notify (v3.1)
│   │   └── websocketService.js
│   ├── streaming/
│   │   └── rtpStreamer.js
│   ├── routes/
│   │   ├── alarm.js
│   │   ├── announce.js
│   │   ├── divera.js
│   │   ├── status.js
│   │   ├── health.js
│   │   ├── history.js
│   │   ├── stats.js
│   │   ├── voices.js
│   │   └── dashboard.js             # GET /dashboard → HTML-Shell (v3.1)
│   ├── websocket/
│   │   └── server.js                # WS-Endpoint /ws/dashboard (v3.1)
│   ├── errors/
│   │   └── index.js                 # Benutzerdefinierte Fehlerklassen
│   └── middleware/
│       ├── requestLogger.js
│       └── errorHandler.js
├── public/
│   ├── index.html                   # Redirect → /dashboard
│   └── dashboard/                   # Live-Dashboard-Frontend (v3.1)
│       ├── index.html
│       ├── dashboard.js
│       └── dashboard.css
├── scripts/
│   ├── install.sh                   # Vollautomatische Installation (Debian 12 / Proxmox LXC)
│   ├── create-lxc.sh                # Proxmox LXC-Container anlegen
│   └── test-alarm.sh                # Test-Alarm absenden
├── .env.example
├── package.json
└── README.md
```

---

## Voraussetzungen

| Komponente | Version | Hinweis |
|---|---|---|
| Node.js | ≥ 20 LTS | `node --version` |
| npm-Pakete | siehe `package.json` | `express`, `dotenv`, `ws`, `winston`, `uuid`, `express-validator` |
| Piper | 2023.11.14-2 | [rhasspy/piper Releases](https://github.com/rhasspy/piper/releases) |
| ffmpeg | ≥ 4.x | `apt install ffmpeg` |
| espeak-ng | aktuell | Wird von Piper benötigt: `apt install espeak-ng espeak-ng-data` |
| Voice-Modell | `.onnx` + `.onnx.json` | [rhasspy/piper-voices auf HuggingFace](https://huggingface.co/rhasspy/piper-voices) |

---

## Installation

### Empfohlen: Vollautomatisch (Debian 12 / Proxmox LXC)

Das Install-Script installiert Node.js 22 LTS, ffmpeg, espeak-ng, Piper TTS, das Repository, alle npm-Pakete sowie den systemd-Service vollautomatisch:

```bash
curl -fsSL https://raw.githubusercontent.com/TobiasKWF/tts-alarmserver/main/scripts/install.sh | bash
```

oder manuell:

```bash
wget https://raw.githubusercontent.com/TobiasKWF/tts-alarmserver/main/scripts/install.sh
chmod +x install.sh
sudo ./install.sh
```

> **Hinweis:** Das Script wurde auf **Debian 12 (Bookworm)** getestet und setzt root-Rechte voraus.

### Manuell

#### 1. Repository klonen

```bash
git clone https://github.com/TobiasKWF/tts-alarmserver.git /opt/tts-alarmserver
cd /opt/tts-alarmserver
npm install --omit=dev
```

#### 2. Systempakete installieren

```bash
sudo apt update && sudo apt install -y ffmpeg espeak-ng espeak-ng-data
```

#### 3. Piper installieren

```bash
wget https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz
mkdir -p /opt/piper
tar -xzf piper_linux_x86_64.tar.gz -C /opt/piper --strip-components=1
sudo ln -sf /opt/piper/piper /usr/local/bin/piper
sudo chmod +x /opt/piper/piper
```

#### 4. Voice-Modell herunterladen

```bash
mkdir -p /opt/tts-alarmserver/voices
wget -P /opt/tts-alarmserver/voices/ \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx
wget -P /opt/tts-alarmserver/voices/ \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/high/de_DE-thorsten-high.onnx.json
```

> **Hinweis zu Qualitätsstufen** – je nach Hardware:
>
> | Modell | Dauer | Empfehlung |
> |---|---|---|
> | `thorsten-low` | ~2–4 s | Schwache Hardware / LXC |
> | `thorsten-medium` | ~11–13 s | Dedizierte Hardware |
> | `thorsten-high` | ~20–25 s | Höchste Qualität |

#### 5. Konfiguration

```bash
cp .env.example .env
nano .env
```

---

## Konfiguration

Alle Einstellungen in `.env`. Vollständige Referenz: [`.env.example`](.env.example)

| Variable | Standard | Beschreibung |
|---|---|---|
| `PORT` | `3000` | HTTP-Port |
| `HOST` | `0.0.0.0` | Bind-Adresse |
| `PIPER_BINARY` | `/usr/local/bin/piper` | Pfad zur Piper-Binary |
| `PIPER_MODEL` | `/opt/piper/models/de_DE-thorsten-low.onnx` | Voice-Modell (low empfohlen für LXC) |
| `PIPER_OUTPUT_SAMPLE_RATE` | `16000` | Ausgabe-Samplerate des Modells (thorsten-low: 16000, medium/high: 22050) |
| `PIPER_LENGTH_SCALE` | `1.0` | Sprechgeschwindigkeit (< 1.0 = schneller, > 1.0 = langsamer) |
| `PIPER_MAX_CHUNK` | `500` | Max. Zeichen pro TTS-Chunk |
| `PIPER_TIMEOUT_MS` | `30000` | Timeout für Piper (ms) |
| `FFMPEG_BINARY` | `ffmpeg` | Pfad zu ffmpeg |
| `FFMPEG_TIMEOUT_MS` | `60000` | Timeout für ffmpeg (ms) |
| `ALARM_GONG_FILE` | `gong.wav` | Gong-Datei vor Durchsagen (leer = deaktiviert) |
| `RTP_HOST` | `239.0.0.1` | Ziel-IP (Multicast oder Unicast) |
| `RTP_PORT` | `5004` | Ziel-Port |
| `RTP_CODEC` | `pcm_mulaw` | Audio-Codec (G.711 µ-law) |
| `RTP_SAMPLE_RATE` | `8000` | Sample-Rate (Hz) |
| `RTP_CHANNELS` | `1` | Kanäle (Mono) |
| `TMP_DIR` | `/tmp/tts-alarm` | Verzeichnis für temporäre Dateien |
| `QUEUE_CONCURRENCY` | `1` | Parallele Alarmierungen |
| `QUEUE_MAX_SIZE` | `20` | Max. Warteschlangengröße |
| `HISTORY_MAX_ENTRIES` | `100` | Max. Einträge in der Alarmhistorie |
| `LOG_LEVEL` | `info` | `error`\|`warn`\|`info`\|`debug` |

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
- **WebSocket:** `ws://localhost:3000/ws/dashboard`

---

## REST API

### Übersicht aller Endpunkte

| Methode | Pfad | Beschreibung |
|---|---|---|
| `POST` | `/api/alarm` | Alarmtext empfangen → TTS + RTP mit Bereinigung |
| `POST` | `/api/divera` | Divera 24/7 Webhook-Empfänger |
| `POST` | `/announce` | Direkte Durchsage ohne Alarmtext-Bereinigung |
| `POST` | `/announce/fanfare` | Audiodatei direkt per RTP streamen (kein TTS) |
| `GET` | `/api/status` | Queue-Status und Server-Uptime |
| `GET` | `/api/health` | Liveness-Probe |
| `GET` | `/api/health/ready` | Readiness-Probe |
| `GET` | `/api/history` | Letzte N Alarmierungen |
| `GET` | `/api/stats` | Aggregierte Server-Statistiken |
| `GET` | `/api/stats/history` | Alarmhistorie mit Paginierung |
| `GET` | `/api/voices` | Installierte Piper-Stimmen auflisten |
| `POST` | `/api/voices` | Standard-Stimme ändern (API-Key erforderlich) |

---

### POST /api/alarm

Alarmtext senden und Durchsage mit vollständiger Bereinigungspipeline auslösen.

**Body-Felder:**

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `text` | string | ✅ | Roher Alarmtext (auch als `alarmtext` oder plain-text body akzeptiert) |

```http
POST /api/alarm
Content-Type: application/json

{
  "text": "B2 Verdächtiger Rauch\n\nSondersignal: Ja\nDatum: 20.07.2026\n\nOrt:\nOderwald Bauwagen Kindergarten"
}
```

**Antwort `200 OK`:**
```json
{
  "requestId": "a3f9c1",
  "success": true,
  "cleanText": "Brand zwei. Einsatzort: Oderwald Bauwagen Kindergarten.",
  "spokenText": "Brand zwei. Einsatzort: Oderwald Bauwagen Kindergarten."
}
```

**Fehlerantworten:**

| Code | Bedeutung |
|---|---|
| `400` | Kein oder leerer Alarmtext |
| `429` | Queue voll (`QUEUE_MAX_SIZE` überschritten) |
| `500` | Interner Fehler (Piper/ffmpeg) |

**curl-Beispiel:**
```bash
curl -s -X POST http://localhost:3000/api/alarm \
  -H "Content-Type: application/json" \
  -d '{"text":"B2 Verdächtiger Rauch\n\nOrt:\nMusterstraße 12"}'
```

---

### POST /api/divera

Divera 24/7 Webhook-Empfänger. Der Payload wird über `diveraAdapter.js` zu einem Rohtext zusammengebaut und dann durch dieselbe Bereinigungspipeline wie `/api/alarm` geleitet.

**Body-Felder:**

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `title` | string | ⚠️ | Alarmstichwort (mindestens `title` oder `text` erforderlich) |
| `text` | string | ⚠️ | Ergänzender Alarmtext |
| `address` | string | ❌ | Einsatzadresse |
| `priority` | integer 1–10 | ❌ | Queue-Priorität (Standard: aus Config) |
| `ucr_self_status_id` | integer | ❌ | Divera-Status-ID (wird ignoriert, aber validiert) |

```http
POST /api/divera
Content-Type: application/json

{
  "title": "B2 Wohnungsbrand",
  "text": "Rauch aus dem Dachgeschoss, Personen gemeldet",
  "address": "Musterstraße 12, 38533 Vordorf OG 2",
  "priority": 1
}
```

**Antwort `202 Accepted`:**
```json
{
  "ok": true,
  "alarmId": "550e8400-e29b-41d4-a716-446655440000",
  "position": 0,
  "message": "Divera-Alarm in Queue eingereiht"
}
```

**Node-RED Beispiel** (`msg.payload` direkt weitergeben):
```javascript
// HTTP-Request-Node Konfiguration
msg.url = "http://localhost:3000/api/divera";
msg.method = "POST";
// msg.payload enthält bereits { title, text, address }
return msg;
```

---

### POST /announce

Direkte TTS-Durchsage **ohne** Alarmtext-Bereinigung. Der Text wird unverändert an Piper übergeben.

**Body-Felder:**

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `text` | string | ✅ | Sprachtext (max. 2000 Zeichen) |
| `priority` | integer 1–10 | ❌ | Queue-Priorität |

```http
POST /announce
Content-Type: application/json

{
  "text": "Achtung, Achtung. Einsatz für alle Kräfte. Bitte sofort ausrücken.",
  "priority": 1
}
```

**Antwort `202 Accepted`:**
```json
{
  "ok": true,
  "alarmId": "550e8400-e29b-41d4-a716-446655440001",
  "position": 0,
  "message": "Durchsage in Queue eingereiht"
}
```

**curl-Beispiel:**
```bash
curl -s -X POST http://localhost:3000/announce \
  -H "Content-Type: application/json" \
  -d '{"text":"Testdurchsage läuft.", "priority": 5}'
```

---

### POST /announce/fanfare

Spielt eine Audio-Datei **direkt per RTP** ab – ohne TTS-Verarbeitung. Nützlich für Gongsignale, Sirenen oder vorgefertigte Audiodateien.

**Body-Felder:**

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `file` | string | ✅ | Dateiname (max. 200 Zeichen, relativ zum konfigurierten Verzeichnis) |
| `priority` | integer 1–10 | ❌ | Queue-Priorität |

```http
POST /announce/fanfare
Content-Type: application/json

{
  "file": "gong.wav",
  "priority": 1
}
```

**Antwort `202 Accepted`:**
```json
{
  "ok": true,
  "alarmId": "550e8400-e29b-41d4-a716-446655440002",
  "position": 0,
  "message": "Fanfare \"gong.wav\" in Queue eingereiht"
}
```

---

### GET /api/status

Gibt Queue-Status und Server-Uptime zurück.

```http
GET /api/status
```

**Antwort `200 OK`:**
```json
{
  "status": "ok",
  "version": "3.0.0",
  "uptimeMs": 36000,
  "queue": {
    "running": 0,
    "waiting": 0
  }
}
```

---

### GET /api/health

Liveness-Probe – prüft ob der Server erreichbar ist.

```http
GET /api/health
```

**Antwort `200 OK`:**
```json
{
  "ok": true,
  "status": "up",
  "uptime": 3600,
  "timestamp": "2026-07-21T08:10:23.451Z"
}
```

---

### GET /api/health/ready

Readiness-Probe – prüft ob alle internen Services (Queue etc.) bereit sind.

```http
GET /api/health/ready
```

**Antwort `200 OK` (bereit):**
```json
{
  "ok": true,
  "status": "ready",
  "checks": {
    "queue": "ok"
  },
  "uptime": 3600,
  "timestamp": "2026-07-21T08:10:23.451Z"
}
```

**Antwort `503 Service Unavailable` (nicht bereit):**
```json
{
  "ok": false,
  "status": "not_ready",
  "checks": {
    "queue": "error"
  },
  "uptime": 5,
  "timestamp": "2026-07-21T08:00:05.000Z"
}
```

**Docker/Kubernetes Healthcheck Beispiel:**
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/api/health/ready"]
  interval: 30s
  timeout: 10s
  retries: 3
```

---

### GET /api/history

Gibt die letzten N abgeschlossenen Alarmierungen zurück.

**Query-Parameter:**

| Parameter | Typ | Standard | Beschreibung |
|---|---|---|---|
| `limit` | integer 1–100 | `20` | Anzahl zurückgegebener Einträge |

```http
GET /api/history?limit=10
```

**Antwort `200 OK`:**
```json
[
  {
    "requestId": "a3f9c1",
    "cleanText": "Brand zwei. Einsatzort: Oderwald Bauwagen Kindergarten.",
    "spokenText": "Brand zwei. Einsatzort: Oderwald Bauwagen Kindergarten.",
    "durationMs": 4800,
    "timestamp": "2026-07-21T08:10:23.451Z"
  }
]
```

---

### GET /api/stats

Liefert aggregierte Server-Statistiken inkl. Speicher, Queue, WebSocket-Verbindungen und RTP-Konfiguration.

```http
GET /api/stats
```

**Antwort `200 OK`:**
```json
{
  "ok": true,
  "server": {
    "version": "3.1.0",
    "nodeEnv": "production",
    "uptime": 3610,
    "uptimeHuman": "0d 1h 0m 10s",
    "pid": 1234,
    "memory": {
      "heapUsedMB": 42,
      "heapTotalMB": 64,
      "rssMB": 80
    }
  },
  "queue": {
    "running": 0,
    "waiting": 0,
    "maxSize": 20
  },
  "websocket": {
    "connectedClients": 2
  },
  "rtp": {
    "host": "239.0.0.1",
    "port": 5004,
    "codec": "pcm_mulaw",
    "bitrate": 64000
  },
  "timestamp": "2026-07-21T09:10:33.000Z"
}
```

---

### GET /api/stats/history

Alarmhistorie mit Paginierung – detailliertere Variante von `/api/history`.

**Query-Parameter:**

| Parameter | Typ | Standard | Beschreibung |
|---|---|---|---|
| `limit` | integer 1–100 | `50` | Anzahl zurückgegebener Einträge |

```http
GET /api/stats/history?limit=20
```

**Antwort `200 OK`:**
```json
{
  "ok": true,
  "total": 20,
  "limit": 20,
  "history": [
    {
      "requestId": "a3f9c1",
      "cleanText": "Brand zwei. Einsatzort: Oderwald Bauwagen Kindergarten.",
      "durationMs": 4800,
      "timestamp": "2026-07-21T08:10:23.451Z"
    }
  ]
}
```

---

### GET /api/voices

Listet alle installierten Piper-Stimmen (`.onnx`-Dateien) im `voices/`-Verzeichnis.

```http
GET /api/voices
```

**Antwort `200 OK`:**
```json
{
  "ok": true,
  "defaultVoice": "de_DE-thorsten-high",
  "voicesDir": "/opt/tts-alarmserver/voices",
  "voices": [
    "de_DE-thorsten-high",
    "de_DE-thorsten-low",
    "de_DE-thorsten-medium"
  ]
}
```

---

### POST /api/voices

Ändert die Standard-Stimme zur Laufzeit. **Erfordert API-Key** im Header.

**Header:**

| Header | Beschreibung |
|---|---|
| `X-API-Key` | API-Schlüssel (konfiguriert via `API_KEY` in `.env`) |

**Body-Felder:**

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `voice` | string | ✅ | Name der Stimme ohne `.onnx`-Endung |

```http
POST /api/voices
Content-Type: application/json
X-API-Key: mein-geheimer-schluessel

{
  "voice": "de_DE-thorsten-low"
}
```

**Antwort `200 OK`:**
```json
{
  "ok": true,
  "voice": "de_DE-thorsten-low",
  "message": "Standard-Stimme auf \"de_DE-thorsten-low\" gesetzt"
}
```

**Fehlerantworten:**

| Code | Bedeutung |
|---|---|
| `401` | Kein oder ungültiger API-Key |
| `404` | Stimme nicht im `voices/`-Verzeichnis gefunden |
| `400` | Ungültige Parameter |

---

## Sprachoptimierung

### Alarmstichworte

| Eingabe | Ausgabe |
|---|---|
| `B1` | Brand eins |
| `B2` | Brand zwei |
| `TH1` | Technische Hilfe eins |
| `MANV1` | Massenanfall von Verletzten eins |

### Straßen & Abkürzungen

| Eingabe | Ausgabe |
|---|---|
| `A39` | Autobahn neununddreißig |
| `B6` | Bundesstraße sechs |
| `L495` | Landesstraße vierhundertfünfundneunzig |
| `Str.` | Straße |
| `OG 2` | Obergeschoss zwei |
| `WF-Halchter` | WF Halchter |

---

## Logging

Der Server verwendet **zwei Logger**:

- `src/logging/logger.js` – schlanker interner Logger (kein npm-Paket) für Express-Routen
- `src/utils/logger.js` – **Winston** mit täglicher Log-Dateirotation für Services und WebSocket

Log-Dateien werden in `logs/` abgelegt (konfigurierbar via `LOG_DIR` in `.env`):

```
logs/
├── server-YYYY-MM-DD.log    # Alle Lognachrichten (info+)
├── error-YYYY-MM-DD.log     # Nur Fehler
└── requests-YYYY-MM-DD.log  # HTTP-Requests (http-Level)
```

Beispiel-Logeintrag:

```json
{
  "timestamp": "2026-07-21 08:10:23.451",
  "level": "info",
  "message": "Alarm verarbeitet",
  "requestId": "a3f9c1",
  "durationMs": 1423,
  "cleanText": "Brand zwei. Einsatzort: Oderwald Bauwagen Kindergarten."
}
```

---

## systemd Service

Das Install-Script richtet den systemd-Service automatisch ein. Manuell:

```ini
[Unit]
Description=TTS-Alarmserver – Feuerwehr Sprachdurchsage via RTP
Documentation=https://github.com/TobiasKWF/tts-alarmserver
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/tts-alarmserver
EnvironmentFile=/opt/tts-alarmserver/.env
Environment=NODE_ENV=production
Environment=ESPEAK_DATA_PATH=/opt/piper
Environment=LD_LIBRARY_PATH=/opt/piper

ExecStart=/usr/bin/node /opt/tts-alarmserver/server.js
ExecReload=/bin/kill -HUP $MAINPID

Restart=on-failure
RestartSec=10s
StartLimitIntervalSec=120
StartLimitBurst=5

StandardOutput=journal
StandardError=journal
SyslogIdentifier=tts-alarmserver

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/tts-alarmserver/logs /opt/tts-alarmserver/tmp /opt/tts-alarmserver/gong /opt/tts-alarmserver/voices

LimitNOFILE=65535
LimitNPROC=1024

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable tts-alarmserver
sudo systemctl start tts-alarmserver

# Logs in Echtzeit
journalctl -fu tts-alarmserver

# Update
tts-alarmserver-update
```

---

## Lizenz

TobiasKWF Community License

Die Software darf von Feuerwehren, THW, Rettungsdiensten, Hilfsorganisationen und anderen gemeinnützigen Organisationen kostenlos genutzt werden.
Änderungen für den Eigengebrauch sind erlaubt.
Eine kommerzielle Nutzung, der Weiterverkauf oder die Einbindung in kommerzielle Produkte ist ohne schriftliche Genehmigung des Urhebers untersagt.
Copyright © TobiasKWF.

Copyright © TobiasKWF. All rights reserved.
Permission is hereby granted to fire departments, technical relief organizations, emergency medical services, humanitarian aid organizations, and other non-profit organizations to use this software free of charge.
Modifications to the software are permitted for the organization's own internal use.
Commercial use, resale, sublicensing, or incorporation of this software into commercial products or services is prohibited without the prior written permission of the copyright holder.
This software is provided "as is", without warranty of any kind. The copyright holder shall not be liable for any damages arising from the use of this software.
