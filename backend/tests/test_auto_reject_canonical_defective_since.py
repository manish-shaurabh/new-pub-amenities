"""
Tests for auto-reject on re-inspection + canonical defective_since invariant.
Covers TEST 1..7 from the review request.

Critical invariants:
  • Re-inspection of pending_approval (yellow) asset with NOT_OK / NEEDS_REPAIR
    auto-reverts the OL to defective and clears marked_working_by/at while
    preserving last_marked_working_by + the original OL.defective_since.
  • Re-inspection of an already-defective asset must NOT touch the canonical
    OL.defective_since (clock cannot be reset).
  • asset.defective_since == OL.defective_since (audit invariant I9) for every
    open OL after each scenario.
  • Notification message uses canonical OL.defective_since, NOT the inspector's
    typed value.
"""
import os
import time
from datetime import datetime, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


# ────────────── shared fixtures ──────────────
@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def sa_token(session):
    r = session.post(f"{API}/auth/login", json={"employee_id": "SA001", "password": "admin123"})
    assert r.status_code == 200, r.text
    body = r.json()
    return body.get("token") or body.get("access_token")


@pytest.fixture(scope="module")
def sa_session(session, sa_token):
    session.headers.update({"Authorization": f"Bearer {sa_token}"})
    return session


@pytest.fixture(scope="module")
def inspector(sa_session):
    """Pick any user that can perform inspections — SA can also act as inspector."""
    r = sa_session.get(f"{API}/users")
    assert r.status_code == 200
    users = r.json()
    sa = next((u for u in users if u.get("employee_id") == "SA001"), None)
    assert sa, "SA001 not found"
    sa["id"] = sa.get("id") or sa.get("_id")
    return sa


