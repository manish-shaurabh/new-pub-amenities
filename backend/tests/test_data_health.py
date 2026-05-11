"""
Backend tests for Admin → Data Health panel.

Covers:
  - GET /api/data-health/scan/{user_id} (auth + 10 categories)
  - GET /api/data-health/preview/{user_id}?category=&target_id= (station + user cascade)
  - POST /api/data-health/clean/{user_id} (orphan_inspection_items, test_stations, unnamed_asset_types refusal)
  - GET /api/data-health/audit/{user_id}
  - Permissions: superadmin executes, admin views, others 403
"""
import os
import pytest
import requests

_url = os.environ.get("REACT_APP_BACKEND_URL")
if not _url:
    # Load from /app/frontend/.env at runtime
    try:
        with open("/app/frontend/.env") as f:
            for ln in f:
                if ln.startswith("REACT_APP_BACKEND_URL="):
                    _url = ln.split("=", 1)[1].strip()
                    break
    except FileNotFoundError:
        pass
assert _url, "REACT_APP_BACKEND_URL not configured"
BASE_URL = _url.rstrip("/")
SA_EID = "SA001"
SA_PWD = "admin123"

EXPECTED_CATEGORIES = {
    "orphan_inspection_items", "orphan_ol_entries", "orphan_remarks",
    "test_users", "test_stations", "unnamed_asset_types",
    "zero_activity_stations", "zero_activity_users", "stale_records",
    "duplicates",
}


# ─── Fixtures ─────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def sa_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"employee_id": SA_EID, "password": SA_PWD}, timeout=30)
    assert r.status_code == 200, f"SA login failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    token = body.get("token") or body.get("access_token")
    user = body.get("user") or {}
    sa_id = user.get("_id") or user.get("id")
    assert token and sa_id, f"Missing token/user id: {body}"
    s.headers.update({"Authorization": f"Bearer {token}"})
    s.sa_id = sa_id
    return s


@pytest.fixture(scope="module")
def admin_user_id(sa_session):
    """Pick a non-superadmin admin from /api/users; fallback skip if none."""
    r = sa_session.get(f"{BASE_URL}/api/users", timeout=30)
    if r.status_code != 200:
        pytest.skip(f"/api/users failed: {r.status_code}")
    users = r.json() if isinstance(r.json(), list) else r.json().get("users", [])
    for u in users:
        if u.get("role") == "admin":
            return u.get("_id") or u.get("id")
    pytest.skip("No non-superadmin admin user found in DB")


@pytest.fixture(scope="module")
def supervisor_user_id(sa_session):
    r = sa_session.get(f"{BASE_URL}/api/users", timeout=30)
    users = r.json() if isinstance(r.json(), list) else r.json().get("users", [])
    for u in users:
        if u.get("role") == "supervisor":
            return u.get("_id") or u.get("id")
    pytest.skip("No supervisor user found")


# ─── Scan ─────────────────────────────────────────────────────────────────
class TestScan:
    def test_scan_as_superadmin_returns_all_categories(self, sa_session):
        r = sa_session.get(
            f"{BASE_URL}/api/data-health/scan/{sa_session.sa_id}", timeout=60)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert "categories" in body
        cats = body["categories"]
        missing = EXPECTED_CATEGORIES - set(cats.keys())
        assert not missing, f"Missing categories: {missing}"
        # Each category has count/sample/label
        for k, v in cats.items():
            assert "count" in v, f"{k} missing count"
            assert "sample" in v, f"{k} missing sample"
            assert "label" in v, f"{k} missing label"
            assert isinstance(v["count"], int)

    def test_scan_as_supervisor_forbidden(self, sa_session, supervisor_user_id):
        r = sa_session.get(
            f"{BASE_URL}/api/data-health/scan/{supervisor_user_id}", timeout=30)
        assert r.status_code == 403, f"Expected 403 got {r.status_code}: {r.text[:200]}"

    def test_scan_as_admin_allowed(self, sa_session, admin_user_id):
        r = sa_session.get(
            f"{BASE_URL}/api/data-health/scan/{admin_user_id}", timeout=60)
        assert r.status_code == 200
        assert "categories" in r.json()


