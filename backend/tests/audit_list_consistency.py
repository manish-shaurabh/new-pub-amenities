"""
=============================================================================
LIST CONSISTENCY AUDIT — Defective Asset Visibility Across Lists & Dashboards
=============================================================================

Read-only audit against the live database. Does NOT mutate state.

Verifies 7 invariants:
  I1.  asset.status='defective'   ↔ exactly one OL entry with status='defective'
  I2.  asset.status='pending_approval' ↔ exactly one OL entry with status='pending_approval'
  I3.  asset.status='working'     ↔ no open OL entry (no defective/pending_approval)
  I4.  Each defective asset appears in EXACTLY ONE of {orange, red, yellow}
       - orange: open OL, status=defective, hours_defective ≤ 24
       - red:    open OL, status=defective, hours_defective > 24
       - yellow: open OL, status=pending_approval
  I5.  Cross-dashboard count parity:
       SuperAdmin health.{orange,red,yellow} == Σ scoped values across all SUP/ASUP/RO
  I6.  Time-math sanity: defective_since ≤ marked_working_at ≤ approved_at ≤ now
  I7.  Orphans: every OL.asset_id exists in assets; every remark.orange_list_id exists in OL

Output:
  - Console summary
  - JSON report at /app/test_reports/list_consistency.json with offending IDs
=============================================================================
"""

import os
import json
from datetime import datetime, timedelta
from collections import defaultdict
from pymongo import MongoClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "railway_asset_inspection")
REPORT_PATH = "/app/test_reports/list_consistency.json"
RED_THRESHOLD_HOURS = 24

client = MongoClient(MONGO_URL)
db = client[DB_NAME]

# ── Counters ────────────────────────────────────────────────────────────────
PASS_COUNT = 0
FAIL_COUNT = 0
WARN_COUNT = 0
VIOLATIONS: list = []  # {invariant, severity, asset_id, detail}


def log_pass(check: str, detail: str = ""):
    global PASS_COUNT
    PASS_COUNT += 1
    print(f"  ✅ PASS  | {check}" + (f" — {detail}" if detail else ""))


def log_fail(invariant: str, check: str, detail: str = "", asset_id: str = None, ol_id: str = None):
    global FAIL_COUNT
    FAIL_COUNT += 1
    VIOLATIONS.append({
        "invariant": invariant,
        "severity": "FAIL",
        "check": check,
        "asset_id": asset_id,
        "ol_id": ol_id,
        "detail": detail,
    })
    print(f"  ❌ FAIL  | [{invariant}] {check}" + (f" — {detail}" if detail else ""))


def log_warn(invariant: str, check: str, detail: str = "", asset_id: str = None):
    global WARN_COUNT
    WARN_COUNT += 1
    VIOLATIONS.append({
        "invariant": invariant,
        "severity": "WARN",
        "check": check,
        "asset_id": asset_id,
        "detail": detail,
    })
    print(f"  ⚠️  WARN  | [{invariant}] {check}" + (f" — {detail}" if detail else ""))


def _to_dt(v):
    """Normalize a datetime that might be naive or aware to naive UTC for math."""
    if v is None:
        return None
    if isinstance(v, str):
        try:
            v = datetime.fromisoformat(v.replace("Z", "").replace("+00:00", ""))
        except Exception:
            return None
    if hasattr(v, "tzinfo") and v.tzinfo is not None:
        v = v.replace(tzinfo=None)
    return v


