"""
Simplify New-Grad-Positions — community-curated, updated daily.
Streams listings.json from GitHub (file is >10 MB, must stream).
No description field — scorer works on title only.
"""
import httpx
import hashlib
import json
from datetime import datetime
from typing import AsyncIterator
from ..models import Job

RAW_URL = (
    "https://raw.githubusercontent.com/"
    "SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json"
)
# Also grab internships
INTERN_URL = (
    "https://raw.githubusercontent.com/"
    "SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json"
)

def _job_id(uid: str) -> str:
    return hashlib.md5(f"simplify:{uid}".encode()).hexdigest()[:16]

def _parse_location(locations: list) -> str:
    if not locations:
        return "United States"
    loc = locations[0]
    mapping = {
        "SF": "San Francisco, CA",
        "NYC": "New York, NY",
        "LA": "Los Angeles, CA",
        "SEA": "Seattle, WA",
        "ATL": "Atlanta, GA",
        "CHI": "Chicago, IL",
        "BOS": "Boston, MA",
        "DC": "Washington, DC",
        "AUS": "Austin, TX",
        "Remote": "Remote",
    }
    return mapping.get(loc, loc)

async def _stream_listings(url: str) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            async with client.stream("GET", url) as res:
                if res.status_code != 200:
                    return []
                chunks = []
                async for chunk in res.aiter_bytes(chunk_size=65536):
                    chunks.append(chunk)
                return json.loads(b"".join(chunks))
    except Exception as e:
        print(f"[simplify] stream error {url}: {e}")
        return []

async def scrape() -> AsyncIterator[Job]:
    for label, url in [("new-grad", RAW_URL), ("internship", INTERN_URL)]:
        listings = await _stream_listings(url)
        if not listings:
            print(f"[simplify] no listings from {label}")
            continue
        active = [l for l in listings if l.get("active") and l.get("is_visible", True)]
        print(f"[simplify] {label}: {len(active)} active / {len(listings)} total")
        for job in active:
            uid = job.get("id", "")
            yield Job(
                id=_job_id(uid),
                title=job.get("title", ""),
                company=job.get("company_name", ""),
                location=_parse_location(job.get("locations", [])),
                url=job.get("url", ""),
                source="simplify",
                score=0.0,
                remote="Remote" in job.get("locations", []),
                description=None,  # Simplify doesn't provide descriptions
                posted_at=datetime.utcfromtimestamp(job["date_posted"]).isoformat()
                          if job.get("date_posted") else None,
                scraped_at=datetime.utcnow().isoformat(),
                tags=[job.get("category", ""), job.get("sponsorship", "")],
            )
