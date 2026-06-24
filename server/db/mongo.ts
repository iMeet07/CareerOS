import mongoose, { Schema, model } from "mongoose";
import type { DbAdapter } from "./adapter.js";
import type { Job, Contact, Template, User } from "../types.js";

const JobSchema = new Schema<Job>({
  id: { type: String, required: true, unique: true },
  title: String, company: String, location: String, url: String,
  source: String, score: Number, status: String, description: String,
  salary: String, remote: Boolean, posted_at: String,
  scraped_at: String, tags: [String],
});

const ContactSchema = new Schema<Contact>({
  id: { type: String, required: true, unique: true },
  user_email: String, name: String, company: String,
  email: String, title: String, confidence: Number, created_at: String,
});

const TemplateSchema = new Schema<Template>({
  id: { type: String, required: true, unique: true },
  user_email: String, name: String, subject: String,
  body: String, created_at: String,
});

const UserSchema = new Schema<User>({
  email: { type: String, required: true, unique: true },
  password_hash: String, name: String, created_at: String,
});

const JobModel = model("Job", JobSchema);
const ContactModel = model("Contact", ContactSchema);
const TemplateModel = model("Template", TemplateSchema);
const UserModel = model("User", UserSchema);

export class MongoAdapter implements DbAdapter {
  constructor() {
    mongoose.connect(process.env.MONGODB_URI ?? "mongodb://localhost:27017/atriveo");
  }

  async getJobs(filters?: { status?: string; limit?: number }): Promise<Job[]> {
    const q: any = {};
    if (filters?.status) q.status = filters.status;
    let cursor = JobModel.find(q).sort({ score: -1, scraped_at: -1 });
    if (filters?.limit) cursor = cursor.limit(filters.limit);
    return (await cursor.lean()) as unknown as Job[];
  }

  async upsertJob(job: Job): Promise<void> {
    await JobModel.findOneAndUpdate({ id: job.id }, job, { upsert: true });
  }

  async updateJobStatus(id: string, status: string): Promise<void> {
    await JobModel.updateOne({ id }, { status });
  }

  async getContacts(userEmail: string): Promise<Contact[]> {
    return (await ContactModel.find({ user_email: userEmail }).sort({ created_at: -1 }).lean()) as unknown as Contact[];
  }

  async upsertContact(contact: Contact): Promise<void> {
    await ContactModel.findOneAndUpdate({ id: contact.id }, contact, { upsert: true });
  }

  async deleteContact(id: string, userEmail: string): Promise<void> {
    await ContactModel.deleteOne({ id, user_email: userEmail });
  }

  async getTemplates(userEmail: string): Promise<Template[]> {
    return (await TemplateModel.find({ user_email: userEmail }).sort({ created_at: -1 }).lean()) as unknown as Template[];
  }

  async upsertTemplate(template: Template): Promise<void> {
    await TemplateModel.findOneAndUpdate({ id: template.id }, template, { upsert: true });
  }

  async deleteTemplate(id: string, userEmail: string): Promise<void> {
    await TemplateModel.deleteOne({ id, user_email: userEmail });
  }

  async getUserByEmail(email: string): Promise<User | null> {
    return (await UserModel.findOne({ email }).lean()) as unknown as User | null;
  }

  async createUser(user: User): Promise<void> {
    await UserModel.create(user);
  }

  async close(): Promise<void> {
    await mongoose.disconnect();
  }
}
