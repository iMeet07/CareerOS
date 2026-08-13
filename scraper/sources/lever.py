"""
Lever job scraper — uses their public postings API, no auth required.
"""
import httpx
import hashlib
from datetime import datetime
from typing import AsyncIterator
from ..models import Job

DEFAULT_COMPANIES = [
    "netflix", "spotify", "shopify", "github", "cloudflare",
    "discord", "plaid", "brex", "rippling", "retool",
    "scale-ai", "huggingface", "cohere", "perplexity",
]

def _job_id(company: str, lever_id: str) -> str:
    return hashlib.md5(f"lever:{company}:{lever_id}".encode()).hexdigest()[:16]

async def scrape(companies: list[str] | None = None) -> AsyncIterator[Job]:
    companies = companies or DEFAULT_COMPANIES
    async with httpx.AsyncClient(timeout=15) as client:
        for company in companies:
            try:
                res = await client.get(
                    f"https://api.lever.co/v0/postings/{company}?mode=json"
                )
                if res.status_code != 200:
                    continue
                for posting in res.json():
                    cats = posting.get("categories", {})
                    yield Job(
                        id=_job_id(company, posting["id"]),
                        title=posting.get("text", ""),
                        company=company.replace("-", " ").title(),
                        location=cats.get("location", "Remote"),
                        url=posting.get("hostedUrl", ""),
                        source="lever",
                        score=0.0,          # scored by main.py after yield
                        status="new",
                        description=posting.get("descriptionPlain", "")[:4000],
                        posted_at=datetime.utcfromtimestamp(
                            posting["createdAt"] / 1000
                        ).isoformat() if posting.get("createdAt") else None,
                        scraped_at=datetime.utcnow().isoformat(),
                        tags=[t for t in [cats.get("team", ""), cats.get("commitment", "")] if t],
                    )
            except Exception as e:
                print(f"[lever] {company}: {e}")
                continue
