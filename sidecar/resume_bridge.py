#!/usr/bin/env python3
"""
resume_bridge.py — CareerOS ↔ Resume Engine Machine bridge.

Called by tailor-simple.mjs after Ollama produces optimizer.json.
Pipeline:
  1. detect_role_type(JD)  →  pick base template (MLE / SWE / DS / DE / DA)
  2. Apply Ollama bullet rewrites via fuzzy match (threshold 0.72)
  3. Inject missing keywords into the Skills section
  4. ats_scorer.match_resume  →  verify ATS score
  5. generate_pdf_latex  →  pdflatex  →  PDF

Usage:
    python3 sidecar/resume_bridge.py \
        --jd       output/tailored-resumes/2026-08-13/01-stripe-swe/jd.txt \
        --optimizer output/tailored-resumes/2026-08-13/01-stripe-swe/optimizer.json \
        --outdir   output/tailored-resumes/2026-08-13/01-stripe-swe \
        --company  "Stripe" \
        --role     "Software Engineer"

Prints a single-line JSON to stdout — caller reads this.
"""

import argparse
import difflib
import json
import os
import re
import sys
from pathlib import Path

# ── Locate Resume Engine Machine ──────────────────────────────────────────────
REM = os.environ.get(
    "RESUME_ENGINE_PATH",
    os.path.expanduser("~/Resume Engine Machine"),
)
TRACKER   = os.path.join(REM, "tracker")
RESUMES   = os.path.join(REM, "resumes")
YOUR_NAME = os.environ.get("YOUR_NAME", "MeetBrahmbhatt").replace(" ", "")

sys.path.insert(0, TRACKER)

try:
    from jd_extractor import detect_role_type, detect_domain, recommend_template
    from ats_scorer import score_jd_keywords, match_resume
    from generate_pdf_latex import md_to_latex, compile_latex
    _IMPORTS_OK = True
    _IMPORT_ERR = ""
except ImportError as e:
    _IMPORTS_OK = False
    _IMPORT_ERR = str(e)

# ── Template file map ─────────────────────────────────────────────────────────
TEMPLATE_FILES = {
    "base_MLE_AI":      "base_MLE_AI.md",
    "base_SWE_SDE":     "base_SWE_SDE.md",
    "base_DS_Research": "base_DS_Research.md",
    "base_DE":          "base_DE.md",
    "base_DA_BI":       "base_DA_BI.md",
}

# ── Skills category affinity ──────────────────────────────────────────────────
# Each entry: (set of keyword fragments, Skills section line hint)
# Used to decide which category line in the Skills section to prepend a keyword to.
_CATEGORY_HINTS: list[tuple[set, str]] = [
    (
        {"pytorch", "tensorflow", "scikit", "xgboost", "lightgbm", "mlflow",
         "huggingface", "wandb", "catboost", "onnx", "triton", "vllm",
         "langchain", "langgraph", "faiss", "chromadb", "openai", "ollama",
         "transformers", "stable diffusion", "rag", "llm", "nlp", "bert", "gpt",
         "embedding", "vector", "fine-tun", "reinforcement"},
        "ml"
    ),
    (
        {"pyspark", "spark", "airflow", "kafka", "dbt", "databricks",
         "snowflake", "flink", "hadoop", "hive", "delta lake", "iceberg",
         "debezium", "nifi", "glue", "redshift", "bigquery", "etl", "elt"},
        "data engineer"
    ),
    (
        {"tableau", "power bi", "looker", "plotly", "matplotlib", "seaborn",
         "streamlit", "dash", "quicksight", "superset", "grafana", "d3"},
        "visuali"
    ),
    (
        {"aws", "gcp", "azure", "sagemaker", "ec2", "lambda", "s3",
         "kubernetes", "docker", "terraform", "helm", "github actions",
         "jenkins", "ci/cd", "codepipeline", "cloud"},
        "cloud"
    ),
    (
        {"postgresql", "mysql", "mongodb", "redis", "elasticsearch",
         "neo4j", "cassandra", "sqlite", "dynamodb", "supabase", "database"},
        "database"
    ),
    (
        {"fastapi", "flask", "spring", "node.js", "django", "graphql",
         "grpc", "rest", "microservice", "kafka"},
        "backend"
    ),
    (
        {"psm", "cox", "gam", "bayesian", "regression", "survival",
         "a/b test", "hypothesis", "statsmodels", "scipy", "statistic"},
        "statistic"
    ),
]


