#!/usr/bin/env bash
# =============================================================
# TTS Alarmserver – Testskript
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

post_json() {
  local label="$1"
  local url="$2"
  local data="$3"
  local response
  local http_code

  response=$(curl -sS -w $'\n%{http_code}' -X POST "$url" \
    -H "Content-Type: application/json" \
    -d "$data")
  http_code="$(printf '%s\n' "$response" | tail -n 1)"
  response="$(printf '%s\n' "$response" | sed '$d')"

  if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
    pass "$label OK (HTTP $http_code)"
    printf '%s\n' "$response" | python3 -m json.tool 2>/dev/null || printf '%s\n' "$response"
    return 0
  fi

  fail "$label fehlgeschlagen (HTTP $http_code)"
  printf '%s\n' "$response"
  return 1
}

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
RESP=$(curl -sS -o /dev/null -w "%{http_code}" "${BASE}/health")
if [ "$RESP" = "200" ]; then
  pass "Health-Check OK (HTTP 200)"
else
  fail "Health-Check fehlgeschlagen (HTTP $RESP)"
fi

echo ""

# -------------------------------------------------------------
# 2. Alarmierung – genau ein API-Test
#    B 2 im Stichwort + VU mit VP in der Beschreibung
# -------------------------------------------------------------
info "2) Alarmierung via Divera – ein Test (B 2 + VU mit VP)..."
post_json "Divera-Alarmierung" "${BASE}/api/divera" '{
  "title": "B 2",
  "text": "B 2 - VU mit VP, verdächtiger Rauch\nSondersignal: Ja\nEinsatzortzusatz: Bienenwald Bauwagen\nEinsatznummer: 32423234\n\n----- Einheiten -----\n\nWF FFw Hometown\nWF FFw Leben",
  "address": "L495 WF-Homeland WF-West (07), L495",
  "priority": 1
}'

echo ""
sleep 2

# -------------------------------------------------------------
# 3. Freie TTS-Durchsage
# -------------------------------------------------------------
info "3) Freie TTS-Durchsage via /announce..."
post_json "TTS-Durchsage" "${BASE}/announce" '{
  "text": "Dies ist eine Testdurchsage des TTS Alarmservers. Die freie Sprachausgabe funktioniert."
}'

echo ""
sleep 2

# -------------------------------------------------------------
# 4. Fanfare
# -------------------------------------------------------------
info "4) Fanfare..."
post_json "Fanfare" "${BASE}/announce/fanfare" '{"file":"fanfare.wav"}'

echo ""
sleep 1

# -------------------------------------------------------------
# 5. Queue-Status
# -------------------------------------------------------------
info "5) Queue-Status..."
curl -sS "${BASE}/api/status" | python3 -m json.tool 2>/dev/null || echo "(kein JSON)"

echo ""
info "Tests gesendet. Logs prüfen mit:"
echo "  journalctl -u tts-alarmserver -f"
echo ""
