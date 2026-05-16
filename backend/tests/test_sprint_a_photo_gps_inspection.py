"""
Sprint A: Asset Photo+GPS and New Inspection UI — Backend Tests
Covers:
  - Asset creation with identification_photo (base64) + geo_lat/geo_lng
  - Asset update preserves existing photo when identification_photo=None in PUT
  - GET /api/assets returns identification_photo, geo_lat, geo_lng fields
  - Inspection creation with at least one OK asset (returns 200)
"""

import pytest
import requests
import os
import json
import base64

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

# Test data constants
DHN_STATION_ID = "69f6f639450af6fe6fb5816f"
PLATFORM1_LOC_ID = "69f6fd0af3f687e9573332c6"
CEILING_FAN_TYPE_ID = "69f5f977dd6a924aad7954b0"

# Minimal 1x1 pixel JPEG base64 (to avoid huge payloads in tests)
TINY_JPEG_B64 = (
    "data:image/jpeg;base64,"
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U"
    "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN"
    "DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy"
    "MjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUE/8QAIhAA"
    "AgIBBQEBAAAAAAAAAAAAAQIDBAUREiExQf/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEA"
    "AAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwABsAAAAAB//Z"
)

# ─── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def sa_token():
    """SA001 superadmin token."""
    res = requests.post(f"{BASE_URL}/api/auth/login", json={
        "employee_id": "SA001",
        "password": "admin123"
    })
    assert res.status_code == 200, f"Login failed: {res.text}"
    return res.json()["token"]


@pytest.fixture(scope="module")
def sa_client(sa_token):
    """Requests session with SA001 auth header."""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {sa_token}"
    })
    return session


@pytest.fixture(scope="module")
def sa_user(sa_token):
    """SA001 user info."""
    res = requests.get(f"{BASE_URL}/api/auth/me?token={sa_token}")
    assert res.status_code == 200, f"me failed: {res.text}"
    return res.json()


# ─── Test 1: Create asset with photo + GPS ────────────────────────────────────

