from dataclasses import dataclass, field, asdict
from typing import Literal, Optional

@dataclass
class Job:
    id: str
    title: str
    company: str
    location: str
    url: str
    source: Literal["linkedin", "greenhouse", "lever", "indeed", "glassdoor", "manual"]
    score: float
    status: str = "new"
    description: Optional[str] = None
    salary: Optional[str] = None
    remote: bool = False
    posted_at: Optional[str] = None
    scraped_at: str = ""
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)
