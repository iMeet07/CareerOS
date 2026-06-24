import { Router } from "express";
import { SignJWT } from "jose";
import { createHash, randomBytes } from "crypto";
import type { DbAdapter } from "../db/adapter.js";

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "dev-secret-change-me");
const TTL = 60 * 60 * 24 * 7; // 7 days

function hashPassword(password: string, salt: string): string {
  return createHash("sha256").update(password + salt).digest("hex");
}

async function makeToken(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${TTL}s`)
    .sign(secret);
}

export function authRouter(db: DbAdapter) {
  const router = Router();

  router.post("/register", async (req, res) => {
    try {
      const { email, password, name } = req.body;
      if (!email || !password || !name) { res.status(400).json({ error: "email, password, name required" }); return; }
      const existing = await db.getUserByEmail(email);
      if (existing) { res.status(409).json({ error: "Email already registered" }); return; }
      const salt = randomBytes(16).toString("hex");
      const password_hash = `${salt}:${hashPassword(password, salt)}`;
      await db.createUser({ email, password_hash, name, created_at: new Date().toISOString() });
      const token = await makeToken(email);
      res.json({ token, email, name });
    } catch {
      res.status(500).json({ error: "Registration failed" });
    }
  });

  router.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) { res.status(400).json({ error: "email and password required" }); return; }
      const user = await db.getUserByEmail(email);
      if (!user) { res.status(401).json({ error: "Invalid credentials" }); return; }
      const [salt, hash] = user.password_hash.split(":");
      if (hashPassword(password, salt) !== hash) { res.status(401).json({ error: "Invalid credentials" }); return; }
      const token = await makeToken(email);
      res.json({ token, email, name: user.name });
    } catch {
      res.status(500).json({ error: "Login failed" });
    }
  });

  router.post("/refresh", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) { res.status(401).json({ error: "No token" }); return; }
    try {
      const { jwtVerify } = await import("jose");
      const { payload } = await jwtVerify(token, secret);
      const newToken = await makeToken(payload.email as string);
      res.json({ token: newToken });
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  return router;
}
