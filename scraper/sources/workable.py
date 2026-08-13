"""
Workable ATS — public jobs API, no auth required.
https://apply.workable.com/api/v3/accounts/{slug}/jobs
"""
import httpx
import hashlib
from datetime import datetime
from typing import AsyncIterator
from ..models import Job

DEFAULT_COMPANIES = [
    "samsara", "typeform", "kayak", "seatgeek",
    "intercom", "privy", "loom", "descript",
    "assembled", "census", "hex", "retool",
]

def _job_id(company: str, shortcode: str) -> str:
    return hashlib.md5(f"workable:{company}:{shortcode}".encode()).hexdigest()[:16]

async def scrape(companies: list[str] | None = None) -> AsyncIterator[Job]:
    # Workable's public API (apply.workable.com) returns 404/401.
    # Their spi/v3 API requires auth tokens. No working public endpoint found.
    # TODO: find correct API version or use their official partner API.
    if not companies:
        print("[workable] Skipped — no working public API found. Needs auth.")
        return
    async with httpx.AsyncClient(timeout=15) as client:
        for company in companies:
            try:
                res = await client.get(
                    f"https://apply.workable.com/api/v3/accounts/{company}/jobs",
                    params={"details": "true"},
                )
                if res.status_code != 200:
                    continue
                data = res.json()
                for job in data.get("results", []):
                    shortcode = job.get("shortcode", "")
                    loc = job.get("location", {})
                    location_str = loc.get("city", "") or loc.get("country", "Remote")
                    yield Job(
                        id=_job_id(company, shortcode),
                        title=job.get("title", ""),
                        company=company.replace("-", " ").title(),
                        location=location_str,
                        url=f"https://apply.workable.com/{company}/j/{shortcode}/",
                        source="workable",
                        score=0.0,
                        remote=job.get("remote", False),
                        description=job.get("description", "")[:4000],
                        posted_at=job.get("created_at"),
                        scraped_at=datetime.utcnow().isoformat(),
                        tags=[job.get("department", "")],
                    )
            except Exception as e:
                print(f"[workable] {company}: {e}")
