"""
Scores jobs against the user's profile defined in config.json.
Score 0-10: higher = better match.
"""
import json
import os
import re
from .models import Job

CONFIG_PATH = os.getenv("CONFIG_PATH", "config.json")

def load_profile() -> dict:
    if not os.path.exists(CONFIG_PATH):
        return {"keywords": [], "preferred_locations": [], "remote_preferred": False, "excluded_companies": []}
    with open(CONFIG_PATH) as f:
        return json.load(f).get("profile", {})

def score_job(job: Job, profile: dict | None = None) -> float:
    if profile is None:
        profile = load_profile()

    keywords: list[str] = profile.get("keywords", [])
    preferred_locations: list[str] = profile.get("preferred_locations", [])
    excluded: list[str] = [c.lower() for c in profile.get("excluded_companies", [])]
    remote_preferred: bool = profile.get("remote_preferred", False)

    if job.company.lower() in excluded:
        return 0.0

    text = f"{job.title} {job.description or ''} {' '.join(job.tags or [])}".lower()
    score = 0.0

    # Keyword match (up to 6 pts)
    keyword_hits = sum(1 for kw in keywords if kw.lower() in text)
    score += min(keyword_hits / max(len(keywords), 1), 1.0) * 6

    # Location match (up to 2 pts)
    loc = job.location.lower()
    if job.remote or "remote" in loc:
        score += 2 if remote_preferred else 1
    elif any(pl.lower() in loc for pl in preferred_locations):
        score += 2

    # Recency boost (up to 1 pt) — prefer jobs posted in last 7 days
    if job.posted_at:
        try:
            from datetime import datetime, timezone
            posted = datetime.fromisoformat(job.posted_at.replace("Z", "+00:00"))
            age_days = (datetime.now(timezone.utc) - posted).days
            if age_days <= 7:
                score += 1
        except Exception:
            pass

    # Source reliability bonus (0.5 pt for Greenhouse/Lever — these are real open roles)
    if job.source in ("greenhouse", "lever"):
        score += 0.5

    return round(min(score, 10.0), 2)
