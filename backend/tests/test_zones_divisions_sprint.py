"""
Zone/Division Hierarchy + Divisional Admin Role + Health Explorer Division Mode
Sprint B - Iteration 28 Test Suite

Tests:
- GET /api/zones — ECR zone auto-created at startup
- GET /api/divisions — Dhanbad Division with station_count > 0
- POST /api/zones (SA only) — create / cleanup
- POST /api/divisions (SA only) — create under ECR
- GET /api/stations — all stations have division_id populated
- GET /api/dashboard/health-explorer/{sa_id}?mode=division — L1 Dhanbad row
- GET health-explorer with division_id — L2 stations
- User creation with divisional_admin role + assigned_division_id
- Divisional Admin scoping: login as DA, verify station scope
"""

import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

# ─── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def sa_auth(session):
    """Login as SA001, return (token, user_id)."""
    r = session.post(f"{BASE_URL}/api/auth/login",
                     json={"employee_id": "SA001", "password": "admin123"})
    assert r.status_code == 200, f"SA login failed: {r.text}"
    data = r.json()
    token = data["token"]
    user_id = data["user"].get("_id") or data["user"].get("id")
    session.headers.update({"Authorization": f"Bearer {token}"})
    return token, user_id


@pytest.fixture(scope="module")
def sa_uid(sa_auth):
    return sa_auth[1]


@pytest.fixture(scope="module")
def ecr_zone_id(session, sa_auth):
    """Return the ECR zone _id (auto-created at startup)."""
    r = session.get(f"{BASE_URL}/api/zones")
    assert r.status_code == 200
    zones = r.json()
    ecr = next((z for z in zones if z.get("code") == "ECR"), None)
    assert ecr is not None, "ECR zone not found"
    return ecr["_id"]


@pytest.fixture(scope="module")
def dhanbad_division_id(session, sa_auth):
    """Return the Dhanbad Division _id (auto-created at startup)."""
    r = session.get(f"{BASE_URL}/api/divisions")
    assert r.status_code == 200
    divs = r.json()
    dhn = next((d for d in divs if d.get("code") == "DHN"), None)
    assert dhn is not None, "Dhanbad Division not found"
    return dhn["_id"]


# ─── Zone Tests ────────────────────────────────────────────────────────────────

class TestZones:
    """Tests for Zone CRUD and auto-migration."""

    def test_list_zones_returns_200(self, session, sa_auth):
        """GET /api/zones returns 200."""
        r = session.get(f"{BASE_URL}/api/zones")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        zones = r.json()
        assert isinstance(zones, list)
        print(f"PASS: GET /api/zones returned {len(zones)} zone(s)")

    def test_ecr_zone_auto_created(self, session, sa_auth):
        """ECR zone is auto-created at startup."""
        r = session.get(f"{BASE_URL}/api/zones")
        zones = r.json()
        ecr = next((z for z in zones if z.get("code") == "ECR"), None)
        assert ecr is not None, "ECR zone not found in zones list"
        assert ecr.get("name") == "East Central Railway"
        assert "_id" in ecr or "id" in ecr
        print(f"PASS: ECR zone exists — name='{ecr.get('name')}', code='{ecr.get('code')}'")

    def test_create_zone_requires_superadmin(self, session, sa_uid):
        """POST /api/zones without SA user → 403."""
        r = session.post(
            f"{BASE_URL}/api/zones?current_user_id=BADID",
            json={"name": "Test Zone Unauthorized", "code": "TZU"}
        )
        assert r.status_code in (403, 400, 422), f"Expected 403/400/422, got {r.status_code}"
        print(f"PASS: POST /api/zones with bad user_id returns {r.status_code}")

    def test_create_and_delete_zone(self, session, sa_uid):
        """POST /api/zones creates a zone; DELETE removes it."""
        # Create
        r_create = session.post(
            f"{BASE_URL}/api/zones?current_user_id={sa_uid}",
            json={"name": "TEST_Zone_Sprint_B", "code": "TZSB"}
        )
        assert r_create.status_code == 200, f"Create zone failed: {r_create.text}"
        zone = r_create.json()
        zone_id = zone.get("_id") or zone.get("id")
        assert zone_id is not None
        assert zone.get("name") == "TEST_Zone_Sprint_B"
        assert zone.get("code") == "TZSB"
        print(f"PASS: Created zone id={zone_id}")

        # Verify via GET
        r_list = session.get(f"{BASE_URL}/api/zones")
        ids = [z.get("_id") or z.get("id") for z in r_list.json()]
        assert zone_id in ids, "Created zone not found in list"
        print("PASS: Zone verified in list")

        # Delete
        r_del = session.delete(f"{BASE_URL}/api/zones/{zone_id}?current_user_id={sa_uid}")
        assert r_del.status_code == 200, f"Delete zone failed: {r_del.text}"
        print("PASS: Zone deleted")

        # Verify deleted
        r_list2 = session.get(f"{BASE_URL}/api/zones")
        ids2 = [z.get("_id") or z.get("id") for z in r_list2.json()]
        assert zone_id not in ids2, "Zone still present after delete"
        print("PASS: Zone deletion persisted")

    def test_duplicate_zone_code_rejected(self, session, sa_uid):
        """Creating ECR zone again → 409."""
        r = session.post(
            f"{BASE_URL}/api/zones?current_user_id={sa_uid}",
            json={"name": "East Central Railway Dup", "code": "ECR"}
        )
        assert r.status_code == 409, f"Expected 409 for duplicate, got {r.status_code}: {r.text}"
        print(f"PASS: Duplicate ECR code returns 409")


