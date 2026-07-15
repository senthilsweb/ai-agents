"""Shared fixtures: tiny parquet snapshots written with DuckDB itself."""
from pathlib import Path

import duckdb
import pytest

# (company_name, req_id, title, category, base_max_usd)
DAY1 = [
    ("Snowflake", "R1", "Senior Engineering Manager, Data Platform", "Engineering & Tech", 260000),
    ("OpenAI",    "R2", "Account Executive",                          "Sales & GTM",        None),
    ("Ramp",      "R3", "Staff Backend Engineer",                     "Engineering & Tech", 240000),
]
# Day 2: R3 removed, R1/R2 unchanged, three rows added.
DAY2 = DAY1[:2] + [
    ("Harvey",  "R10", "Forward Deployed Engineering Manager", "Sales & GTM",        280000),
    ("Notion",  "R11", "Product Manager, AI",                   "Product",            230000),
    ("Linear",  "R12", "Engineering Manager",                   "Engineering & Tech", 180000),
]


def write_snapshot(path: Path, rows: list[tuple]) -> str:
    con = duckdb.connect()
    con.execute("""
        CREATE TABLE snap (
            company_name VARCHAR, ats_platform VARCHAR, req_id VARCHAR,
            title VARCHAR, department VARCHAR, employment_type VARCHAR,
            location VARCHAR, work_mode VARCHAR, comp_summary VARCHAR,
            posted_date DATE, apply_url VARCHAR, category VARCHAR,
            base_min_usd INTEGER, base_max_usd INTEGER)
    """)
    for company, req, title, cat, base_max in rows:
        con.execute(
            "INSERT INTO snap VALUES (?, 'ashby', ?, ?, NULL, 'FullTime', "
            "'Remote US', 'remote', NULL, DATE '2026-07-14', "
            "'https://example.com/apply', ?, NULL, ?)",
            [company, req, title, cat, base_max])
    con.execute(f"COPY snap TO '{path}' (FORMAT PARQUET)")
    con.close()
    return str(path)


@pytest.fixture
def snapshots(tmp_path):
    day1 = write_snapshot(tmp_path / "day1.parquet", DAY1)
    day2 = write_snapshot(tmp_path / "day2.parquet", DAY2)
    return day1, day2


@pytest.fixture
def flt():
    """Filter config as pipeline.config.load_config assembles it."""
    return {
        "categories": ["Engineering & Tech", "Product", "Sales & GTM"],
        "title_keywords": [
            "senior engineering manager", "engineering manager",
            "product manager", "forward deployed", "applied ai",
        ],
        "base_salary_min_usd": 220000,
    }
