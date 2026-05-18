"""
Data Heal — admin tool to reconcile two known production data drifts:

  1) Orange List ⇄ Asset Status (two-way reconcile)
       a. FORWARD : assets with status='defective'|'pending_approval' that
                    have no matching open OL row → create one.
       b. BACKWARD: open OL rows whose asset.status='working' → flip asset
                    back to defective/pending_approval and mirror defective_since.

  2) Division relink (by zone code/name)
       Divisions whose zone_id does not match any existing zone get relinked
       to the canonical zone matched by code (preferring "ECR") or, failing
       that, the only available zone.

Both reconciliations are idempotent: running twice changes nothing the
second time.

Safety:
  - dry_run=true returns a JSON report with counts + sample IDs; no writes.
  - dry_run=false applies changes and inserts a row into `data_health_audit`
    (collection shared with DataHealthPanel) tagged category='data_heal_reconcile'.
  - All endpoints require role='superadmin'.

Endpoints
  POST /api/data-heal/preview/{user_id}                 dry-run only
  POST /api/data-heal/execute/{user_id}                 apply + audit
  GET  /api/data-heal/audit/{user_id}?limit=20          audit history
"""
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Query

from database import (
    assets_collection, orange_list_collection, zones_collection,
    divisions_collection, users_collection, db, now_ist,
)

router = APIRouter()
audit_collection = db["data_health_audit"]


# ─── Auth ─────────────────────────────────────────────────────────────────
async def _require_superadmin(user_id: str) -> dict:
    try:
        u = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if u.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Superadmin required")
    return u


# ─── Reconciliation builders (pure: no writes when dry_run=True) ──────────
async def _scan_ol_status_mismatch() -> Dict[str, Any]:
    """Return forward (asset → missing OL) and backward (OL → asset mismatch)
    discrepancies. Caller decides whether to write."""
    # FORWARD: assets marked defective/pending without an open OL
    bad_assets = await assets_collection.find(
        {"status": {"$in": ["defective", "pending_approval"]}}).to_list(50000)
    bad_asset_ids = [str(a["_id"]) for a in bad_assets]
    open_ols = await orange_list_collection.find(
        {"asset_id": {"$in": bad_asset_ids}, "status": {"$ne": "resolved"}},
        {"asset_id": 1}).to_list(50000) if bad_asset_ids else []
    have_open_ol = {str(o["asset_id"]) for o in open_ols}
    forward_missing = [a for a in bad_assets if str(a["_id"]) not in have_open_ol]

    # BACKWARD: open OL rows whose asset is marked working (or missing)
    all_open = await orange_list_collection.find(
        {"status": {"$ne": "resolved"}}).to_list(50000)
    open_ol_asset_ids = list({str(o.get("asset_id")) for o in all_open
                              if o.get("asset_id")})
    asset_map: Dict[str, dict] = {}
    if open_ol_asset_ids:
        try:
            oids = [ObjectId(a) for a in open_ol_asset_ids]
        except Exception:
            oids = []
        async for a in assets_collection.find({"_id": {"$in": oids}}):
            asset_map[str(a["_id"])] = a
    backward_mismatched = []
    for ol in all_open:
        aid = str(ol.get("asset_id") or "")
        asset = asset_map.get(aid)
        if asset and asset.get("status") == "working":
            backward_mismatched.append({"ol": ol, "asset": asset})

    return {
        "forward_missing": forward_missing,
        "backward_mismatched": backward_mismatched,
    }


async def _scan_orphan_divisions() -> List[dict]:
    """Return divisions whose zone_id does not match any existing zone."""
    zones = await zones_collection.find({}, {"_id": 1}).to_list(1000)
    valid_zone_ids = {str(z["_id"]) for z in zones}
    divs = await divisions_collection.find({}).to_list(1000)
    return [d for d in divs if str(d.get("zone_id") or "") not in valid_zone_ids]


async def _pick_canonical_zone() -> Optional[dict]:
    """Choose the target zone for relinking orphan divisions.
    Preference: code 'ECR' → any zone with 'ECR' in code → first zone alphabetically.
    """
    z = await zones_collection.find_one({"code": "ECR"})
    if z:
        return z
    z = await zones_collection.find_one({"code": {"$regex": "ECR", "$options": "i"}})
    if z:
        return z
    return await zones_collection.find_one({}, sort=[("name", 1)])


