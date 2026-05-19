"""Iter 38 — Canvas Landmark Save Bug
Verifies POST/PUT/DELETE /api/canvas-landmarks accept empty location_id/station_id
(no 500), update endpoint persists new position, list endpoint returns it.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def sa_token():
    r = requests.post(f"{API}/auth/login", json={"employee_id": "SA001", "password": "admin123"})
    assert r.status_code == 200, r.text
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def sub_zone(sa_token):
    h = {"Authorization": f"Bearer {sa_token}"}
    # Pick any existing sub-zone (DHANBAD / PLATFORM 1)
    stations = requests.get(f"{API}/stations", headers=h).json()
    dhn = next(s for s in stations if s.get("code") == "DHN")
    dhn_id = dhn.get("id") or dhn.get("_id")
    locs = requests.get(f"{API}/locations", headers=h, params={"station_id": dhn_id}).json()
    assert locs, "No locations found"
    loc_id = locs[0].get("id") or locs[0].get("_id")
    sz_list = requests.get(f"{API}/sub-zones", headers=h, params={"location_id": loc_id}).json()
    if not sz_list:
        pytest.skip("No sub-zones available to test landmarks")
    sz_id = sz_list[0].get("id") or sz_list[0].get("_id")
    return {"sub_zone_id": sz_id, "location_id": loc_id, "station_id": dhn_id}


class TestLandmarkCRUDIter38:

    def test_create_landmark_with_empty_location_and_station(self, sa_token, sub_zone):
        """Bug fix: empty string location_id/station_id should NOT return 500."""
        h = {"Authorization": f"Bearer {sa_token}"}
        payload = {
            "sub_zone_id": sub_zone["sub_zone_id"],
            "location_id": "",
            "station_id": "",
            "label": "TEST_P.No 42",
            "x": 25.0,
            "y": 50.0,
            "landmark_type": "pole",
        }
        r = requests.post(f"{API}/canvas-landmarks", headers=h, json=payload)
        assert r.status_code in (200, 201), f"Got {r.status_code}: {r.text}"
        data = r.json()
        assert data["label"] == "TEST_P.No 42"
        assert data["x"] == 25.0
        assert data["y"] == 50.0
        assert "id" in data, f"Response missing 'id' field — got {list(data.keys())}"
        assert "_id" not in data, "Should not expose raw _id"
        pytest.lm_id = data["id"]

    def test_create_landmark_missing_optional_fields(self, sa_token, sub_zone):
        """Even with location_id/station_id omitted entirely → must succeed."""
        h = {"Authorization": f"Bearer {sa_token}"}
        payload = {
            "sub_zone_id": sub_zone["sub_zone_id"],
            "label": "TEST_NoLoc",
            "x": 10.0,
            "y": 20.0,
        }
        r = requests.post(f"{API}/canvas-landmarks", headers=h, json=payload)
        assert r.status_code in (200, 201), f"Got {r.status_code}: {r.text}"
        d = r.json()
        del_id = d.get("id") or d.get("_id")
        # Cleanup
        requests.delete(f"{API}/canvas-landmarks/{del_id}", headers=h)

    def test_update_landmark_position(self, sa_token):
        """PUT must move landmark position and persist via GET."""
        h = {"Authorization": f"Bearer {sa_token}"}
        lm_id = getattr(pytest, "lm_id", None)
        if not lm_id:
            pytest.skip("Create test didn't run")
        upd = {
            "sub_zone_id": "any",  # required by model
            "label": "TEST_P.No 42 MOVED",
            "x": 75.5,
            "y": 80.2,
            "landmark_type": "pole",
        }
        r = requests.put(f"{API}/canvas-landmarks/{lm_id}", headers=h, json=upd)
        assert r.status_code == 200, f"Got {r.status_code}: {r.text}"
        data = r.json()
        assert data["x"] == 75.5
        assert data["y"] == 80.2
        assert data["label"] == "TEST_P.No 42 MOVED"

        # Verify via list endpoint
        lst = requests.get(f"{API}/canvas-landmarks", headers=h).json()
        match = next((x for x in lst if (x.get("id") or x.get("_id")) == lm_id), None)
        assert match is not None
        assert match["x"] == 75.5
        assert match["y"] == 80.2

    def test_update_landmark_404(self, sa_token):
        h = {"Authorization": f"Bearer {sa_token}"}
        upd = {"sub_zone_id": "x", "label": "X", "x": 1.0, "y": 1.0}
        r = requests.put(f"{API}/canvas-landmarks/507f1f77bcf86cd799439011", headers=h, json=upd)
        assert r.status_code == 404

    def test_delete_landmark(self, sa_token):
        h = {"Authorization": f"Bearer {sa_token}"}
        lm_id = getattr(pytest, "lm_id", None)
        if not lm_id:
            pytest.skip()
        r = requests.delete(f"{API}/canvas-landmarks/{lm_id}", headers=h)
        assert r.status_code == 200
        # Verify gone
        r2 = requests.delete(f"{API}/canvas-landmarks/{lm_id}", headers=h)
        assert r2.status_code == 404
