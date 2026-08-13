import { Router } from "express";
import type { DbAdapter } from "../db/adapter.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

export function prefsRouter(db: DbAdapter) {
  const router = Router();

  router.get("/", requireAuth, async (req: AuthRequest, res) => {
    try {
      const data = await db.getUserPrefs(req.userEmail!);
      const parsed = JSON.parse(data);
      res.json(parsed);
    } catch (e) {
      console.error("[prefs] GET /:", e);
      res.status(500).json({ error: "Failed to fetch prefs" });
    }
  });

  router.put("/", requireAuth, async (req: AuthRequest, res) => {
    try {
      await db.setUserPrefs(req.userEmail!, JSON.stringify(req.body));
      res.json({ ok: true });
    } catch (e) {
      console.error("[prefs] PUT /:", e);
      res.status(500).json({ error: "Failed to save prefs" });
    }
  });

  return router;
}
