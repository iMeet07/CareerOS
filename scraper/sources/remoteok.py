"""
RemoteOK — public JSON API, no auth required.
https://remoteok.com/api
"""
import httpx
import hashlib
from datetime import datetime
from typing import AsyncIterator
from ..models import Job

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CareerOS/1.0)"}

def _job_id(slug: str) -> str:
    return hashlib.md5(f"remoteok:{slug}".encode()).hexdigest()[:16]

async def scrape() -> AsyncIterator[Job]:
    try:
        async with httpx.AsyncClient(timeout=20, headers=HEADERS) as client:
            res = await client.get("https://remoteok.com/api")
            if res.status_code != 200:
                print(f"[remoteok] HTTP {res.status_code}")
                return
            jobs = res.json()
            # First element is metadata, skip it
            for job in jobs[1:]:
                if not isinstance(job, dict):
                    continue
                slug = str(job.get("slug", job.get("id", "")))
                salary = None
                lo, hi = job.get("salary_min"), job.get("salary_max")
                if lo and hi:
                    salary = f"${lo:,}–${hi:,}"
                elif lo:
                    salary = f"${lo:,}+"
                yield Job(
                    id=_job_id(slug),
                    title=job.get("position", ""),
                    company=job.get("company", ""),
                    location=job.get("location", "Remote") or "Remote",
                    url=job.get("url", f"https://remoteok.com/l/{slug}"),
                    source="remoteok",
                    score=0.0,
                    remote=True,
                    description=job.get("description", "")[:4000],
                    salary=salary,
                    posted_at=job.get("date"),
                    scraped_at=datetime.utcnow().isoformat(),
                    tags=job.get("tags", [])[:10],
                )
    except Exception as e:
        print(f"[remoteok] {e}")
