#!/usr/bin/env node
/**
 * Atriveo tailor sidecar — standalone, no missing-module dependencies.
 *
 * Uses Ollama (gemma3:12b by default) to analyze job descriptions against your
 * bullet bank and resume, producing ATS optimization reports saved to disk.
 * Streams NDJSON progress events to the frontend.
 *
 * Run:  npm run tailor:prod
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { loadBullets, loadSafeClaims, loadBankNumbers, bankToPrompt } from "./tailor-bank.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(SCRIPT_DIR, "..");
dotenv.config({ path: path.join(ROOT, ".env") });

const PORT = 8787;
const TAILOR_TOKEN = process.env.TAILOR_TOKEN?.trim() || "";
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
  let bankSummary = "";
  if (BANK.roles.length || BANK.projects.length) {
    bankSummary = bankToPrompt(BANK);
    onLog?.("think", `Bank: ${BANK.roles.length} roles · ${BANK.projects.length} projects`);
  }
  const context = resumeText
    ? `${resumeText.trim()}\n\n--- BULLET BANK (additional variants) ---\n${bankSummary}`
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
    result.pdf = false;
    result.pdfPath = "";
    result.explain = {
      ats_before: ai.ats_before,
      ats_after: ai.ats_after,
      missing_keywords: ai.missing_keywords,
      skills_to_add: ai.skills_to_add,
      quick_wins: ai.quick_wins,
      bullet_rewrites: ai.bullet_rewrites,
    };

    onLog?.("result", `✓ Complete · ATS ${result.ats} · ${dir}`);
    onLog?.("think", "Note: PDF generation requires tectonic + LaTeX template. ATS report saved as ats_report.txt.");
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
            const pdfName = YOUR_NAME ? `${YOUR_NAME}.pdf` : "resume.pdf";
            const pdfPath = path.join(dir, pdfName);
            const hasPdf = fs.existsSync(pdfPath);
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
