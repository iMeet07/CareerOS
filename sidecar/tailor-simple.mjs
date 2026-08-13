#!/usr/bin/env node
/**
 * CareerOS tailor sidecar — standalone, no missing-module dependencies.
 *
 * Uses Ollama (gemma3:12b by default) to analyze job descriptions against your
 * bullet bank and resume, producing ATS optimization reports saved to disk.
 * Streams NDJSON progress events to the frontend.
 *
 * Run:  npm run tailor:prod
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { loadBullets, loadSafeClaims, loadBankNumbers, bankToPrompt } from "./tailor-bank.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(SCRIPT_DIR, "..");
dotenv.config({ path: path.join(ROOT, ".env") });

const PORT = 8787;
const TAILOR_TOKEN = process.env.TAILOR_TOKEN?.trim() || "";
if (!TAILOR_TOKEN) log("WARNING: TAILOR_TOKEN is not set — sidecar is open to any local caller");
const DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "gemma3:12b";
const OLLAMA_HOST = process.env.OLLAMA_HOST || "127.0.0.1";
const OLLAMA_PORT = 11434;
const OUT_ROOT = path.resolve(ROOT, process.env.TAILOR_OUT_ROOT || "output/tailored-resumes");
const YOUR_NAME = process.env.YOUR_NAME || "";
const MIN_FULL_JD_CHARS = 400;
const STREAM_HEARTBEAT_MS = 12_000;

const log = (...a) => console.log("[tailor]", ...a);

// ─── Bullet bank ─────────────────────────────────────────────────────────────
let BANK;
try {
  BANK = loadBullets();
  log(`Bank loaded · ${BANK.roles.length} roles · ${BANK.projects.length} projects`);
} catch (e) {
  log(`Bank load failed (continuing without bank): ${e.message}`);
  BANK = { roles: [], projects: [] };
}

// ─── ATS analysis prompt ──────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert ATS resume optimizer. Output ONE valid JSON object only — no markdown, no prose, nothing outside the JSON.

TRUTH RULES:
- Only claim what is in the candidate's real experience and bullet bank. Never fabricate tools, metrics, or outcomes.
- If a JD term has no evidence in the resume/bank, list it as missing. Do not claim it.

BULLET REWRITES:
- Rewrite AT MOST 6 bullets — only the ones that most help THIS job. Skip all others.
- "before": copy the bullet verbatim from the resume so it can be matched.
- "after": strong verb + scope/stack + measurable impact. Impact in first 8-12 words.
- Forbidden: semicolons, em-dashes, "leveraged", "spearheaded", "cutting-edge", "utilized", "responsible for".
- Good verbs: Built, Engineered, Automated, Reduced, Scaled, Architected, Optimized, Deployed, Designed.
- Only include a rewrite if it genuinely improves the bullet.

SCORING (be honest, not generous):
- ats_before = current resume vs this JD. Most resumes score 45-70 before tailoring.
- ats_after = after applying your rewrites and adding the suggested skills.
- Do not inflate. If the resume lacks core JD skills, ats_before should be low.

LIMITS (hard): missing_keywords ≤ 8, skills_to_add ≤ 6, bullet_rewrites ≤ 6, quick_wins ≤ 2 sentences.

Return ONLY valid JSON — no other text.`;

const RESPONSE_SCHEMA = {
  type: "object",
  required: ["ats_before", "ats_after", "missing_keywords", "skills_to_add", "bullet_rewrites", "quick_wins"],
  properties: {
    ats_before: { type: "integer" },
    ats_after: { type: "integer" },
    missing_keywords: { type: "array", items: { type: "string" }, maxItems: 8 },
    skills_to_add: { type: "array", items: { type: "string" }, maxItems: 6 },
    bullet_rewrites: {
      type: "array", maxItems: 6,
      items: {
        type: "object",
        required: ["before", "after", "reason"],
        properties: {
          before: { type: "string" },
          after: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
    quick_wins: { type: "string" },
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function slug(s, max = 40) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max) || "untitled";
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function makeNdjsonSender(res) {
  res.socket?.setNoDelay(true);
  return (obj) => {
    if (res.writableEnded) return false;
    const ok = res.write(JSON.stringify(obj) + "\n");
    if (typeof res.flush === "function") res.flush();
    return ok;
  };
}

function startStreamHeartbeat(send) {
  return setInterval(() => {
    try { send({ type: "ping", ts: new Date().toISOString() }); } catch { /* stream closed */ }
  }, STREAM_HEARTBEAT_MS);
}

