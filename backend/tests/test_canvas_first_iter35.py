"""Iteration 35 — Canvas-first asset creation (Platform Vision 2.0 wave).

Coverage:
- POST /api/asset-types strict department validation (missing/empty rejected)
- POST /api/asset-types succeeds with valid payload (+icon_key)
- PUT /api/asset-types/{id} also rejects empty department_id
- POST /api/assets/preview-code with and without sub_zone_id (SZ vs STN token)
- POST /api/assets/auto-create (sub-zone, station-level, override OK, override conflict 409)
- Atomic sequence: two consecutive auto-creates yield -0001 then -0002
- Grouped asset_type: without total_count → 400, with valid total_count → success
- DELETE /api/assets/{id} cascades / works

Auth: SA001 / admin123 (superadmin)
Cleanup: removes any TEST_* fixtures created.
"""
import os
import re
import pytest
import requests
import uuid

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://railway-asset-ops.preview.emergentagent.com").rstrip("/")


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"employee_id": "SA001", "password": "admin123"}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def seed_context(headers):
    """Resolve DHANBAD station, PLATFORM 1 location, Sub-Zone A, an Electrical department."""
    ctx = {}
    stations = requests.get(f"{BASE_URL}/api/stations", headers=headers, timeout=30).json()
    dhn = next((s for s in stations if s.get("name") == "DHANBAD"), None)
    assert dhn, "DHANBAD station missing from seed"
    ctx["station_id"] = dhn["_id"]

    locs = requests.get(f"{BASE_URL}/api/locations?station_id={dhn['_id']}", headers=headers, timeout=30).json()
    p1 = next((l for l in locs if l.get("name") == "PLATFORM 1"), None) or (locs[0] if locs else None)
    assert p1, "No location available under DHANBAD"
    ctx["location_id"] = p1["_id"]

    szs = requests.get(f"{BASE_URL}/api/sub-zones?station_id={dhn['_id']}&location_id={p1['_id']}", headers=headers, timeout=30).json()
    sza = next((s for s in szs if s.get("code") == "SZ-A"), None) or (szs[0] if szs else None)
    ctx["sub_zone_id"] = sza["_id"] if sza else None

    depts = requests.get(f"{BASE_URL}/api/departments", headers=headers, timeout=30).json()
    el = next((d for d in depts if "ELECTR" in (d.get("name") or "").upper()), None) or depts[0]
    ctx["department_id"] = el["_id"]
    return ctx


@pytest.fixture(scope="session")
def cleanup_registry():
    return {"asset_type_ids": [], "asset_ids": []}


@pytest.fixture(scope="session", autouse=True)
def _cleanup(headers, cleanup_registry):
    yield
    for aid in cleanup_registry["asset_ids"]:
        try:
            requests.delete(f"{BASE_URL}/api/assets/{aid}", headers=headers, timeout=20)
        except Exception:
            pass
    for tid in cleanup_registry["asset_type_ids"]:
        try:
            requests.delete(f"{BASE_URL}/api/asset-types/{tid}", headers=headers, timeout=20)
        except Exception:
            pass


