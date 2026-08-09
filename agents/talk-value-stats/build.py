"""Generate the static site from the JSON DB.

    python build.py            # db.json  → dist/index.html + dist/<slug>.html

No model, no network, no key — a pure function of `db.json`. Reads the DB,
validates it against the schema (fails loud on a bad entry), and renders a
mobile-first, editorial "timeline" site: a compact list view (thumbnail · title ·
author · headline stat) linking to one detail page per talk, where every metric
hangs off the talk's timeline. Bespoke CSS (see templates/base.html.j2), Google
Fonts, no framework, no build tool; the only JS is a progressive-enhancement
scroll listener that fades the title into the sticky bar. The `dist/` output is
what CI publishes to GitHub Pages.

Needs the agent installed (`pip install -e .`) for jinja2 + pyarrow.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from schema import StatsDB, thumbnail_url, ts_to_seconds, watch_url  # noqa: E402

import objstore  # noqa: E402

DEFAULT_DB = HERE / "db.json"
DIST = HERE / "dist"
TEMPLATES = HERE / "templates"

# Human labels for the mono category tag. No per-category colour — the design
# uses one accent, so a category never gets its own hue (the old rainbow-border
# look is gone by design).
CATEGORY_LABELS = {
    "productivity_gain":  "Productivity",
    "cost_savings":       "Cost savings",
    "additional_revenue": "Revenue",
    "fte_savings":        "FTE savings",
    "cycle_time":         "Cycle time",
    "quality":            "Quality",
    "scale":              "Scale",
    "other":              "Other",
}

_ARROW = {"up": "▲", "down": "▼", "neutral": "●"}


def cat(category: str) -> str:
    return CATEGORY_LABELS.get(category, "Other")


def arrow(direction: str) -> str:
    return _ARROW.get(direction, "●")


def play(size: int = 24, color: str = "#fff") -> Markup:
    return Markup(
        f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="{color}" '
        f'opacity="0.95" aria-hidden="true"><polygon points="6 3 20 12 6 21"/></svg>'
    )


def hms(seconds: int) -> str:
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def initials(name: str) -> str:
    parts = [p for p in name.split() if p]
    return (parts[0][0] + parts[-1][0]).upper() if len(parts) >= 2 else name[:2].upper()


def moments(page) -> list[dict]:
    """Unique-by-timestamp metric moments for the horizontal talk-scrubber,
    each positioned as a percentage of the video's runtime."""
    dur = page.source.durationSeconds
    if not dur:
        return []
    seen, out = set(), []
    for ex in page.examples:
        for m in ex.metrics:
            if m.timestamp and m.timestamp not in seen:
                seen.add(m.timestamp)
                s = ts_to_seconds(m.timestamp)
                out.append({
                    "t": m.timestamp,
                    "pct": round(s / dur * 100, 2),
                    "display": m.display,
                    "url": watch_url(page.source.videoId, s),
                })
    return out


def main() -> None:
    db_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DB
    # Object-store mode: render from the store's authoritative db.json
    # (add-object-store-state D3). Without the env this is a no-op.
    if objstore.configured():
        objstore.pull_db(db_path)
    pages = StatsDB.validate_python(json.loads(db_path.read_text()))
    pages.sort(key=lambda p: p.source.title.lower())

    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES)),
        autoescape=select_autoescape(["html", "j2"]),
        # Render a null field as "" instead of Jinja's default "None".
        finalize=lambda v: "" if v is None else v,
    )
    env.globals.update(
        cat=cat,
        arrow=arrow,
        play=play,
        moments=moments,
        hms=hms,
        initials=initials,
        thumb=thumbnail_url,
        watch=lambda vid, ts: watch_url(vid, ts_to_seconds(ts)),
    )

    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir(parents=True)
    (DIST / ".nojekyll").write_text("")  # GitHub Pages: serve files verbatim

    # Multipage static: a list view + one real, crawlable HTML page per talk.
    # No JS — every page is server-rendered so it's SEO- and link-preview-friendly.
    (DIST / "index.html").write_text(env.get_template("index.html.j2").render(pages=pages))
    detail = env.get_template("detail.html.j2")
    for page in pages:
        (DIST / f"{page.slug}.html").write_text(detail.render(page=page))

    print(f"✓ built {len(pages) + 1} pages → {DIST}")
    for page in pages:
        print(f"    {page.slug}.html")

    # Also publish the DuckDB-ready parquet next to the site (skip if pyarrow
    # isn't installed — HTML still builds).
    try:
        import export

        n = export.write_parquet(db_path, DIST / "stats.parquet")
        print(f"    stats.parquet ({n} metric rows)")
    except ImportError:
        print("    (pyarrow not installed — skipped stats.parquet; `pip install -e .`)")


if __name__ == "__main__":
    main()
