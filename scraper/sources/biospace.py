"""
BioSpace — pharma/biotech specific job board.
HTML scraping with httpx + built-in html.parser.
"""
import httpx
import hashlib
import re
import json
from datetime import datetime
from typing import AsyncIterator
from html.parser import HTMLParser
from ..models import Job

BASE  = "https://www.biospace.com"
PAGES = 5
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
}

QUERIES = [
    "data scientist",
    "software engineer",
    "bioinformatics",
    "machine learning",
    "computational biology",
    "data engineer",
]

def _job_id(jid: str) -> str:
    return hashlib.md5(f"biospace:{jid}".encode()).hexdigest()[:16]

class _JsonExtractor(HTMLParser):
    """Extracts __NEXT_DATA__ JSON from BioSpace HTML pages."""
    def __init__(self):
        super().__init__()
        self._in_script = False
        self.data: dict | None = None

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            for name, val in attrs:
                if name == "id" and val == "__NEXT_DATA__":
                    self._in_script = True

    def handle_endtag(self, tag):
        self._in_script = False

    def handle_data(self, data):
        if self._in_script:
            try:
                self.data = json.loads(data)
            except Exception:
                pass

async def scrape() -> AsyncIterator[Job]:
    # BioSpace is fully JS-rendered. Job listings are loaded client-side
    # and not present in __NEXT_DATA__ or any discoverable REST endpoint.
    # Requires browser automation (Playwright) to scrape.
    # TODO: add Playwright-based scraper when browser automation is set up.
    print("[biospace] Skipped — requires browser automation (Playwright). No public API available.")
    return
    yield  # make this a generator
