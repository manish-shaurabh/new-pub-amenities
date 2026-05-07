from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from bson import ObjectId
import io
import os
import uuid

from database import (
    serialize_doc,
    departments_collection, stations_collection, locations_collection,
    asset_types_collection, assets_collection, users_collection,
    inspections_collection, orange_list_collection, notifications_collection,
    schedules_collection, audit_log_collection,
)
from models import (
    DepartmentCreate, StationCreate, LocationCreate,
    AssetTypeCreate, AssetCreate, UserCreate, UserLogin,
    InspectionCreate, InspectionItemStatus,
    OrangeListCreate, MarkWorkingRequest, ApproveWorkingRequest,
    NotificationCreate, ScheduleCreate, ScheduleFrequency,
    UserRole, AssetStatus, OrangeListStatus,
)

router = APIRouter()
from helpers import _classify_health, _compute_asset_metrics, _open_ol_entry, RED_THRESHOLD_HOURS


# ============ DASHBOARD ============
# Change 6: Enhanced dashboard with station-wise and asset-wise data
@router.get("/api/dashboard/stats")
async def get_dashboard_stats():
    total_assets = await assets_collection.count_documents({})
    working_assets = await assets_collection.count_documents({"status": AssetStatus.WORKING.value})
    defective_assets = await assets_collection.count_documents({"status": {"$ne": AssetStatus.WORKING.value}})
    
    now = datetime.utcnow()
    
    # Orange list (< 24 hrs) and Red list (> 24 hrs).
    # Only count entries with status=defective; pending_approval (yellow) is counted separately.
    all_defective = await orange_list_collection.find({"status": OrangeListStatus.DEFECTIVE.value}).to_list(5000)
    orange_count = 0
    red_count = 0
    for item in all_defective:
        defective_since = item.get("defective_since") or item.get("created_at")
        if isinstance(defective_since, datetime):
            hours = (now - defective_since).total_seconds() / 3600
        else:
            hours = 0
        if hours > 24:
            red_count += 1
        else:
            orange_count += 1
    
    pending_approvals = await orange_list_collection.count_documents({"status": OrangeListStatus.PENDING_APPROVAL.value})
    total_inspections = await inspections_collection.count_documents({})
    overdue_count = await schedules_collection.count_documents({"next_due": {"$lt": now}})
    total_users = await users_collection.count_documents({})
    total_stations = await stations_collection.count_documents({})
    
    return {
        "total_assets": total_assets,
        "working_assets": working_assets,
        "defective_assets": defective_assets,
        "orange_list_count": orange_count,
        "red_list_count": red_count,
        "pending_approvals": pending_approvals,
        "total_inspections": total_inspections,
        "overdue_count": overdue_count,
        "total_users": total_users,
        "total_stations": total_stations
    }


# Change 6: Station-wise health data for charts
@router.get("/api/dashboard/station-health")
async def get_station_health():
    stations = await stations_collection.find().to_list(1000)
    result = []
    for station in stations:
        station_id = str(station["_id"])
        total = await assets_collection.count_documents({"station_id": station_id})
        working = await assets_collection.count_documents({"station_id": station_id, "status": "working"})
        defective = total - working
        result.append({
            "station_name": station["name"],
            "station_id": station_id,
            "total": total,
            "working": working,
            "defective": defective,
            "health_pct": round((working / total * 100) if total > 0 else 100, 1)
        })
    return result


# Change 6: Asset type health data for charts
@router.get("/api/dashboard/asset-type-health")
async def get_asset_type_health():
    asset_types = await asset_types_collection.find().to_list(1000)
    result = []
    for at in asset_types:
        at_id = str(at["_id"])
        total = await assets_collection.count_documents({"asset_type_id": at_id})
        working = await assets_collection.count_documents({"asset_type_id": at_id, "status": "working"})
        defective = total - working
        result.append({
            "asset_type_name": at["name"],
            "asset_type_id": at_id,
            "total": total,
            "working": working,
            "defective": defective,
            "health_pct": round((working / total * 100) if total > 0 else 100, 1)
        })
    return result


