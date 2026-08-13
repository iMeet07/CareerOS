import { Router } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

// Stub for the external CareerOS tracker integration.
// The PUT endpoint returns a "not configured" response that the frontend
// (useApplyTracker describeTrackerSync) handles gracefully as a queued/local-only state.
// Replace with a real implementation when TRACKER_API_URL / TRACKER_API_TOKEN are set.
export function trackerRouter() {
  const router = Router();

  router.get("/", requireAuth, async (_req: AuthRequest, res) => {
    // Return empty — frontend falls back to localStorage as source of truth
    res.json({ count: 0, todayCount: 0, appliedJobs: {} });
  });

  router.put("/", requireAuth, async (_req: AuthRequest, res) => {
    const apiUrl = process.env.TRACKER_API_URL;
    const apiToken = process.env.TRACKER_API_TOKEN;
    const missing: string[] = [];
    if (!apiUrl) missing.push("TRACKER_API_URL");
    if (!apiToken) missing.push("TRACKER_API_TOKEN");
    res.json({ trackerSync: { configured: false, missing } });
  });

  return router;
}
