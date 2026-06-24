export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  source: "linkedin" | "greenhouse" | "lever" | "indeed" | "glassdoor" | "manual";
  score: number;
  status: "new" | "saved" | "applied" | "interviewing" | "offer" | "rejected" | "ignored";
  description?: string;
  salary?: string;
  remote?: boolean;
  posted_at?: string;
  scraped_at: string;
  tags?: string[];
}

export interface Contact {
  id: string;
  user_email: string;
  name: string;
  company: string;
  email: string;
  title?: string;
  confidence?: number;
  created_at: string;
}

export interface Template {
  id: string;
  user_email: string;
  name: string;
  subject: string;
  body: string;
  created_at: string;
}

export interface User {
  email: string;
  password_hash: string;
  name: string;
  created_at: string;
}

export interface TailorJob {
  id: string;
  job_id: string;
  status: "queued" | "compiling" | "done" | "failed";
  pdf_path?: string;
  enqueued_at: string;
  completed_at?: string;
  error?: string;
}
