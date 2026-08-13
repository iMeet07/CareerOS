import { Router } from "express";
import type { DbAdapter } from "../db/adapter.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import type { Job } from "../types.js";

// ─── Schema adapter ───────────────────────────────────────────────────────────
// The frontend's Job type uses different field names and units than the DB schema.
// Map server Job → frontend Job here so the UI works without touching the DB.

function inferLevel(title: string, desc: string): string {
  const text = `${title} ${desc}`.toLowerCase();
  if (/new\s*grad|recent\s*grad|entry[- ]?level.*0[- ]?(?:to|-)?\s*[12]\s*year|\b0[- ]?to[- ]?1\s*year/.test(text)) return "New Grad";
  if (/\b(?:0|1|1[- ]2|1[- ]3|one|two|2)\s*(?:to|\+)?\s*years?\s*(?:of\s*)?exp|\bjunior\b|\bassociate\b/.test(text)) return "Entry";
  return "Mid";
}

// Round scraped_at to the nearest 30-minute boundary (matches LaunchAgent interval)
// so all jobs from the same scraper run share a session_id.
function toSessionId(scrapedAt: string): string {
  try {
    const d = new Date(scrapedAt);
    const mins = d.getUTCMinutes() >= 30 ? 30 : 0;
    d.setUTCMinutes(mins, 0, 0);
    return d.toISOString().slice(0, 16); // "2026-08-12T14:30"
  } catch {
    return scrapedAt.slice(0, 13); // fallback: hour prefix
  }
}

function toFrontendJob(j: Job): object {
  const scorePct = Math.round(Math.min(j.score * 10, 100));
  return {
    session_id: toSessionId(j.scraped_at),
    title: j.title,
    company: j.company,
    location: j.location,
    level: inferLevel(j.title, j.description || ""),
    min_exp: null,
    max_exp: null,
    job_url: j.url,
    date_posted: j.posted_at || j.scraped_at,
    batch_time: j.scraped_at,
    score: scorePct,
    score_pct: scorePct,
    competition_score: 0,
    pipeline: j.source,
    site: j.source,
    search_term: j.source,
    summary: j.description ? j.description.slice(0, 500) : "",
    scraped_date: j.scraped_at ? j.scraped_at.slice(0, 10) : "",
    ats_score: null,
    fit_score: null,
    // also preserve server fields for status update / tailor flow
    id: j.id,
    status: j.status,
    tags: j.tags,
    remote: j.remote,
  };
}

export function jobsRouter(db: DbAdapter) {
  const router = Router();

  // Main feed endpoint — supports ?type=hour|today|yesterday|runs for the dashboard
  router.get("/", requireAuth, async (req: AuthRequest, res) => {
    try {
      const type = req.query.type as string | undefined;
      const statusFilter = req.query.status as string | undefined;
      const limitParam = req.query.limit ? parseInt(req.query.limit as string) : undefined;

      if (type === "week") {
        const allJobs = await db.getJobs({ limit: 50000 });
        const from = Date.now() - 7 * 24 * 3_600_000;
        const bucket = allJobs.filter((j) => {
          if (!j.scraped_at) return false;
          return new Date(j.scraped_at).getTime() >= from;
        });
        return res.json(bucket.map(toFrontendJob));
      }

      if (type === "hour" || type === "today" || type === "yesterday") {
        const allJobs = await db.getJobs({ limit: 5000 });
        const now = Date.now();

        const cutoffs: Record<string, [number, number]> = {
          hour:      [now - 2 * 3_600_000,  now],
          today:     [now - 24 * 3_600_000, now],
          yesterday: [now - 48 * 3_600_000, now - 24 * 3_600_000],
        };

        const [from, to] = cutoffs[type];
        const bucket = allJobs.filter((j) => {
          if (!j.scraped_at) return false;
          const t = new Date(j.scraped_at).getTime();
          return t >= from && t < to;
        });

        return res.json(bucket.map(toFrontendJob));
      }

      if (type === "runs") {
        // Aggregate jobs into session "runs" by 30-min bucket
        const allJobs = await db.getJobs({ limit: 10000 });
        const bySession = new Map<string, { run_at: string; total_jobs: number }>();
        for (const j of allJobs) {
          const sid = toSessionId(j.scraped_at);
          if (!bySession.has(sid)) {
            bySession.set(sid, { run_at: j.scraped_at, total_jobs: 0 });
          }
          bySession.get(sid)!.total_jobs += 1;
        }
        const runs = [...bySession.entries()]
          .map(([session_id, v]) => ({ session_id, ...v }))
          .sort((a, b) => new Date(b.run_at).getTime() - new Date(a.run_at).getTime())
          .slice(0, 50);
        return res.json(runs);
      }

      // Default: return jobs in server format (for status management etc.)
      const jobs = await db.getJobs({ status: statusFilter, limit: limitParam });
      res.json({ jobs });
    } catch (e) {
      console.error("[jobs] GET /:", e);
      res.status(500).json({ error: "Failed to fetch jobs" });
    }
  });

  router.patch("/:id/status", requireAuth, async (req, res) => {
    try {
      const { status } = req.body;
      if (!status) { res.status(400).json({ error: "status required" }); return; }
      await db.updateJobStatus(req.params.id, status);
      res.json({ ok: true });
    } catch (e) {
      console.error("[jobs] PATCH /:id/status:", e);
      res.status(500).json({ error: "Failed to update job status" });
    }
  });

  // Returns all known job IDs so the scraper can diff for truly new jobs (for notifications)
  router.get("/ids", async (req, res) => {
    const token = req.headers["x-scraper-token"];
    if (token !== process.env.SCRAPER_TOKEN) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      const ids = await db.getJobIds();
      res.json({ ids });
    } catch {
      res.status(500).json({ error: "Failed to fetch job IDs" });
    }
  });

  // Internal endpoint — called by the scraper, protected by SCRAPER_TOKEN
  router.post("/ingest", async (req, res) => {
    const token = req.headers["x-scraper-token"];
    if (token !== process.env.SCRAPER_TOKEN) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      const jobs = req.body.jobs ?? [req.body];
      for (const job of jobs) await db.upsertJob(job);
      res.json({ ok: true, count: jobs.length });
    } catch (e) {
      console.error("[jobs] POST /ingest:", e);
      res.status(500).json({ error: "Ingest failed" });
    }
  });

  return router;
}
