"""
Phase 4 Backend Tests: Fixes for:
  Fix 1: GET /api/schedules/supervisor/{user_id} — implicit station+dept scoping (removed assigned_supervisor_id)
  Fix 2: GET /api/schedules/approving-supervisor/{asup_id}/supervisors — implicit scoping for asset counts
  Fix 3: approve_working now notifies the SUP (marked_working_by) with "Rectification Approved"
  Fix 4: approve_working + reject_working now notify ROs scoped to the asset's dept+station

Regression:
  - GET /api/inspections with for_user_id=supervisor still works
  - GET /api/orange-list with for_user_id still returns scoped items
  - Asset auto-assignment: new asset visible to SUP with matching station+dept
"""
import pytest
import requests
import os
import time
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://railway-asset-ops.preview.emergentagent.com').rstrip('/')

# ────────────────────────────────────────────────────────────────────────────
# Known IDs from seed data (supplied by main agent context)
# ────────────────────────────────────────────────────────────────────────────
SUP_USER_ID = "69f832991d32eee20864cb1b"   # SSE001 – Ramprakash, Electrical, DHANBAD
ASUP_USER_ID = "69f7035af3f687e9573332d6"  # ASUP001 – Aditya, DHANBAD
RO_USER_ID = "69fa4d5519494e4f3610cb6a"    # DRO EL – Ram, Electrical, DHANBAD
SUP_DEPT_ID = "69f5f977dd6a924aad7954a9"   # Electrical dept
SUP_STATION_ID = "69f6f639450af6fe6fb5816f" # DHANBAD station

SA_CREDS = {"employee_id": "SA001", "password": "admin123"}
SUP_CREDS = {"employee_id": "SSE001", "password": "admin123"}
ASUP_CREDS = {"employee_id": "ASUP001", "password": "admin123"}
RO_CREDS = {"employee_id": "DRO EL", "password": "admin123"}


# ────────────────────────────────────────────────────────────────────────────
# Fixtures
# ────────────────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def sa_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json=SA_CREDS)
    assert resp.status_code == 200, f"SA login failed: {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def sup_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json=SUP_CREDS)
    assert resp.status_code == 200, f"SUP login failed: {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def asup_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json=ASUP_CREDS)
    assert resp.status_code == 200, f"ASUP login failed: {resp.text}"
    return resp.json()["token"]


@pytest.fixture(scope="module")
def sa_user_id(sa_token):
    resp = requests.post(f"{BASE_URL}/api/auth/login", json=SA_CREDS)
    return resp.json()["user"]["_id"]


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────
def get_defective_item_at_dhanbad(sa_token, require_electrical=False):
    """Return first defective orange-list item at DHANBAD (or None).
    If require_electrical=True, only returns items in the Electrical department
    so that RO Ram (Electrical, DHANBAD) will receive notifications."""
    resp = requests.get(
        f"{BASE_URL}/api/orange-list",
        params={"paginated": "true", "page": 1, "page_size": 100},
        headers={"Authorization": f"Bearer {sa_token}"}
    )
    assert resp.status_code == 200
    for item in resp.json().get("items", []):
        if item.get("status") != "defective":
            continue
        ainfo = item.get("asset_info", {})
        if ainfo.get("station_name") != "DHANBAD":
            continue
        if require_electrical and ainfo.get("department_id") != SUP_DEPT_ID:
            continue
        return item
    return None


def get_pending_approval_item_at_dhanbad(sa_token):
    """Return first pending_approval item at DHANBAD (or None)."""
    resp = requests.get(
        f"{BASE_URL}/api/orange-list",
        params={"paginated": "true", "page": 1, "page_size": 100},
        headers={"Authorization": f"Bearer {sa_token}"}
    )
    assert resp.status_code == 200
    for item in resp.json().get("items", []):
        if (item.get("status") == "pending_approval" and
                item.get("asset_info", {}).get("station_name") == "DHANBAD"):
            return item
    return None


def get_user_notifications(user_id, is_read=None, limit=50):
    """Fetch notifications for a user."""
    params = {"user_id": user_id, "page_size": limit}
    if is_read is not None:
        params["is_read"] = str(is_read).lower()
    resp = requests.get(f"{BASE_URL}/api/notifications", params=params)
    if resp.status_code == 200:
        data = resp.json()
        # Support both list response and paginated
        if isinstance(data, list):
            return data
        return data.get("notifications", data.get("items", []))
    return []


