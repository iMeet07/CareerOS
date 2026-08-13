#!/usr/bin/env node
// Run the base schema against a Postgres database.
// Requires DATABASE_URL in .env (or environment).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const sql = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations", "d1", "0001_init.sql"),
  "utf8"
);

// Postgres doesn't support "INTEGER DEFAULT 0" for booleans in the same way —
// replace SQLite-specific INTEGER with BOOLEAN for the remote column.
const pgSql = sql.replace(/remote\s+INTEGER/g, "remote BOOLEAN");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(pgSql);
  console.log("[migrate-postgres] Schema applied.");
} finally {
  await client.end();
}
