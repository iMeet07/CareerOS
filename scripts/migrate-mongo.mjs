#!/usr/bin/env node
// Ensure Mongoose indexes for the Mongo adapter.
// Requires MONGODB_URI in .env (or environment).
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const uri = process.env.MONGODB_URI ?? "mongodb://localhost:27017/atriveo";
await mongoose.connect(uri);

const JobSchema = new mongoose.Schema({ id: { type: String, unique: true }, title: String, company: String, location: String, url: String, source: String, score: Number, status: String, description: String, salary: String, remote: Boolean, posted_at: String, scraped_at: String, tags: [String] });
const ContactSchema = new mongoose.Schema({ id: { type: String, unique: true }, user_email: String, name: String, company: String, email: String, title: String, confidence: Number, created_at: String });
const TemplateSchema = new mongoose.Schema({ id: { type: String, unique: true }, user_email: String, name: String, subject: String, body: String, created_at: String });
const UserSchema = new mongoose.Schema({ email: { type: String, unique: true }, password_hash: String, name: String, created_at: String });

await Promise.all([
  mongoose.model("Job", JobSchema).createIndexes(),
  mongoose.model("Contact", ContactSchema).createIndexes(),
  mongoose.model("Template", TemplateSchema).createIndexes(),
  mongoose.model("User", UserSchema).createIndexes(),
]);

console.log("[migrate-mongo] Indexes ensured.");
await mongoose.disconnect();
