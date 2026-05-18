"""Iteration 36 — Mobile Inspection Redesign

Covers:
- POST /api/sub-zones with start_pillar/end_pillar
- PUT  /api/sub-zones/{id} updating start_pillar/end_pillar
- GET  /api/sub-zones returning pillars
- GET  /api/station-canvas including pillars
- POST /api/inspections with sub_zone_health array (and backward compat without it)
"""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")


@pytest.fixture(scope="module")
def sa_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"employee_id": "SA001", "password": "admin123"})
    assert r.status_code == 200, r.text
    return r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def headers(sa_token):
    return {"Authorization": f"Bearer {sa_token}"} if sa_token else {}


@pytest.fixture(scope="module")
def dhanbad_ids(headers):
    """Resolve DHANBAD station + first PLATFORM 1 location"""
    s = requests.get(f"{BASE_URL}/api/stations", headers=headers).json()
    stn = next((x for x in s if x.get("code") == "DHN" or x.get("name") == "DHANBAD"), None)
    assert stn, "DHANBAD station not found"
    stn_id = stn.get("id") or stn.get("_id")
    locs = requests.get(f"{BASE_URL}/api/locations", headers=headers,
                        params={"station_id": stn_id}).json()
    loc = next((l for l in locs if "PLATFORM 1" in (l.get("name") or "").upper()), locs[0])
    loc_id = loc.get("id") or loc.get("_id")
    return {"station_id": stn_id, "location_id": loc_id}


# ---------- SUB-ZONE PILLARS ----------

