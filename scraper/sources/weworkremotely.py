"""
We Work Remotely — RSS feed scraper, no auth required.
"""
import httpx
import hashlib
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import AsyncIterator
from ..models import Job

RSS_FEEDS = [
    "https://weworkremotely.com/categories/remote-programming-jobs.rss",
    "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
    "https://weworkremotely.com/categories/remote-data-science-jobs.rss",
    "https://weworkremotely.com/categories/remote-design-jobs.rss",
    "https://weworkremotely.com/categories/remote-product-jobs.rss",
]
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CareerOS/1.0)"}

def _job_id(link: str) -> str:
    return hashlib.md5(f"wwr:{link}".encode()).hexdigest()[:16]

def _split_title(raw: str) -> tuple[str, str]:
    """'Acme Corp: Senior Engineer' → ('Acme Corp', 'Senior Engineer')"""
    if ": " in raw:
        parts = raw.split(": ", 1)
        return parts[0].strip(), parts[1].strip()
    return "", raw.strip()

async def scrape() -> AsyncIterator[Job]:
    seen: set[str] = set()
    async with httpx.AsyncClient(timeout=20, headers=HEADERS) as client:
        for feed_url in RSS_FEEDS:
            try:
                res = await client.get(feed_url)
                if res.status_code != 200:
                    continue
                root = ET.fromstring(res.text)
                ns = {"media": "http://search.yahoo.com/mrss/"}
                for item in root.findall(".//item"):
                    link = item.findtext("link", "")
                    if link in seen:
                        continue
                    seen.add(link)
                    raw_title = item.findtext("title", "")
                    company, title = _split_title(raw_title)
                    region = item.findtext("region", "") or item.findtext("media:region", "", ns)
                    desc = item.findtext("description", "")
                    yield Job(
                        id=_job_id(link),
                        title=title,
                        company=company,
                        location=region or "Remote",
                        url=link,
                        source="weworkremotely",
                        score=0.0,
                        remote=True,
                        description=desc[:4000] if desc else None,
                        posted_at=item.findtext("pubDate"),
                        scraped_at=datetime.utcnow().isoformat(),
                        tags=[],
                    )
            except Exception as e:
                print(f"[wwr] {feed_url}: {e}")
