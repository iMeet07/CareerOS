import "dotenv/config";
import express from "express";
import cors from "cors";
import { createAdapter } from "./db/adapter.js";
import { jobsRouter } from "./routes/jobs.js";
import { contactsRouter } from "./routes/contacts.js";
import { templatesRouter } from "./routes/templates.js";
import { authRouter } from "./routes/auth.js";
import { emailfinderRouter } from "./routes/emailfinder.js";

const PORT = parseInt(process.env.SERVER_PORT ?? "3001");

async function main() {
  const db = await createAdapter();
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:5173", credentials: true }));
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true, db: process.env.DB_TYPE ?? "sqlite" }));

  app.use("/api/auth", authRouter(db));
  app.use("/api/jobs", jobsRouter(db));
  app.use("/api/contacts", contactsRouter(db));
  app.use("/api/templates", templatesRouter(db));
  app.use("/api/emailfinder", emailfinderRouter());

  app.listen(PORT, () => {
    console.log(`Atriveo server running on http://localhost:${PORT} [${process.env.DB_TYPE ?? "sqlite"}]`);
  });

  process.on("SIGTERM", async () => { await db.close(); process.exit(0); });
}

main().catch(console.error);
