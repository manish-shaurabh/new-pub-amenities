"""Iteration 31 - Backend tests for the new Grouped Asset feature.

Coverage:
- SubZone CRUD + delete-refusal when assets reference it
- AssetType tracking_mode default + persistence + update
- Asset create with grouped type: auto asset_number, required sub_zone_id, total_count>0
- Asset list/get enrichment for grouped assets (tracking_mode, sub_zone_name)
- Inspection create with group_counts: status derivation, snapshot persistence,
  asset count update, OL creation; defective_count=0 keeps asset working;
  invalid totals -> 400
- Regression on individual asset inspection flow
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


def _id_of(d):
    """The API serializes Mongo docs with either 'id' or '_id'. Accept both."""
    return d.get("id") or d.get("_id")


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login",
                      json={"employee_id": "SA001", "password": "admin123"})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def ctx(admin_token):
    """Resolve common foreign keys we need."""
    tok = admin_token["token"]
    admin_id = _id_of(admin_token.get("user") or {})
    h = {"Authorization": f"Bearer {tok}"}
    params = {"requesting_user_id": admin_id} if admin_id else {}
    stations = requests.get(f"{API}/stations", headers=h, params=params).json()
    dhn = next(s for s in stations if s.get("code") == "DHN" or s.get("name") == "DHANBAD")
    locations = requests.get(f"{API}/locations",
                             headers=h, params={**params, "station_id": _id_of(dhn)}).json()
    loc = next((l for l in locations if "PLATFORM 1" in (l.get("name") or "").upper()),
               locations[0])
    depts = requests.get(f"{API}/departments", headers=h, params=params).json()
    elec = next((d for d in depts
                 if (d.get("code") or "").upper().startswith("ELEC")
                 or "ELECTRICAL" in (d.get("name") or "").upper()),
                depts[0])
    inspector_resp = requests.post(f"{API}/auth/login",
                                   json={"employee_id": "SSE001", "password": "admin123"})
    inspector = (inspector_resp.json() or {}).get("user", {}) if inspector_resp.status_code == 200 else {}
    return {
        "headers": h,
        "params": params,
        "station_id": _id_of(dhn),
        "location_id": _id_of(loc),
        "dept_id": _id_of(elec),
        "inspector_id": _id_of(inspector),
    }


# ─────────────────────────  SUB-ZONE CRUD  ─────────────────────────
class TestSubZoneCRUD:
    def test_create_list_update_delete(self, ctx):
        h = ctx["headers"]
        name = f"TEST_SZ_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/sub-zones", headers=h, json={
            "name": name, "code": "TSZ",
            "station_id": ctx["station_id"], "location_id": ctx["location_id"],
        })
        assert r.status_code == 200, r.text
        sz = r.json()
        assert sz["name"] == name and sz["station_id"] == ctx["station_id"]
        sz_id = _id_of(sz)

        # list filter by location
        rl = requests.get(f"{API}/sub-zones?location_id={ctx['location_id']}", headers=h)
        assert rl.status_code == 200 and any(_id_of(x) == sz_id for x in rl.json())

        # update
        ru = requests.put(f"{API}/sub-zones/{sz_id}", headers=h, json={
            "name": name + "_U", "code": "TSZU",
            "station_id": ctx["station_id"], "location_id": ctx["location_id"],
        })
        assert ru.status_code == 200 and ru.json()["name"].endswith("_U")

        # delete
        rd = requests.delete(f"{API}/sub-zones/{sz_id}", headers=h)
        assert rd.status_code == 200

    def test_delete_refuses_when_asset_references_it(self, ctx):
        h = ctx["headers"]
        # 1) create grouped asset type
        at = requests.post(f"{API}/asset-types", headers=h, json={
            "name": f"TEST_AT_{uuid.uuid4().hex[:5]}",
            "department_id": ctx["dept_id"],
            "checklist": [], "tracking_mode": "grouped",
        }).json()
        # 2) create sub-zone
        sz = requests.post(f"{API}/sub-zones", headers=h, json={
            "name": f"TEST_SZ_{uuid.uuid4().hex[:5]}",
            "station_id": ctx["station_id"], "location_id": ctx["location_id"],
        }).json()
        # 3) create asset referencing sub-zone
        ar = requests.post(f"{API}/assets", headers=h, json={
            "asset_type_id": _id_of(at), "station_id": ctx["station_id"],
            "location_id": ctx["location_id"],
            "sub_zone_id": _id_of(sz), "total_count": 50,
        })
        assert ar.status_code == 200, ar.text
        asset = ar.json()
        # 4) deletion must be refused with 400
        rd = requests.delete(f"{API}/sub-zones/{_id_of(sz)}", headers=h)
        assert rd.status_code == 400
        # cleanup
        requests.delete(f"{API}/assets/{_id_of(asset)}", headers=h)
        requests.delete(f"{API}/sub-zones/{_id_of(sz)}", headers=h)
        requests.delete(f"{API}/asset-types/{_id_of(at)}", headers=h)


# ─────────────────────  ASSET TYPE tracking_mode  ─────────────────────
class TestAssetTypeTrackingMode:
    def test_default_is_individual(self, ctx):
        h = ctx["headers"]
        at = requests.post(f"{API}/asset-types", headers=h, json={
            "name": f"TEST_AT_DEF_{uuid.uuid4().hex[:5]}",
            "department_id": ctx["dept_id"], "checklist": [],
        }).json()
        assert at.get("tracking_mode") == "individual"
        requests.delete(f"{API}/asset-types/{_id_of(at)}", headers=h)

    def test_grouped_persists_and_updates(self, ctx):
        h = ctx["headers"]
        at = requests.post(f"{API}/asset-types", headers=h, json={
            "name": f"TEST_AT_GRP_{uuid.uuid4().hex[:5]}",
            "department_id": ctx["dept_id"], "checklist": [],
            "tracking_mode": "grouped",
        }).json()
        assert at["tracking_mode"] == "grouped"

        # update back to individual
        up = requests.put(f"{API}/asset-types/{_id_of(at)}", headers=h, json={
            "name": at["name"], "department_id": ctx["dept_id"],
            "checklist": [], "tracking_mode": "individual",
        }).json()
        assert up["tracking_mode"] == "individual"
        requests.delete(f"{API}/asset-types/{_id_of(at)}", headers=h)


# ─────────────────────  GROUPED ASSET CREATE  ─────────────────────
class TestGroupedAssetCreate:
    @pytest.fixture
    def grouped_type(self, ctx):
        h = ctx["headers"]
        at = requests.post(f"{API}/asset-types", headers=h, json={
            "name": f"TEST_AT_G_{uuid.uuid4().hex[:5]}",
            "department_id": ctx["dept_id"], "checklist": [],
            "tracking_mode": "grouped",
        }).json()
        yield at
        requests.delete(f"{API}/asset-types/{_id_of(at)}", headers=h)

    @pytest.fixture
    def sub_zone(self, ctx):
        h = ctx["headers"]
        sz = requests.post(f"{API}/sub-zones", headers=h, json={
            "name": f"TEST_SZ_C_{uuid.uuid4().hex[:5]}",
            "station_id": ctx["station_id"], "location_id": ctx["location_id"],
        }).json()
        yield sz
        requests.delete(f"{API}/sub-zones/{_id_of(sz)}", headers=h)

    def test_missing_sub_zone_returns_400(self, ctx, grouped_type):
        r = requests.post(f"{API}/assets", headers=ctx["headers"], json={
            "asset_type_id": _id_of(grouped_type),
            "station_id": ctx["station_id"], "location_id": ctx["location_id"],
            "total_count": 10,
        })
        assert r.status_code == 400

    def test_zero_total_count_returns_400(self, ctx, grouped_type, sub_zone):
        r = requests.post(f"{API}/assets", headers=ctx["headers"], json={
            "asset_type_id": _id_of(grouped_type),
            "station_id": ctx["station_id"], "location_id": ctx["location_id"],
            "sub_zone_id": _id_of(sub_zone), "total_count": 0,
        })
        assert r.status_code == 400

    def test_auto_generates_asset_number_and_enriches_list(self, ctx, grouped_type, sub_zone):
        h = ctx["headers"]
        r = requests.post(f"{API}/assets", headers=h, json={
            "asset_type_id": _id_of(grouped_type),
            "station_id": ctx["station_id"], "location_id": ctx["location_id"],
            "sub_zone_id": _id_of(sub_zone), "total_count": 75,
        })
        assert r.status_code == 200, r.text
        a = r.json()
        assert a["asset_number"] and "-" in a["asset_number"]
        assert a["tracking_mode"] == "grouped"
        assert a["total_count"] == 75

        # GET enriches sub_zone_name + tracking_mode
        g = requests.get(f"{API}/assets/{_id_of(a)}", headers=h).json()
        assert g["sub_zone_name"] == sub_zone["name"]
        assert g["tracking_mode"] == "grouped"

        # list endpoint enrichment
        lst = requests.get(f"{API}/assets?station_id={ctx['station_id']}", headers=h).json()
        match = next((x for x in lst if _id_of(x) == _id_of(a)), None)
        assert match and match.get("sub_zone_name") == sub_zone["name"]
        assert match.get("tracking_mode") == "grouped"

        requests.delete(f"{API}/assets/{_id_of(a)}", headers=h)


# ─────────────────────  GROUPED INSPECTION  ─────────────────────
class TestGroupedInspection:
    @pytest.fixture
    def grouped_asset(self, ctx):
        h = ctx["headers"]
        at = requests.post(f"{API}/asset-types", headers=h, json={
            "name": f"TEST_AT_I_{uuid.uuid4().hex[:5]}",
            "department_id": ctx["dept_id"], "checklist": [],
            "tracking_mode": "grouped",
        }).json()
        sz = requests.post(f"{API}/sub-zones", headers=h, json={
            "name": f"TEST_SZ_I_{uuid.uuid4().hex[:5]}",
            "station_id": ctx["station_id"], "location_id": ctx["location_id"],
        }).json()
        a = requests.post(f"{API}/assets", headers=h, json={
            "asset_type_id": _id_of(at), "station_id": ctx["station_id"],
            "location_id": ctx["location_id"],
            "sub_zone_id": _id_of(sz), "total_count": 100,
        }).json()
        yield {"asset": a, "asset_type": at, "sub_zone": sz}
        requests.delete(f"{API}/assets/{_id_of(a)}", headers=h)
        requests.delete(f"{API}/sub-zones/{_id_of(sz)}", headers=h)
        requests.delete(f"{API}/asset-types/{_id_of(at)}", headers=h)

    def test_group_counts_exceeding_total_returns_400(self, ctx, grouped_asset):
        if not ctx["inspector_id"]:
            pytest.skip("inspector not available")
        a = grouped_asset["asset"]
        r = requests.post(f"{API}/inspections", headers=ctx["headers"], json={
            "inspection_type": "individual",
            "station_id": ctx["station_id"],
            "inspector_id": ctx["inspector_id"],
            "items": [{
                "asset_id": _id_of(a), "status": "ok",
                "group_counts": {"needs_repair": 60, "not_working": 50},
            }],
        })
        assert r.status_code == 400, r.text

    def test_defective_zero_keeps_working_no_ol(self, ctx, grouped_asset):
        if not ctx["inspector_id"]:
            pytest.skip("inspector not available")
        h = ctx["headers"]
        a = grouped_asset["asset"]
        r = requests.post(f"{API}/inspections", headers=h, json={
            "inspection_type": "individual",
            "station_id": ctx["station_id"],
            "inspector_id": ctx["inspector_id"],
            "items": [{
                "asset_id": _id_of(a), "status": "ok",
                "group_counts": {"needs_repair": 0, "not_working": 0},
            }],
        })
        assert r.status_code == 200, r.text
        # Asset stays working
        cur = requests.get(f"{API}/assets/{_id_of(a)}", headers=h).json()
        assert cur["status"] == "working"
        # No OL entry should exist for this specific asset
        ol = requests.get(f"{API}/orange-list", headers=h)
        if ol.status_code == 200:
            payload = ol.json()
            entries = payload if isinstance(payload, list) else payload.get("items", [])
            matched = [e for e in entries if e.get("asset_id") == _id_of(a)]
            assert all(e.get("status") == "resolved" for e in matched), \
                f"Unexpected open OL for grouped asset with 0 defects: {matched}"

    def test_group_counts_with_defects_flip_status_and_persist_snapshot(self, ctx, grouped_asset):
        if not ctx["inspector_id"]:
            pytest.skip("inspector not available")
        h = ctx["headers"]
        a = grouped_asset["asset"]
        r = requests.post(f"{API}/inspections", headers=h, json={
            "inspection_type": "individual",
            "station_id": ctx["station_id"],
            "inspector_id": ctx["inspector_id"],
            "items": [{
                "asset_id": _id_of(a), "status": "ok",
                "group_counts": {"needs_repair": 5, "not_working": 3},
                "remarks": "TEST grouped inspection",
            }],
        })
        assert r.status_code == 200, r.text
        body = r.json()
        item = body["items"][0]
        # Derived status flipped to not_ok
        assert item["status"] == "not_ok"
        # Snapshot persisted
        gc = item["group_counts"]
        assert gc["needs_repair"] == 5 and gc["not_working"] == 3
        assert gc["total"] == 100 and gc["defective"] == 8
        assert gc["pct_defective"] == 8.0
        # Asset counts updated
        cur = requests.get(f"{API}/assets/{_id_of(a)}", headers=h).json()
        assert cur["needs_repair_count"] == 5 and cur["not_working_count"] == 3
        assert cur["status"] == "defective"


# ─────────────────────  INDIVIDUAL ASSET REGRESSION  ─────────────────────
class TestIndividualAssetRegression:
    def test_individual_inspection_flow_still_works(self, ctx):
        if not ctx["inspector_id"]:
            pytest.skip("inspector not available")
        h = ctx["headers"]
        # Use any existing working individual asset at DHN
        lst = requests.get(
            f"{API}/assets?station_id={ctx['station_id']}&status=working",
            headers=h,
        ).json()
        individuals = [x for x in lst if (x.get("tracking_mode") or "individual") == "individual"]
        if not individuals:
            pytest.skip("no individual working asset at DHN")
        target = individuals[0]
        r = requests.post(f"{API}/inspections", headers=h, json={
            "inspection_type": "individual",
            "station_id": ctx["station_id"],
            "inspector_id": ctx["inspector_id"],
            "items": [{
                "asset_id": _id_of(target), "status": "not_ok",
                "remarks": "TEST regression - mark defective",
            }],
        })
        assert r.status_code == 200, r.text
        # Asset flipped
        cur = requests.get(f"{API}/assets/{_id_of(target)}", headers=h).json()
        assert cur["status"] == "defective"

        # Restore: mark OK
        r2 = requests.post(f"{API}/inspections", headers=h, json={
            "inspection_type": "individual",
            "station_id": ctx["station_id"],
            "inspector_id": ctx["inspector_id"],
            "items": [{
                "asset_id": _id_of(target), "status": "ok",
                "remarks": "TEST regression - rectified",
            }],
        })
        assert r2.status_code == 200
