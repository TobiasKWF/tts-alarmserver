#!/usr/bin/env bash
# =============================================================
# TTS Alarmserver – umfassendes TTS-Testskript
# Verwendung: bash scripts/test-alarm-comprehensive.sh [host] [port]
# Hinweis: Sendet mehrere Testalarme nacheinander an /api/divera.
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

post_alarm() {
  local label="$1"
  local title="$2"
  local text="$3"
  local address="$4"
  local additional="${5:-}"

  local payload
  payload=$(python3 - "$title" "$text" "$address" "$additional" <<'PY'
import json
import sys

title, text, address, additional = sys.argv[1:]
print(json.dumps({
    "title": title,
    "text": text + (("\n" + additional) if additional else ""),
    "address": address,
    "priority": 1,
}, ensure_ascii=False))
PY
)

  local response http_code
  response=$(curl -sS -w $'\n%{http_code}' -X POST "${BASE}/api/divera" \
    -H "Content-Type: application/json" \
    -d "$payload")
  http_code="$(printf '%s\n' "$response" | tail -n 1)"
  response="$(printf '%s\n' "$response" | sed '$d')"

  if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
    pass "$label OK (HTTP $http_code)"
  else
    fail "$label fehlgeschlagen (HTTP $http_code)"
    printf '%s\n' "$response"
    return 1
  fi

  sleep 2
}

echo ""
echo "============================================================="
echo " TTS Alarmserver – umfassender Alarm-Test"
echo " Ziel: ${BASE}"
echo "============================================================="
echo ""

info "Health-Check..."
RESP=$(curl -sS -o /dev/null -w "%{http_code}" "${BASE}/health")
if [ "$RESP" = "200" ]; then pass "Health-Check OK"; else fail "Health-Check HTTP $RESP"; exit 1; fi

echo ""

post_alarm "B 2 – Rauch / GV / WF-Halchter / Straßen" \
  "B 2" \
  "verdächtiger Rauch" \
  "L495, L495 WF-Halchter > A36-AS WF-Süd (07)" \
  "GV WF-Halchter"

post_alarm "B 2 – WF-Halchter / Zusatz" \
  "B 2" \
  "verdächtiger Rauch" \
  "L495, L495 WF-Halchter > A36-AS WF-Süd (07) (Oderwald Bauwagen Kindergarten)"

post_alarm "H ÖL-1 – Ölspur / A36 / PKW" \
  "H ÖL-1" \
  "Ölspur klein" \
  "A36-Richtung Braunschweig, A36 WF-Süd (07) > WF-West (06) (Abfahrt WF WEST zur K90)" \
  "PKW befindet sich in der Abfahrt WEST"

post_alarm "B 1 – PKW" \
  "B 1" \
  "brennt PKW" \
  "WF-Wolfenbüttel, Halchtersche Straße"

post_alarm "H VU-1 – E-Call" \
  "H VU-1" \
  "E-Call unklare Lage" \
  "WF-Halchter, Im Sommerfeld 1" \
  "2 Pkw"

post_alarm "B BMA – AH / Objekt" \
  "B BMA" \
  "BMA-Auslösung" \
  "WF-Wolfenbüttel, Im Kamp 3" \
  "AH AWO Im Kamp Wolfenbüttel"

post_alarm "H 1 – Wasser" \
  "H 1" \
  "Wasser im Keller" \
  "WF-Halchter, Alter Holzweg 16" \
  "Wasser im Keller Schützenhaus"

post_alarm "U WASSER – Unwetter" \
  "U WASSER" \
  "UNWETTER-Wasser im Keller" \
  "WF-Halchter, Siedlerstraße 7" \
  "Wasser im Keller, Ölheizung im Keller"

post_alarm "B 1 – PKW / A36" \
  "B 1" \
  "brennt PKW" \
  "A36-Richtung Harz, A36 WF-Süd (07) > WF-Flöthe (08)"

