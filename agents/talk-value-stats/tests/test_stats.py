"""talk-value-stats — no network, no model, no key.

Covers the committed JSON DB, the extractor's non-LLM assembly path (header
parse → VideoSource → page → upsert dedupe → re-validate), and the static build.
The one thing not covered is the live `client.messages.parse` call, which needs
a credential and tokens.
"""

import json
import sys
from datetime import date
from pathlib import Path

import pytest

AGENT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AGENT))
TRANSCRIPT = Path(__file__).resolve().parent / "fixtures" / "transcript.md"

from schema import (  # noqa: E402
    Example,
    ExtractedContent,
    Metric,
    Person,
    StatsDB,
    TranscriptStatsPage,
    thumbnail_url,
    ts_to_seconds,
    watch_url,
)


def test_committed_db_validates():
    pages = StatsDB.validate_python(json.loads((AGENT / "db.json").read_text()))
    assert len(pages) >= 1
    assert all(p.schemaVersion == 2 for p in pages)
    # every metric is grounded
    for p in pages:
        assert p.speakers, f"{p.slug} has no speakers"
        for ex in p.examples:
            for m in ex.metrics:
                assert m.quote.strip()
                assert m.display.strip()


def test_bad_timestamp_rejected():
    with pytest.raises(ValueError):
        Metric(category="quality", label="x", display="1", quote="q", timestamp="1:2")


def test_bad_slug_rejected():
    page = dict(
        schemaVersion=2, slug="Not A Slug",
        source=dict(videoId="abcdefghijk", title="t", url="https://y/watch?v=abcdefghijk"),
        speakers=[dict(name="A")], examples=[], extractedAt="2026-07-24",
    )
    with pytest.raises(ValueError):
        TranscriptStatsPage.model_validate(page)


def test_extractor_assembly_and_upsert_dedupe(tmp_path):
    import extract

    src = extract.parse_source(TRANSCRIPT.read_text())
    assert src.videoId == "gYAqupu6iNI"
    assert src.channel == "Vercel"
    assert src.durationSeconds == 1095

    content = ExtractedContent(
        headline="h",
        speakers=[Person(name="Catherine", role="EM", company="Vercel")],
        examples=[
            Example(
                useCase="Support", org="Vercel", speakerName="Catherine", summary="s",
                metrics=[Metric(category="quality", label="Resolved", value=91, unit="%",
                                display="91%", direction="up", quote="q", timestamp="00:01:03")],
            )
        ],
    )
    page = TranscriptStatsPage(
        slug=extract.slugify(src), source=src, speakers=content.speakers,
        headline=content.headline, examples=content.examples,
        extractedBy="stub", extractedAt=date(2026, 7, 24).isoformat(),
    )

    db_path = tmp_path / "db.json"
    extract.write_db(db_path, extract.upsert(extract.load_db(db_path), page))
    # upsert again with the same videoId must not duplicate
    extract.write_db(db_path, extract.upsert(extract.load_db(db_path), page))
    reloaded = StatsDB.validate_python(json.loads(db_path.read_text()))
    assert len(reloaded) == 1


def test_helpers():
    assert thumbnail_url("gYAqupu6iNI").endswith("/gYAqupu6iNI/hqdefault.jpg")
    assert ts_to_seconds("00:02:02") == 122
    assert watch_url("gYAqupu6iNI", 122).endswith("&t=122s")


def test_build_produces_dist(tmp_path):
    pytest.importorskip("jinja2")
    import build

    # render into the real dist via the module (idempotent; overwrites)
    sys.argv = ["build.py", str(AGENT / "db.json")]
    build.main()
    dist = AGENT / "dist"
    # multipage static: index + one crawlable HTML per talk (no JS)
    assert (dist / "index.html").is_file()
    index = (dist / "index.html").read_text()
    assert "The hard numbers" in index
    pages = StatsDB.validate_python(json.loads((AGENT / "db.json").read_text()))
    for p in pages:
        assert (dist / f"{p.slug}.html").is_file()   # a real page per talk
        assert f'href="./{p.slug}.html"' in index    # linked from the list


def test_parquet_export(tmp_path):
    pytest.importorskip("pyarrow")
    import export

    out = tmp_path / "stats.parquet"
    n = export.write_parquet(AGENT / "db.json", out)
    assert out.is_file() and n > 0

    pq = pytest.importorskip("pyarrow.parquet")
    table = pq.read_table(out)
    cols = set(table.column_names)
    assert {"category", "value", "quote", "watchUrl", "primaryCompany"} <= cols
    # one row per metric across the whole DB
    pages = StatsDB.validate_python(json.loads((AGENT / "db.json").read_text()))
    assert n == sum(len(e.metrics) for p in pages for e in p.examples)
