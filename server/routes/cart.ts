import { Router } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";

// In-memory cart store per user email.
// On server restart the client syncs its localStorage back via PUT, so no data is lost.
const store = new Map<string, unknown>();

export function cartRouter() {
  const router = Router();

  router.get("/", requireAuth, async (req: AuthRequest, res) => {
    const data = store.get(req.userEmail!) ?? { items: [] };
    res.json(data);
  });

  router.put("/", requireAuth, async (req: AuthRequest, res) => {
    store.set(req.userEmail!, req.body);
    res.json({ ok: true });
  });

  return router;
}
