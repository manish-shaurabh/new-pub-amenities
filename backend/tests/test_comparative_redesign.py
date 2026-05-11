"""Backend tests for Comparative Reports redesign (Section A drill, Section B
peers including station-supervisors / ros / ro-supervisors). Tests the 5 new
endpoints from /app/backend/routers/comparative.py.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")


# -------------------- fixtures --------------------
@pytest.fixture(scope="session")
def sa_token_and_user():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"employee_id": "SA001", "password": "admin123"},
                      timeout=15)
    assert r.status_code == 200, f"SA001 login failed: {r.text}"
    body = r.json()
    return body["token"], body["user"]


@pytest.fixture(scope="session")
def sse_token_and_user():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"employee_id": "SSE001", "password": "admin123"},
                      timeout=15)
    assert r.status_code == 200, f"SSE001 login failed: {r.text}"
    body = r.json()
    return body["token"], body["user"]


@pytest.fixture(scope="session")
def sa_headers(sa_token_and_user):
    return {"Authorization": f"Bearer {sa_token_and_user[0]}"}


@pytest.fixture(scope="session")
def sa_user_id(sa_token_and_user):
    u = sa_token_and_user[1]
    return u.get("id") or u.get("_id")


@pytest.fixture(scope="session")
def sse_user_id(sse_token_and_user):
    u = sse_token_and_user[1]
    return u.get("id") or u.get("_id")


# -------------------- helpers --------------------
def _id(o):
    return o.get("id") or o.get("_id")


def _list_asset_types(headers):
    r = requests.get(f"{BASE_URL}/api/asset-types", headers=headers, timeout=15)
    assert r.status_code == 200
    return r.json()


def _list_stations(headers):
    r = requests.get(f"{BASE_URL}/api/stations", headers=headers, timeout=15)
    assert r.status_code == 200
    return r.json()


def _list_ros(headers):
    r = requests.get(f"{BASE_URL}/api/users?role=reporting_officer",
                     headers=headers, timeout=15)
    assert r.status_code == 200
    return r.json()


# -------------------- TESTS --------------------
class TestAssetTypeLocations:
    """GET /api/reports/comparative/asset-type/locations/{user_id}"""

    def test_returns_groups_by_station(self, sa_user_id, sa_headers):
        types = _list_asset_types(sa_headers)
        assert len(types) > 0
        atype = next((t for t in types if t.get("name")), types[0])
        atype_id = _id(atype)

        r = requests.get(
            f"{BASE_URL}/api/reports/comparative/asset-type/locations/{sa_user_id}",
            params={"asset_type_id": atype_id, "window_days": "90",
                    "stat": "median"},
            headers=sa_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["asset_type_id"] == atype_id
        assert "groups" in data
        assert isinstance(data["groups"], list)
        # Each group must have station_id, station_name, locations[]
        for g in data["groups"]:
            assert "station_id" in g
            assert "station_name" in g
            assert "station_code" in g
            assert isinstance(g["locations"], list)
            for loc in g["locations"]:
                assert "id" in loc and "label" in loc
                assert "asset_count" in loc
                # mttr stats should exist (n,mean,median,p90 etc)
                assert "n" in loc

    def test_station_filter_narrows_groups(self, sa_user_id, sa_headers):
        types = _list_asset_types(sa_headers)
        stations = _list_stations(sa_headers)
        atype = types[0]
        if not stations:
            pytest.skip("No stations seeded")
        sid = _id(stations[0])
        r = requests.get(
            f"{BASE_URL}/api/reports/comparative/asset-type/locations/{sa_user_id}",
            params={"asset_type_id": _id(atype), "station_ids": sid,
                    "window_days": "90", "stat": "median"},
            headers=sa_headers, timeout=20)
        assert r.status_code == 200
        data = r.json()
        # Every group returned must be the picked station
        for g in data["groups"]:
            assert g["station_id"] == sid


class TestAssetTypeAssets:
    """GET /api/reports/comparative/asset-type/assets/{user_id}"""

    def test_assets_carry_status_and_meta(self, sa_user_id, sa_headers):
        types = _list_asset_types(sa_headers)
        atype_id = _id(types[0])
        # Find first (station, location) pair via the locations endpoint
        rloc = requests.get(
            f"{BASE_URL}/api/reports/comparative/asset-type/locations/{sa_user_id}",
            params={"asset_type_id": atype_id, "window_days": "90", "stat": "median"},
            headers=sa_headers, timeout=20)
        assert rloc.status_code == 200
        groups = rloc.json()["groups"]
        if not groups or not groups[0]["locations"]:
            pytest.skip("No (type,location) data available")
        loc_id = groups[0]["locations"][0]["id"]

        r = requests.get(
            f"{BASE_URL}/api/reports/comparative/asset-type/assets/{sa_user_id}",
            params={"asset_type_id": atype_id, "location_id": loc_id,
                    "window_days": "90", "stat": "median"},
            headers=sa_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "rows" in data and isinstance(data["rows"], list)
        valid_status = {"working", "yellow", "orange", "red"}
        for row in data["rows"]:
            assert "id" in row
            assert "asset_number" in row
            assert row["status"] in valid_status, f"bad status {row['status']}"
            # nullable fields
            assert "list_type" in row
            assert "days_defective" in row
            assert "last_inspection_at" in row

    def test_unknown_asset_type_returns_empty(self, sa_user_id, sa_headers):
        r = requests.get(
            f"{BASE_URL}/api/reports/comparative/asset-type/assets/{sa_user_id}",
            params={"asset_type_id": "000000000000000000000000",
                    "location_id": "000000000000000000000000"},
            headers=sa_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["rows"] == []


class TestStationSupervisors:
    """GET /api/reports/comparative/station-supervisors/{user_id}"""

    def test_rows_have_department_tag(self, sa_user_id, sa_headers):
        stations = _list_stations(sa_headers)
        if not stations:
            pytest.skip("No stations seeded")
        sid = _id(stations[0])
        r = requests.get(
            f"{BASE_URL}/api/reports/comparative/station-supervisors/{sa_user_id}",
            params={"station_id": sid, "window_days": "90", "stat": "median"},
            headers=sa_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["station_id"] == sid
        assert "station_name" in data and "station_code" in data
        for row in data["rows"]:
            assert "id" in row
            assert "name" in row and "employee_id" in row
            assert "department_name" in row
            assert "department_code" in row
            assert "n" in row  # stats present


class TestROsList:
    """GET /api/reports/comparative/ros/{user_id}"""

    def test_lists_all_ros(self, sa_user_id, sa_headers):
        r = requests.get(
            f"{BASE_URL}/api/reports/comparative/ros/{sa_user_id}",
            headers=sa_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "rows" in data and isinstance(data["rows"], list)
        # Should at least carry the seeded RO ("Ram" / "DRO EL")
        for row in data["rows"]:
            assert "id" in row
            assert "name" in row
            assert "employee_id" in row
            assert "department_id" in row
            assert "department_name" in row
            assert "station_codes" in row and isinstance(row["station_codes"], list)

    def test_dept_filter_narrows(self, sa_user_id, sa_headers):
        all_ros = requests.get(
            f"{BASE_URL}/api/reports/comparative/ros/{sa_user_id}",
            headers=sa_headers, timeout=15).json()["rows"]
        if not all_ros:
            pytest.skip("No ROs")
        dept_id = next((ro["department_id"] for ro in all_ros if ro.get("department_id")), None)
        if not dept_id:
            pytest.skip("No RO with dept_id")
        r = requests.get(
            f"{BASE_URL}/api/reports/comparative/ros/{sa_user_id}",
            params={"dept_id": dept_id}, headers=sa_headers, timeout=15)
        assert r.status_code == 200
        rows = r.json()["rows"]
        for ro in rows:
            assert ro["department_id"] == dept_id


class TestROSupervisors:
    """GET /api/reports/comparative/ro-supervisors/{user_id}"""

    def test_returns_ro_header_and_rows(self, sa_user_id, sa_headers):
        ros = requests.get(
            f"{BASE_URL}/api/reports/comparative/ros/{sa_user_id}",
            headers=sa_headers, timeout=15).json()["rows"]
        if not ros:
            pytest.skip("No ROs")
        ro_id = ros[0]["id"]
        r = requests.get(
            f"{BASE_URL}/api/reports/comparative/ro-supervisors/{sa_user_id}",
            params={"ro_id": ro_id, "window_days": "90", "stat": "median"},
            headers=sa_headers, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "ro" in data and isinstance(data["ro"], dict)
        for k in ("id", "name", "employee_id", "department_name",
                  "station_codes", "avg_mttr", "sup_count"):
            assert k in data["ro"], f"ro missing {k}"
        assert data["ro"]["id"] == ro_id
        assert "rows" in data
        for r_ in data["rows"]:
            assert "id" in r_ and "name" in r_
            assert "department_name" in r_

    def test_unknown_ro_returns_404(self, sa_user_id, sa_headers):
        r = requests.get(
            f"{BASE_URL}/api/reports/comparative/ro-supervisors/{sa_user_id}",
            params={"ro_id": "000000000000000000000000"},
            headers=sa_headers, timeout=15)
        assert r.status_code == 404


class TestAuthGate:
    """Unknown user_id should 404 across all 5 new endpoints."""

    @pytest.mark.parametrize("path,params", [
        ("/api/reports/comparative/asset-type/locations/000000000000000000000000",
         {"asset_type_id": "x"}),
        ("/api/reports/comparative/asset-type/assets/000000000000000000000000",
         {"asset_type_id": "x", "location_id": "y"}),
        ("/api/reports/comparative/station-supervisors/000000000000000000000000",
         {"station_id": "x"}),
        ("/api/reports/comparative/ros/000000000000000000000000", {}),
        ("/api/reports/comparative/ro-supervisors/000000000000000000000000",
         {"ro_id": "x"}),
    ])
    def test_user_404(self, path, params, sa_headers):
        r = requests.get(f"{BASE_URL}{path}", params=params,
                         headers=sa_headers, timeout=15)
        assert r.status_code == 404
