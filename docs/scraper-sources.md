# Scraper Sources Guide

Atriveo supports multiple job sources. Each has different setup requirements and ToS implications.

---

## Source overview

| Source | Auth needed | ToS risk | Setup effort |
|---|---|---|---|
| Greenhouse | None | None — public API | Add company slugs to `config.json` |
| Lever | None | None — public API | Add company slugs to `config.json` |
| LinkedIn | Yes (your account) | High — ToS violation | Set `LINKEDIN_ENABLED=true` + credentials |

---

## Greenhouse

Greenhouse hosts public job boards for thousands of companies. No API key, no auth — their board API is intentionally public.

**How to find a company's Greenhouse slug:**

1. Go to a company's careers page
2. If the URL contains `greenhouse.io/` or the jobs are embedded via Greenhouse, the slug is the subdomain or path segment
3. Example: `https://boards.greenhouse.io/stripe` → slug is `stripe`

**Configure in `config.json`:**

```json
{
  "profile": {
    "greenhouse_boards": [
      "airbnb", "figma", "notion", "stripe", "linear",
      "anthropic", "openai", "databricks", "snowflake"
    ]
  }
}
```

**Run manually:**

```bash
python -m scraper.main --sources greenhouse --dry-run
```

---

## Lever

Lever hosts job postings for companies like Netflix, Shopify, Discord, and more. Also fully public.

**How to find a company's Lever slug:**

1. Check if the company uses Lever at `https://jobs.lever.co/COMPANY`
2. The slug is the URL path segment

**Configure in `config.json`:**

```json
{
  "profile": {
    "lever_companies": [
      "netflix", "spotify", "shopify", "github", "cloudflare",
      "discord", "plaid", "brex", "rippling", "retool"
    ]
  }
}
```

**Run manually:**

```bash
python -m scraper.main --sources lever --dry-run
```

---

## LinkedIn

LinkedIn scraping uses `linkedin-api`, an unofficial library that logs in with your credentials. LinkedIn's ToS prohibits automated scraping.

**Use at your own risk. Risks include:**
- Temporary account restriction
- Permanent account ban (rare but possible with aggressive settings)
- CAPTCHA challenges

**Mitigation:**
- Keep `LINKEDIN_MAX_PER_RUN` at 25 or below
- Keep `LINKEDIN_DELAY_SECS` at 2.0+
- Don't run more than once every few hours

**Setup:**

```bash
# Install the LinkedIn API library
pip install linkedin-api

# Enable in .env
LINKEDIN_ENABLED=true
LINKEDIN_EMAIL=your@email.com
LINKEDIN_PASSWORD=yourpassword
LINKEDIN_MAX_PER_RUN=25
LINKEDIN_DELAY_SECS=2.0
```

**Run manually:**

```bash
python -m scraper.main --sources linkedin --dry-run
```

---

## Scoring

Every job from every source gets a score from 0–10 based on:

- **Keyword match (6 pts)** — how many of your `config.json` keywords appear in the title/description/tags
- **Location match (2 pts)** — remote or preferred city
- **Recency (1 pt)** — posted within the last 7 days
- **Source bonus (0.5 pt)** — Greenhouse/Lever get a small boost (real open roles, not aggregated)

Jobs scoring 0 (excluded company or zero keyword match) are still ingested but sorted to the bottom.

---

## Running all sources

```bash
# Greenhouse + Lever (safe, recommended default)
python -m scraper.main --sources greenhouse lever

# All sources including LinkedIn
python -m scraper.main --sources greenhouse lever linkedin

# Dry run — score and print top 10, don't push to server
python -m scraper.main --dry-run
```

---

## Automated hourly scraping

**macOS (LaunchAgent):**

```bash
npm run pipeline:install
```

**Linux (systemd):**

```bash
npm run pipeline:install:linux
```

**OpenShift (CronJob):**

The scraper runs automatically as a CronJob — see [openshift-setup.md](./openshift-setup.md).
