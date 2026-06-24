import type { Job, Contact, Template, User } from "../types.js";

export interface DbAdapter {
  // Jobs
  getJobs(filters?: { status?: string; limit?: number }): Promise<Job[]>;
  upsertJob(job: Job): Promise<void>;
  updateJobStatus(id: string, status: string): Promise<void>;

  // Contacts
  getContacts(userEmail: string): Promise<Contact[]>;
  upsertContact(contact: Contact): Promise<void>;
  deleteContact(id: string, userEmail: string): Promise<void>;

  // Templates
  getTemplates(userEmail: string): Promise<Template[]>;
  upsertTemplate(template: Template): Promise<void>;
  deleteTemplate(id: string, userEmail: string): Promise<void>;

  // Auth
  getUserByEmail(email: string): Promise<User | null>;
  createUser(user: User): Promise<void>;

  close(): Promise<void>;
}

export async function createAdapter(): Promise<DbAdapter> {
  const type = process.env.DB_TYPE ?? "sqlite";

  switch (type) {
    case "postgres": {
      const { PostgresAdapter } = await import("./postgres.js");
      return new PostgresAdapter();
    }
    case "mongo": {
      const { MongoAdapter } = await import("./mongo.js");
      return new MongoAdapter();
    }
    default: {
      const { SqliteAdapter } = await import("./sqlite.js");
      return new SqliteAdapter();
    }
  }
}
