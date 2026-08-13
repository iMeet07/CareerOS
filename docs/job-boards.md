# Job Boards & Resources — Complete Reference

A comprehensive map of every job board and resource relevant to tech, ML/AI, data science, pharma, biotech, and healthcare-tech roles.
Split into two sections: **Automated** (scraped by this system) and **Manual** (check these yourself).

---

## Section 1 — Automated Sources

These are scraped by the Atriveo scraper. Jobs flow into your dashboard automatically.

### ATS Platforms (Company-List Based)

The same job may appear across multiple ATS systems. Deduplication handles it.

| Source | Companies Using It | API Type | Specialty |
|---|---|---|---|
| **Greenhouse** | Anthropic, Stripe, Databricks, Figma, Airbnb, most mid-large tech | Public REST — no auth | Tech companies, very reliable, richest job data |
| **Lever** | Spotify, Netflix, GitHub, Shopify, Palantir, Benchling | Public REST — no auth | Tech + biotech startups |
| **Ashby** | Perplexity, Mistral, Together AI, Runway, Character.AI, many YC companies | Public REST — no auth | AI/ML startups specifically, growing fast |
| **Workday** | Pfizer, Merck, AstraZeneca, Genentech/Roche, Biogen, Illumina, Moderna, Microsoft, AbbVie | Internal JSON endpoint — no auth | Big pharma + enterprise tech, single biggest source for healthcare-tech roles |
| **BambooHR** | Mid-size companies, many biotech | Public embed endpoint — no auth | Mid-market companies often missed by other ATS scrapers |
| **Workable** | Broad mix, many Series A-B startups | Public JSON — no auth | General coverage for startups not on Greenhouse/Lever/Ashby |

---

### Curated & Aggregated Boards (No Auth)

| Source | URL | Specialty | Why It's Valuable |
|---|---|---|---|
| **Simplify New Grad** | github.com/SimplifyJobs/New-Grad-Positions | New grad roles, updated daily | Community-curated, pre-filtered to entry-level, covers 100k+ company sources hourly |
| **Simplify Internships** | github.com/SimplifyJobs/Summer2026-Internships | Internships only | Same quality as New Grad list but for internships |
| **The Muse** | themuse.com | Entry-level with category + level filters | Has `?level=Entry+Level&category=Engineering/Data+Science` filter built in |
| **RemoteOK** | remoteok.com | Remote tech jobs | Public JSON API, no auth, focused on SWE/ML/DS remote roles |
| **Remotive** | remotive.com | Remote tech jobs | Free API at `remotive.com/api/remote-jobs`, curated, no key needed |
| **Himalayas** | himalayas.app | Remote jobs with rich filtering | Free API, filter by seniority/category/timezone, high quality listings |
| **We Work Remotely** | weworkremotely.com | Remote tech jobs | Largest remote work community, SWE/design/devops |
| **Jobicy** | jobicy.com | Remote tech jobs | Free API, good for SWE/data/ML |
| **BioSpace** | biospace.com | Pharma/biotech SPECIFIC | The go-to board for biopharma. AbbVie, Eli Lilly, Regeneron, Amgen, Takeda, Sanofi, Novo Nordisk all post here. 25% YoY job growth in 2026 |
| **Y Combinator** | workatastartup.com | YC-backed startups | Public JSON, covers YC portfolio companies not on Greenhouse/Lever |
| **HN Who's Hiring** | news.ycombinator.com | Startup/early-stage companies | Monthly thread scraped via HN API, companies post directly, often small/interesting startups |

---

### API Key Required (Free Signup)

| Source | URL | Specialty | Notes |
|---|---|---|---|
| **Adzuna** | developer.adzuna.com | Broadest US coverage, aggregates many boards | 1,000 free calls/month, covers roles not on any ATS |
| **USAJobs** | developer.usajobs.gov | NIH, FDA, CDC, DOE national labs, EPA, NASA | Free key, requires US citizenship for most federal roles — verify eligibility first |

---

