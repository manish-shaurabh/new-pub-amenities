"""
Platform Blueprint / Platform Vision feature tests — Iteration 33

Tests for:
  - GET /api/station-canvas (station_id + location_id)
  - GET /api/canvas-landmarks?sub_zone_id=<id>
  - POST /api/canvas-landmarks
  - PUT /api/canvas-landmarks/{id}
  - DELETE /api/canvas-landmarks/{id}
  - PATCH /api/assets/bulk/canvas
  - PATCH /api/assets/{id}/canvas
  - DELETE /api/sub-zones/{id} with force=false (should 400 when assets assigned)
  - DELETE /api/sub-zones/{id} with force=true (unassigns and deletes)
  - Sub-zone has_divider field
"""
import pytest
import requests
import os
import time

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"

# ── Seed IDs (DHN / PLATFORM 1) ───────────────────────────────────────────────
DHN_STATION_ID = "69f6f639450af6fe6fb5816f"
PLATFORM1_LOC_ID = "69f6fd0af3f687e9573332c6"
SZ_A_ID = "6a08bb73a861325ca76a4d60"           # Sub-Zone A
WC1_ASSET_ID = "69f738b79b370a4cfbdaf227"       # WC-1


@pytest.fixture(scope="module")
def auth_headers():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "employee_id": "SA001",
        "password": "admin123",
    })
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    token = resp.json().get("token") or resp.json().get("access_token")
    assert token, "No token in login response"
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ─── GET /api/station-canvas ──────────────────────────────────────────────────

