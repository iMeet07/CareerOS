# Cloudflare Setup Guide

Deploy Atriveo to Cloudflare Pages (free tier) in about 10 minutes.

## What you get

- Frontend hosted on Cloudflare Pages (global CDN)
- API via Cloudflare Pages Functions (serverless, runs at the edge)
- D1 SQLite database (free up to 5GB)
- Scraper and resume sidecar still run locally on your machine

---

## Prerequisites

- [Cloudflare account](https://cloudflare.com) (free)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed: `npm install -g wrangler`
- Node.js 20+

---

## Step 1 — Authenticate Wrangler

```bash
wrangler login
```

This opens a browser window to authorize the CLI with your Cloudflare account.

---

## Step 2 — Create a D1 database

```bash
wrangler d1 create atriveo-auth
```

Copy the `database_id` from the output — you'll need it in the next step.

---

## Step 3 — Configure wrangler.toml

```bash
cp wrangler.toml.example wrangler.toml
```

Edit `wrangler.toml` and fill in:

```toml
[[d1_databases]]
database_id = "PASTE_YOUR_DATABASE_ID_HERE"

[vars]
JWT_SECRET = "any-random-32-char-string"
SCRAPER_TOKEN = "any-random-secret"
```

> **Never commit `wrangler.toml`** — it contains your secrets. It's already in `.gitignore`.

---

## Step 4 — Run the database migration

```bash
# Apply schema to the remote D1 database
wrangler d1 execute atriveo-auth --file=migrations/d1/0001_init.sql
```

---

## Step 5 — Build and deploy

```bash
npm run build
npm run deploy:pages
```

You'll get a URL like `https://atriveo-abc123.pages.dev`. That's your live dashboard.

---

## Step 6 — Set up your local scraper

The scraper runs on your machine and pushes jobs to Cloudflare:

```bash
# Install hourly job scraper (macOS)
npm run pipeline:install

# Or run it once manually
python -m scraper.main --sources greenhouse lever
```

---

## Step 7 — Start the resume sidecar

The sidecar runs locally and compiles resumes via Ollama:

```bash
cp .env.example .env
# Fill in YOUR_NAME, TAILOR_TOKEN, RESUME_ENGINE_PATH, TAILOR_OUT_ROOT

npm run tailor:prod
```

---

## Connecting the sidecar to your deployed app

If you want the deployed app to reach your local sidecar, use [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/):

```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Create a tunnel to your local sidecar
cloudflared tunnel --url http://localhost:8787
```

Copy the generated `trycloudflare.com` URL and add it to `wrangler.toml`:

```toml
[vars]
TAILOR_ORIGIN = "https://your-tunnel.trycloudflare.com"
```

Then redeploy:

```bash
npm run deploy:pages
```

---

## Updating

Every push to `main` triggers a new Cloudflare Pages build automatically (if you connect the repo in the Cloudflare dashboard under Pages → Connect to Git).

Or deploy manually anytime:

```bash
npm run build && npm run deploy:pages
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `wrangler: command not found` | `npm install -g wrangler` |
| D1 migration fails | Check `wrangler.toml` has the correct `database_id` |
| Build fails with TS errors | Run `npx tsc -p app/tsconfig.json --noEmit` locally first |
| API returns 401 | Make sure `JWT_SECRET` in `wrangler.toml` matches `.env` |
| Jobs not appearing | Run `python -m scraper.main --dry-run` to test the scraper |