### Account-Based (Optional)

| Source | Specialty | Risk Level |
|---|---|---|
| **LinkedIn** | Broadest general coverage | Medium — personal account, ToS grey zone, keep disabled by default |
| **Wellfound** | Startup jobs with upfront salary + equity | Low-medium — free account, some scraping risk |

---

---

## Section 2 — Manual Reference

These boards are NOT scraped automatically. Check them manually when job hunting. Organized by category.

---

### General Job Aggregators

| Board | URL | Specialty | When to Use |
|---|---|---|---|
| **Indeed** | indeed.com | Largest job aggregator, every type of role | Best for volume searching, check weekly. API is partner-only now |
| **Google Jobs** | google.com/search?q=jobs | Aggregates every board in one search | Use as meta-search: "software engineer new grad site:linkedin.com OR greenhouse.io" |
| **LinkedIn Jobs** | linkedin.com/jobs | Broadest professional network, recruiter visibility | Use Early Career filter. Recruiters actively search here |
| **Glassdoor** | glassdoor.com/Job | Reviews + salary + job listings combined | Good for company research before applying, not just job search |
| **ZipRecruiter** | ziprecruiter.com | High volume, many SMB roles | Good for finding roles at companies not on major ATS platforms |
| **Talent.com** | talent.com | Aggregates Indeed, LinkedIn, company sites | Good secondary aggregator |
| **Jooble** | jooble.org | International aggregator | Decent for broad searches |
| **SimplyHired** | simplyhired.com | Indeed alternative | Check if Indeed misses something |

---

### Tech-Specific

| Board | URL | Specialty | When to Use |
|---|---|---|---|
| **Dice** | dice.com | IT/tech roles, strong for SWE/DevOps/Cloud | Underrated — many enterprise tech roles posted here not on LinkedIn |
| **Built In** | builtin.com | Tech jobs by city (NYC, SF, Austin, Boston, Chicago, LA, Seattle) | Good if you're targeting a specific city's tech scene |
| **Levels.fyi** | levels.fyi/jobs | High-paying tech companies, salary transparency | Great for checking comp ranges alongside job listings |
| **Hired** | hired.com | Curated, companies come to you | Requires profile — gets you inbound from recruiters |
| **Arc.dev** | arc.dev | Remote tech, vetted developers | Good for remote SWE roles |
| **TrueUp** | trueup.io | Tech company headcount tracker + job links | Useful for finding companies actively hiring vs laying off |
| **Otta** | otta.com | Curated tech/startup jobs (UK + US) | Good curation, shows why company is hiring |
| **Dev.to Jobs** | dev.to/jobs | Developer community job board | Smaller but quality postings from dev-friendly companies |

---

### New Grad / Student / Campus

| Board | URL | Specialty | When to Use |
|---|---|---|---|
| **Handshake** | joinhandshake.com | University-exclusive roles, campus recruiting | USE THIS — your SBU .edu gives access to roles posted specifically for SBU students. Some roles ONLY posted here |
| **RippleMatch** | ripplematch.com | AI-matched campus recruiting | Create profile, companies reach out to you |
| **WayUp** | wayup.com | Internships + entry-level | Good for internship hunting |
| **College Recruiter** | collegerecruiter.com | Student/new grad focused | Good supplement to Handshake |
| **Jumpstart** | jumpstart.me | Campus recruiting, D&I focused | Good for companies with university programs |
| **Parker Dewey** | parkerdewey.com | Micro-internships (short projects, paid) | Good for building experience and connections |
| **Forage** | theforage.com | Virtual work experience programs | Free virtual internships at Goldman, JPM, Google, etc. — builds resume + sometimes leads to real offers |
| **Intern.supply** | intern.supply | Community-aggregated internship list | Check this for internship leads |
| **Pitt CSC New Grad** | github.com/pittcsc/NewGrad-Positions | Community GitHub list, new grad roles | Run by community, updated frequently |
| **Ouckah CS-Jobs** | github.com/Ouckah/Summer2025-Internships | Community GitHub internship list | Similar to Simplify but community maintained |
| **cscareers.dev** | cscareers.dev | CS-focused community + job tracker | Discord community + job board |
| **newgrad-jobs.com** | newgrad-jobs.com | Aggregated new grad postings | Hourly updates, worth checking |

