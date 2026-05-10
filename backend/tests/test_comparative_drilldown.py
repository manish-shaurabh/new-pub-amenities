"""Test the new 4-level drilldown + radar endpoints for Comparative Reports."""
import os
import requests
import pytest

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')


@pytest.fixture(scope="module")
def sa_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"employee_id": "SA001", "password": "admin123"})
    assert r.status_code == 200, r.text
    data = r.json()
    return data.get("token") or data.get("access_token"), data["user"]


@pytest.fixture(scope="module")
def sup_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"employee_id": "SSE001", "password": "admin123"})
    assert r.status_code == 200, r.text
    data = r.json()
    return data.get("token") or data.get("access_token"), data["user"]


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


# ── Drilldown level=station ────────────────────────────────────────────────
def test_grouped_station_level(sa_token):
    tok, user = sa_token
    r = requests.get(
        f"{BASE_URL}/api/reports/comparative/grouped/{user['_id']}",
        params={"level": "station", "window_days": 90},
        headers=_hdr(tok))
    assert r.status_code == 200, r.text
    data = r.json()
    assert "p90" in data
    assert "groups" in data
    assert "asset_types" in data
    assert "breadcrumbs" in data
    assert data["level"] == "station"
    # Each group should have at least one bar with n>0 (empty stations excluded)
    for g in data["groups"]:
        assert any((b.get("n") or 0) > 0 for b in g["bars"]), \
            f"Empty station {g['label']} not excluded"
    # asset_types meta has color + name
    for t in data["asset_types"]:
        assert "id" in t and "name" in t and "color" in t


# ── level=location_summary ──────────────────────────────────────────────────
def test_grouped_location_summary(sa_token):
    tok, user = sa_token
    # Get a station first
    s = requests.get(
        f"{BASE_URL}/api/reports/comparative/grouped/{user['_id']}",
        params={"level": "station", "window_days": 90}, headers=_hdr(tok)).json()
    if not s["groups"]:
        pytest.skip("No stations with data")
    sid = s["groups"][0]["id"]

    r = requests.get(
        f"{BASE_URL}/api/reports/comparative/grouped/{user['_id']}",
        params={"level": "location_summary", "parent_id": sid, "window_days": 90},
        headers=_hdr(tok))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["level"] == "location_summary"
    assert data["parent_id"] == sid
    # ONE summary bar per location
    for g in data["groups"]:
        assert len(g["bars"]) == 1
        b = g["bars"][0]
        assert b["asset_type"] == "All types"
        assert "asset_count" in b
        # min/max/median should be present (or None)
        for k in ("median", "min", "max", "n"):
            assert k in b


# ── level=location_types ───────────────────────────────────────────────────
def test_grouped_location_types(sa_token):
    tok, user = sa_token
    s = requests.get(
        f"{BASE_URL}/api/reports/comparative/grouped/{user['_id']}",
        params={"level": "station", "window_days": 90}, headers=_hdr(tok)).json()
    if not s["groups"]:
        pytest.skip("No stations")
    sid = s["groups"][0]["id"]
    ls = requests.get(
        f"{BASE_URL}/api/reports/comparative/grouped/{user['_id']}",
        params={"level": "location_summary", "parent_id": sid, "window_days": 90},
        headers=_hdr(tok)).json()
    if not ls["groups"]:
        pytest.skip("No locations with data in first station")
    loc_id = ls["groups"][0]["id"]

    r = requests.get(
        f"{BASE_URL}/api/reports/comparative/grouped/{user['_id']}",
        params={"level": "location_types", "parent_id": loc_id, "window_days": 90},
        headers=_hdr(tok))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["level"] == "location_types"
    for g in data["groups"]:
        assert len(g["bars"]) == 1


# ── level=asset ─────────────────────────────────────────────────────────────
def test_grouped_asset_level(sa_token):
    tok, user = sa_token
    s = requests.get(
        f"{BASE_URL}/api/reports/comparative/grouped/{user['_id']}",
        params={"level": "station", "window_days": 90}, headers=_hdr(tok)).json()
    if not s["groups"]:
        pytest.skip("No stations")
    sid = s["groups"][0]["id"]
    ls = requests.get(
        f"{BASE_URL}/api/reports/comparative/grouped/{user['_id']}",
        params={"level": "location_summary", "parent_id": sid, "window_days": 90},
        headers=_hdr(tok)).json()
    if not ls["groups"]:
        pytest.skip("No locations")
    loc_id = ls["groups"][0]["id"]
    lt = requests.get(
        f"{BASE_URL}/api/reports/comparative/grouped/{user['_id']}",
        params={"level": "location_types", "parent_id": loc_id, "window_days": 90},
        headers=_hdr(tok)).json()
    if not lt["groups"]:
        pytest.skip("No types at location")
    type_id = lt["groups"][0]["id"]

    r = requests.get(
        f"{BASE_URL}/api/reports/comparative/grouped/{user['_id']}",
        params={"level": "asset", "parent_id": loc_id,
                "parent_asset_type_id": type_id, "window_days": 90},
        headers=_hdr(tok))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["level"] == "asset"
    # Per-asset bars within (location, type)
    for g in data["groups"]:
        assert len(g["bars"]) == 1
        assert g["bars"][0]["asset_type_id"] == type_id


