"""
CareerOS scraper — entry point.
Runs all enabled sources in parallel, scores, deduplicates, and pushes to the server.

Usage:
  python -m scraper.main
  python -m scraper.main --sources greenhouse lever ashby simplify
  python -m scraper.main --dry-run
"""
import asyncio
import argparse
import json
import os
import subprocess
import httpx
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

from .sources import greenhouse, lever, linkedin
from .sources import ashby, workday, bamboohr, workable
from .sources import remotive, remoteok, jobicy, himalayas, themuse, weworkremotely
from .sources import simplify, ycombinator, biospace, hn_hiring
from .sources import adzuna, usajobs
from .scorer import score_job, load_profile
from .deduplicator import deduplicate
from .models import Job

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

SERVER_URL       = os.getenv("SERVER_URL", "http://localhost:3001")
SCRAPER_TOKEN    = os.getenv("SCRAPER_TOKEN", "")
NOTIFY_MIN_SCORE = float(os.getenv("NOTIFY_MIN_SCORE", "3.5"))

ALL_SOURCES = [
    # ATS — company-list-based (working)
    "greenhouse", "lever", "ashby", "workday",
    # ATS — need working API/companies researched before enabling
    "bamboohr", "workable",
    # Curated / aggregated — no auth (working)
    "simplify", "remotive", "remoteok", "jobicy", "himalayas",
    "themuse", "weworkremotely", "hn",
    # Needs browser automation (Playwright) to work
    "ycombinator", "biospace",
    # API-key required (working once keys set in .env)
    "adzuna", "usajobs",
    # Account-based (disabled by default)
    "linkedin",
]

# Default sources — excludes linkedin, bamboohr/workable (no API), biospace/ycombinator (browser needed)
DEFAULT_SOURCES = [
    "greenhouse", "lever", "ashby", "workday",
    "simplify", "remotive", "remoteok", "jobicy", "himalayas",
    "themuse", "weworkremotely", "hn",
    "adzuna", "usajobs",
]

def _notify(title: str, subtitle: str, body: str) -> None:
    def _esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace('"', '\\"')
    script = (
        f'display notification "{_esc(body)}" '
        f'with title "{_esc(title)}" '
        f'subtitle "{_esc(subtitle)}" '
        f'sound name "Glass"'
    )
    try:
        subprocess.run(["osascript", "-e", script], check=False, timeout=5)
    except Exception:
        pass

def _alert_top_jobs(jobs: list[Job], already_seen: set) -> None:
    hot = [j for j in jobs if j.score >= NOTIFY_MIN_SCORE and j.id not in already_seen]
    hot.sort(key=lambda j: j.score, reverse=True)
    for j in hot[:5]:
        _notify(
            title=f"New Job Match ({j.score:.1f}/10)",
            subtitle=j.title,
            body=f"{j.company}  ·  {j.location}  [{j.source}]",
        )

async def _collect(label: str, gen, profile: dict) -> list[Job]:
    """Collect all jobs from an async generator, scoring each."""
    jobs: list[Job] = []
    try:
        async for job in gen:
            job.score = score_job(job, profile)
            jobs.append(job)
    except Exception as e:
        print(f"[{label}] error: {e}")
    return jobs

