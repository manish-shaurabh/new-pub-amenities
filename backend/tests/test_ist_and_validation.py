"""IST datetime + timestamp ordering validation tests for Phase-IST hardening.

Covers:
  - GET /api/orange-list returns naive IST strings (no Z, no +/- offset)
  - GET /api/dashboard/superadmin returns health.{working,orange,red,yellow}
    and counts are internally consistent
  - POST /api/inspections rejects future / impossible defective_since
  - POST /api/orange-list/{id}/mark-working rejects future / pre-defective_since
  - POST /api/orange-list/{id}/mark-working succeeds with valid timestamp
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:3000").rstrip("/")
ISO_NAIVE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$")


# ── Helpers ────────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def sa_login(s):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"employee_id": "SA001", "password": "admin123"})
    if r.status_code != 200:
        pytest.skip(f"SA login failed: {r.status_code} {r.text}")
    body = r.json()
    user = body.get("user") or {}
    uid = user.get("id") or user.get("_id")
    token = body.get("token") or body.get("access_token") or ""
    if not uid:
        pytest.skip(f"SA user id missing in login response: {body}")
    return {"token": token, "user_id": uid}


@pytest.fixture(scope="module")
def sa_token(sa_login):
    return sa_login["token"]


@pytest.fixture(scope="module")
def sa_user_id(sa_login):
    return sa_login["user_id"]


# ── 1. IST formatting on GET /api/orange-list ───────────────────────────────
class TestOrangeListIST:
    def test_orange_list_returns_naive_ist_strings(self, s):
        r = s.get(f"{BASE_URL}/api/orange-list")
        assert r.status_code == 200, r.text[:500]
        try:
            body = r.json()
        except Exception:
            pytest.fail(f"Non-JSON response: {r.text[:300]}")
        items = body.get("items") if isinstance(body, dict) else body
        assert isinstance(items, list)
        if not items:
            pytest.skip("No orange-list items to validate format")
        sampled = 0
        for it in items[:15]:
            for key in ("defective_since", "created_at", "marked_working_at", "approved_at"):
                v = it.get(key)
                if v is None:
                    continue
                assert isinstance(v, str), f"{key} not a string: {v!r}"
                assert "Z" not in v, f"{key} has trailing Z: {v}"
                assert "+" not in v and not v.endswith("00:00"), f"{key} has tz offset: {v}"
                assert ISO_NAIVE_RE.match(v), f"{key} not naive ISO: {v}"
                sampled += 1
        assert sampled > 0, "no datetime fields encountered"


# ── 2. Superadmin dashboard list_consistency ────────────────────────────────
class TestSuperadminDashboardConsistency:
    def test_health_counts_consistent(self, s, sa_user_id):
        r = s.get(f"{BASE_URL}/api/dashboard/superadmin", params={"current_user_id": sa_user_id})
        assert r.status_code == 200, r.text
        d = r.json()
        # Locate health bucket regardless of nesting
        health = d.get("health") or d.get("overall_health") or {}
        # If nested inside another structure, scan
        if not health:
            for v in d.values():
                if isinstance(v, dict) and {"working", "orange", "red"} <= set(v.keys()):
                    health = v
                    break
        assert health, f"health bucket not found in {list(d.keys())}"
        for k in ("working", "orange", "red", "yellow"):
            assert k in health, f"health.{k} missing — got {list(health.keys())}"
            assert isinstance(health[k], int), f"health.{k} not int"

        # Cross-check with orange-list: orange+red == defective open OL,
        # yellow == pending_approval open OL
        rl = s.get(f"{BASE_URL}/api/orange-list", params={"page_size": 1000})
        assert rl.status_code == 200
        body = rl.json()
        items = body.get("items") if isinstance(body, dict) else body
        ol_def = sum(1 for x in items if x.get("status") == "defective")
        ol_pending = sum(1 for x in items if x.get("status") == "pending_approval")
        assert health["orange"] + health["red"] == ol_def, (
            f"orange+red={health['orange'] + health['red']} != ol_defective={ol_def}"
        )
        assert health["yellow"] == ol_pending, (
            f"yellow={health['yellow']} != ol_pending={ol_pending}"
        )


# ── 3. Inspection timestamp validation ─────────────────────────────────────
class TestInspectionValidation:
    def _pick_asset(self, s):
        r = s.get(f"{BASE_URL}/api/assets", params={"status": "working"})
        if r.status_code != 200:
            r = s.get(f"{BASE_URL}/api/assets")
        assets = r.json() if r.status_code == 200 else []
        if isinstance(assets, dict):
            assets = assets.get("items", [])
        for a in assets:
            if a.get("status") == "working":
                return a
        return assets[0] if assets else None

    def test_reject_future_defective_since(self, s, sa_user_id):
        asset = self._pick_asset(s)
        if not asset:
            pytest.skip("No assets available")
        future = (datetime.now() + timedelta(days=1)).replace(microsecond=0).isoformat()
        now_iso = datetime.now().replace(microsecond=0).isoformat()
        payload = {
            "inspection_type": "individual",
            "station_id": asset.get("station_id"),
            "inspector_id": sa_user_id,
            "inspection_at": now_iso,
            "items": [{
                "asset_id": asset.get("id") or asset.get("_id"),
                "status": "not_ok",
                "remarks": "TEST_future_ds",
                "defective_since": future,
            }],
        }
        r = s.post(f"{BASE_URL}/api/inspections", json=payload)
        assert r.status_code == 400, f"Expected 400 got {r.status_code}: {r.text}"

    def test_reject_defective_since_after_inspection_at(self, s, sa_user_id):
        asset = self._pick_asset(s)
        if not asset:
            pytest.skip("No assets available")
        now = datetime.now().replace(microsecond=0)
        insp_at = (now - timedelta(hours=2)).isoformat()
        ds = (now - timedelta(minutes=30)).isoformat()  # AFTER insp_at
        payload = {
            "inspection_type": "individual",
            "station_id": asset.get("station_id"),
            "inspector_id": sa_user_id,
            "inspection_at": insp_at,
            "items": [{
                "asset_id": asset.get("id") or asset.get("_id"),
                "status": "not_ok",
                "remarks": "TEST_ds_after_insp",
                "defective_since": ds,
            }],
        }
        r = s.post(f"{BASE_URL}/api/inspections", json=payload)
        assert r.status_code == 400, f"Expected 400 got {r.status_code}: {r.text}"


# ── 4. Mark-working validation + happy path ────────────────────────────────
class TestMarkWorkingValidation:
    def _pick_open_defective_ol(self, s):
        r = s.get(f"{BASE_URL}/api/orange-list", params={"page_size": 200})
        body = r.json() if r.status_code == 200 else []
        items = body.get("items") if isinstance(body, dict) else body
        for it in items or []:
            if it.get("status") == "defective" and it.get("defective_since"):
                return it
        return None

    def test_reject_future_marked_working_at(self, s, sa_user_id):
        ol = self._pick_open_defective_ol(s)
        if not ol:
            pytest.skip("No defective OL entry")
        future = (datetime.now() + timedelta(days=2)).replace(microsecond=0).isoformat()
        r = s.post(
            f"{BASE_URL}/api/orange-list/{ol.get('id') or ol.get('_id')}/mark-working",
            json={
                "marked_by": sa_user_id,
                "marked_working_at": future,
                "remarks": "TEST_future_mw",
            },
        )
        assert r.status_code == 400, f"Expected 400 got {r.status_code}: {r.text}"

    def test_reject_marked_working_before_defective_since(self, s, sa_user_id):
        ol = self._pick_open_defective_ol(s)
        if not ol:
            pytest.skip("No defective OL entry")
        ds = datetime.fromisoformat(str(ol["defective_since"]).replace("Z", ""))
        before = (ds - timedelta(days=2)).replace(microsecond=0).isoformat()
        r = s.post(
            f"{BASE_URL}/api/orange-list/{ol.get('id') or ol.get('_id')}/mark-working",
            json={
                "marked_by": sa_user_id,
                "marked_working_at": before,
                "remarks": "TEST_before_ds",
            },
        )
        assert r.status_code == 400, f"Expected 400 got {r.status_code}: {r.text}"

    def test_mark_working_succeeds_with_valid_timestamp(self, s, sa_user_id):
        ol = self._pick_open_defective_ol(s)
        if not ol:
            pytest.skip("No defective OL entry")
        ol_id = ol.get("id") or ol.get("_id")
        ds = datetime.fromisoformat(str(ol["defective_since"]).replace("Z", ""))
        valid = (ds + timedelta(minutes=10)).replace(microsecond=0).isoformat()
        r = s.post(
            f"{BASE_URL}/api/orange-list/{ol_id}/mark-working",
            json={
                "marked_by": sa_user_id,
                "marked_working_at": valid,
                "remarks": "TEST_valid_mw",
            },
        )
        assert r.status_code == 200, f"Expected 200 got {r.status_code}: {r.text}"
        # Verify state moved to pending_approval
        rv = s.get(f"{BASE_URL}/api/orange-list", params={"page_size": 500})
        body = rv.json()
        items = body.get("items") if isinstance(body, dict) else body
        match = next((x for x in (items or []) if (x.get("id") or x.get("_id")) == ol_id), None)
        if match is not None:
            assert match.get("status") == "pending_approval"
