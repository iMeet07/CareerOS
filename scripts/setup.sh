#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Atriveo JD Extractor — one-time setup
# Run: bash scripts/setup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e
BOLD="\033[1m" CYAN="\033[36m" GREEN="\033[32m" RED="\033[31m" RESET="\033[0m"

echo -e "\n${BOLD}${CYAN}Atriveo JD Extractor — Setup${RESET}\n"

# ── 1. Check prerequisites ───────────────────────────────────────────────────
check() { command -v "$1" &>/dev/null && echo -e "${GREEN}✓${RESET} $1" || { echo -e "${RED}✗${RESET} $1 not found — install it first"; exit 1; }; }
check node; check npm; check python3; check wrangler

# ── 2. .env ─────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  echo -e "\n${BOLD}Created .env from .env.example${RESET}"
  echo -e "→ Open .env and fill in your credentials, then re-run this script.\n"
  exit 0
fi
echo -e "${GREEN}✓${RESET} .env found"

# ── 3. Node deps ─────────────────────────────────────────────────────────────
echo -e "\n${BOLD}Installing Node dependencies…${RESET}"
npm install --silent

# ── 4. Python deps ───────────────────────────────────────────────────────────
if [ -f job-pipeline/requirements.txt ]; then
  echo -e "\n${BOLD}Installing Python dependencies…${RESET}"
  python3 -m venv job-pipeline/.venv
  job-pipeline/.venv/bin/pip install -q -r job-pipeline/requirements.txt
  echo -e "${GREEN}✓${RESET} Python venv ready at job-pipeline/.venv"
fi

# ── 5. Resume engine ─────────────────────────────────────────────────────────
if [ ! -d resume-engine/Memory ]; then
  echo -e "\n${BOLD}Setting up resume engine…${RESET}"
  cp -r resume-engine-template resume-engine
  echo -e "${GREEN}✓${RESET} resume-engine/ created from template"
  echo -e "→ Edit ${BOLD}resume-engine/Memory/experience.md${RESET} with your own bullets."
  echo -e "→ Edit ${BOLD}resume-engine/Memory/QUESTION_ANSWERS.md${RESET} with your skills.\n"
fi

# ── 6. Cloudflare D1 ─────────────────────────────────────────────────────────
echo -e "\n${BOLD}Setting up Cloudflare D1 database…${RESET}"
source .env 2>/dev/null || true
if [ -z "$D1_DATABASE_ID" ]; then
  echo "Creating D1 database 'atriveo-auth'…"
  wrangler d1 create atriveo-auth 2>&1 | grep -E "database_id|created"
  echo -e "→ Copy the database_id above into your .env as D1_DATABASE_ID, then re-run."
  exit 0
fi
echo -e "${GREEN}✓${RESET} D1 database configured"
wrangler d1 execute atriveo-auth --local --file=migrations/0001_init.sql 2>/dev/null || true

# ── 7. Ollama model ──────────────────────────────────────────────────────────
if command -v ollama &>/dev/null; then
  MODEL="${OLLAMA_MODEL:-gemma3:12b}"
  echo -e "\n${BOLD}Checking Ollama model: ${MODEL}…${RESET}"
  if ollama list 2>/dev/null | grep -q "${MODEL%:*}"; then
    echo -e "${GREEN}✓${RESET} ${MODEL} already pulled"
  else
    echo "Pulling ${MODEL} (this may take a few minutes)…"
    ollama pull "$MODEL"
  fi
else
  echo -e "\n${RED}⚠${RESET}  Ollama not found — resume tailoring will not work."
  echo "   Install from: https://ollama.com"
fi

# ── 8. LaunchAgents (macOS only) ─────────────────────────────────────────────
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo -e "\n${BOLD}Installing macOS LaunchAgents…${RESET}"
  node scripts/install-pipeline-services.mjs 2>/dev/null && echo -e "${GREEN}✓${RESET} LaunchAgents installed" || echo "⚠ Run 'npm run pipeline:install' manually"
fi

echo -e "\n${GREEN}${BOLD}Setup complete!${RESET}"
echo -e "Next steps:"
echo -e "  1. ${BOLD}npm run dev${RESET}          — start the local dashboard"
echo -e "  2. ${BOLD}npm run tailor:prod${RESET}  — start the resume sidecar"
echo -e "  3. ${BOLD}npm run feed:sync${RESET}    — push job feed to Cloudflare"
echo -e "  4. ${BOLD}npm run deploy:pages${RESET} — deploy the app to Cloudflare Pages\n"
