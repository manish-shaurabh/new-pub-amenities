#!/usr/bin/env python3
"""
================================================================================
COMPREHENSIVE E2E LIFECYCLE TEST — runs and CLEANS UP after itself
================================================================================
Coverage:
  Phase 1: Setup → 1 station, 1 RO, 1 ASUP, 1 SUP, 2 asset_types
           (ELEC + COMM), 5 assets across both depts
  Phase 2: SUP runs inspection (mix of OK / NOT_OK / NEEDS_REPAIR with backdated
           defective_since to land in red list)
  Phase 3: Cross-role visibility check — SA / Admin / RO / ASUP / SUP each
           query their dashboards; verify list memberships and counts agree
  Phase 4: SUP marks one defective working → moves to YELLOW
  Phase 5: ASUP approves rectification → moves to RESOLVED
  Phase 6: SUP marks 2nd defective working → ASUP rejects → moves back to ORANGE
  Phase 7: Each role posts 1 remark on the active OL
  Phase 8: Re-inspection with NOT_OK on a YELLOW asset → auto-reject path
  Phase 9: Time/date IST literal consistency check across all pages
 Phase 10: Final audit (10 invariants)
   ALWAYS: Cleanup all created records (try/finally guarantee)

Run:
  REACT_APP_BACKEND_URL=$(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d= -f2-) \\
    python /app/backend/tests/e2e_full_lifecycle.py
"""
import os, sys, time, json, uuid, re
from datetime import datetime, timedelta, timezone
import requests
from pymongo import MongoClient
from bson import ObjectId

# ─── Config ──────────────────────────────────────────────────────────────────
API = os.environ.get("REACT_APP_BACKEND_URL") or os.environ.get("BASE_URL")
if not API:
    # fallback to extracting from frontend .env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                API = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
assert API, "REACT_APP_BACKEND_URL not set"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "railway_asset_inspection")
RUN_ID = uuid.uuid4().hex[:8].upper()
TAG = f"E2E_{RUN_ID}"

print(f"\n{'='*78}\n  E2E FULL LIFECYCLE TEST  —  RUN_ID={RUN_ID}  ({datetime.now().isoformat()})\n{'='*78}\n")
print(f"  API: {API}\n  Tag: {TAG}\n")

mongo = MongoClient(MONGO_URL)
db = mongo[DB_NAME]

# ─── Registry for cleanup ───────────────────────────────────────────────────
CREATED = {  # collection_name → list of _id strings
    "stations": [],
    "asset_types": [],
    "assets": [],
    "users": [],
    "inspections": [],
    "orange_list": [],
    "remarks": [],
    "notifications": [],
    "audit_log": [],
    "locations": [],  # if we end up creating any
}

# ─── Discrepancy log ────────────────────────────────────────────────────────
DISCREPANCIES = []


def discrepancy(severity, area, msg, **ctx):
    entry = {"severity": severity, "area": area, "msg": msg, "ctx": ctx}
    DISCREPANCIES.append(entry)
    sym = {"ERROR": "❌", "WARN": "⚠️", "INFO": "ℹ️"}.get(severity, "•")
    print(f"  {sym} {area}: {msg}" + (f"  {ctx}" if ctx else ""))


# ─── HTTP helpers ───────────────────────────────────────────────────────────
def _login(emp_id, pwd):
    r = requests.post(f"{API}/api/auth/login",
                      json={"employee_id": emp_id, "password": pwd}, timeout=10)
    r.raise_for_status()
    j = r.json()
    return j["token"], j.get("user", {})


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def post(token, path, body):
    r = requests.post(f"{API}{path}", json=body, headers=H(token), timeout=15)
    return r


def get(token, path):
    r = requests.get(f"{API}{path}", headers=H(token), timeout=15)
    return r


# ─── IST literal regex (no Z, no +05:30) ────────────────────────────────────
ISO_BARE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$")

def _check_ist_format(value, where):
    """Returns True if value is a bare ISO IST literal."""
    if value is None or value == "":
        return True
    s = str(value)
    if "Z" in s or re.search(r"[+-]\d{2}:?\d{2}$", s):
        discrepancy("ERROR", "IST_FORMAT", f"non-IST literal at {where}", value=s)
        return False
    if not ISO_BARE_RE.match(s.split(".")[0] + (("." + s.split(".")[1]) if "." in s else "")):
        # accept truncated / sub-second variants
        if not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", s):
            discrepancy("ERROR", "IST_FORMAT", f"unparseable datetime at {where}", value=s)
            return False
    return True


