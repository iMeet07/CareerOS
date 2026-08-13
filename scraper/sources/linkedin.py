"""
LinkedIn job scraper — USE AT YOUR OWT RISK.
LinkedIn's ToS prohibits automated scraping. This uses your personal account.
Rate-limit: max 25 jobs/run, 2s delay between requests.

Enable: set LINKEDIN_ENABLED=true in .env
"""
import os
import time
import asyncio
import hashlib
from datetime import datetime
from typing import Iterator, AsyncIterator
from ..models import Job

ENABLED = os.getenv("LINKEDIN_ENABLED", "false").lower() == "true"
EMAIL = os.getenv("LINKEDIN_EMAIL", "")
PASSWORD = os.getenv("LINKEDIN_PASSWORD", "")
MAX_PER_RUN = int(os.getenv("LINKEDIN_MAX_PER_RUN", "25"))
DELAY_SECS = float(os.getenv("LINKEDIN_DELAY_SECS", "2.0"))

# Default focused queries — overridden by config.json profile.linkedin_queries
DEFAULT_QUERIES = [
    "machine learning engineer new grad",
    "data scientist entry level",
    "ai engineer new grad",
    "nlp engineer entry level",
    "data engineer new grad",
    "software engineer ml",
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
    keywords: list[str] = [],
    location: str = "United States",
    remote_only: bool = False,
    queries: list[str] | None = None,
) -> AsyncIterator[Job]:
    if not ENABLED:
        print("[linkedin] Disabled. Set LINKEDIN_ENABLED=true in .env to enable.")
        return

    if not EMAIL or not PASSWORD:
        print("[linkedin] LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set.")
        return

    try:
        from linkedin_api import Linkedin
    except ImportError:
        print("[linkedin] Run: pip install linkedin-api")
        return

    search_queries = queries or DEFAULT_QUERIES
    per_query = max(1, MAX_PER_RUN // len(search_queries))

    print(f"[linkedin] Running {len(search_queries)} searches, {per_query} jobs each...")
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
                limit=per_query,
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

                title = detail.get("title", "")
                company = _extract_company(detail)
                location_str = detail.get("formattedLocation", location)
                description = detail.get("description", {}).get("text", "")[:2000]
                url = f"https://www.linkedin.com/jobs/view/{job_id}"

                yield Job(
                    id=_job_id(job_id),
                    title=title,
                    company=company,
                    location=location_str,
                    url=url,
                    source="linkedin",
                    score=0.0,  # scored by main.py after yield using full description
                    status="new",
                    description=description,
                    posted_at=None,
                    scraped_at=datetime.utcnow().isoformat(),
                    tags=[],
                )
            except Exception as e:
                print(f"[linkedin] job {r}: {e}")
                continue
