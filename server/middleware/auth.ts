import { jwtVerify } from "jose";
import type { Request, Response, NextFunction } from "express";

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "dev-secret-change-me");

export interface AuthRequest extends Request {
  userEmail?: string;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "") ?? req.cookies?.token;
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const { payload } = await jwtVerify(token, secret);
    req.userEmail = payload.email as string;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}
