#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Atriveo — Linux systemd service + timer installer
# Installs:
#   atriveo-scraper.service / .timer   — hourly scraper
#   atriveo-feed-sync.service / .timer — hourly feed push
#   atriveo-tailor.service             — resume sidecar (keeps alive)
#
# Usage: bash scripts/install-systemd.sh
#        npm run pipeline:install:linux
#
# Requires: systemd user session (loginctl enable-linger $USER)
# ─────────────────────────────────────────────────────────────────────────────
set -e
BOLD="\033[1m" GREEN="\033[32m" RED="\033[31m" RESET="\033[0m"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEMD_USER="$HOME/.config/systemd/user"

source "$ROOT/.env" 2>/dev/null || true

mkdir -p "$SYSTEMD_USER"

PYTHON="${ROOT}/scraper/.venv/bin/python"
[ ! -f "$PYTHON" ] && PYTHON="$(command -v python3)"
NODE="$(command -v node)"

echo -e "\n${BOLD}Installing Atriveo systemd services…${RESET}\n"

# ── Helper ────────────────────────────────────────────────────────────────────
install_unit() {
  local name="$1" content="$2"
  echo "$content" > "$SYSTEMD_USER/${name}"
  echo -e "${GREEN}✓${RESET} ${name}"
}

enable_timer() {
  systemctl --user daemon-reload
  systemctl --user enable --now "$1" 2>/dev/null && echo -e "${GREEN}✓${RESET} enabled $1" || echo -e "${RED}✗${RESET} failed to enable $1"
}

# ── 1. Scraper ────────────────────────────────────────────────────────────────
install_unit "atriveo-scraper.service" "[Unit]
Description=Atriveo job scraper
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${ROOT}
ExecStart=${PYTHON} -m scraper.main --sources ${SCRAPER_SOURCES:-greenhouse lever}
Environment=SERVER_URL=${SERVER_URL:-http://localhost:3001}
Environment=SCRAPER_TOKEN=${SCRAPER_TOKEN:-}
Environment=CONFIG_PATH=${ROOT}/config.json
Environment=LINKEDIN_ENABLED=${LINKEDIN_ENABLED:-false}
Environment=LINKEDIN_EMAIL=${LINKEDIN_EMAIL:-}
Environment=LINKEDIN_PASSWORD=${LINKEDIN_PASSWORD:-}
StandardOutput=append:/tmp/atriveo_scraper.log
StandardError=append:/tmp/atriveo_scraper.log"

install_unit "atriveo-scraper.timer" "[Unit]
Description=Run Atriveo scraper hourly

[Timer]
OnCalendar=*:00:00
Persistent=true

[Install]
WantedBy=timers.target"

# ── 2. Feed sync ──────────────────────────────────────────────────────────────
install_unit "atriveo-feed-sync.service" "[Unit]
Description=Atriveo feed sync
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${ROOT}
ExecStart=${NODE} ${ROOT}/scripts/sync-feed.mjs
Environment=SERVER_URL=${SERVER_URL:-http://localhost:3001}
Environment=CF_ACCOUNT_ID=${CF_ACCOUNT_ID:-}
Environment=CF_API_TOKEN=${CF_API_TOKEN:-}
StandardOutput=append:/tmp/atriveo_feed_sync.log
StandardError=append:/tmp/atriveo_feed_sync.log"

install_unit "atriveo-feed-sync.timer" "[Unit]
Description=Run Atriveo feed sync hourly at :20

[Timer]
OnCalendar=*:20:00
Persistent=true

[Install]
WantedBy=timers.target"

# ── 3. Tailor sidecar ─────────────────────────────────────────────────────────
install_unit "atriveo-tailor.service" "[Unit]
Description=Atriveo resume tailor sidecar
After=network.target

[Service]
Type=simple
WorkingDirectory=${ROOT}
ExecStart=${NODE} ${ROOT}/sidecar/tailor-server.mjs
Restart=always
RestartSec=5
Environment=YOUR_NAME=${YOUR_NAME:-}
Environment=TAILOR_TOKEN=${TAILOR_TOKEN:-}
Environment=RESUME_ENGINE_PATH=${RESUME_ENGINE_PATH:-${ROOT}/resume-engine}
Environment=TAILOR_OUT_ROOT=${TAILOR_OUT_ROOT:-${ROOT}/output/tailored-resumes}
Environment=OLLAMA_MODEL=${OLLAMA_MODEL:-gemma3:12b}
Environment=OLLAMA_HOST=${OLLAMA_HOST:-127.0.0.1}
StandardOutput=append:/tmp/atriveo_tailor.log
StandardError=append:/tmp/atriveo_tailor.log

[Install]
WantedBy=default.target"

# ── Enable everything ─────────────────────────────────────────────────────────
systemctl --user daemon-reload

enable_timer "atriveo-scraper.timer"
enable_timer "atriveo-feed-sync.timer"
systemctl --user enable --now atriveo-tailor.service 2>/dev/null && echo -e "${GREEN}✓${RESET} enabled atriveo-tailor.service" || echo -e "${RED}✗${RESET} failed to enable tailor"

# Enable linger so services survive logout
loginctl enable-linger "$USER" 2>/dev/null && echo -e "${GREEN}✓${RESET} linger enabled (services survive logout)" || echo "⚠  Run: loginctl enable-linger $USER"

echo -e "\n${BOLD}Services installed.${RESET}"
echo -e "  Scraper:    hourly at :00  →  /tmp/atriveo_scraper.log"
echo -e "  Feed sync:  hourly at :20  →  /tmp/atriveo_feed_sync.log"
echo -e "  Tailor:     always-on      →  /tmp/atriveo_tailor.log"
echo -e "\nCheck status:"
echo -e "  systemctl --user status atriveo-tailor"
echo -e "  systemctl --user list-timers | grep atriveo\n"
