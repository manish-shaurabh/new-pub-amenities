"""E2E tests for the 'missing' deficiency flow.

Verifies:
  1. PATCH /api/assets/{id}/status with status='missing' creates an OL row with
     kind='missing' (and back-to-working moves the same OL to pending_approval).
  2. POST /api/inspections with item.status='missing' creates an OL row with
     kind='missing' and sets asset.status='missing'.
  3. OL list endpoint returns the `kind` field (defaulting to 'defective').
  4. data-heal forward heal back-fills OL rows for status='missing' assets too.
"""
import os
import sys
from datetime import timedelta

import httpx
import pytest
from bson import ObjectId

sys.path.insert(0, "/app/backend")
from database import sync_db, now_ist  # noqa: E402

s_assets = sync_db["assets"]
s_asset_types = sync_db["asset_types"]
s_orange = sync_db["orange_list"]
s_stations = sync_db["stations"]
s_locations = sync_db["locations"]
s_users = sync_db["users"]

API_URL = os.environ.get("REACT_APP_BACKEND_URL") or \
    open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()


@pytest.fixture
def sa_id():
    u = s_users.find_one({"employee_id": "SA001"})
    assert u, "SA001 missing"
    return str(u["_id"])


@pytest.fixture
def fresh_asset():
    """Create a working asset, yield its id, then remove asset + OL rows."""
    at = s_asset_types.find_one({})
    st = s_stations.find_one({})
    loc = s_locations.find_one({})
    assert at and st and loc

    r = s_assets.insert_one({
        "asset_number": f"MISSTEST_{ObjectId()}",
        "asset_type_id": str(at["_id"]),
        "station_id": str(st["_id"]),
        "location_id": str(loc["_id"]),
        "status": "working",
        "tracking_mode": "individual",
        "created_at": now_ist(),
    })
    aid = str(r.inserted_id)
    yield aid
    s_assets.delete_one({"_id": ObjectId(aid)})
    s_orange.delete_many({"asset_id": aid})


def test_patch_status_missing_creates_ol(fresh_asset, sa_id):
    r = httpx.patch(
        f"{API_URL}/api/assets/{fresh_asset}/status",
        json={"status": "missing", "actor_id": sa_id, "remarks": "Test absent"},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("status") == "missing"

    ol = s_orange.find_one({"asset_id": fresh_asset, "status": {"$ne": "resolved"}})
    assert ol is not None
    assert ol.get("kind") == "missing"
    assert "Test absent" in (ol.get("remarks") or "")


def test_patch_status_back_to_working_moves_ol_to_yellow(fresh_asset, sa_id):
    # First mark missing
    httpx.patch(
        f"{API_URL}/api/assets/{fresh_asset}/status",
        json={"status": "missing", "actor_id": sa_id},
        timeout=10,
    )
    # Then back to working
    r = httpx.patch(
        f"{API_URL}/api/assets/{fresh_asset}/status",
        json={"status": "working", "actor_id": sa_id, "remarks": "Recovered"},
        timeout=10,
    )
    assert r.status_code == 200
    # Asset transitions to pending_approval (mirrors mark-working flow)
    assert r.json().get("status") == "pending_approval"
    ol = s_orange.find_one({"asset_id": fresh_asset})
    assert ol is not None
    assert ol.get("status") == "pending_approval"
    assert ol.get("marked_working_by") == sa_id


def test_inspection_with_missing_status_creates_ol(fresh_asset, sa_id):
    payload = {
        "inspection_type": "individual",
        "station_id": s_stations.find_one({})["_id"].__str__(),
        "inspector_id": sa_id,
        "items": [{
            "asset_id": fresh_asset,
            "status": "missing",
            "checklist_responses": [],
            "remarks": "Could not locate on site",
            "photo_urls": [],
        }],
        "participants": [],
    }
    r = httpx.post(f"{API_URL}/api/inspections", json=payload, timeout=15)
    assert r.status_code in (200, 201), r.text

    ol = s_orange.find_one({"asset_id": fresh_asset, "status": {"$ne": "resolved"}})
    assert ol is not None
    assert ol.get("kind") == "missing"

    a = s_assets.find_one({"_id": ObjectId(fresh_asset)})
    assert a.get("status") == "missing"


def test_ol_listing_returns_kind_field(fresh_asset, sa_id):
    httpx.patch(
        f"{API_URL}/api/assets/{fresh_asset}/status",
        json={"status": "missing", "actor_id": sa_id},
        timeout=10,
    )
    r = httpx.get(f"{API_URL}/api/orange-list", timeout=10)
    assert r.status_code == 200
    rows = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    mine = [x for x in rows if x.get("asset_id") == fresh_asset]
    assert mine, "Our missing asset's OL row not returned"
    assert mine[0].get("kind") == "missing"


def test_data_heal_backfills_missing_assets(sa_id):
    """Seed an asset with status='missing' AND no OL row; verify heal back-fills."""
    at = s_asset_types.find_one({})
    st = s_stations.find_one({})
    loc = s_locations.find_one({})
    r = s_assets.insert_one({
        "asset_number": f"HEALMISS_{ObjectId()}",
        "asset_type_id": str(at["_id"]),
        "station_id": str(st["_id"]),
        "location_id": str(loc["_id"]),
        "status": "missing",
        "defective_since": now_ist() - timedelta(days=2),
        "created_at": now_ist(),
    })
    aid = str(r.inserted_id)
    try:
        # Preview should see it
        prev = httpx.post(
            f"{API_URL}/api/data-heal/preview/{sa_id}", timeout=15).json()
        assert prev["orange_list"]["forward_create_count"] >= 1

        # Execute heals it
        httpx.post(f"{API_URL}/api/data-heal/execute/{sa_id}", timeout=15)
        ol = s_orange.find_one({"asset_id": aid, "status": {"$ne": "resolved"}})
        assert ol is not None
        assert ol.get("kind") == "missing"
    finally:
        s_assets.delete_one({"_id": ObjectId(aid)})
        s_orange.delete_many({"asset_id": aid})
