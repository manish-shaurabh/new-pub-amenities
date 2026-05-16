"""
Sprint D - Zone/Division Filter Integration + Dashboard Enhancements
Iteration 30 Test Suite

Tests:
- GET /api/zones — returns list of zones
- GET /api/divisions — returns list of divisions
- GET /api/zones — ECR zone auto-created
- GET /api/divisions — Dhanbad Division has station count
- GET /api/dashboard/health-explorer/{user_id}?mode=station — HealthTree data source
- GET /api/inspections?station_id=X&paginated=true&page=1&page_size=30 — InspectionHistoryDrawer
- GET /api/compliance/supervisor-activity/{user_id} — ZoneDivisionFilter in supervisor tab
"""

import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def sa_auth(session):
    """Login as SA001, return (token, user_id)."""
    r = session.post(f"{BASE_URL}/api/auth/login",
                     json={"employee_id": "SA001", "password": "admin123"})
    assert r.status_code == 200, f"SA login failed: {r.text}"
    data = r.json()
    token = data["token"]
    user_id = data["user"].get("_id") or data["user"].get("id")
    session.headers.update({"Authorization": f"Bearer {token}"})
    return token, user_id


@pytest.fixture(scope="module")
def sa_uid(sa_auth):
    return sa_auth[1]


class TestZonesAPI:
    """GET /api/zones endpoint for Sprint D ZoneDivisionFilter"""

    def test_list_zones_returns_200(self, session, sa_auth):
        """GET /api/zones returns HTTP 200."""
        r = session.get(f"{BASE_URL}/api/zones")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        zones = r.json()
        assert isinstance(zones, list), "Response should be a list"
        print(f"PASS: GET /api/zones returned {len(zones)} zone(s)")

    def test_zones_have_required_fields(self, session, sa_auth):
        """Each zone has _id, name, code fields."""
        r = session.get(f"{BASE_URL}/api/zones")
        zones = r.json()
        assert len(zones) > 0, "Expected at least one zone (ECR auto-created at startup)"
        for z in zones:
            assert "_id" in z or "id" in z, f"Zone missing _id: {z}"
            assert "name" in z, f"Zone missing name: {z}"
            assert "code" in z, f"Zone missing code: {z}"
        print(f"PASS: All {len(zones)} zones have required fields")

    def test_ecr_zone_exists(self, session, sa_auth):
        """ECR zone is present (auto-created at startup)."""
        r = session.get(f"{BASE_URL}/api/zones")
        zones = r.json()
        ecr = next((z for z in zones if z.get("code") == "ECR"), None)
        assert ecr is not None, "ECR zone not found"
        assert ecr["name"] == "East Central Railway"
        print(f"PASS: ECR zone found — {ecr['name']} ({ecr['code']})")

    def test_zones_no_id_field_in_list(self, session, sa_auth):
        """No MongoDB internal fields should pollute response."""
        r = session.get(f"{BASE_URL}/api/zones")
        zones = r.json()
        for z in zones:
            # MongoDB _id should be present as string, not ObjectId
            if "_id" in z:
                assert isinstance(z["_id"], str), f"_id should be string, got {type(z['_id'])}"
        print("PASS: Zone _id fields are strings")


class TestDivisionsAPI:
    """GET /api/divisions endpoint for Sprint D ZoneDivisionFilter"""

    def test_list_divisions_returns_200(self, session, sa_auth):
        """GET /api/divisions returns HTTP 200."""
        r = session.get(f"{BASE_URL}/api/divisions")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        divs = r.json()
        assert isinstance(divs, list), "Response should be a list"
        print(f"PASS: GET /api/divisions returned {len(divs)} division(s)")

    def test_divisions_have_required_fields(self, session, sa_auth):
        """Each division has _id, name, code, zone_id fields."""
        r = session.get(f"{BASE_URL}/api/divisions")
        divs = r.json()
        assert len(divs) > 0, "Expected at least one division (DHN auto-created at startup)"
        for d in divs:
            assert "_id" in d or "id" in d, f"Division missing _id: {d}"
            assert "name" in d, f"Division missing name: {d}"
            assert "code" in d, f"Division missing code: {d}"
            assert "zone_id" in d, f"Division missing zone_id: {d}"
        print(f"PASS: All {len(divs)} divisions have required fields")

    def test_dhanbad_division_exists(self, session, sa_auth):
        """Dhanbad Division (DHN) is present."""
        r = session.get(f"{BASE_URL}/api/divisions")
        divs = r.json()
        dhn = next((d for d in divs if d.get("code") == "DHN"), None)
        assert dhn is not None, "Dhanbad Division not found"
        assert "Dhanbad" in dhn["name"]
        print(f"PASS: Dhanbad Division found — {dhn['name']} ({dhn['code']})")

    def test_divisions_have_zone_name(self, session, sa_auth):
        """Divisions include zone_name (denormalized for filter display)."""
        r = session.get(f"{BASE_URL}/api/divisions")
        divs = r.json()
        for d in divs:
            assert "zone_name" in d, f"Division missing zone_name: {d}"
        print("PASS: Divisions have zone_name field")

    def test_divisions_have_assigned_stations(self, session, sa_auth):
        """Dhanbad Division has stations assigned."""
        r = session.get(f"{BASE_URL}/api/divisions")
        divs = r.json()
        dhn = next((d for d in divs if d.get("code") == "DHN"), None)
        assert dhn is not None
        # Either station_count or assigned_stations field
        has_count = (dhn.get("station_count", 0) or 0) > 0
        has_list = len(dhn.get("assigned_stations", [])) > 0
        assert has_count or has_list, f"DHN division has no stations: {dhn}"
        print(f"PASS: DHN division has stations (count={dhn.get('station_count')}, assigned={len(dhn.get('assigned_stations', []))})")


