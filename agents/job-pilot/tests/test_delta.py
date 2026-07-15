"""Eval 1 (design.md §Evals): the anti-join returns exactly the added rows."""
from pipeline.delta import new_jobs


def test_delta_returns_only_added_rows(snapshots):
    day1, day2 = snapshots
    got = new_jobs(latest=day2, baseline=day1)
    assert sorted(j.req_id for j in got) == ["R10", "R11", "R12"]


def test_unchanged_and_removed_rows_are_excluded(snapshots):
    day1, day2 = snapshots
    got = {j.req_id for j in new_jobs(latest=day2, baseline=day1)}
    assert "R1" not in got and "R2" not in got   # unchanged
    assert "R3" not in got                        # removed, not "new"


def test_identical_snapshots_yield_empty_delta(snapshots):
    day1, _ = snapshots
    assert new_jobs(latest=day1, baseline=day1) == []


def test_facts_survive_the_join(snapshots):
    day1, day2 = snapshots
    harvey = next(j for j in new_jobs(day2, day1) if j.company_name == "Harvey")
    assert harvey.title == "Forward Deployed Engineering Manager"
    assert harvey.category == "Sales & GTM"
    assert harvey.base_max_usd == 280000
    assert harvey.posted_date == "2026-07-14"
