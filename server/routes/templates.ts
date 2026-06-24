import { Router } from "express";
import { randomUUID } from "crypto";
import type { DbAdapter } from "../db/adapter.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

export function templatesRouter(db: DbAdapter) {
  const router = Router();

  router.get("/", requireAuth, async (req: AuthRequest, res) => {
    try {
      const templates = await db.getTemplates(req.userEmail!);
      res.json({ templates });
    } catch {
      res.status(500).json({ error: "Failed to fetch templates" });
    }
  });

  router.post("/", requireAuth, async (req: AuthRequest, res) => {
    try {
      const template = { id: randomUUID(), user_email: req.userEmail!, created_at: new Date().toISOString(), ...req.body };
      await db.upsertTemplate(template);
      res.json({ template });
    } catch {
      res.status(500).json({ error: "Failed to save template" });
    }
  });

  router.delete("/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      await db.deleteTemplate(req.params.id, req.userEmail!);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Failed to delete template" });
    }
  });

  return router;
}