class TestSubZonePillars:
    created_ids = []

    def test_create_sub_zone_with_pillars(self, headers, dhanbad_ids):
        payload = {
            "name": "TEST_SZ_PILLARS",
            "code": "TEST_SZP",
            "station_id": dhanbad_ids["station_id"],
            "location_id": dhanbad_ids["location_id"],
            "start_pillar": "P12",
            "end_pillar": "P18",
            "has_divider": True,
            "divider_orientation": "vertical",
        }
        r = requests.post(f"{BASE_URL}/api/sub-zones", headers=headers, json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("start_pillar") == "P12"
        assert data.get("end_pillar") == "P18"
        sz_id = data.get("id") or data.get("_id")
        assert sz_id, f"No id in response: {data}"
        TestSubZonePillars.created_ids.append(sz_id)

    def test_get_sub_zones_returns_pillars(self, headers, dhanbad_ids):
        r = requests.get(f"{BASE_URL}/api/sub-zones", headers=headers,
                         params={"location_id": dhanbad_ids["location_id"]})
        assert r.status_code == 200
        items = r.json()
        def _id(x): return x.get("id") or x.get("_id")
        ours = [x for x in items if _id(x) in TestSubZonePillars.created_ids]
        assert ours, "Created sub-zone not returned"
        assert ours[0]["start_pillar"] == "P12"
        assert ours[0]["end_pillar"] == "P18"

    def test_update_sub_zone_pillars(self, headers, dhanbad_ids):
        sz_id = TestSubZonePillars.created_ids[0]
        update = {
            "name": "TEST_SZ_PILLARS",
            "code": "TEST_SZP",
            "station_id": dhanbad_ids["station_id"],
            "location_id": dhanbad_ids["location_id"],
            "start_pillar": "P20",
            "end_pillar": "P26",
        }
        r = requests.put(f"{BASE_URL}/api/sub-zones/{sz_id}", headers=headers, json=update)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["start_pillar"] == "P20"
        assert data["end_pillar"] == "P26"
        # Verify via GET
        verify = requests.get(f"{BASE_URL}/api/sub-zones", headers=headers,
                              params={"location_id": dhanbad_ids["location_id"]}).json()
        def _id(x): return x.get("id") or x.get("_id")
        ours = next(x for x in verify if _id(x) == sz_id)
        assert ours["start_pillar"] == "P20"
        assert ours["end_pillar"] == "P26"

    def test_station_canvas_includes_pillars(self, headers, dhanbad_ids):
        r = requests.get(f"{BASE_URL}/api/station-canvas", headers=headers,
                         params={"location_id": dhanbad_ids["location_id"]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "locations" in body
        sub_zones = []
        for loc in body["locations"]:
            sub_zones.extend(loc.get("sub_zones", []))
        def _id(x): return x.get("id") or x.get("_id")
        ours = next((sz for sz in sub_zones if _id(sz) in TestSubZonePillars.created_ids), None)
        assert ours is not None
        assert ours.get("start_pillar") == "P20"
        assert ours.get("end_pillar") == "P26"

    def test_update_sub_zone_clear_pillars(self, headers, dhanbad_ids):
        sz_id = TestSubZonePillars.created_ids[0]
        update = {
            "name": "TEST_SZ_PILLARS",
            "code": "TEST_SZP",
            "station_id": dhanbad_ids["station_id"],
            "location_id": dhanbad_ids["location_id"],
            "start_pillar": "",
            "end_pillar": "",
        }
        r = requests.put(f"{BASE_URL}/api/sub-zones/{sz_id}", headers=headers, json=update)
        assert r.status_code == 200
        assert r.json()["start_pillar"] is None
        assert r.json()["end_pillar"] is None

    @classmethod
    def teardown_class(cls):
        for sz_id in cls.created_ids:
            try:
                requests.delete(f"{BASE_URL}/api/sub-zones/{sz_id}?force=true")
            except Exception:
                pass


# ---------- INSPECTION sub_zone_health ----------

class TestInspectionSubZoneHealth:

    @pytest.fixture(scope="class")
    def inspector_and_asset(self, headers, dhanbad_ids):
        users = requests.get(f"{BASE_URL}/api/users", headers=headers).json()
        if isinstance(users, dict):
            users = users.get("items", users.get("users", []))
        sup = next((u for u in users if u.get("employee_id") == "SSE001"), None)
        assert sup, "SSE001 not found"
        sup_id = sup.get("id") or sup.get("_id")
        assets = requests.get(f"{BASE_URL}/api/assets", headers=headers,
                              params={"station_id": dhanbad_ids["station_id"]}).json()
        if isinstance(assets, dict):
            assets = assets.get("items", [])
        assert assets, "No assets at DHANBAD"
        asset_id = assets[0].get("id") or assets[0].get("_id")
        szs = requests.get(f"{BASE_URL}/api/sub-zones", headers=headers,
                           params={"location_id": dhanbad_ids["location_id"]}).json()
        sz_id = None
        if szs:
            sz_id = szs[0].get("id") or szs[0].get("_id")
        return {"inspector_id": sup_id, "asset_id": asset_id, "sub_zone_id": sz_id}

    def test_create_inspection_with_sub_zone_health(self, headers, dhanbad_ids, inspector_and_asset):
        payload = {
            "inspection_type": "individual",
            "station_id": dhanbad_ids["station_id"],
            "inspector_id": inspector_and_asset["inspector_id"],
            "items": [{
                "asset_id": inspector_and_asset["asset_id"],
                "status": "ok",
                "checklist_responses": [],
                "remarks": "TEST_iter36 ok",
                "photo_urls": [],
            }],
            "overall_remarks": "TEST_iter36 with sub_zone_health",
            "sub_zone_health": [{
                "sub_zone_id": inspector_and_asset["sub_zone_id"],
                "location_id": dhanbad_ids["location_id"],
                "responses": {
                    "shed_roof_condition": "ok",
                    "cleanliness": "not_ok",
                    "lighting": "ok",
                    "water_seepage": "ok",
                },
                "photos": {"cleanliness": ["https://example.com/photo.jpg"]},
                "remarks": "Floor dirty near entry",
            }],
        }
        r = requests.post(f"{BASE_URL}/api/inspections", headers=headers, json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        insp_id = body.get("id") or body.get("_id")
        got = requests.get(f"{BASE_URL}/api/inspections/{insp_id}", headers=headers).json()
        szh = got.get("sub_zone_health", [])
        assert len(szh) == 1
        assert szh[0]["responses"]["cleanliness"] == "not_ok"
        assert szh[0]["photos"]["cleanliness"] == ["https://example.com/photo.jpg"]

    def test_create_inspection_without_sub_zone_health_backward_compat(self, headers, dhanbad_ids, inspector_and_asset):
        payload = {
            "inspection_type": "individual",
            "station_id": dhanbad_ids["station_id"],
            "inspector_id": inspector_and_asset["inspector_id"],
            "items": [{
                "asset_id": inspector_and_asset["asset_id"],
                "status": "ok",
                "checklist_responses": [],
                "remarks": "TEST_iter36 no szh",
                "photo_urls": [],
            }],
            "overall_remarks": "TEST_iter36 legacy",
        }
        r = requests.post(f"{BASE_URL}/api/inspections", headers=headers, json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        insp_id = body.get("id") or body.get("_id")
        got = requests.get(f"{BASE_URL}/api/inspections/{insp_id}", headers=headers).json()
        assert got.get("sub_zone_health", []) == []
