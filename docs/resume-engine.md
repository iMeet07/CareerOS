# Resume Engine Guide

Atriveo's resume tailoring system uses a **local LLM + your personal bullet bank** to generate a tailored one-page PDF resume for each job — no OpenAI API, no cost, no data leaving your machine.

---

## How it works

```
Job description
      ↓
  Sidecar server (localhost:8787)
      ↓
  Ollama (gemma3:12b) reads your bullet bank
      ↓
  Selects 8-10 best bullets per job
      ↓
  Writes a .tex file
      ↓
  tectonic compiles → PDF
```

---

## Setup

### 1. Install prerequisites

```bash
# Ollama — local LLM runtime
# macOS / Linux:
curl -fsSL https://ollama.com/install.sh | sh

# Pull the recommended model
ollama pull gemma3:12b

# tectonic — LaTeX compiler (single binary, no TeX distribution needed)
# macOS:
brew install tectonic
# Linux:
curl --proto '=https' --tlsv1.2 -fsSL https://drop.tectonic.works/sh | sh
```

### 2. Create your resume engine

```bash
# The setup script does this automatically, but you can also do it manually:
cp -r resume-engine-template resume-engine
```

### 3. Fill in your bullet bank

Edit `resume-engine/Memory/experience.md`:

```markdown
## Experience

### Senior Software Engineer · Acme Corp (Jan 2023 – Present)
1. `[python,aws | DATA | ★]` Built an ETL pipeline processing 10M events/day, reducing latency from 4h to 15min.
2. `[react,typescript | API | ★]` Shipped a self-service dashboard used by 300+ engineers, cutting ticket volume 40%.
3. `[k8s,terraform | INFRA]` Migrated 12 microservices to Kubernetes, reducing infra cost 35%.
```

**Bullet format:** `` `[tech,stack | THEME | ★]` `` followed by the bullet text.

- **tech** — comma-separated tech tags (used for matching)
- **THEME** — `DATA`, `ML`, `INFRA`, `API`, `PERF`, `FIN`, `COLLAB`
- **★** — marks bullets with strong metrics (prioritized by the LLM)

**Tips:**
- 6–8 bullets per role (LLM picks the best 2–4 per job)
- Start with a strong verb: Built, Reduced, Shipped, Scaled, Designed
- Include a metric (%, ms, $, users, requests/s) wherever you can
- One line per bullet — no wrapping

### 4. Fill in your skills allowlist

Edit `resume-engine/Memory/QUESTION_ANSWERS.md`:

```markdown
## Languages
- Python, TypeScript, Go, SQL

## Frameworks
- React, FastAPI, Express, gRPC

## Cloud & Infra
- AWS (Lambda, S3, RDS, EKS), Terraform, Docker, Kubernetes
```

The LLM **cannot claim a skill** that isn't in this file. This prevents hallucination.

### 5. Configure .env

```bash
YOUR_NAME="Jane Doe"
RESUME_ENGINE_PATH=./resume-engine
TAILOR_OUT_ROOT=./output/tailored-resumes
TAILOR_TOKEN=your-random-secret
OLLAMA_MODEL=gemma3:12b
```

### 6. Start the sidecar

```bash
npm run tailor:prod
```

The sidecar listens on `localhost:8787`. Test it:

```bash
curl http://localhost:8787/health
# → {"ok":true}
```

---

## Triggering a resume compile

From the dashboard, click **Tailor** on any job. The sidecar:

1. Reads the job description
2. Loads your bullet bank
3. Asks Ollama to select + lightly tune bullets
4. Writes `resume-engine/tailored/YYYY-MM-DD/NN-company-role/resume.tex`
5. Compiles with tectonic → `Your Name.pdf`

The PDF appears in the **Resumes** page of the dashboard.

---

## Model choice

The default model is `gemma3:12b`. Do not swap to `qwen3` — it truncates JSON output under schema constraints, causing silent compile failures.

```bash
# Change model:
OLLAMA_MODEL=gemma3:12b  # in .env
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Sidecar won't start | Check `RESUME_ENGINE_PATH` points to a folder with `Memory/experience.md` |
| `tectonic: command not found` | Install tectonic — see Step 1 |
| PDF compile fails | Check sidecar logs — usually a malformed `.tex` or Ollama timeout |
| LLM truncates output | Confirm `OLLAMA_MODEL=gemma3:12b` — qwen3 is known to truncate |
| Bullets look wrong | Review `experience.md` format — each bullet must match the `` `[tags]` text `` pattern |
| Skill not appearing | Add it to `QUESTION_ANSWERS.md` — the allowlist gates everything |
