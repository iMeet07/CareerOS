"""
Lever job scraper — uses their public postings API, no auth required.
"""
import httpx
import hashlib
from datetime import datetime
from typing import Iterator
from ..models import Job

DEFAULT_COMPANIES = [
    "netflix", "spotify", "shopify", "github", "cloudflare",
    "discord", "plaid", "brex", "rippling", "retool",
    "scale-ai", "huggingface", "cohere", "perplexity",
]

def _job_id(company: str, lever_id: str) -> str:
    return hashlib.md5(f"lever:{company}:{lever_id}".encode()).hexdigest()[:16]

def _score(posting: dict, keywords: list[str]) -> float:
    text = f"{posting.get('text','')} {posting.get('categories',{}).get('team','')} {posting.get('categories',{}).get('location','')}".lower()
    hits = sum(1 for kw in keywords if kw.lower() in text)
    return round(min(hits / max(len(keywords), 1), 1.0) * 10, 2)

async def scrape(companies: list[str] | None = None, keywords: list[str] = []) -> Iterator[Job]:
    companies = companies or DEFAULT_COMPANIES
    async with httpx.AsyncClient(timeout=15) as client:
        for company in companies:
            try:
                res = await client.get(f"https://api.lever.co/v0/postings/{company}?mode=json")
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
                        score=_score(posting, keywords),
                        status="new",
                        description=posting.get("descriptionPlain", "")[:2000],
                        posted_at=datetime.utcfromtimestamp(posting["createdAt"] / 1000).isoformat() if posting.get("createdAt") else None,
                        scraped_at=datetime.utcnow().isoformat(),
                        tags=[cats.get("team", ""), cats.get("commitment", "")],
                    )
            except Exception as e:
                print(f"[lever] {company}: {e}")
                continue
