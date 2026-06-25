# Atriveo — Open-Source Job Search Platform

> Self-hosted · Local-first · LLM-powered

Atriveo is a full job search operating system that runs on your machine. It scrapes job postings from LinkedIn, Greenhouse, and Lever, scores and ranks them against your profile, auto-tailors resumes using a local LLM (zero API cost), and tracks your entire pipeline from discovery to offer.

---

## Two ways to use it

### Option A — Use the hosted UI (recommended for most people)

**You don't need to run the frontend at all.**

Go to **[application.atriveo.com](https://application.atriveo.com)**, sign up (Google or email), and connect your self-hosted backend by pasting your endpoint URL + API key. The UI lives on our servers; your data stays on yours.

```
application.atriveo.com  ←  hosted UI (free, always up to date)
        ↕
your machine / server   ←  backend + scraper + LLM (you run this)
```

### Option B — Run everything locally

Run the full stack on your own machine — backend, scraper, LLM, and the React frontend. No external dependency at all.

```bash
git clone https://github.com/atishay-kasliwal/Atriveo-JD-Extractor.git
cd Atriveo-JD-Extractor
bash scripts/setup.sh
npm run dev        # frontend on localhost:5173
npm run server     # backend on localhost:3001
```

---

## What it does

| Feature | Description |
|---|---|
| **Job Feed** | Scrapes LinkedIn, Greenhouse, Lever — hourly, automated |
| **Scoring** | Ranks jobs against your skills profile, filters noise |
| **Dashboard** | Live ranked feed with tiers, filters, and apply tracking |
| **Arsenal** | Skills gap analysis — what the market wants vs. what you have |
| **Recon** | Email finder + outreach templates for recruiters |
| **Auto-Tailor** | Local LLM selects bullets from your bank, compiles a one-page PDF |
| **Activity** | Full pipeline timeline: scrape → tailor → apply → interview → offer |
| **Weekly** | 7-day archive so you never miss a posting |

---

## Architecture

```
LinkedIn / Greenhouse / Lever
        ↓
  Python scraper (hourly)
        ↓
  MongoDB / SQLite / Postgres
        ↓
  Express server (port 3001)
        ↕
  application.atriveo.com  ←  or your own React frontend (localhost:5173)
        ↓
  Select jobs to tailor
        ↓
  Node sidecar (port 8787)
        ↓
  Ollama (gemma3:12b) + bullet bank
        ↓
  LaTeX → PDF on your machine
```

---

## Prerequisites

| Tool | Purpose |
|---|---|
| Node.js 20+ | Server + sidecar + frontend |
| Python 3.11+ | Job scraper |
| [Ollama](https://ollama.com) | Local LLM for resume tailoring |
| MongoDB / SQLite / Postgres | Job storage (SQLite works out of the box, no setup) |
| macOS or Linux | Automation via LaunchAgents (macOS) or systemd (Linux) |

No Cloudflare account required unless you want to self-host the frontend on Cloudflare Pages.

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/atishay-kasliwal/Atriveo-JD-Extractor.git
cd Atriveo-JD-Extractor

# 2. Run setup (guides you through .env, DB, Ollama)
bash scripts/setup.sh

# 3. Start the backend
cd server && npm install && npm start
# Server is now running on http://localhost:3001

# 4. (Optional) Start the frontend locally
cd app && npm install && npm run dev
# Or just use https://application.atriveo.com — paste http://localhost:3001 as your endpoint

# 5. Fill in resume-engine/Memory/experience.md with your bullets

# 6. Start the resume sidecar
npm run tailor:prod
```

---

## Connecting to application.atriveo.com

If you're using the hosted UI, you need to expose your local backend so the cloud UI can reach it. The easiest way is [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):

```bash
# Install cloudflared (macOS)
brew install cloudflared

# Expose your local backend
cloudflared tunnel --url http://localhost:3001
# → gives you a public URL like https://abc123.trycloudflare.com

# Use that URL + your API_KEY from .env when connecting on application.atriveo.com
```

Or deploy the backend to any server (Docker, VPS, OpenShift) and use that URL directly.

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

A template with instructions is at `resume-engine-template/`.

---

## Configuration

Copy `.env.example` to `.env`:

```bash
# Identity
YOUR_NAME="Jane Doe"
API_KEY=your_random_secret_here    # used to authenticate the hosted UI → your backend

# Database (pick one)
DB_TYPE=sqlite                     # sqlite (default, no setup), postgres, or mongo
# MONGO_URI=mongodb://localhost:27017/atriveo
# POSTGRES_URL=postgresql://user:pass@localhost:5432/atriveo

# Scraper
LINKEDIN_ENABLED=true
LINKEDIN_EMAIL=jane@example.com
LINKEDIN_PASSWORD=your_password

# LLM
OLLAMA_MODEL=gemma3:12b

# Resume output
TAILOR_OUT_ROOT=./output/tailored-resumes
RESUME_ENGINE_PATH=./resume-engine
```

---

## Commands

```bash
npm run dev               # local frontend (localhost:5173)
npm run server            # backend API (localhost:3001)
npm run tailor:prod       # resume sidecar (localhost:8787)
npm run scraper           # run scraper once manually
npm run pipeline:install  # install hourly automation (macOS LaunchAgents)
npm run pipeline:status   # health check for all services
```

---

## Automation (hourly scraping)

### macOS
```bash
npm run pipeline:install   # installs LaunchAgents — scraper runs every hour at :00
```

### Linux
```bash
bash scripts/install-systemd.sh   # installs systemd user units + timers
loginctl enable-linger $USER      # keeps timers alive without a logged-in session
```

### OpenShift / Kubernetes
```bash
oc apply -f deploy/openshift/scraper-cronjob.yaml   # CronJob: runs hourly
```

---

## Deploy options

| Method | Best for | Docs |
|---|---|---|
| **application.atriveo.com** | Most users — no frontend to run | Sign up at the link |
| **Docker Compose** | Self-hosted, single machine | `docker compose up -d` |
| **Cloudflare Pages + Workers** | Frontend on the edge, free tier | [docs/cloudflare-setup.md](docs/cloudflare-setup.md) |
| **OpenShift / Kubernetes** | Teams, enterprise | [docs/openshift-setup.md](docs/openshift-setup.md) |

---

## Known fixes (changelog)

### LaunchAgent scheduler — `StartInterval` vs `StartCalendarInterval`
On macOS, the hourly scraper LaunchAgent now uses `StartInterval: 3600` instead of 24 hardcoded `StartCalendarInterval` entries. The calendar-based approach stops firing after long uptimes without a reboot. The interval-based approach is reliable indefinitely.

### Export script — corrupt JSON resilience
`scripts/export-job-descriptions.mjs` previously crashed the entire export run if a single job description file had a parse error (e.g. from a git merge conflict). It now skips corrupt files with a warning and continues.

### OAuth — not just Google
The hosted UI supports both **Google OAuth** and **email + password** sign-up. You are not required to use Google.

---

## Roadmap

- [ ] Web UI setup wizard (no manual `.env` editing)
- [ ] More job sources (Ashby, Workday, Rippling, Greenhouse board search)
- [ ] Resume engine: PDF diff viewer in dashboard
- [ ] Connector health dashboard (uptime, last sync, error rate)
- [ ] Browser extension for passive LinkedIn capture
- [ ] Multi-user team support

---

## Documentation

| Guide | Description |
|---|---|
| [Cloudflare Setup](docs/cloudflare-setup.md) | Self-host the frontend on Cloudflare Pages |
| [OpenShift Setup](docs/openshift-setup.md) | Fully self-hosted on OpenShift / Kubernetes |
| [Resume Engine](docs/resume-engine.md) | Set up your bullet bank + compile PDFs locally |
| [Scraper Sources](docs/scraper-sources.md) | Greenhouse, Lever, LinkedIn — setup + scoring |

---

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
Open an issue first for anything larger than a bug fix.

---

## License

MIT
