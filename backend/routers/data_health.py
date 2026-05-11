"""
Data Health — admin panel to scan and cascade-clean problematic records.

Categories scanned:
  - orphan_inspection_items: inspection items pointing to deleted assets
  - orphan_ol_entries:       OL rows where asset doesn't exist
  - orphan_remarks:          remarks tied to deleted OL or asset
  - test_users:              name/employee_id matches test pattern
  - test_stations:           name/code matches test pattern
  - unnamed_asset_types:     name is empty/null
  - zero_activity_stations:  no assets, no inspections, no schedules
  - zero_activity_users:     is_active=false AND no inspections/repairs ever
  - stale_records:           older than 6 months (configurable per category)
  - duplicates:              same employee_id or asset_number

Endpoints (all require role in {superadmin, admin}, execute requires superadmin):
  GET  /api/data-health/scan/{user_id}
  GET  /api/data-health/preview/{user_id}?category=&id=
  POST /api/data-health/clean/{user_id}
  GET  /api/data-health/audit/{user_id}?limit=
"""
import re
from datetime import timedelta
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from database import (
    users_collection, assets_collection, asset_types_collection,
    stations_collection, locations_collection,
    orange_list_collection, inspections_collection,
    schedules_collection, remarks_collection, db, now_ist,
)

router = APIRouter()
audit_collection = db["data_health_audit"]


# ─── Patterns ─────────────────────────────────────────────────────────────
TEST_USER_NAME_RE = re.compile(r"^(test|TEST)\b", re.IGNORECASE)
TEST_USER_EID_RE = re.compile(r"^(SUP|RO|ASUP|ADMIN)\d{10,}$")
TEST_STATION_NAME_RE = re.compile(r"^TEST_STATION", re.IGNORECASE)
TEST_STATION_CODE_RE = re.compile(r"^TS\d{10,}$")
STALE_MONTHS_DEFAULT = 6


# ─── Helpers ──────────────────────────────────────────────────────────────
async def _user_or_403(user_id: str, require_superadmin: bool = False):
    try:
        user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    role = user.get("role")
    if require_superadmin and role != "superadmin":
        raise HTTPException(status_code=403, detail="Superadmin required")
    if role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Admin or Superadmin required")
    return user


async def _all_asset_ids() -> set:
    return {str(a["_id"]) for a in await assets_collection.find(
        {}, {"_id": 1}).to_list(100000)}


async def _all_station_ids() -> set:
    return {str(s["_id"]) for s in await stations_collection.find(
        {}, {"_id": 1}).to_list(10000)}


def _is_test_user(u: dict) -> bool:
    name = (u.get("name") or "").strip()
    eid = (u.get("employee_id") or "").strip()
    if TEST_USER_NAME_RE.match(name):
        return True
    if TEST_USER_EID_RE.match(eid):
        return True
    return False


def _is_test_station(s: dict) -> bool:
    return bool(TEST_STATION_NAME_RE.match((s.get("name") or "").strip())
                or TEST_STATION_CODE_RE.match((s.get("code") or "").strip()))