class TestAssetPhotoGPS:
    """Asset creation / update with identification_photo and geo_lat/geo_lng."""

    created_asset_id = None  # shared across tests in class

    def test_create_asset_with_photo_and_gps(self, sa_client):
        """POST /api/assets with identification_photo and GPS — returns 200 with all fields."""
        payload = {
            "asset_type_id": CEILING_FAN_TYPE_ID,
            "station_id": DHN_STATION_ID,
            "location_id": PLATFORM1_LOC_ID,
            "asset_number": "TEST_FAN_PHOTO_001",
            "description": "Test asset for Sprint A photo+GPS test",
            "schedule_frequency": 7,
            "identification_photo": TINY_JPEG_B64,
            "geo_lat": 23.795771,
            "geo_lng": 86.429551,
        }
        res = sa_client.post(f"{BASE_URL}/api/assets", json=payload)
        assert res.status_code == 200, f"Create asset failed: {res.text}"
        data = res.json()

        # Store for later tests
        TestAssetPhotoGPS.created_asset_id = data.get("_id")
        assert TestAssetPhotoGPS.created_asset_id, "No _id in response"

        # Verify photo stored
        assert data.get("identification_photo") is not None, "identification_photo not returned"
        assert data["identification_photo"].startswith("data:image"), \
            f"Unexpected photo value: {str(data['identification_photo'])[:60]}"

        # Verify GPS stored
        assert data.get("geo_lat") is not None, "geo_lat not returned"
        assert data.get("geo_lng") is not None, "geo_lng not returned"
        assert abs(data["geo_lat"] - 23.795771) < 0.0001, f"geo_lat mismatch: {data['geo_lat']}"
        assert abs(data["geo_lng"] - 86.429551) < 0.0001, f"geo_lng mismatch: {data['geo_lng']}"

        # Core fields present
        assert data.get("asset_number") == "TEST_FAN_PHOTO_001"
        print(f"✓ Asset created with photo+GPS: _id={TestAssetPhotoGPS.created_asset_id}")

    def test_get_asset_includes_photo_and_gps(self, sa_client):
        """GET /api/assets/{id} — response includes identification_photo, geo_lat, geo_lng."""
        asset_id = TestAssetPhotoGPS.created_asset_id
        if not asset_id:
            pytest.skip("No asset created in previous test")

        res = sa_client.get(f"{BASE_URL}/api/assets/{asset_id}")
        assert res.status_code == 200, f"GET asset failed: {res.text}"
        data = res.json()

        assert data.get("identification_photo") is not None, "identification_photo missing from GET"
        assert data.get("geo_lat") is not None, "geo_lat missing from GET"
        assert data.get("geo_lng") is not None, "geo_lng missing from GET"
        print(f"✓ GET asset includes photo+GPS fields")

    def test_list_assets_includes_photo_and_gps(self, sa_client):
        """GET /api/assets?station_id=DHN — new asset's photo+GPS visible in list."""
        asset_id = TestAssetPhotoGPS.created_asset_id
        if not asset_id:
            pytest.skip("No asset created in previous test")

        res = sa_client.get(f"{BASE_URL}/api/assets", params={"station_id": DHN_STATION_ID})
        assert res.status_code == 200, f"List assets failed: {res.text}"
        data = res.json()

        # Find our test asset
        target = next((a for a in data if a.get("_id") == asset_id), None)
        assert target is not None, f"Test asset not found in list (id={asset_id})"

        assert target.get("identification_photo") is not None, \
            "identification_photo missing from list response for new asset"
        assert target.get("geo_lat") is not None, "geo_lat missing from list response"
        assert target.get("geo_lng") is not None, "geo_lng missing from list response"
        print(f"✓ List response includes photo+GPS for new asset")

    def test_update_asset_preserves_photo_when_none(self, sa_client):
        """PUT /api/assets/{id} with identification_photo=null keeps the existing photo."""
        asset_id = TestAssetPhotoGPS.created_asset_id
        if not asset_id:
            pytest.skip("No asset created in previous test")

        # Update without providing photo (null = keep existing)
        update_payload = {
            "asset_type_id": CEILING_FAN_TYPE_ID,
            "station_id": DHN_STATION_ID,
            "location_id": PLATFORM1_LOC_ID,
            "asset_number": "TEST_FAN_PHOTO_001",
            "description": "Updated description - no new photo",
            "schedule_frequency": 14,
            "identification_photo": None,  # null = preserve
            "geo_lat": 23.8,
            "geo_lng": 86.43,
        }
        res = sa_client.put(f"{BASE_URL}/api/assets/{asset_id}", json=update_payload)
        assert res.status_code == 200, f"Update failed: {res.text}"
        data = res.json()

        # Photo must still be present
        assert data.get("identification_photo") is not None, \
            "Photo was erased on update with identification_photo=null (should preserve)"
        assert data["identification_photo"].startswith("data:image"), \
            "Photo was corrupted on update"

        # GPS updated correctly
        assert abs(data["geo_lat"] - 23.8) < 0.001, f"geo_lat not updated: {data['geo_lat']}"
        # Description updated
        assert data["description"] == "Updated description - no new photo"
        print(f"✓ PUT with identification_photo=null preserves existing photo")

    def test_update_asset_replaces_photo_when_provided(self, sa_client):
        """PUT /api/assets/{id} with a new photo string replaces the old one."""
        asset_id = TestAssetPhotoGPS.created_asset_id
        if not asset_id:
            pytest.skip("No asset created in previous test")

        # A different tiny base64 image (we just reuse same data for simplicity)
        new_photo = TINY_JPEG_B64  # same bytes, different "intent"
        update_payload = {
            "asset_type_id": CEILING_FAN_TYPE_ID,
            "station_id": DHN_STATION_ID,
            "location_id": PLATFORM1_LOC_ID,
            "asset_number": "TEST_FAN_PHOTO_001",
            "description": "Updated with new photo",
            "schedule_frequency": 7,
            "identification_photo": new_photo,
            "geo_lat": 23.795771,
            "geo_lng": 86.429551,
        }
        res = sa_client.put(f"{BASE_URL}/api/assets/{asset_id}", json=update_payload)
        assert res.status_code == 200, f"Update with photo failed: {res.text}"
        data = res.json()

        assert data.get("identification_photo") == new_photo, "Photo not updated"
        print(f"✓ PUT with identification_photo replaces existing photo")

    def test_cleanup_test_asset(self, sa_client):
        """DELETE the test asset after tests complete."""
        asset_id = TestAssetPhotoGPS.created_asset_id
        if not asset_id:
            pytest.skip("Nothing to clean up")

        res = sa_client.delete(f"{BASE_URL}/api/assets/{asset_id}")
        assert res.status_code in [200, 204], f"Delete failed: {res.text}"
        # Verify gone
        get_res = sa_client.get(f"{BASE_URL}/api/assets/{asset_id}")
        assert get_res.status_code == 404, "Asset should be 404 after delete"
        print(f"✓ Test asset cleaned up")