function readAtsFromDir(dir) {
  try {
    const opt = JSON.parse(fs.readFileSync(path.join(dir, "optimizer.json"), "utf8"));
    if (opt.ats_before != null && opt.ats_after != null) return `${opt.ats_before}→${opt.ats_after}`;
  } catch { /* no optimizer.json */ }
  return null;
}

// ─── Ollama ───────────────────────────────────────────────────────────────────
// Use http module (not fetch) to avoid Undici's 300s body timeout on slow models.
function ollamaRequest(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ keep_alive: "30m", ...payload });
    const req = http.request({
      hostname: OLLAMA_HOST, port: OLLAMA_PORT,
      path: "/api/chat", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      res.socket?.setTimeout(0);
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode >= 400) {
          return reject(new Error(`Ollama HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString().slice(0, 200)}`));
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(new Error(`Ollama invalid JSON: ${e.message}`)); }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(0);
    req.write(body);
    req.end();
  });
}

async function checkOllama(model, onLog) {
  onLog?.("step", `Checking Ollama at http://${OLLAMA_HOST}:${OLLAMA_PORT}…`);
  const timeouts = [8000, 15000, 25000];
  let lastErr;
  for (let i = 0; i < timeouts.length; i++) {
    if (i > 0) {
      onLog?.("warn", `Ollama not ready — retry ${i + 1}/${timeouts.length} (${timeouts[i] / 1000}s timeout)`);
      await sleep(2000);
    }
    try {
      const res = await fetch(`http://${OLLAMA_HOST}:${OLLAMA_PORT}/api/tags`, { signal: AbortSignal.timeout(timeouts[i]) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const names = (data.models || []).map(m => m.name);
      const has = names.some(n => n === model || n.startsWith(`${model}:`));
      onLog?.("result", `Ollama online · ${names.length} model(s) available`);
      if (has) onLog?.("result", `Model ready: ${model}`);
      else onLog?.("warn", `Model "${model}" not found in list — will attempt anyway`);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  onLog?.("error", `Ollama unreachable: ${lastErr?.message} — run: ollama serve`);
  throw lastErr;
}

async function callOllama(model, jd, context, onLog) {
  const budgets = [3072, 5120];
  for (const budget of budgets) {
    const payload = {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `--- JOB DESCRIPTION ---\n${jd.trim()}\n\n--- MY RESUME & BULLET BANK ---\n${context.trim()}`,
        },
      ],
      stream: false,
      think: false,
      format: RESPONSE_SCHEMA,
      options: { temperature: 0.15, num_predict: budget, num_ctx: 16384 },
    };
    const t0 = Date.now();
    onLog?.("step", `Calling Ollama · model=${model} · budget=${budget} tokens…`);
    const data = await ollamaRequest(payload);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (data.done_reason === "length") {
      onLog?.("warn", `Truncated at ${budget} tokens after ${elapsed}s — retrying with larger budget`);
      continue;
    }
    onLog?.("result", `Ollama finished in ${elapsed}s · JSON ${data.message?.content?.length ?? 0} chars`);
    const result = JSON.parse(data.message.content);
    const clamp = n => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
    result.ats_before = clamp(result.ats_before);
    result.ats_after = clamp(result.ats_after);
    return result;
  }
  throw new Error(`Model output truncated even at ${budgets.at(-1)} tokens — JD may be too long`);
}

// ─── Refinement Ollama prompt ─────────────────────────────────────────────────
// Used for rounds 2-5: Ollama sees full JD + current resume + missing keywords.
const REFINE_SYSTEM = `You are an expert resume optimizer doing a targeted ATS refinement pass.
The resume did not reach the 95% ATS target. Your job: surgical rewrites only.

RULES:
- Study the full job description to understand HOW each missing keyword is actually used in context.
- Find the bullet in the current resume that is most relevant to that context.
- Rewrite it to naturally include the keyword — rephrase existing experience, never fabricate.
- For keywords that genuinely don't fit any bullet, add them to skills_to_add only.
- Only rewrite bullets that actually need to change. Leave the rest untouched.
- Forbidden: "leveraged", "spearheaded", "utilized", "responsible for", "cutting-edge".
- Good verbs: Built, Engineered, Deployed, Optimized, Automated, Designed, Scaled, Reduced.

Return ONLY valid JSON — no markdown, no prose, nothing outside the JSON.`;

const REFINE_SCHEMA = {
  type: "object",
  required: ["bullet_rewrites", "skills_to_add"],
  properties: {
    bullet_rewrites: {
      type: "array", maxItems: 10,
      items: {
        type: "object",
        required: ["before", "after"],
        properties: {
          before: { type: "string" },
          after:  { type: "string" },
        },
      },
    },
    skills_to_add: { type: "array", items: { type: "string" }, maxItems: 15 },
  },
};

async function callOllamaRefinement(model, jd, resumeMd, missingKeywords, atsScore, round, onLog) {
  const userPrompt = [
    `REFINEMENT ROUND ${round}/5`,
    `Current ATS Score: ${atsScore}%  →  Target: 95%`,
    `Keywords the ATS scorer still cannot find in the resume:`,
    missingKeywords.map(k => `  - ${k}`).join("\n"),
    ``,
    `=== FULL JOB DESCRIPTION (use this to understand each keyword's context) ===`,
    jd.trim(),
    ``,
    `=== CURRENT RESUME (find the right bullet to improve) ===`,
    resumeMd.trim(),
    ``,
    `For each missing keyword: read how the JD uses it, then rewrite the most relevant bullet to include it naturally.`,
  ].join("\n");

  const budgets = [2048, 3072];
  for (const budget of budgets) {
    const payload = {
      model,
      messages: [
        { role: "system", content: REFINE_SYSTEM },
        { role: "user",   content: userPrompt },
      ],
      stream: false,
      think: false,
      format: REFINE_SCHEMA,
      options: { temperature: 0.1, num_predict: budget, num_ctx: 16384 },
    };
    const t0 = Date.now();
    onLog?.("step", `Refinement · Ollama round ${round}/5 · ${missingKeywords.length} gaps · budget=${budget} tokens…`);
    const data = await ollamaRequest(payload);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (data.done_reason === "length") {
      onLog?.("warn", `Refinement truncated at ${budget} tokens after ${elapsed}s — retrying`);
      continue;
    }
    onLog?.("result", `Refinement Ollama done in ${elapsed}s`);
    return JSON.parse(data.message.content);
  }
  throw new Error("Refinement output truncated — resume or JD may be too long");
}

// ─── Resume Engine Machine bridge ────────────────────────────────────────────
const BRIDGE_PY = path.join(SCRIPT_DIR, "resume_bridge.py");
const REM_PATH  = process.env.RESUME_ENGINE_PATH || path.join(os.homedir(), "Resume Engine Machine");

function runBridge(dir, company, role, onLog, baseResumePath = null) {
  return new Promise((resolve) => {
    const env = { ...process.env, RESUME_ENGINE_PATH: REM_PATH };
    const args = [
      BRIDGE_PY,
      "--jd",        path.join(dir, "jd.txt"),
      "--optimizer", path.join(dir, "optimizer.json"),
      "--outdir",    dir,
      "--company",   company,
      "--role",      role,
    ];
    if (baseResumePath) args.push("--base-resume", baseResumePath);
    const proc = spawn("python3", args, { env });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", d => (stdout += d));
    proc.stderr.on("data", d => (stderr += d));

    const timer = setTimeout(() => {
      proc.kill();
      onLog?.("error", "resume_bridge.py timed out after 3 minutes");
      resolve(null);
    }, 180_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      // surface bridge warnings (skip pdflatex noise)
      for (const line of stderr.split("\n").filter(l => l.trim() && !l.includes("LaTeX")).slice(0, 4))
        onLog?.("warn", `bridge: ${line.trim()}`);
      if (code !== 0) {
        onLog?.("error", `resume_bridge.py exited ${code}`);
        return resolve(null);
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        onLog?.("error", `resume_bridge.py output not JSON: ${stdout.slice(0, 500)}${stderr ? ` | stderr: ${stderr.slice(0, 200)}` : ""}`);
        resolve(null);
      }
    });

    proc.on("error", err => {
      clearTimeout(timer);
      onLog?.("error", `resume_bridge.py spawn error: ${err.message}`);
      resolve(null);
    });
  });
}

// ─── Load resume text from disk (Resume Engine Machine templates) ─────────────
function loadResumeFromDisk() {
  const resumesDir = path.join(REM_PATH, "resumes");
  const files = ["base_SWE_SDE.md", "base_MLE_AI.md", "base_DS_Research.md", "base_DE.md", "base_DA_BI.md"];
  const parts = [];
  for (const f of files) {
    try {
      const text = fs.readFileSync(path.join(resumesDir, f), "utf8").trim();
      if (text) parts.push(`--- ${f} ---\n${text}`);
    } catch { /* file missing, skip */ }
  }
  return parts.join("\n\n");
}

// ─── Per-job tailor ───────────────────────────────────────────────────────────
async function tailorOne(job, resumeText, model, seq, dateDir, ctx) {
  const { sendPhase, log: onLog } = ctx;
  const company = job.company || "unknown";
  const role = job.title || "role";
  const folder = `${String(seq).padStart(2, "0")}-${slug(company, 24)}-${slug(role, 30)}`;
  const dir = path.join(dateDir, folder);
  const result = { folder, company, role, dir, status: "ok" };

  onLog?.("step", `━━━ Job ${seq} · ${company} · ${role} ━━━`);
  fs.mkdirSync(dir, { recursive: true });
  onLog?.("result", `Output dir: ${dir}`);

  const jd = (job.jd || "").trim();
  if (jd.length < MIN_FULL_JD_CHARS) {
    onLog?.("warn", `JD too short (${jd.length} chars < ${MIN_FULL_JD_CHARS}) — paste the full JD`);
    result.status = "no-jd";
    result.error = `JD too short (${jd.length} chars) — paste the full job description`;
    sendPhase("done", result);
    return result;
  }
  if (job.job_url) onLog?.("think", `Source URL: ${job.job_url}`);
  if (job.score_pct != null) onLog?.("think", `Feed match score: ${job.score_pct}%`);

  // Save job files
  fs.writeFileSync(path.join(dir, "jd.txt"), jd);
  const meta = { company, role, url: job.job_url, score_pct: job.score_pct, tailored_at: new Date().toISOString(), model };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2));

  // Build the context: resume text + bullet bank
  // If the frontend didn't send a resume, read templates directly from Resume Engine Machine.
  let effectiveResume = resumeText?.trim() || "";
  if (!effectiveResume) {
    effectiveResume = loadResumeFromDisk();
    if (effectiveResume) onLog?.("think", "Resume loaded from Resume Engine Machine templates");
    else onLog?.("warn", "No resume text — paste your resume in Settings or check RESUME_ENGINE_PATH");
  }

  let bankSummary = "";
  if (BANK.roles.length || BANK.projects.length) {
    bankSummary = bankToPrompt(BANK);
    onLog?.("think", `Bank: ${BANK.roles.length} roles · ${BANK.projects.length} projects`);
  }
  const context = effectiveResume
    ? `${effectiveResume}\n\n--- BULLET BANK (additional variants) ---\n${bankSummary}`
    : bankSummary || "(no resume text provided)";

  try {
    sendPhase("analyzing");
    onLog?.("step", "Phase 1/2 · Analyze — eligibility + keyword gap + bullet selection");
    await checkOllama(model, onLog);

    const ai = await callOllama(model, jd, context, onLog);

    // Save raw analysis
    fs.writeFileSync(path.join(dir, "optimizer.json"), JSON.stringify(ai, null, 2));
    onLog?.("result", "optimizer.json saved");

    // Write human-readable ATS report
    const delta = ai.ats_after - ai.ats_before;
    const sign = delta >= 0 ? "+" : "";
    const report = [
      `ATS ANALYSIS: ${company} — ${role}`,
      `Tailored: ${new Date().toLocaleString()}  |  Model: ${model}`,
      ``,
      `ATS Score: ${ai.ats_before}% → ${ai.ats_after}% (${sign}${delta})`,
      ``,
      `MISSING KEYWORDS (add these to your resume/cover letter):`,
      ...(ai.missing_keywords?.length
        ? ai.missing_keywords.map(k => `  - ${k}`)
        : ["  (none detected)"]),
      ``,
      `SKILLS TO ADD:`,
      ...(ai.skills_to_add?.length
        ? ai.skills_to_add.map(s => `  - ${s}`)
        : ["  (none suggested)"]),
      ``,
      `QUICK WINS:`,
      `  ${ai.quick_wins || "(none)"}`,
      ``,
      `BULLET REWRITES:`,
      ...(ai.bullet_rewrites?.length
        ? ai.bullet_rewrites.flatMap((rw, i) => [
            ``,
            `  [${i + 1}] BEFORE: ${rw.before}`,
            `      AFTER:  ${rw.after}`,
            `      WHY:    ${rw.reason}`,
          ])
        : ["  (no rewrites suggested)"]),
    ].join("\n");
    fs.writeFileSync(path.join(dir, "ats_report.txt"), report);
    onLog?.("result", `ats_report.txt saved · ATS ${ai.ats_before}% → ${ai.ats_after}%`);

    sendPhase("assembling");
    result.ats = `${ai.ats_before}→${ai.ats_after}`;
    result.explain = {
      ats_before: ai.ats_before,
      ats_after: ai.ats_after,
      missing_keywords: ai.missing_keywords,
      skills_to_add: ai.skills_to_add,
      quick_wins: ai.quick_wins,
      bullet_rewrites: ai.bullet_rewrites,
    };

    // Phase 2: assemble tailored resume + ATS refinement loop (up to 5 rounds)
    onLog?.("step", "Phase 2 · Assemble — select template → apply rewrites → inject keywords → ATS loop → PDF");
    const ATS_TARGET = 95;
    const MAX_ROUNDS = 5;

    let bridge = await runBridge(dir, company, role, onLog);
    const firstBridge = bridge; // preserve role_type + template from round 1

    if (bridge === null) {
      // bridge timed out or crashed (runBridge resolved null)
      onLog?.("error", "resume_bridge.py timed out or crashed — check pdflatex is installed and RESUME_ENGINE_PATH is correct");
      result.pdf = false;
      result.pdfPath = "";
      result.status = "bridge-timeout";
      result.error = "Resume assembly timed out after 3 minutes — pdflatex may be missing or RESUME_ENGINE_PATH is wrong";
      sendPhase("done", result);
      return result;
    }

    if (!bridge.ok) {
      // Python ran but returned an error (import failure, missing template, etc.)
      const bridgeErr = bridge.error || "resume_bridge.py returned ok=false";
      onLog?.("error", `Bridge error: ${bridgeErr}`);
      result.pdf = false;
      result.pdfPath = "";
      result.status = "bridge-error";
      result.error = bridgeErr;
      sendPhase("done", result);
      return result;
    }

    if (bridge.ok) {
      onLog?.("result", `Round 1 · ATS ${bridge.ats_score}%${bridge.ats_score >= ATS_TARGET ? " ✓ target reached" : ` · ${bridge.keywords_missing?.length ?? 0} gaps remain`}`);

      // Refinement loop — Ollama sees full JD + current resume + missing keywords each round
      if (bridge.ats_score < ATS_TARGET) {
        let currentResumePath = bridge.resume_md;

        for (let round = 2; round <= MAX_ROUNDS; round++) {
          const missing = bridge.keywords_missing || [];
          if (!missing.length) {
            onLog?.("result", "All JD keywords matched — stopping refinement early");
            break;
          }

          sendPhase("refining");
          onLog?.("step", `━━ Refinement ${round}/${MAX_ROUNDS} · ATS ${bridge.ats_score}% · ${missing.length} gap(s) ━━`);
          onLog?.("think", `Missing: ${missing.slice(0, 15).join(", ")}`);

          try {
            const currentResumeMd = fs.readFileSync(currentResumePath, "utf8");
            const refinement = await callOllamaRefinement(
              model, jd, currentResumeMd, missing, bridge.ats_score, round, onLog
            );

            fs.writeFileSync(path.join(dir, "optimizer.json"), JSON.stringify({
              bullet_rewrites: refinement.bullet_rewrites || [],
              missing_keywords: missing,
              skills_to_add: refinement.skills_to_add || [],
            }, null, 2));

            sendPhase("assembling");
            const nextBridge = await runBridge(dir, company, role, onLog, currentResumePath);

            if (nextBridge?.ok) {
              const improved = nextBridge.ats_score - bridge.ats_score;
              const sign = improved >= 0 ? "+" : "";
              onLog?.("result", `Round ${round} · ATS ${nextBridge.ats_score}% (${sign}${improved})${nextBridge.ats_score >= ATS_TARGET ? " ✓ target reached" : ""}`);
              bridge = nextBridge;
              currentResumePath = nextBridge.resume_md;
              if (bridge.ats_score >= ATS_TARGET) break;
            } else {
              onLog?.("warn", `Bridge failed in round ${round} — keeping round ${round - 1} result`);
              break;
            }
          } catch (e) {
            onLog?.("warn", `Refinement round ${round} error: ${e.message} — keeping previous result`);
            break;
          }
        }

        if (bridge.ats_score < ATS_TARGET) {
          onLog?.("result", `Best effort after ${MAX_ROUNDS} rounds · final ATS ${bridge.ats_score}%`);
        }
      }

      // Final result
      onLog?.("result", `Role type: ${firstBridge?.role_type} → template: ${firstBridge?.template}`);
      onLog?.("result", `Rewrites applied: ${bridge.rewrites_applied} · Keywords injected: ${bridge.keywords_injected}`);
      onLog?.("result", `Final ATS (internal scorer): ${bridge.ats_score}%`);
      result.explain.ats_internal     = bridge.ats_score;
      result.explain.role_type        = firstBridge?.role_type;
      result.explain.template         = firstBridge?.template;
      result.explain.keywords_missing = bridge.keywords_missing;

      if (bridge.pdf_ok) {
        result.pdf     = true;
        result.pdfPath = bridge.pdf_path;
        result.ats     = `${ai.ats_before}→${ai.ats_after} (internal: ${bridge.ats_score}%)`;
        onLog?.("result", `✓ PDF ready · ${bridge.pdf_pages}p · ${bridge.pdf_path}`);
      } else {
        result.pdf     = false;
        result.pdfPath = bridge.resume_md || "";
        const pdfErr = bridge.pdf_error || bridge.error || "unknown error";
        onLog?.("warn", `PDF failed — resume.md saved · ${pdfErr}`);
      }
    onLog?.("result", `✓ Complete · ATS ${ai.ats_before}→${ai.ats_after} (internal: ${bridge.ats_score ?? "?"}%) · ${dir}`);
  } catch (e) {
    result.status = "ai-failed";
    result.error = String(e.message || e);
    onLog?.("error", result.error);
  }
  sendPhase("done", result);
  return result;
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
let tailorBusy = false;

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Tailor-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const reqUrl = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = reqUrl.pathname;

  if (TAILOR_TOKEN && req.headers["x-tailor-token"] !== TAILOR_TOKEN) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
  }

  // GET /health
  if (req.method === "GET" && pathname === "/health") {
    fs.mkdirSync(OUT_ROOT, { recursive: true });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: true, driveMounted: true, outRoot: OUT_ROOT, pipeline: "simple", model: DEFAULT_MODEL,
    }));
  }

  // POST /tailor — NDJSON streaming analysis
  if (req.method === "POST" && pathname === "/tailor") {
    if (tailorBusy) {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Tailor busy — another job is still running. Wait for it to finish." }));
    }
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", async () => {
      tailorBusy = true;
      const send = makeNdjsonSender(res);
      let heartbeat = null;
      try {
        const { jobs, resumeText, model } = JSON.parse(raw);
        if (!Array.isArray(jobs) || !jobs.length) throw new Error("no jobs in request");
        const useModel = model || DEFAULT_MODEL;
        const date = new Date().toISOString().slice(0, 10);
        const dateDir = path.join(OUT_ROOT, date);
        fs.mkdirSync(dateDir, { recursive: true });
        const existing = fs.readdirSync(dateDir).filter(d => /^\d+-/.test(d));
        let seq = existing.length;

        res.writeHead(200, {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          "X-Accel-Buffering": "no",
        });
        if (typeof res.flushHeaders === "function") res.flushHeaders();

        heartbeat = startStreamHeartbeat(send);
        send({ type: "start", total: jobs.length, dateDir, model: useModel });
        log(`tailoring ${jobs.length} job(s) with ${useModel} → ${dateDir}`);

        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i];
          seq += 1;
          send({ type: "job", index: i, phase: "queued", company: job.company, role: job.title });
          const r = await tailorOne(job, resumeText, useModel, seq, dateDir, {
            sendPhase: (phase, extra) => send({ type: "job", index: i, phase, company: job.company, role: job.title, ...(extra || {}) }),
            log: (kind, text) => send({ type: "log", index: i, kind, text, ts: new Date().toISOString() }),
          });
          log(`  ${r.folder}: ${r.status}${r.ats ? ` (ATS ${r.ats})` : ""}${r.error ? ` — ${r.error}` : ""}`);
        }
        send({ type: "end" });
        res.end();
      } catch (e) {
        try { send({ type: "fatal", error: String(e.message || e) }); res.end(); }
        catch { if (!res.headersSent) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: String(e.message || e) })); } }
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        tailorBusy = false;
      }
    });
    return;
  }

  // GET /list-tailored
  if (req.method === "GET" && pathname === "/list-tailored") {
    try {
      const out = [];
      if (fs.existsSync(OUT_ROOT)) {
        const dateDirs = fs.readdirSync(OUT_ROOT)
          .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
          .sort().reverse().slice(0, 7);
        for (const dd of dateDirs) {
          const dateDir = path.join(OUT_ROOT, dd);
          let folders;
          try { folders = fs.readdirSync(dateDir).filter(d => /^\d+-/.test(d)); } catch { continue; }
          for (const folder of folders) {
            const dir = path.join(dateDir, folder);
            if (!fs.existsSync(path.join(dir, "optimizer.json"))) continue;
            let meta = {};
            try { meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")); } catch { /* ok */ }
            let explain = null;
            try { explain = JSON.parse(fs.readFileSync(path.join(dir, "optimizer.json"), "utf8")); } catch { /* ok */ }
            const ats = readAtsFromDir(dir);
            // Scan for any PDF — bridge names it ${YOUR_NAME}_{company}_{role}.pdf
            let pdfPath = null;
            try {
              const pdfs = fs.readdirSync(dir).filter(f => f.endsWith(".pdf"));
              if (pdfs.length > 0) pdfPath = path.join(dir, pdfs[0]);
            } catch { /* dir missing or unreadable */ }
            const hasPdf = pdfPath !== null;
            out.push({
              folder, dateDir: dd, dir,
              pdfPath: hasPdf ? pdfPath : null,
              company: meta.company || folder,
              title: meta.role || "",
              jobUrl: meta.url || "",
              score: meta.score_pct ?? null,
              ats, tailoredAt: meta.tailored_at || null,
              explain,
            });
          }
        }
      }
      out.sort((a, b) => new Date(b.tailoredAt || 0) - new Date(a.tailoredAt || 0));
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ ok: true, resumes: out }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
  }

  // POST /check-job { company, title }
  if (req.method === "POST" && pathname === "/check-job") {
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", () => {
      try {
        const { company, title } = JSON.parse(raw);
        const date = new Date().toISOString().slice(0, 10);
        const dateDir = path.join(OUT_ROOT, date);
        if (!fs.existsSync(dateDir)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true, found: false }));
        }
        const compSlug = slug(company || "", 24);
        const titleSlug = slug(title || "", 30);
        const dirs = fs.readdirSync(dateDir).filter(d => /^\d+-/.test(d)).reverse();
        let best = null;
        for (const d of dirs) {
          if (d.includes(compSlug) && d.includes(titleSlug)) { best = d; break; }
          if (!best && d.includes(compSlug)) best = d;
        }
        if (!best) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ ok: true, found: false }));
        }
        const dir = path.join(dateDir, best);
        const hasAnalysis = fs.existsSync(path.join(dir, "optimizer.json"));
        const ats = readAtsFromDir(dir);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, found: hasAnalysis, pdfPath: null, dir, folder: best, ats }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }

  // GET /resume-artifacts?dir=...
  if (req.method === "GET" && pathname === "/resume-artifacts") {
    try {
      const rawDir = reqUrl.searchParams.get("dir");
      if (!rawDir) throw new Error("dir required");
      const dir = path.resolve(rawDir);
      if (!dir.startsWith(OUT_ROOT)) throw new Error("invalid path");
      if (!fs.existsSync(dir)) throw new Error("not found");
      let explain = null;
      try { explain = JSON.parse(fs.readFileSync(path.join(dir, "optimizer.json"), "utf8")); } catch { /* ok */ }
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ ok: true, dir, explain, selectedAcs: [], coverage: null }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
  }

  // POST /open — reveal file/folder in Finder
  if (req.method === "POST" && pathname === "/open") {
    let raw = "";
    req.on("data", c => (raw += c));
    req.on("end", () => {
      try {
        const { path: target } = JSON.parse(raw);
        if (!target || !path.resolve(target).startsWith(OUT_ROOT)) throw new Error("invalid path");
        if (!fs.existsSync(target)) throw new Error("not found");
        const isFile = fs.statSync(target).isFile();
        spawnSync("open", isFile ? ["-R", target] : [target]);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  log(`listening on http://localhost:${PORT}`);
  log(`output → ${OUT_ROOT}`);
  log(`model  → ${DEFAULT_MODEL}`);
  fs.mkdirSync(OUT_ROOT, { recursive: true });
});
