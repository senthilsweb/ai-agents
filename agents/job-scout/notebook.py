import marimo

__generated_with = "0.10.0"
app = marimo.App(width="medium")


@app.cell
def _():
    import marimo as mo
    import duckdb
    import yaml
    import os
    import pandas as pd
    from pathlib import Path
    from datetime import date

    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass  # .env optional; only needed for agentic mode

    return mo, duckdb, yaml, os, pd, Path, date


@app.cell
def _(mo, yaml, Path):
    # ── Configuration ────────────────────────────────────────────────
    CONFIG_PATH = Path(__file__).parent / "config.yaml" if "__file__" in dir() else Path("config.yaml")
    cfg = yaml.safe_load(CONFIG_PATH.read_text())

    import logging
    from datetime import datetime
    log_dir = Path(cfg.get("logging", {}).get("dir", "logs")); log_dir.mkdir(exist_ok=True)
    log_file = log_dir / f"run_{datetime.now():%Y%m%d_%H%M%S}.log"
    logging.basicConfig(
        level=getattr(logging, cfg.get("logging", {}).get("level", "INFO")),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
        handlers=[logging.FileHandler(log_file), logging.StreamHandler()], force=True)
    logger = logging.getLogger("job-scout")
    logger.info("run started | config=%s | log=%s", CONFIG_PATH, log_file)
    mo.md(f"**Config loaded** — targets: base ≥ ${cfg['targets']['base_salary_min_usd']:,}, "
          f"OTE ${cfg['targets']['ote_min_usd']:,}–{cfg['targets']['ote_max_usd']:,}")
    return cfg, CONFIG_PATH, logger


@app.cell
def _(duckdb, cfg, Path, logger):
    # ── Database: idempotent schema (mirrors openspec/specs/data-model) ─
    db_path = Path(cfg["database"]["path"])
    con = duckdb.connect(str(db_path))

    DDL = """
    CREATE TABLE IF NOT EXISTS company (
      company_id INTEGER PRIMARY KEY, name VARCHAR NOT NULL UNIQUE,
      careers_url VARCHAR, ats_platform VARCHAR, industry VARCHAR,
      company_stage VARCHAR, classification VARCHAR, pipeline_status VARCHAR DEFAULT 'not_started',
      latest_round VARCHAR, latest_round_usd BIGINT, latest_round_date DATE,
      total_raised_usd BIGINT, hq_location VARCHAR, notes VARCHAR);

    CREATE TABLE IF NOT EXISTS job_posting (
      job_id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES company(company_id),
      title VARCHAR NOT NULL, team VARCHAR, level VARCHAR, role_family VARCHAR,
      location VARCHAR, work_mode VARCHAR, req_id VARCHAR, req_id_type VARCHAR,
      apply_url VARCHAR, source_url VARCHAR, posted_date DATE, posted_recency VARCHAR,
      app_deadline DATE, status VARCHAR DEFAULT 'open', visa_sponsorship VARCHAR DEFAULT 'verify',
      first_seen DATE, last_verified DATE);

    CREATE TABLE IF NOT EXISTS compensation (
      job_id INTEGER PRIMARY KEY REFERENCES job_posting(job_id),
      currency VARCHAR DEFAULT 'USD', base_min INTEGER, base_max INTEGER,
      ote_min INTEGER, ote_max INTEGER, equity BOOLEAN, bonus BOOLEAN, comp_notes VARCHAR);

    CREATE TABLE IF NOT EXISTS fit_assessment (
      job_id INTEGER PRIMARY KEY REFERENCES job_posting(job_id),
      priority_rank INTEGER, meets_base_bar BOOLEAN, meets_ote_bar BOOLEAN,
      domain_fit VARCHAR, domain_score DOUBLE, location_factor DOUBLE, hls_relevant BOOLEAN,
      location_fit BOOLEAN);

    CREATE TABLE IF NOT EXISTS conference (
      conference_id INTEGER PRIMARY KEY, name VARCHAR NOT NULL, organizer VARCHAR,
      start_date DATE, end_date DATE, location VARCHAR, url VARCHAR);

    CREATE TABLE IF NOT EXISTS sponsorship (
      conference_id INTEGER REFERENCES conference(conference_id),
      company_id INTEGER REFERENCES company(company_id),
      tier VARCHAR, verified_source VARCHAR,
      PRIMARY KEY (conference_id, company_id));

    CREATE TABLE IF NOT EXISTS contact (
      contact_id INTEGER PRIMARY KEY, company_id INTEGER REFERENCES company(company_id),
      name VARCHAR, role VARCHAR, relationship VARCHAR,
      linkedin_url VARCHAR, email VARCHAR, phone VARCHAR, source VARCHAR, notes VARCHAR);

    CREATE TABLE IF NOT EXISTS referral (
      referral_id INTEGER PRIMARY KEY, job_id INTEGER REFERENCES job_posting(job_id),
      contact_id INTEGER, referrer_name VARCHAR, referrer_contact VARCHAR,
      relationship VARCHAR, status VARCHAR DEFAULT 'identified',
      date_requested DATE, notes VARCHAR);

    CREATE TABLE IF NOT EXISTS crawl_log (
      query_hash VARCHAR PRIMARY KEY, company VARCHAR, query TEXT,
      crawled_at TIMESTAMP, result_note VARCHAR);
    """
    for stmt in DDL.split(";"):
        if stmt.strip():
            con.execute(stmt)
    logger.info("schema ensured | db=%s", db_path)
    return con, db_path


