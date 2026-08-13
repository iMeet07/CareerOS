"""
CareerOS scraper — entry point.
Runs all enabled sources, scores jobs, deduplicates, and pushes to the server.

Usage:
  python -m scraper.main
  python -m scraper.main --sources greenhouse lever
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
from .scorer import score_job, load_profile
from .deduplicator import deduplicate

# Load .env from the project root (two levels up from scraper/)
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

SERVER_URL = os.getenv("SERVER_URL", "http://localhost:3001")
SCRAPER_TOKEN = os.getenv("SCRAPER_TOKEN", "")
NOTIFY_MIN_SCORE = float(os.getenv("NOTIFY_MIN_SCORE", "3.5"))

def _notify(title: str, subtitle: str, body: str) -> None:
    """Send a macOS native notification — no dependencies needed."""
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

def _alert_top_jobs(jobs: list, already_seen: set) -> None:
    """Notify for each new high-score job that wasn't in the DB before."""
    hot = [j for j in jobs if j.score >= NOTIFY_MIN_SCORE and j.id not in already_seen]
    hot.sort(key=lambda j: j.score, reverse=True)
    for j in hot[:5]:  # cap at 5 notifications per run
        _notify(
            title=f"🔥 New Job Match  ({j.score:.1f}/10)",
            subtitle=f"{j.title}",
            body=f"{j.company}  ·  {j.location}  [{j.source}]",
        )

async def run(sources: list[str], dry_run: bool = False):
    profile = load_profile()
    keywords = profile.get("keywords", [])
    location = profile.get("location", "United States")
    remote_only = profile.get("remote_preferred", False)

    all_jobs = []

    if "greenhouse" in sources:
        print("[scraper] Running Greenhouse...")
        boards = profile.get("greenhouse_boards", None)
        async for job in greenhouse.scrape(boards=boards, keywords=keywords):
            job.score = score_job(job, profile)
            all_jobs.append(job)
        print(f"[scraper] Greenhouse: {sum(1 for j in all_jobs if j.source == 'greenhouse')} jobs")

    if "lever" in sources:
        print("[scraper] Running Lever...")
        before = len(all_jobs)
        companies = profile.get("lever_companies", None)
        async for job in lever.scrape(companies=companies, keywords=keywords):
            job.score = score_job(job, profile)
            all_jobs.append(job)
        print(f"[scraper] Lever: {len(all_jobs) - before} jobs")

    if "linkedin" in sources:
        print("[scraper] Running LinkedIn (use at your own risk)...")
        before = len(all_jobs)
        li_queries = profile.get("linkedin_queries", None)
        async for job in linkedin.scrape(keywords=keywords, location=location, remote_only=remote_only, queries=li_queries):
            job.score = score_job(job, profile)
            all_jobs.append(job)
        print(f"[scraper] LinkedIn: {len(all_jobs) - before} jobs")

    unique_jobs = deduplicate(all_jobs)
    print(f"[scraper] Total after dedup: {len(unique_jobs)} jobs")

    if dry_run:
        top = sorted(unique_jobs, key=lambda j: j.score, reverse=True)[:10]
        print("\nTop 10 (dry run):")
        for j in top:
            print(f"  {j.score:4.1f}  {j.title} @ {j.company} [{j.source}]")
        return

    # Fetch existing job IDs from the server so we only notify on truly new jobs
    existing_ids: set = set()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{SERVER_URL}/api/jobs/ids", headers={"x-scraper-token": SCRAPER_TOKEN})
            if r.status_code == 200:
                existing_ids = set(r.json().get("ids", []))
    except Exception:
        pass  # if endpoint missing, all jobs treated as new

    # Push to server
    async with httpx.AsyncClient(timeout=30) as client:
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
            print(f"[scraper] Push failed: {res.status_code} {res.text}")

def main():
    parser = argparse.ArgumentParser(description="CareerOS job scraper")
    parser.add_argument("--sources", nargs="+", default=["greenhouse", "lever", "linkedin"], choices=["greenhouse", "lever", "linkedin"])
    parser.add_argument("--dry-run", action="store_true", help="Score and print top jobs without pushing")
    args = parser.parse_args()
    asyncio.run(run(args.sources, args.dry_run))

if __name__ == "__main__":
    main()
