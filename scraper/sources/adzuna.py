"""
Adzuna — broad US job aggregator. Requires free API key.
Sign up: https://developer.adzuna.com/
Set ADZUNA_APP_ID and ADZUNA_APP_KEY in .env
"""
import httpx
import hashlib
import os
from datetime import datetime
from typing import AsyncIterator
from ..models import Job

APP_ID  = os.getenv("ADZUNA_APP_ID", "")
APP_KEY = os.getenv("ADZUNA_APP_KEY", "")

QUERIES = [
    "software engineer new grad",
    "machine learning engineer entry level",
    "data scientist entry level",
    "data engineer new grad",
    "bioinformatics scientist entry level",
    "computational biology entry level",
    "clinical data scientist entry level",
    "ai engineer new grad",
    "backend engineer entry level",
    "devops engineer entry level",
]
RESULTS_PER_PAGE = 50

def _job_id(jid: str) -> str:
    return hashlib.md5(f"adzuna:{jid}".encode()).hexdigest()[:16]

async def scrape() -> AsyncIterator[Job]:
    if not APP_ID or not APP_KEY:
        print("[adzuna] Disabled. Set ADZUNA_APP_ID and ADZUNA_APP_KEY in .env")
        return
    seen: set[str] = set()
    async with httpx.AsyncClient(timeout=20) as client:
        for query in QUERIES:
            try:
                res = await client.get(
                    f"https://api.adzuna.com/v1/api/jobs/us/search/1",
                    params={
                        "app_id": APP_ID,
                        "app_key": APP_KEY,
                        "results_per_page": RESULTS_PER_PAGE,
                        "what": query,
                        "content-type": "application/json",
                        "sort_by": "date",
                    },
                )
                if res.status_code != 200:
                    print(f"[adzuna] {query!r}: HTTP {res.status_code}")
                    continue
                for job in res.json().get("results", []):
                    jid = str(job.get("id", ""))
                    if jid in seen:
                        continue
                    seen.add(jid)
                    loc = job.get("location", {}).get("display_name", "United States")
                    yield Job(
                        id=_job_id(jid),
                        title=job.get("title", ""),
                        company=job.get("company", {}).get("display_name", ""),
                        location=loc,
                        url=job.get("redirect_url", ""),
                        source="adzuna",
                        score=0.0,
                        remote="remote" in loc.lower() or "remote" in job.get("title", "").lower(),
                        description=job.get("description", "")[:4000],
                        salary=f"${job['salary_min']:,.0f}–${job['salary_max']:,.0f}"
                               if job.get("salary_min") and job.get("salary_max") else None,
                        posted_at=job.get("created"),
                        scraped_at=datetime.utcnow().isoformat(),
                        tags=[job.get("category", {}).get("label", "")],
                    )
            except Exception as e:
                print(f"[adzuna] {query!r}: {e}")