# ── dept_id filter cascade ─────────────────────────────────────────────────
def test_grouped_dept_filter(sa_token):
    tok, user = sa_token
    # Get list of departments
    deps = requests.get(f"{BASE_URL}/api/departments", headers=_hdr(tok)).json()
    if not deps:
        pytest.skip("No departments")
    dept_id = deps[0]["_id"]

    r = requests.get(
        f"{BASE_URL}/api/reports/comparative/grouped/{user['_id']}",
        params={"level": "station", "window_days": 90, "dept_id": dept_id},
        headers=_hdr(tok))
    assert r.status_code == 200, r.text
    data = r.json()
    # All asset_types meta should belong to this dept
    types = requests.get(f"{BASE_URL}/api/asset-types", headers=_hdr(tok)).json()
    types_in_dept = {str(t["_id"]) for t in types if t.get("department_id") == dept_id}
    for t in data["asset_types"]:
        assert t["id"] in types_in_dept, \
            f"Type {t['name']} ({t['id']}) not in dept {dept_id}"


# ── by-supervisor-radar ────────────────────────────────────────────────────
def test_radar_endpoint_admin(sa_token):
    tok, user = sa_token
    r = requests.get(
        f"{BASE_URL}/api/reports/comparative/by-supervisor-radar/{user['_id']}",
        params={"window_days": 90}, headers=_hdr(tok))
    assert r.status_code == 200, r.text
    data = r.json()
    assert "axes" in data
    assert "series" in data
    assert "anonymised" in data
    # Admin role: not anonymised
    assert data["anonymised"] is False
    # Each series has values per axis
    axis_count = len(data["axes"])
    for s in data["series"]:
        assert len(s["values"]) == axis_count
        assert "is_self" in s
        assert "label" in s


def test_radar_endpoint_sup_anonymised(sup_token):
    tok, user = sup_token
    r = requests.get(
        f"{BASE_URL}/api/reports/comparative/by-supervisor-radar/{user['_id']}",
        params={"window_days": 90}, headers=_hdr(tok))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["anonymised"] is True
    # Self should be labelled with name; peers as Peer N
    self_count = sum(1 for s in data["series"] if s.get("is_self"))
    assert self_count <= 1
    for s in data["series"]:
        if not s.get("is_self"):
            assert s["label"].startswith("Peer "), f"Peer not anonymised: {s['label']}"
            assert s["supervisor_id"] is None


# ── by-asset-type accepts dept_id ──────────────────────────────────────────
def test_by_asset_type_accepts_dept_id(sa_token):
    tok, user = sa_token
    deps = requests.get(f"{BASE_URL}/api/departments", headers=_hdr(tok)).json()
    if not deps:
        pytest.skip("No departments")
    dept_id = deps[0]["_id"]
    r = requests.get(
        f"{BASE_URL}/api/reports/comparative/by-asset-type/{user['_id']}",
        params={"window_days": 90, "dept_id": dept_id}, headers=_hdr(tok))
    assert r.status_code == 200, r.text
    data = r.json()
    assert "rows" in data


# ── p90 in response ─────────────────────────────────────────────────────────
def test_p90_present_in_grouped_response(sa_token):
    tok, user = sa_token
    r = requests.get(
        f"{BASE_URL}/api/reports/comparative/grouped/{user['_id']}",
        params={"level": "station", "window_days": "all"}, headers=_hdr(tok))
    assert r.status_code == 200
    data = r.json()
    # p90 key is always present (may be None if no values)
    assert "p90" in data


# ── parent_id required for non-root levels ─────────────────────────────────
def test_grouped_missing_parent_id(sa_token):
    tok, user = sa_token
    r = requests.get(
        f"{BASE_URL}/api/reports/comparative/grouped/{user['_id']}",
        params={"level": "location_summary", "window_days": 90}, headers=_hdr(tok))
    assert r.status_code == 400
    r = requests.get(
        f"{BASE_URL}/api/reports/comparative/grouped/{user['_id']}",
        params={"level": "asset", "window_days": 90}, headers=_hdr(tok))
    assert r.status_code == 400