# ============ ASSET TYPES strict dept validation ============
class TestAssetTypeDeptValidation:
    def test_missing_department_id_rejected(self, headers):
        r = requests.post(f"{BASE_URL}/api/asset-types", headers=headers,
                          json={"name": f"TEST_NoDept_{uuid.uuid4().hex[:6]}", "checklist": []}, timeout=20)
        assert r.status_code in (400, 422), f"Expected 400/422, got {r.status_code} body={r.text}"
        assert "department" in r.text.lower()

    def test_empty_department_id_rejected(self, headers):
        r = requests.post(f"{BASE_URL}/api/asset-types", headers=headers,
                          json={"name": f"TEST_EmptyDept_{uuid.uuid4().hex[:6]}", "department_id": "", "checklist": []}, timeout=20)
        assert r.status_code == 400
        assert "department" in r.text.lower()

    def test_valid_create_with_icon_key(self, headers, seed_context, cleanup_registry):
        payload = {
            "name": f"TEST_CanvasFan_{uuid.uuid4().hex[:6]}",
            "department_id": seed_context["department_id"],
            "icon_key": "fan",
            "checklist": [],
            "tracking_mode": "individual",
        }
        r = requests.post(f"{BASE_URL}/api/asset-types", headers=headers, json=payload, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == payload["name"]
        assert data["department_id"] == seed_context["department_id"]
        assert data.get("icon_key") == "fan"
        cleanup_registry["asset_type_ids"].append(data["_id"])

    def test_update_rejects_empty_dept(self, headers, seed_context, cleanup_registry):
        # First create a valid one
        c = requests.post(f"{BASE_URL}/api/asset-types", headers=headers, json={
            "name": f"TEST_UpdDept_{uuid.uuid4().hex[:6]}",
            "department_id": seed_context["department_id"], "checklist": []
        }, timeout=20).json()
        cleanup_registry["asset_type_ids"].append(c["_id"])
        r = requests.put(f"{BASE_URL}/api/asset-types/{c['_id']}", headers=headers,
                         json={"name": c["name"], "department_id": "", "checklist": []}, timeout=20)
        assert r.status_code == 400
        assert "department" in r.text.lower()


# ============ Preview code ============
class TestPreviewCode:
    CODE_RE = re.compile(r"^[A-Z0-9-]+-\d{4}$")

    def test_preview_with_subzone_includes_sz(self, headers, seed_context, cleanup_registry):
        # need an asset_type
        at = requests.post(f"{BASE_URL}/api/asset-types", headers=headers, json={
            "name": f"TEST_PreviewSZ_{uuid.uuid4().hex[:6]}",
            "department_id": seed_context["department_id"], "checklist": []
        }, timeout=20).json()
        cleanup_registry["asset_type_ids"].append(at["_id"])
        if not seed_context["sub_zone_id"]:
            pytest.skip("No SZ-A available in seed")
        r = requests.post(f"{BASE_URL}/api/assets/preview-code", headers=headers, json={
            "asset_type_id": at["_id"],
            "sub_zone_id": seed_context["sub_zone_id"],
        }, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        code = data["preview_code"]
        assert self.CODE_RE.match(code), code
        # SZ-A token should appear
        assert "SZ-A" in code, code
        ctx = data["context"]
        assert ctx["sub_zone"] is not None
        assert ctx["station"] == "DHANBAD"

    def test_preview_station_level_uses_stn_token(self, headers, seed_context, cleanup_registry):
        at = requests.post(f"{BASE_URL}/api/asset-types", headers=headers, json={
            "name": f"TEST_PreviewSTN_{uuid.uuid4().hex[:6]}",
            "department_id": seed_context["department_id"], "checklist": []
        }, timeout=20).json()
        cleanup_registry["asset_type_ids"].append(at["_id"])
        r = requests.post(f"{BASE_URL}/api/assets/preview-code", headers=headers, json={
            "asset_type_id": at["_id"],
            "station_id": seed_context["station_id"],
        }, timeout=20)
        assert r.status_code == 200, r.text
        code = r.json()["preview_code"]
        assert self.CODE_RE.match(code)
        # When no location bound, loc fallback is "STN"
        # Pattern: ZONE-DIV-DHN-STN-TYP-NNNN (no SZ between)
        parts = code.split("-")
        assert "STN" in parts, code


# ============ Auto-create ============
class TestAutoCreate:
    def test_subzone_autocreate_enriched(self, headers, seed_context, cleanup_registry):
        at = requests.post(f"{BASE_URL}/api/asset-types", headers=headers, json={
            "name": f"TEST_AC_SZ_{uuid.uuid4().hex[:6]}",
            "department_id": seed_context["department_id"], "checklist": [],
        }, timeout=20).json()
        cleanup_registry["asset_type_ids"].append(at["_id"])
        if not seed_context["sub_zone_id"]:
            pytest.skip("No SZ-A in seed")
        r = requests.post(f"{BASE_URL}/api/assets/auto-create", headers=headers, json={
            "asset_type_id": at["_id"],
            "sub_zone_id": seed_context["sub_zone_id"],
            "canvas_x": 12.5, "canvas_y": 30.0,
            "description": "TEST_canvas_drop",
        }, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        cleanup_registry["asset_ids"].append(data["_id"])
        # enrichment fields
        for f in ("asset_type_name", "station_name", "location_name", "sub_zone_name"):
            assert f in data, f"missing field {f} in {data.keys()}"
        assert data["asset_type_name"] == at["name"]
        assert data["station_name"] == "DHANBAD"
        assert data["sub_zone_name"] in ("Sub-Zone A", "SUB-ZONE A", None) or data["sub_zone_name"]
        # code format
        assert re.match(r"^[A-Z0-9-]+-\d{4}$", data["asset_number"]), data["asset_number"]
        assert "SZ-A" in data["asset_number"]

    def test_station_level_autocreate(self, headers, seed_context, cleanup_registry):
        at = requests.post(f"{BASE_URL}/api/asset-types", headers=headers, json={
            "name": f"TEST_AC_STN_{uuid.uuid4().hex[:6]}",
            "department_id": seed_context["department_id"], "checklist": [],
        }, timeout=20).json()
        cleanup_registry["asset_type_ids"].append(at["_id"])
        r = requests.post(f"{BASE_URL}/api/assets/auto-create", headers=headers, json={
            "asset_type_id": at["_id"],
            "station_id": seed_context["station_id"],
        }, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        cleanup_registry["asset_ids"].append(data["_id"])
        assert "STN" in data["asset_number"].split("-")
        assert data["sub_zone_name"] is None

    def test_sequence_atomicity(self, headers, seed_context, cleanup_registry):
        at = requests.post(f"{BASE_URL}/api/asset-types", headers=headers, json={
            "name": f"TEST_SEQ_{uuid.uuid4().hex[:6]}",
            "department_id": seed_context["department_id"], "checklist": [],
        }, timeout=20).json()
        cleanup_registry["asset_type_ids"].append(at["_id"])
        body = {"asset_type_id": at["_id"], "station_id": seed_context["station_id"]}
        a1 = requests.post(f"{BASE_URL}/api/assets/auto-create", headers=headers, json=body, timeout=30).json()
        a2 = requests.post(f"{BASE_URL}/api/assets/auto-create", headers=headers, json=body, timeout=30).json()
        cleanup_registry["asset_ids"].extend([a1["_id"], a2["_id"]])
        seq1 = int(a1["asset_number"].rsplit("-", 1)[-1])
        seq2 = int(a2["asset_number"].rsplit("-", 1)[-1])
        assert seq2 == seq1 + 1, f"Expected consecutive sequence, got {seq1} then {seq2}"
        # First brand-new type should start at 0001 (atomic counter is per bucket, but bucket is new since type token is unique)
        assert seq1 == 1
        assert seq2 == 2

    def test_override_sets_exact_code(self, headers, seed_context, cleanup_registry):
        at = requests.post(f"{BASE_URL}/api/asset-types", headers=headers, json={
            "name": f"TEST_OV_{uuid.uuid4().hex[:6]}",
            "department_id": seed_context["department_id"], "checklist": [],
        }, timeout=20).json()
        cleanup_registry["asset_type_ids"].append(at["_id"])
        code = f"TEST-OVERRIDE-{uuid.uuid4().hex[:8].upper()}"
        r = requests.post(f"{BASE_URL}/api/assets/auto-create", headers=headers, json={
            "asset_type_id": at["_id"],
            "station_id": seed_context["station_id"],
            "asset_number_override": code,
        }, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        cleanup_registry["asset_ids"].append(data["_id"])
        assert data["asset_number"] == code

    def test_override_conflict_returns_409(self, headers, seed_context, cleanup_registry):
        at = requests.post(f"{BASE_URL}/api/asset-types", headers=headers, json={
            "name": f"TEST_OV2_{uuid.uuid4().hex[:6]}",
            "department_id": seed_context["department_id"], "checklist": [],
        }, timeout=20).json()
        cleanup_registry["asset_type_ids"].append(at["_id"])
        code = f"TEST-DUP-{uuid.uuid4().hex[:8].upper()}"
        r1 = requests.post(f"{BASE_URL}/api/assets/auto-create", headers=headers, json={
            "asset_type_id": at["_id"], "station_id": seed_context["station_id"],
            "asset_number_override": code,
        }, timeout=30)
        assert r1.status_code == 200, r1.text
        cleanup_registry["asset_ids"].append(r1.json()["_id"])
        r2 = requests.post(f"{BASE_URL}/api/assets/auto-create", headers=headers, json={
            "asset_type_id": at["_id"], "station_id": seed_context["station_id"],
            "asset_number_override": code,
        }, timeout=30)
        assert r2.status_code == 409, f"Expected 409, got {r2.status_code} {r2.text}"

    def test_grouped_requires_total_count(self, headers, seed_context, cleanup_registry):
        at = requests.post(f"{BASE_URL}/api/asset-types", headers=headers, json={
            "name": f"TEST_GRP_{uuid.uuid4().hex[:6]}",
            "department_id": seed_context["department_id"],
            "tracking_mode": "grouped",
            "checklist": [],
        }, timeout=20).json()
        cleanup_registry["asset_type_ids"].append(at["_id"])
        if not seed_context["sub_zone_id"]:
            pytest.skip("No SZ-A in seed")
        # Missing total_count → 400
        r_bad = requests.post(f"{BASE_URL}/api/assets/auto-create", headers=headers, json={
            "asset_type_id": at["_id"], "sub_zone_id": seed_context["sub_zone_id"],
        }, timeout=30)
        assert r_bad.status_code == 400, r_bad.text
        # Valid total_count → 200
        r_ok = requests.post(f"{BASE_URL}/api/assets/auto-create", headers=headers, json={
            "asset_type_id": at["_id"], "sub_zone_id": seed_context["sub_zone_id"],
            "total_count": 50,
        }, timeout=30)
        assert r_ok.status_code == 200, r_ok.text
        data = r_ok.json()
        cleanup_registry["asset_ids"].append(data["_id"])
        assert data["total_count"] == 50
        assert data["tracking_mode"] == "grouped"

    def test_delete_works(self, headers, seed_context, cleanup_registry):
        at = requests.post(f"{BASE_URL}/api/asset-types", headers=headers, json={
            "name": f"TEST_DEL_{uuid.uuid4().hex[:6]}",
            "department_id": seed_context["department_id"], "checklist": [],
        }, timeout=20).json()
        cleanup_registry["asset_type_ids"].append(at["_id"])
        a = requests.post(f"{BASE_URL}/api/assets/auto-create", headers=headers, json={
            "asset_type_id": at["_id"], "station_id": seed_context["station_id"],
        }, timeout=30).json()
        d = requests.delete(f"{BASE_URL}/api/assets/{a['_id']}", headers=headers, timeout=20)
        assert d.status_code in (200, 204), d.text
        g = requests.get(f"{BASE_URL}/api/assets/{a['_id']}", headers=headers, timeout=20)
        assert g.status_code == 404
