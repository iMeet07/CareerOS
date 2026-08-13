import { Router } from "express";
import type { DbAdapter } from "../db/adapter.js";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import type { Job } from "../types.js";

// ─── Schema adapter ───────────────────────────────────────────────────────────
// The frontend's Job type uses different field names and units than the DB schema.
// Map server Job → frontend Job here so the UI works without touching the DB.

function inferLevel(title: string, desc: string): string {
  const t = title.toLowerCase();
  const text = `${t} ${desc}`.toLowerCase();
  if (/\b(staff|principal|director|vp\b|vice\s+president|head\s+of|distinguished|fellow|partner)\b/.test(t)) return "Senior";
  if (/\b(senior|sr\.?\s)/i.test(t)) return "Senior";
  if (/new\s*grad|recent\s*grad|entry[- ]?level.*0[- ]?(?:to|-)?\s*[12]\s*year|\b0[- ]?to[- ]?1\s*year/.test(text)) return "New Grad";
  if (/\b(?:0|1|1[- ]2|1[- ]3|one|two|2)\s*(?:to|\+)?\s*years?\s*(?:of\s*)?exp|\bjunior\b|\bassociate\b/.test(text)) return "Entry";
  return "Mid";
}

// Python datetime.isoformat() emits microseconds (6 digits) without a Z.
// JS Date can only parse ≤3 fractional digits; 6-digit strings shift the time by hours.
// Truncate to ms and append Z so the timestamp is always treated as UTC.
function parseTs(ts: string): number {
  return new Date(ts.slice(0, 23) + "Z").getTime();
}

// Round scraped_at to the nearest 30-minute boundary (matches LaunchAgent interval)
// so all jobs from the same scraper run share a session_id.
function toSessionId(scrapedAt: string): string {
  try {
    const d = new Date(scrapedAt.slice(0, 23) + "Z");
    const mins = d.getUTCMinutes() >= 30 ? 30 : 0;
    d.setUTCMinutes(mins, 0, 0);
    return d.toISOString().slice(0, 16); // "2026-08-12T14:30"
  } catch {
    return scrapedAt.slice(0, 13); // fallback: hour prefix
  }
}

function toFrontendJob(j: Job): object {
  const scorePct = Math.round(Math.min(j.score * 10, 100));
  return {
    session_id: toSessionId(j.scraped_at),
    title: j.title,
    company: j.company,
    location: j.location,
    level: inferLevel(j.title, j.description || ""),
    min_exp: null,
    max_exp: null,
    job_url: j.url,
    date_posted: j.posted_at || j.scraped_at,
    batch_time: j.scraped_at,
    score: scorePct,
    score_pct: scorePct,
    competition_score: 0,
    pipeline: j.source,
    site: j.source,
    search_term: j.source,
    summary: j.description ? j.description.slice(0, 500) : "",
    scraped_date: j.scraped_at ? j.scraped_at.slice(0, 10) : "",
    ats_score: null,
    fit_score: null,
    // also preserve server fields for status update / tailor flow
    id: j.id,
    status: j.status,
    tags: j.tags,
    remote: j.remote,
  };
}

// Hash a job URL to a 2-char hex bucket — MUST match jobDescriptionBuckets.ts exactly.
function jobUrlBucket(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash * 31) + url.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 2);
}

