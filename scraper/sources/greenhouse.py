"""
Greenhouse job scraper — uses their public board API, no auth required.
Greenhouse embeds are used by thousands of companies (Airbnb, Figma, etc.)
"""
import httpx
import hashlib
from datetime import datetime
from typing import AsyncIterator
from ..models import Job

DEFAULT_BOARDS = [
    "airbnb", "figma", "notion", "stripe", "linear", "vercel",
    "anthropic", "openai", "databricks", "snowflake", "confluent",
    "hashicorp", "mongodb", "elastic", "twilio", "segment",
]

def _job_id(board: str, gh_id: int) -> str:
    return hashlib.md5(f"greenhouse:{board}:{gh_id}".encode()).hexdigest()[:16]

def _dept_names(departments: list) -> str:
    return " ".join(d["name"] if isinstance(d, dict) else d for d in departments)

async def scrape(boards: list[str] | None = None) -> AsyncIterator[Job]:
    boards = boards or DEFAULT_BOARDS
    async with httpx.AsyncClient(timeout=15) as client:
        for board in boards:
            try:
                res = await client.get(
                    f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true"
                )
                if res.status_code != 200:
                    continue
                data = res.json()
                for job in data.get("jobs", []):
                    yield Job(
                        id=_job_id(board, job["id"]),
                        title=job.get("title", ""),
                        company=board.replace("-", " ").title(),
                        location=job.get("location", {}).get("name", "Remote"),
                        url=job.get("absolute_url", ""),
                        source="greenhouse",
                        score=0.0,          # scored by main.py after yield
                        status="new",
                        description=job.get("content", "")[:4000] if job.get("content") else None,
                        posted_at=job.get("updated_at"),
                        scraped_at=datetime.utcnow().isoformat(),
                        tags=[d["name"] for d in job.get("departments", [])],
                    )
            except Exception as e:
                print(f"[greenhouse] {board}: {e}")
                continue
