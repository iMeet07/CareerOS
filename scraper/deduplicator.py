from .models import Job

def deduplicate(jobs: list[Job]) -> list[Job]:
    seen: set[str] = set()
    unique: list[Job] = []
    for job in jobs:
        if job.id not in seen:
            seen.add(job.id)
            unique.append(job)
    return sorted(unique, key=lambda j: j.score, reverse=True)
