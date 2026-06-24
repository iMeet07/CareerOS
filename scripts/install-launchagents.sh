#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Atriveo — macOS LaunchAgent installer
# Installs three hourly services:
#   com.atriveo.scraper      — scrapes job sources every hour
#   com.atriveo.feed-sync    — pushes job feed to server / Cloudflare
#   com.atriveo.tailor       — resume sidecar (keeps alive, restarts on crash)
#
# Usage: bash scripts/install-launchagents.sh
#        npm run pipeline:install
# ─────────────────────────────────────────────────────────────────────────────
set -e
BOLD="\033[1m" GREEN="\033[32m" RED="\033[31m" YELLOW="\033[33m" RESET="\033[0m"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
UID_VAL=$(id -u)

source "$ROOT/.env" 2>/dev/null || true

mkdir -p "$LAUNCH_AGENTS"

# ── Helper ────────────────────────────────────────────────────────────────────
install_agent() {
  local label="$1" plist="$2"
  local dest="$LAUNCH_AGENTS/${label}.plist"
  echo "$plist" > "$dest"
  launchctl bootout "gui/${UID_VAL}/${label}" 2>/dev/null || true
  launchctl bootstrap "gui/${UID_VAL}" "$dest" 2>/dev/null || true
  launchctl enable "gui/${UID_VAL}/${label}" 2>/dev/null || true
  echo -e "${GREEN}✓${RESET} ${label}"
}

echo -e "\n${BOLD}Installing Atriveo LaunchAgents…${RESET}\n"

# ── 1. Scraper (hourly at :00) ────────────────────────────────────────────────
SOURCES="${SCRAPER_SOURCES:-greenhouse lever}"
PYTHON="${ROOT}/scraper/.venv/bin/python"
[ ! -f "$PYTHON" ] && PYTHON="$(command -v python3)"

install_agent "com.atriveo.scraper" "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\"><dict>
  <key>Label</key><string>com.atriveo.scraper</string>
  <key>ProgramArguments</key><array>
    <string>${PYTHON}</string>
    <string>-m</string><string>scraper.main</string>
    <string>--sources</string>$(for s in $SOURCES; do echo "    <string>${s}</string>"; done)
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key><dict>
    <key>SERVER_URL</key><string>${SERVER_URL:-http://localhost:3001}</string>
    <key>SCRAPER_TOKEN</key><string>${SCRAPER_TOKEN:-}</string>
    <key>CONFIG_PATH</key><string>${ROOT}/config.json</string>
    <key>LINKEDIN_ENABLED</key><string>${LINKEDIN_ENABLED:-false}</string>
    <key>LINKEDIN_EMAIL</key><string>${LINKEDIN_EMAIL:-}</string>
    <key>LINKEDIN_PASSWORD</key><string>${LINKEDIN_PASSWORD:-}</string>
  </dict>
  <key>StartCalendarInterval</key><dict>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>/tmp/atriveo_scraper.log</string>
  <key>StandardErrorPath</key><string>/tmp/atriveo_scraper.log</string>
  <key>RunAtLoad</key><false/>
</dict></plist>"

# ── 2. Feed sync (hourly at :20) ──────────────────────────────────────────────
install_agent "com.atriveo.feed-sync" "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\"><dict>
  <key>Label</key><string>com.atriveo.feed-sync</string>
  <key>ProgramArguments</key><array>
    <string>$(command -v node)</string>
    <string>${ROOT}/scripts/sync-feed.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key><dict>
    <key>SERVER_URL</key><string>${SERVER_URL:-http://localhost:3001}</string>
    <key>CF_ACCOUNT_ID</key><string>${CF_ACCOUNT_ID:-}</string>
    <key>CF_API_TOKEN</key><string>${CF_API_TOKEN:-}</string>
  </dict>
  <key>StartCalendarInterval</key><dict>
    <key>Minute</key><integer>20</integer>
  </dict>
  <key>StandardOutPath</key><string>/tmp/atriveo_feed_sync.log</string>
  <key>StandardErrorPath</key><string>/tmp/atriveo_feed_sync.log</string>
  <key>RunAtLoad</key><false/>
</dict></plist>"

# ── 3. Tailor sidecar (keep-alive) ───────────────────────────────────────────
install_agent "com.atriveo.tailor" "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\"><dict>
  <key>Label</key><string>com.atriveo.tailor</string>
  <key>ProgramArguments</key><array>
    <string>$(command -v node)</string>
    <string>${ROOT}/sidecar/tailor-server.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key><dict>
    <key>YOUR_NAME</key><string>${YOUR_NAME:-}</string>
    <key>TAILOR_TOKEN</key><string>${TAILOR_TOKEN:-}</string>
    <key>RESUME_ENGINE_PATH</key><string>${RESUME_ENGINE_PATH:-${ROOT}/resume-engine}</string>
    <key>TAILOR_OUT_ROOT</key><string>${TAILOR_OUT_ROOT:-${ROOT}/output/tailored-resumes}</string>
    <key>OLLAMA_MODEL</key><string>${OLLAMA_MODEL:-gemma3:12b}</string>
    <key>OLLAMA_HOST</key><string>${OLLAMA_HOST:-127.0.0.1}</string>
  </dict>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/atriveo_tailor.log</string>
  <key>StandardErrorPath</key><string>/tmp/atriveo_tailor.log</string>
  <key>RunAtLoad</key><true/>
</dict></plist>"

echo -e "\n${BOLD}Services installed.${RESET}"
echo -e "  Scraper:    hourly at :00  →  /tmp/atriveo_scraper.log"
echo -e "  Feed sync:  hourly at :20  →  /tmp/atriveo_feed_sync.log"
echo -e "  Tailor:     always-on      →  /tmp/atriveo_tailor.log"
echo -e "\nCheck status:"
echo -e "  launchctl list | grep atriveo"
echo -e "  npm run pipeline:status\n"
