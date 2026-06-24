"""
LinkedIn job scraper — USE AT YOUR OWN RISK.
LinkedIn's ToS prohibits automated scraping. This uses your personal account.
Rate-limit: max 25 jobs/run, 2s delay between requests.

Enable: set LINKEDIN_ENABLED=true in .env
"""
import os
import time
import hashlib
import httpx
from datetime import datetime
from typing import Iterator
from ..models import Job

ENABLED = os.getenv("LINKEDIN_ENABLED", "false").lower() == "true"
EMAIL = os.getenv("LINKEDIN_EMAIL", "")
PASSWORD = os.getenv("LINKEDIN_PASSWORD", "")
MAX_PER_RUN = int(os.getenv("LINKEDIN_MAX_PER_RUN", "25"))
DELAY_SECS = float(os.getenv("LINKEDIN_DELAY_SECS", "2.0"))

def _job_id(li_id: str) -> str:
    return hashlib.md5(f"linkedin:{li_id}".encode()).hexdigest()[:16]

async def scrape(keywords: list[str] = [], location: str = "United States", remote_only: bool = False) -> Iterator[Job]:
    if not ENABLED:
        print("[linkedin] Disabled. Set LINKEDIN_ENABLED=true in .env to enable.")
        return

    if not EMAIL or not PASSWORD:
        print("[linkedin] LINKEDIN_EMAIL and LINKEDIN_PASSWORD must be set.")
        return

    try:
        from linkedin_api import Linkedin  # pip install linkedin-api
    except ImportError:
        print("[linkedin] Run: pip install linkedin-api")
        return

    print(f"[linkedin] Scraping up to {MAX_PER_RUN} jobs for: {', '.join(keywords)}")
    api = Linkedin(EMAIL, PASSWORD)

    query = " ".join(keywords)
    try:
        results = api.search_jobs(
            keywords=query,
            location_name=location,
            remote=["2"] if remote_only else None,
            limit=MAX_PER_RUN,
        )
    except Exception as e:
        print(f"[linkedin] Search failed: {e}")
        return

    for r in results:
        try:
            job_id = str(r.get("trackingUrn", "").split(":")[-1])
            detail = api.get_job(job_id)
            time.sleep(DELAY_SECS)

            title = detail.get("title", "")
            company = detail.get("companyDetails", {}).get("com.linkedin.voyager.deco.jobs.web.shared.WebCompactJobPostingCompany", {}).get("companyResolutionResult", {}).get("name", "")
            location_str = detail.get("formattedLocation", location)
            url = f"https://www.linkedin.com/jobs/view/{job_id}"

            text = f"{title} {company}".lower()
            hits = sum(1 for kw in keywords if kw.lower() in text)
            score = round(min(hits / max(len(keywords), 1), 1.0) * 10, 2)

            yield Job(
                id=_job_id(job_id),
                title=title,
                company=company,
                location=location_str,
                url=url,
                source="linkedin",
                score=score,
                status="new",
                description=detail.get("description", {}).get("text", "")[:2000],
                posted_at=None,
                scraped_at=datetime.utcnow().isoformat(),
                tags=[],
            )
        except Exception as e:
            print(f"[linkedin] job {r}: {e}")
            continue