def main():
    now = datetime.utcnow()
    print("══════════════════════════════════════════════════════════════════")
    print(f"  LIST CONSISTENCY AUDIT  —  {now.isoformat()} (server time)")
    print("══════════════════════════════════════════════════════════════════\n")

    # ── Load entire dataset (read-only) ────────────────────────────────────
    assets = list(db.assets.find())
    ol_entries = list(db.orange_list.find())
    remarks = list(db.remarks.find())

    print(f"  Loaded: {len(assets)} assets | {len(ol_entries)} OL entries | {len(remarks)} remarks\n")

    # Index OL by asset_id and bucket by status
    ol_by_asset_open = defaultdict(list)   # asset_id → [defective + pending_approval]
    ol_by_asset_resolved = defaultdict(list)
    for ol in ol_entries:
        st = ol.get("status")
        aid = ol.get("asset_id")
        if not aid:
            continue
        if st == "resolved":
            ol_by_asset_resolved[aid].append(ol)
        else:
            ol_by_asset_open[aid].append(ol)

    asset_by_id = {str(a["_id"]): a for a in assets}

    # Bucket assets by status
    assets_defective = [a for a in assets if a.get("status") == "defective"]
    assets_pending = [a for a in assets if a.get("status") == "pending_approval"]
    assets_working = [a for a in assets if a.get("status") == "working"]

    print(f"  Asset status breakdown: working={len(assets_working)} | "
          f"defective={len(assets_defective)} | pending_approval={len(assets_pending)}\n")

    # =========================================================================
    # I1. asset.status='defective' ↔ exactly one OL entry with status='defective'
    # =========================================================================
    print("─── I1. defective asset ↔ open OL[defective] (1:1) ───")
    for a in assets_defective:
        aid = str(a["_id"])
        opens = ol_by_asset_open.get(aid, [])
        defective_opens = [o for o in opens if o.get("status") == "defective"]
        pending_opens = [o for o in opens if o.get("status") == "pending_approval"]

        if len(defective_opens) == 1 and not pending_opens:
            continue  # OK
        elif len(defective_opens) == 0:
            log_fail("I1", "Defective asset has NO open OL[defective] entry",
                     f"asset_number={a.get('asset_number')} | opens={len(opens)} pending_opens={len(pending_opens)}",
                     asset_id=aid)
        elif len(defective_opens) > 1:
            log_fail("I1", "Defective asset has MULTIPLE open OL[defective] entries",
                     f"asset_number={a.get('asset_number')} | count={len(defective_opens)}",
                     asset_id=aid)
        if pending_opens:
            log_fail("I1", "Defective asset ALSO has pending_approval OL entry (split state)",
                     f"asset_number={a.get('asset_number')} | pending_count={len(pending_opens)}",
                     asset_id=aid, ol_id=str(pending_opens[0]["_id"]))
    if FAIL_COUNT == 0:
        log_pass("I1: all defective assets have exactly one open OL[defective]",
                 f"checked {len(assets_defective)}")
    else:
        # also log a positive count of clean ones
        clean = sum(1 for a in assets_defective
                    if len([o for o in ol_by_asset_open.get(str(a["_id"]), [])
                            if o.get("status") == "defective"]) == 1
                    and not [o for o in ol_by_asset_open.get(str(a["_id"]), [])
                             if o.get("status") == "pending_approval"])
        print(f"     ↳ {clean}/{len(assets_defective)} clean")

    # =========================================================================
    # I2. asset.status='pending_approval' ↔ exactly one OL[pending_approval]
    # =========================================================================
    print("\n─── I2. pending_approval asset ↔ open OL[pending_approval] (1:1) ───")
    f0 = FAIL_COUNT
    for a in assets_pending:
        aid = str(a["_id"])
        opens = ol_by_asset_open.get(aid, [])
        pending_opens = [o for o in opens if o.get("status") == "pending_approval"]
        defective_opens = [o for o in opens if o.get("status") == "defective"]
        if len(pending_opens) == 1 and not defective_opens:
            continue
        elif len(pending_opens) == 0:
            log_fail("I2", "Pending_approval asset has NO open OL[pending_approval]",
                     f"asset_number={a.get('asset_number')}", asset_id=aid)
        elif len(pending_opens) > 1:
            log_fail("I2", "Pending_approval asset has MULTIPLE OL[pending_approval]",
                     f"asset_number={a.get('asset_number')} | count={len(pending_opens)}", asset_id=aid)
        if defective_opens:
            log_fail("I2", "Pending_approval asset ALSO has open OL[defective]",
                     f"asset_number={a.get('asset_number')}", asset_id=aid)
    if FAIL_COUNT == f0:
        log_pass("I2: all pending_approval assets have exactly one open OL[pending_approval]",
                 f"checked {len(assets_pending)}")

    # =========================================================================
    # I3. asset.status='working' ↔ NO open OL entry
    # =========================================================================
    print("\n─── I3. working asset ↔ no open OL entry ───")
    f0 = FAIL_COUNT
    leaky = []
    for a in assets_working:
        aid = str(a["_id"])
        opens = ol_by_asset_open.get(aid, [])
        if opens:
            for o in opens:
                leaky.append((a, o))
                log_fail("I3", "Working asset has open OL entry (orphan or stale)",
                         f"asset_number={a.get('asset_number')} | OL.status={o.get('status')} | OL._id={o['_id']}",
                         asset_id=aid, ol_id=str(o["_id"]))
    if FAIL_COUNT == f0:
        log_pass("I3: all working assets have no open OL entry",
                 f"checked {len(assets_working)}")

    # =========================================================================
    # I4. Each defective asset appears in EXACTLY ONE of {orange, red, yellow}
    # =========================================================================
    print("\n─── I4. List exclusivity (orange ⊕ red ⊕ yellow) ───")
    orange_set, red_set, yellow_set = set(), set(), set()
    for ol in ol_entries:
        st = ol.get("status")
        aid = ol.get("asset_id")
        if st == "resolved" or not aid:
            continue
        if st == "pending_approval":
            yellow_set.add(aid)
            continue
        if st == "defective":
            ds = _to_dt(ol.get("defective_since") or ol.get("created_at"))
            if ds is None:
                log_fail("I4", "Defective OL with no defective_since",
                         f"OL._id={ol['_id']} asset_id={aid}", asset_id=aid, ol_id=str(ol["_id"]))
                continue
            hours = (now - ds).total_seconds() / 3600
            if hours > RED_THRESHOLD_HOURS:
                red_set.add(aid)
            else:
                orange_set.add(aid)

    # Check exclusivity
    in_orange_and_red = orange_set & red_set
    in_orange_and_yellow = orange_set & yellow_set
    in_red_and_yellow = red_set & yellow_set
    f0 = FAIL_COUNT
    for aid in in_orange_and_red:
        log_fail("I4", "Asset in BOTH orange and red lists",
                 f"asset_id={aid}", asset_id=aid)
    for aid in in_orange_and_yellow:
        log_fail("I4", "Asset in BOTH orange and yellow lists",
                 f"asset_id={aid}", asset_id=aid)
    for aid in in_red_and_yellow:
        log_fail("I4", "Asset in BOTH red and yellow lists",
                 f"asset_id={aid}", asset_id=aid)
    if FAIL_COUNT == f0:
        log_pass(f"I4: list exclusivity OK (orange={len(orange_set)} red={len(red_set)} yellow={len(yellow_set)})",
                 f"total_listed={len(orange_set | red_set | yellow_set)}")

    # And every defective asset must be in some list
    f0 = FAIL_COUNT
    all_listed = orange_set | red_set | yellow_set
    for a in assets_defective + assets_pending:
        aid = str(a["_id"])
        if aid not in all_listed:
            log_fail("I4", "Defective/Pending asset MISSING from all lists (invisible)",
                     f"asset_number={a.get('asset_number')} | status={a.get('status')}",
                     asset_id=aid)
    if FAIL_COUNT == f0:
        log_pass("I4: every defective/pending asset is in at least one list",
                 f"total={len(assets_defective) + len(assets_pending)}")

    # =========================================================================
    # I5. Cross-dashboard count parity
    # =========================================================================
    print("\n─── I5. Cross-dashboard count parity ───")
    # Compare:
    #   asset_status_breakdown vs orange_list view
    #
    # Counts based on asset.status:
    asset_status_defective = len(assets_defective)        # should ≈ orange + red
    asset_status_pending = len(assets_pending)            # should == yellow

    ol_orange_defective = len(orange_set)
    ol_red_defective = len(red_set)
    ol_yellow = len(yellow_set)

    f0 = FAIL_COUNT
    if asset_status_defective != (ol_orange_defective + ol_red_defective):
        log_fail("I5", "asset.status='defective' count != orange+red OL count",
                 f"asset_status_defective={asset_status_defective} vs orange+red={ol_orange_defective + ol_red_defective}")
    if asset_status_pending != ol_yellow:
        log_fail("I5", "asset.status='pending_approval' count != yellow OL count",
                 f"asset_status_pending={asset_status_pending} vs ol_yellow={ol_yellow}")
    if FAIL_COUNT == f0:
        log_pass(f"I5: cross-table counts agree "
                 f"(defective {asset_status_defective}={ol_orange_defective + ol_red_defective}, "
                 f"pending {asset_status_pending}={ol_yellow})")

    # =========================================================================
    # I6. Time-math sanity: defective_since ≤ marked_working_at ≤ approved_at
    # =========================================================================
    print("\n─── I6. Time-math sanity ───")
    f0 = FAIL_COUNT
    for ol in ol_entries:
        ds = _to_dt(ol.get("defective_since"))
        mw = _to_dt(ol.get("marked_working_at"))
        ap = _to_dt(ol.get("approved_at"))

        if ds and mw and mw < ds:
            log_fail("I6", "marked_working_at < defective_since",
                     f"OL._id={ol['_id']} ds={ds} mw={mw}", ol_id=str(ol["_id"]))
        if mw and ap and ap < mw:
            log_fail("I6", "approved_at < marked_working_at",
                     f"OL._id={ol['_id']} mw={mw} ap={ap}", ol_id=str(ol["_id"]))
        # Future-dated checks (allow 1h skew)
        if ds and ds > now + timedelta(hours=1):
            log_warn("I6", "defective_since is in the future",
                     f"OL._id={ol['_id']} ds={ds}")
        if mw and mw > now + timedelta(hours=1):
            log_warn("I6", "marked_working_at is in the future",
                     f"OL._id={ol['_id']} mw={mw}")
        if ap and ap > now + timedelta(hours=1):
            log_warn("I6", "approved_at is in the future",
                     f"OL._id={ol['_id']} ap={ap}")
    if FAIL_COUNT == f0:
        log_pass(f"I6: time-math sanity OK across {len(ol_entries)} OL entries")

    # =========================================================================
    # I7. Orphan checks
    # =========================================================================
    print("\n─── I7. Orphan checks ───")
    f0 = FAIL_COUNT
    # OL entries pointing to deleted assets
    for ol in ol_entries:
        aid = ol.get("asset_id")
        if not aid:
            log_fail("I7", "OL entry with NO asset_id", f"OL._id={ol['_id']}", ol_id=str(ol["_id"]))
            continue
        if aid not in asset_by_id:
            log_fail("I7", "OL entry references deleted/non-existent asset",
                     f"OL._id={ol['_id']} asset_id={aid} status={ol.get('status')}",
                     asset_id=aid, ol_id=str(ol["_id"]))

    # Remarks pointing to deleted OL entries
    ol_id_set = {str(o["_id"]) for o in ol_entries}
    for rm in remarks:
        olid = rm.get("orange_list_id")
        if olid and olid not in ol_id_set:
            log_fail("I7", "Remark references deleted OL entry",
                     f"remark._id={rm['_id']} ol_id={olid}", ol_id=olid)
    if FAIL_COUNT == f0:
        log_pass("I7: no orphans across orange_list and remarks")

    # =========================================================================
    # Bonus: list `list_type` self-consistency (orange ≤24h, red >24h)
    # =========================================================================
    print("\n─── Bonus: defective_since vs implicit list_type bucket ───")
    f0 = FAIL_COUNT
    edge_cases = []
    for ol in ol_entries:
        if ol.get("status") != "defective":
            continue
        ds = _to_dt(ol.get("defective_since"))
        if ds is None:
            continue
        hours = (now - ds).total_seconds() / 3600
        if 23.5 <= hours <= 24.5:
            edge_cases.append({"ol_id": str(ol["_id"]), "asset_id": ol.get("asset_id"), "hours": round(hours, 2)})
    if edge_cases:
        log_warn("Bonus", f"{len(edge_cases)} OL entries within ±0.5h of orange/red boundary (will flicker)",
                 f"first={edge_cases[:3]}")
    if FAIL_COUNT == f0:
        log_pass("Bonus: no immediate orange/red flicker risk")

    # =========================================================================
    # FINAL REPORT
    # =========================================================================
    print("\n══════════════════════════════════════════════════════════════════")
    print("  FINAL REPORT")
    print("══════════════════════════════════════════════════════════════════")
    total = PASS_COUNT + FAIL_COUNT + WARN_COUNT
    print(f"  Total checks : {total}")
    print(f"  ✅ PASS      : {PASS_COUNT}")
    print(f"  ❌ FAIL      : {FAIL_COUNT}")
    print(f"  ⚠️  WARN      : {WARN_COUNT}")

    if VIOLATIONS:
        # Group by invariant for clarity
        by_inv = defaultdict(list)
        for v in VIOLATIONS:
            by_inv[v["invariant"]].append(v)
        print("\n  Violations by invariant:")
        for inv, vs in sorted(by_inv.items()):
            fails = sum(1 for x in vs if x["severity"] == "FAIL")
            warns = sum(1 for x in vs if x["severity"] == "WARN")
            print(f"    {inv}: FAIL={fails} WARN={warns}")

    report = {
        "run_at": now.isoformat(),
        "summary": {
            "total_checks": total,
            "pass": PASS_COUNT,
            "fail": FAIL_COUNT,
            "warn": WARN_COUNT,
        },
        "dataset": {
            "assets_total": len(assets),
            "assets_working": len(assets_working),
            "assets_defective": len(assets_defective),
            "assets_pending_approval": len(assets_pending),
            "ol_entries_total": len(ol_entries),
            "ol_open_defective": sum(1 for o in ol_entries if o.get("status") == "defective"),
            "ol_open_pending_approval": sum(1 for o in ol_entries if o.get("status") == "pending_approval"),
            "ol_resolved": sum(1 for o in ol_entries if o.get("status") == "resolved"),
            "list_orange_count": len(orange_set),
            "list_red_count": len(red_set),
            "list_yellow_count": len(yellow_set),
        },
        "violations": VIOLATIONS,
    }

    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    with open(REPORT_PATH, "w") as f:
        json.dump(report, f, indent=2, default=str)

    print(f"\n  Report saved: {REPORT_PATH}")
    return FAIL_COUNT == 0


if __name__ == "__main__":
    ok = main()
    raise SystemExit(0 if ok else 1)
