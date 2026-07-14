"""Analyze open postings through the deployed agent-job-matcher API.

Spec: openspec/changes/api-match-report/specs/match-sweep/spec.md

Selection is hash-driven (design D4): an open posting is analyzed when
it has no api_match_result row or its freshly harvested JD text hash
differs from the stored one. Running the sweep twice in a row makes
zero /analyze calls the second time.

JD text travels through the deployed services (design D3): the ATS
JSON APIs give the full description (posting pages are JS shells the
API's fetcher correctly rejects); each JD is uploaded via the
agent-service /upload endpoint and its server-side path is passed to
POST /analyze together with the configured resume.

Usage:
    python tools/match_sweep.py                    # sweep new/changed
    python tools/match_sweep.py --dry-run          # show selection only
    python tools/match_sweep.py --backfill exports/jobmatch-20260713/all_reports.json
"""
import argparse
import hashlib
import json
import logging
import mimetypes
import re
import ssl
import sys
import time
import urllib.request
import uuid
from datetime import date
from pathlib import Path

import duckdb
import yaml

try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    _SSL_CTX = None

ROOT = Path(__file__).resolve().parent.parent
log = logging.getLogger("match_sweep")
UA = {"User-Agent": "job-scout/1.0 (personal job search; contact in repo)"}

DDL = """CREATE TABLE IF NOT EXISTS api_match_result (
    job_id INTEGER PRIMARY KEY,
    total_score INTEGER,
    required_skills_score INTEGER,
    preferred_skills_score INTEGER,
    experience_score INTEGER,
    domain_score INTEGER,
    match_status VARCHAR,
    run_id VARCHAR,
    jd_sha256 VARCHAR,
    first_analyzed DATE,
    last_analyzed DATE,
    report_json_path VARCHAR
)"""


# ── config / db ──────────────────────────────────────────────────────
def load_config() -> dict:
    return yaml.safe_load((ROOT / "config.yaml").read_text())


def connect(cfg: dict):
    con = duckdb.connect(str(ROOT / cfg["database"]["path"]))
    con.execute(DDL)
    return con


# ── JD harvest (same text format the 2026-07-13 run hashed) ─────────
def _get_json(url: str) -> dict:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA),
                                timeout=30, context=_SSL_CTX) as r:
        return json.load(r)


