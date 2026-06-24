#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Atriveo — OpenShift deploy script
# Usage: bash deploy/openshift/deploy.sh
# Prerequisites: oc CLI logged in, image already pushed to ghcr.io
# ─────────────────────────────────────────────────────────────────────────────
set -e
NS=atriveo
BOLD="\033[1m" GREEN="\033[32m" CYAN="\033[36m" RESET="\033[0m"

echo -e "\n${BOLD}${CYAN}Atriveo — Deploying to OpenShift${RESET}\n"

# Create namespace
oc get namespace $NS &>/dev/null || oc new-project $NS
echo -e "${GREEN}✓${RESET} Namespace: $NS"

# Load secrets from .env
if [ -f .env ]; then
  source .env
fi

# Apply ConfigMap + Secrets
oc apply -f deploy/openshift/configmap.yaml
echo -e "${GREEN}✓${RESET} ConfigMap and secrets applied"

# Load the SQL init script into a ConfigMap
oc create configmap postgres-init \
  --from-file=init.sql=migrations/postgres/0001_init.sql \
  -n $NS --dry-run=client -o yaml | oc apply -f -
echo -e "${GREEN}✓${RESET} Postgres init SQL loaded"

# Load the user's config.json
if [ -f config.json ]; then
  oc create configmap atriveo-scraper-config \
    --from-file=config.json=config.json \
    -n $NS --dry-run=client -o yaml | oc apply -f -
  echo -e "${GREEN}✓${RESET} Scraper config loaded"
else
  echo "⚠ config.json not found — using example config. Copy config.example.json to config.json first."
fi

# Deploy Postgres, Ollama, App, Scraper
oc apply -f deploy/openshift/postgres-statefulset.yaml
oc apply -f deploy/openshift/ollama-deployment.yaml
oc apply -f deploy/openshift/app-deployment.yaml
oc apply -f deploy/openshift/scraper-cronjob.yaml

echo -e "\n${GREEN}${BOLD}Deploy complete!${RESET}"
echo -e "Watch status:  oc get pods -n $NS -w"
echo -e "Get app URL:   oc get route atriveo-app -n $NS"
echo -e "Trigger scrape: oc create job --from=cronjob/atriveo-scraper manual-scrape -n $NS\n"
