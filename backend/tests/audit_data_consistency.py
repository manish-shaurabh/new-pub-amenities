"""
=============================================================================
DATA CONSISTENCY AUDIT — Railway Asset Inspection Management System
=============================================================================
This script:
1. Creates inspection entries marking 6 assets as defective with variable dates
   (1h ago, 10h ago, 25h ago, 50h ago, 4 days ago, 8 days ago → 2 orange, 4 red)
2. Also creates one pending_approval (yellow) asset via mark-working
3. Reads back across:
   - GET /api/orange-list          (the canonical source of truth)
   - GET /api/dashboard/superadmin (global health)
   - GET /api/dashboard/admin      (admin health)
   - GET /api/dashboard/supervisor/{sup_id}  (SUP-scoped)
   - GET /api/dashboard/approving-supervisor/{asup_id} (ASUP-scoped)
   - GET /api/dashboard/reporting-officer/{ro_id}  (RO-scoped)
   - GET /api/dashboard/stats       (legacy stats endpoint)
   - GET /api/dashboard/station-health (station breakdown)
4. Posts remarks on 2 OL items and cross-checks remark list
5. Flags EVERY mismatch with PASS/FAIL/WARN
=============================================================================
"""

import asyncio
import sys
import os
import json
from datetime import datetime, timedelta
from typing import Optional

import httpx

API_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
REPORT_PATH = "/app/test_reports/audit_consistency.json"

ISSUES: list = []   # list of {"severity": "FAIL"|"WARN"|"INFO", "check": str, "detail": str}
PASS_COUNT = 0
FAIL_COUNT = 0
WARN_COUNT = 0


def log_pass(check: str, detail: str = ""):
    global PASS_COUNT
    PASS_COUNT += 1
    print(f"  ✅  PASS  | {check}" + (f" — {detail}" if detail else ""))


def log_fail(check: str, detail: str = ""):
    global FAIL_COUNT
    FAIL_COUNT += 1
    ISSUES.append({"severity": "FAIL", "check": check, "detail": detail})
    print(f"  ❌  FAIL  | {check} — {detail}")


def log_warn(check: str, detail: str = ""):
    global WARN_COUNT
    WARN_COUNT += 1
    ISSUES.append({"severity": "WARN", "check": check, "detail": detail})
    print(f"  ⚠️  WARN  | {check} — {detail}")


def log_info(msg: str):
    print(f"  ℹ️  INFO  | {msg}")