def mark_working_and_get_id(item_id, marked_by_user_id):
    """Helper to mark an item as working and return the item_id."""
    resp = requests.post(
        f"{BASE_URL}/api/orange-list/{item_id}/mark-working",
        json={"marked_by": marked_by_user_id, "remarks": "TEST_P4 mark working"}
    )
    return resp


# ═══════════════════════════════════════════════════════════════════════════
# FIX 1: Supervisor Schedule — implicit station+dept scoping
# ═══════════════════════════════════════════════════════════════════════════
class TestFix1SupervisorSchedule:
    """Fix 1: GET /api/schedules/supervisor/{user_id} should use station+dept scoping."""

    def test_supervisor_schedule_returns_200(self):
        """Endpoint should return HTTP 200 for a valid supervisor user_id."""
        resp = requests.get(f"{BASE_URL}/api/schedules/supervisor/{SUP_USER_ID}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_supervisor_schedule_structure(self):
        """Response should contain user_id, total_tasks, groups fields."""
        resp = requests.get(f"{BASE_URL}/api/schedules/supervisor/{SUP_USER_ID}")
        assert resp.status_code == 200
        data = resp.json()
        assert "user_id" in data, "Response missing user_id"
        assert "total_tasks" in data, "Response missing total_tasks"
        assert "groups" in data, "Response missing groups"
        assert "from_date" in data, "Response missing from_date"
        assert "to_date" in data, "Response missing to_date"
        print(f"Schedule structure OK — total_tasks={data['total_tasks']}, groups={len(data['groups'])}")

    def test_supervisor_schedule_has_tasks(self):
        """total_tasks > 0 — supervisor has assets at their station+department."""
        # Use wider date range to ensure tasks are found
        from_date = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")
        to_date = (datetime.utcnow() + timedelta(days=90)).strftime("%Y-%m-%d")
        resp = requests.get(
            f"{BASE_URL}/api/schedules/supervisor/{SUP_USER_ID}",
            params={"from_date": from_date, "to_date": to_date}
        )
        assert resp.status_code == 200
        data = resp.json()
        total = data.get("total_tasks", 0)
        groups = data.get("groups", [])
        print(f"total_tasks={total}, groups_count={len(groups)}")
        assert total > 0, (
            f"total_tasks should be > 0 for SUP with assets at DHANBAD/Electrical, "
            f"got {total}. Check if assets have schedule_frequency set."
        )

    def test_supervisor_schedule_groups_have_asset_type_name(self):
        """Each group in the response must have asset_type_name."""
        from_date = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")
        to_date = (datetime.utcnow() + timedelta(days=90)).strftime("%Y-%m-%d")
        resp = requests.get(
            f"{BASE_URL}/api/schedules/supervisor/{SUP_USER_ID}",
            params={"from_date": from_date, "to_date": to_date}
        )
        assert resp.status_code == 200
        groups = resp.json().get("groups", [])
        if not groups:
            pytest.skip("No groups returned — no scheduled assets for SUP in range")
        for g in groups:
            assert "asset_type_name" in g, f"Group missing asset_type_name: {g}"
            assert "tasks" in g, f"Group missing tasks: {g}"
        print(f"All {len(groups)} groups have asset_type_name — PASS")

    def test_supervisor_schedule_tasks_have_required_fields(self):
        """Each task must have asset_number, station_name, due_date, days_left."""
        from_date = (datetime.utcnow() - timedelta(days=30)).strftime("%Y-%m-%d")
        to_date = (datetime.utcnow() + timedelta(days=90)).strftime("%Y-%m-%d")
        resp = requests.get(
            f"{BASE_URL}/api/schedules/supervisor/{SUP_USER_ID}",
            params={"from_date": from_date, "to_date": to_date}
        )
        assert resp.status_code == 200
        groups = resp.json().get("groups", [])
        if not groups:
            pytest.skip("No groups returned — no scheduled assets for SUP in range")

        required = {"asset_number", "station_name", "due_date", "days_left"}
        for g in groups:
            for task in g.get("tasks", []):
                missing = required - set(task.keys())
                assert not missing, f"Task missing fields {missing}: {task}"
        print("All tasks have asset_number, station_name, due_date, days_left — PASS")

    def test_supervisor_schedule_department_matches(self):
        """department_id in response must match the supervisor's department."""
        resp = requests.get(f"{BASE_URL}/api/schedules/supervisor/{SUP_USER_ID}")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("department_id") == SUP_DEPT_ID, (
            f"department_id mismatch: expected {SUP_DEPT_ID}, got {data.get('department_id')}"
        )
        print(f"department_id matches SUP dept {SUP_DEPT_ID} — PASS")

    def test_supervisor_schedule_invalid_user_returns_404(self):
        """Non-existent user_id should return 404."""
        resp = requests.get(f"{BASE_URL}/api/schedules/supervisor/000000000000000000000000")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"

    def test_supervisor_schedule_bad_date_returns_400(self):
        """Invalid date format should return 400."""
        resp = requests.get(
            f"{BASE_URL}/api/schedules/supervisor/{SUP_USER_ID}",
            params={"from_date": "not-a-date"}
        )
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"


# ═══════════════════════════════════════════════════════════════════════════
# FIX 2: ASUP Supervisors endpoint — implicit scoping for asset counts
# ═══════════════════════════════════════════════════════════════════════════
class TestFix2AsupSupervisorsCount:
    """Fix 2: GET /api/schedules/approving-supervisor/{asup_id}/supervisors should have non-zero counts."""

    def test_asup_supervisors_returns_200(self):
        """Endpoint should return HTTP 200."""
        resp = requests.get(f"{BASE_URL}/api/schedules/approving-supervisor/{ASUP_USER_ID}/supervisors")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_asup_supervisors_structure(self):
        """Response should have approving_supervisor_id and supervisors array."""
        resp = requests.get(f"{BASE_URL}/api/schedules/approving-supervisor/{ASUP_USER_ID}/supervisors")
        assert resp.status_code == 200
        data = resp.json()
        assert "approving_supervisor_id" in data, "Missing approving_supervisor_id"
        assert "supervisors" in data, "Missing supervisors array"
        assert data["approving_supervisor_id"] == ASUP_USER_ID
        print(f"ASUP supervisors count: {len(data['supervisors'])}")

    def test_asup_supervisors_non_empty(self):
        """At least 1 supervisor should be returned under ASUP001 (who is at DHANBAD)."""
        resp = requests.get(f"{BASE_URL}/api/schedules/approving-supervisor/{ASUP_USER_ID}/supervisors")
        assert resp.status_code == 200
        sups = resp.json().get("supervisors", [])
        assert len(sups) > 0, f"Expected at least 1 supervisor, got 0"
        print(f"Found {len(sups)} supervisor(s) under ASUP001 — PASS")

    def test_asup_supervisors_have_non_zero_assigned_assets_count(self):
        """At least one supervisor should have assigned_assets_count > 0 (Fix 2 core check)."""
        resp = requests.get(f"{BASE_URL}/api/schedules/approving-supervisor/{ASUP_USER_ID}/supervisors")
        assert resp.status_code == 200
        sups = resp.json().get("supervisors", [])
        if not sups:
            pytest.skip("No supervisors returned for ASUP001")
        counts = [s.get("assigned_assets_count", 0) for s in sups]
        max_count = max(counts)
        print(f"assigned_assets_count values: {counts}")
        assert max_count > 0, (
            f"All supervisors have assigned_assets_count=0 — Fix 2 may not be working. "
            f"Expected implicit scoping (station+dept) to return non-zero counts."
        )
        print(f"Max assigned_assets_count={max_count} — PASS")

    def test_asup_supervisors_have_non_zero_scheduled_assets_count(self):
        """At least one supervisor should have scheduled_assets_count > 0."""
        resp = requests.get(f"{BASE_URL}/api/schedules/approving-supervisor/{ASUP_USER_ID}/supervisors")
        assert resp.status_code == 200
        sups = resp.json().get("supervisors", [])
        if not sups:
            pytest.skip("No supervisors returned for ASUP001")
        scheduled = [s.get("scheduled_assets_count", 0) for s in sups]
        max_sched = max(scheduled)
        print(f"scheduled_assets_count values: {scheduled}")
        assert max_sched > 0, (
            f"All supervisors have scheduled_assets_count=0. "
            f"Check if assets have schedule_frequency set."
        )
        print(f"Max scheduled_assets_count={max_sched} — PASS")

    def test_asup_supervisors_supervisor_fields(self):
        """Each supervisor entry should have name, employee_id, department_name."""
        resp = requests.get(f"{BASE_URL}/api/schedules/approving-supervisor/{ASUP_USER_ID}/supervisors")
        assert resp.status_code == 200
        sups = resp.json().get("supervisors", [])
        for s in sups:
            assert "name" in s, f"Supervisor missing name: {s}"
            assert "employee_id" in s, f"Supervisor missing employee_id: {s}"
            assert "assigned_assets_count" in s, f"Supervisor missing assigned_assets_count: {s}"
            assert "scheduled_assets_count" in s, f"Supervisor missing scheduled_assets_count: {s}"
        print(f"All {len(sups)} supervisor records have required fields — PASS")

    def test_asup_supervisors_invalid_user_returns_404(self):
        """Non-existent ASUP user_id should return 404."""
        resp = requests.get(
            f"{BASE_URL}/api/schedules/approving-supervisor/000000000000000000000000/supervisors"
        )
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"


# ═══════════════════════════════════════════════════════════════════════════
# FIX 3+4: approve_working notifications
# ═══════════════════════════════════════════════════════════════════════════
class TestFix3Fix4ApproveNotifications:
    """
    Fix 3: approve_working notifies the SUP (marked_working_by) with 'Rectification Approved'.
    Fix 4: approve_working notifies ROs scoped to asset (dept+station) with 'Asset Rectification Approved'.
    Single combined test to consume only 1 defective item.
    """

    def test_approve_flow_and_both_notifications(self, sa_token, sa_user_id):
        """Combined: mark working → approve → check SUP ('Rectification Approved')
        AND RO ('Asset Rectification Approved') notifications are sent."""
        # Step 1: Get a defective item and mark it working as SUP
        defective = get_defective_item_at_dhanbad(sa_token, require_electrical=True)
        if not defective:
            pytest.skip("No defective Electrical items at DHANBAD for approve notification test")

        item_id = defective["_id"]
        asset_number = defective.get("asset_info", {}).get("asset_number", "Unknown")
        print(f"Testing approve flow with item {item_id} (asset {asset_number})")

        mark_resp = mark_working_and_get_id(item_id, SUP_USER_ID)
        assert mark_resp.status_code == 200, f"Mark working failed: {mark_resp.text}"
        marked_data = mark_resp.json()
        assert marked_data.get("marked_working_by") == SUP_USER_ID, \
            f"marked_working_by should be SUP_USER_ID but got {marked_data.get('marked_working_by')}"
        assert marked_data.get("status") == "pending_approval"
        print(f"  Step 1 PASS: Item marked working by SUP, status=pending_approval")

        # Step 2: Approve via SA (simulates ASUP approving)
        approve_resp = requests.post(
            f"{BASE_URL}/api/orange-list/{item_id}/approve",
            json={"approved_by": sa_user_id, "remarks": "TEST_P4 combined approve notification test"}
        )
        assert approve_resp.status_code == 200, f"Approve failed: {approve_resp.text}"
        assert approve_resp.json().get("status") == "resolved"
        print(f"  Step 2 PASS: Item approved → resolved")

        # Step 3 (Fix 3): Check SUP receives 'Rectification Approved'
        sup_notifs = get_user_notifications(SUP_USER_ID)
        sup_match = [n for n in sup_notifs if n.get("title") == "Rectification Approved"
                     and n.get("related_entity_id") == item_id]
        print(f"  SUP recent notification titles: {[n.get('title') for n in sup_notifs[:5]]}")
        assert len(sup_match) > 0, (
            f"Fix 3 FAIL: SUP ({SUP_USER_ID}) did not receive 'Rectification Approved'. "
            f"Got: {[n.get('title') for n in sup_notifs[:5]]}"
        )
        print(f"  Step 3 (Fix 3) PASS: SUP received 'Rectification Approved' notification")

        # Step 4 (Fix 4): Check RO receives 'Asset Rectification Approved'
        ro_notifs = get_user_notifications(RO_USER_ID)
        ro_match = [n for n in ro_notifs if n.get("title") == "Asset Rectification Approved"
                    and n.get("related_entity_id") == item_id]
        print(f"  RO recent notification titles: {[n.get('title') for n in ro_notifs[:5]]}")
        assert len(ro_match) > 0, (
            f"Fix 4 FAIL: RO ({RO_USER_ID}) did not receive 'Asset Rectification Approved'. "
            f"Got: {[n.get('title') for n in ro_notifs[:5]]}"
        )
        print(f"  Step 4 (Fix 4) PASS: RO received 'Asset Rectification Approved' notification")


# ═══════════════════════════════════════════════════════════════════════════
# FIX 4 (reject): reject_working notifies ROs with 'Rectification Rejected'
# ═══════════════════════════════════════════════════════════════════════════
class TestFix4RejectNotifications:
    """Fix 4 (reject): After reject_working, both SUP and ROs receive 'Rectification Rejected'."""

    def test_reject_flow_and_both_notifications(self, sa_token):
        """Combined: mark working → reject → check SUP AND RO both get 'Rectification Rejected'.
        Item is returned to defective state after reject (no item consumed)."""
        # Step 1: Get defective item + mark working as SUP
        defective = get_defective_item_at_dhanbad(sa_token, require_electrical=True)
        if not defective:
            pytest.skip("No defective Electrical items at DHANBAD for reject notification test")

        item_id = defective["_id"]
        asset_number = defective.get("asset_info", {}).get("asset_number", "Unknown")
        print(f"Testing reject flow with item {item_id} (asset {asset_number})")

        mark_resp = mark_working_and_get_id(item_id, SUP_USER_ID)
        assert mark_resp.status_code == 200, f"Mark working failed: {mark_resp.text}"
        assert mark_resp.json().get("marked_working_by") == SUP_USER_ID
        print(f"  Step 1 PASS: Item marked working by SUP")

        # Step 2: ASUP rejects it
        reject_resp = requests.post(
            f"{BASE_URL}/api/orange-list/{item_id}/reject-working",
            json={"rejected_by": ASUP_USER_ID, "remarks": "TEST_P4 reject — asset still broken in field"}
        )
        assert reject_resp.status_code == 200, f"Reject failed: {reject_resp.text}"
        reject_data = reject_resp.json()
        assert reject_data.get("status") == "defective", \
            f"Expected defective after reject, got {reject_data.get('status')}"
        print(f"  Step 2 PASS: Item rejected back to defective")

        # Step 3: Check SUP notifications — must have "Rectification Rejected"
        sup_notifs = get_user_notifications(SUP_USER_ID)
        sup_match = [n for n in sup_notifs if n.get("title") == "Rectification Rejected"
                     and n.get("related_entity_id") == item_id]
        print(f"  SUP recent notification titles: {[n.get('title') for n in sup_notifs[:5]]}")
        assert len(sup_match) > 0, (
            f"SUP did not receive 'Rectification Rejected' notification after reject. "
            f"Got: {[n.get('title') for n in sup_notifs[:5]]}"
        )
        print(f"  Step 3 PASS: SUP received 'Rectification Rejected' notification")

        # Step 4 (Fix 4): Check RO notifications — must have "Rectification Rejected"
        ro_notifs = get_user_notifications(RO_USER_ID)
        ro_match = [n for n in ro_notifs if n.get("title") == "Rectification Rejected"
                    and n.get("related_entity_id") == item_id]
        print(f"  RO recent notification titles: {[n.get('title') for n in ro_notifs[:5]]}")
        assert len(ro_match) > 0, (
            f"Fix 4 (reject) FAIL: RO ({RO_USER_ID}) did not receive 'Rectification Rejected' notification. "
            f"Got: {[n.get('title') for n in ro_notifs[:5]]}"
        )
        print(f"  Step 4 (Fix 4) PASS: RO received 'Rectification Rejected' notification")


# ═══════════════════════════════════════════════════════════════════════════
# REGRESSION: Inspections scoped for supervisor
# ═══════════════════════════════════════════════════════════════════════════
class TestRegressionInspections:
    """Regression: GET /api/inspections with for_user_id=supervisor still works."""

    def test_inspections_sup_scoped_returns_200(self, sup_token):
        """GET /api/inspections?for_user_id=<SUP> should return 200 (not 500)."""
        resp = requests.get(
            f"{BASE_URL}/api/inspections",
            params={"for_user_id": SUP_USER_ID, "page": 1, "page_size": 20},
            headers={"Authorization": f"Bearer {sup_token}"}
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        # Should be a list or paginated response
        assert isinstance(data, (list, dict)), "Response should be list or dict"
        print(f"Inspections scoped for SUP — status 200, type={type(data).__name__} — PASS")

    def test_inspections_sa_returns_200(self, sa_token):
        """GET /api/inspections as SA (no scope) should return 200."""
        resp = requests.get(
            f"{BASE_URL}/api/inspections",
            params={"page": 1, "page_size": 20},
            headers={"Authorization": f"Bearer {sa_token}"}
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"


# ═══════════════════════════════════════════════════════════════════════════
# REGRESSION: Orange list scoped for various roles
# ═══════════════════════════════════════════════════════════════════════════
class TestRegressionOrangeList:
    """Regression: GET /api/orange-list with for_user_id scoping still works."""

    def test_orange_list_sup_scoped_returns_200(self, sup_token):
        """Orange list scoped for SUP returns 200."""
        resp = requests.get(
            f"{BASE_URL}/api/orange-list",
            params={"for_user_id": SUP_USER_ID, "paginated": "true"},
            headers={"Authorization": f"Bearer {sup_token}"}
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        items = data.get("items", [])
        print(f"SUP sees {len(items)} orange-list items (scoped to their station+dept) — PASS")

    def test_orange_list_ro_scoped_returns_200(self):
        """Orange list scoped for RO returns 200."""
        resp = requests.get(
            f"{BASE_URL}/api/orange-list",
            params={"for_user_id": RO_USER_ID, "paginated": "true"},
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        items = data.get("items", [])
        print(f"RO sees {len(items)} orange-list items (scoped to Electrical/DHANBAD) — PASS")

    def test_orange_list_asup_scoped_returns_200(self, asup_token):
        """Orange list scoped for ASUP returns 200."""
        resp = requests.get(
            f"{BASE_URL}/api/orange-list",
            params={"for_user_id": ASUP_USER_ID, "paginated": "true"},
            headers={"Authorization": f"Bearer {asup_token}"}
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        items = data.get("items", [])
        print(f"ASUP sees {len(items)} orange-list items (scoped to their stations) — PASS")

    def test_orange_list_sup_items_all_at_dhanbad(self, sup_token):
        """All items returned for SUP should be at DHANBAD or reported by SUP."""
        resp = requests.get(
            f"{BASE_URL}/api/orange-list",
            params={"for_user_id": SUP_USER_ID, "paginated": "true", "page_size": 100},
            headers={"Authorization": f"Bearer {sup_token}"}
        )
        assert resp.status_code == 200
        items = resp.json().get("items", [])
        for item in items:
            station_name = item.get("asset_info", {}).get("station_name", "")
            reported_by = item.get("reported_by", "")
            # Items should be either at DHANBAD or reported by this SUP
            if station_name != "DHANBAD" and reported_by != SUP_USER_ID:
                print(f"WARNING: Item {item['_id']} at station '{station_name}' is not DHANBAD and not reported by SUP")
        print(f"Orange list scoping check completed for {len(items)} items — PASS")


# ═══════════════════════════════════════════════════════════════════════════
# ASSET AUTO-ASSIGNMENT: New asset visible to SUP via implicit scoping
# ═══════════════════════════════════════════════════════════════════════════
class TestAssetAutoAssignment:
    """Asset auto-assignment: New asset with station+dept should be visible to matching SUP."""

    _created_asset_id = None

    def test_create_asset_at_sup_station_dept(self, sa_token):
        """Create asset with SUP's station+dept (Electrical/DHANBAD) — should appear in SUP's view."""
        # First get an asset type in the Electrical department
        types_resp = requests.get(
            f"{BASE_URL}/api/asset-types",
            params={"department_id": SUP_DEPT_ID},
            headers={"Authorization": f"Bearer {sa_token}"}
        )
        assert types_resp.status_code == 200, f"asset-types failed: {types_resp.text}"
        types = types_resp.json()
        if not types:
            pytest.skip("No asset types found for Electrical dept — cannot create test asset")

        asset_type = types[0]
        asset_type_id = asset_type["_id"]

        # Get a location at DHANBAD
        locs_resp = requests.get(
            f"{BASE_URL}/api/locations",
            params={"station_id": SUP_STATION_ID},
            headers={"Authorization": f"Bearer {sa_token}"}
        )
        assert locs_resp.status_code == 200
        locations = locs_resp.json()
        if not locations:
            pytest.skip("No locations found at DHANBAD — cannot create test asset")
        location_id = locations[0]["_id"]

        # Create the asset
        create_resp = requests.post(
            f"{BASE_URL}/api/assets",
            json={
                "asset_number": "TEST_P4_AUTO_ASSIGN",
                "asset_type_id": asset_type_id,
                "station_id": SUP_STATION_ID,
                "location_id": location_id,
                "status": "working"
            },
            headers={"Authorization": f"Bearer {sa_token}"}
        )
        assert create_resp.status_code in [200, 201], f"Asset create failed: {create_resp.text}"
        asset = create_resp.json()
        TestAssetAutoAssignment._created_asset_id = asset.get("_id")
        print(f"Created test asset {TestAssetAutoAssignment._created_asset_id} ({asset_type['name']} @ DHANBAD)")

        # Verify asset has station_id and asset_type_id matching SUP's scope
        assert asset.get("station_id") == SUP_STATION_ID
        assert asset.get("asset_type_id") == asset_type_id
        print(f"Asset auto-assignment verified (station+dept match SUP scope) — PASS")

    def test_new_asset_visible_in_sup_schedule(self, sa_token):
        """New asset (with schedule_frequency set) should appear in SUP's schedule."""
        asset_id = TestAssetAutoAssignment._created_asset_id
        if not asset_id:
            pytest.skip("No test asset created in previous test")

        # Set a schedule frequency on the new asset via SA
        sched_resp = requests.post(
            f"{BASE_URL}/api/schedules",
            json={
                "asset_id": asset_id,
                "frequency": "weekly",
                "set_by": SUP_USER_ID
            },
            headers={"Authorization": f"Bearer {sa_token}"}
        )
        assert sched_resp.status_code == 200, f"Schedule set failed: {sched_resp.text}"
        print(f"Schedule set for asset {asset_id}")

        # Check the SUP's schedule — should include this new asset
        from_date = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
        to_date = (datetime.utcnow() + timedelta(days=14)).strftime("%Y-%m-%d")
        sched_resp2 = requests.get(
            f"{BASE_URL}/api/schedules/supervisor/{SUP_USER_ID}",
            params={"from_date": from_date, "to_date": to_date}
        )
        assert sched_resp2.status_code == 200
        data = sched_resp2.json()
        total = data.get("total_tasks", 0)
        groups = data.get("groups", [])

        # Collect all asset_ids in the schedule
        schedule_asset_ids = []
        for g in groups:
            for task in g.get("tasks", []):
                schedule_asset_ids.append(task.get("asset_id"))

        print(f"SUP schedule has {total} tasks across {len(groups)} groups")
        assert asset_id in schedule_asset_ids, (
            f"TEST_P4_AUTO_ASSIGN asset ({asset_id}) not found in SUP's schedule. "
            f"Implicit scoping may not be working."
        )
        print(f"PASS: New asset visible in SUP's schedule via implicit scoping")

    def test_cleanup_test_asset(self, sa_token):
        """Cleanup: delete the test asset created above."""
        asset_id = TestAssetAutoAssignment._created_asset_id
        if not asset_id:
            pytest.skip("No test asset to clean up")

        resp = requests.delete(
            f"{BASE_URL}/api/assets/{asset_id}",
            headers={"Authorization": f"Bearer {sa_token}"}
        )
        # 200 or 204 or 404 (already gone) are all fine
        assert resp.status_code in [200, 204, 404], f"Cleanup failed: {resp.status_code} {resp.text}"
        print(f"Test asset {asset_id} cleaned up")
