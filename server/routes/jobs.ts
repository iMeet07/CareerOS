import { Router } from "express";
import type { DbAdapter } from "../db/adapter.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

export function jobsRouter(db: DbAdapter) {
  const router = Router();

  router.get("/", requireAuth, async (req: AuthRequest, res) => {
    try {
      const status = req.query.status as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const jobs = await db.getJobs({ status, limit });
      res.json({ jobs });
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch jobs" });
    }
  });

  router.patch("/:id/status", requireAuth, async (req, res) => {
    try {
      const { status } = req.body;
      if (!status) { res.status(400).json({ error: "status required" }); return; }
      await db.updateJobStatus(req.params.id, status);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Failed to update job status" });
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
    } catch {
      res.status(500).json({ error: "Ingest failed" });
    }
  });

  return router;
}
