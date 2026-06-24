# Contributing to Atriveo

Thanks for your interest. Here's how to get involved.

---

## Getting started

```bash
git clone https://github.com/atishay-kasliwal/Atriveo-JD-Extractor.git
cd Atriveo-JD-Extractor
bash scripts/setup.sh
npm run dev          # frontend at localhost:5173
npm run server:dev   # API server at localhost:3001
```

---

## What to work on

Check the [issues](https://github.com/atishay-kasliwal/Atriveo-JD-Extractor/issues) tab. Good first issues are labeled `good first issue`.

High-priority areas:
- **New job sources** — add a new scraper in `scraper/sources/`
- **Linux support** — systemd service installer in `scripts/install-systemd.sh`
- **Docker compose improvements** — health checks, restart policies
- **UI improvements** — dark theme, mobile layout, accessibility
- **Docs** — setup walkthroughs, screenshots, architecture diagrams

---

## Pull request process

1. Open an issue first for anything larger than a bug fix
2. Fork the repo and create a branch: `git checkout -b feat/your-feature`
3. Make your changes — keep the scope tight
4. Run checks before pushing:
   ```bash
   npx tsc -p app/tsconfig.json --noEmit
   npx tsc -p server/tsconfig.json --noEmit
   python -m py_compile scraper/**/*.py
   ```
5. Open a PR against `main` — describe what changed and why

---

## Adding a new job source

1. Create `scraper/sources/your-source.py`
2. Implement an `async def scrape(...) -> Iterator[Job]` function
3. Add it to `scraper/main.py` under `if "your-source" in sources:`
4. Document it in `docs/scraper-sources.md`
5. Add the source name to the `--sources` choices in `scraper/main.py`

---

## Code style

- TypeScript: strict mode, no unused locals/params, no `any` if avoidable
- Python: type hints where reasonable, `httpx` for HTTP, no `requests`
- No comments explaining *what* the code does — only *why* when non-obvious
- Keep PRs small — one feature or fix per PR

---

## Personal data

Never commit:
- Your own `resume-engine/` contents
- Any `jobs.json`, `job_descriptions/`, or snapshot files
- `.env` files
- Hardcoded paths with usernames

The `.gitignore` covers most of this — double check before pushing.

---

## License

By contributing, you agree your changes are licensed under MIT.