async def run(sources: list[str], dry_run: bool = False):
    profile  = load_profile()
    location = profile.get("location", "United States")
    remote   = profile.get("remote_preferred", False)

    tasks: dict[str, asyncio.Task] = {}

    async def _task(label: str, gen):
        return label, await _collect(label, gen, profile)

    # Build coroutines for all requested sources
    coros = []

    if "greenhouse" in sources:
        boards = profile.get("greenhouse_boards")
        coros.append(_task("greenhouse", greenhouse.scrape(boards=boards)))

    if "lever" in sources:
        companies = profile.get("lever_companies")
        coros.append(_task("lever", lever.scrape(companies=companies)))

    if "ashby" in sources:
        slugs = profile.get("ashby_slugs")
        coros.append(_task("ashby", ashby.scrape(slugs=slugs)))

    if "workday" in sources:
        wd_companies = profile.get("workday_companies")
        # workday.scrape accepts list of tuples — convert from JSON arrays
        if wd_companies:
            wd_companies = [tuple(c) for c in wd_companies]
        coros.append(_task("workday", workday.scrape(companies=wd_companies)))

    if "bamboohr" in sources:
        bhr = profile.get("bamboohr_companies")
        coros.append(_task("bamboohr", bamboohr.scrape(companies=bhr)))

    if "workable" in sources:
        wk = profile.get("workable_companies")
        coros.append(_task("workable", workable.scrape(companies=wk)))

    if "simplify" in sources:
        coros.append(_task("simplify", simplify.scrape()))

    if "remotive" in sources:
        coros.append(_task("remotive", remotive.scrape()))

    if "remoteok" in sources:
        coros.append(_task("remoteok", remoteok.scrape()))

    if "jobicy" in sources:
        coros.append(_task("jobicy", jobicy.scrape()))

    if "himalayas" in sources:
        coros.append(_task("himalayas", himalayas.scrape()))

    if "themuse" in sources:
        coros.append(_task("themuse", themuse.scrape()))

    if "weworkremotely" in sources:
        coros.append(_task("weworkremotely", weworkremotely.scrape()))

    if "ycombinator" in sources:
        coros.append(_task("ycombinator", ycombinator.scrape()))

    if "biospace" in sources:
        coros.append(_task("biospace", biospace.scrape()))

    if "hn" in sources:
        coros.append(_task("hn", hn_hiring.scrape()))

    if "adzuna" in sources:
        coros.append(_task("adzuna", adzuna.scrape()))

    if "usajobs" in sources:
        coros.append(_task("usajobs", usajobs.scrape()))

    if "linkedin" in sources:
        li_queries = profile.get("linkedin_queries")
        coros.append(_task("linkedin", linkedin.scrape(
            queries=li_queries, location=location, remote_only=remote
        )))

    print(f"[scraper] Running {len(coros)} source(s) in parallel...")
    start = datetime.utcnow()
    results = await asyncio.gather(*coros)

    all_jobs: list[Job] = []
    source_counts: dict[str, int] = {}
    for label, jobs in results:
        source_counts[label] = len(jobs)
        all_jobs.extend(jobs)

    elapsed = (datetime.utcnow() - start).total_seconds()

    # Print per-source counts
    for label, count in source_counts.items():
        print(f"  {label:<18} {count:>5} jobs")
    print(f"[scraper] Total raw: {len(all_jobs)} jobs in {elapsed:.1f}s")

    # Filter score=0 (off-field, no role match)
    relevant = [j for j in all_jobs if j.score > 0]
    filtered = len(all_jobs) - len(relevant)
    if filtered:
        print(f"[scraper] Filtered out {filtered} irrelevant jobs (score=0)")

    unique_jobs = deduplicate(relevant)
    print(f"[scraper] After dedup: {len(unique_jobs)} unique relevant jobs")

    if dry_run:
        top = unique_jobs[:20]
        print("\nTop 20 (dry run):")
        for j in top:
            print(f"  {j.score:4.1f}  {j.title:<45}  {j.company:<25}  [{j.source}]")
        return

    # Fetch existing IDs to detect truly new jobs for notifications
    existing_ids: set = set()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                f"{SERVER_URL}/api/jobs/ids",
                headers={"x-scraper-token": SCRAPER_TOKEN},
            )
            if r.status_code == 200:
                existing_ids = set(r.json().get("ids", []))
    except Exception:
        pass

    # Push to server
    async with httpx.AsyncClient(timeout=60) as client:
        payload = [j.to_dict() for j in unique_jobs]
        res = await client.post(
            f"{SERVER_URL}/api/jobs/ingest",
            json={"jobs": payload},
            headers={"x-scraper-token": SCRAPER_TOKEN},
        )
        if res.status_code == 200:
            count = res.json().get("count", len(payload))
            print(f"[scraper] Pushed {count} jobs to {SERVER_URL}")
            _alert_top_jobs(unique_jobs, existing_ids)
        else:
            print(f"[scraper] Push failed: {res.status_code} {res.text[:200]}")

def main():
    parser = argparse.ArgumentParser(description="CareerOS job scraper")
    parser.add_argument(
        "--sources", nargs="+",
        default=DEFAULT_SOURCES,
        choices=ALL_SOURCES,
        help="Sources to run (default: all except linkedin)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Score and print top jobs without pushing to server",
    )
    args = parser.parse_args()
    asyncio.run(run(args.sources, args.dry_run))

if __name__ == "__main__":
    main()
