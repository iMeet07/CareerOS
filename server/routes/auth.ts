import { Router } from "express";
import { SignJWT, jwtVerify } from "jose";
import { createHash } from "crypto";
import bcrypt from "bcryptjs";
import type { DbAdapter } from "../db/adapter.js";

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "dev-secret-change-me");
const TTL = 60 * 60 * 24 * 7; // 7 days
const BCRYPT_ROUNDS = 12;
const REFRESH_WITHIN_S = 60 * 60 * 24; // re-issue cookie when < 1 day left

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  maxAge: TTL * 1000,
  path: "/",
};

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

// Backward-compatible verify: supports new bcrypt hashes and legacy "salt:sha256" hashes.
// On successful legacy login, the caller re-hashes with bcrypt and persists the upgrade.
async function verifyPassword(password: string, stored: string): Promise<{ ok: boolean; legacy: boolean }> {
  if (stored.startsWith("$2")) {
    return { ok: await bcrypt.compare(password, stored), legacy: false };
  }
  // Legacy SHA-256 format: "salt:hex"
  const [salt, hash] = stored.split(":");
  const ok = createHash("sha256").update(password + salt).digest("hex") === hash;
  return { ok, legacy: true };
}

async function makeToken(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${TTL}s`)
    .sign(secret);
}

function getToken(req: any): string | undefined {
  return req.headers.authorization?.replace("Bearer ", "") ?? req.cookies?.token;
}

export function authRouter(db: DbAdapter) {
  const router = Router();

  router.post("/register", async (req, res) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password || !name) { res.status(400).json({ error: "email, password, name required" }); return; }
      const existing = await db.getUserByEmail(email);
      if (existing) { res.status(409).json({ error: "Email already registered" }); return; }
      const password_hash = await hashPassword(password);
      await db.createUser({ email, password_hash, name, created_at: new Date().toISOString() });
      const token = await makeToken(email);
      res.cookie("token", token, COOKIE_OPTS);
      res.json({ token, email, name });
    } catch (e) {
      console.error("[auth] POST /register:", e);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  router.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) { res.status(400).json({ error: "email and password required" }); return; }
      const user = await db.getUserByEmail(email);
      if (!user) { res.status(401).json({ error: "Invalid credentials" }); return; }
      const { ok, legacy } = await verifyPassword(password, user.password_hash);
      if (!ok) { res.status(401).json({ error: "Invalid credentials" }); return; }
      // Silently upgrade legacy SHA-256 hash to bcrypt on first successful login
      if (legacy) {
        const newHash = await hashPassword(password);
        await db.updateUserPassword(email, newHash);
      }
      const token = await makeToken(email);
      res.cookie("token", token, COOKIE_OPTS);
      res.json({ token, email, name: user.name });
    } catch (e) {
      console.error("[auth] POST /login:", e);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Returns current user from cookie/Authorization header — called on every page load.
  // Auto-issues a fresh cookie when the token is within 24 h of expiry (silent refresh).
  router.get("/me", async (req, res) => {
    const token = getToken(req);
    if (!token) { res.json({ user: null }); return; }
    try {
      const { payload } = await jwtVerify(token, secret);
      const user = await db.getUserByEmail(payload.email as string);
      if (!user) { res.json({ user: null }); return; }
      const exp = payload.exp as number | undefined;
      if (exp && exp - Math.floor(Date.now() / 1000) < REFRESH_WITHIN_S) {
        const newToken = await makeToken(payload.email as string);
        res.cookie("token", newToken, COOKIE_OPTS);
      }
      res.json({ user: { email: user.email, name: user.name } });
    } catch {
      res.json({ user: null });
    }
  });

  router.post("/logout", (_req, res) => {
    res.clearCookie("token", { path: "/" });
    res.json({ ok: true });
  });

  router.post("/refresh", async (req, res) => {
    const token = getToken(req);
    if (!token) { res.status(401).json({ error: "No token" }); return; }
    try {
      const { payload } = await jwtVerify(token, secret);
      const newToken = await makeToken(payload.email as string);
      res.cookie("token", newToken, COOKIE_OPTS);
      res.json({ token: newToken });
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  return router;
}
