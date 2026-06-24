import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";

// Hunter.io compatible email finder — swap EMAILFINDER_PROVIDER to use other providers
const PROVIDER = process.env.EMAILFINDER_PROVIDER ?? "hunter";
const API_KEY = process.env.EMAILFINDER_API_KEY ?? "";

async function findEmail(firstName: string, lastName: string, domain: string): Promise<{ email: string; confidence: number } | null> {
  if (PROVIDER === "hunter") {
    const url = `https://api.hunter.io/v2/email-finder?first_name=${firstName}&last_name=${lastName}&domain=${domain}&api_key=${API_KEY}`;
    const res = await fetch(url);
    const json = await res.json() as any;
    if (json.data?.email) return { email: json.data.email, confidence: json.data.score ?? 0 };
    return null;
  }
  // Add other providers (Clearbit, Snov.io, etc.) here
  return null;
}

export function emailfinderRouter() {
  const router = Router();

  router.post("/", requireAuth, async (req, res) => {
    try {
      const { firstName, lastName, company, domain } = req.body;
      if (!firstName || !lastName || (!company && !domain)) {
        res.status(400).json({ error: "firstName, lastName, and domain or company required" }); return;
      }
      const d = domain ?? `${company.toLowerCase().replace(/\s+/g, "")}.com`;
      const result = await findEmail(firstName, lastName, d);
      if (!result) { res.json({ found: false }); return; }
      res.json({ found: true, ...result });
    } catch {
      res.status(500).json({ error: "Email finder failed" });
    }
  });

  router.post("/bulk", requireAuth, async (req, res) => {
    try {
      const { people } = req.body as { people: Array<{ firstName: string; lastName: string; domain: string }> };
      if (!Array.isArray(people)) { res.status(400).json({ error: "people array required" }); return; }
      const results = await Promise.all(
        people.map(async (p) => {
          const r = await findEmail(p.firstName, p.lastName, p.domain);
          return { ...p, ...(r ?? { found: false }) };
        })
      );
      res.json({ results });
    } catch {
      res.status(500).json({ error: "Bulk email finder failed" });
    }
  });

  return router;
}
