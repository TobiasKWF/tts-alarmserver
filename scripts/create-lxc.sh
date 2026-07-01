#!/usr/bin/env bash
# =============================================================================
#  tts-alarmserver – Proxmox LXC Container erstellen
#  Ausführen auf dem Proxmox VE Host (nicht im Container!)
#
#  Verwendung:
#    chmod +x scripts/create-lxc.sh
#    ./scripts/create-lxc.sh
#
#  Voraussetzungen:
#    - Proxmox VE 7.x oder 8.x
#    - Als root auf dem PVE-Host ausgeführt
#    - Internetverbindung (Debian 13 Template + install.sh)
# =============================================================================

# WICHTIG: set -e NICHT verwenden – pvesm/awk-Pipes liefern exit 1 bei
# leerer Ausgabe und würden das Script sofort beenden.
set -uo pipefail

# -----------------------------------------------------------------------------
# Farben & Hilfsfunktionen
# -----------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()   { echo -e "${GREEN}[✓]${NC} $*"; }
info()  { echo -e "${BLUE}[→]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }
ask()   { echo -ne "${CYAN}[?]${NC} $* "; }

section() {
  echo ""
  echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}${CYAN}  $*${NC}"
  echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════${NC}"
}

require_root() {
  [[ $EUID -eq 0 ]] || error "Dieses Script muss als root auf dem Proxmox-Host ausgeführt werden."
}

require_proxmox() {
  command -v pct   &>/dev/null || error "pct nicht gefunden – dieses Script muss auf einem Proxmox VE Host ausgeführt werden."
  command -v pvesm &>/dev/null || error "pvesm nicht gefunden – kein Proxmox VE Host?"
}

# -----------------------------------------------------------------------------
# Standardwerte
# -----------------------------------------------------------------------------
DEFAULT_CTID=200
DEFAULT_HOSTNAME="tts-alarmserver"
DEFAULT_CORES=2
DEFAULT_MEMORY=1024        # MB
DEFAULT_SWAP=512           # MB
DEFAULT_DISK=8             # GB
DEFAULT_BRIDGE="vmbr0"
DEFAULT_IP="dhcp"
DEFAULT_STORAGE="local-lvm"
DEFAULT_TEMPLATE_STORAGE="local"
DEBIAN_TEMPLATE="debian-13-standard_13.5-1_amd64.tar.zst"
INSTALL_SCRIPT_URL="https://raw.githubusercontent.com/TobiasKWF/tts-alarmserver/main/scripts/install.sh"

# -----------------------------------------------------------------------------
# Hilfsfunktionen: verfügbare Ressourcen ermitteln
# Robuste Variante: exit-code der Pipe wird ignoriert, Fallback bei leer
# -----------------------------------------------------------------------------
get_storages() {
  local result
  result=$(pvesm status 2>/dev/null | awk 'NR>1 {print $1}' | tr '\n' ' ') || true
  echo "${result:-local-lvm}"
}

get_template_storages() {
  local result
  result=$(pvesm status 2>/dev/null | awk 'NR>1 {print $1}' | tr '\n' ' ') || true
  echo "${result:-local}"
}

get_bridges() {
  local result
  result=$(ip link show 2>/dev/null | grep -oP 'vmbr\d+' | sort -u | tr '\n' ' ') || true
  echo "${result:-vmbr0}"
}

get_next_ctid() {
  local id=100
  # Arithmetik-Increment: id+=1 statt ((id++)) vermeidet exit-code 1 bei 0
  while pct status "$id" &>/dev/null 2>&1; do
    id=$((id + 1))
  done
  echo "$id"
}

validate_ip() {
  local ip="$1"
  [[ "$ip" == "dhcp" ]] && return 0
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]] && return 0
  return 1
}

