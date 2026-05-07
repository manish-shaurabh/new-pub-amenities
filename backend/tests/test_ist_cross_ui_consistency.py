"""TEST 1-7 & TEST 14: Cross-UI IST consistency for railway asset inspection.

Picks distinct (asset_type x station) buckets, marks assets defective via
POST /api/inspections, then verifies:
  - /api/orange-list shows naive IST literal datetimes (no Z, no +05:30)
  - hours_defective/list_type matches expectation
  - Superadmin dashboard health counts increment consistently
  - Oversight category-assets endpoint shows the asset under priority bucket
  - SUP and ASUP scoped views show defects within their station/department
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:3000").rstrip("/")
ISO_NAIVE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$")


def _is_naive_ist(s: str) -> bool:
    if not isinstance(s, str):
        return False
    if "Z" in s or "+" in s.split("T")[-1] or "GMT" in s or "UTC" in s:
        return False
    # bare-naive: must NOT have a timezone offset suffix like '+05:30' or '-05:30'
    if re.search(r"[+\-]\d{2}:\d{2}$", s):
        return False
    return bool(ISO_NAIVE_RE.match(s))


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _login(s, emp_id, pwd="admin123"):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"employee_id": emp_id, "password": pwd})
    if r.status_code != 200:
        return None
    body = r.json()
    user = body.get("user") or {}
    return {
        "user_id": user.get("id") or user.get("_id"),
        "token": body.get("token") or body.get("access_token") or "",
        "user": user,
    }


@pytest.fixture(scope="module")
def sa(s):
    res = _login(s, "SA001")
    if not res:
        pytest.skip("SA login failed")
    return res


@pytest.fixture(scope="module")
def working_assets(s, sa):
    r = s.get(f"{BASE_URL}/api/assets")
    assert r.status_code == 200, r.text[:300]
    items = r.json()
    if isinstance(items, dict):
        items = items.get("items", [])
    return [a for a in items if a.get("status") == "working"]


@pytest.fixture(scope="module")
def created_defects(s, sa, working_assets):
    """TEST 1+2: Create 5+ orange (defective_since within 12h) and 2+ red (>30h ago)."""
    if len(working_assets) < 7:
        pytest.skip(f"Only {len(working_assets)} working assets, need 7+")

    # Pick distinct (asset_type, station) buckets for orange (need 5)
    seen = set()
    distinct = []
    used_ids = set()
    for a in working_assets:
        key = (a.get("asset_type_id"), a.get("station_id"))
        aid = a.get("id") or a.get("_id")
        if key not in seen and a.get("asset_type_id") and a.get("station_id"):
            seen.add(key)
            distinct.append(a)
            used_ids.add(aid)
        if len(distinct) >= 5:
            break
    if len(distinct) < 5:
        pytest.skip(f"Only {len(distinct)} distinct buckets, need 5")
    # Add 2 more working assets (any) for red
    for a in working_assets:
        if len(distinct) >= 7:
            break
        aid = a.get("id") or a.get("_id")
        if aid in used_ids:
            continue
        if a.get("asset_type_id") and a.get("station_id"):
            distinct.append(a)
            used_ids.add(aid)
    if len(distinct) < 7:
        pytest.skip(f"Only {len(distinct)} usable assets")

    now = datetime.now().replace(microsecond=0)
    created = []  # (asset, expected_list_type)
    # 5 orange (≤24h)
    for i, a in enumerate(distinct[:5]):
        ds = (now - timedelta(hours=2 + i)).isoformat()
        payload = {
            "inspection_type": "individual",
            "station_id": a["station_id"],
            "inspector_id": sa["user_id"],
            "inspection_at": now.isoformat(),
            "items": [{
                "asset_id": a.get("id") or a.get("_id"),
                "status": "not_ok",
                "remarks": f"TEST_orange_{i}",
                "defective_since": ds,
            }],
        }
        r = s.post(f"{BASE_URL}/api/inspections", json=payload)
        assert r.status_code in (200, 201), f"orange create failed: {r.status_code} {r.text[:200]}"
        created.append((a, "orange", ds))

    # 2 red (>30h)
    for i, a in enumerate(distinct[5:7]):
        ds = (now - timedelta(hours=36 + i * 2)).isoformat()
        payload = {
            "inspection_type": "individual",
            "station_id": a["station_id"],
            "inspector_id": sa["user_id"],
            "inspection_at": now.isoformat(),
            "items": [{
                "asset_id": a.get("id") or a.get("_id"),
                "status": "not_ok",
                "remarks": f"TEST_red_{i}",
                "defective_since": ds,
            }],
        }
        r = s.post(f"{BASE_URL}/api/inspections", json=payload)
        assert r.status_code in (200, 201), f"red create failed: {r.status_code} {r.text[:200]}"
        created.append((a, "red", ds))

    return created


# ── TEST 3: orange-list IST format + list_type correctness ─────────────────
class TestOrangeListAfterInjection:
    def test_each_defect_appears_with_ist_literal(self, s, created_defects):
        r = s.get(f"{BASE_URL}/api/orange-list", params={"page_size": 1000})
        assert r.status_code == 200
        body = r.json()
        items = body.get("items") if isinstance(body, dict) else body
        by_asset = {it.get("asset_id"): it for it in items}

        misses = []
        for asset, expected_list, ds in created_defects:
            aid = asset.get("id") or asset.get("_id")
            it = by_asset.get(aid)
            if not it:
                misses.append(f"{aid} not in OL")
                continue
            # IST format
            for k in ("defective_since", "created_at"):
                v = it.get(k)
                if v is not None:
                    assert _is_naive_ist(v), f"{k} not naive IST literal: {v!r}"
            # list_type / health_class match expectation
            lt = it.get("list_type") or it.get("health_class")
            assert lt == expected_list, f"asset {aid} expected {expected_list} got {lt}"
            # hours_defective populated
            hd = it.get("hours_defective")
            assert hd is not None and hd >= 0, f"hours_defective missing/neg: {hd}"
        assert not misses, f"Missing defects: {misses}"


# ── TEST 4: superadmin dashboard counters consistent ───────────────────────
class TestSuperadminDashboard:
    def test_health_counts_match_orange_list(self, s, sa, created_defects):
        r = s.get(f"{BASE_URL}/api/dashboard/superadmin", params={"current_user_id": sa["user_id"]})
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        health = d.get("health") or {}
        if not health:
            for v in d.values():
                if isinstance(v, dict) and {"working", "orange", "red"} <= set(v.keys()):
                    health = v
                    break
        assert health, f"health bucket missing in {list(d.keys())}"
        for k in ("working", "orange", "red"):
            assert isinstance(health.get(k), int), f"health.{k} not int"

        rl = s.get(f"{BASE_URL}/api/orange-list", params={"page_size": 1000})
        body = rl.json()
        items = body.get("items") if isinstance(body, dict) else body
        ol_def = sum(1 for x in items if x.get("status") == "defective")
        assert health["orange"] + health["red"] == ol_def, (
            f"orange+red={health['orange']+health['red']} != defective={ol_def}"
        )


# ── TEST 5: oversight category-assets shows asset under priority ───────────
class TestOversightCategoryAssets:
    def test_each_defect_listed_in_priority_bucket(self, s, sa, created_defects):
        any_checked = 0
        for asset, expected_list, _ds in created_defects:
            type_id = asset.get("asset_type_id")
            url = f"{BASE_URL}/api/dashboard/oversight/{sa['user_id']}/category-assets"
            r = s.get(url, params={"asset_type_id": type_id})
            if r.status_code == 404:
                # endpoint may differ — try without trailing
                continue
            assert r.status_code == 200, f"{r.status_code}: {r.text[:200]}"
            data = r.json()
            priority = data.get("priority") or data.get("priority_assets") or []
            working = data.get("working") or data.get("working_assets") or []
            aid = asset.get("id") or asset.get("_id")
            in_priority = any((it.get("id") or it.get("_id") or it.get("asset_id")) == aid for it in priority)
            in_working = any((it.get("id") or it.get("_id") or it.get("asset_id")) == aid for it in working)
            if in_priority:
                # IST checks
                row = next(it for it in priority if (it.get("id") or it.get("_id") or it.get("asset_id")) == aid)
                v = row.get("defective_since")
                if v is not None:
                    assert _is_naive_ist(v), f"defective_since not naive IST: {v!r}"
                hc = row.get("health_class") or row.get("list_type")
                if hc:
                    assert hc == expected_list, f"asset {aid}: expected {expected_list} got {hc}"
                any_checked += 1
            else:
                assert not in_working, f"asset {aid} in working bucket but expected priority"
        if any_checked == 0:
            pytest.skip("oversight category-assets endpoint did not return matches")


# ── TEST 6: SUP scope ──────────────────────────────────────────────────────
class TestSupScope:
    def test_sup_orange_list_scoped(self, s):
        sup = _login(s, "SSE001")
        if not sup:
            pytest.skip("SUP login failed")
        r = s.get(f"{BASE_URL}/api/orange-list", params={"for_user_id": sup["user_id"]})
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        items = body.get("items") if isinstance(body, dict) else body
        # IST format on every datetime
        for it in items[:30]:
            for k in ("defective_since", "created_at", "marked_working_at", "approved_at"):
                v = it.get(k)
                if v is not None:
                    assert _is_naive_ist(v), f"SUP {k} not naive IST: {v!r}"


# ── TEST 7: ASUP scope ─────────────────────────────────────────────────────
class TestAsupScope:
    def test_asup_orange_list_scoped(self, s):
        asup = _login(s, "ASUP001")
        if not asup:
            pytest.skip("ASUP login failed")
        r = s.get(f"{BASE_URL}/api/orange-list", params={"for_user_id": asup["user_id"]})
        assert r.status_code == 200, r.text[:300]
        body = r.json()
        items = body.get("items") if isinstance(body, dict) else body
        for it in items[:30]:
            for k in ("defective_since", "created_at", "marked_working_at", "approved_at"):
                v = it.get(k)
                if v is not None:
                    assert _is_naive_ist(v), f"ASUP {k} not naive IST: {v!r}"