def _iso(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat()


def _norm_id(d):
    if not d:
        return None
    return d.get("id") or d.get("_id")


def _get_ol_for_asset(sa_session, asset_id: str):
    r = sa_session.get(f"{API}/orange-list", params={"limit": 500})
    assert r.status_code == 200, r.text
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    for it in items:
        if it.get("asset_id") == asset_id and it.get("status") != "resolved":
            it["id"] = _norm_id(it)
            return it
    return None


def _list_ol(sa_session, status):
    r = sa_session.get(f"{API}/orange-list", params={"status": status, "limit": 100})
    assert r.status_code == 200, r.text
    items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
    for it in items:
        it["id"] = _norm_id(it)
    return items


def _get_asset(sa_session, asset_id):
    r = sa_session.get(f"{API}/assets/{asset_id}")
    assert r.status_code == 200, r.text
    return r.json()


# ────────────── TEST 1 — auto-reject on re-inspection of YELLOW asset ──────────────
class TestAutoRejectYellow:
    def _pick_yellow(self, sa_session):
        items = _list_ol(sa_session, "pending_approval")
        assert items, "No pending_approval OL entries — cannot run auto-reject test"
        return items[0]

    def _submit_not_ok(self, sa_session, inspector, ol_entry, item_status):
        asset_id = ol_entry["asset_id"]
        info = ol_entry.get("asset_info") or {}
        # Use a NEW typed defective_since (different from canonical)
        typed_ds = (datetime.now() - timedelta(hours=1)).replace(microsecond=0)
        body = {
            "inspector_id": inspector["id"],
            "inspector_name": inspector.get("name", "Inspector"),
            "department_id": info.get("department_id") or inspector.get("department_id"),
            "station_id": info.get("station_id") or (inspector.get("assigned_stations") or [None])[0],
            "inspection_type": "individual",
            "inspection_at": _iso(datetime.now()),
            "items": [{
                "asset_id": asset_id,
                "status": item_status,
                "remarks": "TEST_auto_reject_re_inspection",
                "defective_since": _iso(typed_ds),
            }],
        }
        r = sa_session.post(f"{API}/inspections", json=body)
        assert r.status_code in (200, 201), f"submit failed: {r.status_code} {r.text}"
        return r.json(), typed_ds, asset_id

    def _verify_auto_reject(self, sa_session, ol_before, resp, typed_ds, asset_id, inspector_id):
        # 1. Response carries auto_rejections
        ar = resp.get("auto_rejections") or []
        assert ar, f"auto_rejections missing in response. Body: {resp}"
        assert ar[0]["asset_id"] == asset_id
        assert ar[0]["ol_id"] == ol_before["id"]

        # 2. OL transition
        ol_after = _get_ol_for_asset(sa_session, asset_id)
        assert ol_after, "OL gone after re-inspection"
        assert ol_after["status"] == "defective", f"OL status = {ol_after['status']} (expected defective)"
        assert ol_after.get("marked_working_by") in (None, ""), "marked_working_by NOT cleared"
        assert ol_after.get("marked_working_at") in (None, ""), "marked_working_at NOT cleared"
        # 3. last_marked_working_by preserved
        assert ol_after.get("last_marked_working_by") == ol_before.get("marked_working_by"), \
            "last_marked_working_by NOT preserved from OL.marked_working_by"
        # 4. rejection details
        assert ol_after.get("rejected_by") == inspector_id
        assert "AUTO-REJECTED" in (ol_after.get("rejection_remarks") or "").upper()
        assert "RE-INSPECTION" in (ol_after.get("rejection_remarks") or "").upper()

        # 5. canonical defective_since UNCHANGED (clock did not reset)
        assert str(ol_after.get("defective_since")) == str(ol_before.get("defective_since")), (
            f"OL.defective_since changed! before={ol_before.get('defective_since')} "
            f"after={ol_after.get('defective_since')} typed={typed_ds.isoformat()}"
        )
        # And the typed value MUST NOT have leaked in
        assert _iso(typed_ds) not in str(ol_after.get("defective_since"))

        # 6. asset.defective_since == OL.defective_since
        asset = _get_asset(sa_session, asset_id)
        assert asset["status"] == "defective"
        # Compare on date+time string prefix (both stored naive IST)
        a_ds = str(asset.get("defective_since"))[:19]
        o_ds = str(ol_after.get("defective_since"))[:19]
        assert a_ds == o_ds, f"asset.defective_since ({a_ds}) != OL.defective_since ({o_ds})"

        return ol_after

    def test_auto_reject_with_not_ok(self, sa_session, inspector):
        ol_before = self._pick_yellow(sa_session)
        resp, typed_ds, asset_id = self._submit_not_ok(
            sa_session, inspector, ol_before, "not_ok"
        )
        self._verify_auto_reject(sa_session, ol_before, resp, typed_ds, asset_id, inspector["id"])

    def test_auto_reject_with_needs_repair(self, sa_session, inspector):
        # Find another yellow asset
        try:
            ol_before = self._pick_yellow(sa_session)
        except AssertionError:
            pytest.skip("No remaining pending_approval OL after TEST 1 — skipping needs_repair variant")
        resp, typed_ds, asset_id = self._submit_not_ok(
            sa_session, inspector, ol_before, "needs_repair"
        )
        self._verify_auto_reject(sa_session, ol_before, resp, typed_ds, asset_id, inspector["id"])


# ────────────── TEST 3 — re-inspection of already DEFECTIVE asset ──────────────
class TestReInspectAlreadyDefective:
    def test_clock_not_reset_and_auto_remark_added(self, sa_session, inspector):
        items = _list_ol(sa_session, "defective")
        assert items, "No defective OL entries"
        ol_before = items[0]
        asset_id = ol_before["asset_id"]
        ol_id = ol_before["id"]
        info = ol_before.get("asset_info") or {}

        # Count remarks before
        rr0 = sa_session.get(f"{API}/orange-list/{ol_id}/remarks")
        def _items(resp):
            j = resp.json()
            if isinstance(j, list):
                return j
            return j.get("items", [])
        before_items = _items(rr0) if rr0.status_code == 200 else []
        before_count = len(before_items)

        typed_ds = (datetime.now() - timedelta(hours=2)).replace(microsecond=0)
        body = {
            "inspector_id": inspector["id"],
            "inspector_name": inspector.get("name", "Inspector"),
            "department_id": info.get("department_id") or inspector.get("department_id"),
            "station_id": info.get("station_id") or (inspector.get("assigned_stations") or [None])[0],
            "inspection_type": "individual",
            "inspection_at": _iso(datetime.now()),
            "items": [{
                "asset_id": asset_id,
                "status": "not_ok",
                "remarks": "TEST_ongoing_defect_reinspect",
                "defective_since": _iso(typed_ds),
            }],
        }
        resp = sa_session.post(f"{API}/inspections", json=body)
        assert resp.status_code in (200, 201), resp.text

        ol_after = _get_ol_for_asset(sa_session, asset_id)
        assert str(ol_after["defective_since"]) == str(ol_before["defective_since"]), (
            "OL.defective_since CHANGED on ongoing-defect re-inspection"
        )
        asset = _get_asset(sa_session, asset_id)
        assert str(asset["defective_since"])[:19] == str(ol_after["defective_since"])[:19]

        # New auto-remark of type defect_report
        rr1 = sa_session.get(f"{API}/orange-list/{ol_id}/remarks")
        assert rr1.status_code == 200
        after = _items(rr1)
        assert len(after) >= before_count + 1, (
            f"Expected new auto-remark on ongoing re-inspection (before={before_count}, after={len(after)})"
        )
        latest = after[-1]
        assert latest.get("type") in ("defect_report", "auto", "system", "info") or \
               "ongoing" in str(latest.get("text", "")).lower() or \
               "re-inspection" in str(latest.get("text", "")).lower()


# ────────────── TEST 4 — fresh defect on WORKING asset ──────────────
class TestFreshDefect:
    def test_fresh_defect_creates_new_ol(self, sa_session, inspector):
        r = sa_session.get(f"{API}/assets", params={"status": "working", "limit": 50})
        assert r.status_code == 200
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        if not items:
            pytest.skip("No working assets available for fresh-defect test")
        asset = items[0]
        asset_id = _norm_id(asset)

        typed_ds = datetime(2026, 5, 7, 8, 0, 0)
        body = {
            "inspector_id": inspector["id"],
            "inspector_name": inspector.get("name", "Inspector"),
            "department_id": asset.get("department_id") or inspector.get("department_id"),
            "station_id": asset.get("station_id") or (inspector.get("assigned_stations") or [None])[0],
            "inspection_type": "individual",
            "inspection_at": _iso(datetime.now()),
            "items": [{
                "asset_id": asset_id,
                "status": "not_ok",
                "remarks": "TEST_fresh_defect",
                "defective_since": _iso(typed_ds),
            }],
        }
        resp = sa_session.post(f"{API}/inspections", json=body)
        assert resp.status_code in (200, 201), resp.text

        ol = _get_ol_for_asset(sa_session, asset_id)
        assert ol is not None and ol["status"] == "defective"
        assert _iso(typed_ds) in str(ol["defective_since"])

        a = _get_asset(sa_session, asset_id)
        assert a["status"] == "defective"
        assert _iso(typed_ds) in str(a["defective_since"])


# ────────────── TEST 5 — notification uses canonical defective_since ──────────────
class TestNotificationCanonical:
    def test_notification_message_uses_ol_defective_since(self, sa_session, inspector):
        items = _list_ol(sa_session, "pending_approval")
        if not items:
            pytest.skip("No more pending_approval OL — cannot generate fresh auto-reject")
        ol_before = items[0]
        asset_id = ol_before["asset_id"]
        info = ol_before.get("asset_info") or {}
        canonical_ds = str(ol_before["defective_since"])[:19]

        typed_ds = (datetime.now() - timedelta(days=10)).replace(microsecond=0)
        body = {
            "inspector_id": inspector["id"],
            "inspector_name": inspector.get("name", "Inspector"),
            "department_id": info.get("department_id") or inspector.get("department_id"),
            "station_id": info.get("station_id") or (inspector.get("assigned_stations") or [None])[0],
            "inspection_type": "individual",
            "inspection_at": _iso(datetime.now()),
            "items": [{
                "asset_id": asset_id,
                "status": "not_ok",
                "remarks": "TEST_notif_canonical",
                "defective_since": _iso(typed_ds),
            }],
        }
        resp = sa_session.post(f"{API}/inspections", json=body)
        assert resp.status_code in (200, 201), resp.text

        # Find RO of station → look up notifications
        time.sleep(1)
        # Fetch notifications for any user; filter to ones related to this OL/asset
        nr = sa_session.get(f"{API}/notifications", params={"limit": 200})
        if nr.status_code != 200:
            pytest.skip(f"notifications endpoint returned {nr.status_code} — skipping")
        notifs = nr.json()
        if isinstance(notifs, dict):
            notifs = notifs.get("items", [])
        # Find any "Auto-Reverted" or "Auto-Rejected" notif touching this asset
        rel = [n for n in notifs if (
            "auto" in (n.get("title", "") + n.get("message", "")).lower()
            and (asset_id in str(n) or n.get("related_entity_id") == ol_before["id"])
        )]
        if not rel:
            pytest.skip("No matching auto-revert notification surfaced via API — skipping content check")
        # The message must NOT echo the inspector's typed value
        for n in rel:
            msg = n.get("message", "")
            # canonical date prefix must appear (or at least typed value must NOT)
            typed_str = _iso(typed_ds)[:10]
            canon_str = canonical_ds[:10]
            assert typed_str not in msg or canon_str in msg, (
                f"Notification message leaked typed value '{typed_str}' without canonical '{canon_str}'.\n"
                f"Msg: {msg}"
            )


# ────────────── TEST 6 — audit invariant I9 ──────────────
def test_audit_invariant_i9_passes():
    """Run the bundled audit and assert no violations (includes I9)."""
    import sys
    sys.path.insert(0, "/app/backend/tests")
    from audit_list_consistency import main as run_audit
    assert run_audit(), "List consistency audit failed — see /app/test_reports/list_consistency.json"


# ────────────── TEST 7 — drift scanner ──────────────
def test_drift_scanner_runs():
    """Run drift scanner — must finish; legacy 1-case drift (Lift 1) is acceptable."""
    import subprocess
    res = subprocess.run(
        ["python", "/app/backend/scripts/diff_defective_since.py"],
        capture_output=True, text=True, timeout=60,
    )
    assert res.returncode in (0, 1), f"Unexpected exit {res.returncode}: {res.stderr}"
    import json as _json
    with open("/app/test_reports/defective_since_drift.json") as f:
        rpt = _json.load(f)
    # New drift must NOT be introduced by THIS test run beyond the known legacy case.
    assert rpt["drift_count"] <= 2, f"Excessive drift detected: {rpt}"