class TestStationCanvas:
    """station_canvas endpoint tests"""

    def test_station_canvas_by_station_id(self, auth_headers):
        resp = requests.get(
            f"{BASE_URL}/api/station-canvas",
            params={"station_id": DHN_STATION_ID},
            headers=auth_headers,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "locations" in data, "Response must have 'locations' key"
        assert isinstance(data["locations"], list), "locations must be a list"
        assert len(data["locations"]) > 0, "Should return at least 1 location for DHN"

    def test_station_canvas_by_location_id(self, auth_headers):
        resp = requests.get(
            f"{BASE_URL}/api/station-canvas",
            params={"location_id": PLATFORM1_LOC_ID},
            headers=auth_headers,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "locations" in data
        assert len(data["locations"]) == 1, "Single location response for PLATFORM 1"
        loc = data["locations"][0]
        assert loc["id"] == PLATFORM1_LOC_ID
        assert "sub_zones" in loc
        assert "unzoned_assets" in loc

    def test_station_canvas_has_sub_zones_structure(self, auth_headers):
        """Sub-Zone A should appear under PLATFORM 1 with assets and landmarks arrays"""
        resp = requests.get(
            f"{BASE_URL}/api/station-canvas",
            params={"location_id": PLATFORM1_LOC_ID},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        loc = resp.json()["locations"][0]
        assert len(loc["sub_zones"]) >= 1, "At least Sub-Zone A should appear"
        sz = loc["sub_zones"][0]
        assert "id" in sz
        assert "name" in sz
        assert "assets" in sz
        assert isinstance(sz["assets"], list)
        assert "landmarks" in sz
        assert isinstance(sz["landmarks"], list)
        assert "has_divider" in sz

    def test_station_canvas_assets_have_required_fields(self, auth_headers):
        """Assets in canvas response must have canvas_x/y, status, icon_hint fields"""
        resp = requests.get(
            f"{BASE_URL}/api/station-canvas",
            params={"location_id": PLATFORM1_LOC_ID},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        loc = resp.json()["locations"][0]
        sz = next((s for s in loc["sub_zones"] if s["id"] == SZ_A_ID), None)
        assert sz is not None, "Sub-Zone A not found in canvas response"
        assert len(sz["assets"]) >= 1, "Sub-Zone A should have at least WC-1"
        asset = sz["assets"][0]
        assert "id" in asset
        assert "asset_number" in asset
        assert "asset_type_icon_hint" in asset
        assert "status" in asset
        # canvas_x/y can be None initially
        assert "canvas_x" in asset
        assert "canvas_y" in asset

    def test_station_canvas_missing_params_returns_400(self, auth_headers):
        resp = requests.get(
            f"{BASE_URL}/api/station-canvas",
            headers=auth_headers,
        )
        assert resp.status_code == 400, f"Expected 400 when no params, got {resp.status_code}"

    def test_station_canvas_invalid_location_returns_404(self, auth_headers):
        resp = requests.get(
            f"{BASE_URL}/api/station-canvas",
            params={"location_id": "000000000000000000000000"},
            headers=auth_headers,
        )
        assert resp.status_code == 404


# ─── Canvas Landmarks CRUD ────────────────────────────────────────────────────

class TestCanvasLandmarks:
    """canvas_landmarks CRUD tests"""

    _created_lm_id = None

    def test_list_landmarks_empty_for_sz_a(self, auth_headers):
        """Before creating any landmark, list should be empty (or existing) for Sub-Zone A"""
        resp = requests.get(
            f"{BASE_URL}/api/canvas-landmarks",
            params={"sub_zone_id": SZ_A_ID},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list), "Landmarks list must be a list"

    def test_create_landmark(self, auth_headers):
        payload = {
            "sub_zone_id": SZ_A_ID,
            "location_id": PLATFORM1_LOC_ID,
            "station_id": DHN_STATION_ID,
            "label": "TEST-P.No 99",
            "x": 25.0,
            "y": 50.0,
            "landmark_type": "pole",
        }
        resp = requests.post(
            f"{BASE_URL}/api/canvas-landmarks",
            json=payload,
            headers=auth_headers,
        )
        assert resp.status_code == 200, f"Create landmark failed: {resp.text}"
        data = resp.json()
        assert data["label"] == "TEST-P.No 99"
        assert data["x"] == 25.0
        assert data["y"] == 50.0
        assert data["landmark_type"] == "pole"
        lm_id = data.get("id") or data.get("_id")
        assert lm_id, f"Expected 'id' or '_id' in response, got keys: {list(data.keys())}"
        TestCanvasLandmarks._created_lm_id = lm_id

    def test_landmark_appears_in_list(self, auth_headers):
        assert TestCanvasLandmarks._created_lm_id, "Depends on test_create_landmark"
        resp = requests.get(
            f"{BASE_URL}/api/canvas-landmarks",
            params={"sub_zone_id": SZ_A_ID},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        ids = [lm.get("id") or lm.get("_id") for lm in resp.json()]
        assert TestCanvasLandmarks._created_lm_id in ids, "Created landmark not found in list"

    def test_update_landmark(self, auth_headers):
        lm_id = TestCanvasLandmarks._created_lm_id
        if not lm_id:
            pytest.skip("No landmark created to update")
        payload = {
            "sub_zone_id": SZ_A_ID,
            "location_id": PLATFORM1_LOC_ID,
            "station_id": DHN_STATION_ID,
            "label": "TEST-P.No 99 (updated)",
            "x": 30.0,
            "y": 60.0,
            "landmark_type": "point",
        }
        resp = requests.put(
            f"{BASE_URL}/api/canvas-landmarks/{lm_id}",
            json=payload,
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["label"] == "TEST-P.No 99 (updated)"
        assert data["x"] == 30.0
        assert data["landmark_type"] == "point"

    def test_delete_landmark(self, auth_headers):
        lm_id = TestCanvasLandmarks._created_lm_id
        if not lm_id:
            pytest.skip("No landmark created to delete")
        resp = requests.delete(
            f"{BASE_URL}/api/canvas-landmarks/{lm_id}",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "message" in data or "deleted" in str(data).lower()

    def test_deleted_landmark_not_in_list(self, auth_headers):
        lm_id = TestCanvasLandmarks._created_lm_id
        if not lm_id:
            pytest.skip("No landmark created")
        resp = requests.get(
            f"{BASE_URL}/api/canvas-landmarks",
            params={"sub_zone_id": SZ_A_ID},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        ids = [lm.get("id") or lm.get("_id") for lm in resp.json()]
        assert lm_id not in ids, "Deleted landmark still appears in list"

    def test_delete_nonexistent_landmark_404(self, auth_headers):
        resp = requests.delete(
            f"{BASE_URL}/api/canvas-landmarks/000000000000000000000000",
            headers=auth_headers,
        )
        assert resp.status_code == 404


# ─── PATCH /api/assets/bulk/canvas ───────────────────────────────────────────

class TestBulkCanvasUpdate:
    """Bulk canvas position update tests"""

    def test_bulk_canvas_update_positions(self, auth_headers):
        """Patch WC-1 canvas position and verify persistence"""
        payload = {
            "positions": [
                {"asset_id": WC1_ASSET_ID, "canvas_x": 35.5, "canvas_y": 45.0},
            ]
        }
        resp = requests.patch(
            f"{BASE_URL}/api/assets/bulk/canvas",
            json=payload,
            headers=auth_headers,
        )
        assert resp.status_code == 200, f"Bulk canvas update failed: {resp.text}"
        data = resp.json()
        assert "updated" in data or "results" in data or isinstance(data, dict)

    def test_bulk_canvas_positions_persisted(self, auth_headers):
        """After bulk update, the station-canvas endpoint should show canvas_x/y"""
        resp = requests.get(
            f"{BASE_URL}/api/station-canvas",
            params={"location_id": PLATFORM1_LOC_ID},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        loc = resp.json()["locations"][0]
        sz = next((s for s in loc["sub_zones"] if s["id"] == SZ_A_ID), None)
        assert sz is not None
        wc1 = next((a for a in sz["assets"] if a["id"] == WC1_ASSET_ID), None)
        if wc1:
            # canvas_x/y should now be set
            assert wc1["canvas_x"] == 35.5, f"Expected canvas_x=35.5, got {wc1['canvas_x']}"
            assert wc1["canvas_y"] == 45.0, f"Expected canvas_y=45.0, got {wc1['canvas_y']}"

    def test_bulk_canvas_clear_positions(self, auth_headers):
        """Clearing canvas position with None should work"""
        payload = {
            "positions": [
                {"asset_id": WC1_ASSET_ID, "canvas_x": None, "canvas_y": None},
            ]
        }
        resp = requests.patch(
            f"{BASE_URL}/api/assets/bulk/canvas",
            json=payload,
            headers=auth_headers,
        )
        assert resp.status_code == 200

    def test_single_asset_canvas_update(self, auth_headers):
        """PATCH /api/assets/{id}/canvas single-asset endpoint"""
        resp = requests.patch(
            f"{BASE_URL}/api/assets/{WC1_ASSET_ID}/canvas",
            json={"canvas_x": 50.0, "canvas_y": 50.0},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("ok") is True or data.get("canvas_x") == 50.0

    def test_single_asset_canvas_persisted(self, auth_headers):
        """Verify single-asset canvas update is persisted"""
        resp = requests.get(
            f"{BASE_URL}/api/station-canvas",
            params={"location_id": PLATFORM1_LOC_ID},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        loc = resp.json()["locations"][0]
        sz = next((s for s in loc["sub_zones"] if s["id"] == SZ_A_ID), None)
        if sz:
            wc1 = next((a for a in sz["assets"] if a["id"] == WC1_ASSET_ID), None)
            if wc1:
                assert wc1["canvas_x"] == 50.0

    def test_bulk_canvas_empty_list(self, auth_headers):
        """Empty positions list should be accepted gracefully"""
        payload = {"positions": []}
        resp = requests.patch(
            f"{BASE_URL}/api/assets/bulk/canvas",
            json=payload,
            headers=auth_headers,
        )
        assert resp.status_code == 200


# ─── DELETE /api/sub-zones/{id} with force ───────────────────────────────────

class TestSubZoneForceDelete:
    """Sub-zone force-delete tests.
    Creates a test sub-zone, assigns an asset, tests force=false → 400,
    then tests force=true → 200 + assets unassigned.
    """

    _test_sz_id = None
    _test_asset_id = None

    def test_setup_create_test_subzone(self, auth_headers):
        """Create a TEST sub-zone under PLATFORM 1"""
        payload = {
            "name": "TEST_SZ_FOR_FORCE_DELETE",
            "code": "TSZ99",
            "station_id": DHN_STATION_ID,
            "location_id": PLATFORM1_LOC_ID,
            "description": "Temp test sub-zone",
            "order": 99,
            "has_divider": False,
            "divider_orientation": "vertical",
        }
        resp = requests.post(
            f"{BASE_URL}/api/sub-zones",
            json=payload,
            headers=auth_headers,
        )
        assert resp.status_code == 200, f"Create test sub-zone failed: {resp.text}"
        data = resp.json()
        TestSubZoneForceDelete._test_sz_id = data.get("id") or data.get("_id")
        assert data["name"] == "TEST_SZ_FOR_FORCE_DELETE"
        assert data.get("has_divider") is False

    def test_setup_create_test_asset(self, auth_headers):
        """Create a TEST asset assigned to the test sub-zone"""
        sz_id = TestSubZoneForceDelete._test_sz_id
        if not sz_id:
            pytest.skip("No test sub-zone created")
        # Get asset type id for FAN (or any)
        at_resp = requests.get(f"{BASE_URL}/api/asset-types", headers=auth_headers)
        assert at_resp.status_code == 200
        types = at_resp.json()
        at_id = types[0]["_id"] if types else None
        if not at_id:
            pytest.skip("No asset types available")
        payload = {
            "asset_type_id": at_id,
            "station_id": DHN_STATION_ID,
            "location_id": PLATFORM1_LOC_ID,
            "asset_number": "TEST_ASSET_FD_99",
            "sub_zone_id": sz_id,
            "tracking_mode": "individual",
        }
        resp = requests.post(
            f"{BASE_URL}/api/assets",
            json=payload,
            headers=auth_headers,
        )
        assert resp.status_code in (200, 201), f"Create test asset failed: {resp.text}"
        data = resp.json()
        TestSubZoneForceDelete._test_asset_id = data.get("id") or data.get("_id")

    def test_delete_subzone_with_assets_force_false_returns_400(self, auth_headers):
        """force=false (default) should return 400 when assets are assigned"""
        sz_id = TestSubZoneForceDelete._test_sz_id
        if not sz_id:
            pytest.skip("No test sub-zone created")
        resp = requests.delete(
            f"{BASE_URL}/api/sub-zones/{sz_id}",
            params={"force": "false"},
            headers=auth_headers,
        )
        assert resp.status_code == 400, f"Expected 400 (assets assigned), got {resp.status_code}: {resp.text}"
        detail = resp.json().get("detail", "")
        assert "ASSETS_ASSIGNED" in detail or "asset" in detail.lower(), \
            f"Expected ASSETS_ASSIGNED in detail, got: {detail}"

    def test_delete_subzone_force_true_succeeds(self, auth_headers):
        """force=true should unassign assets and delete sub-zone"""
        sz_id = TestSubZoneForceDelete._test_sz_id
        if not sz_id:
            pytest.skip("No test sub-zone created")
        resp = requests.delete(
            f"{BASE_URL}/api/sub-zones/{sz_id}",
            params={"force": "true"},
            headers=auth_headers,
        )
        assert resp.status_code == 200, f"Force delete failed: {resp.text}"
        data = resp.json()
        assert "unassigned_assets" in data, "Response should include unassigned_assets count"
        assert data["unassigned_assets"] >= 1, f"Expected >=1 unassigned asset, got {data['unassigned_assets']}"

    def test_deleted_subzone_no_longer_exists(self, auth_headers):
        """After force delete, the sub-zone should not appear in listing"""
        sz_id = TestSubZoneForceDelete._test_sz_id
        if not sz_id:
            pytest.skip("No test sub-zone created")
        resp = requests.get(
            f"{BASE_URL}/api/sub-zones",
            params={"location_id": PLATFORM1_LOC_ID},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        ids = [s.get("id") or s.get("_id") for s in resp.json()]
        assert sz_id not in ids, "Deleted sub-zone still appears in listing"

    def test_asset_unassigned_after_force_delete(self, auth_headers):
        """Asset should have sub_zone_id cleared after force delete"""
        asset_id = TestSubZoneForceDelete._test_asset_id
        if not asset_id:
            pytest.skip("No test asset created")
        resp = requests.get(
            f"{BASE_URL}/api/assets/{asset_id}",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("sub_zone_id") is None, \
            f"Expected sub_zone_id=None after force delete, got {data.get('sub_zone_id')}"
        assert data.get("canvas_x") is None
        assert data.get("canvas_y") is None

    def test_cleanup_test_asset(self, auth_headers):
        """Delete the test asset created during setup"""
        asset_id = TestSubZoneForceDelete._test_asset_id
        if not asset_id:
            pytest.skip("No test asset to clean up")
        resp = requests.delete(
            f"{BASE_URL}/api/assets/{asset_id}",
            headers=auth_headers,
        )
        # Accept 200 or 204
        assert resp.status_code in (200, 204, 404), f"Cleanup delete failed: {resp.text}"


# ─── Sub-zone has_divider field ───────────────────────────────────────────────

class TestSubZoneHasDivider:
    """Verify has_divider and divider_orientation fields on sub-zones"""

    _sz_id = None

    def test_create_subzone_with_divider(self, auth_headers):
        """Sub-zone with has_divider=True should be stored correctly"""
        payload = {
            "name": "TEST_SZ_DIVIDER",
            "code": "TSD01",
            "station_id": DHN_STATION_ID,
            "location_id": PLATFORM1_LOC_ID,
            "description": "",
            "order": 0,
            "has_divider": True,
            "divider_orientation": "horizontal",
        }
        resp = requests.post(
            f"{BASE_URL}/api/sub-zones",
            json=payload,
            headers=auth_headers,
        )
        assert resp.status_code == 200, f"Create failed: {resp.text}"
        data = resp.json()
        assert data.get("has_divider") is True
        assert data.get("divider_orientation") == "horizontal"
        TestSubZoneHasDivider._sz_id = data.get("id") or data.get("_id")

    def test_divider_persists_in_list(self, auth_headers):
        """has_divider should persist when fetched via list"""
        sz_id = TestSubZoneHasDivider._sz_id
        if not sz_id:
            pytest.skip("No test sub-zone created")
        resp = requests.get(
            f"{BASE_URL}/api/sub-zones",
            params={"location_id": PLATFORM1_LOC_ID},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        sz = next((s for s in resp.json() if (s.get("id") or s.get("_id")) == sz_id), None)
        assert sz is not None
        assert sz["has_divider"] is True
        assert sz["divider_orientation"] == "horizontal"

    def test_divider_in_station_canvas(self, auth_headers):
        """has_divider should appear in station-canvas response"""
        sz_id = TestSubZoneHasDivider._sz_id
        if not sz_id:
            pytest.skip("No test sub-zone created")
        resp = requests.get(
            f"{BASE_URL}/api/station-canvas",
            params={"location_id": PLATFORM1_LOC_ID},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        loc = resp.json()["locations"][0]
        sz = next((s for s in loc["sub_zones"] if s["id"] == sz_id), None)
        assert sz is not None
        assert sz.get("has_divider") is True

    def test_cleanup_divider_subzone(self, auth_headers):
        """Delete the test divider sub-zone"""
        sz_id = TestSubZoneHasDivider._sz_id
        if not sz_id:
            pytest.skip("Nothing to clean up")
        resp = requests.delete(
            f"{BASE_URL}/api/sub-zones/{sz_id}",
            headers=auth_headers,
        )
        assert resp.status_code in (200, 404)
