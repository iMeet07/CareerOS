"""
Workday ATS — internal JSON endpoint, no auth required.
POST https://{tenant}.wd{n}.myworkdayjobs.com/wday/cxs/{tenant}/{board}/jobs

Rate-limited globally by IP across all tenants — uses asyncio.Semaphore to throttle.
"""
import asyncio
import httpx
import hashlib
from datetime import datetime
from typing import AsyncIterator
from ..models import Job

# (tenant, wd_number, board_name, display_name)
DEFAULT_COMPANIES = [
    # --- Pharma / Biotech ---
    ("pfizer",               1, "PfizerCareers",              "Pfizer"),
    ("illumina",             1, "illumina-careers",           "Illumina"),
    ("regeneron",            1, "Careers",                    "Regeneron"),
    ("roche",                3, "ROG-A2O-GENE",               "Roche / Genentech"),
    ("biibhr",               3, "external",                   "Biogen"),
    ("bristolmyerssquibb",   5, "BMS",                        "Bristol Myers Squibb"),
    ("msd",                  5, "SearchJobs",                 "Merck / MSD"),
    ("novartis",             3, "Novartis_Careers",           "Novartis"),
    ("amgen",                1, "Careers",                    "Amgen"),
    ("astrazeneca",          3, "Careers",                    "AstraZeneca"),
    ("sanofi",               3, "SanofiCareers",              "Sanofi"),
    ("takeda",             502, "External",                   "Takeda"),
    ("modernatx",            1, "M_tx",                       "Moderna"),
    ("abbott",               5, "abbottcareers",              "Abbott"),
    ("gh",                   1, "gh",                         "Guardant Health"),
    ("genmab",               3, "Genmab_Careers_Site",        "Genmab"),
    # --- Tech ---
    ("salesforce",          12, "External_Career_Site",       "Salesforce"),
    ("intel",                1, "External",                   "Intel"),
    ("nvidia",               5, "NVIDIAExternalCareerSite",   "NVIDIA"),
    ("cisco",                5, "Cisco_Careers",              "Cisco"),
    ("adobe",                5, "external_experienced",       "Adobe"),
    ("qualcomm",            12, "External",                   "Qualcomm"),
    ("workday",              5, "Workday",                    "Workday"),
    ("thomsonreuters",       5, "External_Career_Site",       "Thomson Reuters"),
    # --- Finance ---
    ("capitalone",          12, "Capital_One",                "Capital One"),
    ("vanguard",             5, "vanguard_external",          "Vanguard"),
    ("blackrock",            1, "BlackRock_Professional",     "BlackRock"),
    ("statestreet",          1, "Global",                     "State Street"),
    ("ms",                   5, "External",                   "Morgan Stanley"),
    # --- Auto / Industrial ---
    ("generalmotors",        5, "Careers_GM",                 "General Motors"),
    # --- Defense / Aerospace ---
    ("boeing",               1, "EXTERNAL_CAREERS",           "Boeing"),
    ("ngc",                  1, "Northrop_Grumman_External_Site", "Northrop Grumman"),
    ("globalhr",             5, "REC_RTX_Ext_Gateway",        "RTX / Raytheon"),
    # --- Consulting / Professional Services ---
    ("accenture",          103, "AccentureCareers",           "Accenture"),
    ("pwc",                  3, "Global_Campus_Careers",      "PwC"),
    ("guidehouse",           1, "External",                   "Guidehouse"),
]

_SEMAPHORE = asyncio.Semaphore(3)  # max 3 concurrent Workday requests globally
PAGE_SIZE  = 20

def _job_id(tenant: str, path: str) -> str:
    return hashlib.md5(f"workday:{tenant}:{path}".encode()).hexdigest()[:16]

async def _fetch_company(
    client: httpx.AsyncClient,
    tenant: str,
    wd_num: int,
    board: str,
    display_name: str,
) -> list[Job]:
    base = f"https://{tenant}.wd{wd_num}.myworkdayjobs.com/wday/cxs/{tenant}/{board}"
    jobs: list[Job] = []
    offset = 0
    while True:
        async with _SEMAPHORE:
            try:
                res = await client.post(
                    f"{base}/jobs",
                    json={"appliedFacets": {}, "limit": PAGE_SIZE, "offset": offset, "searchText": ""},
                    headers={"Content-Type": "application/json"},
                )
                await asyncio.sleep(0.5)
            except Exception as e:
                print(f"[workday] {tenant}: {e}")
                break
        if res.status_code != 200:
            print(f"[workday] {tenant}: HTTP {res.status_code}")
            break
        data = res.json()
        postings = data.get("jobPostings", [])
        if not postings:
            break
        for p in postings:
            path = p.get("externalPath", "")
            posted_raw = p.get("postedOn", "")
            jobs.append(Job(
                id=_job_id(tenant, path),
                title=p.get("title", ""),
                company=display_name,
                location=p.get("locationsText", "Unknown"),
                url=f"https://{tenant}.wd{wd_num}.myworkdayjobs.com/en-US/{board}/job{path}",
                source="workday",
                score=0.0,
                remote="remote" in p.get("locationsText", "").lower(),
                description="\n".join(p.get("bulletFields", [])),
                posted_at=posted_raw or None,
                scraped_at=datetime.utcnow().isoformat(),
                tags=[],
            ))
        total_raw = data.get("total", {})
        total = int(total_raw.get("text", "0").replace(",", "")) if isinstance(total_raw, dict) else 0
        offset += PAGE_SIZE
        if offset >= total or total == 0:
            break
    return jobs

async def scrape(companies: list[tuple] | None = None) -> AsyncIterator[Job]:
    companies = companies or DEFAULT_COMPANIES
    async with httpx.AsyncClient(timeout=30) as client:
        tasks = [_fetch_company(client, t, n, b, d) for t, n, b, d in companies]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for batch in results:
            if isinstance(batch, Exception):
                print(f"[workday] batch error: {batch}")
                continue
            for job in batch:
                yield job
