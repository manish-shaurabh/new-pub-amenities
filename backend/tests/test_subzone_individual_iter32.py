"""Iteration 32 — Backend tests for Sub-Zone tagging on INDIVIDUAL assets
and bulk-assign endpoint.

Coverage:
- POST /api/assets (individual) persists sub_zone_id when provided
- POST /api/assets (individual) rejects sub_zone whose location differs from asset location
- PUT /api/assets/{id} updates sub_zone_id; null clears it
- PATCH /api/assets/bulk/sub-zone happy path
- PATCH bulk endpoint: mixed-location → 400
- PATCH bulk endpoint: sub_zone in different location → 400
- PATCH bulk endpoint: sub_zone_id=null clears assignments
- PATCH bulk endpoint: skips grouped assets (skipped_grouped count)
- GET /api/assets?sub_zone_id=X filters correctly
- GET /api/assets includes sub_zone_name in enrichment
"""
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


def _id_of(d):
    return d.get("id") or d.get("_id")


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login",
                      json={"employee_id": "SA001", "password": "admin123"})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture(scope="module")
def ctx(admin_token):
    tok = admin_token["token"]
    admin_id = _id_of(admin_token.get("user") or {})
    h = {"Authorization": f"Bearer {tok}"}
    params = {"requesting_user_id": admin_id} if admin_id else {}

    stations = requests.get(f"{API}/stations", headers=h, params=params).json()
    dhn = next(s for s in stations if s.get("code") == "DHN" or s.get("name") == "DHANBAD")
    station_id = _id_of(dhn)

    locations = requests.get(f"{API}/locations", headers=h,
                             params={**params, "station_id": station_id}).json()
    # We need two distinct locations to test the mixed-location guard.
    plat1 = next((l for l in locations if "PLATFORM 1" in (l.get("name") or "").upper()),
                 locations[0])
    other_loc = next((l for l in locations if _id_of(l) != _id_of(plat1)), None)

    asset_types = requests.get(f"{API}/asset-types", headers=h, params=params).json()
    # We need an INDIVIDUAL tracking-mode asset-type
    individual_at = next((at for at in asset_types
                          if (at.get("tracking_mode") or "individual") == "individual"), None)
    grouped_at = next((at for at in asset_types
                       if (at.get("tracking_mode") or "individual") == "grouped"), None)

    return {
        "headers": h,
        "params": params,
        "admin_id": admin_id,
        "station_id": station_id,
        "loc1": _id_of(plat1),
        "loc2": _id_of(other_loc) if other_loc else None,
        "individual_at": _id_of(individual_at) if individual_at else None,
        "grouped_at": _id_of(grouped_at) if grouped_at else None,
    }


@pytest.fixture(scope="module")
def sub_zones(ctx):
    """Create two sub-zones — one in loc1 and one in loc2 (if exists)."""
    h, params = ctx["headers"], ctx["params"]
    created = []
    # Sub-zone in loc1
    body1 = {"name": f"TEST_SZ_{uuid.uuid4().hex[:6]}",
             "code": f"TSZ-{uuid.uuid4().hex[:4].upper()}",
             "station_id": ctx["station_id"],
             "location_id": ctx["loc1"]}
    r1 = requests.post(f"{API}/sub-zones", headers=h, params=params, json=body1)
    assert r1.status_code in (200, 201), r1.text
    sz1 = r1.json()
    created.append(_id_of(sz1))

    sz2_id = None
    if ctx["loc2"]:
        body2 = {"name": f"TEST_SZ_{uuid.uuid4().hex[:6]}",
                 "code": f"TSZ-{uuid.uuid4().hex[:4].upper()}",
                 "station_id": ctx["station_id"],
                 "location_id": ctx["loc2"]}
        r2 = requests.post(f"{API}/sub-zones", headers=h, params=params, json=body2)
        assert r2.status_code in (200, 201), r2.text
        sz2 = r2.json()
        sz2_id = _id_of(sz2)
        created.append(sz2_id)

    yield {"sz1": _id_of(sz1), "sz2": sz2_id, "all": created}

    # Cleanup — best effort
    for sid in created:
        try:
            requests.delete(f"{API}/sub-zones/{sid}", headers=h, params=params)
        except Exception:
            pass


def _make_individual_asset(ctx, sub_zone_id=None, location_id=None):
    body = {
        "asset_type_id": ctx["individual_at"],
        "station_id": ctx["station_id"],
        "location_id": location_id or ctx["loc1"],
        "asset_number": f"TEST_AS_{uuid.uuid4().hex[:8].upper()}",
        "description": "iter32 test",
    }
    if sub_zone_id is not None:
        body["sub_zone_id"] = sub_zone_id
    r = requests.post(f"{API}/assets", headers=ctx["headers"], params=ctx["params"], json=body)
    return r