# ─── Execution ────────────────────────────────────────────────────────────
async def _reconcile(dry_run: bool, actor_id: str) -> Dict[str, Any]:
    """Compute the reconciliation report; apply writes when dry_run is False."""
    report: Dict[str, Any] = {
        "dry_run": dry_run,
        "scanned_at": now_ist().isoformat(),
        "orange_list": {
            "forward_create_count": 0,
            "backward_fix_count": 0,
            "forward_sample": [],
            "backward_sample": [],
        },
        "divisions": {
            "orphan_count": 0,
            "relink_count": 0,
            "target_zone": None,
            "unreconciled_count": 0,
            "sample": [],
        },
    }

    # ── 1) Orange List ⇄ Asset status reconcile ──────────────────────────
    scan = await _scan_ol_status_mismatch()
    forward = scan["forward_missing"]
    backward = scan["backward_mismatched"]

    report["orange_list"]["forward_create_count"] = len(forward)
    report["orange_list"]["backward_fix_count"] = len(backward)
    report["orange_list"]["forward_sample"] = [
        {"asset_id": str(a["_id"]),
         "asset_number": a.get("asset_number"),
         "status": a.get("status"),
         "defective_since": (a.get("defective_since").isoformat()
                              if hasattr(a.get("defective_since"), "isoformat")
                              else str(a.get("defective_since") or ""))}
        for a in forward[:10]
    ]
    report["orange_list"]["backward_sample"] = [
        {"ol_id": str(x["ol"]["_id"]),
         "asset_id": str(x["asset"]["_id"]),
         "asset_number": x["asset"].get("asset_number"),
         "current_asset_status": x["asset"].get("status"),
         "ol_status": x["ol"].get("status")}
        for x in backward[:10]
    ]

    if not dry_run:
        # FORWARD: create OL rows
        for a in forward:
            aid = str(a["_id"])
            ds = a.get("defective_since") or now_ist()
            ol_status = ("pending_approval"
                         if a.get("status") == "pending_approval"
                         else "defective")
            await orange_list_collection.insert_one({
                "asset_id": aid,
                "inspection_id": None,
                "reported_by": None,
                "status": ol_status,
                "defective_since": ds,
                "remarks": "Back-filled by data reconciliation "
                           "(asset was marked defective without an active "
                           "orange-list row).",
                "marked_working_by": None,
                "marked_working_at": None,
                "approved_by": None,
                "approved_at": None,
                "created_at": now_ist(),
                "reconciled_at": now_ist(),
                "reconciled_by": actor_id,
            })

        # BACKWARD: flip asset back to defective/pending_approval matching OL
        for pair in backward:
            ol = pair["ol"]
            asset = pair["asset"]
            new_status = ("pending_approval"
                          if ol.get("status") == "pending_approval"
                          else "defective")
            ds = ol.get("defective_since") or asset.get("defective_since") or now_ist()
            await assets_collection.update_one(
                {"_id": asset["_id"]},
                {"$set": {"status": new_status, "defective_since": ds}},
            )

    # ── 2) Division relink ──────────────────────────────────────────────
    orphans = await _scan_orphan_divisions()
    report["divisions"]["orphan_count"] = len(orphans)
    target_zone = await _pick_canonical_zone() if orphans else None
    if target_zone:
        report["divisions"]["target_zone"] = {
            "id": str(target_zone["_id"]),
            "name": target_zone.get("name"),
            "code": target_zone.get("code"),
        }
    report["divisions"]["sample"] = [
        {"id": str(d["_id"]),
         "name": d.get("name"),
         "code": d.get("code"),
         "bad_zone_id": str(d.get("zone_id") or "")}
        for d in orphans[:10]
    ]

    if target_zone:
        new_zone_id = str(target_zone["_id"])
        report["divisions"]["relink_count"] = len(orphans)
        if not dry_run:
            for d in orphans:
                await divisions_collection.update_one(
                    {"_id": d["_id"]},
                    {"$set": {"zone_id": new_zone_id,
                              "reconciled_at": now_ist(),
                              "reconciled_by": actor_id}},
                )
    else:
        # No zone exists at all — cannot relink. Surface as unreconciled.
        report["divisions"]["unreconciled_count"] = len(orphans)

    return report


# ─── Endpoints ────────────────────────────────────────────────────────────
@router.post("/api/data-heal/preview/{user_id}")
async def preview_reconcile(user_id: str):
    await _require_superadmin(user_id)
    return await _reconcile(dry_run=True, actor_id=user_id)


@router.post("/api/data-heal/execute/{user_id}")
async def execute_reconcile(user_id: str):
    actor = await _require_superadmin(user_id)
    report = await _reconcile(dry_run=False, actor_id=user_id)
    await audit_collection.insert_one({
        "performed_by": user_id,
        "performed_by_name": actor.get("name"),
        "performed_at": now_ist().isoformat(),
        "category": "data_heal_reconcile",
        "summary": {
            "ol_forward_created": report["orange_list"]["forward_create_count"],
            "ol_backward_fixed": report["orange_list"]["backward_fix_count"],
            "divisions_relinked": report["divisions"]["relink_count"],
            "divisions_unreconciled": report["divisions"]["unreconciled_count"],
            "target_zone": report["divisions"].get("target_zone"),
        },
    })
    return report


@router.get("/api/data-heal/audit/{user_id}")
async def heal_audit(user_id: str, limit: int = Query(20, le=200)):
    await _require_superadmin(user_id)
    cur = audit_collection.find(
        {"category": "data_heal_reconcile"},
        sort=[("performed_at", -1)],
    ).limit(limit)
    rows = []
    async for r in cur:
        r["_id"] = str(r["_id"])
        rows.append(r)
    return {"rows": rows}
