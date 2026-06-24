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

const DB_PATH = process.env.SQLITE_PATH ?? path.join(process.cwd(), "data", "atriveo.db");

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
    this.db.prepare(`
      INSERT INTO jobs (id,title,company,location,url,source,score,status,description,salary,remote,posted_at,scraped_at,tags)
      VALUES (@id,@title,@company,@location,@url,@source,@score,@status,@description,@salary,@remote,@posted_at,@scraped_at,@tags)
      ON CONFLICT(id) DO UPDATE SET score=excluded.score, status=excluded.status, scraped_at=excluded.scraped_at
    `).run({ ...job, tags: JSON.stringify(job.tags ?? []), remote: job.remote ? 1 : 0 });
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
    `).run(contact);
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

  async close(): Promise<void> {
    this.db.close();
  }
}