def _best_skills_line(keyword: str, skills_lines: list[str]) -> int:
    """Return the index (within skills_lines) to prepend this keyword to."""
    kw_l = keyword.lower()
    for terms, hint in _CATEGORY_HINTS:
        if any(kw_l.startswith(t) or t in kw_l for t in terms):
            for i, line in enumerate(skills_lines):
                ll = line.lower()
                if hint in ll or any(t in ll for t in terms):
                    return i
    return 0 if skills_lines else -1


def inject_keywords(resume_md: str, keywords: list[str]) -> tuple[str, int]:
    """Inject missing keywords into the Skills section."""
    lines = resume_md.split("\n")

    # Find Skills section
    skills_start = skills_end = -1
    for i, line in enumerate(lines):
        if re.match(r"^#+\s*(technical\s+)?skills", line.strip(), re.IGNORECASE):
            skills_start = i
        elif skills_start != -1 and re.match(r"^##\s", line.strip()) and i > skills_start:
            skills_end = i
            break
    if skills_start == -1:
        return resume_md, 0
    if skills_end == -1:
        skills_end = len(lines)

    skills_lines = lines[skills_start:skills_end]
    resume_lower = resume_md.lower()
    injected = 0

    for kw in keywords:
        kw = (kw or "").strip().strip("`*").strip()
        if len(kw) < 2:
            continue
        if kw.lower() in resume_lower:
            continue  # already present

        idx = _best_skills_line(kw, skills_lines)
        if idx < 0:
            continue

        target = skills_lines[idx]
        if ":" in target:
            label, rest = target.split(":", 1)
            skills_lines[idx] = f"{label}: {kw}, {rest.lstrip()}"
        else:
            skills_lines[idx] = f"{kw}, {target}"

        resume_lower += " " + kw.lower()
        injected += 1

    lines[skills_start:skills_end] = skills_lines
    return "\n".join(lines), injected


def apply_rewrites(resume_md: str, rewrites: list[dict]) -> tuple[str, int]:
    """
    Fuzzy-match Ollama bullet rewrites into the resume markdown.
    'before' is the original bullet text, 'after' is the improved version.
    Replaces on ratio ≥ 0.72 against clean (no -, **, *) bullet text.
    """
    lines = resume_md.split("\n")
    applied = 0

    for rw in rewrites:
        before = (rw.get("before") or "").strip()
        after  = (rw.get("after") or "").strip()
        if not before or not after or len(before) < 20:
            continue

        before_clean = re.sub(r"\*+", "", before).strip()

        best_ratio, best_idx = 0.0, -1
        for i, raw_line in enumerate(lines):
            stripped = raw_line.strip()
            if not (stripped.startswith("-") or stripped.startswith("•")):
                continue
            clean = re.sub(r"^[-•]\s*", "", stripped)
            clean = re.sub(r"\*+", "", clean).strip()
            ratio = difflib.SequenceMatcher(None, clean.lower(), before_clean.lower()).ratio()
            if ratio > best_ratio:
                best_ratio, best_idx = ratio, i

        if best_ratio >= 0.72 and best_idx >= 0:
            indent = len(lines[best_idx]) - len(lines[best_idx].lstrip())
            lines[best_idx] = " " * indent + "- " + after
            applied += 1

    return "\n".join(lines), applied