function htmlToText(html: string): string {
  // Decode entity-encoded HTML first so that &lt;div&gt; → <div> before tag stripping.
  // Greenhouse stores descriptions as HTML entity strings; Lever stores plain text.
  let s = html
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|ul|ol|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Use Workday's CXS JSON API to get the full job description for a Workday URL.
// URL format: https://{tenant}.{wd}.myworkdayjobs.com/en-XX/{board}/job/{slug}/{id}
async function fetchWorkdayJd(url: string): Promise<string | null> {
  const m = url.match(
    /^https?:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com(?:\/[^\/]+)?\/([^\/]+)\/(job\/.+?)(?:\?.*)?$/i
  );
  if (!m) return null;
  const [, tenant, wd, board, jobPath] = m;
  const apiUrl = `https://${tenant}.${wd}.myworkdayjobs.com/wday/cxs/${tenant}/${board}/jobs/${jobPath}`;
  try {
    const r = await fetch(apiUrl, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const data = await r.json() as Record<string, unknown>;
    const html = (data.jobPostingDescription ?? data.description ?? data.externalDescriptionStr ?? "") as string;
    const text = htmlToText(html);
    return text.length > 200 ? text : null;
  } catch {
    return null;
  }
}

// ─── Skills frequency patterns (mirrors Skills.tsx RESUME_PATTERNS) ───────────
const SKILL_PATTERNS: Array<[string, string, RegExp]> = [
  // Languages
  ["Languages","Python",/python/i],["Languages","Java",/\bjava\b/i],
  ["Languages","JavaScript",/javascript/i],["Languages","TypeScript",/typescript/i],
  ["Languages","Go",/golang|\bgo lang\b|go developer/i],["Languages","Scala",/\bscala\b/i],
  ["Languages","Kotlin",/kotlin/i],["Languages","C#",/\bc#\b|csharp/i],
  ["Languages","C++",/c\+\+|\bcpp\b/i],["Languages","Rust",/\brust\b/i],
  ["Languages","Ruby",/\bruby\b/i],[".NET",".NET",/\.net\b|dotnet/i],
  ["Languages","SQL",/\bsql\b/i],["Languages","Bash/Shell",/\bbash\b|shell scripting/i],
  // Frameworks
  ["Frameworks & Libraries","React",/\breact\b|react\.js|reactjs/i],
  ["Frameworks & Libraries","Node.js",/node\.js|nodejs/i],
  ["Frameworks & Libraries","Spring Boot",/spring boot/i],
  ["Frameworks & Libraries","FastAPI",/fastapi/i],["Frameworks & Libraries","Django",/django/i],
  ["Frameworks & Libraries","Flask",/\bflask\b/i],
  ["Frameworks & Libraries","Next.js",/next\.js|nextjs/i],
  ["Frameworks & Libraries","GraphQL",/graphql/i],
  ["Frameworks & Libraries","PyTorch",/pytorch/i],["Frameworks & Libraries","TensorFlow",/tensorflow/i],
  ["Frameworks & Libraries","Pandas",/pandas/i],["Frameworks & Libraries","Scikit-learn",/scikit[- ]learn|sklearn/i],
  // Cloud
  ["Cloud","AWS",/\baws\b|amazon web services/i],["Cloud","GCP",/\bgcp\b|google cloud/i],
  ["Cloud","Azure",/\bazure\b|microsoft azure/i],["Cloud","Lambda",/\blambda\b/i],
  ["Cloud","S3",/\bs3\b/i],["Cloud","DynamoDB",/dynamodb/i],["Cloud","Kubernetes",/kubernetes|\bk8s\b/i],
  ["Cloud","EC2",/\bec2\b/i],["Cloud","EKS",/\beks\b/i],
  // Backend & Architecture
  ["Backend & Architecture","Microservices",/microservices/i],
  ["Backend & Architecture","REST API",/rest api|restful/i],
  ["Backend & Architecture","Kafka",/kafka/i],["Backend & Architecture","gRPC",/\bgrpc\b/i],
  ["Backend & Architecture","System Design",/system design/i],
  ["Backend & Architecture","Distributed Systems",/distributed systems/i],
  ["Backend & Architecture","Caching",/\bcaching\b/i],
  // DevOps
  ["DevOps & Infrastructure","Docker",/docker/i],
  ["DevOps & Infrastructure","Terraform",/terraform/i],
  ["DevOps & Infrastructure","CI/CD",/ci\/cd|continuous integration|continuous deploy/i],
  ["DevOps & Infrastructure","GitHub Actions",/github actions/i],
  ["DevOps & Infrastructure","Helm",/\bhelm\b/i],["DevOps & Infrastructure","Linux",/linux/i],
  ["DevOps & Infrastructure","Prometheus",/prometheus/i],["DevOps & Infrastructure","Grafana",/grafana/i],
  // Data & Storage
  ["Data & Storage","PostgreSQL",/postgresql|postgres/i],["Data & Storage","MySQL",/mysql/i],
  ["Data & Storage","MongoDB",/mongodb/i],["Data & Storage","Redis",/redis/i],
  ["Data & Storage","Elasticsearch",/elasticsearch|opensearch/i],
  ["Data & Storage","BigQuery",/bigquery/i],["Data & Storage","Snowflake",/snowflake/i],
  ["Data & Storage","Spark",/apache spark|pyspark|\bspark\b/i],
  ["Data & Storage","Airflow",/airflow/i],["Data & Storage","dbt",/\bdbt\b/i],
  ["Data & Storage","ETL/ELT",/\betl\b|\belt\b|data pipeline/i],
  ["Data & Storage","Vector DB",/vector database|vector db|pinecone|weaviate|chroma/i],
  // AI & ML
  ["AI & Machine Learning","LLM",/\bllm\b|large language model/i],
  ["AI & Machine Learning","GenAI",/generative ai|gen ai|\bgenai\b/i],
  ["AI & Machine Learning","RAG",/\brag\b|retrieval.augmented/i],
  ["AI & Machine Learning","Machine Learning",/machine learning|\bml\b model/i],
  ["AI & Machine Learning","Deep Learning",/deep learning/i],
  ["AI & Machine Learning","NLP",/\bnlp\b|natural language processing/i],
  ["AI & Machine Learning","Hugging Face",/hugging face|huggingface|transformers/i],
  ["AI & Machine Learning","LangChain",/langchain/i],["AI & Machine Learning","OpenAI",/openai/i],
  ["AI & Machine Learning","Fine-tuning",/fine.tun/i],
  ["AI & Machine Learning","Embeddings",/embeddings|vector embeddings/i],
  // Security
  ["Security","OAuth/OIDC",/oauth|\boidc\b|openid connect/i],
  ["Security","JWT",/\bjwt\b/i],["Security","TLS/SSL",/\btls\b|\bssl\b/i],
  ["Security","IAM",/aws iam|iam roles|identity.*access management/i],
  ["Security","RBAC",/\brbac\b|role.based access/i],
];

function buildSkillsSummary(jobs: Job[]): object {
  const counts: Record<string, Record<string, number>> = {};
  for (const [cat, skill] of SKILL_PATTERNS) {
    if (!counts[cat]) counts[cat] = {};
    counts[cat][skill] = 0;
  }
  let analyzed = 0;
  for (const job of jobs) {
    const text = job.description || "";
    if (!text) continue;
    analyzed++;
    for (const [cat, skill, rx] of SKILL_PATTERNS) {
      if (rx.test(text)) counts[cat][skill]++;
    }
  }
  // Sort each category's skills by count desc, drop zeros
  const categories: Record<string, { color: string; skills: Record<string, number> }> = {};
  const CAT_COLOR: Record<string, string> = {
    "Languages":               "oklch(0.66 0.19 255)",
    "Frameworks & Libraries":  "oklch(0.70 0.16 240)",
    "Cloud":                   "oklch(0.62 0.18 265)",
    "Backend & Architecture":  "oklch(0.68 0.17 250)",
    "DevOps & Infrastructure": "oklch(0.64 0.20 260)",
    "Data & Storage":          "oklch(0.72 0.15 235)",
    "AI & Machine Learning":   "oklch(0.75 0.18 255)",
    "Security":                "oklch(0.60 0.17 270)",
  };
  for (const [cat, skills] of Object.entries(counts)) {
    const sorted = Object.entries(skills)
      .filter(([, n]) => n > 0)
      .sort(([, a], [, b]) => b - a);
    if (sorted.length) {
      categories[cat] = { color: CAT_COLOR[cat] ?? "oklch(0.66 0.19 255)", skills: Object.fromEntries(sorted) };
    }
  }
  return { generated_at: new Date().toISOString(), total_analyzed: analyzed, categories };
}

export function jobsRouter(db: DbAdapter) {
  const router = Router();

  // Main feed endpoint — supports ?type=hour|today|yesterday|runs|skills_summary for the dashboard
  router.get("/", requireAuth, async (req: AuthRequest, res) => {
    try {
      const type = req.query.type as string | undefined;
      const statusFilter = req.query.status as string | undefined;
      const rawLimit = req.query.limit as string | undefined;
      const limitParam = rawLimit ? (parseInt(rawLimit) || undefined) : undefined;

      if (type === "skills_summary") {
        const allJobs = await db.getJobs({ limit: 50_000 });
        return res.json(buildSkillsSummary(allJobs));
      }

      if (type === "week") {
        const allJobs = await db.getJobs({ limit: 50000 });
        const from = Date.now() - 7 * 24 * 3_600_000;
        const bucket = allJobs.filter((j) => {
          if (!j.scraped_at) return false;
          return parseTs(j.scraped_at) >= from;
        });
        return res.json(bucket.map(toFrontendJob));
      }

      if (type === "hour" || type === "today" || type === "yesterday") {
        const allJobs = await db.getJobs({ limit: 5000 });
        const now = Date.now();

        const cutoffs: Record<string, [number, number]> = {
          hour:      [now - 2 * 3_600_000,  now],
          today:     [now - 24 * 3_600_000, now],
          yesterday: [now - 48 * 3_600_000, now - 24 * 3_600_000],
        };

        const [from, to] = cutoffs[type];
        const bucket = allJobs.filter((j) => {
          if (!j.scraped_at) return false;
          const t = parseTs(j.scraped_at);
          return t >= from && t < to;
        });

        return res.json(bucket.map(toFrontendJob));
      }

      if (type === "runs") {
        // Aggregate jobs into session "runs" by 30-min bucket
        const allJobs = await db.getJobs({ limit: 10000 });
        const bySession = new Map<string, { run_at: string; total_jobs: number }>();
        for (const j of allJobs) {
          const sid = toSessionId(j.scraped_at);
          if (!bySession.has(sid)) {
            bySession.set(sid, { run_at: j.scraped_at, total_jobs: 0 });
          }
          bySession.get(sid)!.total_jobs += 1;
        }
        const runs = [...bySession.entries()]
          .map(([session_id, v]) => ({ session_id, ...v }))
          .sort((a, b) => new Date(b.run_at).getTime() - new Date(a.run_at).getTime())
          .slice(0, 50);
        return res.json(runs);
      }

      // Default: return jobs in server format (for status management etc.)
      const jobs = await db.getJobs({ status: statusFilter, limit: limitParam });
      res.json({ jobs });
    } catch (e) {
      console.error("[jobs] GET /:", e);
      res.status(500).json({ error: "Failed to fetch jobs" });
    }
  });

  router.patch("/:id/status", requireAuth, async (req, res) => {
    try {
      const { status } = req.body;
      if (!status) { res.status(400).json({ error: "status required" }); return; }
      await db.updateJobStatus(req.params.id, status);
      res.json({ ok: true });
    } catch (e) {
      console.error("[jobs] PATCH /:id/status:", e);
      res.status(500).json({ error: "Failed to update job status" });
    }
  });

  // Returns all known job IDs so the scraper can diff for truly new jobs (for notifications)
  router.get("/ids", async (req, res) => {
    const token = req.headers["x-scraper-token"];
    if (token !== process.env.SCRAPER_TOKEN) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      const ids = await db.getJobIds();
      res.json({ ids });
    } catch {
      res.status(500).json({ error: "Failed to fetch job IDs" });
    }
  });

  // Internal endpoint — called by the scraper, protected by SCRAPER_TOKEN
  router.post("/ingest", async (req, res) => {
    const token = req.headers["x-scraper-token"];
    if (token !== process.env.SCRAPER_TOKEN) { res.status(401).json({ error: "Unauthorized" }); return; }
    try {
      const jobs = req.body.jobs ?? [req.body];
      for (const job of jobs) await db.upsertJob(job);
      res.json({ ok: true, count: jobs.length });
    } catch (e) {
      console.error("[jobs] POST /ingest:", e);
      res.status(500).json({ error: "Ingest failed" });
    }
  });

  // Serve full job descriptions grouped by URL hash bucket.
  // Frontend calls this in loadJobDescriptions() before passing JD to the sidecar.
  router.get("/description-bucket", requireAuth, async (req: AuthRequest, res) => {
    const bucket = ((req.query.bucket as string) ?? "").toLowerCase();
    if (!/^[0-9a-f]{2}$/.test(bucket)) {
      res.status(400).json({ error: "Invalid bucket — expected 2 hex chars" });
      return;
    }
    try {
      const allJobs = await db.getJobs({ limit: 50_000 });
      const result: Record<string, string> = {};
      for (const job of allJobs) {
        if (!job.url || !job.description) continue;
        if (jobUrlBucket(job.url) === bucket) {
          result[job.url] = htmlToText(job.description);
        }
      }
      res.json(result);
    } catch (e) {
      console.error("[jobs] GET /description-bucket:", e);
      res.status(500).json({ error: "Failed to fetch descriptions" });
    }
  });

  // On-demand JD fetcher — called when a job has no stored description.
  // Tries Workday CXS API first, then falls back to plain HTTP GET + HTML strip.
  // Works for server-rendered pages (Lever, Greenhouse detail pages, etc.) and
  // Workday (Angular app — uses their JSON API directly).
  router.post("/fetch-jd", requireAuth, async (req: AuthRequest, res) => {
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== "string" || url.length > 2048) {
      res.status(400).json({ error: "url required (max 2048 chars)" });
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      res.status(400).json({ error: "url must start with http:// or https://" });
      return;
    }
    try {
      let description: string | null = null;

      if (url.includes("myworkdayjobs.com")) {
        description = await fetchWorkdayJd(url);
      }

      if (!description) {
        try {
          const r = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
              Accept: "text/html,application/xhtml+xml",
            },
            signal: AbortSignal.timeout(12_000),
            redirect: "follow",
          });
          if (r.ok) {
            const html = await r.text();
            const text = htmlToText(html);
            if (text.length > 300) description = text;
          }
        } catch { /* timeout or network error */ }
      }

      if (!description) {
        res.status(422).json({ error: "Could not extract job description from URL" });
        return;
      }

      res.json({ description });
    } catch (e) {
      console.error("[jobs] POST /fetch-jd:", e);
      res.status(500).json({ error: "Failed to fetch job description" });
    }
  });

  return router;
}
