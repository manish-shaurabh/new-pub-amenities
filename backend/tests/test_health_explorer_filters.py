"""Regression test for the Zone→Division dropdown bug.

Symptom: selecting a zone showed an empty Division dropdown.
Root cause: /api/dashboard/health-explorer/{user_id}/filters omitted
`zone_id` and `assigned_stations` from each division, so the frontend
filter `d.zone_id === scopeZoneId` always evaluated false.

This test pins both fields into the contract.
"""
import os
import sys

import httpx
import pytest
from bson import ObjectId

sys.path.insert(0, "/app/backend")
from database import sync_db  # noqa: E402

s_users = sync_db["users"]
API_URL = os.environ.get("REACT_APP_BACKEND_URL") or \
    open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()


@pytest.fixture
def sa_id():
    u = s_users.find_one({"employee_id": "SA001"})
    assert u, "SA001 missing"
    return str(u["_id"])


def test_filters_response_includes_zone_id_and_assigned_stations(sa_id):
    r = httpx.get(
        f"{API_URL}/api/dashboard/health-explorer/{sa_id}/filters",
        timeout=15,
    )
    assert r.status_code == 200, r.text
    divs = r.json().get("divisions", [])
    assert divs, "No divisions returned for SA — seed data missing?"
    for d in divs:
        # The frontend HealthExplorer.js filters with `d.zone_id === scopeZoneId`
        # and resolves stations with `div.assigned_stations`. Both keys must
        # exist on every division dict.
        assert "zone_id" in d, f"Missing zone_id on {d}"
        assert "assigned_stations" in d, f"Missing assigned_stations on {d}"
        # When zone_id is set it must be a valid ObjectId string
        if d["zone_id"]:
            ObjectId(d["zone_id"])  # raises if malformed
        assert isinstance(d["assigned_stations"], list)


def test_dhanbad_division_links_to_ecr_zone(sa_id):
    r = httpx.get(
        f"{API_URL}/api/dashboard/health-explorer/{sa_id}/filters",
        timeout=15,
    ).json()
    zones_resp = httpx.get(f"{API_URL}/api/zones", timeout=10).json()
    ecr = next((z for z in zones_resp if z.get("code") == "ECR"), None)
    assert ecr, "ECR zone not seeded"
    dhn = next((d for d in r["divisions"] if d.get("code") == "DHN"), None)
    assert dhn, "Dhanbad Division not present"
    assert dhn["zone_id"] == ecr["_id"], (
        f"DHN.zone_id={dhn['zone_id']} but ECR._id={ecr['_id']} — "
        "data drift. Run Admin → Health → Data Reconciliation."
    )
