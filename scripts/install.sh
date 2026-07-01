#!/usr/bin/env bash
# =============================================================================
#  tts-alarmserver – Proxmox LXC Installations-Script
#  Ziel-OS : Debian 12 (Bookworm) – unprivileged LXC Container
#  Getestet: Proxmox VE 8.x
#
#  Verwendung (ein-Zeiler):
#    curl -fsSL https://raw.githubusercontent.com/TobiasKWF/tts-alarmserver/main/scripts/install.sh | bash
#  oder manuell:
#    chmod +x install.sh && sudo ./install.sh
#
#  Was das Script tut:
#    1. System-Pakete aktualisieren
#    2. Node.js 22 LTS installieren (via NodeSource)
#    3. ffmpeg + espeak-ng installieren
#    4. Piper TTS Binary herunterladen
#    5. Piper Stimme de_DE-thorsten-high herunterladen
#    6. Repository klonen (git pull wenn bereits vorhanden)
#    7. npm install --omit=dev
#    8. Verzeichnisse anlegen (logs, tmp, gong, voices, config)
#    9. .env aus .env.example erstellen (wenn nicht vorhanden)
#   10. systemd-Service installieren und aktivieren
#   11. Update-Script unter /usr/local/bin bereitstellen
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Konfiguration – hier anpassen
# -----------------------------------------------------------------------------
REPO_URL="https://github.com/TobiasKWF/tts-alarmserver.git"
INSTALL_DIR="/tts-alarmserver"
SERVICE_USER="root"                       # In Produktion eigenen User anlegen
NODE_VERSION="22"                         # Node.js LTS Major-Version
PIPER_VERSION="2023.11.14-2"             # Piper Release-Tag
PIPER_ARCH="amd64"                        # amd64 | arm64 | armv7l
PIPER_BINARY="/usr/local/bin/piper"
PIPER_DIR="/opt/piper"
ESPEAK_DATA_PATH="/opt/piper"
VOICE_NAME="de_DE-thorsten-high"
VOICE_QUALITY="high"                      # low | medium | high
VOICE_URL_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/${VOICE_QUALITY}"

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# -----------------------------------------------------------------------------
# Hilfsfunktionen
# -----------------------------------------------------------------------------
log()     { echo -e "${GREEN}[✓]${NC} $*"; }
info()    { echo -e "${BLUE}[→]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

section() {
  echo ""
  echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}${CYAN}  $*${NC}"
  echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════${NC}"
}

require_root() {
  [[ $EUID -eq 0 ]] || error "Dieses Script muss als root ausgeführt werden. (sudo ./install.sh)"
}

check_os() {
  if [[ ! -f /etc/debian_version ]]; then
    error "Nur Debian/Ubuntu wird unterstützt."
  fi
  local ver
  ver=$(cut -d. -f1 /etc/debian_version)
  if [[ "$ver" -lt 12 ]]; then
    warn "Debian < 12 erkannt – Script wurde nur auf Debian 12 (Bookworm) getestet."
    read -r -p "Trotzdem fortfahren? [j/N] " confirm
    [[ "$confirm" =~ ^[jJyY]$ ]] || exit 0
  fi
  log "OS: Debian $(cat /etc/debian_version)"
}

# -----------------------------------------------------------------------------
# 1. System aktualisieren + Basis-Pakete
# -----------------------------------------------------------------------------
install_system_packages() {
  section "Schritt 1/10 – System-Pakete"
  info "apt update..."
  apt-get update -qq

  info "Upgrade..."
  DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq

  info "Basis-Pakete installieren..."
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    curl wget git unzip tar ca-certificates gnupg lsb-release \
    ffmpeg \
    espeak-ng espeak-ng-data \
    libstdc++6 \
    build-essential \
    systemd \
    lsof net-tools \
    python3-minimal

  log "System-Pakete installiert."
  log "ffmpeg: $(ffmpeg -version 2>&1 | head -1)"
}

# -----------------------------------------------------------------------------
# 2. Node.js via NodeSource
# -----------------------------------------------------------------------------
install_nodejs() {
  section "Schritt 2/10 – Node.js ${NODE_VERSION} LTS"

  if command -v node &>/dev/null; then
    local current
    current=$(node --version | sed 's/v//' | cut -d. -f1)
    if [[ "$current" -ge "$NODE_VERSION" ]]; then
      log "Node.js $(node --version) bereits installiert – überspringe."
      return
    fi
    warn "Veraltetes Node.js $(node --version) gefunden – wird ersetzt."
  fi

  info "NodeSource GPG-Key und Repository einrichten..."
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] \
https://deb.nodesource.com/node_${NODE_VERSION}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list

  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs

  log "Node.js $(node --version) installiert."
  log "npm $(npm --version) installiert."
}

