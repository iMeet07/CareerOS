"""
CareerOS scorer — title-first, taxonomy-driven.

Layers (applied in order):
  1. Off-field blocklist   → 0.0  (non-tech titles, always irrelevant)
  2. Senior / management  → 0.5  (too senior for new-grad search)
  3. Role confidence      → 5 pts HIGH | 3 pts MEDIUM | 0 (no match)
  4. Wet-lab guard        → 0.0  if description is purely wet-lab, no tech
  5. Description skills   → +0–2 pts (tech tools / domain keywords)
  6. Entry-level signal   → +0–3 pts (new grad / intern / associate)
  7. Recency              → +0–1 pt  (posted within 7 days)

Raw max = 11 → clamped to 10.
"""
import json
import os
import re
from datetime import datetime, timezone
from .models import Job

CONFIG_PATH = os.getenv("CONFIG_PATH", "config.json")

# ── 1. Off-field blocklist ─────────────────────────────────────────────────
# Job titles that are never relevant, regardless of company or description.
_OFFFIELD_RE = re.compile(
    r"\b("
    # Clinical / medical (non-computational)
    r"nurse|nursing|physician|surgeon|anesthes|"
    r"pharmacist(?!\s+(data|tech|informatics))|"
    r"therapist|counselor|clinician|social\s+worker|case\s+manager|care\s+coordinator|"
    r"dental|optometr|veterinar|"
    r"medical\s+assistant|medical\s+writer|medical\s+science\s+liaison|"
    r"clinical\s+research\s+associate(?!\s*(,|:|–|-)\s*(data|bioinformatics|computational))|"
    r"regulatory\s+affairs(?!\s+(data|analyst))|"
    # Sales / BD
    r"account\s+executive|"
    r"sales\s+(representative|rep\b|coordinator)|"
    r"sales\s+manager(?!\s*(,|:|–))|"
    r"business\s+development\s+(representative|rep\b|manager|executive)|"
    r"customer\s+success\s+manager|customer\s+support|customer\s+service\s+rep|"
    # HR / Legal / Finance
    r"recruiter|talent\s+acquisition|human\s+resources\s+manager|\bhr\s+manager|"
    r"paralegal|attorney\b|\blawyer\b|legal\s+counsel|"
    r"compliance\s+officer(?!\s+(data|analytics))|"
    r"financial\s+advisor|wealth\s+management\s+advisor|insurance\s+agent|"
    # Marketing / Design (non-technical)
    r"marketing\s+manager|brand\s+manager|content\s+(writer|creator|strategist)|"
    r"copywriter|graphic\s+designer|"
    # Ops / Physical
    r"supply\s+chain\s+manager|logistics\s+coordinator|warehouse|"
    r"\bdriver\b|delivery\s+driver|"
    r"chef\b|cook\b|barista|bartender|\bserver\b|"
    # Other non-tech
    r"teacher(?!\s+(data|assistant))|professor(?!\s+(research|data|computational))|"
    r"pharmacy\s+technician|ux\s+researcher(?!\s+(data|quantitative))"
    r")\b",
    re.IGNORECASE,
)

# ── 2. Senior / management penalty ────────────────────────────────────────
_SENIOR_RE = re.compile(
    r"\b("
    r"senior|sr\b|sr\.|principal\b|director\b|"
    r"vp\b|vice\s+president|head\s+of|chief\b|"
    r"distinguished|fellow\b|partner\b|"
    # "staff" only when followed by a role noun — avoids "Member of Technical Staff"
    r"staff\s+(engineer|scientist|software|data|ml|ai|cloud|platform|"
    r"security|research|backend|frontend|infrastructure|machine)|"
    r"engineering\s+manager|tech\s+lead|lead\s+engineer|"
    r"lead\s+scientist|lead\s+data|lead\s+analyst"
    r")\b",
    re.IGNORECASE,
)