@router.get("/api/dashboard/recent-inspections")
async def get_recent_inspections(limit: int = 10):
    docs = await inspections_collection.find().sort("created_at", -1).to_list(limit)
    station_ids = list(set(d["station_id"] for d in docs if d.get("station_id")))
    stations_map = {}
    if station_ids:
        stations_docs = await stations_collection.find({"_id": {"$in": [ObjectId(sid) for sid in station_ids]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in stations_docs}
    for doc in docs:
        doc["station_name"] = stations_map.get(doc["station_id"], "Unknown")
    return [serialize_doc(d) for d in docs]

@router.get("/api/dashboard/supervisor/{user_id}")
async def supervisor_dashboard(user_id: str, station_id: Optional[str] = None):
    """Dashboard payload for a supervisor: per-category buttons + health pie data
    scoped to assets allocated to them. Optional station_id filter."""
    try:
        user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Implicit station + department scoping (Phase 1)
    dept_id = user.get("department_id")
    sup_stations = list(user.get("assigned_stations") or [])
    sup_type_ids_for_query = []
    if dept_id:
        _tdocs = await asset_types_collection.find({"department_id": dept_id}, {"_id": 1}).to_list(2000)
        sup_type_ids_for_query = [str(t["_id"]) for t in _tdocs]

    if sup_stations and sup_type_ids_for_query:
        asset_query = {"station_id": {"$in": sup_stations}, "asset_type_id": {"$in": sup_type_ids_for_query}}
        if station_id:
            asset_query["station_id"] = station_id
    else:
        asset_query = {"_id": None}
    assets = await assets_collection.find(asset_query).to_list(5000)

    type_ids = list({a.get("asset_type_id") for a in assets if a.get("asset_type_id")})
    station_ids_seen = list({a.get("station_id") for a in assets if a.get("station_id")})
    types_map = {}
    if type_ids:
        td = await asset_types_collection.find({"_id": {"$in": [ObjectId(t) for t in type_ids]}}).to_list(1000)
        types_map = {str(t["_id"]): t["name"] for t in td}
    stations_map = {}
    if station_ids_seen:
        sd = await stations_collection.find({"_id": {"$in": [ObjectId(s) for s in station_ids_seen]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in sd}
    department_name = None
    if user.get("department_id"):
        dept = await departments_collection.find_one({"_id": ObjectId(user["department_id"])})
        department_name = dept["name"] if dept else None

    # Build the user's available stations list (for dropdown). Use assigned_stations
    user_stations = []
    user_station_ids = user.get("assigned_stations") or []
    if user_station_ids:
        ud = await stations_collection.find({"_id": {"$in": [ObjectId(s) for s in user_station_ids]}}).to_list(100)
        user_stations = [{"_id": str(s["_id"]), "name": s.get("name")} for s in ud]

    now = datetime.utcnow()
    grouped: dict = {}
    health_counts = {"working": 0, "orange": 0, "red": 0, "yellow": 0}

    # Pre-fetch orange list history for asset uptime computation
    asset_id_strs = [str(a["_id"]) for a in assets]
    history_docs = []
    if asset_id_strs:
        history_docs = await orange_list_collection.find({"asset_id": {"$in": asset_id_strs}}).to_list(20000)
    history_by_asset: dict = {}
    for rec in history_docs:
        history_by_asset.setdefault(rec["asset_id"], []).append(rec)

    for asset in assets:
        type_id = asset.get("asset_type_id") or "unknown"
        type_name = types_map.get(type_id, "Unknown")
        asset_history = history_by_asset.get(str(asset["_id"]), [])
        cls = _classify_health(asset, now, _open_ol_entry(asset_history))
        health_counts[cls] += 1
        bucket = grouped.setdefault(type_id, {
            "asset_type_id": type_id,
            "asset_type_name": type_name,
            "asset_count": 0,
            "working": 0, "orange": 0, "red": 0, "yellow": 0,
            "_pct_sum": 0.0,
        })
        bucket["asset_count"] += 1
        bucket[cls] += 1
        m = _compute_asset_metrics(asset, asset_history, now)
        bucket["_pct_sum"] += m["pct_functional"]

    for c in grouped.values():
        c["pct_functional"] = round(c["_pct_sum"] / c["asset_count"], 2) if c["asset_count"] else 100.0
        c.pop("_pct_sum", None)

    categories = sorted(grouped.values(), key=lambda c: c["asset_type_name"])
    return {
        "user_id": user_id,
        "user_name": user.get("name"),
        "department_id": user.get("department_id"),
        "department_name": department_name,
        "available_stations": user_stations,
        "selected_station_id": station_id,
        "total_assets": len(assets),
        "health": health_counts,
        "categories": categories,
    }


@router.get("/api/dashboard/supervisor/{user_id}/my-tasks")
async def supervisor_my_tasks(user_id: str, station_id: Optional[str] = None):
    """Returns asset lists for a supervisor's My Tasks page:
    - my_assets: every allocated asset
    - pending_tasks: assets currently NOT in working condition, grouped by category
    """
    try:
        user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Implicit station + department scoping (Phase 1)
    dept_id_t = user.get("department_id")
    sup_stations_t = list(user.get("assigned_stations") or [])
    sup_type_ids_t = []
    if dept_id_t:
        _td2 = await asset_types_collection.find({"department_id": dept_id_t}, {"_id": 1}).to_list(2000)
        sup_type_ids_t = [str(t["_id"]) for t in _td2]

    if sup_stations_t and sup_type_ids_t:
        task_query = {"station_id": {"$in": sup_stations_t}, "asset_type_id": {"$in": sup_type_ids_t}}
        if station_id:
            task_query["station_id"] = station_id
    else:
        task_query = {"_id": None}
    assets = await assets_collection.find(task_query).to_list(5000)

    type_ids = list({a.get("asset_type_id") for a in assets if a.get("asset_type_id")})
    station_ids_seen = list({a.get("station_id") for a in assets if a.get("station_id")})
    location_ids_seen = list({a.get("location_id") for a in assets if a.get("location_id")})
    types_map = {}
    if type_ids:
        td = await asset_types_collection.find({"_id": {"$in": [ObjectId(t) for t in type_ids]}}).to_list(1000)
        types_map = {str(t["_id"]): t["name"] for t in td}
    stations_map = {}
    if station_ids_seen:
        sd = await stations_collection.find({"_id": {"$in": [ObjectId(s) for s in station_ids_seen]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in sd}
    locations_map = {}
    if location_ids_seen:
        ld = await locations_collection.find({"_id": {"$in": [ObjectId(l) for l in location_ids_seen]}}).to_list(1000)
        locations_map = {str(loc["_id"]): loc["name"] for loc in ld}

    # Pre-fetch OL entries for these assets so health classification uses
    # the canonical defective_since from the orange-list collection.
    ol_history_by_asset: dict = {}
    if assets:
        for rec in await orange_list_collection.find(
            {"asset_id": {"$in": [str(a["_id"]) for a in assets]}}
        ).to_list(20000):
            ol_history_by_asset.setdefault(rec["asset_id"], []).append(rec)

    now = datetime.utcnow()
    by_category: dict = {}
    pending_by_category: dict = {}

    for asset in assets:
        type_id = asset.get("asset_type_id") or "unknown"
        type_name = types_map.get(type_id, "Unknown")
        open_ol = _open_ol_entry(ol_history_by_asset.get(str(asset["_id"]), []))
        cls = _classify_health(asset, now, open_ol)
        canonical_ds = open_ol.get("defective_since") or asset.get("defective_since")
        item = {
            "_id": str(asset["_id"]),
            "asset_number": asset.get("asset_number"),
            "station_name": stations_map.get(asset.get("station_id"), "Unknown"),
            "location_name": locations_map.get(asset.get("location_id"), "Unknown"),
            "status": asset.get("status", "working"),
            "health_class": cls,
            "defective_since": canonical_ds.isoformat() if isinstance(canonical_ds, datetime) else canonical_ds,
            "asset_type_id": type_id,
            "asset_type_name": type_name,
        }
        by_category.setdefault(type_id, {"asset_type_id": type_id, "asset_type_name": type_name, "assets": []})["assets"].append(item)
        if cls != "working":
            pending_by_category.setdefault(type_id, {"asset_type_id": type_id, "asset_type_name": type_name, "assets": []})["assets"].append(item)

    by_category_list = sorted(by_category.values(), key=lambda c: c["asset_type_name"])
    pending_list = sorted(pending_by_category.values(), key=lambda c: c["asset_type_name"])
    for c in by_category_list:
        c["asset_count"] = len(c["assets"])
    for c in pending_list:
        c["asset_count"] = len(c["assets"])

    return {
        "user_id": user_id,
        "user_name": user.get("name"),
        "selected_station_id": station_id,
        "my_assets": by_category_list,
        "pending_tasks": pending_list,
        "totals": {
            "total": sum(c["asset_count"] for c in by_category_list),
            "pending": sum(c["asset_count"] for c in pending_list),
        },
    }


# ===== Approving Supervisor / Reporting Officer Dashboard =====
async def _build_oversight_dashboard(
    *,
    target_user: dict,
    station_filter_ids: Optional[List[str]],
    department_filter_id: Optional[str],
    extra_asset_query: Optional[dict] = None,
):
    """Shared helper for ASUP and RO dashboards.

    Scope rules applied by caller:
      - ASUP: station_filter_ids = ASUP's assigned_stations; department_filter_id is optional UI filter
      - RO:   station_filter_ids = RO's assigned_stations; department_filter_id = RO's department (always)
    """
    if not station_filter_ids:
        return {
            "user_id": str(target_user["_id"]),
            "user_name": target_user.get("name"),
            "available_stations": [],
            "available_departments": [],
            "selected_station_id": None,
            "selected_department_id": department_filter_id,
            "total_assets": 0,
            "health": {"working": 0, "orange": 0, "red": 0, "yellow": 0},
            "categories": [],
            "stations": [],
        }

    # If a single station was selected, narrow to it
    asset_query: dict = {"station_id": {"$in": station_filter_ids}}
    if extra_asset_query:
        asset_query.update(extra_asset_query)

    # Department filter -> filter by asset_type.department_id
    type_filter_ids = None
    if department_filter_id:
        types_in_dept = await asset_types_collection.find(
            {"department_id": department_filter_id}
        ).to_list(1000)
        type_filter_ids = [str(t["_id"]) for t in types_in_dept]
        if not type_filter_ids:
            type_filter_ids = ["__none__"]
        asset_query["asset_type_id"] = {"$in": type_filter_ids}

    assets = await assets_collection.find(asset_query).to_list(20000)

    # Lookups
    type_ids = list({a.get("asset_type_id") for a in assets if a.get("asset_type_id")})
    types_map = {}
    if type_ids:
        td = await asset_types_collection.find(
            {"_id": {"$in": [ObjectId(t) for t in type_ids]}}
        ).to_list(1000)
        types_map = {str(t["_id"]): t for t in td}
    sd = await stations_collection.find(
        {"_id": {"$in": [ObjectId(s) for s in station_filter_ids]}}
    ).to_list(1000)
    stations_map = {str(s["_id"]): s for s in sd}
    available_stations = [{"_id": str(s["_id"]), "name": s.get("name")} for s in sd]

    # Available departments: those that have at least one asset type
    dept_ids_in_scope = list({
        types_map.get(a.get("asset_type_id"), {}).get("department_id")
        for a in assets
    })
    dept_ids_in_scope = [d for d in dept_ids_in_scope if d]
    available_departments = []
    if dept_ids_in_scope:
        dd = await departments_collection.find(
            {"_id": {"$in": [ObjectId(d) for d in dept_ids_in_scope]}}
        ).to_list(100)
        available_departments = [{"_id": str(d["_id"]), "name": d.get("name")} for d in dd]
        available_departments.sort(key=lambda x: x["name"] or "")

    now = datetime.utcnow()
    health = {"working": 0, "orange": 0, "red": 0, "yellow": 0}
    by_category: dict = {}
    by_station: dict = {}

    # Pre-fetch orange list history for uptime
    asset_id_strs = [str(a["_id"]) for a in assets]
    history_docs = []
    if asset_id_strs:
        history_docs = await orange_list_collection.find({"asset_id": {"$in": asset_id_strs}}).to_list(20000)
    history_by_asset: dict = {}
    for rec in history_docs:
        history_by_asset.setdefault(rec["asset_id"], []).append(rec)

    for a in assets:
        asset_history = history_by_asset.get(str(a["_id"]), [])
        open_ol = _open_ol_entry(asset_history)
        cls = _classify_health(a, now, open_ol)
        health[cls] += 1

        type_id = a.get("asset_type_id") or "unknown"
        type_name = types_map.get(type_id, {}).get("name", "Unknown")
        c = by_category.setdefault(type_id, {
            "asset_type_id": type_id, "asset_type_name": type_name,
            "asset_count": 0, "working": 0, "orange": 0, "red": 0, "yellow": 0, "_pct_sum": 0.0,
        })
        c["asset_count"] += 1
        c[cls] += 1
        m = _compute_asset_metrics(a, asset_history, now)
        c["_pct_sum"] += m["pct_functional"]

        sid = a.get("station_id") or "unknown"
        s_name = stations_map.get(sid, {}).get("name", "Unknown")
        s = by_station.setdefault(sid, {
            "station_id": sid, "station_name": s_name,
            "asset_count": 0, "working": 0, "orange": 0, "red": 0, "yellow": 0,
            "categories": {},  # nested
        })
        s["asset_count"] += 1
        s[cls] += 1

        # Per-category nested per-station
        sc = s["categories"].setdefault(type_id, {
            "asset_type_id": type_id, "asset_type_name": type_name,
            "asset_count": 0, "working": 0, "orange": 0, "red": 0, "yellow": 0,
            "assets": [],
        })
        sc["asset_count"] += 1
        sc[cls] += 1
        canonical_ds = open_ol.get("defective_since") or a.get("defective_since")
        sc["assets"].append({
            "_id": str(a["_id"]),
            "asset_number": a.get("asset_number"),
            "status": a.get("status", "working"),
            "health_class": cls,
            "defective_since": canonical_ds.isoformat() if isinstance(canonical_ds, datetime) else canonical_ds,
        })

    # Compute per-station % functional based on health (simple score)
    stations_out = []
    for s in by_station.values():
        total = max(1, s["asset_count"])
        pct = round((s["working"] / total) * 100, 2)
        s["pct_functional"] = pct
        s["categories"] = sorted(s["categories"].values(), key=lambda c: c["asset_type_name"])
        stations_out.append(s)
    stations_out.sort(key=lambda s: s["station_name"] or "")

    # Finalize category pct_functional
    for c in by_category.values():
        c["pct_functional"] = round(c["_pct_sum"] / c["asset_count"], 2) if c["asset_count"] else 100.0
        c.pop("_pct_sum", None)

    categories_out = sorted(by_category.values(), key=lambda c: c["asset_type_name"])

    return {
        "user_id": str(target_user["_id"]),
        "user_name": target_user.get("name"),
        "available_stations": available_stations,
        "available_departments": available_departments,
        "selected_station_id": None,
        "selected_department_id": department_filter_id,
        "total_assets": len(assets),
        "health": health,
        "categories": categories_out,
        "stations": stations_out,
    }


@router.get("/api/dashboard/approving-supervisor/{user_id}")
async def approving_supervisor_dashboard(
    user_id: str,
    station_id: Optional[str] = None,
    department_id: Optional[str] = None,
):
    try:
        user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # ASUP scope: their assigned_stations
    station_ids = list(user.get("assigned_stations") or [])
    if station_id:
        if station_id not in station_ids:
            raise HTTPException(status_code=403, detail="Station not in your scope")
        station_ids = [station_id]
    return await _build_oversight_dashboard(
        target_user=user,
        station_filter_ids=station_ids,
        department_filter_id=department_id,
    )


@router.get("/api/dashboard/reporting-officer/{user_id}")
async def reporting_officer_dashboard(
    user_id: str,
    station_id: Optional[str] = None,
):
    try:
        user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # RO scope: their assigned_stations + their department (always)
    station_ids = list(user.get("assigned_stations") or [])
    if station_id:
        if station_id not in station_ids:
            raise HTTPException(status_code=403, detail="Station not in your scope")
        station_ids = [station_id]

    dept_id = user.get("department_id")
    payload = await _build_oversight_dashboard(
        target_user=user,
        station_filter_ids=station_ids,
        department_filter_id=dept_id,
    )
    payload["scope_locked_department"] = True
    payload["department_id"] = dept_id

    # Also include supervisors who report to this RO (for "My Supervisors" view)
    sup_docs = await users_collection.find({
        "role": UserRole.SUPERVISOR.value,
        "is_active": True,
        "reports_to_id": user_id,
    }).to_list(1000)
    payload["my_supervisors_ids"] = [str(s["_id"]) for s in sup_docs]
    payload["my_supervisors"] = [{
        "_id": str(s["_id"]), "name": s.get("name"),
        "employee_id": s.get("employee_id"),
        "assigned_stations": s.get("assigned_stations", []),
    } for s in sup_docs]
    return payload


# ===== Superadmin Dashboard (drill-down summaries) =====
@router.get("/api/dashboard/superadmin")
async def superadmin_full_dashboard(
    station_ids: Optional[List[str]] = Query(None),
):
    """Returns rich summary blocks for the redesigned Superadmin home, optionally
    scoped to one or more stations.

    Blocks returned:
      - totals (counts), health (overall)
      - asset_categories (with pct_functional)
      - stations (with pct_functional) [unaffected by station_ids; full master list]
      - departments (with health + pct_functional)  [renamed from divisions, alias kept]
      - reporting_officers, approving_supervisors, supervisors
      - available_stations (for the station multi-select)
    """
    now = datetime.utcnow()

    asset_query = {}
    if station_ids:
        asset_query["station_id"] = {"$in": station_ids}

    all_assets = await assets_collection.find(asset_query).to_list(50000)
    types_docs = await asset_types_collection.find({}).to_list(2000)
    stations_docs = await stations_collection.find({}).to_list(2000)
    departments_docs = await departments_collection.find({}).to_list(2000)
    users_docs = await users_collection.find({"is_active": True}).to_list(5000)

    types_map = {str(t["_id"]): t for t in types_docs}
    stations_map = {str(s["_id"]): s for s in stations_docs}
    departments_map = {str(d["_id"]): d for d in departments_docs}

    # Pre-fetch orange list history once for pct_functional computation
    asset_id_strs = [str(a["_id"]) for a in all_assets]
    history_docs = []
    if asset_id_strs:
        history_docs = await orange_list_collection.find(
            {"asset_id": {"$in": asset_id_strs}}
        ).to_list(50000)
    history_by_asset: dict = {}
    for rec in history_docs:
        history_by_asset.setdefault(rec["asset_id"], []).append(rec)

    # Pre-classify health and per-asset metrics once
    classed = []  # (asset, cls, metrics, open_ol)
    for a in all_assets:
        asset_history = history_by_asset.get(str(a["_id"]), [])
        open_ol = _open_ol_entry(asset_history)
        cls = _classify_health(a, now, open_ol)
        m = _compute_asset_metrics(a, asset_history, now)
        classed.append((a, cls, m, open_ol))

    # ---- asset_categories (with pct_functional)
    cat_acc: dict = {}
    for (a, cls, m, _) in classed:
        type_id = a.get("asset_type_id") or "unknown"
        type_info = types_map.get(type_id, {})
        type_name = type_info.get("name", "Unknown")
        c = cat_acc.setdefault(type_id, {
            "_id": type_id, "name": type_name,
            "asset_type_id": type_id, "asset_type_name": type_name,
            "department_id": type_info.get("department_id"),
            "asset_count": 0, "working": 0, "orange": 0, "red": 0, "yellow": 0,
            "_pct_sum": 0.0,
        })
        c["asset_count"] += 1
        c[cls] += 1
        c["_pct_sum"] += m["pct_functional"]
    for c in cat_acc.values():
        c["pct_functional"] = round(c["_pct_sum"] / c["asset_count"], 2) if c["asset_count"] else 100.0
        c.pop("_pct_sum", None)
    asset_categories = sorted(cat_acc.values(), key=lambda x: x["name"] or "")

    # ---- stations (with pct_functional)
    station_acc: dict = {}
    for (a, cls, m, _open_ol) in classed:
        sid = a.get("station_id") or "unknown"
        s_info = stations_map.get(sid, {})
        s = station_acc.setdefault(sid, {
            "_id": sid, "name": s_info.get("name", "Unknown"),
            "asset_count": 0, "working": 0, "orange": 0, "red": 0, "yellow": 0,
            "_pct_sum": 0.0,
            "approving_supervisor_id": s_info.get("approving_supervisor_id"),
        })
        s["asset_count"] += 1
        s[cls] += 1
        s["_pct_sum"] += m["pct_functional"]
    # Include stations with no assets in scope
    for sid_str, s_info in stations_map.items():
        if station_ids and sid_str not in station_ids:
            continue
        if sid_str not in station_acc:
            station_acc[sid_str] = {
                "_id": sid_str, "name": s_info.get("name", "Unknown"),
                "asset_count": 0, "working": 0, "orange": 0, "red": 0, "yellow": 0,
                "_pct_sum": 0.0,
                "approving_supervisor_id": s_info.get("approving_supervisor_id"),
            }
    for s in station_acc.values():
        s["pct_functional"] = round(s["_pct_sum"] / s["asset_count"], 2) if s["asset_count"] else 100.0
        s.pop("_pct_sum", None)
    stations_out = sorted(station_acc.values(), key=lambda x: x["name"] or "")

    # ---- departments (with health + pct_functional)
    dept_acc: dict = {}
    for (a, cls, m, _open_ol) in classed:
        type_info = types_map.get(a.get("asset_type_id"), {})
        dept_id = type_info.get("department_id") or "unknown"
        d_info = departments_map.get(dept_id, {})
        d = dept_acc.setdefault(dept_id, {
            "_id": dept_id, "name": d_info.get("name", "Unknown"),
            "asset_count": 0, "working": 0, "orange": 0, "red": 0, "yellow": 0,
            "_pct_sum": 0.0,
        })
        d["asset_count"] += 1
        d[cls] += 1
        d["_pct_sum"] += m["pct_functional"]
    for did_str, d_info in departments_map.items():
        if did_str not in dept_acc:
            dept_acc[did_str] = {
                "_id": did_str, "name": d_info.get("name", "Unknown"),
                "asset_count": 0, "working": 0, "orange": 0, "red": 0, "yellow": 0,
                "_pct_sum": 0.0,
            }
    for d in dept_acc.values():
        d["pct_functional"] = round(d["_pct_sum"] / d["asset_count"], 2) if d["asset_count"] else 100.0
        d.pop("_pct_sum", None)
    departments_out = sorted(dept_acc.values(), key=lambda x: x["name"] or "")

    # ---- reporting officers
    reporting_officers = []
    for u in users_docs:
        if u.get("role") != UserRole.REPORTING_OFFICER.value:
            continue
        sup_count = await users_collection.count_documents({
            "role": UserRole.SUPERVISOR.value, "reports_to_id": str(u["_id"])
        })
        dept_name = departments_map.get(u.get("department_id"), {}).get("name") if u.get("department_id") else None
        reporting_officers.append({
            "_id": str(u["_id"]),
            "name": u.get("name"),
            "employee_id": u.get("employee_id"),
            "department_id": u.get("department_id"),
            "department_name": dept_name,
            "assigned_stations": u.get("assigned_stations") or [],
            "assigned_stations_count": len(u.get("assigned_stations") or []),
            "supervisors_count": sup_count,
        })
    reporting_officers.sort(key=lambda x: x["name"] or "")

    # ---- approving supervisors
    approving_supervisors = []
    for u in users_docs:
        if u.get("role") != UserRole.APPROVING_SUPERVISOR.value:
            continue
        approving_supervisors.append({
            "_id": str(u["_id"]),
            "name": u.get("name"),
            "employee_id": u.get("employee_id"),
            "assigned_stations": u.get("assigned_stations") or [],
            "assigned_stations_count": len(u.get("assigned_stations") or []),
        })
    approving_supervisors.sort(key=lambda x: x["name"] or "")

    # ---- supervisors (with assigned asset counts within current scope)
    supervisors_out = []
    sup_users = [u for u in users_docs if u.get("role") == UserRole.SUPERVISOR.value]
    if sup_users:
        # Map supervisor -> asset_count within current asset_query scope
        sup_count_pipeline_match = {"assigned_supervisor_id": {"$ne": None}}
        if station_ids:
            sup_count_pipeline_match["station_id"] = {"$in": station_ids}
        sup_count_cursor = assets_collection.aggregate([
            {"$match": sup_count_pipeline_match},
            {"$group": {"_id": "$assigned_supervisor_id", "count": {"$sum": 1}}},
        ])
        sup_count_map = {d["_id"]: d["count"] async for d in sup_count_cursor}
        for u in sup_users:
            uid = str(u["_id"])
            dept_name = departments_map.get(u.get("department_id"), {}).get("name") if u.get("department_id") else None
            supervisors_out.append({
                "_id": uid,
                "name": u.get("name"),
                "employee_id": u.get("employee_id"),
                "department_id": u.get("department_id"),
                "department_name": dept_name,
                "assigned_stations": u.get("assigned_stations") or [],
                "assigned_stations_count": len(u.get("assigned_stations") or []),
                "asset_count": sup_count_map.get(uid, 0),
            })
        supervisors_out.sort(key=lambda x: x["name"] or "")

    health = {
        "working": sum(1 for (_, c, _, _) in classed if c == "working"),
        "orange":  sum(1 for (_, c, _, _) in classed if c == "orange"),
        "red":     sum(1 for (_, c, _, _) in classed if c == "red"),
        "yellow":  sum(1 for (_, c, _, _) in classed if c == "yellow"),
    }

    available_stations = [{"_id": str(s["_id"]), "name": s.get("name")} for s in stations_docs]
    available_stations.sort(key=lambda x: x["name"] or "")

    return {
        "totals": {
            "assets": len(all_assets),
            "stations": len(stations_docs),
            "departments": len(departments_docs),
            "asset_categories": len(types_docs),
            "reporting_officers": len(reporting_officers),
            "approving_supervisors": len(approving_supervisors),
            "supervisors": len(supervisors_out),
        },
        "health": health,
        "filters_applied": {"stations": station_ids or []},
        "available_stations": available_stations,
        "asset_categories": asset_categories,
        "stations": stations_out,
        "departments": departments_out,
        # Backwards-compat alias used by older frontend code:
        "divisions": departments_out,
        "reporting_officers": reporting_officers,
        "approving_supervisors": approving_supervisors,
        "supervisors": supervisors_out,
    }


@router.get("/api/dashboard/admin")
async def admin_full_dashboard(
    station_ids: Optional[List[str]] = Query(None),
    department_ids: Optional[List[str]] = Query(None),
    reporting_officer_ids: Optional[List[str]] = Query(None),
):
    """Admin dashboard — same structure as superadmin but with dept + RO filters."""
    now = datetime.utcnow()

    # Build asset query with optional station + department filters
    asset_query: dict = {}
    if station_ids:
        asset_query["station_id"] = {"$in": station_ids}
    if department_ids:
        type_docs_for_dept = await asset_types_collection.find(
            {"department_id": {"$in": department_ids}}, {"_id": 1}
        ).to_list(2000)
        dept_type_ids = [str(t["_id"]) for t in type_docs_for_dept]
        if not dept_type_ids:
            dept_type_ids = ["__no_match__"]
        asset_query["asset_type_id"] = {"$in": dept_type_ids}

    all_assets = await assets_collection.find(asset_query).to_list(50000)
    types_docs = await asset_types_collection.find({}).to_list(2000)
    stations_docs = await stations_collection.find({}).to_list(2000)
    departments_docs = await departments_collection.find({}).to_list(2000)
    users_docs = await users_collection.find({"is_active": True}).to_list(5000)

    types_map = {str(t["_id"]): t for t in types_docs}
    stations_map = {str(s["_id"]): s for s in stations_docs}
    departments_map = {str(d["_id"]): d for d in departments_docs}

    asset_id_strs = [str(a["_id"]) for a in all_assets]
    history_docs = []
    if asset_id_strs:
        history_docs = await orange_list_collection.find(
            {"asset_id": {"$in": asset_id_strs}}
        ).to_list(50000)
    history_by_asset: dict = {}
    for rec in history_docs:
        history_by_asset.setdefault(rec["asset_id"], []).append(rec)

    classed = []
    for a in all_assets:
        asset_history = history_by_asset.get(str(a["_id"]), [])
        open_ol = _open_ol_entry(asset_history)
        cls = _classify_health(a, now, open_ol)
        m = _compute_asset_metrics(a, asset_history, now)
        classed.append((a, cls, m, open_ol))

    # Asset categories
    cat_acc: dict = {}
    for (a, cls, m, _open_ol) in classed:
        type_id = a.get("asset_type_id") or "unknown"
        type_info = types_map.get(type_id, {})
        type_name = type_info.get("name", "Unknown")
        c = cat_acc.setdefault(type_id, {
            "_id": type_id, "name": type_name,
            "asset_type_id": type_id, "asset_type_name": type_name,
            "department_id": type_info.get("department_id"),
            "asset_count": 0, "working": 0, "orange": 0, "red": 0, "yellow": 0,
            "_pct_sum": 0.0,
        })
        c["asset_count"] += 1
        c[cls] += 1
        c["_pct_sum"] += m["pct_functional"]
    for c in cat_acc.values():
        c["pct_functional"] = round(c["_pct_sum"] / c["asset_count"], 2) if c["asset_count"] else 100.0
        c.pop("_pct_sum", None)
    asset_categories = sorted(cat_acc.values(), key=lambda x: x["name"] or "")

    # Stations
    station_acc: dict = {}
    for (a, cls, m, _open_ol) in classed:
        sid = a.get("station_id") or "unknown"
        s_info = stations_map.get(sid, {})
        s = station_acc.setdefault(sid, {
            "_id": sid, "name": s_info.get("name", "Unknown"),
            "asset_count": 0, "working": 0, "orange": 0, "red": 0, "yellow": 0,
            "_pct_sum": 0.0,
        })
        s["asset_count"] += 1
        s[cls] += 1
        s["_pct_sum"] += m["pct_functional"]
    stations_out = []
    for s in station_acc.values():
        s["pct_functional"] = round(s["_pct_sum"] / s["asset_count"], 2) if s["asset_count"] else 100.0
        s.pop("_pct_sum", None)
        stations_out.append(s)
    stations_out.sort(key=lambda x: x["name"] or "")

    # Departments
    dept_acc: dict = {}
    for (a, cls, m, _open_ol) in classed:
        type_id = a.get("asset_type_id")
        type_info = types_map.get(type_id or "", {})
        did = type_info.get("department_id") or "unknown"
        dept_info = departments_map.get(did, {})
        d = dept_acc.setdefault(did, {
            "_id": did, "name": dept_info.get("name", "Unknown"),
            "asset_count": 0, "working": 0, "orange": 0, "red": 0, "yellow": 0,
            "_pct_sum": 0.0,
        })
        d["asset_count"] += 1
        d[cls] += 1
        d["_pct_sum"] += m["pct_functional"]
    departments_out = []
    for d in dept_acc.values():
        d["pct_functional"] = round(d["_pct_sum"] / d["asset_count"], 2) if d["asset_count"] else 100.0
        d.pop("_pct_sum", None)
        departments_out.append(d)
    departments_out.sort(key=lambda x: x["name"] or "")

    # Reporting officers (filtered if reporting_officer_ids provided)
    reporting_officers = []
    for u in users_docs:
        if u.get("role") != UserRole.REPORTING_OFFICER.value:
            continue
        uid = str(u["_id"])
        if reporting_officer_ids and uid not in reporting_officer_ids:
            continue
        dept_name = departments_map.get(u.get("department_id"), {}).get("name") if u.get("department_id") else None
        reporting_officers.append({
            "_id": uid, "name": u.get("name"),
            "employee_id": u.get("employee_id"),
            "department_name": dept_name,
            "assigned_stations": u.get("assigned_stations") or [],
        })
    reporting_officers.sort(key=lambda x: x["name"] or "")

    health = {
        "working": sum(1 for (_, c, _, _) in classed if c == "working"),
        "orange":  sum(1 for (_, c, _, _) in classed if c == "orange"),
        "red":     sum(1 for (_, c, _, _) in classed if c == "red"),
        "yellow":  sum(1 for (_, c, _, _) in classed if c == "yellow"),
    }

    available_stations = [{"_id": str(s["_id"]), "name": s.get("name")} for s in stations_docs]
    available_stations.sort(key=lambda x: x["name"] or "")

    return {
        "totals": {
            "assets": len(all_assets),
            "stations": len(stations_docs),
            "departments": len(departments_docs),
            "asset_categories": len(types_docs),
        },
        "health": health,
        "filters_applied": {
            "stations": station_ids or [],
            "departments": department_ids or [],
            "reporting_officer_ids": reporting_officer_ids or [],
        },
        "available_stations": available_stations,
        "asset_categories": asset_categories,
        "stations": stations_out,
        "departments": departments_out,
        "divisions": departments_out,
        "reporting_officers": reporting_officers,
    }


@router.get("/api/dashboard/oversight/{user_id}/category-assets")
async def oversight_category_assets(
    user_id: str,
    asset_type_id: Optional[str] = None,
    department_id: Optional[str] = None,
    station_id: Optional[str] = None,
):
    """Drill-down list for oversight roles.

    - Either `asset_type_id` (asset category) OR `department_id` must be provided.
      `department_id` is honored for SUPERADMIN/ADMIN/RO only and selects all
      asset types belonging to that department.
    - For RO, the department is implicitly the RO's own department.
    """
    try:
        user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    role = user.get("role")
    station_scope = list(user.get("assigned_stations") or [])
    if not station_scope and role not in (UserRole.SUPERADMIN.value, UserRole.ADMIN.value):
        return {"asset_type_id": asset_type_id, "department_id": department_id,
                "priority": [], "working": [], "totals": {"priority": 0, "working": 0}}

    if not asset_type_id and not department_id and not station_id:
        raise HTTPException(status_code=400, detail="Provide asset_type_id, department_id, or station_id")

    q = {}
    if asset_type_id:
        q["asset_type_id"] = asset_type_id

    # Resolve department_id -> set of asset_type_ids
    effective_dept_id = department_id
    if role == UserRole.REPORTING_OFFICER.value:
        # RO is always scoped to their own department
        effective_dept_id = user.get("department_id")
        if not effective_dept_id:
            return {"asset_type_id": asset_type_id, "department_id": department_id,
                    "priority": [], "working": [], "totals": {"priority": 0, "working": 0}}
    if effective_dept_id and role in (
        UserRole.SUPERADMIN.value, UserRole.ADMIN.value, UserRole.REPORTING_OFFICER.value
    ):
        if asset_type_id:
            # Validate asset_type_id belongs to that department (defensive)
            atype = await asset_types_collection.find_one({"_id": ObjectId(asset_type_id)})
            if not atype or atype.get("department_id") != effective_dept_id:
                return {"asset_type_id": asset_type_id, "department_id": department_id,
                        "priority": [], "working": [], "totals": {"priority": 0, "working": 0}}
        else:
            # Department-level drill-down: all asset types in department
            dept_types = await asset_types_collection.find(
                {"department_id": effective_dept_id}
            ).to_list(2000)
            type_ids = [str(t["_id"]) for t in dept_types]
            if not type_ids:
                return {"asset_type_id": None, "department_id": department_id,
                        "priority": [], "working": [], "totals": {"priority": 0, "working": 0}}
            q["asset_type_id"] = {"$in": type_ids}

    if station_id:
        if station_scope and station_id not in station_scope:
            raise HTTPException(status_code=403, detail="Station not in your scope")
        q["station_id"] = station_id
    elif station_scope:
        q["station_id"] = {"$in": station_scope}

    assets = await assets_collection.find(q).to_list(20000)

    s_ids = list({a.get("station_id") for a in assets if a.get("station_id")})
    l_ids = list({a.get("location_id") for a in assets if a.get("location_id")})
    sup_ids = list({a.get("assigned_supervisor_id") for a in assets if a.get("assigned_supervisor_id")})
    sm = {}
    if s_ids:
        sd = await stations_collection.find({"_id": {"$in": [ObjectId(s) for s in s_ids]}}).to_list(1000)
        sm = {str(s["_id"]): s["name"] for s in sd}
    lm = {}
    if l_ids:
        ld = await locations_collection.find({"_id": {"$in": [ObjectId(l) for l in l_ids]}}).to_list(1000)
        lm = {str(loc["_id"]): loc["name"] for loc in ld}
    um = {}
    if sup_ids:
        ud = await users_collection.find({"_id": {"$in": [ObjectId(u) for u in sup_ids]}}).to_list(1000)
        um = {str(u["_id"]): u.get("name") for u in ud}

    # Asset-type lookup so we can show the type per asset on department drill-down
    type_ids_resolved = list({a.get("asset_type_id") for a in assets if a.get("asset_type_id")})
    tm = {}
    if type_ids_resolved:
        td = await asset_types_collection.find(
            {"_id": {"$in": [ObjectId(t) for t in type_ids_resolved]}}
        ).to_list(2000)
        tm = {str(t["_id"]): t.get("name") for t in td}

    # Prefetch OL history for canonical defective_since
    ol_history_by_asset: dict = {}
    if assets:
        for rec in await orange_list_collection.find(
            {"asset_id": {"$in": [str(a["_id"]) for a in assets]}}
        ).to_list(20000):
            ol_history_by_asset.setdefault(rec["asset_id"], []).append(rec)

    now = datetime.utcnow()
    priority = []
    working = []
    for a in assets:
        open_ol = _open_ol_entry(ol_history_by_asset.get(str(a["_id"]), []))
        cls = _classify_health(a, now, open_ol)
        ds = open_ol.get("defective_since") or a.get("defective_since")
        ds_iso = ds.isoformat() if isinstance(ds, datetime) else ds
        ds_sortable = ds if isinstance(ds, datetime) else datetime.min
        item = {
            "_id": str(a["_id"]),
            "asset_number": a.get("asset_number"),
            "asset_type_id": a.get("asset_type_id"),
            "asset_type_name": tm.get(a.get("asset_type_id"), "Unknown"),
            "status": a.get("status", "working"),
            "health_class": cls,
            "defective_since": ds_iso,
            "station_name": sm.get(a.get("station_id"), "Unknown"),
            "location_name": lm.get(a.get("location_id"), "Unknown"),
            "supervisor_name": um.get(a.get("assigned_supervisor_id"), None),
        }
        if cls == "working":
            working.append(item)
        else:
            item["_sk"] = ds_sortable
            priority.append(item)

    priority.sort(key=lambda x: x.get("_sk") or datetime.min, reverse=True)
    for p in priority:
        p.pop("_sk", None)
    working.sort(key=lambda x: x.get("asset_number") or "")
    return {
        "asset_type_id": asset_type_id,
        "department_id": department_id,
        "priority": priority,
        "working": working,
        "totals": {"priority": len(priority), "working": len(working)},
    }