async def main():
    async with httpx.AsyncClient(timeout=30) as client:

        # ── 1. AUTH ─────────────────────────────────────────────────────────
        print("\n══════════════════════════════════════════════")
        print("  PHASE 1 — Auth & Setup")
        print("══════════════════════════════════════════════")

        r = await client.post(f"{API_URL}/api/auth/login",
                              json={"employee_id": "SA001", "password": "admin123"})
        assert r.status_code == 200, f"SA001 login failed: {r.text}"
        sa_token = r.json()["token"]
        sa_headers = {"Authorization": f"Bearer {sa_token}"}

        # Get SA user id
        r = await client.get(f"{API_URL}/api/users", headers=sa_headers)
        users = r.json()
        sa_user = next((u for u in users if u.get("employee_id") == "SA001"), None)
        assert sa_user, "SA001 user not found"
        sa_id = sa_user["_id"]
        log_info(f"Superadmin ID: {sa_id}")

        # Find SUP, ASUP, RO for DHANBAD / Electrical
        # SUP: SSE001 (Electrical, DHANBAD)
        sup_user = next((u for u in users if u.get("employee_id") == "SSE001"), None)
        asup_user = next((u for u in users if u.get("employee_id") == "ASUP001"), None)
        ro_user = next((u for u in users if u.get("employee_id") == "DRO EL"), None)

        if not sup_user:
            log_warn("Setup", "SUP user SSE001 not found — SUP dashboard checks skipped")
        if not asup_user:
            log_warn("Setup", "ASUP user ASUP001 not found — ASUP dashboard checks skipped")
        if not ro_user:
            log_warn("Setup", "RO user 'DRO EL' not found — RO dashboard checks skipped")

        sup_id = sup_user["_id"] if sup_user else None
        asup_id = asup_user["_id"] if asup_user else None
        ro_id = ro_user["_id"] if ro_user else None

        log_info(f"SUP={sup_id} | ASUP={asup_id} | RO={ro_id}")

        # ── 2. Identify working assets to mark defective ─────────────────────
        print("\n══════════════════════════════════════════════")
        print("  PHASE 2 — Picking Working Assets")
        print("══════════════════════════════════════════════")

        r = await client.get(f"{API_URL}/api/assets?page=1&page_size=100", headers=sa_headers)
        all_assets = r.json() if isinstance(r.json(), list) else r.json().get("items", [])

        # Filter: working assets at DHANBAD station (69f6f639450af6fe6fb5816f)
        DHANBAD_STATION = "69f6f639450af6fe6fb5816f"
        working_assets = [
            a for a in all_assets
            if a.get("status") == "working" and a.get("station_id") == DHANBAD_STATION
        ]
        log_info(f"Working assets at DHANBAD: {len(working_assets)}")

        if len(working_assets) < 6:
            log_warn("Asset Pool", f"Only {len(working_assets)} working assets — need ≥6 for full test. Using all available.")

        test_assets = working_assets[:6]
        if not test_assets:
            log_fail("Asset Pool", "No working assets available at DHANBAD — cannot run defect injection tests")
            print("\nAudit aborted — no working assets.")
            return

        # Variable defect dates: 2 orange (< 24h), 4 red (> 24h)
        now = datetime.utcnow()
        defect_offsets_hours = [1, 10, 25, 50, 96, 192]  # 2 orange + 4 red
        expected_classifications = {
            1: "orange", 10: "orange",
            25: "red", 50: "red", 96: "red", 192: "red"
        }

        # ── 3. Create Inspections marking assets defective ───────────────────
        print("\n══════════════════════════════════════════════")
        print("  PHASE 3 — Injecting Defect Inspections (variable dates)")
        print("══════════════════════════════════════════════")

        # Get locations at DHANBAD
        r = await client.get(f"{API_URL}/api/locations?station_id={DHANBAD_STATION}", headers=sa_headers)
        locations = r.json()
        location_id = locations[0]["_id"] if locations else None
        log_info(f"Location for injections: {location_id}")

        created_ol_ids = []        # orange-list IDs created
        injection_map = {}         # asset_id -> {expected_class, offset_h, ol_id}

        for idx, asset in enumerate(test_assets):
            offset_h = defect_offsets_hours[idx]
            defective_dt = now - timedelta(hours=offset_h)
            expected_cls = expected_classifications.get(offset_h, "red")

            asset_id = asset["_id"]
            asset_num = asset.get("asset_number", "?")
            asset_type_id = asset.get("asset_type_id")
            station_id = asset.get("station_id")

            log_info(f"Injecting defect on {asset_num} | {offset_h}h ago → expect {expected_cls}")

            insp_payload = {
                "inspection_type": "individual",
                "station_id": station_id,
                "inspector_id": sup_id or sa_id,
                "inspection_at": defective_dt.isoformat(),
                "items": [
                    {
                        "asset_id": asset_id,
                        "status": "not_ok",
                        "remarks": f"AUDIT DEFECT — {offset_h}h ago",
                        "defective_since": defective_dt.isoformat(),
                    }
                ]
            }

            r_insp = await client.post(f"{API_URL}/api/inspections", json=insp_payload, headers=sa_headers)
            if r_insp.status_code not in (200, 201):
                log_fail(f"Inspection create ({asset_num})", f"HTTP {r_insp.status_code}: {r_insp.text[:200]}")
                continue

            insp_doc = r_insp.json()
            log_pass(f"Inspection create ({asset_num})", f"id={insp_doc.get('_id','?')[:12]}")

            # Find the new OL entry for this asset
            await asyncio.sleep(0.3)
            r_ol = await client.get(f"{API_URL}/api/orange-list?status=defective", headers=sa_headers)
            ol_items = r_ol.json() if isinstance(r_ol.json(), list) else r_ol.json().get("items", [])
            ol_entry = next((o for o in ol_items if o.get("asset_id") == asset_id), None)

            if not ol_entry:
                log_fail(f"OL entry created ({asset_num})", "Orange-list entry not found after defect inspection")
            else:
                ol_id = ol_entry["_id"]
                created_ol_ids.append(ol_id)
                injection_map[asset_id] = {
                    "asset_num": asset_num,
                    "offset_h": offset_h,
                    "expected_cls": expected_cls,
                    "ol_id": ol_id,
                    "ol_defective_since": ol_entry.get("defective_since"),
                }
                log_pass(f"OL entry found ({asset_num})", f"ol_id={ol_id[:12]} | defective_since={ol_entry.get('defective_since','?')[:19]}")

        log_info(f"Injected defects: {len(injection_map)}/{ len(test_assets)} assets have OL entries")

        # ── 4. Read full orange list ─────────────────────────────────────────
        print("\n══════════════════════════════════════════════")
        print("  PHASE 4 — Orange List Cross-Check")
        print("══════════════════════════════════════════════")

        r_ol_all = await client.get(f"{API_URL}/api/orange-list", headers=sa_headers)
        ol_all = r_ol_all.json() if isinstance(r_ol_all.json(), list) else r_ol_all.json().get("items", [])

        ol_defective = [o for o in ol_all if o.get("status") == "defective"]
        ol_yellow = [o for o in ol_all if o.get("status") == "pending_approval"]
        ol_orange = [o for o in ol_all if o.get("list_type") == "orange" and o.get("status") == "defective"]
        ol_red = [o for o in ol_all if o.get("list_type") == "red" and o.get("status") == "defective"]

        log_info(f"Orange list — defective={len(ol_defective)}, pending_approval(yellow)={len(ol_yellow)}, orange={len(ol_orange)}, red={len(ol_red)}")

        # Check each injected asset appears in orange list with correct classification
        for asset_id, info in injection_map.items():
            found = next((o for o in ol_all if o.get("asset_id") == asset_id), None)
            if not found:
                log_fail(f"OL presence ({info['asset_num']})", "Asset not in orange-list response")
                continue

            actual_list_type = found.get("list_type")
            exp = info["expected_cls"]
            if actual_list_type == exp:
                log_pass(f"OL classification ({info['asset_num']})", f"{info['offset_h']}h → list_type={actual_list_type} (expected {exp})")
            else:
                log_fail(f"OL classification ({info['asset_num']})", f"{info['offset_h']}h → list_type={actual_list_type} but expected {exp}")

            # Check hours_defective accuracy
            hd = found.get("hours_defective", 0)
            expected_h = info["offset_h"]
            tolerance = 1.0  # allow 1h drift
            if abs(hd - expected_h) <= tolerance + (expected_h * 0.05):
                log_pass(f"OL hours_defective ({info['asset_num']})", f"reported={hd}h expected≈{expected_h}h")
            else:
                log_fail(f"OL hours_defective ({info['asset_num']})", f"reported={hd}h vs expected≈{expected_h}h (drift={abs(hd-expected_h):.1f}h)")

        # ── 5. Superadmin Dashboard cross-check ──────────────────────────────
        print("\n══════════════════════════════════════════════")
        print("  PHASE 5 — Superadmin Dashboard Cross-Check")
        print("══════════════════════════════════════════════")

        r_sa_dash = await client.get(f"{API_URL}/api/dashboard/superadmin", headers=sa_headers)
        if r_sa_dash.status_code != 200:
            log_fail("Superadmin dashboard", f"HTTP {r_sa_dash.status_code}")
        else:
            sa_dash = r_sa_dash.json()
            sa_health = sa_dash.get("health", {})
            log_info(f"Superadmin dashboard health: {sa_health}")

            # Dashboard orange+red+yellow vs orange-list counts
            dash_defective = sa_health.get("orange", 0) + sa_health.get("red", 0)
            dash_yellow = sa_health.get("yellow", 0)
            ol_defective_count = len(ol_defective)
            ol_yellow_count = len(ol_yellow)

            if dash_defective == ol_defective_count:
                log_pass("SA dash orange+red == OL defective count", f"{dash_defective} == {ol_defective_count}")
            else:
                log_fail("SA dash orange+red vs OL defective count",
                         f"dashboard={dash_defective} (o={sa_health.get('orange',0)} r={sa_health.get('red',0)}) vs ol_defective={ol_defective_count}")

            if dash_yellow == ol_yellow_count:
                log_pass("SA dash yellow == OL pending_approval count", f"{dash_yellow} == {ol_yellow_count}")
            else:
                log_fail("SA dash yellow vs OL pending_approval count",
                         f"dashboard={dash_yellow} vs ol_pending={ol_yellow_count}")

            # Orange vs Red distribution
            sa_orange = sa_health.get("orange", 0)
            sa_red = sa_health.get("red", 0)
            if sa_orange == len(ol_orange) and sa_red == len(ol_red):
                log_pass("SA dash orange/red breakdown matches OL", f"orange={sa_orange} red={sa_red}")
            else:
                log_fail("SA dash orange/red breakdown vs OL",
                         f"dash: o={sa_orange}, r={sa_red} | ol: o={len(ol_orange)}, r={len(ol_red)}")

            # Check total assets match
            sa_total = sa_dash.get("totals", {}).get("assets", 0)
            r_assets_total = await client.get(f"{API_URL}/api/assets?page=1&page_size=1", headers=sa_headers)
            assets_total_resp = r_assets_total.json()
            actual_total = assets_total_resp.get("total") if isinstance(assets_total_resp, dict) else len(all_assets)
            if sa_total == actual_total:
                log_pass("SA dash total assets == assets collection", f"{sa_total}")
            else:
                log_fail("SA dash total assets mismatch", f"dashboard={sa_total} vs assets_endpoint={actual_total}")

            # Check department health adds up
            dept_sum = sum(d.get("orange", 0) + d.get("red", 0) + d.get("yellow", 0) + d.get("working", 0) for d in sa_dash.get("departments", []))
            if dept_sum == sa_total:
                log_pass("SA dept health sums to total assets", f"{dept_sum}")
            else:
                log_warn("SA dept health sum != total assets",
                         f"dept_sum={dept_sum} vs total={sa_total} (assets with unknown dept may be cause)")

        # ── 6. Admin Dashboard cross-check ───────────────────────────────────
        print("\n══════════════════════════════════════════════")
        print("  PHASE 6 — Admin Dashboard Cross-Check")
        print("══════════════════════════════════════════════")

        r_admin_dash = await client.get(f"{API_URL}/api/dashboard/admin", headers=sa_headers)
        if r_admin_dash.status_code != 200:
            log_fail("Admin dashboard", f"HTTP {r_admin_dash.status_code}")
        else:
            admin_dash = r_admin_dash.json()
            admin_health = admin_dash.get("health", {})
            log_info(f"Admin dashboard health: {admin_health}")

            if admin_health == sa_health:
                log_pass("Admin dashboard health == Superadmin health (no filters)", f"{admin_health}")
            else:
                log_fail("Admin dashboard health vs Superadmin health (should match unfiltered)",
                         f"admin={admin_health} vs sa={sa_health}")

        # ── 7. Stats endpoint cross-check ─────────────────────────────────────
        print("\n══════════════════════════════════════════════")
        print("  PHASE 7 — Legacy Stats Endpoint Cross-Check")
        print("══════════════════════════════════════════════")

        r_stats = await client.get(f"{API_URL}/api/dashboard/stats", headers=sa_headers)
        if r_stats.status_code != 200:
            log_fail("Dashboard stats", f"HTTP {r_stats.status_code}")
        else:
            stats = r_stats.json()
            log_info(f"Stats: {stats}")
            stats_orange = stats.get("orange_list_count", 0)
            stats_red = stats.get("red_list_count", 0)
            stats_pending = stats.get("pending_approvals", 0)
            stats_defective = stats.get("defective_assets", 0)

            # Stats orange+red should equal OL defective
            if stats_orange + stats_red == ol_defective_count:
                log_pass("Stats orange+red == OL defective", f"stats={stats_orange+stats_red} ol={ol_defective_count}")
            else:
                log_fail("Stats orange+red vs OL defective mismatch",
                         f"stats_orange={stats_orange} stats_red={stats_red} sum={stats_orange+stats_red} vs ol_defective={ol_defective_count}")

            if stats_pending == ol_yellow_count:
                log_pass("Stats pending_approvals == OL pending_approval count", f"{stats_pending}")
            else:
                log_fail("Stats pending_approvals vs OL yellow mismatch",
                         f"stats_pending={stats_pending} vs ol_yellow={ol_yellow_count}")

            # stats_defective should equal orange+red+yellow (all non-working)
            expected_defective = ol_defective_count + ol_yellow_count
            if stats_defective == expected_defective:
                log_pass("Stats defective_assets == ol_defective+pending", f"{stats_defective}")
            else:
                log_fail("Stats defective_assets vs ol_defective+pending mismatch",
                         f"stats_defective={stats_defective} vs expected={expected_defective}")

        # ── 8. Station Health endpoint cross-check ────────────────────────────
        print("\n══════════════════════════════════════════════")
        print("  PHASE 8 — Station Health Endpoint Cross-Check")
        print("══════════════════════════════════════════════")

        r_sh = await client.get(f"{API_URL}/api/dashboard/station-health", headers=sa_headers)
        if r_sh.status_code != 200:
            log_fail("Station health", f"HTTP {r_sh.status_code}")
        else:
            sh = r_sh.json()
            dhn = next((s for s in sh if s["station_id"] == DHANBAD_STATION), None)
            if not dhn:
                log_warn("Station health DHANBAD", "DHANBAD not in station-health response")
            else:
                log_info(f"DHANBAD station health: total={dhn['total']} working={dhn['working']} defective={dhn['defective']}")

                # Cross-check: DHANBAD total from station-health vs assets endpoint
                r_dhn_assets = await client.get(
                    f"{API_URL}/api/assets?page=1&page_size=200", headers=sa_headers
                )
                dhn_assets_resp = r_dhn_assets.json()
                dhn_assets_list = dhn_assets_resp if isinstance(dhn_assets_resp, list) else dhn_assets_resp.get("items", [])
                dhn_assets = [a for a in dhn_assets_list if a.get("station_id") == DHANBAD_STATION]
                dhn_working = [a for a in dhn_assets if a.get("status") == "working"]
                dhn_defective = [a for a in dhn_assets if a.get("status") != "working"]

                if dhn["total"] == len(dhn_assets):
                    log_pass("Station health DHANBAD total matches assets", f"{dhn['total']}")
                else:
                    log_fail("Station health DHANBAD total mismatch",
                             f"station_health={dhn['total']} vs assets_filter={len(dhn_assets)}")

                if dhn["working"] == len(dhn_working):
                    log_pass("Station health DHANBAD working matches assets", f"{dhn['working']}")
                else:
                    log_fail("Station health DHANBAD working mismatch",
                             f"station_health={dhn['working']} vs assets_filter={len(dhn_working)}")

        # ── 9. SUP Dashboard cross-check ─────────────────────────────────────
        print("\n══════════════════════════════════════════════")
        print("  PHASE 9 — Supervisor Dashboard Cross-Check")
        print("══════════════════════════════════════════════")

        if sup_id:
            r_sup_dash = await client.get(
                f"{API_URL}/api/dashboard/supervisor/{sup_id}", headers=sa_headers
            )
            if r_sup_dash.status_code != 200:
                log_fail("SUP dashboard", f"HTTP {r_sup_dash.status_code}")
            else:
                sup_dash = r_sup_dash.json()
                sup_health = sup_dash.get("health", {})
                log_info(f"SUP dashboard health: {sup_health} | total_assets={sup_dash.get('total_assets')}")

                # SUP health sums must equal their total_assets
                sup_total = sup_dash.get("total_assets", 0)
                sup_sum = sum(sup_health.values())
                if sup_sum == sup_total:
                    log_pass("SUP dash health sums to total_assets", f"{sup_sum}/{sup_total}")
                else:
                    log_fail("SUP dash health sum != total_assets",
                             f"sum={sup_sum} vs total={sup_total}")

                # All defective assets shown in SUP dash must appear in orange list (scoped)
                r_ol_sup = await client.get(
                    f"{API_URL}/api/orange-list?for_user_id={sup_id}", headers=sa_headers
                )
                ol_sup = r_ol_sup.json() if isinstance(r_ol_sup.json(), list) else r_ol_sup.json().get("items", [])
                ol_sup_defective = [o for o in ol_sup if o.get("status") == "defective"]
                ol_sup_yellow = [o for o in ol_sup if o.get("status") == "pending_approval"]

                sup_dash_defective = sup_health.get("orange", 0) + sup_health.get("red", 0)
                sup_dash_yellow = sup_health.get("yellow", 0)

                if sup_dash_defective == len(ol_sup_defective):
                    log_pass("SUP dash orange+red == SUP-scoped OL defective", f"{sup_dash_defective}")
                else:
                    log_fail("SUP dash orange+red vs OL scoped defective mismatch",
                             f"dash={sup_dash_defective} vs ol_scoped={len(ol_sup_defective)}")

                if sup_dash_yellow == len(ol_sup_yellow):
                    log_pass("SUP dash yellow == SUP-scoped OL pending_approval", f"{sup_dash_yellow}")
                else:
                    log_fail("SUP dash yellow vs OL scoped yellow mismatch",
                             f"dash={sup_dash_yellow} vs ol_yellow={len(ol_sup_yellow)}")

        # ── 10. ASUP Dashboard cross-check ────────────────────────────────────
        print("\n══════════════════════════════════════════════")
        print("  PHASE 10 — Approving Supervisor Dashboard Cross-Check")
        print("══════════════════════════════════════════════")

        if asup_id:
            r_asup_dash = await client.get(
                f"{API_URL}/api/dashboard/approving-supervisor/{asup_id}", headers=sa_headers
            )
            if r_asup_dash.status_code != 200:
                log_fail("ASUP dashboard", f"HTTP {r_asup_dash.status_code}")
            else:
                asup_dash = r_asup_dash.json()
                asup_health = asup_dash.get("health", {})
                log_info(f"ASUP dashboard health: {asup_health} | total={asup_dash.get('total_assets')}")

                asup_total = asup_dash.get("total_assets", 0)
                asup_sum = sum(asup_health.values())
                if asup_sum == asup_total:
                    log_pass("ASUP dash health sums to total_assets", f"{asup_sum}/{asup_total}")
                else:
                    log_fail("ASUP dash health sum != total_assets",
                             f"sum={asup_sum} vs total={asup_total}")

                r_ol_asup = await client.get(
                    f"{API_URL}/api/orange-list?for_user_id={asup_id}", headers=sa_headers
                )
                ol_asup = r_ol_asup.json() if isinstance(r_ol_asup.json(), list) else r_ol_asup.json().get("items", [])
                ol_asup_defective = [o for o in ol_asup if o.get("status") == "defective"]
                ol_asup_yellow = [o for o in ol_asup if o.get("status") == "pending_approval"]

                asup_dash_defective = asup_health.get("orange", 0) + asup_health.get("red", 0)
                asup_dash_yellow = asup_health.get("yellow", 0)

                if asup_dash_defective == len(ol_asup_defective):
                    log_pass("ASUP dash orange+red == ASUP-scoped OL defective", f"{asup_dash_defective}")
                else:
                    log_fail("ASUP dash orange+red vs OL scoped defective mismatch",
                             f"dash={asup_dash_defective} vs ol_scoped={len(ol_asup_defective)}")

                if asup_dash_yellow == len(ol_asup_yellow):
                    log_pass("ASUP dash yellow == ASUP-scoped OL yellow", f"{asup_dash_yellow}")
                else:
                    log_fail("ASUP dash yellow vs OL scoped yellow mismatch",
                             f"dash={asup_dash_yellow} vs ol_yellow={len(ol_asup_yellow)}")

        # ── 11. RO Dashboard cross-check ──────────────────────────────────────
        print("\n══════════════════════════════════════════════")
        print("  PHASE 11 — Reporting Officer Dashboard Cross-Check")
        print("══════════════════════════════════════════════")

        if ro_id:
            r_ro_dash = await client.get(
                f"{API_URL}/api/dashboard/reporting-officer/{ro_id}", headers=sa_headers
            )
            if r_ro_dash.status_code != 200:
                log_fail("RO dashboard", f"HTTP {r_ro_dash.status_code}")
            else:
                ro_dash = r_ro_dash.json()
                ro_health = ro_dash.get("health", {})
                log_info(f"RO dashboard health: {ro_health} | total={ro_dash.get('total_assets')}")

                ro_total = ro_dash.get("total_assets", 0)
                ro_sum = sum(ro_health.values())
                if ro_sum == ro_total:
                    log_pass("RO dash health sums to total_assets", f"{ro_sum}/{ro_total}")
                else:
                    log_fail("RO dash health sum != total_assets",
                             f"sum={ro_sum} vs total={ro_total}")

                r_ol_ro = await client.get(
                    f"{API_URL}/api/orange-list?for_user_id={ro_id}", headers=sa_headers
                )
                ol_ro = r_ol_ro.json() if isinstance(r_ol_ro.json(), list) else r_ol_ro.json().get("items", [])
                ol_ro_defective = [o for o in ol_ro if o.get("status") == "defective"]
                ol_ro_yellow = [o for o in ol_ro if o.get("status") == "pending_approval"]

                ro_dash_defective = ro_health.get("orange", 0) + ro_health.get("red", 0)
                ro_dash_yellow = ro_health.get("yellow", 0)

                if ro_dash_defective == len(ol_ro_defective):
                    log_pass("RO dash orange+red == RO-scoped OL defective", f"{ro_dash_defective}")
                else:
                    log_fail("RO dash orange+red vs OL scoped defective mismatch",
                             f"dash={ro_dash_defective} vs ol_scoped={len(ol_ro_defective)}")

                if ro_dash_yellow == len(ol_ro_yellow):
                    log_pass("RO dash yellow == RO-scoped OL yellow", f"{ro_dash_yellow}")
                else:
                    log_fail("RO dash yellow vs OL scoped yellow mismatch",
                             f"dash={ro_dash_yellow} vs ol_yellow={len(ol_ro_yellow)}")

        # ── 12. Yellow (pending_approval) lifecycle ───────────────────────────
        print("\n══════════════════════════════════════════════")
        print("  PHASE 12 — Yellow Lifecycle (mark-working → pending_approval)")
        print("══════════════════════════════════════════════")

        if created_ol_ids:
            first_ol_id = created_ol_ids[0]
            mark_payload = {
                "marked_by": sup_id or sa_id,
                "remarks": "AUDIT: Marking working for yellow lifecycle test",
                "marked_working_at": (now - timedelta(hours=0.5)).isoformat()
            }
            r_mw = await client.post(
                f"{API_URL}/api/orange-list/{first_ol_id}/mark-working",
                json=mark_payload,
                headers=sa_headers
            )
            if r_mw.status_code != 200:
                log_fail("Mark-working (yellow lifecycle)", f"HTTP {r_mw.status_code}: {r_mw.text[:200]}")
            else:
                log_pass("Mark-working OK", f"OL item {first_ol_id[:12]} → pending_approval")
                await asyncio.sleep(0.5)

                # Re-fetch orange list and check yellow count increased
                r_ol_after = await client.get(f"{API_URL}/api/orange-list", headers=sa_headers)
                ol_after = r_ol_after.json() if isinstance(r_ol_after.json(), list) else r_ol_after.json().get("items", [])
                ol_yellow_after = [o for o in ol_after if o.get("status") == "pending_approval"]
                log_info(f"Yellow count after mark-working: {len(ol_yellow_after)} (was {ol_yellow_count})")

                if len(ol_yellow_after) == ol_yellow_count + 1:
                    log_pass("Yellow count +1 after mark-working", f"{ol_yellow_count} → {len(ol_yellow_after)}")
                else:
                    log_fail("Yellow count not incremented",
                             f"expected {ol_yellow_count+1}, got {len(ol_yellow_after)}")

                # Re-fetch SA dashboard and verify yellow +1
                r_sa2 = await client.get(f"{API_URL}/api/dashboard/superadmin", headers=sa_headers)
                sa2 = r_sa2.json()
                sa2_yellow = sa2.get("health", {}).get("yellow", 0)
                if sa2_yellow == len(ol_yellow_after):
                    log_pass("SA dash yellow updated after mark-working", f"{sa2_yellow}")
                else:
                    log_fail("SA dash yellow not updated after mark-working",
                             f"dash={sa2_yellow} vs ol_yellow={len(ol_yellow_after)}")

                # Asset status should now be pending_approval
                # Find asset_id from first OL entry
                target_asset_id = next(
                    (aid for aid, info in injection_map.items() if info.get("ol_id") == first_ol_id), None
                )
                if target_asset_id:
                    r_asset = await client.get(f"{API_URL}/api/assets/{target_asset_id}", headers=sa_headers)
                    if r_asset.status_code == 200:
                        asset_status = r_asset.json().get("status")
                        if asset_status == "pending_approval":
                            log_pass("Asset status = pending_approval after mark-working", target_asset_id[:12])
                        else:
                            log_fail("Asset status mismatch after mark-working",
                                     f"expected pending_approval got {asset_status}")
                    else:
                        log_warn("Asset fetch after mark-working", f"HTTP {r_asset.status_code}")

        # ── 13. Remarks cross-check ───────────────────────────────────────────
        print("\n══════════════════════════════════════════════")
        print("  PHASE 13 — Remarks Consistency Check")
        print("══════════════════════════════════════════════")

        test_ol_ids = created_ol_ids[1:3] if len(created_ol_ids) >= 3 else created_ol_ids[-1:]

        for ol_id in test_ol_ids:
            # Post 2 manual remarks — body has {type, text}, current_user_id is a query param
            remark_payloads = [
                {"type": "note",      "text": f"AUDIT NOTE on {ol_id[:8]}"},
                {"type": "escalation","text": f"AUDIT ESCALATION on {ol_id[:8]}"}
            ]
            posted_count = 0
            for rp in remark_payloads:
                poster_id = sup_id or sa_id
                r_rp = await client.post(
                    f"{API_URL}/api/orange-list/{ol_id}/remarks?current_user_id={poster_id}",
                    json=rp, headers=sa_headers
                )
                if r_rp.status_code in (200, 201):
                    posted_count += 1
                    log_pass(f"Remark posted (type={rp['type']})", f"ol_id={ol_id[:12]}")
                else:
                    log_fail(f"Remark post failed (type={rp['type']})", f"HTTP {r_rp.status_code}: {r_rp.text[:200]}")

            # Read back remarks thread — response shape: {"items": [...], "read_only": bool, ...}
            r_remarks = await client.get(
                f"{API_URL}/api/orange-list/{ol_id}/remarks", headers=sa_headers
            )
            if r_remarks.status_code != 200:
                log_fail(f"Remarks GET ({ol_id[:12]})", f"HTTP {r_remarks.status_code}")
                continue

            remarks_data = r_remarks.json()
            remarks_list = remarks_data.get("items", []) if isinstance(remarks_data, dict) else remarks_data
            manual_remarks = [rm for rm in remarks_list if isinstance(rm, dict) and not rm.get("is_auto", False)]

            if len(manual_remarks) >= posted_count:
                log_pass(f"Remarks count ({ol_id[:12]})", f"posted={posted_count} found={len(manual_remarks)}")
            else:
                log_fail(f"Remarks count mismatch ({ol_id[:12]})",
                         f"posted={posted_count} but found only {len(manual_remarks)} manual remarks")

            # Verify immutability — try editing remark (should fail or not be supported)
            if remarks_list:
                first_remark = next((rm for rm in remarks_list if isinstance(rm, dict)), None)
                first_remark_id = first_remark.get("_id") if first_remark else None
                if first_remark_id:
                    r_edit = await client.put(
                        f"{API_URL}/api/remarks/{first_remark_id}",
                        json={"text": "EDITED AFTER POST"},
                        headers=sa_headers
                    )
                    if r_edit.status_code in (404, 405, 403, 422):
                        log_pass("Remark immutability (no edit endpoint)", f"HTTP {r_edit.status_code}")
                    elif r_edit.status_code == 200:
                        log_fail("Remark immutability violated", "Edit succeeded but remarks should be immutable")
                    else:
                        log_warn("Remark immutability check", f"Unexpected HTTP {r_edit.status_code}")

            # Check auto-remark from inspection was created
            auto_remarks = [rm for rm in remarks_list if isinstance(rm, dict) and rm.get("is_auto", False)]
            if auto_remarks:
                log_pass(f"Auto-remark created ({ol_id[:12]})", f"count={len(auto_remarks)}")
            else:
                log_warn(f"No auto-remark found ({ol_id[:12]})", "Expected auto-remark from inspection event")

        # ── 14. Remark 300-char limit check ───────────────────────────────────
        print("\n══════════════════════════════════════════════")
        print("  PHASE 14 — Remark 300-char Limit Enforcement")
        print("══════════════════════════════════════════════")

        if created_ol_ids:
            test_ol = created_ol_ids[-1]
            long_text = "X" * 301
            r_long = await client.post(
                f"{API_URL}/api/orange-list/{test_ol}/remarks?current_user_id={sa_id}",
                json={"type": "note", "text": long_text},
                headers=sa_headers
            )
            if r_long.status_code == 422:
                log_pass("300-char limit enforced (422 on 301 chars)", "")
            elif r_long.status_code in (400, 413):
                log_pass("300-char limit enforced (400/413 on 301 chars)", "")
            else:
                log_fail("300-char limit NOT enforced", f"HTTP {r_long.status_code} on 301-char remark")

        # ── 15. Orange list filter consistency ────────────────────────────────
        print("\n══════════════════════════════════════════════")
        print("  PHASE 15 — Orange List Filter Consistency")
        print("══════════════════════════════════════════════")

        # Re-fetch fresh OL data (state may have changed since Phase 4 due to mark-working in Phase 12)
        r_ol_fresh = await client.get(f"{API_URL}/api/orange-list", headers=sa_headers)
        ol_fresh = r_ol_fresh.json() if isinstance(r_ol_fresh.json(), list) else r_ol_fresh.json().get("items", [])
        fresh_orange = [o for o in ol_fresh if o.get("list_type") == "orange" and o.get("status") == "defective"]
        fresh_red = [o for o in ol_fresh if o.get("list_type") == "red" and o.get("status") == "defective"]
        fresh_yellow = [o for o in ol_fresh if o.get("status") == "pending_approval"]
        log_info(f"Fresh OL state: defective_orange={len(fresh_orange)} defective_red={len(fresh_red)} yellow={len(fresh_yellow)}")

        # list_type=orange filter
        r_filter_o = await client.get(f"{API_URL}/api/orange-list?list_type=orange", headers=sa_headers)
        filtered_orange = r_filter_o.json() if isinstance(r_filter_o.json(), list) else r_filter_o.json().get("items", [])
        if len(filtered_orange) == len(fresh_orange):
            log_pass("OL filter list_type=orange matches fresh orange count", f"{len(filtered_orange)}")
        else:
            log_fail("OL filter list_type=orange count mismatch",
                     f"filtered={len(filtered_orange)} vs expected={len(fresh_orange)}")

        # list_type=red filter
        r_filter_r = await client.get(f"{API_URL}/api/orange-list?list_type=red", headers=sa_headers)
        filtered_red = r_filter_r.json() if isinstance(r_filter_r.json(), list) else r_filter_r.json().get("items", [])
        if len(filtered_red) == len(fresh_red):
            log_pass("OL filter list_type=red matches fresh red count", f"{len(filtered_red)}")
        else:
            log_fail("OL filter list_type=red count mismatch",
                     f"filtered={len(filtered_red)} vs expected={len(fresh_red)}")

        # status=pending_approval filter
        r_filter_y = await client.get(f"{API_URL}/api/orange-list?status=pending_approval", headers=sa_headers)
        filtered_yellow = r_filter_y.json() if isinstance(r_filter_y.json(), list) else r_filter_y.json().get("items", [])
        if len(filtered_yellow) == len(fresh_yellow):
            log_pass("OL filter status=pending_approval count OK", f"{len(filtered_yellow)}")
        else:
            log_fail("OL filter status=pending_approval count mismatch",
                     f"filter={len(filtered_yellow)} vs fresh={len(fresh_yellow)}")

        # ── 16. Dashboard category-assets drill-down consistency ──────────────
        print("\n══════════════════════════════════════════════")
        print("  PHASE 16 — Dashboard Drill-down Asset List vs OL")
        print("══════════════════════════════════════════════")

        if sup_id:
            # Pick a category from SUP dashboard and drill down
            r_sup_cat = await client.get(
                f"{API_URL}/api/dashboard/supervisor/{sup_id}", headers=sa_headers
            )
            if r_sup_cat.status_code == 200:
                sup_cats = r_sup_cat.json().get("categories", [])
                for cat in sup_cats[:2]:
                    type_id = cat.get("asset_type_id")
                    if not type_id:
                        continue
                    r_drill = await client.get(
                        f"{API_URL}/api/dashboard/oversight/{sup_id}/category-assets?asset_type_id={type_id}",
                        headers=sa_headers
                    )
                    if r_drill.status_code == 200:
                        drill = r_drill.json()
                        priority_count = drill.get("totals", {}).get("priority", 0)
                        working_count = drill.get("totals", {}).get("working", 0)
                        drill_total = priority_count + working_count

                        cat_total = cat.get("asset_count", 0)
                        if drill_total == cat_total:
                            log_pass(f"Drill-down total ({cat.get('asset_type_name','?')})",
                                     f"drill={drill_total} == cat_total={cat_total}")
                        else:
                            log_fail(f"Drill-down total mismatch ({cat.get('asset_type_name','?')})",
                                     f"drill={drill_total} vs cat_total={cat_total}")

                        # Confirm priority count = non-working count from category
                        cat_defective = cat.get("orange", 0) + cat.get("red", 0) + cat.get("yellow", 0)
                        if priority_count == cat_defective:
                            log_pass(f"Drill-down priority == cat defective ({cat.get('asset_type_name','?')})",
                                     f"{priority_count}")
                        else:
                            log_fail(f"Drill-down priority != cat defective ({cat.get('asset_type_name','?')})",
                                     f"drill_priority={priority_count} vs cat_defective={cat_defective}")
                    else:
                        log_warn(f"Drill-down HTTP error ({type_id[:8]})", f"HTTP {r_drill.status_code}")

        # ── 17. Cross-Role Orange List Scoping Integrity ──────────────────────
        print("\n══════════════════════════════════════════════")
        print("  PHASE 17 — Cross-Role OL Scoping (SUP ⊆ ASUP ⊆ SA)")
        print("══════════════════════════════════════════════")

        if sup_id and asup_id:
            r_ol_sup2 = await client.get(f"{API_URL}/api/orange-list?for_user_id={sup_id}", headers=sa_headers)
            r_ol_asup2 = await client.get(f"{API_URL}/api/orange-list?for_user_id={asup_id}", headers=sa_headers)
            r_ol_sa2 = await client.get(f"{API_URL}/api/orange-list", headers=sa_headers)

            ol_sup_ids = set(o.get("_id") for o in (r_ol_sup2.json() if isinstance(r_ol_sup2.json(), list) else r_ol_sup2.json().get("items", [])))
            ol_asup_ids = set(o.get("_id") for o in (r_ol_asup2.json() if isinstance(r_ol_asup2.json(), list) else r_ol_asup2.json().get("items", [])))
            ol_sa_ids = set(o.get("_id") for o in (r_ol_sa2.json() if isinstance(r_ol_sa2.json(), list) else r_ol_sa2.json().get("items", [])))

            # SUP subset of ASUP
            sup_not_in_asup = ol_sup_ids - ol_asup_ids
            if not sup_not_in_asup:
                log_pass("SUP OL ⊆ ASUP OL (scope containment)", f"SUP={len(ol_sup_ids)} ASUP={len(ol_asup_ids)}")
            else:
                log_fail("SUP OL ⊄ ASUP OL — scope leak",
                         f"{len(sup_not_in_asup)} OL items visible to SUP but NOT to ASUP (should not happen)")

            # ASUP subset of SA
            asup_not_in_sa = ol_asup_ids - ol_sa_ids
            if not asup_not_in_sa:
                log_pass("ASUP OL ⊆ SA OL (scope containment)", f"ASUP={len(ol_asup_ids)} SA={len(ol_sa_ids)}")
            else:
                log_fail("ASUP OL ⊄ SA OL — scope leak",
                         f"{len(asup_not_in_sa)} OL items visible to ASUP but NOT to SA")

            log_info(f"OL scoping: SUP={len(ol_sup_ids)} ASUP={len(ol_asup_ids)} SA={len(ol_sa_ids)}")

        # ── FINAL REPORT ──────────────────────────────────────────────────────
        print("\n══════════════════════════════════════════════")
        print("  FINAL AUDIT REPORT")
        print("══════════════════════════════════════════════")

        total = PASS_COUNT + FAIL_COUNT + WARN_COUNT
        print(f"\n  Total checks   : {total}")
        print(f"  ✅ PASS        : {PASS_COUNT}")
        print(f"  ❌ FAIL        : {FAIL_COUNT}")
        print(f"  ⚠️  WARN        : {WARN_COUNT}")

        if ISSUES:
            print("\n  ── ISSUES FOUND ──────────────────────────────")
            for i in ISSUES:
                icon = "❌" if i["severity"] == "FAIL" else "⚠️"
                print(f"  {icon} [{i['severity']}] {i['check']}")
                if i["detail"]:
                    print(f"       {i['detail']}")

        report = {
            "run_at": datetime.utcnow().isoformat(),
            "summary": {
                "total": total,
                "pass": PASS_COUNT,
                "fail": FAIL_COUNT,
                "warn": WARN_COUNT,
            },
            "issues": ISSUES,
            "injected_assets": [
                {"asset_id": aid, **info}
                for aid, info in injection_map.items()
            ],
        }

        os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
        with open(REPORT_PATH, "w") as f:
            json.dump(report, f, indent=2, default=str)
        print(f"\n  Report saved to: {REPORT_PATH}")


if __name__ == "__main__":
    asyncio.run(main())