# ─── Scan ─────────────────────────────────────────────────────────────────
@router.get("/api/data-health/scan/{user_id}")
async def scan(user_id: str, stale_months: int = Query(STALE_MONTHS_DEFAULT)):
    await _user_or_403(user_id)
    asset_ids = await _all_asset_ids()
    station_ids = await _all_station_ids()

    # 1. orphan inspection items
    insps = await inspections_collection.find({}).to_list(20000)
    orphan_item_count = 0
    orphan_insp_ids = []
    for ins in insps:
        any_orphan = False
        for item in ins.get("items", []):
            aid = item.get("asset_id")
            if aid and str(aid) not in asset_ids:
                orphan_item_count += 1
                any_orphan = True
        if any_orphan:
            orphan_insp_ids.append(str(ins["_id"]))

    # 2. orphan OL entries
    ols = await orange_list_collection.find({}).to_list(50000)
    orphan_ol_ids = [str(o["_id"]) for o in ols
                     if o.get("asset_id") and str(o["asset_id"]) not in asset_ids]

    # 3. orphan remarks
    valid_ol_ids = {str(o["_id"]) for o in ols}
    remarks = await remarks_collection.find({}).to_list(50000)
    orphan_remark_ids = [str(r["_id"]) for r in remarks
                         if r.get("orange_list_id") and str(r["orange_list_id"]) not in valid_ol_ids]

    # 4. test users
    users = await users_collection.find({}).to_list(5000)
    test_users = [u for u in users if _is_test_user(u)]

    # 5. test stations
    stations = await stations_collection.find({}).to_list(5000)
    test_stations = [s for s in stations if _is_test_station(s)]

    # 6. unnamed asset-types
    unnamed_types = await asset_types_collection.find(
        {"$or": [{"name": ""}, {"name": None},
                 {"name": {"$regex": r"^\s*$"}}]}).to_list(500)

    # 7. zero-activity stations
    zero_stations = []
    for s in stations:
        sid = str(s["_id"])
        if _is_test_station(s):
            continue  # already in another bucket
        n_assets = await assets_collection.count_documents({"station_id": sid})
        if n_assets == 0:
            n_insp = await inspections_collection.count_documents({"station_id": sid})
            n_sched = await schedules_collection.count_documents({"station_id": sid})
            if n_insp == 0 and n_sched == 0:
                zero_stations.append(s)

    # 8. zero-activity users (inactive + no repairs/inspections)
    zero_users = []
    for u in users:
        if u.get("is_active") is not False:
            continue
        uid = str(u["_id"])
        repairs = await orange_list_collection.count_documents({"marked_working_by": uid})
        n_insp = await inspections_collection.count_documents({"inspector_id": uid})
        if repairs == 0 and n_insp == 0:
            zero_users.append(u)

    # 9. stale records — assets/inspections older than N months with no recent activity
    cutoff = now_ist() - timedelta(days=stale_months * 30)
    stale_inspections = await inspections_collection.count_documents(
        {"created_at": {"$lt": cutoff.isoformat()}})
    stale_ols_resolved = await orange_list_collection.count_documents(
        {"status": "resolved", "marked_working_at": {"$lt": cutoff.isoformat()}})

    # 10. duplicates
    dup_users = await _find_duplicates(users_collection, "employee_id")
    dup_assets = await _find_duplicates(assets_collection, "asset_number")

    def _u(u): return {"id": str(u["_id"]), "name": u.get("name"),
                       "employee_id": u.get("employee_id"), "role": u.get("role")}
    def _s(s): return {"id": str(s["_id"]), "name": s.get("name"),
                       "code": s.get("code")}
    def _t(t): return {"id": str(t["_id"]), "name": t.get("name") or "",
                       "department_id": t.get("department_id")}

    return {
        "scanned_at": now_ist().isoformat(),
        "stale_months": stale_months,
        "categories": {
            "orphan_inspection_items": {
                "count": orphan_item_count,
                "sample": orphan_insp_ids[:10],
                "label": "Inspection items pointing to deleted assets",
            },
            "orphan_ol_entries": {
                "count": len(orphan_ol_ids),
                "sample": orphan_ol_ids[:10],
                "label": "Orange-list entries with deleted asset",
            },
            "orphan_remarks": {
                "count": len(orphan_remark_ids),
                "sample": orphan_remark_ids[:10],
                "label": "Remarks tied to deleted OL entries",
            },
            "test_users": {
                "count": len(test_users),
                "sample": [_u(u) for u in test_users[:15]],
                "label": "Users with test-pattern names",
            },
            "test_stations": {
                "count": len(test_stations),
                "sample": [_s(s) for s in test_stations[:15]],
                "label": "Stations with test-pattern names",
            },
            "unnamed_asset_types": {
                "count": len(unnamed_types),
                "sample": [_t(t) for t in unnamed_types[:15]],
                "label": "Asset types with empty/null name",
            },
            "zero_activity_stations": {
                "count": len(zero_stations),
                "sample": [_s(s) for s in zero_stations[:15]],
                "label": "Stations with no assets, inspections, or schedules",
            },
            "zero_activity_users": {
                "count": len(zero_users),
                "sample": [_u(u) for u in zero_users[:15]],
                "label": "Inactive users with zero repairs/inspections",
            },
            "stale_records": {
                "count": stale_inspections + stale_ols_resolved,
                "sample": [
                    f"{stale_inspections} inspections older than {stale_months} months",
                    f"{stale_ols_resolved} resolved OL entries older than {stale_months} months",
                ],
                "label": f"Records older than {stale_months} months",
                "breakdown": {
                    "stale_inspections": stale_inspections,
                    "stale_ols_resolved": stale_ols_resolved,
                },
            },
            "duplicates": {
                "count": len(dup_users) + len(dup_assets),
                "sample": (
                    [{"kind": "user", "employee_id": k, "ids": v} for k, v in list(dup_users.items())[:5]]
                    + [{"kind": "asset", "asset_number": k, "ids": v} for k, v in list(dup_assets.items())[:5]]
                ),
                "label": "Duplicate employee_ids or asset_numbers",
            },
        },
    }


