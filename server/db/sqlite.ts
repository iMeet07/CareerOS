import { createRequire } from "module";
import path from "path";
import fs from "fs";
import type { DbAdapter } from "./adapter.js";
import type { Job, Contact, Template, User } from "../types.js";

const require = createRequire(import.meta.url);

// better-sqlite3 is optional — only needed for local dev without Cloudflare
let Database: any;
try {
  Database = require("better-sqlite3");
} catch {
  throw new Error("better-sqlite3 not installed. Run: npm install better-sqlite3");
}

const DB_PATH = process.env.SQLITE_PATH ?? path.join(process.cwd(), "data", "careeros.db");

export class SqliteAdapter implements DbAdapter {
  private db: any;

  constructor() {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    this.db = new Database(DB_PATH);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate() {
    const sql = fs.readFileSync(
      new URL("../../migrations/d1/0001_init.sql", import.meta.url),
      "utf8"
    );
    this.db.exec(sql);
  }

  async getJobs(filters?: { status?: string; limit?: number }): Promise<Job[]> {
    let q = "SELECT * FROM jobs WHERE 1=1";
    const params: any[] = [];
    if (filters?.status) { q += " AND status = ?"; params.push(filters.status); }
    q += " ORDER BY score DESC, scraped_at DESC";
    if (filters?.limit) { q += " LIMIT ?"; params.push(filters.limit); }
    return this.db.prepare(q).all(...params);
  }

  async upsertJob(job: Job): Promise<void> {
    // Provide null defaults before spread so better-sqlite3 never sees missing named params
    this.db.prepare(`
      INSERT INTO jobs (id,title,company,location,url,source,score,status,description,salary,remote,posted_at,scraped_at,tags)
      VALUES (@id,@title,@company,@location,@url,@source,@score,@status,@description,@salary,@remote,@posted_at,@scraped_at,@tags)
      ON CONFLICT(id) DO UPDATE SET score=excluded.score, status=excluded.status, scraped_at=excluded.scraped_at
    `).run({ description: null, salary: null, posted_at: null, ...job, tags: JSON.stringify(job.tags ?? []), remote: job.remote ? 1 : 0 });
  }

  async getJobIds(): Promise<string[]> {
    return this.db.prepare("SELECT id FROM jobs").all().map((r: any) => r.id);
  }

  async updateJobStatus(id: string, status: string): Promise<void> {
    this.db.prepare("UPDATE jobs SET status=? WHERE id=?").run(status, id);
  }

  async getContacts(userEmail: string): Promise<Contact[]> {
    return this.db.prepare("SELECT * FROM contacts WHERE user_email=? ORDER BY created_at DESC").all(userEmail);
  }

  async upsertContact(contact: Contact): Promise<void> {
    this.db.prepare(`
      INSERT INTO contacts (id,user_email,name,company,email,title,confidence,created_at)
      VALUES (@id,@user_email,@name,@company,@email,@title,@confidence,@created_at)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, email=excluded.email
    `).run({ ...contact, title: contact.title ?? null, confidence: contact.confidence ?? null });
  }

  async deleteContact(id: string, userEmail: string): Promise<void> {
    this.db.prepare("DELETE FROM contacts WHERE id=? AND user_email=?").run(id, userEmail);
  }

  async getTemplates(userEmail: string): Promise<Template[]> {
    return this.db.prepare("SELECT * FROM templates WHERE user_email=? ORDER BY created_at DESC").all(userEmail);
  }

  async upsertTemplate(template: Template): Promise<void> {
    this.db.prepare(`
      INSERT INTO templates (id,user_email,name,subject,body,created_at)
      VALUES (@id,@user_email,@name,@subject,@body,@created_at)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, subject=excluded.subject, body=excluded.body
    `).run(template);
  }

  async deleteTemplate(id: string, userEmail: string): Promise<void> {
    this.db.prepare("DELETE FROM templates WHERE id=? AND user_email=?").run(id, userEmail);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    return this.db.prepare("SELECT * FROM users WHERE email=?").get(email) ?? null;
  }

  async createUser(user: User): Promise<void> {
    this.db.prepare(`
      INSERT INTO users (email,password_hash,name,created_at) VALUES (@email,@password_hash,@name,@created_at)
    `).run(user);
  }

  async updateUserPassword(email: string, passwordHash: string): Promise<void> {
    this.db.prepare("UPDATE users SET password_hash=? WHERE email=?").run(passwordHash, email);
  }

  async getUserPrefs(email: string): Promise<string> {
    const row = this.db.prepare("SELECT data FROM prefs WHERE user_email=?").get(email) as { data: string } | undefined;
    return row?.data ?? "{}";
  }

  async setUserPrefs(email: string, data: string): Promise<void> {
    this.db.prepare(`
      INSERT INTO prefs (user_email, data) VALUES (?, ?)
      ON CONFLICT(user_email) DO UPDATE SET data=excluded.data
    `).run(email, data);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
