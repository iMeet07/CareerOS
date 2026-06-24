#!/usr/bin/env node
/**
 * npm run pipeline:status
 * Health check for all Atriveo background services.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { platform } from "node:os";

const isMac = platform() === "darwin";
const isLinux = platform() === "linux";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function ok(msg) { console.log(`  ${GREEN}✓${RESET}  ${msg}`); }
function fail(msg) { console.log(`  ${RED}✗${RESET}  ${msg}`); }
function warn(msg) { console.log(`  ${YELLOW}⚠${RESET}  ${msg}`); }

console.log(`\n${BOLD}Atriveo — Service Status${RESET}\n`);

// ── Tailor sidecar (HTTP check) ───────────────────────────────────────────────
console.log(`${BOLD}Resume Sidecar (localhost:8787)${RESET}`);
try {
  const res = await fetch("http://localhost:8787/health", { signal: AbortSignal.timeout(3000) });
  const json = await res.json().catch(() => ({}));
  if (res.ok || json.error === "Unauthorized") {
    ok("Responding on :8787");
  } else {
    fail(`Unexpected response: ${res.status}`);
  }
} catch {
  fail("Not reachable — run: npm run tailor:prod");
}

// ── API server (HTTP check) ───────────────────────────────────────────────────
console.log(`\n${BOLD}API Server (localhost:3001)${RESET}`);
try {
  const res = await fetch("http://localhost:3001/health", { signal: AbortSignal.timeout(3000) });
  const json = await res.json().catch(() => ({}));
  ok(`Responding on :3001 [db: ${json.db ?? "unknown"}]`);
} catch {
  warn("Not running locally (expected if deployed to Cloudflare/OpenShift)");
}

// ── Ollama ────────────────────────────────────────────────────────────────────
console.log(`\n${BOLD}Ollama${RESET}`);
try {
  const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) });
  const json = await res.json().catch(() => ({}));
  const models = (json.models ?? []).map((m) => m.name);
  const target = process.env.OLLAMA_MODEL ?? "gemma3:12b";
  ok(`Running — ${models.length} model(s) loaded`);
  if (models.some((m) => m.startsWith(target.split(":")[0]))) {
    ok(`${target} is available`);
  } else {
    warn(`${target} not pulled — run: ollama pull ${target}`);
  }
} catch {
  fail("Not running — start Ollama or run: ollama serve");
}

// ── LaunchAgents (macOS) ──────────────────────────────────────────────────────
if (isMac) {
  console.log(`\n${BOLD}LaunchAgents (macOS)${RESET}`);
  const r = spawnSync("launchctl", ["list"], { encoding: "utf8" });
  const list = r.stdout ?? "";
  for (const label of ["com.atriveo.scraper", "com.atriveo.feed-sync", "com.atriveo.tailor"]) {
    if (list.includes(label)) ok(label);
    else fail(`${label} — run: npm run pipeline:install`);
  }
}

// ── systemd (Linux) ───────────────────────────────────────────────────────────
if (isLinux) {
  console.log(`\n${BOLD}systemd (Linux)${RESET}`);
  for (const unit of ["atriveo-scraper.timer", "atriveo-feed-sync.timer", "atriveo-tailor.service"]) {
    const r = spawnSync("systemctl", ["--user", "is-active", unit], { encoding: "utf8" });
    if ((r.stdout ?? "").trim() === "active") ok(unit);
    else fail(`${unit} — run: npm run pipeline:install:linux`);
  }
}

// ── resume-engine ─────────────────────────────────────────────────────────────
console.log(`\n${BOLD}Resume Engine${RESET}`);
const enginePath = process.env.RESUME_ENGINE_PATH ?? "./resume-engine";
const expPath = `${enginePath}/Memory/experience.md`;
const qaPath = `${enginePath}/Memory/QUESTION_ANSWERS.md`;
if (existsSync(expPath)) ok(`experience.md found at ${expPath}`);
else fail(`experience.md missing — copy resume-engine-template to ${enginePath} and fill it in`);
if (existsSync(qaPath)) ok("QUESTION_ANSWERS.md found");
else warn("QUESTION_ANSWERS.md missing");

console.log();