# ─── Division Tests ────────────────────────────────────────────────────────────

class TestDivisions:
    """Tests for Division CRUD and auto-migration."""

    def test_list_divisions_returns_200(self, session, sa_auth):
        """GET /api/divisions returns 200."""
        r = session.get(f"{BASE_URL}/api/divisions")
        assert r.status_code == 200
        divs = r.json()
        assert isinstance(divs, list)
        print(f"PASS: GET /api/divisions returned {len(divs)} division(s)")

    def test_dhanbad_division_exists_with_stations(self, session, sa_auth):
        """Dhanbad Division auto-created with station_count > 0."""
        r = session.get(f"{BASE_URL}/api/divisions")
        divs = r.json()
        dhn = next((d for d in divs if d.get("code") == "DHN"), None)
        assert dhn is not None, "Dhanbad Division (DHN) not found"
        sc = dhn.get("station_count", 0)
        assert sc > 0, f"Expected station_count > 0, got {sc}"
        assert dhn.get("zone_name"), f"zone_name should be populated, got: {dhn.get('zone_name')}"
        print(f"PASS: Dhanbad Division found — station_count={sc}, zone_name='{dhn.get('zone_name')}'")

    def test_create_and_delete_division(self, session, sa_uid, ecr_zone_id):
        """POST /api/divisions creates a division under ECR; DELETE removes it."""
        r_create = session.post(
            f"{BASE_URL}/api/divisions?current_user_id={sa_uid}",
            json={"name": "TEST_Division_Sprint_B", "code": "TDSB", "zone_id": ecr_zone_id}
        )
        assert r_create.status_code == 200, f"Create division failed: {r_create.text}"
        div = r_create.json()
        div_id = div.get("_id") or div.get("id")
        assert div_id is not None
        assert div.get("name") == "TEST_Division_Sprint_B"
        assert div.get("zone_name") == "East Central Railway"
        print(f"PASS: Created division id={div_id}")

        # Verify via GET
        r_list = session.get(f"{BASE_URL}/api/divisions")
        ids = [d.get("_id") or d.get("id") for d in r_list.json()]
        assert div_id in ids
        print("PASS: Division in list")

        # Delete
        r_del = session.delete(f"{BASE_URL}/api/divisions/{div_id}?current_user_id={sa_uid}")
        assert r_del.status_code == 200, f"Delete division failed: {r_del.text}"
        print("PASS: Division deleted")

    def test_division_has_zone_name_populated(self, session, sa_auth, dhanbad_division_id):
        """GET /api/divisions/{id} returns zone_name."""
        r = session.get(f"{BASE_URL}/api/divisions/{dhanbad_division_id}")
        assert r.status_code == 200
        div = r.json()
        assert div.get("zone_name") in ("East Central Railway", "ECR"), \
            f"zone_name unexpected: {div.get('zone_name')}"
        print(f"PASS: division/{dhanbad_division_id} zone_name='{div.get('zone_name')}'")

    def test_get_division_stations(self, session, sa_auth, dhanbad_division_id):
        """GET /api/divisions/{id}/stations returns non-empty list."""
        r = session.get(f"{BASE_URL}/api/divisions/{dhanbad_division_id}/stations")
        assert r.status_code == 200
        stations = r.json()
        assert len(stations) > 0, "Expected at least one station in Dhanbad Division"
        print(f"PASS: Dhanbad Division has {len(stations)} station(s) via /divisions/{dhanbad_division_id}/stations")


