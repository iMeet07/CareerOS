"""
Atriveo scraper — entry point.
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
import httpx
from datetime import datetime
from .sources import greenhouse, lever, linkedin
from .scorer import score_job, load_profile
from .deduplicator import deduplicate

SERVER_URL = os.getenv("SERVER_URL", "http://localhost:3001")
SCRAPER_TOKEN = os.getenv("SCRAPER_TOKEN", "")

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
        async for job in linkedin.scrape(keywords=keywords, location=location, remote_only=remote_only):
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

    # Push to server
    async with httpx.AsyncClient(timeout=30) as client:
        payload = [j.to_dict() for j in unique_jobs]
        res = await client.post(
            f"{SERVER_URL}/api/jobs/ingest",
            json={"jobs": payload},
            headers={"x-scraper-token": SCRAPER_TOKEN},
        )
        if res.status_code == 200:
            print(f"[scraper] Pushed {len(payload)} jobs to {SERVER_URL}")
        else:
            print(f"[scraper] Push failed: {res.status_code} {res.text}")

def main():
    parser = argparse.ArgumentParser(description="Atriveo job scraper")
    parser.add_argument("--sources", nargs="+", default=["greenhouse", "lever"], choices=["greenhouse", "lever", "linkedin"])
    parser.add_argument("--dry-run", action="store_true", help="Score and print top jobs without pushing")
    args = parser.parse_args()
    asyncio.run(run(args.sources, args.dry_run))

if __name__ == "__main__":
    main()
