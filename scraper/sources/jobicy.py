"""
Jobicy — free remote jobs API, no auth required.
https://jobicy.com/api/v2/remote-jobs
"""
import httpx
import hashlib
from datetime import datetime
from typing import AsyncIterator
from ..models import Job

def _job_id(jid: int) -> str:
    return hashlib.md5(f"jobicy:{jid}".encode()).hexdigest()[:16]

async def scrape() -> AsyncIterator[Job]:
    params_list = [
        {"count": 50, "geo": "usa", "industry": "engineering"},
        {"count": 50, "geo": "usa", "industry": "data-analytics"},
        {"count": 50, "geo": "worldwide", "industry": "engineering"},
    ]
    seen: set[str] = set()
    async with httpx.AsyncClient(timeout=20) as client:
        for params in params_list:
            try:
                res = await client.get(
                    "https://jobicy.com/api/v2/remote-jobs",
                    params=params,
                )
                if res.status_code != 200:
                    continue
                for job in res.json().get("jobs", []):
                    jid = str(job.get("id", ""))
                    if jid in seen:
                        continue
                    seen.add(jid)
                    yield Job(
                        id=_job_id(job["id"]),
                        title=job.get("jobTitle", ""),
                        company=job.get("companyName", ""),
                        location=job.get("jobGeo", "Remote"),
                        url=job.get("url", ""),
                        source="jobicy",
                        score=0.0,
                        remote=True,
                        description=job.get("jobDescription", "")[:4000],
                        posted_at=job.get("pubDate"),
                        scraped_at=datetime.utcnow().isoformat(),
                        tags=[job.get("jobType", ""), job.get("jobIndustry", "")],
                    )
            except Exception as e:
                print(f"[jobicy] {params}: {e}")