# ── 3a. HIGH confidence — tech roles (5 pts) ───────────────────────────────
_HIGH_TECH_RE = re.compile(
    r"\b("
    # ── Software Engineering ──────────────────────────────────────────
    r"software\s+(engineer|developer|architect)|"
    r"\bswe\b|\bsde[\s-]?\d?|"
    r"full[\s-]?stack\s+(engineer|developer)|"
    r"frontend\s+(engineer|developer)|front[\s-]end\s+(engineer|developer)|"
    r"backend\s+(engineer|developer)|back[\s-]end\s+(engineer|developer)|"
    r"web\s+(engineer|developer|application\s+developer)|"
    r"mobile\s+(engineer|developer)|"
    r"android\s+(engineer|developer)|"
    r"ios\s+(engineer|developer)|"
    r"react\s+native\s+(engineer|developer)|"
    r"flutter\s+(engineer|developer)|"
    r"embedded\s+software\s+engineer|firmware\s+engineer|"
    r"platform\s+engineer|infrastructure\s+engineer|"
    r"systems\s+(engineer|software\s+engineer)|"
    r"game\s+(engineer|developer)|graphics\s+engineer|simulation\s+engineer|"
    r"application\s+(engineer|developer)|api\s+(engineer|developer)|"
    # ── Data Science (all sub-specializations) ────────────────────────
    r"data\s+scientist|applied\s+scientist|"
    r"data\s+(analyst|analytics)|"
    r"analytics\s+engineer|"
    r"(business\s+intelligence|bi)\s+(engineer|developer|analyst)|"
    r"data\s+modeler|"
    r"quantitative\s+(analyst|researcher|developer|engineer|scientist)|"
    r"\bquant\s+(analyst|researcher|developer|engineer)|"
    r"decision\s+scientist|"
    r"forecasting\s+(scientist|analyst|engineer)|"
    r"experimentation\s+(analyst|scientist|engineer)|"
    r"fraud\s+(analyst|scientist|data\s+scientist)|"
    r"risk\s+(analyst|data\s+scientist|scientist)|"
    r"operations\s+research\s+(analyst|scientist)|"
    r"supply\s+chain\s+(data\s+scientist|analyst)|"
    r"pricing\s+(analyst|scientist|engineer)|"
    r"growth\s+(analyst|scientist|data\s+scientist)|"
    r"marketing\s+(data\s+scientist|analyst|scientist)|"
    r"revenue\s+(analyst|scientist)|"
    r"clinical\s+analyst|"
    # ── Machine Learning / AI (all specializations) ───────────────────
    r"machine\s+learning\s+(engineer|scientist|researcher|analyst|intern|specialist|associate)|"
    r"\bml\s+(engineer|scientist|researcher|analyst|intern|specialist)|"
    r"\bai\s+(engineer|scientist|researcher|analyst|intern|specialist)|"
    r"deep\s+learning\s+(engineer|scientist|researcher)|"
    r"nlp\s+(engineer|scientist|researcher|analyst)|"
    r"natural\s+language\s+processing\s+(engineer|scientist)|"
    r"computer\s+vision\s+(engineer|scientist|researcher)|"
    r"speech\s+(recognition|synthesis)\s+(engineer|scientist)|"
    r"audio\s+ml\s+(engineer|scientist)|"
    r"reinforcement\s+learning\s+(engineer|scientist|researcher)|"
    r"generative\s+ai\s+(engineer|scientist|specialist)|"
    r"gen[\s-]?ai\s+(engineer|scientist|specialist)|"
    r"llm\s+(engineer|scientist|researcher)|"
    r"foundation\s+model\s+(researcher|engineer|scientist)|"
    r"(ai|ml)\s+research\s+(scientist|engineer)|"
    r"research\s+engineer\b|"
    r"mlops\s+engineer|"
    r"ml\s+(platform|infrastructure)\s+engineer|ai\s+infrastructure\s+engineer|"
    r"recommendation\s+systems?\s+(engineer|scientist)|"
    r"personalization\s+engineer|ranking\s+engineer|"
    r"search\s+(engineer|scientist)\b|"
    r"multimodal\s+(engineer|scientist|researcher)|"
    r"ai\s+safety\s+(engineer|researcher|scientist)|"
    r"ai\s+ethics\s+(engineer|researcher|scientist)|"
    r"responsible\s+ai\s+(engineer|scientist)|"
    r"prompt\s+engineer|"
    r"fine[\s-]?tuning\s+engineer|"
    r"evaluation\s+scientist|"
    # ── Data Engineering ──────────────────────────────────────────────
    r"data\s+engineer|big\s+data\s+engineer|"
    r"data\s+(platform|reliability|infrastructure)\s+engineer|"
    r"analytics\s+architect|data\s+architect|"
    r"database\s+(engineer|developer)|"
    r"etl\s+(developer|engineer)|elt\s+(developer|engineer)|"
    r"lakehouse\s+engineer|"
    # ── Cloud / DevOps / SRE ──────────────────────────────────────────
    r"cloud\s+(engineer|architect|developer|automation\s+engineer)|"
    r"solutions\s+architect|"
    r"devops\s+engineer|"
    r"site\s+reliability\s+engineer|sre\b|"
    r"kubernetes\s+engineer|terraform\s+engineer|"
    r"build\s+(and\s+)?release\s+engineer|ci[/\s]?cd\s+engineer|"
    r"network\s+engineer|"
    # ── Security ──────────────────────────────────────────────────────
    r"cybersecurity\s+(analyst|engineer)|security\s+engineer|"
    r"application\s+security\s+engineer|devsecops\s+engineer|"
    r"cloud\s+security\s+engineer|information\s+security\s+analyst|"
    r"penetration\s+test(er|ing)|ethical\s+hacker|security\s+researcher|"
    r"cryptography\s+engineer|privacy\s+engineer|trust\s+and\s+safety\s+engineer|"
    # ── QA / Testing ──────────────────────────────────────────────────
    r"qa\s+engineer|quality\s+assurance\s+(engineer|analyst)|"
    r"test\s+automation\s+engineer|software\s+test\s+engineer|"
    r"automation\s+engineer\b|performance\s+test\s+engineer|"
    # ── Emerging Tech ─────────────────────────────────────────────────
    r"blockchain\s+(engineer|developer)|smart\s+contract\s+developer|"
    r"web3\s+(engineer|developer)|crypto\s+engineer|"
    r"ar[/\s]?vr\s+(engineer|developer)|xr\s+(engineer|developer)|"
    r"spatial\s+computing\s+engineer|"
    r"robotics\s+(engineer|software\s+engineer|developer)|"
    r"autonomous\s+systems\s+engineer|drone\s+software\s+engineer|"
    r"iot\s+(engineer|developer)|digital\s+twin\s+engineer|"
    r"edge\s+ai\s+engineer"
    r")\b",
    re.IGNORECASE,
)

