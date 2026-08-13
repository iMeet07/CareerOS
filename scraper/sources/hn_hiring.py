"""
Hacker News "Ask HN: Who is Hiring?" — monthly thread via HN Firebase API.
Free-form text parsing with regex. ~70-80% extraction accuracy.
"""
import httpx
import hashlib
import re
import asyncio
from datetime import datetime
from typing import AsyncIterator
from ..models import Job

HN_BASE    = "https://hacker-news.firebaseio.com/v0"
MAX_COMMENTS = 300  # cap to avoid very long runtime
DELAY        = 0.1  # seconds between comment fetches

_PIPE_RE    = re.compile(r"\s*\|\s*")
_URL_RE     = re.compile(r"https?://\S+")
_HTML_RE    = re.compile(r"<[^>]+>")
_AMP_RE     = re.compile(r"&amp;|&#x27;|&quot;|&lt;|&gt;")

def _job_id(comment_id: int) -> str:
    return hashlib.md5(f"hn:{comment_id}".encode()).hexdigest()[:16]

def _clean(text: str) -> str:
    text = _HTML_RE.sub(" ", text)
    text = _AMP_RE.sub(" ", text)
    return text.strip()

def _parse_comment(text: str, cid: int) -> dict | None:
    """
    Parse a free-form HN hiring comment.
    Expected format (loosely): Company | Role | Location | ... | Apply: url
    Returns dict with title, company, location, url, description or None if unparseable.
    """
    clean = _clean(text)
    lines = [l.strip() for l in clean.split("\n") if l.strip()]
    if not lines:
        return None

    first_line = lines[0]
    parts = [p.strip() for p in _PIPE_RE.split(first_line) if p.strip()]
    if len(parts) < 2:
        return None

    company  = parts[0]
    role     = parts[1] if len(parts) > 1 else ""
    location = parts[2] if len(parts) > 2 else "Remote"

    # Skip if company or role looks like noise
    if len(company) > 80 or len(role) > 120:
        return None
    if not re.search(r"[a-zA-Z]{2,}", company):
        return None

    # Extract apply URL
    urls = _URL_RE.findall(clean)
    apply_url = next(
        (u for u in urls if any(k in u for k in ["apply", "job", "lever", "greenhouse", "ashby", "career", "work"])),
        urls[0] if urls else f"https://news.ycombinator.com/item?id={cid}",
    )

    # Remote detection
    is_remote = bool(re.search(r"\bremote\b", clean, re.IGNORECASE))

    return {
        "company": company,
        "title": role,
        "location": "Remote" if is_remote else location,
        "url": apply_url,
        "remote": is_remote,
        "description": clean[:4000],
    }

async def _find_hiring_thread(client: httpx.AsyncClient) -> int | None:
    """Find the most recent 'Ask HN: Who is hiring?' thread ID."""
    try:
        res = await client.get(f"{HN_BASE}/user/whoishiring/submitted.json")
        if res.status_code != 200:
            return None
        item_ids: list[int] = res.json()
        for iid in item_ids[:10]:
            r = await client.get(f"{HN_BASE}/item/{iid}.json")
            if r.status_code != 200:
                continue
            item = r.json()
            title = item.get("title", "")
            if "who is hiring" in title.lower() or "who's hiring" in title.lower():
                return iid
    except Exception as e:
        print(f"[hn] finding thread: {e}")
    return None

async def scrape() -> AsyncIterator[Job]:
    async with httpx.AsyncClient(timeout=15) as client:
        thread_id = await _find_hiring_thread(client)
        if not thread_id:
            print("[hn] Could not find Who's Hiring thread")
            return
        print(f"[hn] Found thread {thread_id}")
        try:
            res = await client.get(f"{HN_BASE}/item/{thread_id}.json")
            thread = res.json()
        except Exception as e:
            print(f"[hn] fetching thread: {e}")
            return

        comment_ids: list[int] = thread.get("kids", [])[:MAX_COMMENTS]
        print(f"[hn] Parsing {len(comment_ids)} comments")

        for cid in comment_ids:
            await asyncio.sleep(DELAY)
            try:
                r = await client.get(f"{HN_BASE}/item/{cid}.json")
                if r.status_code != 200:
                    continue
                comment = r.json()
                if comment.get("dead") or comment.get("deleted"):
                    continue
                text = comment.get("text", "")
                if not text:
                    continue
                parsed = _parse_comment(text, cid)
                if not parsed:
                    continue
                yield Job(
                    id=_job_id(cid),
                    title=parsed["title"],
                    company=parsed["company"],
                    location=parsed["location"],
                    url=parsed["url"],
                    source="hn",
                    score=0.0,
                    remote=parsed["remote"],
                    description=parsed["description"],
                    posted_at=datetime.utcfromtimestamp(comment.get("time", 0)).isoformat(),
                    scraped_at=datetime.utcnow().isoformat(),
                    tags=["hn-hiring"],
                )
            except Exception as e:
                print(f"[hn] comment {cid}: {e}")
