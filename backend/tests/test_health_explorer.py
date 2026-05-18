"""Backend tests for Health Explorer endpoints (Feb 2026)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://inspection-qr-flow.preview.emergentagent.com").rstrip("/")


def _login(emp_id, password):
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"employee_id": emp_id, "password": password},
                      timeout=20)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:300]}"
    data = r.json()
    return data["user"]["_id"], data.get("token")


@pytest.fixture(scope="module")
def sa_id():
    uid, _ = _login("SA001", "admin123")
    return uid


@pytest.fixture(scope="module")
def sup_id():
    uid, _ = _login("SSE001", "admin123")
    return uid


@pytest.fixture(scope="module")
def viewer_id():
    uid, _ = _login("VIEW001", "viewer123")
    return uid


# ─── L1 default level ───────────────────────────────────────────────────────
class TestHealthExplorerL1:
    def test_sa_default_asset_type_mode(self, sa_id):
        r = requests.get(f"{BASE_URL}/api/dashboard/health-explorer/{sa_id}")
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["mode"] == "asset_type"
        assert d["level"] == 1
        assert d["breadcrumb"] == []
        assert isinstance(d["rows"], list)
        assert d["summary"]["total"] > 0
        assert "buckets" in d["summary"]
        # color should be one of three hex codes
        assert d["summary"]["color"] in ("#0891b2", "#f59e0b", "#dc2626")

    def test_sa_station_mode(self, sa_id):
        r = requests.get(f"{BASE_URL}/api/dashboard/health-explorer/{sa_id}?mode=station")
        assert r.status_code == 200
        d = r.json()
        assert d["mode"] == "station"
        assert d["level"] == 1

    def test_sup_scoped_to_50(self, sup_id):
        r = requests.get(f"{BASE_URL}/api/dashboard/health-explorer/{sup_id}")
        assert r.status_code == 200
        d = r.json()
        # SUP (SSE001) scoped to DHANBAD + Electrical = 50 assets per problem statement
        assert d["summary"]["total"] == 50, f"expected 50, got {d['summary']['total']}"

    def test_viewer_global_matches_sa(self, sa_id, viewer_id):
        r1 = requests.get(f"{BASE_URL}/api/dashboard/health-explorer/{sa_id}")
        r2 = requests.get(f"{BASE_URL}/api/dashboard/health-explorer/{viewer_id}")
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["summary"]["total"] == r2.json()["summary"]["total"], \
            "viewer should have global scope == SA"

    def test_invalid_user(self):
        r = requests.get(f"{BASE_URL}/api/dashboard/health-explorer/000000000000000000000000")
        assert r.status_code == 404


# ─── Drill L2/L3/L4 ─────────────────────────────────────────────────────────
class TestHealthExplorerDrill:
    def test_drill_l2_asset_type(self, sa_id):
        r1 = requests.get(f"{BASE_URL}/api/dashboard/health-explorer/{sa_id}")
        rows = r1.json()["rows"]
        assert rows, "no L1 rows"
        target = rows[0]
        r2 = requests.get(
            f"{BASE_URL}/api/dashboard/health-explorer/{sa_id}?asset_type_id={target['id']}")
        assert r2.status_code == 200
        d = r2.json()
        assert d["level"] == 2
        assert len(d["breadcrumb"]) == 1
        assert d["breadcrumb"][0]["kind"] == "asset_type"

    def test_drill_l4_individual_assets(self, sa_id):
        r1 = requests.get(f"{BASE_URL}/api/dashboard/health-explorer/{sa_id}")
        t = r1.json()["rows"][0]
        r2 = requests.get(
            f"{BASE_URL}/api/dashboard/health-explorer/{sa_id}?asset_type_id={t['id']}")
        s = next((x for x in r2.json()["rows"] if x.get("drillable")), None)
        if not s:
            pytest.skip("no station row drillable")
        r3 = requests.get(
            f"{BASE_URL}/api/dashboard/health-explorer/{sa_id}"
            f"?asset_type_id={t['id']}&station_id={s['id']}")
        loc = next((x for x in r3.json()["rows"] if x.get("drillable")), None)
        if not loc:
            pytest.skip("no location row")
        r4 = requests.get(
            f"{BASE_URL}/api/dashboard/health-explorer/{sa_id}"
            f"?asset_type_id={t['id']}&station_id={s['id']}&location_id={loc['id']}")
        assert r4.status_code == 200
        d = r4.json()
        assert d["level"] == 4
        # at L4, rows should be individual assets — drillable=False
        for row in d["rows"]:
            assert row["drillable"] is False
            assert "status" in row


# ─── Filters endpoint ───────────────────────────────────────────────────────
class TestHealthExplorerFilters:
    def test_sa_filters(self, sa_id):
        r = requests.get(f"{BASE_URL}/api/dashboard/health-explorer/{sa_id}/filters")
        assert r.status_code == 200
        d = r.json()
        for k in ("stations", "departments", "asset_types"):
            assert k in d and isinstance(d[k], list)
        assert len(d["stations"]) >= 1
        assert len(d["asset_types"]) >= 1

    def test_sup_filters_scoped(self, sup_id):
        r = requests.get(f"{BASE_URL}/api/dashboard/health-explorer/{sup_id}/filters")
        assert r.status_code == 200
        d = r.json()
        # SUP scoped: only DHN station + Electrical dept
        assert len(d["stations"]) == 1, f"SUP should see 1 station, got {len(d['stations'])}"
        assert len(d["departments"]) == 1
        # Per problem statement: 5 asset types
        assert len(d["asset_types"]) == 5, f"expected 5 asset types, got {len(d['asset_types'])}"

    def test_filter_station_narrows(self, sa_id):
        r = requests.get(f"{BASE_URL}/api/dashboard/health-explorer/{sa_id}/filters")
        sids = [s["id"] for s in r.json()["stations"]]
        if not sids:
            pytest.skip("no stations")
        full = requests.get(f"{BASE_URL}/api/dashboard/health-explorer/{sa_id}").json()
        narrowed = requests.get(
            f"{BASE_URL}/api/dashboard/health-explorer/{sa_id}?station_ids={sids[0]}").json()
        assert narrowed["summary"]["total"] <= full["summary"]["total"]