@pytest.fixture(scope="module")
def created_assets(ctx, sub_zones):
    ids = []
    yield ids
    for aid in ids:
        try:
            requests.delete(f"{API}/assets/{aid}",
                            headers=ctx["headers"], params=ctx["params"])
        except Exception:
            pass


# --------------------- Tests ---------------------

class TestIndividualSubZonePersistence:
    def test_create_individual_with_sub_zone_persists(self, ctx, sub_zones, created_assets):
        assert ctx["individual_at"], "Need an individual asset type"
        r = _make_individual_asset(ctx, sub_zone_id=sub_zones["sz1"])
        assert r.status_code in (200, 201), r.text
        data = r.json()
        aid = _id_of(data)
        created_assets.append(aid)
        assert data.get("sub_zone_id") == sub_zones["sz1"]

        # GET to confirm persistence
        g = requests.get(f"{API}/assets/{aid}",
                        headers=ctx["headers"], params=ctx["params"])
        assert g.status_code == 200
        gdata = g.json()
        assert gdata.get("sub_zone_id") == sub_zones["sz1"]
        assert gdata.get("sub_zone_name"), "sub_zone_name should be enriched"

    def test_create_individual_with_wrong_location_subzone_400(self, ctx, sub_zones):
        if not sub_zones["sz2"]:
            pytest.skip("Need two locations to test mismatch")
        # sub-zone belongs to loc2, asset to loc1 → 400
        r = _make_individual_asset(ctx, sub_zone_id=sub_zones["sz2"], location_id=ctx["loc1"])
        assert r.status_code == 400, r.text
        assert "location" in (r.json().get("detail") or "").lower()

    def test_update_individual_sets_and_clears_sub_zone(self, ctx, sub_zones, created_assets):
        # Create without sub-zone
        r = _make_individual_asset(ctx, sub_zone_id=None)
        assert r.status_code in (200, 201)
        aid = _id_of(r.json())
        created_assets.append(aid)

        # PUT to set sub_zone
        put_body = {
            "asset_type_id": ctx["individual_at"],
            "station_id": ctx["station_id"],
            "location_id": ctx["loc1"],
            "asset_number": r.json().get("asset_number"),
            "sub_zone_id": sub_zones["sz1"],
        }
        u = requests.put(f"{API}/assets/{aid}",
                         headers=ctx["headers"], params=ctx["params"], json=put_body)
        assert u.status_code == 200, u.text
        g = requests.get(f"{API}/assets/{aid}",
                         headers=ctx["headers"], params=ctx["params"])
        assert g.json().get("sub_zone_id") == sub_zones["sz1"]

        # Clear by sending null
        put_body["sub_zone_id"] = None
        u2 = requests.put(f"{API}/assets/{aid}",
                          headers=ctx["headers"], params=ctx["params"], json=put_body)
        assert u2.status_code == 200, u2.text
        g2 = requests.get(f"{API}/assets/{aid}",
                          headers=ctx["headers"], params=ctx["params"])
        assert (g2.json().get("sub_zone_id") in (None, "")), g2.json()


class TestAssetListFilter:
    def test_list_filter_by_sub_zone(self, ctx, sub_zones, created_assets):
        # Create a fresh asset tagged into sz1
        r = _make_individual_asset(ctx, sub_zone_id=sub_zones["sz1"])
        assert r.status_code in (200, 201)
        aid = _id_of(r.json())
        created_assets.append(aid)

        l = requests.get(f"{API}/assets",
                         headers=ctx["headers"],
                         params={**ctx["params"], "sub_zone_id": sub_zones["sz1"]})
        assert l.status_code == 200
        items = l.json() if isinstance(l.json(), list) else l.json().get("items", [])
        ids = {_id_of(x) for x in items}
        assert aid in ids
        # All items returned must have sub_zone_id matching the filter
        for it in items:
            assert it.get("sub_zone_id") == sub_zones["sz1"]