# ── 3b. HIGH confidence — healthcare + computational roles (5 pts) ─────────
_HIGH_HEALTH_RE = re.compile(
    r"\b("
    # ── Bioinformatics ────────────────────────────────────────────────
    r"bioinformatics\s*(scientist|analyst|engineer|developer|researcher|"
    r"intern|associate|specialist)|"
    r"\bbioinformatics\b|"  # standalone "Bioinformatics" in title
    r"computational\s+biolog(ist|y\s+scientist|y\s+analyst|y\s+researcher)|"
    r"computational\s+genomics\s+(scientist|analyst|engineer)|"
    r"computational\s+neuroscien(tist|ce\s+researcher)|"
    r"computational\s+chemist|cheminformatics|"
    r"genomics\s+(data\s+)?(analyst|scientist|engineer|researcher)|"
    r"transcriptomics\s+(analyst|scientist|researcher)|"
    r"proteomics\s+(data\s+)?(scientist|analyst)|"
    r"metabolomics\s+(analyst|scientist)|"
    r"single[\s-]cell\s+(analyst|scientist|researcher|bioinformatician)|"
    r"structural\s+bioinformatics\s*(scientist|analyst)?|"
    r"ngs\s+(analyst|scientist|engineer)|"
    r"gwas\s+(analyst|scientist)|sequencing\s+data\s+(analyst|scientist)|"
    r"population\s+genetics\s+(analyst|scientist)|"
    # ── Clinical & Pharma Data ────────────────────────────────────────
    r"clinical\s+data\s+(scientist|analyst|engineer)|"
    r"clinical\s+statistical\s+programmer|statistical\s+programmer|"
    r"biostatistician|"
    r"pharmacometrician|"
    r"pk[/\s]?pd\s+(modeler|scientist|analyst)|"
    r"pharmacokinetics\s*(analyst|scientist|modeler)|"
    r"drug\s+discovery\s+(data\s+scientist|scientist|researcher)|"
    r"computational\s+drug\s+(discovery|design)|"
    r"translational\s+(data\s+scientist|bioinformatics\s+scientist|scientist)|"
    r"real\s+world\s+evidence\s*(analyst|scientist)?|rwe\s+(analyst|scientist)|"
    r"real\s+world\s+data\s+scientist|"
    r"health\s+economics\s+(data\s+)?(analyst|scientist)|"
    r"medical\s+imaging\s+(ai|scientist|analyst|engineer|researcher)|"
    r"radiology\s+ai\s*(engineer|scientist|researcher)?|"
    r"pathology\s+ai\s*(engineer|scientist|researcher)?|"
    r"oncology\s+data\s+(scientist|analyst)|"
    # ── Health Informatics & Digital Health ───────────────────────────
    r"health\s+informatics\s*(analyst|specialist|scientist)?|"
    r"medical\s+informatics\s*(scientist|analyst)?|"
    r"clinical\s+informatics\s*(analyst|scientist)?|"
    r"healthcare\s+data\s+(analyst|scientist|engineer)|"
    r"health\s+data\s+(analyst|scientist|engineer)|"
    r"digital\s+health\s+(engineer|developer|data\s+scientist)|"
    r"ehr\s+data\s+(analyst|scientist|engineer)|"
    r"population\s+health\s+(analyst|scientist)|"
    r"epidemiology\s+(data\s+)?(analyst|scientist)|"
    r"epidemiologist\s*,\s*(data|computational)|"   # plain "Epidemiologist" → MEDIUM
    r"public\s+health\s+data\s+(analyst|scientist)|"
    # ── Computational Research (pharma / academia) ────────────────────
    r"computational\s+research\s+scientist|computational\s+scientist|"
    r"associate\s+computational\s+(biologist|scientist)|"
    r"(ai|ml)\s+research\s+scientist|"
    r"computational\s+(biology|genomics|chemistry)\s+intern"
    r")\b",
    re.IGNORECASE,
)

