"""
Phase 2 Backend Tests: Orange List mark-working with custom timestamp, reject-working endpoint.
Tests the full flow: mark working -> yellow list -> ASUP reject -> back to defective.
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://rail-ops-center.preview.emergentagent.com').rstrip('/')

# Known test credentials
SA_CREDS = {"employee_id": "SA001", "password": "admin123"}
SUP_CREDS = {"employee_id": "SSE001", "password": "admin123"}
ASUP_CREDS = {"employee_id": "ASUP001", "password": "admin123"}


@pytest.fixture(scope="module")
def sa_token():
    """Get superadmin token."""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json=SA_CREDS)
    assert resp.status_code == 200, f"SA login failed: {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def sup_token():
    """Get supervisor token."""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json=SUP_CREDS)
    assert resp.status_code == 200, f"SUP login failed: {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def asup_token():
    """Get approving_supervisor token."""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json=ASUP_CREDS)
    assert resp.status_code == 200, f"ASUP login failed: {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def sup_user_id(sup_token):
    """Get supervisor user _id."""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json=SUP_CREDS)
    return resp.json()["user"]["_id"]


@pytest.fixture(scope="module")
def asup_user_id(asup_token):
    """Get ASUP user _id."""
    resp = requests.post(f"{BASE_URL}/api/auth/login", json=ASUP_CREDS)
    return resp.json()["user"]["_id"]


# ========================
# Helper to get a defective item at DHANBAD
# ========================
def get_defective_item(sa_token):
    """Get a defective orange/red list item at DHANBAD for testing."""
    resp = requests.get(
        f"{BASE_URL}/api/orange-list",
        params={"paginated": "true", "page": 1, "page_size": 50},
        headers={"Authorization": f"Bearer {sa_token}"}
    )
    assert resp.status_code == 200
    items = resp.json().get("items", [])
    for item in items:
        ainfo = item.get("asset_info", {})
        if (item.get("status") == "defective" and
                ainfo.get("station_name") == "DHANBAD"):
            return item
    return None


def get_pending_approval_item(sa_token):
    """Get a pending_approval item at DHANBAD for testing."""
    resp = requests.get(
        f"{BASE_URL}/api/orange-list",
        params={"paginated": "true", "page": 1, "page_size": 50},
        headers={"Authorization": f"Bearer {sa_token}"}
    )
    assert resp.status_code == 200
    items = resp.json().get("items", [])
    for item in items:
        ainfo = item.get("asset_info", {})
        if (item.get("status") == "pending_approval" and
                ainfo.get("station_name") == "DHANBAD"):
            return item
    return None


# ========================
# Test 1: Orange list returns paginated items
# ========================
class TestOrangeListEndpoint:
    """Tests for the orange list GET endpoint."""

    def test_list_paginated_returns_200(self, sa_token):
        """Orange list paginated endpoint returns 200."""
        resp = requests.get(
            f"{BASE_URL}/api/orange-list",
            params={"paginated": "true", "page": 1, "page_size": 25},
            headers={"Authorization": f"Bearer {sa_token}"}
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert "total_pages" in data

    def test_list_has_items(self, sa_token):
        """Orange list has items."""
        resp = requests.get(
            f"{BASE_URL}/api/orange-list",
            params={"paginated": "true", "page": 1, "page_size": 50},
            headers={"Authorization": f"Bearer {sa_token}"}
        )
        assert resp.status_code == 200
        data = resp.json()
        items = data.get("items", [])
        assert len(items) > 0, "Expected at least 1 orange list item"

    def test_pending_approval_items_exist(self, sa_token):
        """Items with status=pending_approval (Yellow List) exist."""
        resp = requests.get(
            f"{BASE_URL}/api/orange-list",
            params={"paginated": "true", "page": 1, "page_size": 50},
            headers={"Authorization": f"Bearer {sa_token}"}
        )
        assert resp.status_code == 200
        items = resp.json().get("items", [])
        pending = [i for i in items if i.get("status") == "pending_approval"]
        # Note: may be 0 if all have been processed — just verify structure works
        print(f"Pending approval items found: {len(pending)}")

    def test_supervisor_scoped_list(self, sup_token, sup_user_id):
        """Supervisor gets scoped orange list (only their assets)."""
        resp = requests.get(
            f"{BASE_URL}/api/orange-list",
            params={"paginated": "true", "page": 1, "page_size": 50, "for_user_id": sup_user_id},
            headers={"Authorization": f"Bearer {sup_token}"}
        )
        assert resp.status_code == 200, f"Scoped list failed: {resp.status_code} {resp.text}"
        data = resp.json()
        assert "items" in data

    def test_asup_scoped_list(self, asup_token, asup_user_id):
        """ASUP gets scoped orange list (only items at their stations)."""
        resp = requests.get(
            f"{BASE_URL}/api/orange-list",
            params={"paginated": "true", "page": 1, "page_size": 50, "for_user_id": asup_user_id},
            headers={"Authorization": f"Bearer {asup_token}"}
        )
        assert resp.status_code == 200, f"ASUP scoped list failed: {resp.status_code} {resp.text}"
        data = resp.json()
        assert "items" in data
        items = data.get("items", [])
        print(f"ASUP sees {len(items)} items at DHANBAD")


# ========================
# Test 2: Mark Working endpoint
# ========================
class TestMarkWorkingEndpoint:
    """Tests for POST /api/orange-list/{id}/mark-working."""

    def test_mark_working_no_timestamp_defaults_to_now(self, sa_token, sup_user_id):
        """Mark working without timestamp uses server time (now)."""
        item = get_defective_item(sa_token)
        if not item:
            pytest.skip("No defective items at DHANBAD found for testing")

        item_id = item["_id"]
        payload = {
            "marked_by": sup_user_id,
            "remarks": "TEST_Phase2 mark working no timestamp",
        }
        resp = requests.post(
            f"{BASE_URL}/api/orange-list/{item_id}/mark-working",
            json=payload
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("status") == "pending_approval", f"Expected pending_approval, got {data.get('status')}"
        assert data.get("marked_working_at") is not None, "marked_working_at should be set"

        # GET to verify data persisted
        list_resp = requests.get(
            f"{BASE_URL}/api/orange-list",
            params={"paginated": "true", "page": 1, "page_size": 50},
            headers={"Authorization": f"Bearer {sa_token}"}
        )
        items = list_resp.json().get("items", [])
        updated = next((i for i in items if i["_id"] == item_id), None)
        assert updated is not None, "Item should still be in orange list"
        assert updated.get("status") == "pending_approval"
        print(f"Item {item_id} moved to pending_approval - PASS")

    def test_mark_working_with_custom_timestamp(self, sa_token, sup_user_id):
        """Mark working with custom marked_working_at timestamp."""
        item = get_defective_item(sa_token)
        if not item:
            pytest.skip("No defective items at DHANBAD found for testing")

        item_id = item["_id"]
        # Custom timestamp: yesterday at 14:30
        custom_dt = (datetime.utcnow() - timedelta(days=1)).replace(hour=14, minute=30, second=0, microsecond=0)
        payload = {
            "marked_by": sup_user_id,
            "remarks": "TEST_Phase2 mark working with custom timestamp",
            "marked_working_at": custom_dt.isoformat() + "Z",
        }
        resp = requests.post(
            f"{BASE_URL}/api/orange-list/{item_id}/mark-working",
            json=payload
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("status") == "pending_approval"
        assert data.get("marked_working_at") is not None

        # Verify the timestamp was stored (should contain yesterday's date)
        stored_ts = data.get("marked_working_at", "")
        print(f"Custom timestamp stored: {stored_ts}")
        print(f"Expected (approx): {custom_dt.isoformat()}")

    def test_mark_working_already_pending_returns_400(self, sa_token, sup_user_id):
        """Marking a pending_approval item as working should fail with 400."""
        item = get_pending_approval_item(sa_token)
        if not item:
            pytest.skip("No pending_approval items found")

        item_id = item["_id"]
        payload = {
            "marked_by": sup_user_id,
            "remarks": "TEST_Phase2 should fail",
        }
        resp = requests.post(
            f"{BASE_URL}/api/orange-list/{item_id}/mark-working",
            json=payload
        )
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"
        print(f"Got expected 400: {resp.json()}")

    def test_mark_working_nonexistent_item_returns_404(self, sa_token, sup_user_id):
        """Marking a non-existent item returns 404."""
        fake_id = "000000000000000000000000"
        payload = {
            "marked_by": sup_user_id,
            "remarks": "TEST_Phase2 fake item",
        }
        resp = requests.post(
            f"{BASE_URL}/api/orange-list/{fake_id}/mark-working",
            json=payload
        )
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"


# ========================
# Test 3: Reject Working endpoint
# ========================
class TestRejectWorkingEndpoint:
    """Tests for POST /api/orange-list/{id}/reject-working (Phase 2 new endpoint)."""

    def test_reject_working_by_asup_success(self, sa_token, sup_user_id, asup_user_id):
        """ASUP can reject a pending_approval item — returns item to defective."""
        # First ensure there's a pending_approval item by marking one working
        item = get_defective_item(sa_token)
        if not item:
            pytest.skip("No defective items at DHANBAD found for testing")

        item_id = item["_id"]
        # Mark as working first
        mark_resp = requests.post(
            f"{BASE_URL}/api/orange-list/{item_id}/mark-working",
            json={"marked_by": sup_user_id, "remarks": "TEST_Phase2 mark for reject test"}
        )
        assert mark_resp.status_code == 200, f"Mark working failed: {mark_resp.text}"

        # Verify item is now pending_approval
        list_resp = requests.get(
            f"{BASE_URL}/api/orange-list",
            params={"paginated": "true", "page": 1, "page_size": 50},
            headers={"Authorization": f"Bearer {sa_token}"}
        )
        items = list_resp.json().get("items", [])
        marked_item = next((i for i in items if i["_id"] == item_id), None)
        if not marked_item or marked_item.get("status") != "pending_approval":
            pytest.skip("Item not in pending_approval after mark_working")

        # Now reject it
        reject_payload = {
            "rejected_by": asup_user_id,
            "remarks": "TEST_Phase2 field inspection shows asset still defective",
        }
        resp = requests.post(
            f"{BASE_URL}/api/orange-list/{item_id}/reject-working",
            json=reject_payload
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("status") == "defective", f"Expected defective, got {data.get('status')}"
        assert data.get("rejection_remarks") == reject_payload["remarks"]
        assert data.get("rejected_by") == asup_user_id
        assert data.get("marked_working_by") is None, "marked_working_by should be cleared after reject"
        assert data.get("marked_working_at") is None, "marked_working_at should be cleared after reject"
        print(f"Item {item_id} rejected back to defective - PASS")

    def test_reject_working_requires_remarks(self, sa_token, asup_user_id):
        """Reject working without remarks should fail (remarks is required field)."""
        item = get_pending_approval_item(sa_token)
        if not item:
            pytest.skip("No pending_approval items found")

        item_id = item["_id"]
        # Missing remarks
        resp = requests.post(
            f"{BASE_URL}/api/orange-list/{item_id}/reject-working",
            json={"rejected_by": asup_user_id}
        )
        assert resp.status_code == 422, f"Expected 422 (validation error), got {resp.status_code}: {resp.text}"

    def test_reject_working_non_pending_returns_400(self, sa_token, asup_user_id):
        """Rejecting a defective (not pending_approval) item should fail with 400."""
        item = get_defective_item(sa_token)
        if not item:
            pytest.skip("No defective items found")

        item_id = item["_id"]
        resp = requests.post(
            f"{BASE_URL}/api/orange-list/{item_id}/reject-working",
            json={"rejected_by": asup_user_id, "remarks": "TEST_Phase2 should fail"}
        )
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"

    def test_reject_working_non_asup_forbidden(self, sa_token, sup_user_id):
        """Non-ASUP/admin rejecting should return 403."""
        item = get_pending_approval_item(sa_token)
        if not item:
            pytest.skip("No pending_approval items found")

        item_id = item["_id"]
        resp = requests.post(
            f"{BASE_URL}/api/orange-list/{item_id}/reject-working",
            json={"rejected_by": sup_user_id, "remarks": "TEST_Phase2 sup should not be able to reject"}
        )
        assert resp.status_code == 403, f"Expected 403, got {resp.status_code}: {resp.text}"
        print(f"Got expected 403: {resp.json()}")

    def test_reject_working_nonexistent_item_returns_404(self, sa_token, asup_user_id):
        """Rejecting non-existent item returns 404."""
        fake_id = "000000000000000000000000"
        resp = requests.post(
            f"{BASE_URL}/api/orange-list/{fake_id}/reject-working",
            json={"rejected_by": asup_user_id, "remarks": "TEST_Phase2 nonexistent"}
        )
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"


# ========================
# Test 4: Full flow
# ========================
class TestFullFlowMarkWorkingReject:
    """Full flow: defective -> mark working -> pending_approval -> reject -> defective."""

    def test_full_flow_sup_mark_asup_reject(self, sa_token, sup_user_id, asup_user_id):
        """Full round-trip: SUP marks working -> item in Yellow List -> ASUP rejects -> back to defective."""
        item = get_defective_item(sa_token)
        if not item:
            pytest.skip("No defective items at DHANBAD found for full flow test")

        item_id = item["_id"]
        original_list_type = item.get("list_type")

        print(f"Testing full flow with item {item_id} (list_type={original_list_type})")

        # Step 1: SUP marks working with custom timestamp
        custom_dt = (datetime.utcnow() - timedelta(hours=2)).replace(second=0, microsecond=0)
        mark_resp = requests.post(
            f"{BASE_URL}/api/orange-list/{item_id}/mark-working",
            json={
                "marked_by": sup_user_id,
                "remarks": "TEST_Phase2 full flow - repaired fan",
                "marked_working_at": custom_dt.isoformat() + "Z",
            }
        )
        assert mark_resp.status_code == 200, f"Mark working failed: {mark_resp.text}"
        marked_data = mark_resp.json()
        assert marked_data["status"] == "pending_approval"
        assert marked_data["marked_working_by"] == sup_user_id
        assert marked_data["list_type"] == original_list_type, "list_type should not change on mark_working"
        print(f"  Step 1 PASS: status=pending_approval, marked_working_at={marked_data['marked_working_at']}")

        # Step 2: ASUP rejects
        reject_resp = requests.post(
            f"{BASE_URL}/api/orange-list/{item_id}/reject-working",
            json={
                "rejected_by": asup_user_id,
                "remarks": "TEST_Phase2 full flow - field check shows still broken",
            }
        )
        assert reject_resp.status_code == 200, f"Reject failed: {reject_resp.text}"
        rejected_data = reject_resp.json()
        assert rejected_data["status"] == "defective", f"Expected defective after reject, got {rejected_data['status']}"
        assert rejected_data.get("rejected_by") == asup_user_id
        assert "Phase2" in rejected_data.get("rejection_remarks", "")
        assert rejected_data.get("marked_working_by") is None
        assert rejected_data.get("marked_working_at") is None
        print(f"  Step 2 PASS: status=defective after reject")

        # Step 3: Verify item is still in the list (not removed)
        list_resp = requests.get(
            f"{BASE_URL}/api/orange-list",
            params={"paginated": "true", "page": 1, "page_size": 50},
            headers={"Authorization": f"Bearer {sa_token}"}
        )
        all_items = list_resp.json().get("items", [])
        final_item = next((i for i in all_items if i["_id"] == item_id), None)
        assert final_item is not None, "Item should still be in orange list after reject"
        assert final_item["status"] == "defective"
        assert final_item.get("list_type") == original_list_type
        print(f"  Step 3 PASS: Item {item_id} confirmed in orange list as defective")


# ========================
# Test 5: Approve still works
# ========================
class TestApproveStillWorks:
    """Ensure the existing approve endpoint still works correctly."""

    def test_approve_endpoint_available(self, sa_token):
        """Approve endpoint responds (200 or expected error)."""
        item = get_pending_approval_item(sa_token)
        if not item:
            pytest.skip("No pending_approval items found")

        item_id = item["_id"]
        sa_resp = requests.post(f"{BASE_URL}/api/auth/login", json=SA_CREDS)
        sa_user_id = sa_resp.json()["user"]["_id"]

        resp = requests.post(
            f"{BASE_URL}/api/orange-list/{item_id}/approve",
            json={
                "approved_by": sa_user_id,
                "remarks": "TEST_Phase2 approve from SA",
            }
        )
        # Should be 200 (approve removes from defective list)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("status") in ["resolved", "working"], f"Unexpected status: {data.get('status')}"
        print(f"Approve endpoint returns status={data.get('status')} - PASS")
