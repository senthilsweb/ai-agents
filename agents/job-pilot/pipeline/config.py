"""Config loading: job-pilot's own config.yaml plus the owner's targets
from job-scout's config.yaml (single source of truth, never duplicated)."""
import logging
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
log = logging.getLogger("job_pilot.config")


def load_config(path: Path | None = None) -> dict:
    cfg_path = path or ROOT / "config.yaml"
    cfg = yaml.safe_load(cfg_path.read_text())
    targets_path = (cfg_path.parent / cfg["filter"]["targets_config"]).resolve()
    scout = yaml.safe_load(targets_path.read_text())
    targets = scout["targets"]
    cfg["filter"]["title_keywords"] = targets["title_keywords"]
    cfg["filter"]["base_salary_min_usd"] = targets["base_salary_min_usd"]
    # company -> board slug, needed to harvest JD text at match time
    cfg["slugs"] = scout["search"]["ats_org_slugs_by_company"]
    log.info("config: %d title keywords, salary floor %s, categories %s",
             len(cfg["filter"]["title_keywords"]),
             cfg["filter"]["base_salary_min_usd"],
             cfg["filter"]["categories"])
    return cfg
