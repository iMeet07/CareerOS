import { Router } from "express";
import { randomUUID } from "crypto";
import type { DbAdapter } from "../db/adapter.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

export function contactsRouter(db: DbAdapter) {
  const router = Router();

  router.get("/", requireAuth, async (req: AuthRequest, res) => {
    try {
      const contacts = await db.getContacts(req.userEmail!);
      res.json({ contacts });
    } catch {
      res.status(500).json({ error: "Failed to fetch contacts" });
    }
  });

  router.post("/", requireAuth, async (req: AuthRequest, res) => {
    try {
      const contact = { id: randomUUID(), user_email: req.userEmail!, created_at: new Date().toISOString(), ...req.body };
      await db.upsertContact(contact);
      res.json({ contact });
    } catch {
      res.status(500).json({ error: "Failed to save contact" });
    }
  });

  router.delete("/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      await db.deleteContact(req.params.id, req.userEmail!);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Failed to delete contact" });
    }
  });

  return router;
}