# -----------------------------------------------------------------------------
# Interaktive Konfiguration
# -----------------------------------------------------------------------------
collect_config() {
  section "Konfiguration"

  local next_id storages tmpl_storages bridges
  next_id=$(get_next_ctid)       || next_id="$DEFAULT_CTID"
  storages=$(get_storages)       || storages="local-lvm"
  tmpl_storages=$(get_template_storages) || tmpl_storages="local"
  bridges=$(get_bridges)         || bridges="vmbr0"

  echo -e "  Verfügbare Storages:           ${CYAN}${storages}${NC}"
  echo -e "  Verfügbare Template-Storages:  ${CYAN}${tmpl_storages}${NC}"
  echo -e "  Verfügbare Bridges:            ${CYAN}${bridges}${NC}"
  echo ""

  # CTID
  ask "Container ID [${next_id}]:"
  read -r input_ctid
  CTID="${input_ctid:-$next_id}"
  if pct status "$CTID" &>/dev/null 2>&1; then
    error "Container-ID ${CTID} existiert bereits. Bitte andere ID wählen."
  fi

  # Hostname
  ask "Hostname [${DEFAULT_HOSTNAME}]:"
  read -r input_hostname
  CT_HOSTNAME="${input_hostname:-$DEFAULT_HOSTNAME}"

  # Storage für Container-Disk
  ask "Storage für Container-Disk [${DEFAULT_STORAGE}]:"
  read -r input_storage
  CT_STORAGE="${input_storage:-$DEFAULT_STORAGE}"

  # Storage für Template
  ask "Storage für Debian-Template [${DEFAULT_TEMPLATE_STORAGE}]:"
  read -r input_tmpl_storage
  TMPL_STORAGE="${input_tmpl_storage:-$DEFAULT_TEMPLATE_STORAGE}"

  # CPU-Kerne
  ask "CPU-Kerne [${DEFAULT_CORES}]:"
  read -r input_cores
  CT_CORES="${input_cores:-$DEFAULT_CORES}"

  # RAM
  ask "RAM in MB [${DEFAULT_MEMORY}]:"
  read -r input_memory
  CT_MEMORY="${input_memory:-$DEFAULT_MEMORY}"

  # Swap
  ask "Swap in MB [${DEFAULT_SWAP}]:"
  read -r input_swap
  CT_SWAP="${input_swap:-$DEFAULT_SWAP}"

  # Disk
  ask "Disk-Größe in GB [${DEFAULT_DISK}]:"
  read -r input_disk
  CT_DISK="${input_disk:-$DEFAULT_DISK}"

  # Bridge
  ask "Netzwerk-Bridge [${DEFAULT_BRIDGE}]:"
  read -r input_bridge
  CT_BRIDGE="${input_bridge:-$DEFAULT_BRIDGE}"

  # IP-Adresse
  echo ""
  info "IP-Format: 'dhcp' oder '192.168.1.100/24'"
  ask "IP-Adresse [${DEFAULT_IP}]:"
  read -r input_ip
  CT_IP="${input_ip:-$DEFAULT_IP}"
  if ! validate_ip "$CT_IP"; then
    error "Ungültiges IP-Format: ${CT_IP}. Erwartet: dhcp oder 192.168.1.100/24"
  fi

  # Gateway (nur bei statischer IP)
  if [[ "$CT_IP" != "dhcp" ]]; then
    local default_gw
    default_gw=$(echo "$CT_IP" | sed 's/\.[0-9]*\/.*/.1/')
    ask "Gateway [${default_gw}]:"
    read -r input_gw
    CT_GW="${input_gw:-$default_gw}"
  else
    CT_GW=""
  fi

  # Root-Passwort
  echo ""
  ask "Root-Passwort für den Container:"
  read -rs CT_PASSWORD
  echo ""
  [[ -z "$CT_PASSWORD" ]] && error "Passwort darf nicht leer sein."
  ask "Passwort wiederholen:"
  read -rs CT_PASSWORD_CONFIRM
  echo ""
  [[ "$CT_PASSWORD" != "$CT_PASSWORD_CONFIRM" ]] && error "Passwörter stimmen nicht überein."

  # SSH-Key (optional)
  echo ""
  ask "Pfad zu SSH Public Key (leer = überspringen):"
  read -r input_sshkey
  CT_SSHKEY="${input_sshkey:-}"

  # Auto-Install
  echo ""
  ask "Nach Container-Erstellung install.sh automatisch ausführen? [J/n]:"
  read -r input_autoinstall
  AUTO_INSTALL="${input_autoinstall:-j}"
}