async def _find_duplicates(coll, field: str) -> Dict[str, List[str]]:
    pipeline = [
        {"$match": {field: {"$ne": None, "$exists": True}}},
        {"$group": {"_id": {"$toLower": f"${field}"},
                    "ids": {"$push": {"$toString": "$_id"}},
                    "n": {"$sum": 1}}},
        {"$match": {"n": {"$gt": 1}}},
    ]
    out = {}
    async for doc in coll.aggregate(pipeline):
        out[doc["_id"]] = doc["ids"]
    return out


# ─── Preview (cascade impact for a single record) ─────────────────────────
@router.get("/api/data-health/preview/{user_id}")
async def preview(user_id: str,
                  category: str = Query(...),
                  target_id: Optional[str] = Query(None)):
    """For categories that operate per-record (test_users, test_stations,
    zero_activity_stations, unnamed_asset_types) — preview the cascade.

    For bulk categories (orphan_*, stale_records, zero_activity_users), this
    returns the cumulative impact summary instead.
    """
    await _user_or_403(user_id)

    if category == "test_stations" or category == "zero_activity_stations":
        if not target_id:
            raise HTTPException(status_code=400, detail="target_id required")
        return await _preview_station_cascade(target_id)

    if category == "test_users" or category == "zero_activity_users":
        if not target_id:
            raise HTTPException(status_code=400, detail="target_id required")
        return await _preview_user_cascade(target_id)

    if category == "unnamed_asset_types":
        if not target_id:
            raise HTTPException(status_code=400, detail="target_id required")
        n_assets = await assets_collection.count_documents({"asset_type_id": target_id})
        return {"target_id": target_id, "cascade":
                {"assets_using_this_type": n_assets,
                 "note": "Assets keep type_id reference but show as '(unnamed)' — renaming the type is preferred over deletion." if n_assets else "Safe to delete — no assets reference this type."}}

    # Bulk-only categories
    scan_result = await scan(user_id, stale_months=STALE_MONTHS_DEFAULT)
    cat = scan_result["categories"].get(category)
    if not cat:
        raise HTTPException(status_code=400, detail=f"Unknown category: {category}")
    return {"category": category, "bulk": True, "total": cat["count"],
            "label": cat["label"]}


async def _preview_station_cascade(station_id: str) -> Dict[str, Any]:
    station = await stations_collection.find_one({"_id": ObjectId(station_id)})
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")
    n_locations = await locations_collection.count_documents({"station_id": station_id})
    n_assets = await assets_collection.count_documents({"station_id": station_id})
    asset_ids = {str(a["_id"]) for a in await assets_collection.find(
        {"station_id": station_id}, {"_id": 1}).to_list(20000)}
    n_ols = await orange_list_collection.count_documents(
        {"asset_id": {"$in": list(asset_ids)}}) if asset_ids else 0
    ol_ids = [str(o["_id"]) for o in await orange_list_collection.find(
        {"asset_id": {"$in": list(asset_ids)}}, {"_id": 1}).to_list(20000)] if asset_ids else []
    n_remarks = await remarks_collection.count_documents(
        {"orange_list_id": {"$in": ol_ids}}) if ol_ids else 0
    n_inspections = await inspections_collection.count_documents({"station_id": station_id})
    n_schedules = await schedules_collection.count_documents({"station_id": station_id})
    # Inspection items inside OTHER stations referencing our assets
    insp_items_affected = 0
    if asset_ids:
        async for ins in inspections_collection.find(
                {"station_id": {"$ne": station_id}, "items.asset_id": {"$in": list(asset_ids)}}):
            insp_items_affected += sum(
                1 for it in ins.get("items", []) if str(it.get("asset_id")) in asset_ids)
    return {
        "kind": "station",
        "target": {"id": station_id, "name": station.get("name"), "code": station.get("code")},
        "cascade": {
            "locations": n_locations,
            "assets": n_assets,
            "orange_list_entries": n_ols,
            "remarks": n_remarks,
            "inspections": n_inspections,
            "schedules": n_schedules,
            "inspection_items_in_other_inspections": insp_items_affected,
        },
        "total_dependents": n_locations + n_assets + n_ols + n_remarks
            + n_inspections + n_schedules + insp_items_affected,
    }


