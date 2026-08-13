"""
The Muse — free public jobs API, no auth required.
https://www.themuse.com/api/public/jobs

Note: category filter is non-functional in the public API.
We fetch by level and let the scorer filter by role.
"""
import httpx
import hashlib
from datetime import datetime
from typing import AsyncIterator
from ..models import Job

LEVELS = ["Entry Level", "Internship", "Mid Level"]

def _job_id(jid: int) -> str:
    return hashlib.md5(f"themuse:{jid}".encode()).hexdigest()[:16]

async def scrape() -> AsyncIterator[Job]:
    seen: set[str] = set()
    async with httpx.AsyncClient(timeout=20) as client:
        for level in LEVELS:
            page = 0
            while page < 10:
                try:
                    res = await client.get(
                        "https://www.themuse.com/api/public/jobs",
                        params={"level": level, "page": page, "descending": "true"},
                    )
                    if res.status_code != 200:
                        break
                    data = res.json()
                    results = data.get("results", [])
                    if not results:
                        break
                    for job in results:
                        jid = str(job.get("id", ""))
                        if jid in seen:
                            continue
                        seen.add(jid)
                        locations   = [loc["name"] for loc in job.get("locations", [])]
                        levels_list = [lv["name"]  for lv  in job.get("levels", [])]
                        yield Job(
                            id=_job_id(job["id"]),
                            title=job.get("name", ""),
                            company=job.get("company", {}).get("name", ""),
                            location=locations[0] if locations else "Remote",
                            url=job.get("refs", {}).get("landing_page", ""),
                            source="themuse",
                            score=0.0,
                            remote="Flexible / Remote" in locations,
                            description=job.get("contents", "")[:4000],
                            posted_at=job.get("publication_date"),
                            scraped_at=datetime.utcnow().isoformat(),
                            tags=levels_list,
                        )
                    page += 1
                    if page >= data.get("page_count", 1):
                        break
                except Exception as e:
                    print(f"[themuse] {level} p{page}: {e}")
                    break
