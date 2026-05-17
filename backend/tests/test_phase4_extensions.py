"""
Phase 4 Extensions Backend Tests

Covers:
 - GET /api/analytics/admin/rollup (matrix + fy + benchmarks + orphan cells)
 - GET /api/analytics/admin/coverage-gaps (missing_sup/asup/ro with severity)
 - Updated /api/analytics/approving-supervisor/{id}/performance-summary
   (benchmark + zero_defect + department_id)
 - Updated /api/analytics/reporting-officer/{id}/performance-summary (same enrichment)
 - Regression: /api/analytics/supervisor/{id}/performance still works
"""
import os
import re
from datetime import datetime

import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://asset-health-hub-1.preview.emergentagent.com").rstrip("/")

SA_CREDS = {"employee_id": "SA001", "password": "admin123"}
SUP_CREDS = {"employee_id": "SSE001", "password": "admin123"}
ASUP_CREDS = {"employee_id": "ASUP001", "password": "admin123"}
RO_CREDS = {"employee_id": "DRO EL", "password": "admin123"}


# ────────────────────────────────────────────────────────────────────────
# Fixtures
# ────────────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def tokens():
    out = {}
    for k, creds in [
        ("sa", SA_CREDS), ("sup", SUP_CREDS),
        ("asup", ASUP_CREDS), ("ro", RO_CREDS),
    ]:
        r = requests.post(f"{BASE_URL}/api/auth/login", json=creds)
        assert r.status_code == 200, f"{k} login failed: {r.text}"
        out[f"{k}_token"] = r.json()["token"]
        out[f"{k}_id"] = r.json()["user"]["_id"]
    return out


@pytest.fixture(scope="module")
def rollup(tokens):
    r = requests.get(
        f"{BASE_URL}/api/analytics/admin/rollup",
        headers={"Authorization": f"Bearer {tokens['sa_token']}"},
    )
    assert r.status_code == 200, f"rollup failed: {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def coverage(tokens):
    r = requests.get(
        f"{BASE_URL}/api/analytics/admin/coverage-gaps",
        headers={"Authorization": f"Bearer {tokens['sa_token']}"},
    )
    assert r.status_code == 200, f"coverage-gaps failed: {r.text}"
    return r.json()


# ────────────────────────────────────────────────────────────────────────
# /admin/rollup tests
# ────────────────────────────────────────────────────────────────────────
class TestAdminRollup:
    def test_top_level_shape(self, rollup):
        for key in ("period", "fy", "stations", "departments", "matrix", "dept_benchmarks"):
            assert key in rollup, f"missing top-level key: {key}"

    def test_fy_label_is_current_indian_fy(self, rollup):
        now = datetime.utcnow()
        start_year = now.year if now.month >= 4 else now.year - 1
        expected = f"FY {start_year % 100:02d}-{(start_year + 1) % 100:02d}"
        assert rollup["fy"]["label"] == expected, (
            f"expected {expected}, got {rollup['fy']['label']}"
        )
        assert re.match(r"^FY \d{2}-\d{2}$", rollup["fy"]["label"])

    def test_fy_window_apr_to_apr(self, rollup):
        start = datetime.fromisoformat(rollup["fy"]["from"])
        end = datetime.fromisoformat(rollup["fy"]["to"])
        assert start.month == 4 and start.day == 1, f"FY start not Apr 1: {start}"
        assert end.month == 4 and end.day == 1, f"FY end not Apr 1 (exclusive): {end}"
        assert end.year == start.year + 1

    def test_matrix_dims_match_axes(self, rollup):
        rows = len(rollup["matrix"])
        assert rows == len(rollup["stations"])
        if rows:
            cols = len(rollup["matrix"][0]["cells"])
            assert cols == len(rollup["departments"])

    def test_each_row_has_cells_for_every_dept(self, rollup):
        n_depts = len(rollup["departments"])
        for row in rollup["matrix"]:
            assert "station_id" in row and "station_name" in row and "cells" in row
            assert len(row["cells"]) == n_depts

    def test_cell_schema(self, rollup):
        expected = {
            "station_id", "department_id", "sup_count", "asset_count",
            "total_defects", "avg_repair_seconds", "avg_repair_hours",
            "pct_functional", "rejection_count", "zero_defect", "is_orphan",
        }
        sample = rollup["matrix"][0]["cells"][0]
        missing = expected - set(sample.keys())
        assert not missing, f"cell missing fields: {missing}"

    def test_orphan_cells_have_is_orphan_true_and_null_pct(self, rollup):
        orphan_checked = 0
        for row in rollup["matrix"]:
            for cell in row["cells"]:
                if cell["sup_count"] == 0:
                    assert cell["is_orphan"] is True, \
                        f"sup_count=0 but is_orphan={cell['is_orphan']}"
                    assert cell["pct_functional"] is None, \
                        f"orphan pct_functional should be null, got {cell['pct_functional']}"
                    orphan_checked += 1
                else:
                    assert cell["is_orphan"] is False
        assert orphan_checked > 0, "expected at least 1 orphan cell in seed data"

    def test_non_orphan_cells_have_sup_ids(self, rollup):
        for row in rollup["matrix"]:
            for cell in row["cells"]:
                if not cell["is_orphan"]:
                    assert "sup_ids" in cell and isinstance(cell["sup_ids"], list)
                    assert len(cell["sup_ids"]) == cell["sup_count"]

    def test_dept_benchmarks_keyed_by_dept(self, rollup):
        bench = rollup["dept_benchmarks"]
        dept_ids = {d["_id"] for d in rollup["departments"]}
        for did in dept_ids:
            assert did in bench, f"missing benchmark for dept {did}"
            b = bench[did]
            assert "fy_label" in b and "fy_avg_repair_seconds" in b and "fy_avg_repair_hours" in b
            assert b["fy_label"] == rollup["fy"]["label"]

    def test_date_filter_applied(self, tokens):
        # Narrow 1-day window — period should reflect the query
        r = requests.get(
            f"{BASE_URL}/api/analytics/admin/rollup",
            params={"from_date": "2026-01-01T00:00:00", "to_date": "2026-01-02T00:00:00"},
            headers={"Authorization": f"Bearer {tokens['sa_token']}"},
        )
        assert r.status_code == 200
        j = r.json()
        assert j["period"]["from"].startswith("2026-01-01")
        assert j["period"]["to"].startswith("2026-01-02")

    def test_bad_date_returns_400(self, tokens):
        r = requests.get(
            f"{BASE_URL}/api/analytics/admin/rollup",
            params={"from_date": "not-a-date"},
            headers={"Authorization": f"Bearer {tokens['sa_token']}"},
        )
        assert r.status_code == 400


