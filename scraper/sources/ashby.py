"""
Ashby ATS — public job board API, no auth required.
https://api.ashbyhq.com/posting-api/job-board/{slug}
"""
import httpx
import hashlib
from datetime import datetime
from typing import AsyncIterator
from ..models import Job

DEFAULT_SLUGS = [
    "perplexity", "cohere", "mistral.ai", "runway-ml",
    "character", "anyscale", "10xteam",
]

def _job_id(slug: str, jid: str) -> str:
    return hashlib.md5(f"ashby:{slug}:{jid}".encode()).hexdigest()[:16]

async def scrape(slugs: list[str] | None = None) -> AsyncIterator[Job]:
    slugs = slugs or DEFAULT_SLUGS
    async with httpx.AsyncClient(timeout=15) as client:
        for slug in slugs:
            try:
                res = await client.get(
                    f"https://api.ashbyhq.com/posting-api/job-board/{slug}"
                )
                if res.status_code != 200:
                    print(f"[ashby] {slug}: HTTP {res.status_code}")
                    continue
                data = res.json()
                # API v1 returns {"jobs": [...], "apiVersion": 1} — no org name field
                slug_display = slug.replace("-", " ").replace(".", " ").title()
                for job in data.get("jobs", []):
                    if not job.get("isListed", True):
                        continue
                    loc = job.get("location", "")
                    if not loc and job.get("secondaryLocations"):
                        loc = job["secondaryLocations"][0].get("location", "")
                    yield Job(
                        id=_job_id(slug, job["id"]),
                        title=job.get("title", ""),
                        company=slug_display,
                        location=loc or ("Remote" if job.get("isRemote") else "Unknown"),
                        url=job.get("jobUrl", ""),
                        source="ashby",
                        score=0.0,
                        remote=job.get("isRemote", False),
                        description=job.get("descriptionPlain", "")[:4000],
                        posted_at=job.get("publishedAt"),
                        scraped_at=datetime.utcnow().isoformat(),
                        tags=[job.get("department", ""), job.get("team", "")],
                    )
            except Exception as e:
                print(f"[ashby] {slug}: {e}")