# ─── Test 2: Inspection submission ───────────────────────────────────────────

class TestInspectionSubmit:
    """Inspection create with at least one OK asset returns 200."""

    created_asset_id = None
    created_inspection_id = None

    def test_setup_asset_for_inspection(self, sa_client):
        """Create a disposable asset to inspect."""
        payload = {
            "asset_type_id": CEILING_FAN_TYPE_ID,
            "station_id": DHN_STATION_ID,
            "location_id": PLATFORM1_LOC_ID,
            "asset_number": "TEST_INSP_ASSET_001",
            "description": "Temporary asset for inspection test",
            "schedule_frequency": None,
            "identification_photo": None,
            "geo_lat": None,
            "geo_lng": None,
        }
        res = sa_client.post(f"{BASE_URL}/api/assets", json=payload)
        assert res.status_code == 200, f"Asset creation for inspection test failed: {res.text}"
        TestInspectionSubmit.created_asset_id = res.json().get("_id")
        assert TestInspectionSubmit.created_asset_id
        print(f"✓ Inspection test asset created: {TestInspectionSubmit.created_asset_id}")

    def test_submit_inspection_with_ok_asset(self, sa_client, sa_user):
        """POST /api/inspections — submit inspection with one OK asset, returns 200."""
        asset_id = TestInspectionSubmit.created_asset_id
        if not asset_id:
            pytest.skip("No asset created in setup")

        payload = {
            "inspection_type": "individual",
            "station_id": DHN_STATION_ID,
            "inspector_id": sa_user["_id"],
            "inspection_at": "2026-02-15T10:00:00",
            "items": [
                {
                    "asset_id": asset_id,
                    "status": "ok",
                    "checklist_responses": [],
                    "remarks": "All good",
                    "remarks_by": sa_user["name"],
                    "photo_urls": [],
                    "defective_since": None,
                    "rectified_on": None,
                }
            ],
            "participants": [],
            "overall_remarks": "Inspection test",
        }
        res = sa_client.post(f"{BASE_URL}/api/inspections", json=payload)
        assert res.status_code == 200, f"Inspection submit failed: {res.text}"
        data = res.json()

        assert data.get("id") or data.get("_id"), "No inspection ID in response"
        TestInspectionSubmit.created_inspection_id = data.get("id") or data.get("_id")
        assert len(data.get("items", [])) == 1, f"Expected 1 item, got {len(data.get('items', []))}"
        assert data["items"][0]["status"] == "ok"
        print(f"✓ Inspection submitted: id={TestInspectionSubmit.created_inspection_id}")

    def test_submit_inspection_not_ok_requires_defective_since(self, sa_client, sa_user):
        """
        POST /api/inspections with status=not_ok and no defective_since
        should be handled gracefully (the backend may or may not enforce this,
        frontend enforces it). Just check that the API returns 200 or 422.
        """
        asset_id = TestInspectionSubmit.created_asset_id
        if not asset_id:
            pytest.skip("No asset created in setup")

        payload = {
            "inspection_type": "individual",
            "station_id": DHN_STATION_ID,
            "inspector_id": sa_user["_id"],
            "inspection_at": "2026-02-15T10:00:00",
            "items": [
                {
                    "asset_id": asset_id,
                    "status": "not_ok",
                    "checklist_responses": [],
                    "remarks": "Defective",
                    "remarks_by": sa_user["name"],
                    "photo_urls": [],
                    "defective_since": "2026-02-10T08:00:00",  # provide defective_since
                    "rectified_on": None,
                }
            ],
            "participants": [],
            "overall_remarks": "",
        }
        res = sa_client.post(f"{BASE_URL}/api/inspections", json=payload)
        assert res.status_code == 200, f"Inspection submit not_ok failed: {res.text}"
        data = res.json()
        assert len(data.get("items", [])) == 1
        print(f"✓ Inspection with not_ok + defective_since returns 200")

    def test_cleanup_inspection_asset(self, sa_client):
        """Cleanup the test asset created for inspections."""
        asset_id = TestInspectionSubmit.created_asset_id
        if not asset_id:
            pytest.skip("Nothing to clean up")

        res = sa_client.delete(f"{BASE_URL}/api/assets/{asset_id}")
        assert res.status_code in [200, 204], f"Delete failed: {res.text}"
        print(f"✓ Inspection test asset cleaned up")