# -----------------------------------------------------------------------------
# 3. Piper TTS Binary
# -----------------------------------------------------------------------------
install_piper() {
  section "Schritt 3/10 – Piper TTS Binary"

  if [[ -x "$PIPER_BINARY" ]]; then
    log "Piper bereits vorhanden: $PIPER_BINARY – überspringe."
    return
  fi

  local archive="piper_linux_${PIPER_ARCH}.tar.gz"
  local url="https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/${archive}"
  local tmpdir
  tmpdir=$(mktemp -d)

  info "Lade Piper ${PIPER_VERSION} (${PIPER_ARCH}) ..."
  info "URL: ${url}"
  wget -q --show-progress -O "${tmpdir}/${archive}" "$url" \
    || error "Piper-Download fehlgeschlagen. URL: ${url}"

  info "Entpacke nach ${PIPER_DIR} ..."
  mkdir -p "$PIPER_DIR"
  tar -xzf "${tmpdir}/${archive}" -C "$PIPER_DIR" --strip-components=1

  info "Erstelle Symlink ${PIPER_BINARY} -> ${PIPER_DIR}/piper"
  ln -sf "${PIPER_DIR}/piper" "$PIPER_BINARY"
  chmod +x "${PIPER_DIR}/piper"

  rm -rf "$tmpdir"
  log "Piper installiert: $PIPER_BINARY"
}

# -----------------------------------------------------------------------------
# 4. Piper Stimme herunterladen
# -----------------------------------------------------------------------------
install_voice() {
  section "Schritt 4/10 – Piper Stimme: ${VOICE_NAME} (${VOICE_QUALITY})"

  local voices_dir="${INSTALL_DIR}/voices"
  local onnx="${voices_dir}/${VOICE_NAME}.onnx"
  local json="${voices_dir}/${VOICE_NAME}.onnx.json"

  mkdir -p "$voices_dir"

  if [[ -f "$onnx" && -f "$json" ]]; then
    local size
    size=$(du -sh "$onnx" | cut -f1)
    log "Stimme ${VOICE_NAME} bereits vorhanden (${size}) – überspringe."
    return
  fi

  info "Lade ${VOICE_NAME}.onnx (~140 MB) ..."
  wget -q --show-progress \
    -O "$onnx" \
    "${VOICE_URL_BASE}/${VOICE_NAME}.onnx" \
    || error "Stimm-Modell-Download fehlgeschlagen."

  info "Lade ${VOICE_NAME}.onnx.json ..."
  wget -q --show-progress \
    -O "$json" \
    "${VOICE_URL_BASE}/${VOICE_NAME}.onnx.json" \
    || error "Stimm-Konfiguration konnte nicht geladen werden."

  # Funktionstest
  info "Funktionstest der Stimme ..."
  if ESPEAK_DATA_PATH="$ESPEAK_DATA_PATH" \
    echo "Alarmserver bereit" | "$PIPER_BINARY" \
      --espeak_data "$ESPEAK_DATA_PATH" \
      --model "$onnx" \
      --output_file /tmp/piper_test.wav 2>/dev/null; then
    local size
    size=$(stat -c%s /tmp/piper_test.wav 2>/dev/null || echo 0)
    rm -f /tmp/piper_test.wav
    log "Stimme ${VOICE_NAME} funktionsfähig (${size} Bytes WAV erzeugt)."
  else
    warn "Piper-Test fehlgeschlagen – bitte nach Installation manuell prüfen."
  fi
}

# -----------------------------------------------------------------------------
# 5. Repository klonen oder aktualisieren
# -----------------------------------------------------------------------------
install_repository() {
  section "Schritt 5/10 – Repository"

  if [[ -d "${INSTALL_DIR}/.git" ]]; then
    info "Repository vorhanden – git pull ..."
    cd "$INSTALL_DIR"
    git pull --ff-only
    log "Repository aktualisiert."
    log "Aktueller Stand: $(git log -1 --format='%h %s (%ci)')"
  else
    info "Klone ${REPO_URL} nach ${INSTALL_DIR} ..."
    git clone "$REPO_URL" "$INSTALL_DIR"
    log "Repository geklont."
    log "Aktueller Stand: $(cd "$INSTALL_DIR" && git log -1 --format='%h %s (%ci)')"
  fi
}

# -----------------------------------------------------------------------------
# 6. npm install
# -----------------------------------------------------------------------------
install_npm_packages() {
  section "Schritt 6/10 – Node.js Abhängigkeiten"
  cd "$INSTALL_DIR"
  info "npm install --omit=dev ..."
  npm install --omit=dev --no-fund --no-audit --loglevel=warn
  log "npm-Pakete installiert."
}

