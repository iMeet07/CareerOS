"""
Himalayas — free remote jobs API, no auth required.
https://himalayas.app/api
"""
import httpx
import hashlib
from datetime import datetime
from typing import AsyncIterator
from ..models import Job

def _job_id(jid: str) -> str:
    return hashlib.md5(f"himalayas:{jid}".encode()).hexdigest()[:16]

async def scrape() -> AsyncIterator[Job]:
    limit = 100
    offset = 0
    max_pages = 5
    async with httpx.AsyncClient(timeout=20) as client:
        for _ in range(max_pages):
            try:
                res = await client.get(
                    "https://himalayas.app/jobs/api",
                    params={"limit": limit, "offset": offset},
                )
                if res.status_code != 200:
                    break
                data = res.json()
                jobs = data.get("jobs", [])
                if not jobs:
                    break
                for job in jobs:
                    jid = str(job.get("id", job.get("slug", "")))
                    yield Job(
                        id=_job_id(jid),
                        title=job.get("title", ""),
                        company=job.get("companyName", job.get("company", {}).get("name", "")),
                        location=job.get("locationRestrictions", ["Remote"])[0] if job.get("locationRestrictions") else "Remote",
                        url=job.get("applicationLink", job.get("url", "")),
                        source="himalayas",
                        score=0.0,
                        remote=True,
                        description=job.get("description", "")[:4000],
                        salary=job.get("salary", "") or None,
                        posted_at=job.get("createdAt"),
                        scraped_at=datetime.utcnow().isoformat(),
                        tags=job.get("categories", [])[:5],
                    )
                if len(jobs) < limit:
                    break
                offset += limit
            except Exception as e:
                print(f"[himalayas] offset={offset}: {e}")
                break