# ── 3c. MEDIUM confidence (3 pts — description must have tech signals) ─────
_MEDIUM_RE = re.compile(
    r"\b("
    r"member\s+of\s+technical\s+staff|\bmts\b|"
    r"research\s+associate|"
    r"research\s+scientist|"           # could be wet lab → Layer 4 handles
    r"scientist\s+(i{1,3}|iv|1|2|3)\b|"
    r"associate\s+scientist|"
    r"forward\s+deployed\s+engineer|"
    r"solutions\s+engineer|"
    r"implementation\s+engineer|integration\s+engineer|"
    r"technical\s+(analyst|specialist|consultant)|"
    r"data\s+specialist|"
    r"technical\s+program\s+manager|"
    r"product\s+manager|"
    r"statistician\b|"
    r"epidemiologist\b|"
    r"business\s+analyst|"
    r"\banalyst\b"                     # standalone — needs description
    r")\b",
    re.IGNORECASE,
)

# ── 4. Wet-lab signals ─────────────────────────────────────────────────────
# If description matches ONLY these (no tech skills) → score 0.
_WETLAB_RE = re.compile(
    r"\b("
    r"pcr\b|cell\s+culture|pipett|western\s+blot|microscop(y|ic)|"
    r"\bassay\b|centrifug|elisa\b|flow\s+cytometry|immunohistochem|"
    r"titration|gel\s+electrophoresis|in\s+vitro|in\s+vivo|"
    r"colony\s+(count|forming)|reagent\b|tissue\s+culture|cell\s+line|"
    r"transfection|primary\s+cell|mouse\s+model|animal\s+model|"
    r"bench\s+(science|research|work)"
    r")\b",
    re.IGNORECASE,
)