# -----------------------------------------------------------------------------
# Zusammenfassung bestätigen
# -----------------------------------------------------------------------------
confirm_config() {
  section "Zusammenfassung"

  echo -e "  Container ID:    ${BOLD}${CTID}${NC}"
  echo -e "  Hostname:        ${BOLD}${CT_HOSTNAME}${NC}"
  echo -e "  OS:              Debian 13 (Trixie)"
  echo -e "  CPU-Kerne:       ${CT_CORES}"
  echo -e "  RAM:             ${CT_MEMORY} MB"
  echo -e "  Swap:            ${CT_SWAP} MB"
  echo -e "  Disk:            ${CT_DISK} GB (${CT_STORAGE})"
  echo -e "  Bridge:          ${CT_BRIDGE}"
  echo -e "  IP:              ${CT_IP}"
  [[ -n "${CT_GW:-}" ]] && echo -e "  Gateway:         ${CT_GW}"
  echo -e "  Template:        ${DEBIAN_TEMPLATE} (${TMPL_STORAGE})"
  [[ -n "${CT_SSHKEY:-}" ]] && echo -e "  SSH-Key:         ${CT_SSHKEY}"
  echo -e "  Auto-Install:    ${AUTO_INSTALL}"
  echo ""

  ask "Alles korrekt? Container erstellen? [J/n]:"
  read -r confirm
  confirm="${confirm:-j}"
  [[ "$confirm" =~ ^[jJyY]$ ]] || { info "Abgebrochen."; exit 0; }
}

# -----------------------------------------------------------------------------
# Debian-Template herunterladen (falls nicht vorhanden)
# -----------------------------------------------------------------------------
download_template() {
  section "Debian 13 Template"

  if pveam list "${TMPL_STORAGE}" 2>/dev/null | grep -q "${DEBIAN_TEMPLATE}"; then
    log "Template bereits vorhanden: ${DEBIAN_TEMPLATE}"
    return 0
  fi

  info "Aktualisiere Template-Liste..."
  pveam update || warn "pveam update fehlgeschlagen – versuche trotzdem den Download."

  info "Lade herunter: ${DEBIAN_TEMPLATE} (kann einige Minuten dauern)..."
  pveam download "${TMPL_STORAGE}" "${DEBIAN_TEMPLATE}" \
    || error "Template-Download fehlgeschlagen.\n  Manuell: pveam download ${TMPL_STORAGE} ${DEBIAN_TEMPLATE}"

  log "Template heruntergeladen."
}

# -----------------------------------------------------------------------------
# LXC Container erstellen
# -----------------------------------------------------------------------------
create_container() {
  section "LXC Container erstellen (ID: ${CTID})"

  # Netzwerk-Konfiguration
  local net_config="name=eth0,bridge=${CT_BRIDGE}"
  if [[ "$CT_IP" == "dhcp" ]]; then
    net_config+=",ip=dhcp"
  else
    net_config+=",ip=${CT_IP}"
    [[ -n "${CT_GW:-}" ]] && net_config+=",gw=${CT_GW}"
  fi

  # pct create aufbauen
  local create_cmd=(
    pct create "${CTID}"
    "${TMPL_STORAGE}:vztmpl/${DEBIAN_TEMPLATE}"
    --hostname    "${CT_HOSTNAME}"
    --password    "${CT_PASSWORD}"
    --cores       "${CT_CORES}"
    --memory      "${CT_MEMORY}"
    --swap        "${CT_SWAP}"
    --rootfs      "${CT_STORAGE}:${CT_DISK}"
    --net0        "${net_config}"
    --nameserver  "8.8.8.8 8.8.4.4"
    --searchdomain "local"
    --ostype      debian
    --unprivileged 1
    --features    "nesting=1"
    --start       0
    --onboot      1
  )

  if [[ -n "${CT_SSHKEY:-}" && -f "${CT_SSHKEY}" ]]; then
    create_cmd+=(--ssh-public-keys "${CT_SSHKEY}")
    info "SSH-Key wird eingebunden: ${CT_SSHKEY}"
  fi

  info "Führe pct create aus..."
  "${create_cmd[@]}" || error "pct create fehlgeschlagen."
  log "Container ${CTID} erstellt."

  # /dev/net/tun für Multicast RTP
  setup_tun_device

  # Container starten
  info "Container wird gestartet..."
  pct start "${CTID}" || error "Container konnte nicht gestartet werden."
  sleep 6
  log "Container ${CTID} läuft."
}