post_alarm "H VU-1 – VU mit VP" \
  "H VU-1" \
  "VU mit VP" \
  "L495, L495 A36-AS WF-Süd (07)"

post_alarm "H 1Y – Türöffnung / HP" \
  "H 1Y" \
  "Notfalltüröffnung HP vermutlich hinter verschlossener Tür" \
  "WF-Wolfenbüttel, Halchtersche Straße 8 A" \
  "Pflegedienst vor Ort, Pat. öffnet nicht die Tür, kam über Pol."

post_alarm "H 1 – Baum auf Stromleitung" \
  "H 1" \
  "Baum auf Stromleitung" \
  "L495, L495 A36-AS WF-Süd (07) > WF-Halchter" \
  "Baum 10-15 Meter hoch abgeknickt, hängt auf einer Hochspannungsleitung, POL vor Ort"

post_alarm "B BMA – AH Casa Reha" \
  "B BMA" \
  "BMA-Auslösung" \
  "WF-Wolfenbüttel, Dietrich-Bonhoeffer-Straße 14" \
  "AH Haus am Juliuspark Casa Reha"

post_alarm "H VU-2Y – zwei Verletzte" \
  "H VU-2Y" \
  "VU mit VP" \
  "L495, L495 WF-Halchter > A36-AS WF-Süd (07)" \
  "2 Verletzte Personen"

post_alarm "B 3Y – Brand groß / Menschenleben" \
  "B 3Y" \
  "Brand groß mit Menschenleben in Gefahr" \
  "WF-Fümmelse, Untere Dorfstraße 41" \
  "PA-Träger benötigt"

post_alarm "B 2 – Gartenlaube / GV" \
  "B 2" \
  "Gartenlauben-Brand" \
  "WF-Groß Stöckheim, Am Bache (Parzelle54)" \
  "GV Katzenmeer"

post_alarm "B 2Y – Wohnungsbrand / Menschenleben" \
  "B 2Y" \
  "Wohnungs-Brand mit Menschenleben in Gefahr" \
  "WF-Wolfenbüttel, Dürerstraße 14 (4.OG)"

post_alarm "H 3 – Explosion" \
  "H 3" \
  "technische Hilfeleistung groß nach Explosion" \
  "WF-Halchter, Harzburger Straße (Ecke Wasserstr.)"

post_alarm "H VU-1 – zwei Verletzte" \
  "H VU-1" \
  "VU mit VP" \
  "WF-Wolfenbüttel, Halchtersche Straße 49" \
  "VU mit 2 Verletzten"

post_alarm "H 0 – Rettungshund" \
  "H 0" \
  "Rettungshundeeinsatz Personensuche" \
  "WF-Wendessen, Leipziger Allee 19 (Gegenüber Hnr.19 Freifläche bei Papes Gemüsestand)" \
  "Treffpunkt Feuerwehrhaus Wendessen"

post_alarm "B 1 – PKW / E-Call bleibt" \
  "B 1" \
  "brennt PKW" \
  "A36-Richtung Harz, A36 WF-Süd (07) > WF-Flöthe (08)" \
  "Peugot: WF L-2705, Schmorrbrand Tür"

post_alarm "H GAS – Gasgeruch" \
  "H GAS" \
  "Gasgeruch" \
  "WF-Wolfenbüttel, Halchtersche Straße 63"

post_alarm "B WALD-1 – Waldbrand klein" \
  "B WALD-1" \
  "brennt Vegetation keine o. geringe Ausbreitungsgefahr" \
  "L495, L495 WF-Halchter > A36-AS WF-Süd (07)"

post_alarm "H GAS – austretendes Gas" \
  "H GAS" \
  "austretendes Gas" \
  "WF-Halchter, Im Honigtal 2" \
  "ausgelöster CO-Melder"

echo ""
pass "Alle umfassenden TTS-Testalarme wurden gesendet."
echo ""
info "Logs prüfen mit: journalctl -u tts-alarmserver -f"
echo ""
