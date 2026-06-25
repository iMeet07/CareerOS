import pg from "pg";
import type { DbAdapter } from "./adapter.js";
import type { Job, Contact, Template, User } from "../types.js";

const { Pool } = pg;

export class PostgresAdapter implements DbAdapter {
  private pool: pg.Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
    });
  }

  private async query(sql: string, params: any[] = []) {
    const client = await this.pool.connect();
    try {
      return await client.query(sql, params);
    } finally {
      client.release();
    }
  }

  async getJobs(filters?: { status?: string; limit?: number }): Promise<Job[]> {
    let q = "SELECT * FROM jobs WHERE 1=1";
    const params: any[] = [];
    if (filters?.status) { params.push(filters.status); q += ` AND status = $${params.length}`; }
    q += " ORDER BY score DESC, scraped_at DESC";
    if (filters?.limit) { params.push(filters.limit); q += ` LIMIT $${params.length}`; }
    const res = await this.query(q, params);
    return res.rows;
  }

  async upsertJob(job: Job): Promise<void> {
    await this.query(`
      INSERT INTO jobs (id,title,company,location,url,source,score,status,description,salary,remote,posted_at,scraped_at,tags)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT(id) DO UPDATE SET score=EXCLUDED.score, status=EXCLUDED.status, scraped_at=EXCLUDED.scraped_at
    `, [job.id, job.title, job.company, job.location, job.url, job.source, job.score, job.status,
        job.description, job.salary, job.remote, job.posted_at, job.scraped_at, JSON.stringify(job.tags ?? [])]);
  }

  async updateJobStatus(id: string, status: string): Promise<void> {
    await this.query("UPDATE jobs SET status=$1 WHERE id=$2", [status, id]);
  }

  async getContacts(userEmail: string): Promise<Contact[]> {
    const res = await this.query("SELECT * FROM contacts WHERE user_email=$1 ORDER BY created_at DESC", [userEmail]);
    return res.rows;
  }

  async upsertContact(contact: Contact): Promise<void> {
    await this.query(`
      INSERT INTO contacts (id,user_email,name,company,email,title,confidence,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email
    `, [contact.id, contact.user_email, contact.name, contact.company, contact.email,
        contact.title, contact.confidence, contact.created_at]);
  }

  async deleteContact(id: string, userEmail: string): Promise<void> {
    await this.query("DELETE FROM contacts WHERE id=$1 AND user_email=$2", [id, userEmail]);
  }

  async getTemplates(userEmail: string): Promise<Template[]> {
    const res = await this.query("SELECT * FROM templates WHERE user_email=$1 ORDER BY created_at DESC", [userEmail]);
    return res.rows;
  }

  async upsertTemplate(template: Template): Promise<void> {
    await this.query(`
      INSERT INTO templates (id,user_email,name,subject,body,created_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name, subject=EXCLUDED.subject, body=EXCLUDED.body
    `, [template.id, template.user_email, template.name, template.subject, template.body, template.created_at]);
  }

  async deleteTemplate(id: string, userEmail: string): Promise<void> {
    await this.query("DELETE FROM templates WHERE id=$1 AND user_email=$2", [id, userEmail]);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const res = await this.query("SELECT * FROM users WHERE email=$1", [email]);
    return res.rows[0] ?? null;
  }

  async createUser(user: User): Promise<void> {
    await this.query(
      "INSERT INTO users (email,password_hash,name,created_at) VALUES ($1,$2,$3,$4)",
      [user.email, user.password_hash, user.name, user.created_at]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