# -----------------------------------------------------------------------------
# /dev/net/tun für Multicast RTP Streaming
# -----------------------------------------------------------------------------
setup_tun_device() {
  section "Netzwerk-Feature: /dev/net/tun (Multicast RTP)"

  local conf_file="/etc/pve/lxc/${CTID}.conf"

  cat >> "$conf_file" <<EOF

# tts-alarmserver: TUN-Device für Multicast RTP-Streaming
lxc.cgroup2.devices.allow: c 10:200 rwm
lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
EOF

  log "/dev/net/tun konfiguriert → Multicast 239.x.x.x wird unterstützt."
}

# -----------------------------------------------------------------------------
# Grundkonfiguration im Container
# -----------------------------------------------------------------------------
setup_container() {
  section "Container-Grundkonfiguration"

  info "Paketlisten aktualisieren..."
  pct exec "${CTID}" -- bash -c "apt-get update -qq && apt-get install -y -qq curl wget ca-certificates" \
    || error "apt-get im Container fehlgeschlagen."
  log "Basis-Pakete installiert."

  info "Zeitzone: Europe/Berlin..."
  pct exec "${CTID}" -- bash -c \
    "ln -sf /usr/share/zoneinfo/Europe/Berlin /etc/localtime && \
     echo 'Europe/Berlin' > /etc/timezone && \
     DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tzdata 2>/dev/null || true"
  log "Zeitzone gesetzt."

  info "Locale: de_DE.UTF-8..."
  pct exec "${CTID}" -- bash -c \
    "sed -i 's/# de_DE.UTF-8/de_DE.UTF-8/' /etc/locale.gen 2>/dev/null || true; \
     locale-gen 2>/dev/null || true; \
     update-locale LANG=de_DE.UTF-8 2>/dev/null || true"
  log "Locale gesetzt."
}

# -----------------------------------------------------------------------------
# install.sh im Container ausführen
# -----------------------------------------------------------------------------
run_installer() {
  if [[ ! "$AUTO_INSTALL" =~ ^[jJyY]$ ]]; then
    info "Auto-Install übersprungen."
    return 0
  fi

  section "tts-alarmserver Installation im Container"

  info "Lade install.sh von GitHub..."
  pct exec "${CTID}" -- bash -c \
    "curl -fsSL '${INSTALL_SCRIPT_URL}' -o /tmp/install.sh && chmod +x /tmp/install.sh" \
    || error "install.sh konnte nicht heruntergeladen werden."

  info "Starte install.sh (5–15 Minuten je nach Verbindung)..."
  echo "──────────────────────────────────────────────────────"
  pct exec "${CTID}" -- bash /tmp/install.sh
  echo "──────────────────────────────────────────────────────"
  log "Installation abgeschlossen."

  info "Service starten..."
  pct exec "${CTID}" -- bash -c "systemctl start tts-alarmserver && sleep 3" || true

  local health
  health=$(pct exec "${CTID}" -- bash -c \
    "curl -sf http://localhost:3000/health 2>/dev/null || echo '{\"ok\":false}'" 2>/dev/null) || health='{"ok":false}'
  if echo "$health" | grep -q '"ok":true'; then
    log "Health-Check: ✓ Server antwortet."
  else
    warn "Health-Check fehlgeschlagen – bitte manuell prüfen:"
    warn "  pct enter ${CTID}"
    warn "  systemctl status tts-alarmserver"
  fi
}

