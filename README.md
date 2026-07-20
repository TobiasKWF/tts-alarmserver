# tts-alarmserver

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-brightgreen)](https://nodejs.org)
[![Version](https://img.shields.io/badge/version-3.0.0-blue)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-production--ready-brightgreen)](#)

Modularer Open-Source-Alarmserver für **Feuerwehr, THW, Rettungsdienst, Werkfeuerwehren und Vereine**.

Erzeugt Sprachausgaben mit **Piper TTS** und streamt diese per **RTP (via ffmpeg)** an Lautsprecheranlagen.
Die Durchsage enthält **ausschließlich** Alarmstichwort und Einsatzort – alle Metadaten werden automatisch herausgefiltert.

---

## Inhaltsverzeichnis

- [Features](#features)
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
- 🗣️ **Sprachoptimierung** – `B2 → Brand zwei`, `A39 → Autobahn neununddreißig`, `Str. → Straße`
- 🔢 **Zahlenkonvertierung** – `43 → dreiundvierzig`, `105 → einhundertfünf`
- 🔤 **Unicode-Reparatur** – Windows-1252-Fehlkodierungen, Zero-Width-Zeichen, NFC-Normalisierung
- 📋 **Serialisierungsqueue** – Alarmierungen laufen nacheinander, kein Audio-Überlapp
- 📝 **Strukturiertes Logging** – Request-ID, Dauer, bereinigter/gesprochener Text pro Alarm
- 🛡️ **Fehlertoleranz** – Timeouts auf allen externen Prozessen, kein Server-Absturz bei Einzelfehlern
- 📊 **REST API** – `/api/alarm`, `/api/divera`, `/api/status`, `/api/history`
- 🔔 **Divera 24/7 Integration** – Direkter Webhook-Empfang inkl. Node-RED msg.payload

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
                  speechEnhancer.js     ← Unicode · Alarm-Codes · Straßen · Abkürzungen · Zahlen
                          │
                          ▼
                  queueService.js       ← Serialisierung (Concurrency = 1)
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
                  alarmLog.js           ← Protokollierung: requestId · Dauer · Texte · Status
```

---

## Projektstruktur

```
tts-alarmserver/
├── server.js                        # Einstiegspunkt, SIGTERM/SIGINT-Handling
├── src/
│   ├── app.js                       # Express-Setup, Middleware-Chain
│   ├── config/
│   │   └── index.js                 # Zentrale Konfiguration (.env)
│   ├── logging/
│   │   ├── logger.js                # Schlankes strukturiertes Logging
│   │   └── alarmLog.js              # Alarm-spezifisches Protokoll
│   ├── tts/
│   │   ├── alarmCleaner.js          # Regelbasierte Alarmtext-Bereinigung + Einsatzortzusatz
│   │   ├── diveraAdapter.js         # Divera-Payload → bereinigter TTS-Text
│   │   ├── speechEnhancer.js        # TTS-Optimierungspipeline
│   │   └── mappings/
│   │       ├── alarmMapping.js      # B2 → "Brand zwei", TH1 → "Technische Hilfe eins"
│   │       └── roadMapping.js       # A2 → "Autobahn zwei", Str. → "Straße"
│   ├── utils/
│   │   ├── unicode.js               # NFC, Win-1252-Reparatur, Steuerzeichen
│   │   ├── numbers.js               # 43 → "dreiundvierzig"
│   │   ├── textSplitter.js          # Intelligente Aufteilung (kein slice!)
│   │   ├── tempFiles.js             # Temp-Datei-Verwaltung mit Cleanup
│   │   └── requestId.js             # Eindeutige Request-IDs
│   ├── services/
│   │   ├── alarmService.js          # Haupt-Orchestrierung der Pipeline
│   │   ├── piperService.js          # Piper TTS mit Timeout
│   │   ├── ffmpegService.js         # WAV-Merge + RTP-Konvertierung
│   │   ├── historyService.js        # In-Memory Alarmhistorie
│   │   └── queueService.js          # Serialisierungsqueue, 429 bei Überlauf
│   ├── streaming/
│   │   └── rtpStreamer.js            # RTP-Streaming via ffmpeg
│   ├── routes/
│   │   ├── alarm.js                 # POST /api/alarm
│   │   ├── divera.js                # POST /api/divera (Divera 24/7 Webhook)
│   │   ├── status.js                # GET /api/status
│   │   └── history.js               # GET /api/history
│   └── middleware/
│       ├── requestLogger.js         # Request-Logging
│       └── errorHandler.js          # Globale Fehlerbehandlung
├── public/                          # Statische Web-Dateien
├── .env.example                     # Konfigurationsvorlage
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

Alle Einstellungen in `.env`. Vollständige Referenz: [`.env.example`](.env.example)

| Variable | Standard | Beschreibung |
|---|---|---|
| `PORT` | `3000` | HTTP-Port |
| `HOST` | `0.0.0.0` | Bind-Adresse |
| `PIPER_BINARY` | `/usr/local/bin/piper` | Pfad zur Piper-Binary |
| `PIPER_MODEL` | `/opt/piper/models/de_DE-thorsten-high.onnx` | Voice-Modell |
| `PIPER_MAX_CHUNK` | `500` | Max. Zeichen pro TTS-Chunk |
| `PIPER_TIMEOUT_MS` | `30000` | Timeout für Piper (ms) |
| `FFMPEG_BINARY` | `ffmpeg` | Pfad zu ffmpeg |
| `FFMPEG_TIMEOUT_MS` | `60000` | Timeout für ffmpeg (ms) |
| `RTP_HOST` | `239.0.0.1` | Ziel-IP (Multicast oder Unicast) |
| `RTP_PORT` | `5004` | Ziel-Port |
| `RTP_CODEC` | `pcm_mulaw` | Audio-Codec (G.711) |
| `RTP_SAMPLE_RATE` | `8000` | Sample-Rate (Hz) |
| `RTP_CHANNELS` | `1` | Kanäle (Mono) |
| `TMP_DIR` | `/tmp/tts-alarm` | Verzeichnis für temporäre Dateien |
| `QUEUE_CONCURRENCY` | `1` | Parallele Alarmierungen |
| `QUEUE_MAX_SIZE` | `20` | Max. Warteschlangengröße |
| `HISTORY_MAX_ENTRIES` | `100` | Max. Einträge in der Alarmhistorie |
| `LOG_LEVEL` | `info` | `error`\|`warn`\|`info`\|`debug` |
| `DIVERA_GONG` | *(leer)* | Gong-Dateiname (ohne `.wav`) für Divera-Alarme |

---

## Start

```bash
# Produktion
npm start

# Entwicklung (mit Auto-Reload, Node.js ≥ 18)
npm run dev
```

---

## REST API

### POST /api/alarm

Alarmtext senden und Durchsage auslösen.

```http
POST /api/alarm
Content-Type: application/json

{
  "text": "B2 Verdächtiger Rauch\n\nSondersignal: Ja\nDatum: 20.07.2026\n\nOrt:\nOderwald Bauwagen Kindergarten"
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

Der Body kann auch als `{ "alarmtext": "..." }` oder als Plain-Text übergeben werden.

---

### POST /api/divera

Divera 24/7 Webhook-Empfänger. Akzeptiert den **unveränderten `msg.payload`** aus einem Node-RED Divera-Webhook-Node.

Die Felder `title`, `text` und `address` werden bereinigt und zu einem natürlich klingenden TTS-Text zusammengebaut.
Im `address`-Feld enthaltene **Einsatzortzusätze** (z.B. `OG 2`, `EG`, `Hinterhaus`, `Tor 3`) werden automatisch erkannt und gesprochen.

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

> 💡 **Node-RED**: Der HTTP-Request-Node sendet `msg.payload` direkt als JSON-Body – keine Transformation nötig.

**Antwort:** `202 Accepted`
```json
{
  "ok": true,
  "alarmId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "position": 1,
  "spokenText": "Brand zwei Wohnungsbrand. Einsatzort: Musterstraße zwölf, Vordorf, Obergeschoss zwei.",
  "message": "Divera-Alarm in Queue eingereiht (Position 1)"
}
```

**Pflichtfelder:** Mindestens `title` **oder** `text` muss angegeben sein.

**Alle Felder:**

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `title` | string | nein* | Einsatzstichwort (z.B. `B2 Wohnungsbrand`) |
| `text` | string | nein* | Einsatzbeschreibung |
| `address` | string | nein | Einsatzadresse inkl. optionalem Zusatz |
| `priority` | integer 1–10 | nein | Queue-Priorität (Standard: Konfigurationswert) |

*Mindestens `title` oder `text` ist erforderlich.

#### Erkannte Einsatzortzusätze in `address`

Folgende Muster am Ende des `address`-Feldes werden automatisch als Zusatz erkannt:

| Muster | Beispiel | Gesprochen |
|---|---|---|
| `EG` | `Hauptstr. 5 EG` | `… Erdgeschoss` |
| `OG <n>` | `Bahnhofstr. 3 OG 2` | `… Obergeschoss zwei` |
| `DG` | `Ringstr. 8 DG` | `… Dachgeschoss` |
| `UG` | `Marktplatz 1 UG` | `… Untergeschoss` |
| `Hinterhaus` | `Lindenstr. 7 Hinterhaus` | `… Hinterhaus` |
| `Tor <n>` | `Industrieweg 12 Tor 3` | `… Tor drei` |
| `Aufgang <n>` | `Parkstr. 4 Aufgang 2` | `… Aufgang zwei` |

#### Einsatzortzusatz als eigene Sektion (Freitext-Alarm)

Bei Freitext-Alarmen über `/api/alarm` kann der Zusatz auch als eigene Zeile übergeben werden:

```
B2 Wohnungsbrand

Einsatzort:
Musterstraße 12, Vordorf

Einsatzortzusatz:
Obergeschoss 2
```

---

### GET /api/status

```http
GET /api/status
```

```json
{
  "status": "ok",
  "version": "3.0.0",
  "uptimeMs": 36000,
  "queue": {
    "running": 0,
    "waiting": 0,
    "maxConcurrency": 1,
    "maxSize": 20
  }
}
```

---

### GET /api/history

```http
GET /api/history?limit=10
```

Gibt die letzten N Alarmierungen zurück (max. 100).

---

## Sprachoptimierung

### Alarmstichworte (`tts/mappings/alarmMapping.js`)

| Eingabe | Ausgabe |
|---|---|
| `B1` | Brand eins |
| `B2` | Brand zwei |
| `TH1` | Technische Hilfe eins |
| `TH2` | Technische Hilfe zwei |
| `MANV1` | Massenanfall von Verletzten eins |
| `ABC1` | ABC-Lage eins |

Erweiterungen direkt in `alarmMapping.js` eintragen – kein Code-Eingriff nötig.

### Straßen & Abkürzungen (`tts/mappings/roadMapping.js`)

| Eingabe | Ausgabe |
|---|---|
| `A2` | Autobahn zwei |
| `A39` | Autobahn neununddreißig |
| `B6` | Bundesstraße sechs |
| `L615` | Landesstraße sechshundertfünfzehn |
| `K53` | Kreisstraße dreiundfünfzig |
| `Str.` | Straße |
| `HsNr.` | Hausnummer |
| `km` | Kilometer |
| `ca.` | circa |
| `OG2` | Obergeschoss zwei |

### Zahlen (`utils/numbers.js`)

| Eingabe | Ausgabe |
|---|---|
| `2` | zwei |
| `12` | zwölf |
| `43` | dreiundvierzig |
| `105` | einhundertfünf |

---

## Logging

Jede Alarmierung erzeugt einen strukturierten Log-Eintrag:

```json
{
  "requestId": "a3f9c1",
  "durationMs": 1423,
  "success": true,
  "cleanText": "Brand zwei. Einsatzort: Oderwald Bauwagen Kindergarten.",
  "spokenText": "Brand zwei. Einsatzort: Oderwald Bauwagen Kindergarten.",
  "error": null
}
```

Log-Level über `LOG_LEVEL` in `.env` steuerbar: `error | warn | info | debug`

---

## systemd Service

```ini
# /etc/systemd/system/tts-alarmserver.service
[Unit]
Description=TTS-Alarmserver v3
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
sudo systemctl status tts-alarmserver
```

---

## Lizenz

[MIT](LICENSE) © TobiasKWF