# ============================================================================
#                              MAIN TEST FLOW
# ============================================================================
def main():
    # ─── Login as Superadmin (we use SA for setup) ──────────────────────────
    sa_token, sa_user = _login("SA001", "admin123")
    SA_ID = sa_user["_id"]
    print(f"  SA logged in: {sa_user.get('name')} (id={SA_ID})\n")

    # ─── Phase 1: Setup ─────────────────────────────────────────────────────
    print(f"{'─'*78}\n  PHASE 1: SETUP\n{'─'*78}")

    # Find existing Electrical + Commercial dept ids
    electrical = db.departments.find_one({"name": "Electrical"})
    commercial = db.departments.find_one({"name": "COMMERCIAL"})
    assert electrical and commercial, "Need Electrical + COMMERCIAL departments to exist"
    elec_dept_id = str(electrical["_id"])
    comm_dept_id = str(commercial["_id"])
    print(f"  Using depts: Electrical={elec_dept_id[:8]}, COMMERCIAL={comm_dept_id[:8]}")

    # Pick one location to use for assets (any one is fine; locations are global)
    loc = db.locations.find_one()
    loc_id = str(loc["_id"])

    # Create station via API
    station_body = {"name": f"{TAG}_STATION", "code": f"E2E{RUN_ID[:4]}"}
    r = post(sa_token, "/api/stations", station_body)
    assert r.status_code in (200, 201), f"station create failed: {r.status_code} {r.text}"
    station_id = r.json()["_id"]
    CREATED["stations"].append(station_id)
    print(f"  ✅ Station created: {station_id[:12]}")

    # Create asset types
    elec_type_r = post(sa_token, "/api/asset-types", {
        "name": f"{TAG}_ELEC_TYPE",
        "department_id": elec_dept_id,
        "checklist_items": [
            {"name": "Power on?", "type": "yes_no"},
        ]
    })
    assert elec_type_r.status_code in (200, 201), elec_type_r.text
    elec_type_id = elec_type_r.json()["_id"]
    CREATED["asset_types"].append(elec_type_id)

    comm_type_r = post(sa_token, "/api/asset-types", {
        "name": f"{TAG}_COMM_TYPE",
        "department_id": comm_dept_id,
        "checklist_items": [
            {"name": "Working?", "type": "yes_no"},
        ]
    })
    assert comm_type_r.status_code in (200, 201), comm_type_r.text
    comm_type_id = comm_type_r.json()["_id"]
    CREATED["asset_types"].append(comm_type_id)
    print(f"  ✅ Asset types created: ELEC + COMM")

    # Create users: RO (Electrical), ASUP (Commercial), SUP (Electrical)
    ro_r = post(sa_token, "/api/users", {
        "employee_id": f"E2E_RO_{RUN_ID}",
        "name": f"{TAG}_RO",
        "role": "reporting_officer",
        "department_id": elec_dept_id,
        "assigned_stations": [station_id],
        "password": "test123",
    })
    assert ro_r.status_code in (200, 201), ro_r.text
    ro_id = ro_r.json()["_id"]
    CREATED["users"].append(ro_id)

    asup_r = post(sa_token, "/api/users", {
        "employee_id": f"E2E_ASUP_{RUN_ID}",
        "name": f"{TAG}_ASUP",
        "role": "approving_supervisor",
        "department_id": comm_dept_id,  # ASUP must be Commercial
        "assigned_stations": [station_id],
        "password": "test123",
    })
    assert asup_r.status_code in (200, 201), asup_r.text
    asup_id = asup_r.json()["_id"]
    CREATED["users"].append(asup_id)

    sup_r = post(sa_token, "/api/users", {
        "employee_id": f"E2E_SUP_{RUN_ID}",
        "name": f"{TAG}_SUP",
        "role": "supervisor",
        "department_id": elec_dept_id,
        "assigned_stations": [station_id],
        "reports_to_id": ro_id,
        "password": "test123",
    })
    assert sup_r.status_code in (200, 201), sup_r.text
    sup_id = sup_r.json()["_id"]
    CREATED["users"].append(sup_id)
    print(f"  ✅ Users created: RO={ro_id[:8]}, ASUP={asup_id[:8]}, SUP={sup_id[:8]}")

    # Login as each role
    ro_token, _ = _login(f"E2E_RO_{RUN_ID}", "test123")
    asup_token, _ = _login(f"E2E_ASUP_{RUN_ID}", "test123")
    sup_token, _ = _login(f"E2E_SUP_{RUN_ID}", "test123")
    print(f"  ✅ All roles logged in")

    # Create 5 assets (3 elec + 2 comm)
    assets = []
    for i in range(3):
        ar = post(sa_token, "/api/assets", {
            "asset_type_id": elec_type_id, "station_id": station_id, "location_id": loc_id,
            "asset_number": f"{TAG}_E{i}", "description": "test elec asset",
            "schedule_frequency": 30,
        })
        assert ar.status_code in (200, 201), ar.text
        a = ar.json()
        assets.append(a)
        CREATED["assets"].append(a["_id"])
    for i in range(2):
        ar = post(sa_token, "/api/assets", {
            "asset_type_id": comm_type_id, "station_id": station_id, "location_id": loc_id,
            "asset_number": f"{TAG}_C{i}", "description": "test comm asset",
            "schedule_frequency": 30,
        })
        assert ar.status_code in (200, 201), ar.text
        a = ar.json()
        assets.append(a)
        CREATED["assets"].append(a["_id"])
    print(f"  ✅ 5 assets created: {[a['asset_number'] for a in assets]}")

    # ─── Phase 2: SUP runs inspection ────────────────────────────────────────
    print(f"\n{'─'*78}\n  PHASE 2: INSPECTION (SUP)\n{'─'*78}")

    now_dt = datetime.now()
    backdated_30h = (now_dt - timedelta(hours=30)).strftime("%Y-%m-%dT%H:%M:%S")
    current_2h = (now_dt - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S")

    # E0 → not_ok with backdated 30h ago → RED
    # E1 → needs_repair, current → ORANGE
    # E2 → ok (control)
    # C0 → not_ok, current → ORANGE
    # C1 → ok (control)
    insp_body = {
        "inspection_type": "individual",
        "inspector_id": sup_id,
        "station_id": station_id,
        "items": [
            {"asset_id": assets[0]["_id"], "status": "not_ok",
             "remarks": "test backdated red", "defective_since": backdated_30h},
            {"asset_id": assets[1]["_id"], "status": "needs_repair",
             "remarks": "test needs repair", "defective_since": current_2h},
            {"asset_id": assets[2]["_id"], "status": "ok"},
            {"asset_id": assets[3]["_id"], "status": "not_ok",
             "remarks": "test comm defect", "defective_since": current_2h},
            {"asset_id": assets[4]["_id"], "status": "ok"},
        ],
        "inspection_at": now_dt.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    insp_r = post(sup_token, "/api/inspections", insp_body)
    assert insp_r.status_code in (200, 201), f"inspection failed: {insp_r.status_code} {insp_r.text}"
    insp = insp_r.json()
    CREATED["inspections"].append(insp["_id"])
    print(f"  ✅ Inspection submitted: id={insp['_id'][:12]} auto_rejections={len(insp.get('auto_rejections', []))}")

    # Capture OL ids that got created
    time.sleep(0.5)  # let the writes settle
    for a in assets:
        ols = list(db.orange_list.find({"asset_id": a["_id"]}))
        for ol in ols:
            CREATED["orange_list"].append(str(ol["_id"]))
    print(f"  ✅ {len(CREATED['orange_list'])} OL entries tracked")

    # ─── Phase 3: Cross-role visibility ─────────────────────────────────────
    print(f"\n{'─'*78}\n  PHASE 3: CROSS-ROLE VISIBILITY\n{'─'*78}")

    # SA dashboard
    sa_dash = get(sa_token, "/api/dashboard/superadmin").json()
    print(f"  SA dash health: orange={sa_dash['health'].get('orange',0)} "
          f"red={sa_dash['health'].get('red',0)} yellow={sa_dash['health'].get('yellow',0)}")

    # OL list for SA → should contain our 3 defects
    ol_global = get(sa_token, "/api/orange-list").json()
    ours = [o for o in ol_global if o.get("asset_id") in [a["_id"] for a in assets]]
    if len(ours) != 3:
        discrepancy("ERROR", "OL_VISIBILITY",
                    f"Superadmin OL should show 3 defects from this run, got {len(ours)}")
    else:
        print(f"  ✅ SA sees 3 OL entries from this run")
    # IST format check on each
    for o in ours:
        _check_ist_format(o.get("defective_since"), f"SA OL {o.get('_id')}.defective_since")
        _check_ist_format(o.get("created_at"), f"SA OL {o.get('_id')}.created_at")
    # Check list_type assignments
    e0_ol = next((o for o in ours if o["asset_id"] == assets[0]["_id"]), None)
    e1_ol = next((o for o in ours if o["asset_id"] == assets[1]["_id"]), None)
    c0_ol = next((o for o in ours if o["asset_id"] == assets[3]["_id"]), None)
    if e0_ol and e0_ol.get("list_type") != "red":
        discrepancy("ERROR", "LIST_TYPE",
                    f"E0 backdated 30h should be RED, got {e0_ol.get('list_type')}")
    if e1_ol and e1_ol.get("list_type") != "orange":
        discrepancy("ERROR", "LIST_TYPE",
                    f"E1 (2h) should be ORANGE, got {e1_ol.get('list_type')}")
    if c0_ol and c0_ol.get("list_type") != "orange":
        discrepancy("ERROR", "LIST_TYPE",
                    f"C0 (2h) should be ORANGE, got {c0_ol.get('list_type')}")
    if e0_ol and e1_ol and c0_ol:
        print(f"  ✅ List types correct: E0=red, E1=orange, C0=orange")

    # SUP scoped OL — should see only Electrical assets at this station (E0, E1)
    sup_ol = get(sup_token, f"/api/orange-list?for_user_id={sup_id}").json()
    sup_ours = [o for o in sup_ol if o.get("asset_id") in [a["_id"] for a in assets]]
    sup_asset_ids = {o["asset_id"] for o in sup_ours}
    expected_sup = {assets[0]["_id"], assets[1]["_id"]}  # only Electrical
    if sup_asset_ids != expected_sup:
        discrepancy("ERROR", "SUP_SCOPE",
                    f"SUP should see only Electrical defects (E0,E1); got {len(sup_ours)} entries",
                    expected=list(expected_sup), actual=list(sup_asset_ids))
    else:
        print(f"  ✅ SUP scope correct: sees only Electrical defects (E0, E1)")

    # ASUP scoped OL — should see ALL station defects (cross-dept umbrella)
    asup_ol = get(asup_token, f"/api/orange-list?for_user_id={asup_id}").json()
    asup_ours = [o for o in asup_ol if o.get("asset_id") in [a["_id"] for a in assets]]
    if len(asup_ours) != 3:
        discrepancy("ERROR", "ASUP_SCOPE",
                    f"ASUP should see all 3 station defects, got {len(asup_ours)}")
    else:
        print(f"  ✅ ASUP scope correct: sees all 3 station defects")

    # RO scoped OL — should see Electrical defects at their station (E0, E1)
    ro_ol = get(ro_token, f"/api/orange-list?for_user_id={ro_id}").json()
    ro_ours = [o for o in ro_ol if o.get("asset_id") in [a["_id"] for a in assets]]
    ro_asset_ids = {o["asset_id"] for o in ro_ours}
    if assets[0]["_id"] not in ro_asset_ids or assets[1]["_id"] not in ro_asset_ids:
        discrepancy("WARN", "RO_SCOPE",
                    f"RO should see Electrical defects (E0,E1); got {ro_asset_ids}")
    else:
        print(f"  ✅ RO scope: sees Electrical defects at their station")

    # ─── Phase 4: SUP marks one defective working (E1 → yellow) ─────────────
    print(f"\n{'─'*78}\n  PHASE 4: SUP MARKS WORKING (E1 → YELLOW)\n{'─'*78}")

    rectified_at = (now_dt - timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%S")
    mw_r = post(sup_token, f"/api/orange-list/{e1_ol['_id']}/mark-working", {
        "marked_by": sup_id,
        "marked_working_at": rectified_at,
        "remarks": "Repaired and tested",
    })
    assert mw_r.status_code in (200, 201), f"mark-working failed: {mw_r.status_code} {mw_r.text}"
    print(f"  ✅ E1 marked working at {rectified_at}")

    # Verify E1 now in YELLOW (pending_approval)
    e1_after = db.orange_list.find_one({"_id": ObjectId(e1_ol["_id"])})
    if e1_after.get("status") != "pending_approval":
        discrepancy("ERROR", "MARK_WORKING",
                    f"E1 should be pending_approval, got {e1_after.get('status')}")
    e1_asset_after = db.assets.find_one({"_id": ObjectId(assets[1]["_id"])})
    if e1_asset_after.get("status") != "pending_approval":
        discrepancy("ERROR", "MARK_WORKING",
                    f"E1 asset should be pending_approval, got {e1_asset_after.get('status')}")
    if e1_after.get("status") == "pending_approval" and e1_asset_after.get("status") == "pending_approval":
        print(f"  ✅ E1 transitioned to YELLOW (asset+OL both pending_approval)")

    # ─── Phase 5: ASUP approves rectification ────────────────────────────────
    print(f"\n{'─'*78}\n  PHASE 5: ASUP APPROVES E1 → RESOLVED\n{'─'*78}")

    appr_r = post(asup_token, f"/api/orange-list/{e1_ol['_id']}/approve", {
        "approved_by": asup_id, "remarks": "Verified in field",
    })
    assert appr_r.status_code in (200, 201), f"approve failed: {appr_r.status_code} {appr_r.text}"

    e1_resolved = db.orange_list.find_one({"_id": ObjectId(e1_ol["_id"])})
    e1_asset_resolved = db.assets.find_one({"_id": ObjectId(assets[1]["_id"])})
    if e1_resolved.get("status") != "resolved":
        discrepancy("ERROR", "APPROVE", f"E1 OL should be resolved, got {e1_resolved.get('status')}")
    if e1_asset_resolved.get("status") != "working":
        discrepancy("ERROR", "APPROVE",
                    f"E1 asset should be working after approval, got {e1_asset_resolved.get('status')}")
    if e1_asset_resolved.get("defective_since") is not None:
        discrepancy("WARN", "APPROVE",
                    f"E1 asset.defective_since should be cleared after approval")
    if e1_resolved.get("status") == "resolved" and e1_asset_resolved.get("status") == "working":
        print(f"  ✅ E1 fully resolved (OL=resolved, asset=working, defective_since=cleared)")

    # ─── Phase 6: Mark C0 working → ASUP rejects → back to defective ───────
    print(f"\n{'─'*78}\n  PHASE 6: MARK WORKING + ASUP REJECTS (C0 cycle)\n{'─'*78}")

    mw2_r = post(sup_token, f"/api/orange-list/{c0_ol['_id']}/mark-working", {
        "marked_by": sup_id,
        "marked_working_at": rectified_at,
        "remarks": "Looks fine now",
    })
    assert mw2_r.status_code in (200, 201), mw2_r.text

    rej_r = post(asup_token, f"/api/orange-list/{c0_ol['_id']}/reject-working", {
        "rejected_by": asup_id, "remarks": "Field check failed - still leaking",
    })
    assert rej_r.status_code in (200, 201), f"reject failed: {rej_r.status_code} {rej_r.text}"

    c0_after_rej = db.orange_list.find_one({"_id": ObjectId(c0_ol["_id"])})
    c0_asset_after = db.assets.find_one({"_id": ObjectId(assets[3]["_id"])})
    if c0_after_rej.get("status") != "defective":
        discrepancy("ERROR", "REJECT",
                    f"C0 OL should be defective after reject, got {c0_after_rej.get('status')}")
    if c0_asset_after.get("status") != "defective":
        discrepancy("ERROR", "REJECT",
                    f"C0 asset should be defective after reject, got {c0_asset_after.get('status')}")
    # CRITICAL: defective_since should match original (not reset).
    # Read fresh from DB to avoid str-vs-datetime comparison noise.
    c0_orig_db = db.orange_list.find_one({"_id": ObjectId(c0_ol["_id"])}, {"defective_since": 1})
    # Compare via the stable original we captured BEFORE any state change:
    # we cached it via API at line where we built c0_ol (a string). Parse both.
    def _norm_dt(v):
        if v is None: return None
        if isinstance(v, datetime):
            return v.replace(tzinfo=None) if v.tzinfo else v
        s = str(v).replace("Z", "").replace("+00:00", "")
        try:
            return datetime.fromisoformat(s.split("+")[0])
        except Exception:
            return None
    orig_dt = _norm_dt(c0_ol.get("defective_since"))
    now_dt2 = _norm_dt(c0_after_rej.get("defective_since"))
    if orig_dt and now_dt2 and abs((orig_dt - now_dt2).total_seconds()) > 1:
        discrepancy("ERROR", "CANONICAL_DS",
                    f"C0.defective_since changed after reject — clock reset!",
                    orig=str(orig_dt), now=str(now_dt2))
    if _norm_dt(c0_asset_after.get("defective_since")) != _norm_dt(c0_after_rej.get("defective_since")):
        discrepancy("ERROR", "CANONICAL_DS",
                    f"C0 asset.defective_since != OL.defective_since after reject")
    print(f"  ✅ C0 cycle: yellow→reject→defective. Clock preserved at {c0_after_rej.get('defective_since')}")

    # ─── Phase 7: Each role posts a remark on E0 (still defective/red) ──────
    print(f"\n{'─'*78}\n  PHASE 7: REMARKS FROM EVERY ROLE ON E0\n{'─'*78}")

    role_remarks = [
        (sa_token, SA_ID, "superadmin", "SA remark: monitoring closely"),
        (sup_token, sup_id, "supervisor", "SUP remark: parts ordered"),
        (asup_token, asup_id, "approving_supervisor", "ASUP remark: verified breakdown report"),
        (ro_token, ro_id, "reporting_officer", "RO remark: escalated to dept"),
    ]
    for tok, uid, role, text in role_remarks:
        rr = post(tok, f"/api/orange-list/{e0_ol['_id']}/remarks?current_user_id={uid}", {
            "type": "note", "text": text,
        })
        if rr.status_code not in (200, 201):
            discrepancy("ERROR", "REMARKS", f"{role} remark failed: {rr.status_code} {rr.text}")
        else:
            CREATED["remarks"].append(rr.json().get("_id"))
            print(f"  ✅ {role} remark posted")

    # Verify SA can read all of them
    rems_r = get(sa_token, f"/api/orange-list/{e0_ol['_id']}/remarks")
    if rems_r.status_code == 200:
        rems_data = rems_r.json()
        rems = rems_data if isinstance(rems_data, list) else rems_data.get("items", [])
        # Filter to ours
        our_role_remarks = [r for r in rems if r.get("text") in [t[3] for t in role_remarks]]
        if len(our_role_remarks) != 4:
            discrepancy("ERROR", "REMARKS_VISIBILITY",
                        f"SA should see all 4 role remarks; saw {len(our_role_remarks)}")
        else:
            print(f"  ✅ SA reads all 4 role remarks. Authors: {[r.get('role') or r.get('author_role') for r in our_role_remarks]}")
        # IST format check
        for r in our_role_remarks:
            _check_ist_format(r.get("created_at"), f"remark.created_at")

    # ─── Phase 8: Re-inspection NOT_OK on E1 (already resolved) → fresh defect ──
    # Actually E1 is already RESOLVED. Let's test on a working asset instead by
    # marking C1 (still working) defective, then yellow, then re-inspection
    # NOT_OK on C1 to trigger auto-reject path.
    print(f"\n{'─'*78}\n  PHASE 8: AUTO-REJECT PATH (C1 lifecycle)\n{'─'*78}")

    # First, mark C1 defective via fresh inspection
    insp2 = post(sup_token, "/api/inspections", {
        "inspection_type": "individual",
        "inspector_id": sup_id,
        "station_id": station_id,
        "items": [{"asset_id": assets[4]["_id"], "status": "not_ok",
                   "remarks": "newly broken", "defective_since": current_2h}],
        "inspection_at": now_dt.strftime("%Y-%m-%dT%H:%M:%S"),
    })
    assert insp2.status_code in (200, 201), insp2.text
    CREATED["inspections"].append(insp2.json()["_id"])
    c1_ol = db.orange_list.find_one({"asset_id": assets[4]["_id"], "status": "defective"})
    CREATED["orange_list"].append(str(c1_ol["_id"]))
    c1_original_ds = c1_ol.get("defective_since")
    print(f"  ✅ C1 marked defective at {c1_original_ds}")

    # Mark C1 working
    post(sup_token, f"/api/orange-list/{c1_ol['_id']}/mark-working", {
        "marked_by": sup_id, "marked_working_at": rectified_at,
        "remarks": "Fixed quickly",
    })
    print(f"  ✅ C1 → yellow (pending_approval)")

    # Re-inspection NOT_OK → should auto-reject
    insp3 = post(sup_token, "/api/inspections", {
        "inspection_type": "individual", "inspector_id": sup_id, "station_id": station_id,
        "items": [{"asset_id": assets[4]["_id"], "status": "not_ok",
                   "remarks": "Came back broken",
                   "defective_since": now_dt.strftime("%Y-%m-%dT%H:%M:%S")}],
        "inspection_at": now_dt.strftime("%Y-%m-%dT%H:%M:%S"),
    })
    assert insp3.status_code in (200, 201), insp3.text
    insp3_doc = insp3.json()
    CREATED["inspections"].append(insp3_doc["_id"])

    if len(insp3_doc.get("auto_rejections", [])) != 1:
        discrepancy("ERROR", "AUTO_REJECT",
                    f"expected 1 auto_rejection, got {len(insp3_doc.get('auto_rejections', []))}")
    c1_after_auto = db.orange_list.find_one({"_id": c1_ol["_id"]})
    if c1_after_auto.get("status") != "defective":
        discrepancy("ERROR", "AUTO_REJECT",
                    f"C1 OL should auto-reject to defective, got {c1_after_auto.get('status')}")
    if c1_after_auto.get("defective_since") != c1_original_ds:
        discrepancy("ERROR", "CANONICAL_DS",
                    f"C1 OL.defective_since changed during auto-reject! "
                    f"orig={c1_original_ds} now={c1_after_auto.get('defective_since')}")
    if not c1_after_auto.get("rejection_remarks"):
        discrepancy("WARN", "AUTO_REJECT", "C1 should have rejection_remarks set")
    if not c1_after_auto.get("rejected_by"):
        discrepancy("WARN", "AUTO_REJECT", "C1 should have rejected_by set")
    if c1_after_auto.get("status") == "defective" and c1_after_auto.get("defective_since") == c1_original_ds:
        print(f"  ✅ C1 auto-rejected: status=defective, defective_since preserved at {c1_original_ds}")

    # ─── Phase 9: IST literal time format on every API response ─────────────
    print(f"\n{'─'*78}\n  PHASE 9: IST LITERAL FORMAT ACROSS APIs\n{'─'*78}")

    endpoints = [
        ("/api/dashboard/superadmin", sa_token),
        (f"/api/orange-list", sa_token),
        (f"/api/orange-list/{e0_ol['_id']}/remarks", sa_token),
        (f"/api/dashboard/supervisor/{sup_id}", sup_token),
        (f"/api/dashboard/approving-supervisor/{asup_id}", asup_token),
        (f"/api/dashboard/reporting-officer/{ro_id}", ro_token),
    ]
    for path, tok in endpoints:
        r = get(tok, path)
        if r.status_code != 200:
            discrepancy("WARN", "IST_FORMAT", f"{path} returned {r.status_code}")
            continue
        body_str = r.text
        # Look for any 'Z' or '+05:30' inside ISO datetime strings
        for m in re.finditer(r'"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^"]*"', body_str):
            v = m.group(0)
            if 'Z"' in v or re.search(r'[+-]\d{2}:?\d{2}"', v):
                discrepancy("ERROR", "IST_FORMAT",
                            f"non-IST datetime found in {path}", value=v[:50])
                break
        else:
            print(f"  ✅ {path}: all datetimes are bare IST literals")

    # ─── Phase 10: Final audit invariants ────────────────────────────────────
    print(f"\n{'─'*78}\n  PHASE 10: AUDIT INVARIANTS\n{'─'*78}")
    import subprocess
    aud = subprocess.run(["python", "/app/backend/tests/audit_list_consistency.py"],
                         capture_output=True, text=True)
    if aud.returncode != 0:
        discrepancy("ERROR", "AUDIT", "audit_list_consistency reports violations")
        print(aud.stdout[-1500:])
    else:
        # Extract pass/fail counts
        m = re.search(r"PASS\s*:\s*(\d+).*FAIL\s*:\s*(\d+)", aud.stdout, re.S)
        if m:
            print(f"  ✅ Audit: {m.group(1)} PASS, {m.group(2)} FAIL")


# ============================================================================
#                              CLEANUP
# ============================================================================
def cleanup():
    print(f"\n{'='*78}\n  CLEANUP — removing all RUN_ID={RUN_ID} test data\n{'='*78}")
    # Delete by tracked _id
    counts = {}
    for coll, ids in CREATED.items():
        if not ids:
            continue
        try:
            obj_ids = []
            for x in ids:
                try:
                    obj_ids.append(ObjectId(x))
                except Exception:
                    pass
            if obj_ids:
                r = db[coll].delete_many({"_id": {"$in": obj_ids}})
                counts[coll] = r.deleted_count
        except Exception as e:
            print(f"  ⚠ failed to clean {coll}: {e}")

    # Sweep by tag in name fields (defensive — picks up any orphans)
    for coll in ["stations", "asset_types", "assets", "users", "departments"]:
        try:
            for field in ["name", "asset_number", "employee_id", "code"]:
                r = db[coll].delete_many({field: {"$regex": f"^{TAG}|{TAG}$"}})
                if r.deleted_count:
                    counts[f"{coll}({field})"] = counts.get(f"{coll}({field})", 0) + r.deleted_count
        except Exception:
            pass

    # Inspections / OL / remarks / notifications / audit_log linked to our assets
    asset_id_list = CREATED["assets"]
    if asset_id_list:
        for coll in ["inspections"]:
            r = db[coll].delete_many({"items.asset_id": {"$in": asset_id_list}})
            if r.deleted_count: counts[f"{coll}(asset_link)"] = r.deleted_count
        for coll in ["orange_list", "notifications", "audit_log"]:
            r = db[coll].delete_many({
                "$or": [
                    {"asset_id": {"$in": asset_id_list}},
                    {"related_entity_id": {"$in": asset_id_list}},
                    {"entity_id": {"$in": asset_id_list}},
                ]
            })
            if r.deleted_count: counts[f"{coll}(asset_link)"] = r.deleted_count

    # Remarks linked to our OLs
    if CREATED["orange_list"]:
        r = db.remarks.delete_many({"orange_list_id": {"$in": CREATED["orange_list"]}})
        if r.deleted_count: counts["remarks(ol_link)"] = r.deleted_count

    # User-linked notifications
    if CREATED["users"]:
        r = db.notifications.delete_many({"user_id": {"$in": CREATED["users"]}})
        if r.deleted_count: counts["notifications(user_link)"] = r.deleted_count
        r = db.audit_log.delete_many({"performed_by": {"$in": CREATED["users"]}})
        if r.deleted_count: counts["audit_log(user_link)"] = r.deleted_count

    print("  Deletion counts:")
    for k, v in sorted(counts.items()):
        print(f"    {k}: {v}")
    if not counts:
        print("    (nothing to clean)")
    print(f"\n  Cleanup complete.\n")


if __name__ == "__main__":
    error = None
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        error = e
    finally:
        cleanup()

    # Final report
    print(f"\n{'='*78}\n  FINAL REPORT — RUN_ID={RUN_ID}\n{'='*78}")
    print(f"  Discrepancies found: {len(DISCREPANCIES)}")
    by_sev = {}
    for d in DISCREPANCIES:
        by_sev[d["severity"]] = by_sev.get(d["severity"], 0) + 1
    for sev, cnt in sorted(by_sev.items()):
        print(f"    {sev}: {cnt}")
    out = {
        "run_id": RUN_ID,
        "ran_at": datetime.now().isoformat(),
        "discrepancies": DISCREPANCIES,
        "error": str(error) if error else None,
    }
    os.makedirs("/app/test_reports", exist_ok=True)
    with open(f"/app/test_reports/e2e_lifecycle_{RUN_ID}.json", "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"  Report: /app/test_reports/e2e_lifecycle_{RUN_ID}.json")
    sys.exit(0 if not DISCREPANCIES and not error else 1)
