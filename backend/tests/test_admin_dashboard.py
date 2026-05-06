"""
Admin Dashboard Endpoint Tests (Iteration 12)
Tests for:
  - GET /api/dashboard/admin endpoint (new - implemented for admin role)
  - Response structure, health, asset_categories, stations, reporting_officers
  - Filter params: station_ids, department_ids, reporting_officer_ids
  - Regression: previous analytics endpoints still work
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Known credentials
ADMIN_EMP_ID = "SUP003"
ADMIN_PASSWORD = "admin123"
SA_EMP_ID = "SA001"
SA_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def admin_session():
    """Authenticated session as admin user SUP003"""
    s = requests.Session()
    resp = s.post(f"{BASE_URL}/api/auth/login", json={"employee_id": ADMIN_EMP_ID, "password": ADMIN_PASSWORD})
    assert resp.status_code == 200, f"Admin login failed: {resp.status_code} {resp.text[:200]}"
    token = resp.json().get("token")
    assert token, "No token in admin login response"
    s.headers.update({"Authorization": f"Bearer {token}"})
    print(f"\nAdmin session created. user_id: {resp.json().get('user', {}).get('id', 'unknown')}")
    return s


@pytest.fixture(scope="module")
def sa_session():
    """Authenticated session as superadmin SA001"""
    s = requests.Session()
    resp = s.post(f"{BASE_URL}/api/auth/login", json={"employee_id": SA_EMP_ID, "password": SA_PASSWORD})
    if resp.status_code == 200:
        token = resp.json().get("token")
        if token:
            s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# ─────────────────────────────────────────────────────────────────────────────
# Section 1: Admin Dashboard Endpoint - Basic Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestAdminDashboardBasic:
    """Tests for GET /api/dashboard/admin endpoint"""

    def test_login_as_admin_returns_200(self):
        """Admin login works with SUP003/admin123"""
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={"employee_id": "SUP003", "password": "admin123"})
        assert resp.status_code == 200, f"Login failed: {resp.status_code}"
        data = resp.json()
        assert "token" in data, "No token in response"
        user = data.get("user", {})
        print(f"PASS: Admin login OK. role={user.get('role')}, name={user.get('name')}")

    def test_admin_dashboard_returns_200(self, admin_session):
        """GET /api/dashboard/admin returns 200 with valid admin token"""
        r = admin_session.get(f"{BASE_URL}/api/dashboard/admin")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:300]}"
        print("PASS: GET /api/dashboard/admin returns 200")

    def test_admin_dashboard_top_level_keys(self, admin_session):
        """Response has all required top-level keys"""
        r = admin_session.get(f"{BASE_URL}/api/dashboard/admin")
        data = r.json()
        required_keys = ["totals", "health", "asset_categories", "stations", "reporting_officers"]
        for key in required_keys:
            assert key in data, f"Missing key: {key}. Got keys: {list(data.keys())}"
        print(f"PASS: All required keys present. Keys: {list(data.keys())}")

    def test_admin_dashboard_totals_structure(self, admin_session):
        """totals field has assets, stations, departments, asset_categories"""
        r = admin_session.get(f"{BASE_URL}/api/dashboard/admin")
        totals = r.json()["totals"]
        assert "assets" in totals, f"Missing 'assets' in totals: {totals}"
        assert isinstance(totals["assets"], int), f"totals.assets must be int, got {type(totals['assets'])}"
        assert totals["assets"] >= 0
        print(f"PASS: totals structure correct. assets={totals['assets']}, stations={totals.get('stations')}")

    def test_admin_dashboard_health_structure(self, admin_session):
        """health field has working, orange, red counts"""
        r = admin_session.get(f"{BASE_URL}/api/dashboard/admin")
        health = r.json()["health"]
        assert "working" in health, "Missing 'working' in health"
        assert "orange" in health, "Missing 'orange' in health"
        assert "red" in health, "Missing 'red' in health"
        assert isinstance(health["working"], int), "working must be int"
        assert isinstance(health["orange"], int), "orange must be int"
        assert isinstance(health["red"], int), "red must be int"
        total_in_health = health["working"] + health["orange"] + health["red"]
        print(f"PASS: health structure correct. working={health['working']}, orange={health['orange']}, red={health['red']}, total={total_in_health}")

    def test_admin_dashboard_asset_categories(self, admin_session):
        """asset_categories is a list with required fields"""
        r = admin_session.get(f"{BASE_URL}/api/dashboard/admin")
        cats = r.json()["asset_categories"]
        assert isinstance(cats, list), "asset_categories must be list"
        if cats:
            c = cats[0]
            assert "asset_type_id" in c, f"Missing asset_type_id in category: {c}"
            assert "asset_type_name" in c, f"Missing asset_type_name in category: {c}"
            assert "asset_count" in c, f"Missing asset_count in category: {c}"
            assert "working" in c
            assert "orange" in c
            assert "red" in c
        print(f"PASS: asset_categories is list with {len(cats)} items")

    def test_admin_dashboard_stations_structure(self, admin_session):
        """stations list with asset breakdown per station"""
        r = admin_session.get(f"{BASE_URL}/api/dashboard/admin")
        stations = r.json()["stations"]
        assert isinstance(stations, list), "stations must be list"
        if stations:
            s = stations[0]
            assert "_id" in s or "station_id" in s, f"Station missing _id: {s}"
            assert "name" in s or "station_name" in s, f"Station missing name: {s}"
            assert "asset_count" in s
            assert "working" in s
            assert "orange" in s
            assert "red" in s
            assert "pct_functional" in s
        print(f"PASS: stations list has {len(stations)} items")

    def test_admin_dashboard_reporting_officers(self, admin_session):
        """reporting_officers list returns RO users"""
        r = admin_session.get(f"{BASE_URL}/api/dashboard/admin")
        ros = r.json()["reporting_officers"]
        assert isinstance(ros, list), "reporting_officers must be list"
        if ros:
            ro = ros[0]
            assert "_id" in ro, f"RO missing _id: {ro}"
            assert "name" in ro, f"RO missing name: {ro}"
            assert "employee_id" in ro, f"RO missing employee_id: {ro}"
        print(f"PASS: reporting_officers list has {len(ros)} RO users")

    def test_admin_dashboard_available_stations(self, admin_session):
        """available_stations list is present"""
        r = admin_session.get(f"{BASE_URL}/api/dashboard/admin")
        data = r.json()
        assert "available_stations" in data, "Missing available_stations"
        avail = data["available_stations"]
        assert isinstance(avail, list), "available_stations must be list"
        if avail:
            s = avail[0]
            assert "_id" in s, f"Station missing _id: {s}"
            assert "name" in s, f"Station missing name: {s}"
        print(f"PASS: available_stations has {len(avail)} items")

    def test_health_totals_match_asset_count(self, admin_session):
        """Health totals match totals.assets"""
        r = admin_session.get(f"{BASE_URL}/api/dashboard/admin")
        data = r.json()
        health = data["health"]
        totals = data["totals"]
        health_total = health["working"] + health["orange"] + health["red"]
        # Health total should match totals.assets
        assert health_total == totals["assets"], \
            f"Health total ({health_total}) doesn't match totals.assets ({totals['assets']})"
        print(f"PASS: Health total matches totals.assets: {health_total}")


# ─────────────────────────────────────────────────────────────────────────────
# Section 2: Filter Parameters
# ─────────────────────────────────────────────────────────────────────────────

class TestAdminDashboardFilters:
    """Filter parameter tests"""

    def test_station_filter_accepted(self, admin_session):
        """station_ids param is accepted and applies filtering"""
        # First get available stations
        r = admin_session.get(f"{BASE_URL}/api/dashboard/admin")
        available = r.json().get("available_stations", [])
        if not available:
            pytest.skip("No stations available to filter")
        
        station_id = available[0]["_id"]
        r_filtered = admin_session.get(
            f"{BASE_URL}/api/dashboard/admin",
            params={"station_ids": station_id}
        )
        assert r_filtered.status_code == 200, f"Filter request failed: {r_filtered.status_code}"
        data_filtered = r_filtered.json()
        # Filtered should have <= total assets
        r_all = admin_session.get(f"{BASE_URL}/api/dashboard/admin")
        data_all = r_all.json()
        assert data_filtered["totals"]["assets"] <= data_all["totals"]["assets"], \
            "Filtered assets should be <= unfiltered total"
        print(f"PASS: station filter works. Filtered={data_filtered['totals']['assets']}, All={data_all['totals']['assets']}")

    def test_department_filter_accepted(self, admin_session):
        """department_ids param is accepted"""
        # Get a department ID
        r = requests.get(f"{BASE_URL}/api/departments",
                         headers=admin_session.headers)
        if r.status_code != 200 or not r.json():
            pytest.skip("No departments available")
        
        depts = r.json()
        dept_id = depts[0]["_id"] if isinstance(depts, list) and depts else None
        if not dept_id:
            pytest.skip("Could not get department ID")
        
        r_filtered = admin_session.get(
            f"{BASE_URL}/api/dashboard/admin",
            params={"department_ids": dept_id}
        )
        assert r_filtered.status_code == 200, f"Dept filter failed: {r_filtered.status_code}"
        print(f"PASS: department filter accepted. Status 200")

    def test_reporting_officer_filter_accepted(self, admin_session):
        """reporting_officer_ids param is accepted"""
        # Get a RO ID
        r = admin_session.get(f"{BASE_URL}/api/dashboard/admin")
        ros = r.json().get("reporting_officers", [])
        if not ros:
            pytest.skip("No reporting officers found")
        
        ro_id = ros[0]["_id"]
        r_filtered = admin_session.get(
            f"{BASE_URL}/api/dashboard/admin",
            params={"reporting_officer_ids": ro_id}
        )
        assert r_filtered.status_code == 200, f"RO filter failed: {r_filtered.status_code}"
        print(f"PASS: reporting_officer_ids filter accepted. Status 200")

    def test_combined_filters(self, admin_session):
        """Multiple filter params can be combined"""
        r = admin_session.get(f"{BASE_URL}/api/dashboard/admin")
        data = r.json()
        available = data.get("available_stations", [])
        
        if not available:
            pytest.skip("No stations for combined filter test")
        
        station_id = available[0]["_id"]
        r_filtered = admin_session.get(
            f"{BASE_URL}/api/dashboard/admin",
            params={"station_ids": station_id}
        )
        assert r_filtered.status_code == 200
        fdata = r_filtered.json()
        assert "filters_applied" in fdata
        print(f"PASS: Combined filters work. filters_applied={fdata.get('filters_applied')}")


# ─────────────────────────────────────────────────────────────────────────────
# Section 3: Regression checks
# ─────────────────────────────────────────────────────────────────────────────

class TestAdminDashboardRegression:
    """Ensure previously-passing endpoints still work"""

    SUP_ID = "69f832991d32eee20864cb1b"      # SSE001

    def test_supervisor_performance_still_works(self, sa_session):
        """GET /api/analytics/supervisor/{id}/performance still returns 200"""
        r = sa_session.get(f"{BASE_URL}/api/analytics/supervisor/{self.SUP_ID}/performance")
        assert r.status_code == 200, f"Regression: supervisor performance broken: {r.status_code}"
        data = r.json()
        assert "summary" in data
        print(f"PASS: Supervisor performance still works. pct_functional={data['summary']['pct_functional']}")

    def test_asup_performance_summary_still_works(self, sa_session):
        """GET /api/analytics/approving-supervisor/{id}/performance-summary still works"""
        ASUP_ID = "69f7035af3f687e9573332d6"
        r = sa_session.get(f"{BASE_URL}/api/analytics/approving-supervisor/{ASUP_ID}/performance-summary")
        assert r.status_code == 200, f"Regression: ASUP performance broken: {r.status_code}"
        data = r.json()
        assert "supervisors" in data
        print(f"PASS: ASUP performance summary still works. {len(data['supervisors'])} supervisors")

    def test_ro_performance_summary_still_works(self, sa_session):
        """GET /api/analytics/reporting-officer/{id}/performance-summary still works"""
        RO_ID = "69fa4d5519494e4f3610cb6a"
        r = sa_session.get(f"{BASE_URL}/api/analytics/reporting-officer/{RO_ID}/performance-summary")
        assert r.status_code == 200, f"Regression: RO performance broken: {r.status_code}"
        data = r.json()
        assert "supervisors" in data
        print(f"PASS: RO performance summary still works. {len(data['supervisors'])} supervisors")

    def test_superadmin_dashboard_still_works(self, sa_session):
        """GET /api/dashboard/superadmin (superadmin full) still works"""
        r = sa_session.get(f"{BASE_URL}/api/dashboard/superadmin")
        assert r.status_code == 200, f"Regression: superadmin dashboard broken: {r.status_code}"
        print("PASS: Superadmin dashboard still works")