---

### Remote Work

| Board | URL | Specialty | When to Use |
|---|---|---|---|
| **Remote.co** | remote.co | Curated remote jobs, all disciplines | When specifically hunting remote-only roles |
| **Flexjobs** | flexjobs.com | Remote + flexible, all industries | Paid ($15/month) but high quality, pre-screened listings |
| **Working Nomads** | workingnomads.com | Remote tech specifically | Good for SWE/data remote roles |
| **Dynamite Jobs** | dynamitejobs.com | Remote, entrepreneur-adjacent companies | Niche but good for non-VC startup jobs |
| **Remote First Jobs** | remotefirstjobs.com | Companies that are remote-first by culture | Better than "remote allowed" — these are truly remote companies |
| **Pangian** | pangian.com | International remote | Good if open to working with global companies |

---

### Pharma / Biotech / Healthcare-Tech

| Board | URL | Specialty | When to Use |
|---|---|---|---|
| **BioSpace** | biospace.com | THE pharma/biotech job board — automated but also check manually | Manual search lets you filter by discipline (bioinformatics, computational, data science) |
| **Science Careers** | sciencecareers.sciencemag.org | AAAS/Science magazine job board, research roles | Best for computational biology, bioinformatics research positions |
| **Nature Careers** | naturecareers.com | Nature journal job board | Academic + industry research, computational biology, data science in bio |
| **HIMSS JobMine** | jobmine.himss.org | Health IT specifically | Clinical informatics, health data, EHR roles at hospitals and health systems |
| **HealthcareIT Today Jobs** | healthcareittoday.com/jobs | Health IT, clinical data | Good for clinical data science, health informatics roles |
| **MedZilla** | medzilla.com | Biotech/pharma/healthcare | Older but covers many pharma employers |
| **Pharma Careers** | pharmatalents.com | Pharma industry specific | Good for big pharma roles |
| **BioPharmGuy** | biopharmguy.com | Biotech/pharma company map | NOT a job board — but excellent for identifying companies to target |
| **Life Science Leader** | lifescienceleader.com | Pharma/biotech industry | Job section + industry news useful for knowing who's hiring |
| **Fierce Biotech** | fiercebiotech.com | Biotech news + jobs | Good for knowing which companies are growing vs contracting |

---

### Research / Academic / Government

| Board | URL | Specialty | When to Use |
|---|---|---|---|
| **USAJobs** | usajobs.gov | All federal roles — NIH, FDA, CDC, NASA, DOE | Check manually for NIH/FDA computational biology, bioinformatics, data science roles. Some require citizenship |
| **NIH Jobs** | jobs.nih.gov | NIH-specific, links to USAJobs | Computational biology, genomics, clinical informatics at NIH |
| **National Lab Jobs** | See below | DOE national lab research | Best for computational science, ML, bioinformatics research |
| **HigherEdJobs** | higheredjobs.com | Academic/university positions | If open to research scientist or postdoc adjacent roles |
| **AcademicJobsOnline** | academicjobsonline.org | Academic research positions | Faculty, postdoc, research scientist |

**National Labs to check directly:**
- Argonne National Lab: anl.gov/careers
- Lawrence Berkeley Lab: lbl.gov/careers
- Oak Ridge National Lab: ornl.gov/careers
- Pacific Northwest National Lab: pnnl.gov/careers
- Sandia National Labs: sandia.gov/careers
- Brookhaven National Lab: bnl.gov/HR
- Fermilab: fnal.gov/pub/employment

These labs hire computational biologists, ML engineers, data scientists, and bioinformaticians regularly, and many roles are open to non-citizens on a visa.

---

### Startup / VC Portfolio