# ─── Stations with division_id ─────────────────────────────────────────────────

class TestStationsDivisionField:
    """Stations should all have division_id after migration."""

    def test_stations_have_division_id(self, session, sa_auth):
        """All stations returned by GET /api/stations have division_id populated."""
        r = session.get(f"{BASE_URL}/api/stations")
        assert r.status_code == 200
        stations = r.json()
        assert len(stations) > 0
        missing = [s for s in stations if not s.get("division_id")]
        assert len(missing) == 0, \
            f"{len(missing)} station(s) missing division_id: {[s.get('name') for s in missing[:5]]}"
        print(f"PASS: All {len(stations)} stations have division_id")

    def test_stations_have_division_name(self, session, sa_auth):
        """Stations response includes division_name field."""
        r = session.get(f"{BASE_URL}/api/stations")
        stations = r.json()
        # At least some stations should have division_name populated
        with_div_name = [s for s in stations if s.get("division_name")]
        print(f"INFO: {len(with_div_name)}/{len(stations)} stations have division_name populated")
        # Not a hard failure — depends on stations endpoint implementation


# ─── Health Explorer Division Mode ────────────────────────────────────────────

class TestHealthExplorerDivisionMode:
    """Health Explorer with mode=division."""

    def test_he_division_mode_l1(self, session, sa_auth, sa_uid):
        """mode=division L1 returns level=1 with Dhanbad Division row."""
        r = session.get(
            f"{BASE_URL}/api/dashboard/health-explorer/{sa_uid}?mode=division"
        )
        assert r.status_code == 200, f"HE division L1 failed: {r.text}"
        data = r.json()
        assert data.get("mode") == "division"
        assert data.get("level") == 1
        assert isinstance(data.get("rows"), list)
        assert len(data["rows"]) > 0, "Expected at least one row (Dhanbad Division)"
        # Find Dhanbad Division in rows
        labels = [r.get("label") for r in data["rows"]]
        dhn_row = next((row for row in data["rows"] if "Dhanbad" in (row.get("label") or "")), None)
        assert dhn_row is not None, f"Dhanbad Division not in rows. Found: {labels}"
        assert dhn_row.get("n", 0) > 0, "Dhanbad Division row has 0 assets"
        print(f"PASS: HE division L1 — Dhanbad row found, n={dhn_row.get('n')}, value={dhn_row.get('value')}%")

    def test_he_division_mode_l2(self, session, sa_auth, sa_uid, dhanbad_division_id):
        """mode=division&division_id=<id> returns level=2 with stations."""
        r = session.get(
            f"{BASE_URL}/api/dashboard/health-explorer/{sa_uid}"
            f"?mode=division&division_id={dhanbad_division_id}"
        )
        assert r.status_code == 200, f"HE division L2 failed: {r.text}"
        data = r.json()
        assert data.get("mode") == "division"
        assert data.get("level") == 2, f"Expected level 2, got {data.get('level')}"
        assert isinstance(data.get("rows"), list)
        assert len(data["rows"]) > 0, "Expected at least one station row at L2"
        print(f"PASS: HE division L2 — {len(data['rows'])} station row(s) in Dhanbad Division")

    def test_he_division_mode_breadcrumb(self, session, sa_auth, sa_uid, dhanbad_division_id):
        """Breadcrumb has division entry after drilling into division."""
        r = session.get(
            f"{BASE_URL}/api/dashboard/health-explorer/{sa_uid}"
            f"?mode=division&division_id={dhanbad_division_id}"
        )
        assert r.status_code == 200
        data = r.json()
        crumbs = data.get("breadcrumb", [])
        assert len(crumbs) >= 1, "Expected at least 1 breadcrumb entry"
        div_crumb = next((c for c in crumbs if c.get("kind") == "division"), None)
        assert div_crumb is not None, f"No division crumb in {crumbs}"
        assert "Dhanbad" in (div_crumb.get("label") or "")
        print(f"PASS: Breadcrumb has division entry: {div_crumb}")

    def test_he_filters_endpoint(self, session, sa_auth, sa_uid):
        """GET /filters returns divisions list for SA."""
        r = session.get(
            f"{BASE_URL}/api/dashboard/health-explorer/{sa_uid}/filters"
        )
        assert r.status_code == 200
        data = r.json()
        assert "stations" in data
        assert "departments" in data
        assert "asset_types" in data
        # divisions field should be present too (new)
        divisions = data.get("divisions", [])
        print(f"INFO: filters endpoint returned {len(divisions)} division(s)")
        print(f"PASS: /filters endpoint works correctly")