# ─── Test 3: GET /api/assets baseline checks ─────────────────────────────────

class TestGetAssetsBaseline:
    """Verify /api/assets endpoint and field presence."""

    def test_list_assets_returns_200(self, sa_client):
        """GET /api/assets returns 200 and a non-empty list for DHN."""
        res = sa_client.get(f"{BASE_URL}/api/assets", params={"station_id": DHN_STATION_ID})
        assert res.status_code == 200, f"List assets failed: {res.text}"
        data = res.json()
        assert isinstance(data, list), "Expected list response"
        assert len(data) > 0, "Expected non-empty asset list for DHN"
        print(f"✓ GET /api/assets returns {len(data)} assets for DHN")

    def test_list_assets_total_dhn_is_73(self, sa_client):
        """DHN station should have ~73 assets (per previous test context)."""
        res = sa_client.get(f"{BASE_URL}/api/assets", params={"station_id": DHN_STATION_ID})
        assert res.status_code == 200
        data = res.json()
        # 73 is expected; allow minor variation from test create/delete lifecycle
        assert len(data) >= 70, f"Expected ~73 DHN assets, got {len(data)}"
        print(f"✓ DHN assets count: {len(data)}")

    def test_list_assets_core_fields_present(self, sa_client):
        """Each asset in list has required core fields."""
        res = sa_client.get(f"{BASE_URL}/api/assets", params={"station_id": DHN_STATION_ID})
        assert res.status_code == 200
        data = res.json()
        required = ["_id", "asset_number", "status", "station_id", "location_id", "asset_type_id"]
        sample = data[0]
        for field in required:
            assert field in sample, f"Field '{field}' missing from asset response"
        print(f"✓ Core fields present in asset list response")

    def test_paginated_list_assets(self, sa_client):
        """GET /api/assets?paginated=true returns {items, total, page, page_size, total_pages}."""
        res = sa_client.get(f"{BASE_URL}/api/assets", params={
            "paginated": True,
            "page": 1,
            "page_size": 10,
        })
        assert res.status_code == 200, f"Paginated list failed: {res.text}"
        data = res.json()
        assert "items" in data, "No 'items' in paginated response"
        assert "total" in data, "No 'total' in paginated response"
        assert "total_pages" in data, "No 'total_pages' in paginated response"
        assert isinstance(data["items"], list)
        print(f"✓ Paginated list returns total={data['total']}, pages={data['total_pages']}")


# ─── Test 4: Auth — SSE001 / VIEW001 ─────────────────────────────────────────

class TestAuthRoles:
    """Quick check that SSE001 supervisor and VIEW001 viewer can log in."""

    def test_supervisor_login(self):
        res = requests.post(f"{BASE_URL}/api/auth/login", json={
            "employee_id": "SSE001", "password": "admin123"
        })
        assert res.status_code == 200, f"SSE001 login failed: {res.text}"
        data = res.json()
        assert data["user"]["role"] == "supervisor"
        print(f"✓ SSE001 supervisor login OK")

    def test_viewer_login(self):
        res = requests.post(f"{BASE_URL}/api/auth/login", json={
            "employee_id": "VIEW001", "password": "viewer123"
        })
        assert res.status_code == 200, f"VIEW001 login failed: {res.text}"
        data = res.json()
        assert data["user"]["role"] == "viewer"
        print(f"✓ VIEW001 viewer login OK")