# ── 5a. Tech skills (programming languages, ML/data tools, cloud) ──────────
_TECH_SKILLS_RE = re.compile(
    r"\b("
    # Languages
    r"python|scala|kotlin|swift|golang\b|go\b|rust\b|"
    r"java\b|javascript|typescript|ruby|julia|matlab|"
    r"sas\b|stata\b|bash|shell\s+script|perl\b|"
    r"sql\b|postgresql|mysql|nosql\b|"
    r"c\+\+|c#|\.net\b|"
    # ML / AI / DL
    r"pytorch|tensorflow|keras|jax\b|"
    r"scikit[\s-]?learn|sklearn|xgboost|lightgbm|catboost|"
    r"hugging\s*face|transformers|langchain|langgraph|llamaindex|"
    r"llm\b|rag\b|fine[\s-]?tuning|embeddings|vector\s+(search|database|store)|"
    r"machine\s+learning|deep\s+learning|neural\s+network|"
    r"computer\s+vision|natural\s+language\s+processing|nlp\b|"
    r"reinforcement\s+learning|generative\s+ai|"
    r"onnx|cuda\b|triton\b|"
    r"statistical\s+(model|analysis|method|computing|learning)|"
    r"regression|classification|clustering|"
    # Data / pipelines
    r"pandas|numpy|polars|dask\b|"
    r"apache\s+spark|pyspark|spark\b|hadoop|hive\b|"
    r"kafka\b|apache\s+flink|flink\b|"
    r"airflow|dagster|prefect\b|luigi\b|"
    r"dbt\b|duckdb|delta\s+lake|apache\s+iceberg|"
    r"databricks|snowflake|bigquery|redshift|athena\b|"
    r"data\s+(pipeline|warehouse|lake|lakehouse|mesh)|etl\b|elt\b|"
    r"tableau|power\s+bi|looker|metabase|superset|"
    r"matplotlib|seaborn|plotly\b|"
    # Cloud / Infra
    r"\baws\b|azure\b|gcp\b|google\s+cloud|"
    r"docker\b|kubernetes\b|k8s\b|terraform\b|ansible\b|"
    r"mlflow|kubeflow|sagemaker|vertex\s+ai|azure\s+ml|"
    r"ci[/\s]?cd|github\s+actions|jenkins\b|"
    r"rest\s+api|graphql\b|grpc\b|microservices\b|"
    # Databases
    r"mongodb|redis\b|elasticsearch|cassandra\b|"
    r"dynamodb|firebase\b|neo4j\b|pinecone\b|weaviate\b|chroma\b|"
    r"qdrant\b|milvus\b"
    r")\b",
    re.IGNORECASE,
)

# ── 5b. Domain / healthcare / emerging-tech skills ─────────────────────────
_DOMAIN_SKILLS_RE = re.compile(
    r"\b("
    # Healthcare / Biotech
    r"bioinformatics|genomics|proteomics|metabolomics|transcriptomics|"
    r"clinical\s+(data|trial|study)|"
    r"ehr\b|emr\b|hl7\b|fhir\b|omop\b|cdm\b|"
    r"biostatistics?|epidemiology|pharmacokinetics|pharmacodynamics|"
    r"drug\s+discovery|molecular\s+dynamics|computational\s+biology|"
    r"ngs\b|rna[\s-]?seq|whole\s+genome|snp\b|gwas\b|"
    r"bioconductor|gatk\b|samtools\b|blast\b|"
    r"medical\s+imaging|dicom\b|radiology\b|pathology\b|"
    r"crispr|single[\s-]cell|spatial\s+transcriptomics|"
    # Quant / Finance
    r"quantitative\s+(finance|research|trading|modeling)|"
    r"time\s+series|financial\s+model|"
    # Emerging tech
    r"blockchain|smart\s+contract|web3\b|"
    r"robotics|autonomous\s+(driving|vehicle|system)|"
    r"augmented\s+reality|virtual\s+reality|\bxr\b|"
    # DS/ML specializations
    r"a[/\s]b\s+test|experimentation|causal\s+inference|"
    r"recommendation\s+system|anomaly\s+detection|forecasting|"
    r"large\s+language\s+model|foundation\s+model|"
    r"computer\s+vision|image\s+(recognition|segmentation|classification)"
    r")\b",
    re.IGNORECASE,
)

