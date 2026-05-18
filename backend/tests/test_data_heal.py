"""End-to-end tests for /api/data-heal/* — production data reconciliation.

Seeds three discrepancies into the real DB, runs preview + execute, asserts
counts match, then verifies a second run is idempotent.

Uses the sync pymongo client for DB setup/teardown so each test runs in its
own asyncio loop without leaking motor connections.
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
s_zones = sync_db["zones"]
s_divisions = sync_db["divisions"]
s_stations = sync_db["stations"]
s_locations = sync_db["locations"]
s_users = sync_db["users"]

API_URL = os.environ.get("REACT_APP_BACKEND_URL") or \
    open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()


@pytest.fixture
def sa_id():
    u = s_users.find_one({"employee_id": "SA001"})
    assert u, "Seed user SA001 missing"
    return str(u["_id"])


@pytest.fixture
def seed_drift():
    """Seed: 1 asset+no-OL (forward), 1 OL+working-asset (backward), 1 orphan div."""
    created = {"asset_ids": [], "ol_ids": [], "div_id": None}

    at = s_asset_types.find_one({})
    st = s_stations.find_one({})
    loc = s_locations.find_one({})
    assert at and st and loc, "Need seed asset_type/station/location"

    r1 = s_assets.insert_one({
        "asset_number": f"HEAL_FWD_{ObjectId()}",
        "asset_type_id": str(at["_id"]),
        "station_id": str(st["_id"]),
        "location_id": str(loc["_id"]),
        "status": "defective",
        "defective_since": now_ist() - timedelta(days=3),
        "created_at": now_ist(),
    })
    created["asset_ids"].append(str(r1.inserted_id))

    r2 = s_assets.insert_one({
        "asset_number": f"HEAL_BWD_{ObjectId()}",
        "asset_type_id": str(at["_id"]),
        "station_id": str(st["_id"]),
        "location_id": str(loc["_id"]),
        "status": "working",
        "created_at": now_ist(),
    })
    created["asset_ids"].append(str(r2.inserted_id))
    r2_ol = s_orange.insert_one({
        "asset_id": str(r2.inserted_id),
        "status": "defective",
        "defective_since": now_ist() - timedelta(days=5),
        "remarks": "test seed for backward heal",
        "created_at": now_ist(),
    })
    created["ol_ids"].append(str(r2_ol.inserted_id))

    bogus_zone = str(ObjectId())
    r3 = s_divisions.insert_one({
        "name": f"HEAL_ORPHAN_DIV_{ObjectId()}",
        "code": f"HOD{str(ObjectId())[-4:].upper()}",
        "zone_id": bogus_zone,
        "created_at": now_ist(),
    })
    created["div_id"] = str(r3.inserted_id)

    if not s_zones.find_one({"code": "ECR"}):
        s_zones.insert_one({
            "name": "East Central Railway", "code": "ECR", "created_at": now_ist(),
        })

    yield created

    if created["asset_ids"]:
        s_assets.delete_many(
            {"_id": {"$in": [ObjectId(a) for a in created["asset_ids"]]}})
    if created["ol_ids"]:
        s_orange.delete_many(
            {"_id": {"$in": [ObjectId(o) for o in created["ol_ids"]]}})
    s_orange.delete_many({"asset_id": {"$in": created["asset_ids"]}})
    if created["div_id"]:
        s_divisions.delete_one({"_id": ObjectId(created["div_id"])})


def test_preview_finds_drift(sa_id, seed_drift):
    r = httpx.post(f"{API_URL}/api/data-heal/preview/{sa_id}", timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["dry_run"] is True
    assert data["orange_list"]["forward_create_count"] >= 1
    assert data["orange_list"]["backward_fix_count"] >= 1
    assert data["divisions"]["orphan_count"] >= 1
    assert data["divisions"]["target_zone"] is not None


def test_execute_heals_and_is_idempotent(sa_id, seed_drift):
    r1 = httpx.post(f"{API_URL}/api/data-heal/execute/{sa_id}", timeout=30)
    assert r1.status_code == 200, r1.text
    d1 = r1.json()
    assert d1["dry_run"] is False
    assert d1["orange_list"]["forward_create_count"] >= 1
    assert d1["orange_list"]["backward_fix_count"] >= 1
    assert d1["divisions"]["relink_count"] >= 1

    # forward → OL row now exists
    a_id = seed_drift["asset_ids"][0]
    ol = s_orange.find_one({"asset_id": a_id, "status": {"$ne": "resolved"}})
    assert ol is not None, "Forward heal did not create OL row"

    # backward → asset flipped to defective
    a = s_assets.find_one({"_id": ObjectId(seed_drift["asset_ids"][1])})
    assert a.get("status") == "defective"

    # division relinked to a real zone
    d = s_divisions.find_one({"_id": ObjectId(seed_drift["div_id"])})
    z = s_zones.find_one({"_id": ObjectId(d.get("zone_id"))})
    assert z is not None

    # Idempotent re-run
    r2 = httpx.post(f"{API_URL}/api/data-heal/execute/{sa_id}", timeout=30)
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["orange_list"]["forward_create_count"] == 0
    assert d2["orange_list"]["backward_fix_count"] == 0
    assert d2["divisions"]["orphan_count"] == 0


def test_audit_endpoint_returns_history(sa_id):
    r = httpx.get(f"{API_URL}/api/data-heal/audit/{sa_id}?limit=5", timeout=10)
    assert r.status_code == 200
    rows = r.json().get("rows", [])
    assert isinstance(rows, list)


def test_non_superadmin_forbidden():
    u = s_users.find_one({"role": {"$ne": "superadmin"}})
    if not u:
        pytest.skip("No non-superadmin user available")
    r = httpx.post(f"{API_URL}/api/data-heal/preview/{str(u['_id'])}", timeout=10)
    assert r.status_code == 403