# -----------------------------------------------------------------------------
# 7. Verzeichnisse anlegen
# -----------------------------------------------------------------------------
create_directories() {
  section "Schritt 7/10 – Verzeichnisse anlegen"
  local dirs=(
    "${INSTALL_DIR}/logs"
    "${INSTALL_DIR}/tmp"
    "${INSTALL_DIR}/gong"
    "${INSTALL_DIR}/voices"
    "${INSTALL_DIR}/config"
  )
  for d in "${dirs[@]}"; do
    mkdir -p "$d"
    log "  $d"
  done
  chown -R "${SERVICE_USER}:${SERVICE_USER}" "$INSTALL_DIR" 2>/dev/null || true
}

# -----------------------------------------------------------------------------
# 8. .env erstellen
# -----------------------------------------------------------------------------
create_env_file() {
  section "Schritt 8/10 – Konfiguration (.env)"

  local env_file="${INSTALL_DIR}/.env"

  if [[ -f "$env_file" ]]; then
    log ".env bereits vorhanden – wird nicht überschrieben."
    warn "Bitte .env manuell prüfen: ${env_file}"
    return
  fi

  if [[ ! -f "${INSTALL_DIR}/.env.example" ]]; then
    error ".env.example nicht gefunden – Repository vollständig?"
  fi

  info "Erstelle .env aus .env.example ..."
  cp "${INSTALL_DIR}/.env.example" "$env_file"

  # Pfade automatisch anpassen
  sed -i "s|PIPER_BINARY=.*|PIPER_BINARY=${PIPER_BINARY}|"              "$env_file"
  sed -i "s|PIPER_VOICES_DIR=.*|PIPER_VOICES_DIR=${INSTALL_DIR}/voices|" "$env_file"
  sed -i "s|AUDIO_GONG_DIR=.*|AUDIO_GONG_DIR=${INSTALL_DIR}/gong|"       "$env_file"
  sed -i "s|LOG_DIR=.*|LOG_DIR=${INSTALL_DIR}/logs|"                     "$env_file"
  sed -i "s|FFMPEG_BINARY=.*|FFMPEG_BINARY=$(which ffmpeg)|"             "$env_file"
  sed -i "s|NODE_ENV=.*|NODE_ENV=production|"                            "$env_file"

  chmod 640 "$env_file"
  log ".env erstellt: ${env_file}"
  warn "Bitte folgende Werte in ${env_file} anpassen:"
  warn "  RTP_HOST=<Ziel-Multicast-IP z.B. 239.255.0.1>"
  warn "  RTP_PORT=5004"
  warn "  API_KEY=<sicherer Schlüssel für Produktion>"
}

# -----------------------------------------------------------------------------
# 9. systemd Service
# -----------------------------------------------------------------------------
install_systemd_service() {
  section "Schritt 9/10 – systemd Service"

  local service_file="/etc/systemd/system/tts-alarmserver.service"
  local node_bin
  node_bin=$(which node)

  cat > "$service_file" <<SYSTEMD_EOF
[Unit]
Description=TTS-Alarmserver – Feuerwehr Sprachdurchsage via RTP
Documentation=https://github.com/TobiasKWF/tts-alarmserver
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
Environment=NODE_ENV=production
Environment=ESPEAK_DATA_PATH=${ESPEAK_DATA_PATH}
Environment=LD_LIBRARY_PATH=${PIPER_DIR}

ExecStart=${node_bin} ${INSTALL_DIR}/src/server.js
ExecReload=/bin/kill -HUP \$MAINPID

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
ReadWritePaths=${INSTALL_DIR}/logs ${INSTALL_DIR}/tmp

LimitNOFILE=65535
LimitNPROC=1024

[Install]
WantedBy=multi-user.target
SYSTEMD_EOF

  systemctl daemon-reload
  systemctl enable tts-alarmserver.service
  log "systemd Service registriert und aktiviert (Autostart beim Booten)."
}

# -----------------------------------------------------------------------------
# 10. Update-Script
# -----------------------------------------------------------------------------
create_update_script() {
  section "Schritt 10/10 – Update-Script"

  local update_bin="/usr/local/bin/tts-alarmserver-update"

  cat > "$update_bin" <<'UPDATESCRIPT'
#!/usr/bin/env bash
# =============================================================
#  TTS-Alarmserver Update-Script
#  Verwendung: tts-alarmserver-update [--restart-only]
# =============================================================
set -euo pipefail

INSTALL_DIR="/tts-alarmserver"
GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'

log()  { echo -e "${GREEN}[\u2713]${NC} $*"; }
info() { echo -e "${BLUE}[\u2192]${NC} $*"; }

if [[ "${1:-}" == "--restart-only" ]]; then
  info "Neustart ohne git pull ..."
  systemctl restart tts-alarmserver
  log "Neustart abgeschlossen."
  exit 0
fi

info "TTS-Alarmserver wird aktualisiert ..."
info "Service stoppen ..."
systemctl stop tts-alarmserver 2>/dev/null || true

info "git pull ..."
cd "$INSTALL_DIR"
git pull --ff-only
log "Aktueller Stand: $(git log -1 --format='%h %s (%ci)')"

info "npm install ..."
npm install --omit=dev --no-fund --no-audit --loglevel=warn

info "systemd daemon-reload ..."
systemctl daemon-reload

info "Service starten ..."
systemctl start tts-alarmserver
sleep 2

log "Update abgeschlossen."
echo ""
systemctl status tts-alarmserver --no-pager -l
UPDATESCRIPT

  chmod +x "$update_bin"
  log "Update-Script erstellt: ${update_bin}"
  log "Verwendung: tts-alarmserver-update"
}