@app.cell
def _(mo, cfg):
    # ── Reactive scoring controls (defaults from config.yaml) ───────
    w = cfg["scoring"]["weights"]
    w_domain = mo.ui.slider(0.0, 1.0, step=0.05, value=w["domain_fit"], label="Weight: domain fit")
    w_comp = mo.ui.slider(0.0, 1.0, step=0.05, value=w["compensation"], label="Weight: compensation")
    w_hls = mo.ui.slider(0.0, 1.0, step=0.05, value=w["hls_bonus"], label="Weight: HLS bonus")
    loc_penalty = mo.ui.slider(0.1, 1.0, step=0.05,
                               value=cfg["scoring"]["location_penalty_out_of_state"],
                               label="Out-of-state factor")
    visa_gate = mo.ui.checkbox(value=cfg["scoring"]["visa_gate"], label="Visa gate (no-sponsorship → 0)")
    mo.vstack([w_domain, w_comp, w_hls, loc_penalty, visa_gate])
    return w_domain, w_comp, w_hls, loc_penalty, visa_gate


@app.cell
def _(con, cfg, w_domain, w_comp, w_hls, loc_penalty, visa_gate, mo):
    # ── Deterministic scoring view — reruns on any slider change ────
    total = w_domain.value + w_comp.value + w_hls.value
    norm = cfg["scoring"]["comp_norm_divisor_usd"]
    visa_expr = ("CASE WHEN j.visa_sponsorship='no' THEN 0.0 ELSE 1.0 END"
                 if visa_gate.value else "1.0")

    con.execute(f"""
    CREATE OR REPLACE VIEW v_jobs_ranked AS
    WITH scored AS (
      SELECT j.job_id, c.name AS company, c.classification, j.title, j.req_id,
             j.location, j.work_mode, j.status, j.visa_sponsorship, j.apply_url,
             j.app_deadline, comp.base_min, comp.base_max,
             COALESCE(f.domain_score, 0.5) AS domain_score,
             COALESCE(f.location_factor, {loc_penalty.value}) AS location_factor,
             COALESCE(f.hls_relevant, FALSE) AS hls_relevant,
             LEAST(1.0, ((COALESCE(comp.base_min,0)+COALESCE(comp.base_max,0))/2.0)/{norm}) AS comp_score,
             {visa_expr} AS visa_factor
      FROM job_posting j JOIN company c USING (company_id)
      LEFT JOIN compensation comp USING (job_id)
      LEFT JOIN fit_assessment f USING (job_id))
    SELECT *,
      ROUND(({w_domain.value}*domain_score + {w_comp.value}*comp_score
             + {w_hls.value}*CASE WHEN hls_relevant THEN 1 ELSE 0 END)
            / {max(total, 1e-9)} * location_factor * visa_factor, 3) AS match_score,
      RANK() OVER (ORDER BY CASE WHEN status='open' THEN 0 ELSE 1 END,
                   ({w_domain.value}*domain_score + {w_comp.value}*comp_score
                    + {w_hls.value}*CASE WHEN hls_relevant THEN 1 ELSE 0 END)
                   * location_factor * visa_factor DESC) AS rank
    FROM scored ORDER BY rank
    """)
    ranked = con.execute("SELECT rank, company, title, req_id, location, base_min, base_max, "
                         "visa_sponsorship, status, match_score FROM v_jobs_ranked").fetchdf()
    weight_warning = "" if abs(total - 1.0) < 1e-9 else f" ⚠️ weights sum to {total:.2f}; scores auto-normalized"
    mo.vstack([mo.md(f"### Ranked board{weight_warning}"), mo.ui.table(ranked, selection=None)])
    return ranked,


