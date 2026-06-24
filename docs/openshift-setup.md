# OpenShift Setup Guide

Deploy the full Atriveo stack to OpenShift (or any Kubernetes cluster) — no Cloudflare account needed. Everything self-hosted.

## What you get

- App (frontend + API) running as a Deployment with a Route
- Hourly scraper as an OpenShift CronJob
- PostgreSQL as a StatefulSet
- Ollama for local LLM inference (resume tailoring)
- All data stays within your cluster

---

## Prerequisites

- OpenShift cluster (4.x) or any Kubernetes cluster with an Ingress controller
- `oc` CLI (OpenShift) or `kubectl` (plain K8s)
- `docker` or `podman` for building images
- Access to push to a container registry (ghcr.io, quay.io, or your own)

---

## Step 1 — Build and push images

```bash
# App image (frontend + API server)
docker build -t ghcr.io/YOUR_GITHUB_USER/atriveo-jd-extractor:latest .
docker push ghcr.io/YOUR_GITHUB_USER/atriveo-jd-extractor:latest

# Scraper image
docker build -f deploy/Dockerfile.scraper -t ghcr.io/YOUR_GITHUB_USER/atriveo-jd-extractor-scraper:latest .
docker push ghcr.io/YOUR_GITHUB_USER/atriveo-jd-extractor-scraper:latest
```

> If you push to GitHub, CI automatically builds and pushes both images on every commit to `main` — skip this step and use `ghcr.io/atishay-kasliwal/atriveo-jd-extractor:latest` directly.

---

## Step 2 — Update image references

Edit `deploy/openshift/app-deployment.yaml` and `deploy/openshift/scraper-cronjob.yaml` — replace the image URLs with your registry path.

---

## Step 3 — Configure secrets

Edit `deploy/openshift/configmap.yaml`:

```yaml
stringData:
  JWT_SECRET: "your-random-32-char-secret"
  SCRAPER_TOKEN: "your-random-scraper-token"
  TAILOR_TOKEN: "your-random-tailor-token"
  DATABASE_URL: "postgres://atriveo:YOUR_PG_PASSWORD@postgres:5432/atriveo"
  POSTGRES_PASSWORD: "YOUR_PG_PASSWORD"
```

Also update `CORS_ORIGIN` in the ConfigMap to match your Route URL.

---

## Step 4 — Configure your job profile

Copy the example config and edit it:

```bash
cp config.example.json config.json
```

```json
{
  "profile": {
    "keywords": ["software engineer", "backend", "python"],
    "preferred_locations": ["Remote", "New York"],
    "remote_preferred": true,
    "greenhouse_boards": ["airbnb", "stripe", "notion"],
    "lever_companies": ["netflix", "shopify", "discord"]
  }
}
```

---

## Step 5 — Deploy

```bash
# Log in to your cluster
oc login https://your-cluster.example.com

# Run the deploy script
bash deploy/openshift/deploy.sh
```

The script:
1. Creates the `atriveo` namespace
2. Applies ConfigMap + Secrets
3. Loads the DB migration SQL
4. Deploys Postgres, Ollama, App, and the scraper CronJob

---

## Step 6 — Watch the rollout

```bash
oc get pods -n atriveo -w
```

Once all pods are `Running`:

```bash
oc get route atriveo-app -n atriveo
```

Open that URL in your browser — your dashboard is live.

---

## Step 7 — Pull the Ollama model

The Ollama pod pulls `gemma3:12b` on first start via a `postStart` lifecycle hook. This takes a few minutes and ~8GB of storage. Watch for it:

```bash
oc logs -f deployment/ollama -n atriveo
```

---

## Step 8 — Trigger a manual scrape

Don't wait for the hourly CronJob — run one immediately:

```bash
oc create job --from=cronjob/atriveo-scraper manual-scrape-01 -n atriveo
oc logs -f job/manual-scrape-01 -n atriveo
```

---

## Resume sidecar on OpenShift (optional)

The sidecar compiles resumes using your personal bullet bank. Because it needs your private `resume-engine/` files, there are two options:

**Option A — Mount a PVC with your resume engine**
```bash
# Copy your resume-engine/ into a PVC
oc cp resume-engine/ atriveo/sidecar-pod:/resume-engine
```

**Option B — Run the sidecar locally, tunnel to the cluster**
Keep the sidecar on your Mac/Linux machine. Use a Kubernetes port-forward or cloudflared tunnel so the cluster app can reach `localhost:8787`.

---

## Updating

```bash
# Build new images
docker build -t ghcr.io/YOUR_USER/atriveo-jd-extractor:latest . && docker push ...

# Roll out
oc rollout restart deployment/atriveo-app -n atriveo
```

---

## Plain Kubernetes (non-OpenShift)

Replace `oc` with `kubectl` throughout. Replace the `Route` resource with an `Ingress` resource pointing to the `atriveo-app` service on port `3001`. Everything else is standard K8s.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `ImagePullBackOff` | Check image name and registry credentials (`oc create secret docker-registry`) |
| Postgres pod `CrashLoopBackOff` | Check `POSTGRES_PASSWORD` in the secret matches `DATABASE_URL` |
| App returns 500 on `/health` | Run `oc logs deployment/atriveo-app -n atriveo` |
| Ollama pod OOMKilled | Increase memory limit in `ollama-deployment.yaml` (default: 16Gi) |
| Scraper job fails | `oc logs job/manual-scrape-01 -n atriveo` — usually a bad `config.json` |
| Route not accessible | Verify TLS cert and `CORS_ORIGIN` matches the route hostname |
