"""
LinkedIn job scraper — USE AT YOUR OWN RISK.
LinkedIn's ToS prohibits automated scraping. This uses your personal account.

Enable: set LINKEDIN_ENABLED=true in .env
Tune:   LINKEDIN_PER_QUERY (jobs per search, default 10)
        LINKEDIN_DELAY_SECS (between requests, default 2.0)
"""
import os
import asyncio
import hashlib
from datetime import datetime
from typing import AsyncIterator
from ..models import Job

ENABLED       = os.getenv("LINKEDIN_ENABLED", "false").lower() == "true"
EMAIL         = os.getenv("LINKEDIN_EMAIL", "")
PASSWORD      = os.getenv("LINKEDIN_PASSWORD", "")
PER_QUERY     = int(os.getenv("LINKEDIN_PER_QUERY", "10"))   # jobs fetched per search query
DELAY_SECS    = float(os.getenv("LINKEDIN_DELAY_SECS", "2.0"))

# Default queries — overridden by profile.linkedin_queries in config.json
DEFAULT_QUERIES = [
    "software engineer new grad",
    "machine learning engineer new grad",
    "data scientist entry level",
    "ai engineer new grad",
]

def _job_id(li_id: str) -> str:
    return hashlib.md5(f"linkedin:{li_id}".encode()).hexdigest()[:16]

def _extract_company(detail: dict) -> str:
    try:
        return (
            detail.get("companyDetails", {})
            .get("com.linkedin.voyager.deco.jobs.web.shared.WebCompactJobPostingCompany", {})
            .get("companyResolutionResult", {})
            .get("name", "")
        )
    except Exception:
        return ""

async def scrape(
    queries: list[str] | None = None,
    location: str = "United States",
    remote_only: bool = False,
) -> AsyncIterator[Job]:
    if not ENABLED:
        print("[linkedin] Disabled. Set LINKEDIN_ENABLED=true in .env to enable.")
        return

    if not EMAIL or not PASSWORD:
        print("[linkedin] LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set in .env")
        return

    try:
        from linkedin_api import Linkedin
    except ImportError:
        print("[linkedin] Run: pip install linkedin-api")
        return

    search_queries = queries or DEFAULT_QUERIES
    print(f"[linkedin] {len(search_queries)} queries × {PER_QUERY} jobs each "
          f"= up to {len(search_queries) * PER_QUERY} jobs")

    try:
        api = Linkedin(EMAIL, PASSWORD)
    except Exception as e:
        print(f"[linkedin] Login failed: {e}")
        return

    seen_ids: set[str] = set()

    for query in search_queries:
        try:
            results = api.search_jobs(
                keywords=query,
                location_name=location,
                remote=["2"] if remote_only else None,
                limit=PER_QUERY,
            )
        except Exception as e:
            print(f"[linkedin] Search '{query}' failed: {e}")
            continue

        for r in results:
            try:
                job_id = str(r.get("trackingUrn", "").split(":")[-1])
                if not job_id or job_id in seen_ids:
                    continue
                seen_ids.add(job_id)

                detail = api.get_job(job_id)
                await asyncio.sleep(DELAY_SECS)

                yield Job(
                    id=_job_id(job_id),
                    title=detail.get("title", ""),
                    company=_extract_company(detail),
                    location=detail.get("formattedLocation", location),
                    url=f"https://www.linkedin.com/jobs/view/{job_id}",
                    source="linkedin",
                    score=0.0,
                    status="new",
                    description=detail.get("description", {}).get("text", "")[:4000],
                    posted_at=None,
                    scraped_at=datetime.utcnow().isoformat(),
                    tags=[],
                )
            except Exception as e:
                print(f"[linkedin] job {r}: {e}")
                continue