# ─── Preview ──────────────────────────────────────────────────────────────
class TestPreview:
    def test_preview_test_station_cascade(self, sa_session):
        scan = sa_session.get(
            f"{BASE_URL}/api/data-health/scan/{sa_session.sa_id}").json()
        samples = scan["categories"]["test_stations"]["sample"]
        if not samples:
            pytest.skip("No test_stations in DB")
        tid = samples[0]["id"]
        r = sa_session.get(
            f"{BASE_URL}/api/data-health/preview/{sa_session.sa_id}",
            params={"category": "test_stations", "target_id": tid}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body["kind"] == "station"
        assert "cascade" in body
        for k in ("locations", "assets", "orange_list_entries",
                  "remarks", "inspections", "schedules"):
            assert k in body["cascade"], f"Missing cascade.{k}"
        assert "total_dependents" in body
        assert isinstance(body["total_dependents"], int)

    def test_preview_test_user_cascade(self, sa_session):
        scan = sa_session.get(
            f"{BASE_URL}/api/data-health/scan/{sa_session.sa_id}").json()
        samples = scan["categories"]["test_users"]["sample"]
        if not samples:
            pytest.skip("No test_users in DB")
        uid = samples[0]["id"]
        r = sa_session.get(
            f"{BASE_URL}/api/data-health/preview/{sa_session.sa_id}",
            params={"category": "test_users", "target_id": uid}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        assert body["kind"] == "user"
        c = body["cascade"]
        for k in ("ol_entries_marked_working_by_user",
                  "ol_entries_approved_by_user",
                  "inspections_by_user", "remarks_by_user", "note"):
            assert k in c
        assert "null" in c["note"].lower() or "audit" in c["note"].lower()

    def test_preview_bulk_orphan_items(self, sa_session):
        r = sa_session.get(
            f"{BASE_URL}/api/data-health/preview/{sa_session.sa_id}",
            params={"category": "orphan_inspection_items"}, timeout=60)
        assert r.status_code == 200
        body = r.json()
        assert body.get("bulk") is True
        assert "total" in body


# ─── Clean (permissions + behavior) ───────────────────────────────────────
class TestClean:
    def test_clean_as_admin_forbidden(self, sa_session, admin_user_id):
        r = sa_session.post(
            f"{BASE_URL}/api/data-health/clean/{admin_user_id}",
            json={"category": "orphan_inspection_items", "bulk": True}, timeout=30)
        assert r.status_code == 403, f"Expected 403 got {r.status_code}: {r.text[:200]}"

    def test_clean_orphan_inspection_items_idempotent(self, sa_session):
        # First call may remove some
        r1 = sa_session.post(
            f"{BASE_URL}/api/data-health/clean/{sa_session.sa_id}",
            json={"category": "orphan_inspection_items", "bulk": True}, timeout=60)
        assert r1.status_code == 200, r1.text[:300]
        s1 = r1.json()["summary"]
        assert "items_removed" in s1 and "inspections_touched" in s1
        # Second call must return zero
        r2 = sa_session.post(
            f"{BASE_URL}/api/data-health/clean/{sa_session.sa_id}",
            json={"category": "orphan_inspection_items", "bulk": True}, timeout=60)
        assert r2.status_code == 200
        s2 = r2.json()["summary"]
        assert s2["items_removed"] == 0
        assert s2["inspections_touched"] == 0

    def test_clean_single_test_station_cascade(self, sa_session):
        scan = sa_session.get(
            f"{BASE_URL}/api/data-health/scan/{sa_session.sa_id}").json()
        before = scan["categories"]["test_stations"]["count"]
        samples = scan["categories"]["test_stations"]["sample"]
        if not samples:
            pytest.skip("No test_stations to delete")
        tid = samples[0]["id"]
        r = sa_session.post(
            f"{BASE_URL}/api/data-health/clean/{sa_session.sa_id}",
            json={"category": "test_stations", "target_ids": [tid],
                  "bulk": False}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        summary = r.json()["summary"]
        assert summary["stations_deleted"] == 1
        # Re-scan
        scan2 = sa_session.get(
            f"{BASE_URL}/api/data-health/scan/{sa_session.sa_id}").json()
        after = scan2["categories"]["test_stations"]["count"]
        assert after == before - 1, f"Expected {before-1} got {after}"

    def test_clean_unnamed_types_with_assets_refused_or_zero(self, sa_session):
        """If unnamed_asset_types exists and assets reference them → 400.
        Else cleanup is allowed and returns ok."""
        scan = sa_session.get(
            f"{BASE_URL}/api/data-health/scan/{sa_session.sa_id}").json()
        count = scan["categories"]["unnamed_asset_types"]["count"]
        if count == 0:
            pytest.skip("No unnamed_asset_types to test")
        r = sa_session.post(
            f"{BASE_URL}/api/data-health/clean/{sa_session.sa_id}",
            json={"category": "unnamed_asset_types", "bulk": True}, timeout=30)
        # Either 200 (no assets reference) or 400 (assets reference → helpful msg)
        assert r.status_code in (200, 400)
        if r.status_code == 400:
            assert "asset" in r.text.lower()


# ─── Audit log ─────────────────────────────────────────────────────────────
class TestAudit:
    def test_audit_log_returns_rows_with_performed_by_name(self, sa_session):
        r = sa_session.get(
            f"{BASE_URL}/api/data-health/audit/{sa_session.sa_id}?limit=20",
            timeout=30)
        assert r.status_code == 200
        body = r.json()
        assert "rows" in body
        assert isinstance(body["rows"], list)
        # At least one row should exist post-cleanups in this run
        if body["rows"]:
            row = body["rows"][0]
            assert "performed_by_name" in row
            assert "summary" in row
            assert "category" in row
            assert "performed_at" in row
            # _id should be string not dict (ObjectId stripped)
            assert isinstance(row["_id"], str)