class TestBulkAssign:
    def test_bulk_assign_happy_path(self, ctx, sub_zones, created_assets):
        a1 = _id_of(_make_individual_asset(ctx, sub_zone_id=None).json())
        a2 = _id_of(_make_individual_asset(ctx, sub_zone_id=None).json())
        created_assets.extend([a1, a2])
        body = {"asset_ids": [a1, a2], "sub_zone_id": sub_zones["sz1"]}
        r = requests.patch(f"{API}/assets/bulk/sub-zone",
                           headers=ctx["headers"], params=ctx["params"], json=body)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("matched") == 2
        assert data.get("modified") == 2
        assert data.get("skipped_grouped") == 0
        # Verify persistence
        for aid in (a1, a2):
            g = requests.get(f"{API}/assets/{aid}",
                             headers=ctx["headers"], params=ctx["params"]).json()
            assert g.get("sub_zone_id") == sub_zones["sz1"]

    def test_bulk_mixed_locations_400(self, ctx, sub_zones, created_assets):
        if not ctx["loc2"]:
            pytest.skip("Need two locations")
        a1 = _id_of(_make_individual_asset(ctx, location_id=ctx["loc1"]).json())
        a2 = _id_of(_make_individual_asset(ctx, location_id=ctx["loc2"]).json())
        created_assets.extend([a1, a2])
        body = {"asset_ids": [a1, a2], "sub_zone_id": sub_zones["sz1"]}
        r = requests.patch(f"{API}/assets/bulk/sub-zone",
                           headers=ctx["headers"], params=ctx["params"], json=body)
        assert r.status_code == 400, r.text
        assert "same location" in (r.json().get("detail") or "").lower()

    def test_bulk_wrong_sub_zone_400(self, ctx, sub_zones, created_assets):
        if not sub_zones["sz2"]:
            pytest.skip("Need two sub-zones in different locations")
        a1 = _id_of(_make_individual_asset(ctx, location_id=ctx["loc1"]).json())
        created_assets.append(a1)
        body = {"asset_ids": [a1], "sub_zone_id": sub_zones["sz2"]}
        r = requests.patch(f"{API}/assets/bulk/sub-zone",
                           headers=ctx["headers"], params=ctx["params"], json=body)
        assert r.status_code == 400, r.text

    def test_bulk_clear_sub_zone_null(self, ctx, sub_zones, created_assets):
        a1 = _id_of(_make_individual_asset(ctx, sub_zone_id=sub_zones["sz1"]).json())
        a2 = _id_of(_make_individual_asset(ctx, sub_zone_id=sub_zones["sz1"]).json())
        created_assets.extend([a1, a2])
        body = {"asset_ids": [a1, a2], "sub_zone_id": None}
        r = requests.patch(f"{API}/assets/bulk/sub-zone",
                           headers=ctx["headers"], params=ctx["params"], json=body)
        assert r.status_code == 200, r.text
        assert r.json().get("modified") == 2
        for aid in (a1, a2):
            g = requests.get(f"{API}/assets/{aid}",
                             headers=ctx["headers"], params=ctx["params"]).json()
            assert g.get("sub_zone_id") in (None, "")

    def test_bulk_skips_grouped(self, ctx, sub_zones, created_assets):
        """Find an existing grouped asset in DHN/PLATFORM 1, mix with an
        individual asset and verify skipped_grouped count."""
        if not ctx["grouped_at"]:
            pytest.skip("No grouped asset type available")
        # Find a grouped asset in the same location as our individual ones
        listing = requests.get(f"{API}/assets",
                               headers=ctx["headers"],
                               params={**ctx["params"],
                                       "location_id": ctx["loc1"]}).json()
        items = listing if isinstance(listing, list) else listing.get("items", [])
        grouped = next((x for x in items if (x.get("tracking_mode") or "") == "grouped"), None)
        if not grouped:
            pytest.skip("No grouped asset in loc1 — seed expected: TEST-GROUP-FAN-DHN-PLATFORM-1-SZ-A")
        gid = _id_of(grouped)
        # one fresh individual asset in same location
        a1 = _id_of(_make_individual_asset(ctx, sub_zone_id=None).json())
        created_assets.append(a1)
        body = {"asset_ids": [a1, gid], "sub_zone_id": sub_zones["sz1"]}
        r = requests.patch(f"{API}/assets/bulk/sub-zone",
                           headers=ctx["headers"], params=ctx["params"], json=body)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("skipped_grouped") >= 1
        # Verify the grouped one wasn't reassigned
        g = requests.get(f"{API}/assets/{gid}",
                         headers=ctx["headers"], params=ctx["params"]).json()
        assert g.get("sub_zone_id") != sub_zones["sz1"]
        # Individual got the assignment
        gi = requests.get(f"{API}/assets/{a1}",
                          headers=ctx["headers"], params=ctx["params"]).json()
        assert gi.get("sub_zone_id") == sub_zones["sz1"]