# ────────────────────────────────────────────────────────────────────────
# /admin/coverage-gaps tests
# ────────────────────────────────────────────────────────────────────────
class TestCoverageGaps:
    def test_shape(self, coverage):
        for key in ("missing_sup", "missing_asup", "missing_ro", "totals"):
            assert key in coverage
        for k in ("missing_sup", "missing_asup", "missing_ro"):
            assert k in coverage["totals"]
            assert coverage["totals"][k] == len(coverage[k])

    def test_missing_sup_severity_red(self, coverage):
        assert len(coverage["missing_sup"]) > 0
        for e in coverage["missing_sup"]:
            assert e["severity"] == "red"
            for k in ("station_id", "station_name", "department_id", "department_name"):
                assert k in e

    def test_missing_asup_severity_amber_station_only(self, coverage):
        for e in coverage["missing_asup"]:
            assert e["severity"] == "amber"
            assert "station_id" in e and "station_name" in e
            assert "department_id" not in e

    def test_missing_ro_severity_amber(self, coverage):
        for e in coverage["missing_ro"]:
            assert e["severity"] == "amber"
            for k in ("station_id", "department_id"):
                assert k in e

    def test_missing_sup_cartesian_consistency(self, coverage, rollup):
        n_stations = len(rollup["stations"])
        n_depts = len(rollup["departments"])
        max_possible = n_stations * n_depts
        assert len(coverage["missing_sup"]) <= max_possible

        # Every (station, dept) in missing_sup must correspond to an orphan cell
        orphan_keys = set()
        for row in rollup["matrix"]:
            for cell in row["cells"]:
                if cell["is_orphan"]:
                    orphan_keys.add((cell["station_id"], cell["department_id"]))
        gap_keys = {(e["station_id"], e["department_id"]) for e in coverage["missing_sup"]}
        assert gap_keys == orphan_keys, (
            f"missing_sup gaps don't match orphan cells. "
            f"in gaps not orphan: {gap_keys - orphan_keys}, "
            f"in orphan not gaps: {orphan_keys - gap_keys}"
        )


# ────────────────────────────────────────────────────────────────────────
# ASUP & RO performance-summary enrichment
# ────────────────────────────────────────────────────────────────────────
class TestPerformanceSummaryEnrichment:
    def test_asup_rows_have_benchmark_and_zero_defect(self, tokens):
        r = requests.get(
            f"{BASE_URL}/api/analytics/approving-supervisor/{tokens['asup_id']}/performance-summary",
            headers={"Authorization": f"Bearer {tokens['asup_token']}"},
        )
        assert r.status_code == 200, r.text
        sups = r.json().get("supervisors", [])
        assert len(sups) > 0, "ASUP should have at least 1 supervisor under them"
        for row in sups:
            assert "department_id" in row
            assert "benchmark" in row, f"missing benchmark on row: {row}"
            b = row["benchmark"]
            for k in ("fy_label", "fy_avg_repair_seconds", "fy_avg_repair_hours"):
                assert k in b
            assert re.match(r"^FY \d{2}-\d{2}$", b["fy_label"])
            assert "zero_defect" in row["summary"]
            assert isinstance(row["summary"]["zero_defect"], bool)

    def test_ro_rows_have_benchmark_and_zero_defect(self, tokens):
        r = requests.get(
            f"{BASE_URL}/api/analytics/reporting-officer/{tokens['ro_id']}/performance-summary",
            headers={"Authorization": f"Bearer {tokens['ro_token']}"},
        )
        assert r.status_code == 200, r.text
        sups = r.json().get("supervisors", [])
        assert len(sups) > 0, "RO should have at least 1 supervisor"
        for row in sups:
            assert "department_id" in row
            assert "benchmark" in row
            assert "zero_defect" in row["summary"]
            assert isinstance(row["summary"]["zero_defect"], bool)


# ────────────────────────────────────────────────────────────────────────
# Regression: existing endpoints still work
# ────────────────────────────────────────────────────────────────────────
class TestRegression:
    def test_supervisor_performance_still_works(self, tokens):
        r = requests.get(
            f"{BASE_URL}/api/analytics/supervisor/{tokens['sup_id']}/performance",
            headers={"Authorization": f"Bearer {tokens['sup_token']}"},
        )
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("user_id", "summary", "categories", "period"):
            assert k in j

    def test_orange_list_scoping_for_sup(self, tokens):
        r = requests.get(
            f"{BASE_URL}/api/orange-list",
            params={"for_user_id": tokens["sup_id"], "paginated": "true"},
            headers={"Authorization": f"Bearer {tokens['sup_token']}"},
        )
        assert r.status_code == 200
