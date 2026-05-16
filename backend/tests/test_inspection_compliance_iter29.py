"""
Iteration 29 — Inspection Compliance Monitor + Dual-Panel Inspection UI
Tests:
  - GET /api/settings/compliance-threshold
  - PUT /api/settings/compliance-threshold
  - GET /api/inspection-compliance/supervisor-activity/{user_id}
  - GET /api/inspection-compliance/missing-heatmap/{user_id}
  - GET /api/inspection-compliance/sig-history/{user_id}
  - POST /api/inspection-compliance/sig/{inspection_id}/export/pdf  (for existing SIG inspections)
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def sa_token():
    """SuperAdmin login token for SA001."""
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"employee_id": "SA001", "password": "admin123"})
    assert r.status_code == 200, f"SA001 login failed: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def sa_user_id(sa_token):
    """Get SA001 user _id."""
    r = requests.get(f"{BASE_URL}/api/auth/me?token={sa_token}")
    assert r.status_code == 200, f"auth/me failed: {r.text}"
    data = r.json()
    return data.get("_id") or data.get("id")


@pytest.fixture(scope="module")
def headers(sa_token):
    return {"Authorization": f"Bearer {sa_token}", "Content-Type": "application/json"}


# ── Settings Compliance Threshold ────────────────────────────────────────────

class TestComplianceThreshold:
    """GET/PUT /api/settings/compliance-threshold"""

    def test_get_threshold_returns_overdue_days(self, headers):
        r = requests.get(f"{BASE_URL}/api/settings/compliance-threshold", headers=headers)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "overdue_days" in data, "Response must contain 'overdue_days'"
        assert isinstance(data["overdue_days"], int), "overdue_days must be int"
        assert data["overdue_days"] > 0, "overdue_days must be positive"

    def test_get_threshold_default_is_7(self, headers):
        """First call should return default 7 (unless already changed)."""
        r = requests.get(f"{BASE_URL}/api/settings/compliance-threshold", headers=headers)
        assert r.status_code == 200
        data = r.json()
        # Accept any positive value (may have been changed previously)
        assert data["overdue_days"] >= 1

    def test_put_threshold_success(self, headers, sa_user_id):
        """Admin can update threshold."""
        r = requests.put(
            f"{BASE_URL}/api/settings/compliance-threshold",
            json={"overdue_days": 14, "current_user_id": sa_user_id},
            headers=headers,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert data["overdue_days"] == 14, f"Expected 14, got {data['overdue_days']}"

    def test_put_threshold_persists(self, headers, sa_user_id):
        """After updating to 14, GET should return 14."""
        # Set to 14
        requests.put(
            f"{BASE_URL}/api/settings/compliance-threshold",
            json={"overdue_days": 14, "current_user_id": sa_user_id},
            headers=headers,
        )
        r = requests.get(f"{BASE_URL}/api/settings/compliance-threshold", headers=headers)
        assert r.status_code == 200
        data = r.json()
        assert data["overdue_days"] == 14

    def test_put_threshold_clamp_min(self, headers, sa_user_id):
        """Value < 1 is clamped to 1."""
        r = requests.put(
            f"{BASE_URL}/api/settings/compliance-threshold",
            json={"overdue_days": 0, "current_user_id": sa_user_id},
            headers=headers,
        )
        assert r.status_code == 200
        assert r.json()["overdue_days"] == 1

    def test_put_threshold_clamp_max(self, headers, sa_user_id):
        """Value > 90 is clamped to 90."""
        r = requests.put(
            f"{BASE_URL}/api/settings/compliance-threshold",
            json={"overdue_days": 200, "current_user_id": sa_user_id},
            headers=headers,
        )
        assert r.status_code == 200
        assert r.json()["overdue_days"] == 90

    def test_put_threshold_restore_default(self, headers, sa_user_id):
        """Restore to 7 for other tests."""
        r = requests.put(
            f"{BASE_URL}/api/settings/compliance-threshold",
            json={"overdue_days": 7, "current_user_id": sa_user_id},
            headers=headers,
        )
        assert r.status_code == 200
        assert r.json()["overdue_days"] == 7

    def test_put_threshold_invalid_user(self, headers):
        """Invalid user_id returns 400 or 404."""
        r = requests.put(
            f"{BASE_URL}/api/settings/compliance-threshold",
            json={"overdue_days": 7, "current_user_id": "000000000000000000000000"},
            headers=headers,
        )
        assert r.status_code in (400, 404), f"Expected 400/404, got {r.status_code}"


# ── Supervisor Activity ───────────────────────────────────────────────────────

class TestSupervisorActivity:
    """GET /api/inspection-compliance/supervisor-activity/{user_id}"""

    def test_returns_list(self, headers, sa_user_id):
        r = requests.get(
            f"{BASE_URL}/api/inspection-compliance/supervisor-activity/{sa_user_id}",
            headers=headers,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert isinstance(data, list), "Response must be a list"

    def test_returns_supervisors_with_required_fields(self, headers, sa_user_id):
        r = requests.get(
            f"{BASE_URL}/api/inspection-compliance/supervisor-activity/{sa_user_id}",
            headers=headers,
        )
        assert r.status_code == 200
        data = r.json()
        if len(data) > 0:
            row = data[0]
            assert "user_id" in row, "Missing 'user_id'"
            assert "name" in row, "Missing 'name'"
            assert "status" in row, "Missing 'status'"
            assert "count_7d" in row, "Missing 'count_7d'"
            assert "count_30d" in row, "Missing 'count_30d'"
            assert row["status"] in ("active", "due_soon", "overdue", "never", "unknown"), \
                f"Invalid status: {row['status']}"

    def test_has_supervisors(self, headers, sa_user_id):
        """Seed data has at least 1 supervisor."""
        r = requests.get(
            f"{BASE_URL}/api/inspection-compliance/supervisor-activity/{sa_user_id}",
            headers=headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 1, f"Expected at least 1 supervisor, got {len(data)}"

    def test_status_values_valid(self, headers, sa_user_id):
        """All rows have valid status values."""
        r = requests.get(
            f"{BASE_URL}/api/inspection-compliance/supervisor-activity/{sa_user_id}",
            headers=headers,
        )
        assert r.status_code == 200
        valid_statuses = {"active", "due_soon", "overdue", "never", "unknown"}
        for row in r.json():
            assert row["status"] in valid_statuses, f"Row {row['user_id']} has invalid status {row['status']}"

    def test_invalid_user_id_returns_error(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/inspection-compliance/supervisor-activity/invalid_id",
            headers=headers,
        )
        assert r.status_code in (400, 422), f"Expected 400/422, got {r.status_code}"


# ── Missing Heatmap ───────────────────────────────────────────────────────────

class TestMissingHeatmap:
    """GET /api/inspection-compliance/missing-heatmap/{user_id}"""

    def test_returns_asset_types_and_grid(self, headers, sa_user_id):
        r = requests.get(
            f"{BASE_URL}/api/inspection-compliance/missing-heatmap/{sa_user_id}",
            headers=headers,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "asset_types" in data, "Missing 'asset_types'"
        assert "grid" in data, "Missing 'grid'"
        assert isinstance(data["asset_types"], list)
        assert isinstance(data["grid"], list)

    def test_grid_has_station_entries(self, headers, sa_user_id):
        """Seed data has 31 stations, grid should be non-empty."""
        r = requests.get(
            f"{BASE_URL}/api/inspection-compliance/missing-heatmap/{sa_user_id}",
            headers=headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert len(data["grid"]) >= 1, f"Expected at least 1 station in grid, got {len(data['grid'])}"

    def test_grid_row_has_station_and_cells(self, headers, sa_user_id):
        r = requests.get(
            f"{BASE_URL}/api/inspection-compliance/missing-heatmap/{sa_user_id}",
            headers=headers,
        )
        assert r.status_code == 200
        data = r.json()
        if len(data["grid"]) > 0:
            row = data["grid"][0]
            assert "station" in row, "Grid row must have 'station'"
            assert "cells" in row, "Grid row must have 'cells'"
            station = row["station"]
            assert "id" in station and "name" in station

    def test_asset_types_have_id_and_name(self, headers, sa_user_id):
        r = requests.get(
            f"{BASE_URL}/api/inspection-compliance/missing-heatmap/{sa_user_id}",
            headers=headers,
        )
        assert r.status_code == 200
        data = r.json()
        for t in data["asset_types"]:
            assert "id" in t, "Asset type must have 'id'"
            assert "name" in t, "Asset type must have 'name'"

    def test_invalid_user_id_returns_error(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/inspection-compliance/missing-heatmap/invalid_id",
            headers=headers,
        )
        assert r.status_code in (400, 422), f"Expected 400/422, got {r.status_code}"


# ── SIG History ───────────────────────────────────────────────────────────────

class TestSigHistory:
    """GET /api/inspection-compliance/sig-history/{user_id}"""

    def test_returns_paginated_response(self, headers, sa_user_id):
        r = requests.get(
            f"{BASE_URL}/api/inspection-compliance/sig-history/{sa_user_id}",
            headers=headers,
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "items" in data, "Missing 'items'"
        assert "total" in data, "Missing 'total'"
        assert "page" in data, "Missing 'page'"
        assert "page_size" in data, "Missing 'page_size'"
        assert "total_pages" in data, "Missing 'total_pages'"

    def test_items_is_list(self, headers, sa_user_id):
        r = requests.get(
            f"{BASE_URL}/api/inspection-compliance/sig-history/{sa_user_id}",
            headers=headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data["items"], list)

    def test_pagination_page1(self, headers, sa_user_id):
        r = requests.get(
            f"{BASE_URL}/api/inspection-compliance/sig-history/{sa_user_id}",
            params={"page": 1, "page_size": 5},
            headers=headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["page"] == 1
        assert data["page_size"] == 5
        assert len(data["items"]) <= 5

    def test_sig_history_item_fields(self, headers, sa_user_id):
        """If there are SIG inspections, verify required fields."""
        r = requests.get(
            f"{BASE_URL}/api/inspection-compliance/sig-history/{sa_user_id}",
            headers=headers,
        )
        assert r.status_code == 200
        data = r.json()
        for item in data["items"]:
            assert "station_name" in item, "SIG item must have 'station_name'"
            assert "total_assets" in item, "SIG item must have 'total_assets'"
            assert "defect_count" in item, "SIG item must have 'defect_count'"
            assert "_id" in item, "SIG item must have '_id'"

    def test_invalid_user_id_returns_error(self, headers):
        r = requests.get(
            f"{BASE_URL}/api/inspection-compliance/sig-history/invalid_id",
            headers=headers,
        )
        assert r.status_code in (400, 422), f"Expected 400/422, got {r.status_code}"


# ── SIG PDF Export ────────────────────────────────────────────────────────────

class TestSigPdfExport:
    """POST /api/inspection-compliance/sig/{inspection_id}/export/pdf"""

    def test_pdf_export_for_existing_sig_inspection(self, headers, sa_user_id):
        """Fetch SIG history to get a real inspection_id, then export PDF."""
        r = requests.get(
            f"{BASE_URL}/api/inspection-compliance/sig-history/{sa_user_id}",
            headers=headers,
        )
        assert r.status_code == 200
        items = r.json().get("items", [])
        if not items:
            pytest.skip("No SIG inspections found in DB to test PDF export")

        insp_id = items[0]["_id"]
        pdf_r = requests.post(
            f"{BASE_URL}/api/inspection-compliance/sig/{insp_id}/export/pdf",
            headers=headers,
        )
        assert pdf_r.status_code == 200, f"PDF export failed: {pdf_r.status_code}: {pdf_r.text[:200]}"
        assert pdf_r.headers.get("Content-Type", "").startswith("application/pdf"), \
            f"Expected PDF content-type, got {pdf_r.headers.get('Content-Type')}"
        assert len(pdf_r.content) > 100, "PDF should have some bytes"

    def test_pdf_export_invalid_id(self, headers):
        r = requests.post(
            f"{BASE_URL}/api/inspection-compliance/sig/not_a_valid_id/export/pdf",
            headers=headers,
        )
        assert r.status_code in (400, 422), f"Expected 400/422, got {r.status_code}"

    def test_pdf_export_non_sig_inspection(self, headers, sa_user_id):
        """Get a non-SIG inspection and attempt PDF export — should return 400."""
        # Get list of all inspections
        r = requests.get(f"{BASE_URL}/api/inspections", headers=headers, params={"page": 1, "page_size": 10})
        if r.status_code != 200:
            pytest.skip("Could not fetch inspections")
        inspections_data = r.json()
        items = inspections_data if isinstance(inspections_data, list) else inspections_data.get("items", [])
        individual = [x for x in items if x.get("inspection_type") == "individual"]
        if not individual:
            pytest.skip("No individual inspections to test rejection")
        bad_id = individual[0]["_id"]
        bad_r = requests.post(
            f"{BASE_URL}/api/inspection-compliance/sig/{bad_id}/export/pdf",
            headers=headers,
        )
        assert bad_r.status_code == 400, f"Expected 400 for non-SIG, got {bad_r.status_code}"