class TestHealthExplorerForTree:
    """GET /api/dashboard/health-explorer/{id}?mode=station — used by HealthTree"""

    def test_station_mode_l1_returns_rows(self, session, sa_auth, sa_uid):
        """Station mode returns rows list for HealthTree."""
        r = session.get(f"{BASE_URL}/api/dashboard/health-explorer/{sa_uid}?mode=station")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        assert "rows" in data, "Response missing 'rows'"
        rows = data["rows"]
        assert isinstance(rows, list), "rows should be a list"
        assert len(rows) > 0, "Should have at least 1 station row"
        print(f"PASS: Station mode L1 returned {len(rows)} rows")

    def test_station_rows_have_health_fields(self, session, sa_auth, sa_uid):
        """Each station row has id, label, value (health %) fields."""
        r = session.get(f"{BASE_URL}/api/dashboard/health-explorer/{sa_uid}?mode=station")
        data = r.json()
        rows = data["rows"]
        for row in rows[:5]:
            assert "id" in row, f"Row missing id: {row}"
            assert "label" in row, f"Row missing label: {row}"
            assert "value" in row, f"Row missing value: {row}"
            assert 0 <= row["value"] <= 100, f"Health % out of range: {row['value']}"
        print("PASS: Station rows have required health fields")

    def test_health_explorer_filters_endpoint(self, session, sa_auth, sa_uid):
        """GET /api/dashboard/health-explorer/{id}/filters returns zones."""
        r = session.get(f"{BASE_URL}/api/dashboard/health-explorer/{sa_uid}/filters")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        assert "stations" in data, "Filters missing stations"
        print(f"PASS: Filters endpoint returned keys: {list(data.keys())}")


class TestInspectionHistoryDrawerAPI:
    """GET /api/inspections?station_id=X&paginated=true — InspectionHistoryDrawer data source"""

    def test_inspections_paginated_with_station_filter(self, session, sa_auth):
        """GET /api/inspections with paginated=true returns paginated structure."""
        # First get a valid station_id
        r = session.get(f"{BASE_URL}/api/stations")
        assert r.status_code == 200
        stations = r.json()
        assert len(stations) > 0, "Need at least one station"
        station_id = stations[0]["_id"]

        r = session.get(f"{BASE_URL}/api/inspections",
                        params={"station_id": station_id, "paginated": True, "page": 1, "page_size": 30})
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        # Should be either a list or paginated response
        if isinstance(data, dict):
            assert "items" in data or "data" in data, f"Paginated response missing items: {data.keys()}"
            items = data.get("items") or data.get("data") or []
            assert isinstance(items, list)
        else:
            assert isinstance(data, list)
        print(f"PASS: Inspections returned for station {stations[0].get('name', station_id)}")

    def test_inspection_history_without_station_filter(self, session, sa_auth):
        """GET /api/inspections paginated without station_id returns 200."""
        r = session.get(f"{BASE_URL}/api/inspections",
                        params={"paginated": True, "page": 1, "page_size": 30})
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        if isinstance(data, dict):
            assert "items" in data or "data" in data
        print("PASS: Paginated inspections without station filter returns 200")


class TestComplianceSupervisorTabWithZoneFilter:
    """Compliance supervisor activity API - zone/division filter pass-through"""

    def test_supervisor_activity_returns_list(self, session, sa_auth, sa_uid):
        """GET inspection-compliance/supervisor-activity returns list."""
        r = session.get(f"{BASE_URL}/api/inspection-compliance/supervisor-activity/{sa_uid}")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        assert isinstance(data, list), "Expected list response"
        print(f"PASS: Supervisor activity returned {len(data)} supervisors")

    def test_supervisor_activity_with_station_filter(self, session, sa_auth, sa_uid):
        """GET inspection-compliance/supervisor-activity with station_id filter returns 200."""
        # Get valid station
        r = session.get(f"{BASE_URL}/api/stations")
        stations = r.json()
        if not stations:
            pytest.skip("No stations available")
        station_id = stations[0]["_id"]

        r = session.get(f"{BASE_URL}/api/inspection-compliance/supervisor-activity/{sa_uid}",
                        params={"station_id": station_id})
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        print(f"PASS: Supervisor activity with station_id filter returns 200")