def html_to_text(html: str) -> str:
    text = re.sub(r"<(br|/p|/div|/li|/h[1-6])[^>]*>", "\n", html or "", flags=re.I)
    text = re.sub(r"<li[^>]*>", "- ", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&amp;", "&").replace("&nbsp;", " ").replace("&#39;", "'") \
               .replace("&quot;", '"').replace("&lt;", "<").replace("&gt;", ">")
    return re.sub(r"[ \t]+", " ", re.sub(r"\n{3,}", "\n\n", text)).strip()


def _ashby_descriptions(slug_overrides: dict) -> dict:
    """One board call per configured Ashby org: req_id (uuid) -> (job, comp)."""
    from tools.ats_fetch import _resolve_slugs
    out = {}
    for _name, (platform, slug) in _resolve_slugs(slug_overrides).items():
        if platform != "ashby":
            continue
        try:
            d = _get_json(f"https://api.ashbyhq.com/posting-api/job-board/{slug}"
                          "?includeCompensation=true")
        except Exception as e:
            log.error("ashby board fetch failed for %s: %s", slug, e)
            continue
        for j in d.get("jobs", []):
            comp = (j.get("compensation") or {}).get("compensationTierSummary") or ""
            out[j["id"]] = (j, comp)
    return out


def _workday_description(apply_url: str) -> str | None:
    m = re.match(r"https://([^.]+)\.([^.]+)\.myworkdayjobs\.com/en-US/([^/]+)(/.*)",
                 apply_url or "")
    if not m:
        return None
    tenant, host, site, path = m.groups()
    d = _get_json(f"https://{tenant}.{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{path}")
    return html_to_text((d.get("jobPostingInfo") or {}).get("jobDescription") or "")


def jd_filename(company: str, title: str, job_id: int) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", f"{company} {title}".lower()).strip("-")
    return f"{job_id:03d}-{slug}"[:120] + ".txt"


def harvest_jds(con, cfg: dict) -> tuple[list[dict], list[tuple]]:
    """Build JD text for every open posting. Returns (harvested, missing)."""
    rows = con.execute("""
        SELECT jp.job_id, co.name, co.ats_platform, jp.title, jp.location,
               jp.req_id, jp.apply_url
        FROM job_posting jp JOIN company co USING(company_id)
        WHERE jp.status = 'open' ORDER BY jp.job_id""").fetchall()
    ashby = _ashby_descriptions(cfg["search"].get("ats_org_slugs_by_company") or {})
    harvested, missing = [], []
    for job_id, company, ats, title, location, req_id, apply_url in rows:
        body, comp = None, ""
        try:
            if ats == "ashby":
                hit = ashby.get(req_id)
                if hit:
                    j, comp = hit
                    body = html_to_text(j.get("descriptionHtml") or "") or \
                        (j.get("descriptionPlain") or "")
            elif ats == "workday":
                body = _workday_description(apply_url)
        except Exception as e:
            log.warning("harvest failed job_id=%d (%s): %s", job_id, title, e)
        if not body or len(body.split()) < 60:
            missing.append((job_id, company, title))
            continue
        header = (f"Company: {company}\nJob Title: {title}\nLocation: {location or 'n/a'}\n"
                  + (f"Compensation: {comp}\n" if comp else "")
                  + f"Posting URL: {apply_url}\n\n")
        text = header + body
        harvested.append({
            "job_id": job_id, "company": company, "title": title,
            "location": location, "apply_url": apply_url,
            "file": jd_filename(company, title, job_id),
            "text": text, "jd_sha256": hashlib.sha256(text.encode()).hexdigest(),
        })
    return harvested, missing


# ── HTTP: stdlib multipart (no curl, no new deps) ────────────────────
def _multipart(fields: list[tuple[str, str]],
               files: list[tuple[str, str, bytes, str]]) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    out = bytearray()
    for name, value in fields:
        out += (f"--{boundary}\r\nContent-Disposition: form-data; "
                f'name="{name}"\r\n\r\n{value}\r\n').encode()
    for name, filename, content, ctype in files:
        out += (f"--{boundary}\r\nContent-Disposition: form-data; "
                f'name="{name}"; filename="{filename}"\r\n'
                f"Content-Type: {ctype}\r\n\r\n").encode()
        out += content + b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"


def _post_multipart(url: str, fields, files, timeout: int):
    body, ctype = _multipart(fields, files)
    req = urllib.request.Request(url, data=body,
                                 headers={**UA, "Content-Type": ctype})
    with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as r:
        return json.load(r)


def upload_jd(agent_base: str, filename: str, text: str) -> str:
    r = _post_multipart(f"{agent_base}/upload", [],
                        [("file", filename, text.encode(), "text/plain")], 60)
    if "path" not in r:
        raise RuntimeError(f"upload rejected: {r}")
    return r["path"]


def analyze_batch(api_base: str, resume_path: str, server_paths: list[str]) -> list[dict]:
    resume = (ROOT / resume_path).resolve() if not Path(resume_path).is_absolute() \
        else Path(resume_path)
    ctype = mimetypes.guess_type(resume.name)[0] or "application/octet-stream"
    fields = [("jobs", p) for p in server_paths]
    files = [("resume", resume.name, resume.read_bytes(), ctype)]
    return _post_multipart(f"{api_base}/analyze", fields, files, 600)


# ── persistence ──────────────────────────────────────────────────────
def upsert_result(con, job_id: int, rep: dict, jd_sha256: str | None,
                  report_json_path: str, analyzed_on: date | None = None) -> None:
    """analyzed_on is the LOCAL run date (spec: the NEW badge follows the run
    date). The API's generated_at is UTC and straddles local midnight — it
    stays available in the persisted JSON, never in these date columns."""
    sb = rep["score_breakdown"]
    analyzed = (analyzed_on or date.today()).isoformat()
    prior = con.execute("SELECT first_analyzed FROM api_match_result WHERE job_id=?",
                        [job_id]).fetchone()
    first = prior[0] if prior else analyzed
    con.execute("""INSERT OR REPLACE INTO api_match_result VALUES
        (?,?,?,?,?,?,?,?,?,?,?,?)""",
        [job_id, sb["total_score"], sb["required_skills_score"],
         sb["preferred_skills_score"], sb["experience_score"], sb["domain_score"],
         rep["match_status"], rep.get("run_id"), jd_sha256, first, analyzed,
         report_json_path])


def collect_entries(con) -> list[dict]:
    """Enriched entries (renderer input contract) for ALL analyzed jobs."""
    rows = con.execute("""
        SELECT r.job_id, co.name, jp.title, jp.location, jp.apply_url,
               r.report_json_path, r.first_analyzed
        FROM api_match_result r
        JOIN job_posting jp USING(job_id)
        JOIN company co ON co.company_id = jp.company_id
        ORDER BY r.job_id""").fetchall()
    entries = []
    for job_id, company, title, location, apply_url, path, first in rows:
        p = Path(path) if path else None
        if not p or not p.is_file():
            log.warning("report JSON missing for job_id=%d (%s)", job_id, path)
            continue
        entries.append({"job_id": job_id, "company": company, "title": title,
                        "location": location, "apply_url": apply_url,
                        "first_analyzed": str(first),
                        "report": json.loads(p.read_text())})
    return entries


# ── sweep / backfill ─────────────────────────────────────────────────
def run_dir(cfg: dict, day: date | None = None) -> Path:
    d = ROOT / cfg["matcher"].get("export_dir", cfg["database"]["export_dir"])
    return d / f"jobmatch-{(day or date.today()):%Y%m%d}"


def sweep(cfg: dict, con, dry_run: bool = False) -> dict:
    m = cfg["matcher"]
    harvested, missing = harvest_jds(con, cfg)
    stored = dict(con.execute(
        "SELECT job_id, jd_sha256 FROM api_match_result").fetchall())
    selected = [h for h in harvested
                if h["job_id"] not in stored or stored[h["job_id"]] != h["jd_sha256"]]
    log.info("open harvested=%d unharvestable=%d selected=%d",
             len(harvested), len(missing), len(selected))
    for job_id, company, title in missing:
        log.warning("unharvestable (closed on board?): job_id=%d %s — %s",
                    job_id, company, title)
    if dry_run or not selected:
        return {"harvested": len(harvested), "missing": len(missing),
                "selected": len(selected), "analyzed": 0, "failed": 0}

    day_dir = run_dir(cfg)
    jd_dir, rep_dir = day_dir / "jd", day_dir / "reports"
    jd_dir.mkdir(parents=True, exist_ok=True)
    rep_dir.mkdir(parents=True, exist_ok=True)
    for h in selected:  # JD text persisted BEFORE any API call (design D4)
        (jd_dir / h["file"]).write_text(h["text"])
        h["server_path"] = upload_jd(m["agent_base"], h["file"], h["text"])

    analyzed = failed = 0
    batch_size = int(m.get("batch_size", 3))
    for i in range(0, len(selected), batch_size):
        batch = selected[i:i + batch_size]
        arr = None
        for attempt in (1, 2):  # one retry, transport errors only
            try:
                arr = analyze_batch(m["api_base"], m["resume_path"],
                                    [h["server_path"] for h in batch])
                break
            except Exception as e:
                log.warning("batch %d attempt %d failed: %s", i // batch_size + 1, attempt, e)
                time.sleep(5)
        if arr is None:
            failed += len(batch)
            continue
        by_source = {r.get("job_source", ""): r for r in arr}
        for h in batch:
            rep = by_source.get(h["server_path"])
            if not rep:
                failed += 1
                log.error("no report returned for job_id=%d %s", h["job_id"], h["title"])
                continue
            out = rep_dir / (Path(h["file"]).stem + ".json")
            out.write_text(json.dumps(rep, indent=1))
            if rep.get("fetch_status") == "ok":
                upsert_result(con, h["job_id"], rep, h["jd_sha256"], str(out))
                analyzed += 1
            else:
                failed += 1
                log.error("analyze failed job_id=%d: %s", h["job_id"], rep.get("reason"))
        log.info("batch %d/%d done — analyzed=%d failed=%d",
                 i // batch_size + 1, (len(selected) + batch_size - 1) // batch_size,
                 analyzed, failed)
    return {"harvested": len(harvested), "missing": len(missing),
            "selected": len(selected), "analyzed": analyzed, "failed": failed}


def backfill(cfg: dict, con, path: Path) -> int:
    """Seed api_match_result from an existing enriched result file. No API calls.

    The analyzed date comes from the run directory name (jobmatch-YYYYMMDD)
    when the file lives in one, else today — same local-date rule as sweep."""
    entries = json.loads(path.read_text())
    base = path.resolve().parent
    m = re.fullmatch(r"jobmatch-(\d{4})(\d{2})(\d{2})", base.name)
    run_day = date(int(m[1]), int(m[2]), int(m[3])) if m else date.today()
    seeded = 0
    for e in entries:
        rep = e.get("report") or {}
        if rep.get("fetch_status") != "ok" or "job_id" not in e:
            continue
        jd = base / "jd" / e["file"] if e.get("file") else None
        sha = hashlib.sha256(jd.read_bytes()).hexdigest() if jd and jd.is_file() else None
        rep_path = base / "reports" / (Path(e["file"]).stem + ".json")
        if not rep_path.is_file():
            rep_path.parent.mkdir(parents=True, exist_ok=True)
            rep_path.write_text(json.dumps(rep, indent=1))
        upsert_result(con, e["job_id"], rep, sha, str(rep_path), analyzed_on=run_day)
        seeded += 1
    log.info("backfilled %d rows from %s", seeded, path)
    return seeded


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--backfill", metavar="JSON", help="seed api_match_result from an "
                   "existing enriched result file (zero API calls)")
    p.add_argument("--dry-run", action="store_true", help="show selection, call nothing")
    args = p.parse_args()

    cfg = load_config()
    logging.basicConfig(level=cfg["logging"].get("level", "INFO"),
                        format="%(asctime)s %(name)s %(levelname)s %(message)s")
    con = connect(cfg)
    try:
        if args.backfill:
            n = backfill(cfg, con, Path(args.backfill))
            print(f"backfilled {n} rows")
            return 0
        stats = sweep(cfg, con, dry_run=args.dry_run)
        print(json.dumps(stats))
        return 0 if stats["failed"] == 0 else 1
    finally:
        con.close()


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    sys.exit(main())
