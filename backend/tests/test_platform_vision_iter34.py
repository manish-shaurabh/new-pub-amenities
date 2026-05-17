"""Phase 2 Platform Vision 2.0 — backend tests (iteration 34).

Covers:
  - asset-types CRUD with icon_key
  - PATCH /assets/{id}/status flip (working <-> missing)
  - POST /assets with canvas_x/y persistence + station-canvas aggregate
  - DELETE /sub-zones with conflict + ?force=true
  - PUT /sub-zones (has_divider, divider_orientation)
  - POST/GET /canvas-landmarks
  - Regression: login, stations, locations
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
TAG = uuid.uuid4().hex[:6].upper()


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def auth_token(client):
    r = client.post(f"{BASE_URL}/api/auth/login",
                    json={"employee_id": "SA001", "password": "admin123"})
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json().get("token")
    if not tok:
        pytest.skip("no token field")
    return tok


@pytest.fixture(scope="session")
def auth(client, auth_token):
    client.headers.update({"Authorization": f"Bearer {auth_token}"})
    return client


@pytest.fixture(scope="session")
def context(auth):
    """Resolve DHANBAD station + PLATFORM 1 location + Electrical dept."""
    stations = auth.get(f"{BASE_URL}/api/stations").json()
    station = next((s for s in stations if (s.get("code") or "").upper() == "DHN"
                    or s.get("name", "").upper().startswith("DHANBAD")), None)
    assert station, "DHANBAD station missing"
    locs = auth.get(f"{BASE_URL}/api/locations",
                    params={"station_id": station["_id"]}).json()
    loc = next((l for l in locs if "PLATFORM 1" in (l.get("name") or "").upper()
                and "SHED" not in (l.get("name") or "").upper()), locs[0])
    depts = auth.get(f"{BASE_URL}/api/departments").json()
    dept = next((d for d in depts if d["name"].upper() == "ELECTRICAL"), depts[0])
    return {"station_id": station["_id"], "location_id": loc["_id"],
            "department_id": dept["_id"]}


# ---------- Regression ----------
def test_login_ok(auth_token):
    assert auth_token


def test_stations_list(auth):
    r = auth.get(f"{BASE_URL}/api/stations")
    assert r.status_code == 200 and isinstance(r.json(), list)


def test_locations_list(auth, context):
    r = auth.get(f"{BASE_URL}/api/locations",
                 params={"station_id": context["station_id"]})
    assert r.status_code == 200 and len(r.json()) > 0


# ---------- ASSET TYPES with icon_key ----------
def test_asset_type_create_with_icon_key(auth, context):
    payload = {
        "name": f"TEST_AT_FAN_{TAG}",
        "department_id": context["department_id"],
        "checklist": [{"name": "x", "is_critical": False}],
        "description": "icon test",
        "tracking_mode": "individual",
        "icon_key": "fan",
    }
    r = auth.post(f"{BASE_URL}/api/asset-types", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["icon_key"] == "fan"
    at_id = body["_id"]
    # GET list — must include icon_key
    listing = auth.get(f"{BASE_URL}/api/asset-types",
                       params={"department_id": context["department_id"]}).json()
    found = next((x for x in listing if x["_id"] == at_id), None)
    assert found and found.get("icon_key") == "fan"

    # PUT update to 'light'
    payload["icon_key"] = "light"
    r2 = auth.put(f"{BASE_URL}/api/asset-types/{at_id}", json=payload)
    assert r2.status_code == 200
    assert r2.json().get("icon_key") == "light"

    # cleanup
    auth.delete(f"{BASE_URL}/api/asset-types/{at_id}")


# ---------- PATCH /assets/{id}/status (missing toggle) ----------
def test_asset_status_patch_missing(auth, context):
    # create temp asset type + asset
    at = auth.post(f"{BASE_URL}/api/asset-types", json={
        "name": f"TEST_AT_STATUS_{TAG}",
        "department_id": context["department_id"],
        "checklist": [], "tracking_mode": "individual", "icon_key": "fan",
    }).json()
    a = auth.post(f"{BASE_URL}/api/assets", json={
        "asset_type_id": at["_id"],
        "station_id": context["station_id"],
        "location_id": context["location_id"],
        "asset_number": f"TEST-STATUS-{TAG}",
    }).json()
    aid = a["_id"]
    try:
        r = auth.patch(f"{BASE_URL}/api/assets/{aid}/status",
                       json={"status": "missing"})
        assert r.status_code == 200 and r.json()["status"] == "missing"
        # GET to verify persisted
        g = auth.get(f"{BASE_URL}/api/assets/{aid}").json()
        assert g["status"] == "missing"

        r2 = auth.patch(f"{BASE_URL}/api/assets/{aid}/status",
                        json={"status": "working"})
        assert r2.status_code == 200 and r2.json()["status"] == "working"

        # invalid
        r3 = auth.patch(f"{BASE_URL}/api/assets/{aid}/status",
                        json={"status": "exploded"})
        assert r3.status_code == 400
    finally:
        auth.delete(f"{BASE_URL}/api/assets/{aid}")
        auth.delete(f"{BASE_URL}/api/asset-types/{at['_id']}")


# ---------- Asset with canvas_x/y + station-canvas aggregate ----------
def test_asset_canvas_position_persists_and_appears_in_canvas(auth, context):
    at = auth.post(f"{BASE_URL}/api/asset-types", json={
        "name": f"TEST_AT_CANVAS_{TAG}",
        "department_id": context["department_id"],
        "checklist": [], "tracking_mode": "individual", "icon_key": "light",
    }).json()
    # Create a fresh sub-zone for clean isolation
    sz = auth.post(f"{BASE_URL}/api/sub-zones", json={
        "name": f"TEST_SZ_CANVAS_{TAG}",
        "code": f"TSZ{TAG}",
        "station_id": context["station_id"],
        "location_id": context["location_id"],
        "order": 99,
    }).json()
    sz_id = sz["_id"]
    a = auth.post(f"{BASE_URL}/api/assets", json={
        "asset_type_id": at["_id"],
        "station_id": context["station_id"],
        "location_id": context["location_id"],
        "sub_zone_id": sz_id,
        "asset_number": f"TEST-CANVAS-{TAG}",
        "canvas_x": 33.3,
        "canvas_y": 66.6,
    })
    assert a.status_code == 200, a.text
    aj = a.json()
    aid = aj["_id"]
    assert aj["canvas_x"] == 33.3 and aj["canvas_y"] == 66.6
    try:
        # station-canvas aggregator
        sc = auth.get(f"{BASE_URL}/api/station-canvas",
                      params={"location_id": context["location_id"]})
        assert sc.status_code == 200, sc.text
        data = sc.json()
        # locate sub-zone in payload
        sub_zones = []
        if isinstance(data, dict):
            sub_zones = data.get("sub_zones") or data.get("subZones") or []
            # could also be nested under locations
            if not sub_zones and data.get("locations"):
                for ll in data["locations"]:
                    sub_zones.extend(ll.get("sub_zones") or [])
        target = next((s for s in sub_zones if s.get("_id") == sz_id or s.get("id") == sz_id), None)
        assert target, f"Sub-zone {sz_id} not in canvas response keys={list(data)[:5] if isinstance(data,dict) else 'list'}"
        assets = target.get("assets") or []
        found = next((x for x in assets if x.get("_id") == aid or x.get("id") == aid), None)
        assert found, "Created asset not present in canvas"
        assert found.get("canvas_x") == 33.3
        assert found.get("canvas_y") == 66.6
        assert "asset_type_icon_hint" in found or "icon_hint" in found or "icon_key" in found
    finally:
        auth.delete(f"{BASE_URL}/api/assets/{aid}")
        auth.delete(f"{BASE_URL}/api/sub-zones/{sz_id}?force=true")
        auth.delete(f"{BASE_URL}/api/asset-types/{at['_id']}")


# ---------- Sub-zone PUT (divider) ----------
def test_sub_zone_update_divider(auth, context):
    sz = auth.post(f"{BASE_URL}/api/sub-zones", json={
        "name": f"TEST_SZ_DIV_{TAG}",
        "code": f"TSD{TAG}",
        "station_id": context["station_id"],
        "location_id": context["location_id"],
        "order": 98,
    }).json()
    sz_id = sz["_id"]
    try:
        r = auth.put(f"{BASE_URL}/api/sub-zones/{sz_id}", json={
            "name": sz["name"],
            "code": sz["code"],
            "station_id": context["station_id"],
            "location_id": context["location_id"],
            "order": 98,
            "has_divider": True,
            "divider_orientation": "horizontal",
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["has_divider"] is True
        assert body["divider_orientation"] == "horizontal"
    finally:
        auth.delete(f"{BASE_URL}/api/sub-zones/{sz_id}?force=true")


# ---------- Sub-zone DELETE with conflict + force ----------
def test_sub_zone_delete_force_unassigns_assets(auth, context):
    at = auth.post(f"{BASE_URL}/api/asset-types", json={
        "name": f"TEST_AT_DEL_{TAG}",
        "department_id": context["department_id"],
        "checklist": [], "tracking_mode": "individual", "icon_key": "fan",
    }).json()
    sz = auth.post(f"{BASE_URL}/api/sub-zones", json={
        "name": f"TEST_SZ_DEL_{TAG}",
        "code": f"TSD2{TAG}",
        "station_id": context["station_id"],
        "location_id": context["location_id"],
        "order": 97,
    }).json()
    sz_id = sz["_id"]
    a = auth.post(f"{BASE_URL}/api/assets", json={
        "asset_type_id": at["_id"],
        "station_id": context["station_id"],
        "location_id": context["location_id"],
        "sub_zone_id": sz_id,
        "asset_number": f"TEST-DEL-{TAG}",
        "canvas_x": 10.0, "canvas_y": 10.0,
    }).json()
    aid = a["_id"]
    try:
        # Without force -> 400 ASSETS_ASSIGNED:N
        r = auth.delete(f"{BASE_URL}/api/sub-zones/{sz_id}")
        assert r.status_code == 400, r.text
        detail = r.json().get("detail", "")
        assert "ASSETS_ASSIGNED" in detail

        # With force -> 200, asset unassigned
        r2 = auth.delete(f"{BASE_URL}/api/sub-zones/{sz_id}?force=true")
        assert r2.status_code == 200, r2.text

        # asset should still exist but with sub_zone_id null and canvas cleared
        g = auth.get(f"{BASE_URL}/api/assets/{aid}").json()
        assert g.get("sub_zone_id") in (None, "")
        assert g.get("canvas_x") in (None, 0) or g.get("canvas_x") is None
    finally:
        auth.delete(f"{BASE_URL}/api/assets/{aid}")
        auth.delete(f"{BASE_URL}/api/asset-types/{at['_id']}")


# ---------- Canvas landmarks ----------
def test_canvas_landmarks_create_and_list(auth, context):
    sz = auth.post(f"{BASE_URL}/api/sub-zones", json={
        "name": f"TEST_SZ_LM_{TAG}",
        "code": f"TSL{TAG}",
        "station_id": context["station_id"],
        "location_id": context["location_id"],
        "order": 96,
    }).json()
    sz_id = sz["_id"]
    try:
        r = auth.post(f"{BASE_URL}/api/canvas-landmarks", json={
            "sub_zone_id": sz_id,
            "location_id": context["location_id"],
            "station_id": context["station_id"],
            "label": f"TEST-LM-{TAG}",
            "x": 20.0, "y": 30.0,
        })
        assert r.status_code == 200, r.text
        lm_id = r.json().get("_id") or r.json().get("id")
        g = auth.get(f"{BASE_URL}/api/canvas-landmarks",
                     params={"sub_zone_id": sz_id})
        assert g.status_code == 200
        labels = [x.get("label") for x in g.json()]
        assert f"TEST-LM-{TAG}" in labels
        if lm_id:
            auth.delete(f"{BASE_URL}/api/canvas-landmarks/{lm_id}")
    finally:
        auth.delete(f"{BASE_URL}/api/sub-zones/{sz_id}?force=true")