# ── 6. Entry-level signals ─────────────────────────────────────────────────
_ENTRY_STRONG_RE = re.compile(   # +3 pts
    r"\b("
    r"new\s*grad|recent\s*grad|new\s+graduate|recent\s+graduate|"
    r"entry[\s-]?level|university\s+(grad|hire|recruit|new\s+grad)|"
    r"campus\s+hire|early\s+career|"
    r"0[\s-]?to[\s-]?[12]\s*year|"
    r"class\s+of\s+(202[4-9]|203[0-2])|"
    r"202[5-7]\s+(graduate|grad)"
    r")\b",
    re.IGNORECASE,
)

_ENTRY_WEAK_RE = re.compile(     # +2 pts
    r"\b("
    r"associate\s+(engineer|scientist|analyst|developer|researcher)|"
    r"junior\s+(engineer|developer|scientist|analyst)|"
    r"engineer\s+i\b|scientist\s+i\b|analyst\s+i\b|developer\s+i\b|"
    r"engineer\s+1\b|scientist\s+1\b|analyst\s+1\b|"
    r"level[\s-]?1\b|grade[\s-]?1\b|"
    r"\bintern\b|co[\s-]?op\b|apprentice"
    r")\b",
    re.IGNORECASE,
)


def load_profile() -> dict:
    if not os.path.exists(CONFIG_PATH):
        return {}
    with open(CONFIG_PATH) as f:
        return json.load(f).get("profile", {})


def score_job(job: Job, profile: dict | None = None) -> float:
    if profile is None:
        profile = load_profile()

    excluded: list[str] = [c.lower() for c in profile.get("excluded_companies", [])]
    if job.company.lower() in excluded:
        return 0.0

    title = (job.title or "").strip()
    desc  = (job.description or "").lower()
    full  = f"{title} {desc}".lower()

    # ── Layer 1: Off-field blocklist ──────────────────────────────────────
    if _OFFFIELD_RE.search(title):
        return 0.0

    # ── Layer 2: Senior / management ─────────────────────────────────────
    if _SENIOR_RE.search(title):
        return 0.5

    # ── Layer 3: Role confidence ──────────────────────────────────────────
    if _HIGH_TECH_RE.search(title) or _HIGH_HEALTH_RE.search(title):
        score = 5.0
    elif _MEDIUM_RE.search(title):
        score = 3.0
    else:
        return 0.0

    # ── Layer 4: Wet-lab guard ────────────────────────────────────────────
    # Pure wet-lab description with zero tech signals → not relevant for Meet.
    if _WETLAB_RE.search(desc) and not _TECH_SKILLS_RE.search(desc):
        return 0.0

    # ── Layer 5: Description skill bonus (0–2 pts) ────────────────────────
    if _TECH_SKILLS_RE.search(desc):
        score += 1.0
    if _DOMAIN_SKILLS_RE.search(desc):
        score += 1.0

    # ── Layer 6: Entry-level signal (0–3 pts) ────────────────────────────
    if _ENTRY_STRONG_RE.search(full):
        score += 3.0
    elif _ENTRY_WEAK_RE.search(full):
        score += 2.0

    # ── Layer 7: Recency (0–1 pt) ─────────────────────────────────────────
    if job.posted_at:
        try:
            posted = datetime.fromisoformat(job.posted_at.replace("Z", "+00:00"))
            if (datetime.now(timezone.utc) - posted).days <= 7:
                score += 1.0
        except Exception:
            pass

    return round(min(score, 10.0), 2)