# -----------------------------------------------------------------------------
# Abschluss-Zusammenfassung
# -----------------------------------------------------------------------------
print_summary() {
  local ct_ip_display="$CT_IP"
  if [[ "$CT_IP" == "dhcp" ]]; then
    sleep 2
    ct_ip_display=$(pct exec "${CTID}" -- bash -c \
      "hostname -I 2>/dev/null | awk '{print \$1}'" 2>/dev/null) || ct_ip_display="(IP via: pct exec ${CTID} -- hostname -I)"
    ct_ip_display="${ct_ip_display:-DHCP – IP noch nicht vergeben}"
  else
    ct_ip_display=$(echo "$CT_IP" | cut -d'/' -f1)
  fi

  echo ""
  echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${GREEN}║     LXC Container erfolgreich erstellt & konfiguriert     ║${NC}"
  echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${BOLD}Container ID:${NC}    ${CTID}"
  echo -e "  ${BOLD}Hostname:${NC}        ${CT_HOSTNAME}"
  echo -e "  ${BOLD}IP-Adresse:${NC}      ${ct_ip_display}"
  echo ""
  echo -e "  ${BOLD}Konsole öffnen:${NC}"
  echo -e "    ${CYAN}pct enter ${CTID}${NC}"
  echo ""
  echo -e "  ${BOLD}SSH-Zugang:${NC}"
  echo -e "    ${CYAN}ssh root@${ct_ip_display}${NC}"
  echo ""

  if [[ "$AUTO_INSTALL" =~ ^[jJyY]$ ]]; then
    echo -e "  ${BOLD}Dashboard:${NC}"
    echo -e "    ${CYAN}http://${ct_ip_display}:3000/dashboard${NC}"
    echo ""
    echo -e "  ${BOLD}Health-Check:${NC}"
    echo -e "    ${CYAN}curl http://${ct_ip_display}:3000/health${NC}"
    echo ""
    echo -e "  ${BOLD}Test-Alarm:${NC}"
    echo -e "    ${CYAN}curl -X POST http://${ct_ip_display}:3000/announce \\${NC}"
    echo -e "    ${CYAN}      -H 'Content-Type: application/json' \\${NC}"
    echo -e "    ${CYAN}      -d '{\"text\":\"B2Y Musterstraße fünf\",\"priority\":1}'${NC}"
    echo ""
    echo -e "  ${BOLD}Updates einspielen:${NC}"
    echo -e "    ${CYAN}pct exec ${CTID} -- tts-alarmserver-update${NC}"
    echo ""
    echo -e "  ${YELLOW}⚠  RTP_HOST in /tts-alarmserver/.env auf Ziel-Multicast-IP anpassen!${NC}"
    echo -e "  ${YELLOW}⚠  API_KEY in /tts-alarmserver/.env für Produktion setzen!${NC}"
  else
    echo -e "  ${BOLD}Installation starten:${NC}"
    echo -e "    ${CYAN}pct enter ${CTID}${NC}"
    echo -e "    ${CYAN}curl -fsSL ${INSTALL_SCRIPT_URL} | bash${NC}"
  fi

  echo ""
  echo -e "  ${BOLD}Container-Verwaltung (auf PVE-Host):${NC}"
  echo -e "    ${CYAN}pct stop    ${CTID}${NC}   # stoppen"
  echo -e "    ${CYAN}pct start   ${CTID}${NC}   # starten"
  echo -e "    ${CYAN}pct restart ${CTID}${NC}   # neu starten"
  echo -e "    ${CYAN}pct destroy ${CTID}${NC}   # löschen"
  echo ""
}

# -----------------------------------------------------------------------------
# Hauptprogramm
# -----------------------------------------------------------------------------
main() {
  clear
  echo -e "${BOLD}${CYAN}"
  echo "  ██████╗ ██████╗  ██████╗ ██╗  ██╗███╗   ███╗ ██████╗ ██╗  ██╗"
  echo "  ██╔══██╗██╔══██╗██╔═══██╗╚██╗██╔╝████╗ ████║██╔═══██╗╚██╗██╔╝"
  echo "  ██████╔╝██████╔╝██║   ██║ ╚███╔╝ ██╔████╔██║██║   ██║ ╚███╔╝ "
  echo "  ██╔═══╝ ██╔══██╗██║   ██║ ██╔██╗ ██║╚██╔╝██║██║   ██║ ██╔██╗ "
  echo "  ██║     ██║  ██║╚██████╔╝██╔╝ ██╗██║ ╚═╝ ██║╚██████╔╝██╔╝ ██╗"
  echo "  ╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═╝"
  echo -e "${NC}"
  echo -e "${BOLD}  LXC Container erstellen für tts-alarmserver${NC}"
  echo -e "  Ausführen auf dem Proxmox VE Host als root"
  echo -e "  Datum: $(date '+%d.%m.%Y %H:%M')"
  echo ""

  require_root
  require_proxmox
  collect_config
  confirm_config
  download_template
  create_container
  setup_container
  run_installer
  print_summary
}

main "$@"