@app.cell
def _(con, cfg, ranked, Path, mo, logger):
    # ── Exports: CSV + Parquet, per spec job-tracker-exports ────────
    out = Path(cfg["database"]["export_dir"]); out.mkdir(exist_ok=True)
    con.execute(f"COPY (SELECT * FROM v_jobs_ranked) TO '{out}/all_job_postings.csv' (HEADER)")
    con.execute(f"COPY (SELECT * FROM v_jobs_ranked) TO '{out}/all_job_postings.parquet' (FORMAT PARQUET)")
    for co in ranked["company"].unique():
        safe = co.lower().replace(" ", "_").replace("+", "and")
        con.execute(f"COPY (SELECT * FROM v_jobs_ranked WHERE company='{co}') "
                    f"TO '{out}/{safe}_job_postings.csv' (HEADER)")
    logger.info("exported %d rows to %s", len(ranked), out)
    mo.md(f"Exported {len(ranked)} rows → `{out}/` (all + per-company CSVs, parquet)")
    return out,


@app.cell
def _(cfg, con, mo, logger):
    # ── Deterministic search-plan generator ──────────────────────────
    # Emits the exact queries a human (or agent) should run next,
    # driven purely by config + pipeline_status. No LLM required.
    todo = con.execute("""
        SELECT name, ats_platform FROM company
        WHERE pipeline_status IN ('not_started','alert_target') ORDER BY name
    """).fetchall()
    plans = []
    for name, ats in todo:
        ats_domain = cfg["search"]["ats_domains"].get(ats or "", "")
        for kw in cfg["targets"]["title_keywords"]:
            for tpl in cfg["search"]["query_templates"]:
                if "{ats_domain}" in tpl and not ats_domain:
                    continue
                plans.append({"company": name,
                              "query": tpl.format(company=name, keyword=kw, ats_domain=ats_domain)})

    # Crawl-ledger dedup: skip queries already run within the TTL window.
    # Re-runs are therefore incremental by default; expired entries re-crawl.
    import hashlib
    ttl = cfg["search"].get("recrawl_ttl_days", 7)
    recent = {r[0] for r in con.execute(
        f"SELECT query_hash FROM crawl_log WHERE crawled_at > now() - INTERVAL {ttl} DAY").fetchall()}
    skipped = 0
    fresh_plans = []
    for p in plans:
        h = hashlib.sha256(p["query"].lower().encode()).hexdigest()[:16]
        if h in recent:
            skipped += 1
        else:
            fresh_plans.append({**p, "query_hash": h})
    plans = fresh_plans
    logger.info("search plan | fresh=%d skipped=%d ttl_days=%s companies=%d",
                len(plans), skipped, ttl, len(todo))
    mo.vstack([mo.md(f"### Search plan — {len(plans)} fresh queries "
                     f"({skipped} skipped, within {ttl}-day TTL) across {len(todo)} companies"),
               mo.ui.table(plans[:50], selection=None)])
    return plans,


@app.cell
def _(cfg, os, mo, plans, con, Path, logger):
    # ── Agentic layer (optional): Claude executes the search plan ───
    # Deterministic-first per AI-DLC: the model only coordinates;
    # typed queries come from config, results must pass verification
    # before insert (verify_before_insert). Enable via .env + config.
    if not (cfg["agentic"]["enabled"] and os.getenv("ANTHROPIC_API_KEY")):
        _out = mo.md("_Agentic mode off. Set `agentic.enabled: true` in config.yaml "
                     "and `ANTHROPIC_API_KEY` in `.env` to let Claude execute the search plan._")
    else:
        import anthropic
        client = anthropic.Anthropic()
        batch = plans[: cfg["agentic"]["max_searches_per_run"]]
        prompts_dir = Path(cfg["agentic"].get("prompts_dir", "prompts"))
        system_prompt = (prompts_dir / "system.md").read_text()
        resume_path = Path(cfg["candidate"]["resume_path"])
        if resume_path.exists() and resume_path.suffix == ".md":
            system_prompt += "\n\n<candidate_resume>\n" + resume_path.read_text() + "\n</candidate_resume>"
        msg = client.messages.create(
            model=cfg["agentic"]["model"],
            max_tokens=4000,
            system=system_prompt,
            tools=[{"type": "web_search_20250305", "name": "web_search"}],
            messages=[{"role": "user", "content":
                       "Execute these job-search queries and return, as a JSON array, "
                       "rows matching the job_posting schema (title, company, req_id, "
                       "location, base_min, base_max, apply_url, posted_recency, "
                       "visa_sponsorship). Only include postings you verified as open. "
                       f"Queries: {[p['query'] for p in batch]}"}],
        )
        logger.info("agentic run | model=%s queries=%d", cfg["agentic"]["model"], len(batch))
        for p in batch:
            con.execute("INSERT OR REPLACE INTO crawl_log VALUES (?,?,?,now(),?)",
                        [p["query_hash"], p["company"], p["query"], "agentic run"])
        _out = mo.md("```json\n" + "".join(
            b.text for b in msg.content if getattr(b, "type", "") == "text") + "\n```")
    _out
    return


if __name__ == "__main__":
    app.run()
