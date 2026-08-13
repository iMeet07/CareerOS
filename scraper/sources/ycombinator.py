"""
Y Combinator — Work at a Startup job board.
Scrapes ycombinator.com/jobs public pages.
"""
import httpx
import hashlib
import json
import re
from datetime import datetime
from typing import AsyncIterator
from html.parser import HTMLParser
from ..models import Job

BASE    = "https://www.ycombinator.com"
ROLES   = ["software-engineer", "machine-learning", "data-scientist", "devops", "product-manager"]
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; CareerOS/1.0)"}

def _job_id(jid: str) -> str:
    return hashlib.md5(f"yc:{jid}".encode()).hexdigest()[:16]

class _NextDataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self._capture = False
        self.data: dict | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            for k, v in attrs:
                if k == "id" and v == "__NEXT_DATA__":
                    self._capture = True

    def handle_endtag(self, tag):
        self._capture = False

    def handle_data(self, data):
        if self._capture:
            try:
                self.data = json.loads(data)
            except Exception:
                pass

async def scrape() -> AsyncIterator[Job]:
    # workatastartup.com is fully JS-rendered with no public API.
    # Job data is not in __NEXT_DATA__ and there are no REST endpoints.
    # Requires browser automation (Playwright) to scrape.
    # TODO: add Playwright-based scraper when browser automation is set up.
    print("[ycombinator] Skipped — requires browser automation (Playwright). No public API available.")
    return
    yield  # make this a generator
