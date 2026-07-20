#!/usr/bin/env bash
# =============================================================
# TTS Alarmserver – Testskripte
# Verwendung: bash scripts/test-alarm.sh [host] [port]
# Beispiel:   bash scripts/test-alarm.sh 10.106.0.96 3000
# =============================================================

HOST="${1:-localhost}"
PORT="${2:-3000}"
BASE="http://${HOST}:${PORT}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓ $1${NC}"; }
info() { echo -e "${YELLOW}➤ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; }

echo ""
echo "============================================="
echo " TTS Alarmserver Testskript"
echo " Ziel: ${BASE}"
echo "============================================="
echo ""

# -------------------------------------------------------------
# 1. Health-Check
# -------------------------------------------------------------
info "1) Health-Check..."
RESP=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/health")
if [ "$RESP" = "200" ]; then
  pass "Health-Check OK (HTTP 200)"
else
  fail "Health-Check fehlgeschlagen (HTTP $RESP)"
fi

echo ""

# -------------------------------------------------------------
# 2. Divera – Brand 2 mit Einsatzortzusatz
# -------------------------------------------------------------
info "2) Divera – Brand 2 mit Einsatzortzusatz..."
curl -s -X POST "${BASE}/api/divera" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "B 2",
    "text": "B 2 - verdächtiger Rauch\nSondersignal: Ja\nEinsatzortzusatz: Oderwald Bauwagen Kindergarten\nDatum: 20.07.2026\nZeit: 10:02:04\nEinsatznummer: 1260104330\n\n----- Einheiten -----\n\nWF FFw Halchter\nWF FFw Linden",
    "address": "L495 WF-Halchter WF-Süd (07), L495",
    "priority": 1
  }' | python3 -m json.tool 2>/dev/null || echo "(kein JSON)"

echo ""
sleep 2

# -------------------------------------------------------------
# 3. Divera – Verkehrsunfall mit VP
# -------------------------------------------------------------
info "3) Divera – Verkehrsunfall H VU-1 mit VP..."
curl -s -X POST "${BASE}/api/divera" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "H V U-1",
    "text": "V U mit VP auslaufende Betriebsflüssigkeiten\n\n----- Einheiten -----\n\nWF 21-43-08\nWF 21-00-02",
    "address": "A36-Richtung Braunschweig, A36 WF-Süd (07) Richtung WF-West (06)",
    "priority": 1
  }' | python3 -m json.tool 2>/dev/null || echo "(kein JSON)"

echo ""
sleep 2

# -------------------------------------------------------------
# 4. Manuelle Durchsage
# -------------------------------------------------------------
info "4) Manuelle Durchsage via /announce..."
curl -s -X POST "${BASE}/announce" \
  -H "Content-Type: application/json" \
  -d '{"text": "Dies ist ein Test der Sprachausgabe. Alles in Ordnung."}' \
  | python3 -m json.tool 2>/dev/null || echo "(kein JSON)"

echo ""
sleep 2

# -------------------------------------------------------------
# 5. Fanfare
# -------------------------------------------------------------
info "5) Fanfare..."
curl -s -X POST "${BASE}/announce/fanfare" \
  -H "Content-Type: application/json" \
  -d '{"file": "fanfare.wav"}' \
  | python3 -m json.tool 2>/dev/null || echo "(kein JSON)"

echo ""
sleep 1

# -------------------------------------------------------------
# 6. Queue-Status
# -------------------------------------------------------------
info "6) Queue-Status..."
curl -s "${BASE}/api/status" | python3 -m json.tool 2>/dev/null || echo "(kein JSON)"

echo ""
info "Alle Tests gesendet. Logs prüfen mit:"
echo "  journalctl -u tts-alarmserver -f"
echo ""
