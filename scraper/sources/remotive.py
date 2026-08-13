"""
Remotive — free remote jobs API, no auth required.
https://remotive.com/api/remote-jobs
"""
import httpx
import hashlib
from datetime import datetime
from typing import AsyncIterator
from ..models import Job

CATEGORIES = [
    "software-dev", "data", "devops-sysadmin",
    "product", "design", "all-other",
]

def _job_id(rid: int) -> str:
    return hashlib.md5(f"remotive:{rid}".encode()).hexdigest()[:16]

async def scrape() -> AsyncIterator[Job]:
    async with httpx.AsyncClient(timeout=20) as client:
        for cat in CATEGORIES:
            try:
                res = await client.get(
                    "https://remotive.com/api/remote-jobs",
                    params={"category": cat, "limit": 100},
                )
                if res.status_code != 200:
                    continue
                for job in res.json().get("jobs", []):
                    yield Job(
                        id=_job_id(job["id"]),
                        title=job.get("title", ""),
                        company=job.get("company_name", ""),
                        location=job.get("candidate_required_location", "Remote"),
                        url=job.get("url", ""),
                        source="remotive",
                        score=0.0,
                        remote=True,
                        description=job.get("description", "")[:4000],
                        salary=job.get("salary", "") or None,
                        posted_at=job.get("publication_date"),
                        scraped_at=datetime.utcnow().isoformat(),
                        tags=[job.get("job_type", ""), cat],
                    )
            except Exception as e:
                print(f"[remotive] {cat}: {e}")
