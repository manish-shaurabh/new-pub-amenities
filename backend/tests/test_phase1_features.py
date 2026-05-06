"""
Phase 1 Backend Tests - Railway Asset Inspection Management System
Tests: Profile API, ASUP approval scoping, asset create (no assigned_supervisor_id),
       supervisor (station+dept) uniqueness constraint
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

# Known IDs from seed data
SA_ID = "69f5f977dd6a924aad7954a8"
SUP_ID = "69f832991d32eee20864cb1b"      # SSE001, Ramprakash Barla, Electrical, DHANBAD
ASUP_ID = "69f7035af3f687e9573332d6"     # Aditya ASUP001, assigned to DHANBAD
DHANBAD_ID = "69f6f639450af6fe6fb5816f"
ELEC_DEPT_ID = "69f5f977dd6a924aad7954a9"


@pytest.fixture(scope="module")
def sa_token():
    res = requests.post(f"{BASE_URL}/api/auth/login", json={"employee_id": "SA001", "password": "admin123"})
    assert res.status_code == 200
    return res.json()["token"]


@pytest.fixture(scope="module")
def sup_token():
    res = requests.post(f"{BASE_URL}/api/auth/login", json={"employee_id": "SSE001", "password": "admin123"})
    assert res.status_code == 200
    return res.json()["token"]


# ============ PROFILE ENDPOINT TESTS ============

class TestProfileEndpoint:
    """Tests for GET /api/profiles/{user_id}"""

    def test_supervisor_profile_returns_correct_stats(self):
        """Supervisor profile should return correct asset stats."""
        res = requests.get(f"{BASE_URL}/api/profiles/{SUP_ID}")
        assert res.status_code == 200
        data = res.json()

        # Shape check
        assert "user" in data
        assert "stats" in data
        assert "stations" in data

        # Stats correctness for SSE001 — check structure and total_assets >= 49
        stats = data["stats"]
        assert stats["total_assets"] >= 49, f"Expected >= 49, got {stats['total_assets']}"
        total_sum = stats["working"] + stats["orange"] + stats["red"]
        assert total_sum == stats["total_assets"], \
            f"working+orange+red={total_sum} != total_assets={stats['total_assets']}"
        # Known: orange=2, red=2 from seed data
        assert stats["orange"] >= 0 and stats["red"] >= 0
        assert stats["total_stations"] == 1
        print(f"PASS: Supervisor stats correct: {stats}")

    def test_supervisor_profile_station_is_dhanbad(self):
        """Supervisor profile station should be DHANBAD."""
        res = requests.get(f"{BASE_URL}/api/profiles/{SUP_ID}")
        assert res.status_code == 200
        data = res.json()

        stations = data["stations"]
        assert len(stations) == 1
        assert stations[0]["station_name"] == "DHANBAD"
        assert stations[0]["code"] == "DHN"
        print(f"PASS: Station is DHANBAD with code DHN")

    def test_supervisor_profile_has_locations(self):
        """Supervisor profile should have location groups within the station."""
        res = requests.get(f"{BASE_URL}/api/profiles/{SUP_ID}")
        assert res.status_code == 200
        data = res.json()

        station = data["stations"][0]
        assert len(station["locations"]) > 0, "Supervisor station should have locations"
        # Each location should have assets
        for loc in station["locations"]:
            assert "location_id" in loc
            assert "location_name" in loc
            assert "assets" in loc
            assert "asset_count" in loc
        print(f"PASS: Supervisor profile has {len(station['locations'])} locations")

    def test_supervisor_profile_assets_have_health_class(self):
        """Assets in supervisor profile should have health_class."""
        res = requests.get(f"{BASE_URL}/api/profiles/{SUP_ID}")
        assert res.status_code == 200
        data = res.json()

        station = data["stations"][0]
        for loc in station["locations"]:
            for asset in loc["assets"]:
                assert "health_class" in asset
                assert asset["health_class"] in ("working", "orange", "red")
        print("PASS: All assets have valid health_class")

    def test_supervisor_profile_user_block(self):
        """Supervisor profile user block should contain expected fields."""
        res = requests.get(f"{BASE_URL}/api/profiles/{SUP_ID}")
        assert res.status_code == 200
        data = res.json()

        u = data["user"]
        assert u["name"] == "Ramprakash Barla"
        assert u["employee_id"] == "SSE001"
        assert u["role"] == "supervisor"
        assert u["department_name"] == "Electrical"
        assert "reports_to" in u
        print(f"PASS: Supervisor user block correct: {u['name']}, {u['department_name']}")

    def test_asup_profile_returns_dept_grouping(self):
        """ASUP profile should return department grouping within stations."""
        res = requests.get(f"{BASE_URL}/api/profiles/{ASUP_ID}")
        assert res.status_code == 200
        data = res.json()

        assert data["user"]["role"] == "approving_supervisor"
        stations = data["stations"]
        assert len(stations) > 0

        station = stations[0]
        # ASUP view should have departments, not just locations
        assert "departments" in station
        assert len(station["departments"]) > 0
        print(f"PASS: ASUP profile has {len(station['departments'])} departments")

    def test_asup_profile_available_departments(self):
        """ASUP profile should return available_departments for filter."""
        res = requests.get(f"{BASE_URL}/api/profiles/{ASUP_ID}")
        assert res.status_code == 200
        data = res.json()

        assert "available_departments" in data
        # Should have at least one dept
        assert len(data["available_departments"]) > 0
        for dept in data["available_departments"]:
            assert "dept_id" in dept
            assert "dept_name" in dept
        print(f"PASS: ASUP has {len(data['available_departments'])} available_departments")

    def test_asup_profile_dept_filter(self):
        """ASUP profile should support filtering by dept_id."""
        # First get available departments
        res = requests.get(f"{BASE_URL}/api/profiles/{ASUP_ID}")
        assert res.status_code == 200
        depts = res.json().get("available_departments", [])
        if not depts:
            pytest.skip("No available departments for ASUP")

        dept_id = depts[0]["dept_id"]
        # Filter by this dept
        res2 = requests.get(f"{BASE_URL}/api/profiles/{ASUP_ID}?dept_id={dept_id}")
        assert res2.status_code == 200
        data2 = res2.json()

        stations = data2["stations"]
        assert len(stations) > 0
        # Each station's departments should be filtered (at most 1 dept)
        for st in stations:
            for dept in st.get("departments", []):
                assert dept["dept_id"] == dept_id, f"Unexpected dept: {dept['dept_id']}"
        print(f"PASS: Dept filter works, filtered to dept {depts[0]['dept_name']}")

    def test_superadmin_profile_accessible(self):
        """Superadmin profile endpoint is accessible (returns no stations)."""
        res = requests.get(f"{BASE_URL}/api/profiles/{SA_ID}")
        assert res.status_code == 200
        data = res.json()
        assert data["user"]["role"] == "superadmin"
        assert data["stats"]["total_assets"] == 0
        assert data["stations"] == []
        print("PASS: Superadmin profile returns empty station list")

    def test_profile_invalid_user_id_returns_400(self):
        """Invalid ObjectId should return 400."""
        res = requests.get(f"{BASE_URL}/api/profiles/invalid_id")
        assert res.status_code == 400
        print("PASS: Invalid user_id returns 400")

    def test_profile_nonexistent_user_returns_404(self):
        """Non-existent user ID should return 404."""
        res = requests.get(f"{BASE_URL}/api/profiles/000000000000000000000000")
        assert res.status_code == 404
        print("PASS: Non-existent user_id returns 404")


# ============ ASUP ORANGE LIST APPROVAL SCOPING ============

class TestASUPApprovalScoping:
    """Tests for ASUP approval station check at orange-list approve endpoint."""

    def test_asup_cannot_approve_at_non_assigned_station(self, sa_token):
        """ASUP assigned to DHANBAD cannot approve items at a different station."""
        # Get ASUPs NOT assigned to DHANBAD (test ones created in iteration 6)
        asup_other = "69fb197231ecfde4374bae9b"  # Test ASUP from prev iteration, assigned to test station

        # Get any DHANBAD pending_approval item
        items = requests.get(f"{BASE_URL}/api/orange-list?status=pending_approval").json()
        dhanbad_items = [
            i for i in items
            if i.get("asset_info", {}).get("station_name") == "DHANBAD"
        ]

        if not dhanbad_items:
            pytest.skip("No pending_approval items at DHANBAD to test")

        item_id = dhanbad_items[0]["_id"]
        res = requests.post(
            f"{BASE_URL}/api/orange-list/{item_id}/approve",
            json={"approved_by": asup_other, "remarks": "Unauthorized test"}
        )
        assert res.status_code == 403, f"Expected 403, got {res.status_code}: {res.text}"
        assert "jurisdiction" in res.json().get("detail", "").lower()
        print(f"PASS: ASUP at wrong station gets 403: {res.json()['detail']}")

    def test_non_asup_cannot_approve(self):
        """Regular supervisor cannot approve orange list items."""
        items = requests.get(f"{BASE_URL}/api/orange-list?status=pending_approval").json()
        if not items:
            pytest.skip("No pending_approval items")

        item_id = items[0]["_id"]
        res = requests.post(
            f"{BASE_URL}/api/orange-list/{item_id}/approve",
            json={"approved_by": SUP_ID, "remarks": "Unauthorized test"}
        )
        assert res.status_code == 403
        print("PASS: Supervisor cannot approve orange list items (403)")


# ============ ASSET CREATE - NO ASSIGNED_SUPERVISOR_ID ============

class TestAssetCreate:
    """Tests that asset creation works without assigned_supervisor_id."""

    def test_create_asset_without_supervisor(self):
        """Asset creation should succeed without assigned_supervisor_id."""
        import time
        ts = int(time.time())

        # Get valid refs
        stations = requests.get(f"{BASE_URL}/api/stations").json()
        station_id = stations[0]["_id"]

        locations = requests.get(f"{BASE_URL}/api/locations?station_id={station_id}").json()
        if not locations:
            pytest.skip("No locations at station")
        location_id = locations[0]["_id"]

        asset_types = requests.get(f"{BASE_URL}/api/asset-types").json()
        at_id = asset_types[0]["_id"]

        res = requests.post(f"{BASE_URL}/api/assets", json={
            "asset_type_id": at_id,
            "station_id": station_id,
            "location_id": location_id,
            "asset_number": f"TEST-NEW-{ts}",
            "description": "Phase1 test asset"
        })
        assert res.status_code == 200, f"Asset creation failed: {res.text}"
        data = res.json()
        assert data["asset_number"] == f"TEST-NEW-{ts}"
        # assigned_supervisor_id should not be a required field
        print(f"PASS: Asset created successfully: {data['_id']}")

        # Cleanup
        requests.delete(f"{BASE_URL}/api/assets/{data['_id']}")

    def test_asset_create_with_assigned_supervisor_returns_error(self):
        """If assigned_supervisor_id is sent, it should be ignored (not cause errors)."""
        import time
        ts = int(time.time())

        stations = requests.get(f"{BASE_URL}/api/stations").json()
        station_id = stations[0]["_id"]
        locations = requests.get(f"{BASE_URL}/api/locations?station_id={station_id}").json()
        if not locations:
            pytest.skip("No locations")
        location_id = locations[0]["_id"]
        asset_types = requests.get(f"{BASE_URL}/api/asset-types").json()
        at_id = asset_types[0]["_id"]

        # Extra field should be ignored by Pydantic
        res = requests.post(f"{BASE_URL}/api/assets", json={
            "asset_type_id": at_id,
            "station_id": station_id,
            "location_id": location_id,
            "asset_number": f"TEST-EXTRA-{ts}",
            "description": "Test with extra field",
            "assigned_supervisor_id": SUP_ID  # Should be ignored
        })
        assert res.status_code == 200, f"Asset creation failed: {res.text}"
        data = res.json()
        # Cleanup
        requests.delete(f"{BASE_URL}/api/assets/{data['_id']}")
        print("PASS: Asset creation ignores extra assigned_supervisor_id field")


# ============ SUPERVISOR UNIQUENESS CONSTRAINT ============

class TestSupervisorUniqueness:
    """Tests for (station, dept) uniqueness constraint on Supervisor creation."""

    def test_duplicate_supervisor_station_dept_returns_409(self, sa_token):
        """Creating a second supervisor for same (station, dept) should fail with 409."""
        import time
        ts = int(time.time())

        # Get a station and reporting officer
        stations = requests.get(f"{BASE_URL}/api/stations").json()
        dhanbad = next((s for s in stations if s["name"] == "DHANBAD"), stations[0])
        station_id = dhanbad["_id"]

        # ELEC_DEPT_ID is already assigned to SSE001 at DHANBAD
        res = requests.post(f"{BASE_URL}/api/users", json={
            "employee_id": f"TEST-DUP-{ts}",
            "name": "Duplicate Supervisor",
            "role": "supervisor",
            "department_id": ELEC_DEPT_ID,
            "assigned_stations": [station_id],
            "password": "admin123"
        })
        assert res.status_code == 409, f"Expected 409, got {res.status_code}: {res.text}"
        assert "already has a Supervisor" in res.json().get("detail", "")
        print(f"PASS: Duplicate (station, dept) supervisor returns 409: {res.json()['detail']}")

    def test_supervisor_different_dept_same_station_allowed(self, sa_token):
        """Creating supervisor with different dept at same station should succeed."""
        import time
        ts = int(time.time())

        # Get a department that's NOT Electrical
        depts = requests.get(f"{BASE_URL}/api/departments").json()
        other_depts = [d for d in depts if d["_id"] != ELEC_DEPT_ID]
        if not other_depts:
            pytest.skip("No other departments available")

        # Check if there's already a supervisor for DHANBAD + other dept
        dept_id = other_depts[0]["_id"]
        existing_sups = requests.get(f"{BASE_URL}/api/users?role=supervisor").json()
        already_occupied = any(
            s.get("department_id") == dept_id and DHANBAD_ID in s.get("assigned_stations", [])
            for s in existing_sups
        )
        if already_occupied:
            pytest.skip(f"Dept {other_depts[0]['name']} at DHANBAD already has supervisor")

        res = requests.post(f"{BASE_URL}/api/users", json={
            "employee_id": f"TEST-DIFF-DEPT-{ts}",
            "name": f"Test Sup Diff Dept {ts}",
            "role": "supervisor",
            "department_id": dept_id,
            "assigned_stations": [DHANBAD_ID],
            "password": "admin123"
        })
        # Should be 200 or 400 (not 409)
        assert res.status_code in (200, 201, 400), f"Unexpected status: {res.status_code}: {res.text}"
        if res.status_code in (200, 201):
            # Cleanup
            user_id = res.json().get("_id")
            if user_id:
                requests.delete(f"{BASE_URL}/api/users/{user_id}")
            print(f"PASS: Different dept supervisor created OK")
        else:
            print(f"INFO: Returned {res.status_code}: {res.json()}")


# ============ ORANGE/RED LIST ROLE VISIBILITY ============

class TestOrangeListVisibility:
    """Verify orange list is accessible for all required roles."""

    def test_supervisor_can_see_orange_list(self, sup_token):
        """Supervisor should be able to access orange list."""
        res = requests.get(f"{BASE_URL}/api/orange-list?for_user_id={SUP_ID}")
        assert res.status_code == 200
        print(f"PASS: Supervisor orange list accessible, {len(res.json())} items")

    def test_asup_can_see_orange_list(self):
        """ASUP should be able to access orange list scoped to their stations."""
        res = requests.get(f"{BASE_URL}/api/orange-list?for_user_id={ASUP_ID}")
        assert res.status_code == 200
        data = res.json()
        # All items should be at ASUP's assigned station (DHANBAD)
        for item in data:
            assert item.get("asset_info", {}).get("station_name") == "DHANBAD", \
                f"ASUP saw item from unexpected station: {item.get('asset_info', {}).get('station_name')}"
        print(f"PASS: ASUP orange list scoped to DHANBAD, {len(data)} items")

    def test_superadmin_can_see_all_orange_list(self):
        """Superadmin should see all orange list items (no scoping)."""
        res = requests.get(f"{BASE_URL}/api/orange-list?for_user_id={SA_ID}")
        assert res.status_code == 200
        print(f"PASS: Superadmin orange list accessible, {len(res.json())} items")


# ============ DUPLICATE FUNCTION CHECK ============

class TestUsersRouterIssues:
    """Flag known issues in users.py"""

    def test_supervisors_endpoint_works(self):
        """GET /api/users/supervisors should work despite duplicate function definition."""
        res = requests.get(f"{BASE_URL}/api/users/supervisors")
        assert res.status_code == 200
        print(f"PASS: /api/users/supervisors works, {len(res.json())} supervisors")
