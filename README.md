# Atriveo — Open-Source Job Search Platform

> Self-hosted · Local-first · LLM-powered

Atriveo is a full job search operating system that runs on your machine. It scrapes job postings, scores and ranks them against your profile, auto-tailors resumes using a local LLM (no API cost), and tracks your entire pipeline from discovery to offer.

---

## What it does

| Feature | Description |
|---|---|
| **Job Feed** | Scrapes LinkedIn daily, deduplicates, scores jobs against your skills |
| **Dashboard** | Live ranked feed with filters, tiers, and apply tracking |
| **Arsenal** | Skills gap analysis — what the market wants vs. what's on your resume |
| **Recon** | Email finder + outreach templates for recruiters |
| **Auto-Tailor** | Local LLM selects bullets from your bank, compiles a PDF — zero API cost |
| **Activity** | Full pipeline timeline: compile → apply → interview → offer |
| **Weekly** | 7-day archive so you never miss a posting |

---

## Architecture

```
LinkedIn → Python scraper → scored jobs.json → Cloudflare Pages (React dashboard)
                                                        ↓
                                              Select jobs to tailor
                                                        ↓
                                         Node sidecar (port 8787)
                                                        ↓
                                      Ollama (gemma3:12b) + bullet bank
                                                        ↓
                                         LaTeX → PDF on your machine
```

Everything runs locally. Your resume data never leaves your machine. Job data lives in Cloudflare (free tier).

---

## Prerequisites

| Tool | Purpose |
|---|---|
| Node.js 20+ | App + sidecar |
| Python 3.11+ | Job scraper |
| [Ollama](https://ollama.com) | Local LLM for resume tailoring |
| [Cloudflare account](https://cloudflare.com) (free) | Hosting + D1 database |
| [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) | Cloudflare deploy |
| macOS | LaunchAgents for hourly automation (Linux support coming) |

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/atishay-kasliwal/Atriveo-JD-Extractor.git
cd Atriveo-JD-Extractor

# 2. Run setup (guides you through .env, D1, Ollama)
bash scripts/setup.sh

# 3. Fill in resume-engine/Memory/experience.md with your bullets

# 4. Start the local dashboard
npm run dev

# 5. Start the resume sidecar
npm run tailor:prod
```

---

## Resume Engine

The tailor uses **your bullet bank** — not a generic template. You write your bullets once in `resume-engine/Memory/experience.md`, tagged by tech stack and theme. The LLM selects the best 8-10 per job description and assembles a one-page LaTeX PDF.

```
resume-engine/
  Memory/
    experience.md          ← your bullet bank (fill this in)
    QUESTION_ANSWERS.md    ← skills you can genuinely claim
  tailored/                ← compiled resumes output here
```

A template with instructions is provided at `resume-engine-template/`.

---

## Configuration

Copy `.env.example` to `.env` and fill in:

```bash
YOUR_NAME="Jane Doe"
LINKEDIN_EMAIL=jane@example.com
LINKEDIN_PASSWORD=...
CF_ACCOUNT_ID=...
D1_DATABASE_ID=...
JWT_SECRET=...             # random 32+ char string
TAILOR_TOKEN=...           # random secret
OLLAMA_MODEL=gemma3:12b
TAILOR_OUT_ROOT=./output/tailored-resumes
```

---

## Commands

```bash
npm run dev               # local dashboard (localhost:5173)
npm run tailor:prod       # resume sidecar (localhost:8787)
npm run pipeline:install  # install hourly LaunchAgents (macOS)
npm run feed:sync         # push job feed to Cloudflare
npm run resume:sync       # enqueue top jobs for auto-tailor
npm run deploy:pages      # deploy dashboard to Cloudflare Pages
npm run pipeline:status   # health check for all services
```

---

## Roadmap

- [ ] Linux systemd service support
- [ ] Docker compose for full local stack
- [ ] Support for more job sources (Indeed, Greenhouse, Lever)
- [ ] Web UI setup wizard (no manual `.env` editing)
- [ ] Resume engine: PDF diff viewer in dashboard
- [ ] Multi-user support

---

## Contributing

PRs welcome. Open an issue first for large changes.

---

## License

MIT
