"""
USAJobs — US federal government jobs. Requires free API key.
Sign up: https://developer.usajobs.gov/
Set USAJOBS_API_KEY and USAJOBS_EMAIL in .env

Note: Many federal roles require US citizenship. The scorer will assign
low scores to roles with citizenship requirements in the description.
"""
import httpx
import hashlib
import os
from datetime import datetime
from typing import AsyncIterator
from ..models import Job

API_KEY = os.getenv("USAJOBS_API_KEY", "")
EMAIL   = os.getenv("USAJOBS_EMAIL", "")

KEYWORDS = [
    "bioinformatics", "computational biology", "data scientist",
    "software engineer", "machine learning", "genomics",
    "clinical informatics", "health informatics", "biostatistician",
]
RESULTS_PER_QUERY = 25

def _job_id(control_num: str) -> str:
    return hashlib.md5(f"usajobs:{control_num}".encode()).hexdigest()[:16]

async def scrape() -> AsyncIterator[Job]:
    if not API_KEY or not EMAIL:
        print("[usajobs] Disabled. Set USAJOBS_API_KEY and USAJOBS_EMAIL in .env")
        return
    headers = {
        "Authorization-Key": API_KEY,
        "Host": "data.usajobs.gov",
        "User-Agent": EMAIL,
    }
    seen: set[str] = set()
    async with httpx.AsyncClient(timeout=20) as client:
        for kw in KEYWORDS:
            try:
                res = await client.get(
                    "https://data.usajobs.gov/api/search",
                    params={
                        "Keyword": kw,
                        "ResultsPerPage": RESULTS_PER_QUERY,
                        "SortField": "OpenDate",
                        "SortDirection": "Desc",
                    },
                    headers=headers,
                )
                if res.status_code != 200:
                    print(f"[usajobs] {kw!r}: HTTP {res.status_code}")
                    continue
                items = (
                    res.json()
                    .get("SearchResult", {})
                    .get("SearchResultItems", [])
                )
                for item in items:
                    d = item.get("MatchedObjectDescriptor", {})
                    ctrl = item.get("MatchedObjectId", "")
                    if ctrl in seen:
                        continue
                    seen.add(ctrl)
                    locs = d.get("PositionLocation", [{}])
                    location = locs[0].get("LocationName", "United States") if locs else "United States"
                    apply_uris = d.get("ApplyURI", [""])
                    yield Job(
                        id=_job_id(ctrl),
                        title=d.get("PositionTitle", ""),
                        company=d.get("OrganizationName", "US Government"),
                        location=location,
                        url=apply_uris[0] if apply_uris else "",
                        source="usajobs",
                        score=0.0,
                        remote=False,
                        description=d.get("QualificationSummary", "")[:4000],
                        posted_at=d.get("PublicationStartDate"),
                        scraped_at=datetime.utcnow().isoformat(),
                        tags=["federal", "government"],
                    )
            except Exception as e:
                print(f"[usajobs] {kw!r}: {e}")