def run(jd_path: str, optimizer_path: str, outdir: str,
        company: str, role: str, base_resume: str | None = None) -> dict:

    result: dict = {"ok": False}

    if not _IMPORTS_OK:
        result["error"] = f"Resume Engine Machine imports failed: {_IMPORT_ERR}. Check RESUME_ENGINE_PATH."
        return result

    # Load inputs
    try:
        jd_text   = Path(jd_path).read_text(encoding="utf-8")
        optimizer = json.loads(Path(optimizer_path).read_text(encoding="utf-8"))
    except Exception as e:
        result["error"] = f"Could not read inputs: {e}"
        return result

    # 1. Detect role type → select base template (or use provided base resume for refinement rounds)
    role_type = detect_role_type(jd_text)
    domain    = detect_domain(jd_text)
    tmpl_name = recommend_template(role_type, domain)

    if base_resume and Path(base_resume).exists():
        # Refinement round: build on the previous round's output, not the fresh template
        try:
            resume_md = Path(base_resume).read_text(encoding="utf-8")
            result["using_base_resume"] = True
        except Exception as e:
            result["error"] = f"Could not read base resume '{base_resume}': {e}"
            return result
    else:
        tmpl_file = os.path.join(RESUMES, TEMPLATE_FILES.get(tmpl_name, "base_MLE_AI.md"))
        try:
            resume_md = Path(tmpl_file).read_text(encoding="utf-8")
        except Exception as e:
            result["error"] = f"Could not read template '{tmpl_file}': {e}"
            return result

    # 2. Apply Ollama bullet rewrites (fuzzy match into current resume)
    rewrites = optimizer.get("bullet_rewrites", [])
    resume_md, rewrites_applied = apply_rewrites(resume_md, rewrites)

    # 3. Inject missing keywords into Skills section
    missing   = optimizer.get("missing_keywords", []) + optimizer.get("skills_to_add", [])
    resume_md, injected = inject_keywords(resume_md, missing)

    # 4. ATS score verification — return ALL missing keywords so the refinement loop sees the full gap
    jd_keywords = score_jd_keywords(jd_text)
    found, still_missing, ats_score = match_resume(resume_md, jd_keywords)

    result.update({
        "ok":                True,
        "role_type":         role_type,
        "template":          tmpl_name,
        "rewrites_applied":  rewrites_applied,
        "keywords_injected": injected,
        "ats_score":         ats_score,
        "keywords_found":    len(found),
        "keywords_missing":  sorted(still_missing),   # full list, no cap
    })

    # 5. Save tailored resume.md
    resume_md_path = os.path.join(outdir, "resume.md")
    try:
        Path(resume_md_path).write_text(resume_md, encoding="utf-8")
        result["resume_md"] = resume_md_path
    except Exception as e:
        result["error"] = f"Could not save resume.md: {e}"
        return result

    # 6. Generate PDF via pdflatex
    safe_company = re.sub(r"[^A-Za-z0-9]", "", company)[:18]
    safe_role    = re.sub(r"[^A-Za-z0-9]", "", role)[:18]
    pdf_name     = f"{YOUR_NAME}_{safe_company}_{safe_role}.pdf"
    pdf_path     = os.path.join(outdir, pdf_name)

    try:
        tex = md_to_latex(resume_md)
        _stdout, page_count = compile_latex(tex, pdf_path)
        result["pdf_ok"]    = True
        result["pdf_path"]  = pdf_path
        result["pdf_pages"] = page_count
    except Exception as e:
        result["pdf_ok"]    = False
        result["pdf_error"] = str(e)

    return result


def main():
    parser = argparse.ArgumentParser(description="CareerOS ↔ Resume Engine Machine bridge")
    parser.add_argument("--jd",          required=True, help="Path to jd.txt")
    parser.add_argument("--optimizer",   required=True, help="Path to optimizer.json")
    parser.add_argument("--outdir",      required=True, help="Output directory")
    parser.add_argument("--company",     required=True)
    parser.add_argument("--role",        required=True)
    parser.add_argument("--base-resume", default=None,
                        help="Existing resume.md to build on instead of the base template (refinement rounds)")
    args = parser.parse_args()

    out = run(args.jd, args.optimizer, args.outdir, args.company, args.role, args.base_resume)
    print(json.dumps(out))


if __name__ == "__main__":
    main()
