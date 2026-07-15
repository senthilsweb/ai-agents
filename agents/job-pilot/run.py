"""job-pilot entrypoint: one daily run.

    python run.py [--baseline trends/YYYYMMDD] [--dry-run]

Baseline resolution order: --baseline flag, BASELINE_TAG env (set by the
CI wrapper from the last successful workflow run), else yesterday's tag.
--dry-run stops after compose and prints the email HTML path instead of
sending (no SMTP needed; /analyze still requires RUN_PAID_MATCH=1).
"""
import argparse
import logging
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent

log = logging.getLogger("job_pilot")


def setup_logging(cfg: dict) -> Path:
    log_dir = ROOT / cfg["logging"].get("dir", "./logs")
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / f"run_{datetime.now():%Y%m%d_%H%M%S}.log"
    logging.basicConfig(
        level=cfg["logging"].get("level", "INFO"),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
        handlers=[logging.StreamHandler(), logging.FileHandler(log_file)])
    return log_file


def main() -> int:
    load_dotenv(ROOT / ".env")
    import os

    from pipeline.config import load_config
    from pipeline.graph import build_graph, default_deps
    from pipeline.telemetry import flush, setup_tracer

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--baseline", default=None,
                   help="trends/YYYYMMDD tag to diff against")
    p.add_argument("--dry-run", action="store_true",
                   help="compose but do not send; writes the HTML locally")
    args = p.parse_args()

    cfg = load_config()
    log_file = setup_logging(cfg)
    tracer = setup_tracer()

    run_date = date.today().isoformat()
    baseline = (args.baseline or os.environ.get("BASELINE_TAG")
                or f"trends/{date.today() - timedelta(days=1):%Y%m%d}")
    out_dir = ROOT / "runs" / run_date.replace("-", "")
    out_dir.mkdir(parents=True, exist_ok=True)

    deps = default_deps()
    if args.dry_run:
        html_path = out_dir / "digest.html"

        def fake_send(msg, environ=None):
            html = next(part for part in msg.walk()
                        if part.get_content_type() == "text/html")
            html_path.write_text(html.get_content())
            return f"dry-run: wrote {html_path}"
        deps["send"] = fake_send

    graph = build_graph(cfg, deps=deps, tracer=tracer, out_dir=out_dir)
    log.info("run %s vs %s (log: %s)", run_date, baseline, log_file)
    try:
        final = graph.invoke({"run_date": run_date, "baseline_tag": baseline,
                              "failures": []})
    except Exception:
        log.exception("run failed")
        return 1
    finally:
        flush()

    log.info("done: %d new, %d matched, %d PDFs, %d failures — %s",
             len(final.get("new_jobs", [])), len(final.get("matches", [])),
             len(final.get("pdf_paths", [])), len(final.get("failures", [])),
             final.get("send_result"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