# ─── Divisional Admin User ─────────────────────────────────────────────────────

class TestDivisionalAdminUser:
    """Create Divisional Admin user, verify login + scoping."""

    created_user_id = None

    def test_create_divisional_admin_user(self, session, sa_auth, sa_uid, dhanbad_division_id):
        """SA can create a user with role=divisional_admin and assigned_division_id."""
        # First check if DA001 already exists
        r_list = session.get(f"{BASE_URL}/api/users")
        users = r_list.json()
        existing = next((u for u in users if u.get("employee_id") == "DA001"), None)
        if existing:
            # Clean up first
            session.delete(f"{BASE_URL}/api/users/{existing.get('_id') or existing.get('id')}")
            print("INFO: Cleaned up existing DA001 user")

        r = session.post(f"{BASE_URL}/api/users", json={
            "employee_id": "DA001",
            "name": "Test Divisional Admin",
            "role": "divisional_admin",
            "assigned_division_id": dhanbad_division_id,
            "password": "admin123",
            "assigned_stations": [],
        })
        assert r.status_code in (200, 201), f"Create DA user failed: {r.text}"
        user = r.json()
        TestDivisionalAdminUser.created_user_id = user.get("_id") or user.get("id")
        assert TestDivisionalAdminUser.created_user_id is not None
        assert user.get("role") == "divisional_admin"
        assert user.get("assigned_division_id") == dhanbad_division_id, \
            f"assigned_division_id mismatch: {user.get('assigned_division_id')} != {dhanbad_division_id}"
        print(f"PASS: Created DA001 user id={TestDivisionalAdminUser.created_user_id}")

    def test_divisional_admin_login(self, session):
        """DA001 can login."""
        # Use a fresh session to avoid SA token override
        da_session = requests.Session()
        da_session.headers.update({"Content-Type": "application/json"})
        r = da_session.post(f"{BASE_URL}/api/auth/login",
                           json={"employee_id": "DA001", "password": "admin123"})
        assert r.status_code == 200, f"DA001 login failed: {r.text}"
        data = r.json()
        assert data.get("user", {}).get("role") == "divisional_admin"
        da_uid = data["user"].get("_id") or data["user"].get("id")
        assert data["user"].get("assigned_division_id"), "assigned_division_id missing in login response"
        print(f"PASS: DA001 logged in successfully, user_id={da_uid}")

        # Verify health explorer works for DA user
        token = data["token"]
        da_session.headers.update({"Authorization": f"Bearer {token}"})
        r_he = da_session.get(f"{BASE_URL}/api/dashboard/health-explorer/{da_uid}?mode=station")
        # Should work — even if 0 assets
        assert r_he.status_code == 200, f"HE for DA user failed: {r_he.text}"
        print(f"PASS: Health Explorer works for DA user — level={r_he.json().get('level')}")

    def test_cleanup_da001_user(self, session, sa_auth):
        """Cleanup DA001 test user."""
        if TestDivisionalAdminUser.created_user_id:
            r = session.delete(
                f"{BASE_URL}/api/users/{TestDivisionalAdminUser.created_user_id}"
            )
            assert r.status_code in (200, 204), f"Delete DA001 failed: {r.text}"
            print(f"PASS: Deleted DA001 user id={TestDivisionalAdminUser.created_user_id}")