# -----------------------------------------------------------------------------
# Zusammenfassung
# -----------------------------------------------------------------------------
print_summary() {
  local ip
  ip=$(hostname -I | awk '{print $1}' 2>/dev/null || echo "127.0.0.1")

  echo ""
  echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${GREEN}║        TTS-Alarmserver – Installation abgeschlossen        ║${NC}"
  echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${BOLD}Service starten:${NC}"
  echo -e "    ${CYAN}systemctl start tts-alarmserver${NC}"
  echo ""
  echo -e "  ${BOLD}Dashboard:${NC}"
  echo -e "    ${CYAN}http://${ip}:3000/dashboard${NC}"
  echo ""
  echo -e "  ${BOLD}Health-Check:${NC}"
  echo -e "    ${CYAN}curl http://${ip}:3000/health${NC}"
  echo ""
  echo -e "  ${BOLD}Test-Alarm:${NC}"
  echo -e "    ${CYAN}curl -X POST http://${ip}:3000/announce \\${NC}"
  echo -e "    ${CYAN}  -H 'Content-Type: application/json' \\${NC}"
  echo -e "    ${CYAN}  -d '{\"text\":\"B2Y Musterstraße fünf\",\"priority\":1}'${NC}"
  echo ""
  echo -e "  ${BOLD}Logs in Echtzeit:${NC}"
  echo -e "    ${CYAN}journalctl -fu tts-alarmserver${NC}"
  echo ""
  echo -e "  ${BOLD}Update:${NC}"
  echo -e "    ${CYAN}tts-alarmserver-update${NC}"
  echo ""
  echo -e "  ${BOLD}Wichtige Dateien:${NC}"
  echo -e "    Konfiguration: ${CYAN}${INSTALL_DIR}/.env${NC}"
  echo -e "    Logs:          ${CYAN}${INSTALL_DIR}/logs/${NC}"
  echo -e "    Stimmen:       ${CYAN}${INSTALL_DIR}/voices/${NC}"
  echo -e "    Gong/Fanfare:  ${CYAN}${INSTALL_DIR}/gong/${NC}"
  echo ""
  echo -e "  ${YELLOW}⚠  RTP_HOST in ${INSTALL_DIR}/.env auf Ziel-IP anpassen!${NC}"
  echo -e "  ${YELLOW}⚠  API_KEY in ${INSTALL_DIR}/.env für Produktion setzen!${NC}"
  echo ""
}

# -----------------------------------------------------------------------------
# Hauptprogramm
# -----------------------------------------------------------------------------
main() {
  clear
  echo -e "${BOLD}${CYAN}"
  echo " ████████╗████████╗███████╗      █████╗ ██╗      █████╗ ██████╗ ███╗   ███╗"
  echo "    ██╔══╝╚══██╔══╝██╔════╝     ██╔══██╗██║     ██╔══██╗██╔══██╗████╗ ████║"
  echo "    ██║      ██║   █████╗     ███████║██║     ███████║██████╔╝██╔████╔██║"
  echo "    ██║      ██║   ╚═══██╗     ██╔══██║██║     ██╔══██║██╔══██╗██║╚██╔╝██║"
  echo "    ██║      ██║   ███████║     ██║  ██║███████╗██║  ██║██║  ██║██║ ╚═╝ ██║"
  echo "    ╚═╝      ╚═╝   ╚══════╝     ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝"
  echo -e "${NC}"
  echo -e "${BOLD}  Installations-Script für Proxmox LXC / Debian 12${NC}"
  echo -e "  Repo:  ${REPO_URL}"
  echo -e "  Datum: $(date '+%d.%m.%Y %H:%M')"
  echo ""

  require_root
  check_os
  install_system_packages
  install_nodejs
  install_piper
  install_voice
  install_repository
  install_npm_packages
  create_directories
  create_env_file
  install_systemd_service
  create_update_script
  print_summary
}

main "$@"
