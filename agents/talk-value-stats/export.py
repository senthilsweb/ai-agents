"""Flatten the JSON DB into a tidy parquet table for DuckDB / analytics.

    python export.py                 # db.json → dist/stats.parquet
    python export.py db.json out.parquet

One row per METRIC, with the page / example / speaker context denormalized onto
it — the natural analytics grain ("sum of cost_savings by company", "count
metrics by category"). Every row keeps its verbatim `quote`, `timestamp`, and a
ready-made `watchUrl` deep link.

The parquet is published next to the site, so once it's on GitHub Pages it's
queryable remotely without downloading:

    duckdb -c "INSTALL httpfs; LOAD httpfs;
               SELECT company, sum(value) FILTER (category='cost_savings')
               FROM 'https://<user>.github.io/<repo>/stats.parquet' GROUP BY 1;"

Needs pyarrow (`pip install -e .`). `build.py` calls this automatically when
pyarrow is importable, and skips it otherwise.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from schema import StatsDB, ts_to_seconds, watch_url  # noqa: E402

DEFAULT_DB = HERE / "db.json"
DEFAULT_OUT = HERE / "dist" / "stats.parquet"


def flatten(pages) -> list[dict]:
    rows: list[dict] = []
    for p in pages:
        primary = p.speakers[0] if p.speakers else None
        for ei, ex in enumerate(p.examples):
            for mi, m in enumerate(ex.metrics):
                secs = ts_to_seconds(m.timestamp) if m.timestamp else None
                rows.append({
                    "videoId": p.source.videoId,
                    "slug": p.slug,
                    "title": p.source.title,
                    "channel": p.source.channel,
                    "url": p.source.url,
                    "durationSeconds": p.source.durationSeconds,
                    "publishedAt": p.source.publishedAt,
                    "extractedAt": p.extractedAt,
                    "extractedBy": p.extractedBy,
                    "primarySpeaker": primary.name if primary else None,
                    "primaryCompany": primary.company if primary else None,
                    "useCase": ex.useCase,
                    "org": ex.org,
                    "exampleSpeaker": ex.speakerName,
                    "summary": ex.summary,
                    "exampleIndex": ei,
                    "metricIndex": mi,
                    "category": m.category,
                    "label": m.label,
                    "value": float(m.value) if m.value is not None else None,
                    "unit": m.unit,
                    "display": m.display,
                    "direction": m.direction,
                    "confidence": m.confidence,
                    "quote": m.quote,
                    "timestamp": m.timestamp,
                    "timestampSeconds": secs,
                    "watchUrl": watch_url(p.source.videoId, secs) if secs is not None else p.source.url,
                })
    return rows


def _schema():
    import pyarrow as pa

    s, i, f = pa.string(), pa.int64(), pa.float64()
    return pa.schema([
        ("videoId", s), ("slug", s), ("title", s), ("channel", s), ("url", s),
        ("durationSeconds", i), ("publishedAt", s), ("extractedAt", s), ("extractedBy", s),
        ("primarySpeaker", s), ("primaryCompany", s),
        ("useCase", s), ("org", s), ("exampleSpeaker", s), ("summary", s),
        ("exampleIndex", i), ("metricIndex", i),
        ("category", s), ("label", s), ("value", f), ("unit", s), ("display", s),
        ("direction", s), ("confidence", s), ("quote", s),
        ("timestamp", s), ("timestampSeconds", i), ("watchUrl", s),
    ])


def write_parquet(db_path: Path = DEFAULT_DB, out_path: Path = DEFAULT_OUT) -> int:
    import pyarrow as pa
    import pyarrow.parquet as pq

    pages = StatsDB.validate_python(json.loads(Path(db_path).read_text()))
    rows = flatten(pages)
    table = pa.Table.from_pylist(rows, schema=_schema())
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, out_path, compression="zstd")
    return len(rows)


def main() -> None:
    db = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DB
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT
    n = write_parquet(db, out)
    print(f"✓ wrote {n} metric rows → {out}")


if __name__ == "__main__":
    main()
