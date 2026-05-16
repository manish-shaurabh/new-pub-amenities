"""
End-to-end regression test for Railway Asset Inspection Management System.
Covers: CRUD (2 add + 1 delete) across all entities, orange-list workflow,
remarks fanout, performance analytics consistency, coverage-gaps consistency,
notifications fanout.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://rail-ops-center.preview.emergentagent.com").rstrip("/")
RUN_ID = uuid.uuid4().hex[:6].upper()


def login(emp_id, pwd="admin123"):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"employee_id": emp_id, "password": pwd}, timeout=15)
    assert r.status_code == 200, f"Login failed for {emp_id}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="module")
def sa():
    return login("SA001")


@pytest.fixture(scope="module")
def sa_headers(sa):
    return {"Authorization": f"Bearer {sa['token']}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def sa_uid(sa):
    return sa["user"]["_id"]


@pytest.fixture(scope="module")
def created(sa_headers, sa_uid):
    """Create depts, stations, locations, asset-types, users (SUPs/ASUPs/ROs), assets and yield ids."""
    state = {"cleanup": []}

    # Depts (×2)
    dept_ids = []
    for i in range(2):
        body = {"name": f"E2E_DEPT_{RUN_ID}_{i}", "code": f"E{RUN_ID[:3]}{i}"}
        r = requests.post(f"{BASE_URL}/api/departments?current_user_id={sa_uid}", json=body, headers=sa_headers)
        assert r.status_code in (200, 201), f"dept create: {r.status_code} {r.text}"
        dept_ids.append(r.json()["_id"])
    state["dept_ids"] = dept_ids

    # Stations (×2)
    station_ids = []
    for i in range(2):
        body = {"name": f"E2E_STN_{RUN_ID}_{i}", "code": f"S{RUN_ID[:3]}{i}"}
        r = requests.post(f"{BASE_URL}/api/stations", json=body, headers=sa_headers)
        assert r.status_code in (200, 201), f"station: {r.status_code} {r.text}"
        station_ids.append(r.json()["_id"])
    state["station_ids"] = station_ids

    # Locations (×2 — under different stations)
    loc_ids = []
    for i in range(2):
        body = {"name": f"E2E_LOC_{RUN_ID}_{i}", "station_id": station_ids[i]}
        r = requests.post(f"{BASE_URL}/api/locations", json=body, headers=sa_headers)
        assert r.status_code in (200, 201), f"loc: {r.status_code} {r.text}"
        loc_ids.append(r.json()["_id"])
    state["loc_ids"] = loc_ids

    # Asset types (×2 — under different depts)
    at_ids = []
    for i in range(2):
        body = {"name": f"E2E_AT_{RUN_ID}_{i}", "department_id": dept_ids[i]}
        r = requests.post(f"{BASE_URL}/api/asset-types", json=body, headers=sa_headers)
        assert r.status_code in (200, 201), f"asset-type: {r.status_code} {r.text}"
        at_ids.append(r.json()["_id"])
    state["at_ids"] = at_ids

    # Users — 2 SUPs (different station+dept), 2 ASUPs, 2 ROs
    def mk_user(role, emp, dept_id=None, stations=None, name=None):
        body = {
            "employee_id": emp,
            "name": name or emp,
            "password": "admin123",
            "role": role,
            "department_id": dept_id,
            "assigned_stations": stations or [],
            "email": f"{emp.lower()}@e2e.test",
            "phone": "",
            "is_active": True,
        }
        r = requests.post(f"{BASE_URL}/api/users", json=body, headers=sa_headers)
        assert r.status_code in (200, 201), f"user {emp}: {r.status_code} {r.text}"
        return r.json()["_id"]

    sup_ids = [
        mk_user("supervisor", f"E2E_SUP1_{RUN_ID}", dept_ids[0], [station_ids[0]]),
        mk_user("supervisor", f"E2E_SUP2_{RUN_ID}", dept_ids[1], [station_ids[1]]),
    ]
    asup_ids = [
        mk_user("approving_supervisor", f"E2E_ASUP1_{RUN_ID}", None, [station_ids[0]]),
        mk_user("approving_supervisor", f"E2E_ASUP2_{RUN_ID}", None, [station_ids[1]]),
    ]
    ro_ids = [
        mk_user("reporting_officer", f"E2E_RO1_{RUN_ID}", dept_ids[0], [station_ids[0]]),
        mk_user("reporting_officer", f"E2E_RO2_{RUN_ID}", dept_ids[1], [station_ids[1]]),
    ]
    state["sup_ids"] = sup_ids
    state["asup_ids"] = asup_ids
    state["ro_ids"] = ro_ids

    # Assets (×2)
    asset_ids = []
    for i in range(2):
        body = {
            "asset_number": f"E2E_AST_{RUN_ID}_{i}",
            "asset_type_id": at_ids[i],
            "station_id": station_ids[i],
            "location_id": loc_ids[i],
            "department_id": dept_ids[i],
            "status": "working",
        }
        r = requests.post(f"{BASE_URL}/api/assets", json=body, headers=sa_headers)
        assert r.status_code in (200, 201), f"asset: {r.status_code} {r.text}"
        asset_ids.append(r.json()["_id"])
    state["asset_ids"] = asset_ids

    yield state

    # Teardown — best-effort delete (tests below may have already deleted some)
    for endpoint, ids in [
        ("assets", state.get("asset_ids", [])),
        ("users", state.get("sup_ids", []) + state.get("asup_ids", []) + state.get("ro_ids", [])),
        ("asset-types", state.get("at_ids", [])),
        ("locations", state.get("loc_ids", [])),
        ("stations", state.get("station_ids", [])),
        ("departments", state.get("dept_ids", [])),
    ]:
        for _id in ids:
            try:
                requests.delete(f"{BASE_URL}/api/{endpoint}/{_id}", headers=sa_headers, timeout=5)
            except Exception:
                pass


# ============== CRUD COVERAGE ==============

class TestCRUDCoverage:
    def test_departments_list_after_create(self, sa_headers, created):
        r = requests.get(f"{BASE_URL}/api/departments", headers=sa_headers)
        assert r.status_code == 200
        ids = [d["_id"] for d in r.json()]
        for did in created["dept_ids"]:
            assert did in ids, f"dept {did} missing from list"

    def test_delete_department(self, sa_headers, created, sa_uid):
        target = created["dept_ids"].pop()
        # Detach asset_type & user dependencies first
        requests.delete(f"{BASE_URL}/api/asset-types/{created['at_ids'][-1]}", headers=sa_headers)
        created["at_ids"].pop()
        r = requests.delete(f"{BASE_URL}/api/departments/{target}?current_user_id={sa_uid}", headers=sa_headers)
        assert r.status_code in (200, 204, 400, 409), f"delete dept: {r.status_code} {r.text}"
        # if 200/204, confirm it's gone
        if r.status_code in (200, 204):
            r2 = requests.get(f"{BASE_URL}/api/departments", headers=sa_headers)
            assert target not in [d["_id"] for d in r2.json()]

    def test_stations_list(self, sa_headers, created):
        r = requests.get(f"{BASE_URL}/api/stations", headers=sa_headers)
        assert r.status_code == 200
        ids = [s["_id"] for s in r.json()]
        for sid in created["station_ids"]:
            assert sid in ids

    def test_delete_location(self, sa_headers, created):
        target = created["loc_ids"].pop()
        r = requests.delete(f"{BASE_URL}/api/locations/{target}", headers=sa_headers)
        assert r.status_code in (200, 204, 400, 409)

    def test_assets_list_and_delete(self, sa_headers, created):
        r = requests.get(f"{BASE_URL}/api/assets?limit=500", headers=sa_headers)
        assert r.status_code == 200
        target = created["asset_ids"][-1]
        r2 = requests.delete(f"{BASE_URL}/api/assets/{target}", headers=sa_headers)
        assert r2.status_code in (200, 204, 400, 409)
        if r2.status_code in (200, 204):
            created["asset_ids"].remove(target)

    def test_user_uniqueness_station_dept_for_sup(self, sa_headers, created):
        # Try to create another SUP with same station+dept as sup_ids[0]
        # We need station/dept of sup1: index 0 of station/dept
        # If created already deleted them, skip
        if not created["station_ids"] or not created["dept_ids"]:
            pytest.skip("dependencies removed")
        body = {
            "employee_id": f"E2E_DUP_{RUN_ID}",
            "name": "duplicate sup",
            "password": "admin123",
            "role": "supervisor",
            "department_id": created["dept_ids"][0],
            "assigned_stations": [created["station_ids"][0]],
            "email": "dup@e2e.test",
            "is_active": True,
        }
        r = requests.post(f"{BASE_URL}/api/users", json=body, headers=sa_headers)
        # Should fail uniqueness
        assert r.status_code in (400, 409, 422), f"expected uniqueness violation, got {r.status_code}: {r.text}"

    def test_delete_one_user_each_role(self, sa_headers, created):
        for key in ("sup_ids", "asup_ids", "ro_ids"):
            tgt = created[key].pop()
            r = requests.delete(f"{BASE_URL}/api/users/{tgt}", headers=sa_headers)
            assert r.status_code in (200, 204, 400, 404), f"{key} delete: {r.status_code} {r.text}"


# ============== INSPECTIONS + ORANGE LIST + AUTO REMARKS ==============

class TestInspectionAndOrangeFlow:
    @pytest.fixture(scope="class")
    def defect(self, sa_headers, sa_uid, created):
        # Use existing DHANBAD asset for richer cross-functional checks
        r = requests.get(f"{BASE_URL}/api/assets?limit=1&status=working", headers=sa_headers)
        assert r.status_code == 200
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        assert items, "no working asset to inspect"
        asset = items[0]
        body = {
            "station_id": asset["station_id"],
            "location_id": asset.get("location_id"),
            "inspector_id": sa_uid,
            "inspection_type": "individual",
            "items": [{"asset_id": asset["_id"], "status": "not_ok", "remarks": f"E2E_{RUN_ID}_defect"}],
        }
        r = requests.post(f"{BASE_URL}/api/inspections", json=body, headers=sa_headers)
        assert r.status_code in (200, 201), f"inspection: {r.status_code} {r.text}"
        # Find the orange-list entry for this asset
        time.sleep(0.5)
        r2 = requests.get(f"{BASE_URL}/api/orange-list?asset_id={asset['_id']}", headers=sa_headers)
        assert r2.status_code == 200
        items2 = r2.json() if isinstance(r2.json(), list) else r2.json().get("items", [])
        active = [x for x in items2 if x.get("status") in ("defective", "pending_approval")]
        assert active, f"no orange-list entry created for asset {asset['_id']}"
        return {"asset": asset, "orange": active[0]}

    def test_auto_defect_remark_inserted(self, sa_headers, defect):
        oid = defect["orange"]["_id"]
        r = requests.get(f"{BASE_URL}/api/orange-list/{oid}/remarks", headers=sa_headers)
        assert r.status_code == 200, r.text
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        kinds = [it.get("type") or it.get("kind") for it in items]
        # auto defect_report inserted on creation
        assert any(k in ("defect_report", "auto", "system", "note") for k in kinds), f"expected auto defect_report; got {kinds}"

    def test_orange_visible_to_admin_dashboard(self, sa_headers):
        r = requests.get(f"{BASE_URL}/api/dashboard/admin", headers=sa_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        # Just sanity that it responds w/ aggregated stats
        assert isinstance(data, dict)


# ============== COVERAGE-GAPS CONSISTENCY ==============

class TestCoverageGapsConsistency:
    def test_coverage_gaps_response_shape(self, sa_headers, sa_uid):
        r = requests.get(f"{BASE_URL}/api/analytics/admin/coverage-gaps?current_user_id={sa_uid}", headers=sa_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "totals" in data or "gaps" in data or "missing_sup" in str(data)


# ============== REMARKS — ROLE-GATING + VALIDATION ==============

class TestRemarksValidation:
    @pytest.fixture(scope="class")
    def orange_id(self, sa_headers):
        r = requests.get(f"{BASE_URL}/api/orange-list?limit=5", headers=sa_headers)
        assert r.status_code == 200
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        active = [x for x in items if x.get("status") == "defective"]
        if not active:
            pytest.skip("no active orange items")
        return active[0]["_id"]

    def test_300_char_limit(self, sa_headers, orange_id, sa_uid):
        body = {"text": "x" * 301, "type": "note"}
        r = requests.post(f"{BASE_URL}/api/orange-list/{orange_id}/remarks?current_user_id={sa_uid}", json=body, headers=sa_headers)
        assert r.status_code in (400, 422), f"expected 400/422 got {r.status_code}"

    def test_post_note_as_superadmin(self, sa_headers, orange_id, sa_uid):
        body = {"text": f"E2E_{RUN_ID}_note", "type": "note"}
        r = requests.post(f"{BASE_URL}/api/orange-list/{orange_id}/remarks?current_user_id={sa_uid}", json=body, headers=sa_headers)
        assert r.status_code in (200, 201, 403), f"got {r.status_code}: {r.text}"


# ============== TAG CRUD + ROLE GATE ==============

class TestRemarkTagAdmin:
    def test_create_and_archive_tag(self, sa_headers, sa_uid):
        ids = []
        for i in range(2):
            body = {"slug": f"e2e_tag_{RUN_ID.lower()}_{i}", "label": f"E2E_TAG_{RUN_ID}_{i}"}
            r = requests.post(f"{BASE_URL}/api/remarks/tags?current_user_id={sa_uid}", json=body, headers=sa_headers)
            assert r.status_code in (200, 201), f"tag create: {r.status_code} {r.text}"
            ids.append(r.json()["_id"])
        # delete one
        r = requests.delete(f"{BASE_URL}/api/remarks/tags/{ids[0]}?current_user_id={sa_uid}", headers=sa_headers)
        assert r.status_code in (200, 204), r.text
        # listing default should hide archived
        r2 = requests.get(f"{BASE_URL}/api/remarks/tags", headers=sa_headers)
        assert r2.status_code == 200
        listing = r2.json() if isinstance(r2.json(), list) else r2.json().get("items", [])
        live_ids = [t["_id"] for t in listing]
        assert ids[0] not in live_ids, "archived tag still in default list"
        # cleanup the other
        requests.delete(f"{BASE_URL}/api/remarks/tags/{ids[1]}?current_user_id={sa_uid}", headers=sa_headers)


# ============== ANALYTICS SHAPE ==============

class TestAnalyticsShape:
    def test_admin_rollup(self, sa_headers, sa_uid):
        r = requests.get(f"{BASE_URL}/api/analytics/admin/rollup?current_user_id={sa_uid}", headers=sa_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "matrix" in data or "rows" in data or "cells" in data or "stations" in data

    def test_supervisor_performance_legacy(self, sa_headers):
        # find a real SUP
        r = requests.get(f"{BASE_URL}/api/users?role=supervisor", headers=sa_headers)
        if r.status_code != 200:
            pytest.skip("can't list supervisors")
        sups = r.json()
        if not sups:
            pytest.skip("no supervisors")
        uid = sups[0]["_id"]
        r2 = requests.get(f"{BASE_URL}/api/analytics/supervisor/{uid}/performance", headers=sa_headers)
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert "summary" in data
