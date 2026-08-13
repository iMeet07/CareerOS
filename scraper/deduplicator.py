import re
from .models import Job

_STRIP_CORP = re.compile(r'\b(inc|llc|corp|ltd|co|technologies|technology|labs|laboratory|laboratories|solutions|services|group|holdings|ventures|capital)\b')
_NON_WORD   = re.compile(r'[^\w\s]')
_WHITESPACE = re.compile(r'\s+')

def _norm(s: str) -> str:
    s = _NON_WORD.sub(' ', s.lower())
    s = _STRIP_CORP.sub('', s)
    return _WHITESPACE.sub(' ', s).strip()

def _url_key(url: str) -> str:
    # strip query params and trailing slash so same job from diff sources matches
    return url.split('?')[0].rstrip('/')

def deduplicate(jobs: list[Job]) -> list[Job]:
    # highest score wins when same job appears from multiple sources
    sorted_jobs = sorted(jobs, key=lambda j: j.score, reverse=True)

    seen_urls:  set[str]        = set()
    seen_pairs: set[tuple]      = set()
    unique:     list[Job]       = []

    for job in sorted_jobs:
        url_key  = _url_key(job.url) if job.url else None
        pair_key = (_norm(job.title), _norm(job.company)) if job.title and job.company else None

        if url_key and url_key in seen_urls:
            continue
        if pair_key and pair_key in seen_pairs:
            continue

        if url_key:
            seen_urls.add(url_key)
        if pair_key:
            seen_pairs.add(pair_key)

        unique.append(job)

    return unique