| Board | URL | Specialty | When to Use |
|---|---|---|---|
| **Wellfound** | wellfound.com | Startup jobs, equity + salary shown upfront | Best for Series A-C startups, salary transparency is unique |
| **Y Combinator** | workatastartup.com | YC portfolio — automated but check manually too | Filter by batch year, company stage, role type |
| **Sequoia Jobs** | sequoia.com/jobs | Sequoia portfolio companies | Many top-tier AI/ML companies in portfolio |
| **a16z Jobs** | a16z.com/jobs | Andreessen Horowitz portfolio | Strong AI/biotech/fintech company coverage |
| **First Round Jobs** | firstround.com/jobs | First Round Capital portfolio | Earlier stage, fast-moving companies |
| **Kleiner Perkins Jobs** | kleinerperkins.com/jobs | KP portfolio | Strong biotech + tech coverage |
| **General Catalyst Jobs** | generalcatalyst.com/jobs | GC portfolio | Health + tech focused VC |
| **F6S Jobs** | f6s.com/jobs | Startup jobs, accelerator-backed | Good for very early stage |
| **Product Hunt Jobs** | producthunt.com/jobs | Consumer + dev tool startups | Good for finding trendy early stage companies |

---

### Finance / Quant

| Board | URL | Specialty | When to Use |
|---|---|---|---|
| **eFinancialCareers** | efinancialcareers.com | Finance, quant, fintech | Best board for quant finance, algo trading, fintech data science |
| **Wall Street Oasis** | wallstreetoasis.com/jobs | Finance, investment banking, quant | Community + jobs, good for finance-adjacent data roles |
| **QuantConnect** | quantconnect.com/jobs | Quant trading, algo finance | If interested in quantitative/algorithmic finance roles |

---

### Niche / Community

| Board | URL | Specialty | When to Use |
|---|---|---|---|
| **AIJobs.net** | aijobs.net | AI/ML specific job board | Good supplement for AI engineering roles |
| **MLJobs.io** | mljobs.io | ML engineering specific | Niche but focused on ML practitioners |
| **Kaggle Jobs** | kaggle.com/jobs | Data science, ML, AI | Competitions community + jobs, good company overlap |
| **Web3.career** | web3.career | Crypto/Web3/blockchain | If interested in blockchain/DeFi tech roles |
| **CryptoJobsList** | cryptojobslist.com | Web3/crypto | Similar to Web3.career |
| **Idealist** | idealist.org | Nonprofits, mission-driven orgs | Good for biotech/health nonprofits (Chan Zuckerberg Initiative, etc.) |
| **Blind Jobs** | teamblind.com | Anonymous community + job postings | Good for salary info + finding hidden job postings |
| **Reddit** | reddit.com | Multiple subreddits | r/cscareerquestions, r/datascience, r/MachineLearning, r/bioinformatics — job posts and referral threads |

---

## Quick Reference — What to Check When

| Situation | Where to Look |
|---|---|
| Broad search, don't know where to start | LinkedIn → Indeed → Google Jobs |
| Specifically want pharma/biotech with data/tech skills | BioSpace → Nature Careers → Science Careers → HIMSS |
| Want a startup job | Wellfound → YC Board → a16z Jobs → HN Who's Hiring |
| Want remote only | RemoteOK → We Work Remotely → Remotive → Himalayas |
| University/campus specific roles | Handshake (use SBU email) → RippleMatch → Jumpstart |
| Government / NIH / national lab | USAJobs → NIH Jobs → individual lab career pages |
| High-paying big tech | Levels.fyi → Dice → Hired |
| Quant / finance adjacent | eFinancialCareers → Wall Street Oasis |
| AI/ML startups specifically | Ashby board (automated) → Sequoia Jobs → a16z Jobs |
| New grad curated list | Simplify GitHub → Pitt CSC GitHub → newgrad-jobs.com |

---

*Last updated: August 2026*
*Automated sources are scraped by the Atriveo scraper. Manual sources require direct visits.*
