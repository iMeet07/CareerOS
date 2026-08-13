"""
BambooHR — public job embed API, no auth required.
https://{company}.bamboohr.com/jobs/embed2.php?version=1.0.0
"""
import httpx
import hashlib
from datetime import datetime
from typing import AsyncIterator
from ..models import Job

DEFAULT_COMPANIES = [
    "benchling", "natera", "tempus", "guardanthealth",
    "recursionpharma", "insitro", "komodohealth",
    "modernhealth", "cerebral", "virta",
    "carta", "brex", "mercury", "deel",
    "lattice", "culture-amp",
]

def _job_id(company: str, jid: str) -> str:
    return hashlib.md5(f"bamboohr:{company}:{jid}".encode()).hexdigest()[:16]

async def scrape(companies: list[str] | None = None) -> AsyncIterator[Job]:
    # BambooHR's embed2.php returns an empty JavaScript widget — not usable as JSON.
    # Their API requires authentication. No public endpoint available.
    # TODO: find the correct BambooHR public API or use browser automation.
    if not companies:
        print("[bamboohr] Skipped — no working public API. Needs auth or browser automation.")
        return
    async with httpx.AsyncClient(timeout=15) as client:
        for company in companies:
            try:
                res = await client.get(
                    f"https://{company}.bamboohr.com/jobs/embed2.php",
                    params={"version": "1.0.0"},
                )
                if res.status_code != 200 or not res.text.strip():
                    continue
                data = res.json()
                display_name = data.get("displayName", company.replace("-", " ").title())
                for dept in data.get("departments", []):
                    dept_name = dept.get("name", "")
                    for job in dept.get("openPositions", []):
                        jid = str(job.get("id", ""))
                        yield Job(
                            id=_job_id(company, jid),
                            title=job.get("jobOpeningName", ""),
                            company=display_name,
                            location=job.get("location", {}).get("city", "Remote"),
                            url=job.get("url", ""),
                            source="bamboohr",
                            score=0.0,
                            remote=False,
                            description=None,
                            posted_at=None,
                            scraped_at=datetime.utcnow().isoformat(),
                            tags=[dept_name],
                        )
            except Exception as e:
                print(f"[bamboohr] {company}: {e}")
