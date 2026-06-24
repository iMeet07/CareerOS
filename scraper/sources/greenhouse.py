"""
Greenhouse job scraper — uses their public board API, no auth required.
Greenhouse embeds are used by thousands of companies (Airbnb, Figma, etc.)
"""
import httpx
import hashlib
from datetime import datetime
from typing import Iterator
from ..models import Job

# A curated list of companies on Greenhouse. Users can extend this in config.
DEFAULT_BOARDS = [
    "airbnb", "figma", "notion", "stripe", "linear", "vercel",
    "anthropic", "openai", "databricks", "snowflake", "confluent",
    "hashicorp", "mongodb", "elastic", "twilio", "segment",
]

def _job_id(board: str, gh_id: int) -> str:
    return hashlib.md5(f"greenhouse:{board}:{gh_id}".encode()).hexdigest()[:16]

def _score(job: dict, keywords: list[str]) -> float:
    text = f"{job.get('title','')} {' '.join(job.get('departments', []))} {job.get('location', {}).get('name','')}".lower()
    hits = sum(1 for kw in keywords if kw.lower() in text)
    return round(min(hits / max(len(keywords), 1), 1.0) * 10, 2)

async def scrape(boards: list[str] | None = None, keywords: list[str] = []) -> Iterator[Job]:
    boards = boards or DEFAULT_BOARDS
    async with httpx.AsyncClient(timeout=15) as client:
        for board in boards:
            try:
                res = await client.get(f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true")
                if res.status_code != 200:
                    continue
                data = res.json()
                for job in data.get("jobs", []):
                    yield Job(
                        id=_job_id(board, job["id"]),
                        title=job.get("title", ""),
                        company=board.title(),
                        location=job.get("location", {}).get("name", "Remote"),
                        url=job.get("absolute_url", ""),
                        source="greenhouse",
                        score=_score(job, keywords),
                        status="new",
                        description=job.get("content", "")[:2000] if job.get("content") else None,
                        posted_at=job.get("updated_at"),
                        scraped_at=datetime.utcnow().isoformat(),
                        tags=[d["name"] for d in job.get("departments", [])],
                    )
            except Exception as e:
                print(f"[greenhouse] {board}: {e}")
                continue