async def _preview_user_cascade(uid: str) -> Dict[str, Any]:
    user = await users_collection.find_one({"_id": ObjectId(uid)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    n_repairs = await orange_list_collection.count_documents({"marked_working_by": uid})
    n_approvals = await orange_list_collection.count_documents({"approved_by": uid})
    n_inspections = await inspections_collection.count_documents({"inspector_id": uid})
    n_remarks = await remarks_collection.count_documents({"author_id": uid})
    return {
        "kind": "user",
        "target": {"id": uid, "name": user.get("name"),
                   "employee_id": user.get("employee_id"), "role": user.get("role")},
        "cascade": {
            "ol_entries_marked_working_by_user": n_repairs,
            "ol_entries_approved_by_user": n_approvals,
            "inspections_by_user": n_inspections,
            "remarks_by_user": n_remarks,
            "note": "User refs in OL/inspections are NULL-ed (records kept for audit) instead of deleted.",
        },
        "total_dependents": n_repairs + n_approvals + n_inspections + n_remarks,
    }


# ─── Clean (cascade delete) ───────────────────────────────────────────────
class CleanRequest(BaseModel):
    category: str
    target_ids: Optional[List[str]] = None  # if provided, only these records
    bulk: bool = False  # if True, clean all records in the category


@router.post("/api/data-health/clean/{user_id}")
async def clean(user_id: str, req: CleanRequest):
    actor = await _user_or_403(user_id, require_superadmin=True)
    summary: Dict[str, int] = {}

    if req.category == "orphan_inspection_items":
        summary = await _clean_orphan_inspection_items()
    elif req.category == "orphan_ol_entries":
        summary = await _clean_orphan_ol_entries()
    elif req.category == "orphan_remarks":
        summary = await _clean_orphan_remarks()
    elif req.category == "test_users":
        ids = req.target_ids or await _ids_for_category("test_users")
        summary = await _cascade_delete_users(ids)
    elif req.category == "test_stations":
        ids = req.target_ids or await _ids_for_category("test_stations")
        summary = await _cascade_delete_stations(ids)
    elif req.category == "unnamed_asset_types":
        ids = req.target_ids or await _ids_for_category("unnamed_asset_types")
        summary = await _cascade_delete_asset_types(ids)
    elif req.category == "zero_activity_stations":
        ids = req.target_ids or await _ids_for_category("zero_activity_stations")
        summary = await _cascade_delete_stations(ids)
    elif req.category == "zero_activity_users":
        ids = req.target_ids or await _ids_for_category("zero_activity_users")
        summary = await _cascade_delete_users(ids)
    elif req.category == "duplicates":
        summary = await _clean_duplicates(req.target_ids)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown category: {req.category}")

    # Audit log
    await audit_collection.insert_one({
        "performed_by": user_id,
        "performed_by_name": actor.get("name"),
        "performed_at": now_ist().isoformat(),
        "category": req.category,
        "target_ids": req.target_ids,
        "bulk": req.bulk,
        "summary": summary,
    })
    return {"category": req.category, "summary": summary,
            "performed_at": now_ist().isoformat()}


# ─── Cleaners ─────────────────────────────────────────────────────────────
async def _clean_orphan_inspection_items() -> Dict[str, int]:
    asset_ids = await _all_asset_ids()
    items_removed = 0
    insps_touched = 0
    async for ins in inspections_collection.find({}):
        old = ins.get("items") or []
        kept = [it for it in old if str(it.get("asset_id") or "") in asset_ids]
        if len(kept) != len(old):
            items_removed += len(old) - len(kept)
            insps_touched += 1
            await inspections_collection.update_one(
                {"_id": ins["_id"]}, {"$set": {"items": kept}})
    return {"items_removed": items_removed, "inspections_touched": insps_touched}


async def _clean_orphan_ol_entries() -> Dict[str, int]:
    asset_ids = await _all_asset_ids()
    # Find orphan OLs, capture their ids, delete remarks tied to them, then delete OLs
    orphan_ols = await orange_list_collection.find(
        {"$expr": {"$not": {"$in": [{"$toString": "$asset_id"}, list(asset_ids)]}}}
    ).to_list(50000) if asset_ids else []
    # Fallback simpler logic if the $expr doesn't behave with $toString
    if not orphan_ols:
        all_ols = await orange_list_collection.find({}).to_list(50000)
        orphan_ols = [o for o in all_ols if str(o.get("asset_id") or "") not in asset_ids]
    ol_ids = [str(o["_id"]) for o in orphan_ols]
    n_remarks = (await remarks_collection.delete_many(
        {"orange_list_id": {"$in": ol_ids}})).deleted_count if ol_ids else 0
    n_ols = (await orange_list_collection.delete_many(
        {"_id": {"$in": [o["_id"] for o in orphan_ols]}})).deleted_count if orphan_ols else 0
    return {"orange_list_deleted": n_ols, "remarks_deleted": n_remarks}


async def _clean_orphan_remarks() -> Dict[str, int]:
    ol_ids = {str(o["_id"]) for o in await orange_list_collection.find(
        {}, {"_id": 1}).to_list(50000)}
    remarks = await remarks_collection.find({}).to_list(50000)
    to_del = [r["_id"] for r in remarks
              if r.get("orange_list_id") and str(r["orange_list_id"]) not in ol_ids]
    n = 0
    if to_del:
        n = (await remarks_collection.delete_many({"_id": {"$in": to_del}})).deleted_count
    return {"remarks_deleted": n}


async def _ids_for_category(category: str) -> List[str]:
    if category == "test_users":
        users = await users_collection.find({}).to_list(5000)
        return [str(u["_id"]) for u in users if _is_test_user(u)]
    if category == "test_stations":
        stations = await stations_collection.find({}).to_list(5000)
        return [str(s["_id"]) for s in stations if _is_test_station(s)]
    if category == "unnamed_asset_types":
        types = await asset_types_collection.find(
            {"$or": [{"name": ""}, {"name": None},
                     {"name": {"$regex": r"^\s*$"}}]}, {"_id": 1}).to_list(500)
        return [str(t["_id"]) for t in types]
    if category == "zero_activity_stations":
        out = []
        stations = await stations_collection.find({}).to_list(5000)
        for s in stations:
            sid = str(s["_id"])
            if _is_test_station(s):
                continue
            if await assets_collection.count_documents({"station_id": sid}) == 0 \
               and await inspections_collection.count_documents({"station_id": sid}) == 0 \
               and await schedules_collection.count_documents({"station_id": sid}) == 0:
                out.append(sid)
        return out
    if category == "zero_activity_users":
        out = []
        users = await users_collection.find({}).to_list(5000)
        for u in users:
            if u.get("is_active") is not False:
                continue
            uid = str(u["_id"])
            if await orange_list_collection.count_documents({"marked_working_by": uid}) == 0 \
               and await inspections_collection.count_documents({"inspector_id": uid}) == 0:
                out.append(uid)
        return out
    return []


async def _cascade_delete_stations(station_ids: List[str]) -> Dict[str, int]:
    if not station_ids:
        return {"stations_deleted": 0}
    # Locations under these stations
    locs_under = await locations_collection.find(
        {"station_id": {"$in": station_ids}}, {"_id": 1}).to_list(20000)
    # Assets under these stations
    assets_under = await assets_collection.find(
        {"station_id": {"$in": station_ids}}, {"_id": 1}).to_list(20000)
    asset_ids = [str(a["_id"]) for a in assets_under]
    # OL entries
    ol_under = await orange_list_collection.find(
        {"asset_id": {"$in": asset_ids}}, {"_id": 1}).to_list(50000) if asset_ids else []
    ol_ids = [str(o["_id"]) for o in ol_under]
    # Remarks under those OLs
    n_remarks = (await remarks_collection.delete_many(
        {"orange_list_id": {"$in": ol_ids}})).deleted_count if ol_ids else 0
    n_ols = (await orange_list_collection.delete_many(
        {"_id": {"$in": [o["_id"] for o in ol_under]}})).deleted_count if ol_under else 0
    # Inspections at these stations + strip items[] in OTHER inspections that ref these assets
    n_insp = (await inspections_collection.delete_many(
        {"station_id": {"$in": station_ids}})).deleted_count
    items_stripped = 0
    if asset_ids:
        async for ins in inspections_collection.find(
                {"items.asset_id": {"$in": asset_ids}}):
            old = ins.get("items") or []
            kept = [it for it in old if str(it.get("asset_id") or "") not in asset_ids]
            if len(kept) != len(old):
                items_stripped += len(old) - len(kept)
                await inspections_collection.update_one(
                    {"_id": ins["_id"]}, {"$set": {"items": kept}})
    n_sched = (await schedules_collection.delete_many(
        {"station_id": {"$in": station_ids}})).deleted_count
    n_assets = (await assets_collection.delete_many(
        {"_id": {"$in": [a["_id"] for a in assets_under]}})).deleted_count if assets_under else 0
    n_locs = (await locations_collection.delete_many(
        {"_id": {"$in": [l["_id"] for l in locs_under]}})).deleted_count if locs_under else 0
    n_stations = (await stations_collection.delete_many(
        {"_id": {"$in": [ObjectId(s) for s in station_ids]}})).deleted_count
    # Strip station_id from any users that had it assigned
    await users_collection.update_many(
        {"assigned_stations": {"$in": station_ids}},
        {"$pull": {"assigned_stations": {"$in": station_ids}}})
    return {
        "stations_deleted": n_stations,
        "locations_deleted": n_locs,
        "assets_deleted": n_assets,
        "orange_list_deleted": n_ols,
        "remarks_deleted": n_remarks,
        "inspections_deleted": n_insp,
        "inspection_items_stripped_elsewhere": items_stripped,
        "schedules_deleted": n_sched,
    }


async def _cascade_delete_users(user_ids: List[str]) -> Dict[str, int]:
    if not user_ids:
        return {"users_deleted": 0}
    # NULL out user refs in OL/inspections (keep records for audit)
    n_ol_refs = (await orange_list_collection.update_many(
        {"marked_working_by": {"$in": user_ids}},
        {"$set": {"marked_working_by_deleted_at": now_ist().isoformat()},
         "$unset": {"marked_working_by": ""}})).modified_count
    n_appr_refs = (await orange_list_collection.update_many(
        {"approved_by": {"$in": user_ids}},
        {"$set": {"approved_by_deleted_at": now_ist().isoformat()},
         "$unset": {"approved_by": ""}})).modified_count
    n_insp_refs = (await inspections_collection.update_many(
        {"inspector_id": {"$in": user_ids}},
        {"$set": {"inspector_id_deleted_at": now_ist().isoformat()}})).modified_count
    n_users = (await users_collection.delete_many(
        {"_id": {"$in": [ObjectId(u) for u in user_ids]}})).deleted_count
    return {
        "users_deleted": n_users,
        "ol_refs_nulled": n_ol_refs,
        "approval_refs_nulled": n_appr_refs,
        "inspection_refs_kept_with_marker": n_insp_refs,
    }


async def _cascade_delete_asset_types(type_ids: List[str]) -> Dict[str, int]:
    if not type_ids:
        return {"asset_types_deleted": 0}
    # Refuse if any active assets reference them (safer than orphaning)
    in_use = await assets_collection.count_documents({"asset_type_id": {"$in": type_ids}})
    if in_use:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete: {in_use} asset(s) reference these types. "
                   "Rename the asset-types instead (in Admin → Asset Types).")
    n = (await asset_types_collection.delete_many(
        {"_id": {"$in": [ObjectId(t) for t in type_ids]}})).deleted_count
    return {"asset_types_deleted": n}


async def _clean_duplicates(target_ids: Optional[List[str]]) -> Dict[str, int]:
    """If target_ids provided, delete just those (one of the duplicate set).
    Without target_ids, we DON'T auto-pick — user must specify."""
    if not target_ids:
        return {"deleted": 0, "note": "Specify target_ids to clean duplicates safely"}
    # Try as user IDs first
    user_match = await users_collection.delete_many(
        {"_id": {"$in": [ObjectId(t) for t in target_ids]}})
    asset_match = await assets_collection.delete_many(
        {"_id": {"$in": [ObjectId(t) for t in target_ids]}})
    return {"users_deleted": user_match.deleted_count,
            "assets_deleted": asset_match.deleted_count}


# ─── Audit log ────────────────────────────────────────────────────────────
@router.get("/api/data-health/audit/{user_id}")
async def audit_log(user_id: str, limit: int = Query(50, le=200)):
    await _user_or_403(user_id)
    cur = audit_collection.find({}, sort=[("performed_at", -1)]).limit(limit)
    rows = []
    async for r in cur:
        r["_id"] = str(r["_id"])
        rows.append(r)
    return {"rows": rows}
