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
from helpers import _normalize_freq_days, calculate_next_due


# ============ SCHEDULES ============
@router.post("/api/schedules")
async def create_schedule(schedule: ScheduleCreate):
    asset = await assets_collection.find_one({"_id": ObjectId(schedule.asset_id)})
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    
    now = datetime.utcnow()
    next_due = calculate_next_due(now, schedule.frequency)
    
    await schedules_collection.update_one(
        {"asset_id": schedule.asset_id},
        {"$set": {
            "asset_id": schedule.asset_id,
            "frequency": schedule.frequency.value,
            "set_by": schedule.set_by,
            "next_due": next_due,
            "last_inspected": asset.get("last_inspected"),
            "created_at": now
        }},
        upsert=True
    )
    
    await assets_collection.update_one(
        {"_id": ObjectId(schedule.asset_id)},
        {"$set": {"schedule_frequency": schedule.frequency.value, "next_due": next_due}}
    )
    
    return {"message": "Schedule set", "next_due": next_due.isoformat()}


@router.get("/api/schedules")
async def list_schedules(overdue_only: bool = False):
    query = {}
    if overdue_only:
        query["next_due"] = {"$lt": datetime.utcnow()}
    
    docs = await schedules_collection.find(query).to_list(1000)
    
    for doc in docs:
        asset = await assets_collection.find_one({"_id": ObjectId(doc["asset_id"])})
        if asset:
            asset_type = await asset_types_collection.find_one({"_id": ObjectId(asset["asset_type_id"])})
            station = await stations_collection.find_one({"_id": ObjectId(asset["station_id"])})
            doc["asset_info"] = {
                "asset_number": asset.get("asset_number"),
                "asset_type_name": asset_type["name"] if asset_type else "Unknown",
                "station_name": station["name"] if station else "Unknown"
            }
        doc["is_overdue"] = doc.get("next_due", datetime.utcnow()) < datetime.utcnow() if doc.get("next_due") else False
    
    return [serialize_doc(d) for d in docs]


@router.get("/api/schedules/due-today")
async def get_due_today(user_id: Optional[str] = None):
    today_end = datetime.utcnow().replace(hour=23, minute=59, second=59)
    
    query = {"next_due": {"$lte": today_end}}
    docs = await schedules_collection.find(query).to_list(1000)
    
    results = []
    for doc in docs:
        asset = await assets_collection.find_one({"_id": ObjectId(doc["asset_id"])})
        if asset:
            if user_id:
                user = await users_collection.find_one({"_id": ObjectId(user_id)})
                if user and user.get("role") not in ["superadmin", "admin"] and asset["station_id"] not in user.get("assigned_stations", []):
                    continue
            
            asset_type = await asset_types_collection.find_one({"_id": ObjectId(asset["asset_type_id"])})
            station = await stations_collection.find_one({"_id": ObjectId(asset["station_id"])})
            location = await locations_collection.find_one({"_id": ObjectId(asset["location_id"])})
            doc["asset_info"] = {
                "asset_id": str(asset["_id"]),
                "asset_number": asset.get("asset_number"),
                "asset_type_name": asset_type["name"] if asset_type else "Unknown",
                "station_name": station["name"] if station else "Unknown",
                "location_name": location["name"] if location else "Unknown"
            }
            doc["is_overdue"] = doc.get("next_due", datetime.utcnow()) < datetime.utcnow()
            results.append(serialize_doc(doc))
    
    return results


# ============ SUPERVISOR SCHEDULE (asset-frequency-based) ============
@router.get("/api/schedules/supervisor/{user_id}")
async def get_supervisor_schedule(
    user_id: str,
    from_date: Optional[str] = None,  # ISO date "YYYY-MM-DD"
    to_date: Optional[str] = None,
):
    """Compute upcoming inspection tasks for a supervisor based on assigned assets'
    schedule_frequency (in days). Default range: today \u2192 today+7.
    Returns tasks grouped by asset type."""
    user = await users_collection.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Parse / default the date range
    try:
        if from_date:
            range_start = datetime.strptime(from_date, "%Y-%m-%d")
        else:
            today = datetime.utcnow()
            range_start = datetime(today.year, today.month, today.day)
        if to_date:
            range_end = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
        else:
            range_end = range_start + timedelta(days=7)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format; use YYYY-MM-DD")

    if range_end < range_start:
        raise HTTPException(status_code=400, detail="to_date must be on or after from_date")

    # Find all assets scoped to this supervisor via station + department (Phase 1 implicit scoping)
    sup_stations = list(user.get("assigned_stations") or [])
    sup_dept = user.get("department_id")
    if not sup_stations or not sup_dept:
        return {
            "user_id": user_id,
            "user_name": user.get("name"),
            "department_id": sup_dept,
            "from_date": range_start.date().isoformat(),
            "to_date": range_end.date().isoformat(),
            "total_tasks": 0,
            "groups": [],
        }
    dept_type_docs = await asset_types_collection.find(
        {"department_id": sup_dept}, {"_id": 1}
    ).to_list(2000)
    sup_type_ids = [str(t["_id"]) for t in dept_type_docs]
    if not sup_type_ids:
        return {
            "user_id": user_id,
            "user_name": user.get("name"),
            "department_id": sup_dept,
            "from_date": range_start.date().isoformat(),
            "to_date": range_end.date().isoformat(),
            "total_tasks": 0,
            "groups": [],
        }
    asset_query = {
        "station_id": {"$in": sup_stations},
        "asset_type_id": {"$in": sup_type_ids},
        "schedule_frequency": {"$ne": None}
    }
    assets = await assets_collection.find(asset_query).to_list(2000)

    # Pre-fetch related data
    type_ids = list({a.get("asset_type_id") for a in assets if a.get("asset_type_id")})
    station_ids = list({a.get("station_id") for a in assets if a.get("station_id")})
    location_ids = list({a.get("location_id") for a in assets if a.get("location_id")})

    types_map = {}
    if type_ids:
        types_docs = await asset_types_collection.find({"_id": {"$in": [ObjectId(t) for t in type_ids]}}).to_list(1000)
        types_map = {str(t["_id"]): {"name": t["name"], "department_id": t.get("department_id")} for t in types_docs}
    stations_map = {}
    if station_ids:
        s_docs = await stations_collection.find({"_id": {"$in": [ObjectId(s) for s in station_ids]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in s_docs}
    locations_map = {}
    if location_ids:
        l_docs = await locations_collection.find({"_id": {"$in": [ObjectId(lid) for lid in location_ids]}}).to_list(1000)
        locations_map = {str(loc["_id"]): loc["name"] for loc in l_docs}

    now = datetime.utcnow()
    grouped: dict = {}

    for asset in assets:
        freq_days = _normalize_freq_days(asset.get("schedule_frequency"))
        if not freq_days or freq_days <= 0:
            continue

        # Determine first inspection date in (or before) the range
        last_inspected = asset.get("last_inspected")
        if last_inspected:
            next_due = last_inspected + timedelta(days=freq_days)
        else:
            # Never inspected -> due immediately (use creation or now)
            next_due = asset.get("created_at") or now

        # Walk forward by frequency, collecting due dates within the range
        due_dates = []
        max_iters = 200  # safety cap
        iters = 0
        while next_due <= range_end and iters < max_iters:
            if next_due >= range_start:
                due_dates.append(next_due)
            next_due = next_due + timedelta(days=freq_days)
            iters += 1

        if not due_dates:
            continue

        type_id = asset.get("asset_type_id")
        type_info = types_map.get(type_id, {"name": "Unknown", "department_id": None})
        type_name = type_info["name"]
        if type_id not in grouped:
            grouped[type_id] = {
                "asset_type_id": type_id,
                "asset_type_name": type_name,
                "department_id": type_info.get("department_id"),
                "tasks": []
            }
        for d in due_dates:
            days_left = (d.date() - now.date()).days
            grouped[type_id]["tasks"].append({
                "asset_id": str(asset["_id"]),
                "asset_number": asset.get("asset_number"),
                "station_id": asset.get("station_id"),
                "station_name": stations_map.get(asset.get("station_id"), "Unknown"),
                "location_id": asset.get("location_id"),
                "location_name": locations_map.get(asset.get("location_id"), "Unknown"),
                "due_date": d.isoformat(),
                "days_left": days_left,  # negative => overdue
                "is_overdue": d < now,
                "frequency_days": freq_days,
                "asset_status": asset.get("status", "working"),
            })

    # Sort tasks within each group by due date
    groups = list(grouped.values())
    for g in groups:
        g["tasks"].sort(key=lambda t: t["due_date"])
        g["task_count"] = len(g["tasks"])
    groups.sort(key=lambda g: g["asset_type_name"])

    return {
        "user_id": user_id,
        "user_name": user.get("name"),
        "department_id": user.get("department_id"),
        "from_date": range_start.date().isoformat(),
        "to_date": range_end.date().isoformat(),
        "total_tasks": sum(g["task_count"] for g in groups),
        "groups": groups,
    }


@router.get("/api/schedules/admin")
async def get_admin_schedule(
    station_ids: Optional[List[str]] = Query(None),
    department_ids: Optional[List[str]] = Query(None),
    asset_type_ids: Optional[List[str]] = Query(None),
    supervisor_ids: Optional[List[str]] = Query(None),
    reporting_officer_ids: Optional[List[str]] = Query(None),
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
):
    """Multi-filter schedule view for Superadmin / Admin / Reporting Officer.
    All filters are optional; when omitted, no filter is applied for that dimension.
    Returns tasks grouped by asset type, with supervisor info on each task."""
    # Parse date range
    try:
        if from_date:
            range_start = datetime.strptime(from_date, "%Y-%m-%d")
        else:
            today = datetime.utcnow()
            range_start = datetime(today.year, today.month, today.day)
        if to_date:
            range_end = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
        else:
            range_end = range_start + timedelta(days=7)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format; use YYYY-MM-DD")
    if range_end < range_start:
        raise HTTPException(status_code=400, detail="to_date must be on or after from_date")

    # If reporting_officer_ids passed, expand to supervisor_ids who report to them
    expanded_supervisor_ids = list(supervisor_ids) if supervisor_ids else None
    if reporting_officer_ids:
        ro_supervisors = await users_collection.find({
            "role": UserRole.SUPERVISOR.value,
            "reports_to_id": {"$in": reporting_officer_ids}
        }).to_list(1000)
        ro_sup_ids = [str(s["_id"]) for s in ro_supervisors]
        if expanded_supervisor_ids is None:
            expanded_supervisor_ids = ro_sup_ids
        else:
            # Intersect when both filters are provided
            expanded_supervisor_ids = list(set(expanded_supervisor_ids).intersection(ro_sup_ids))

    # If department_ids passed, expand to asset_type_ids in those departments
    expanded_type_ids = list(asset_type_ids) if asset_type_ids else None
    if department_ids:
        dept_types = await asset_types_collection.find({
            "department_id": {"$in": department_ids}
        }).to_list(1000)
        dept_type_ids = [str(t["_id"]) for t in dept_types]
        if expanded_type_ids is None:
            expanded_type_ids = dept_type_ids
        else:
            expanded_type_ids = list(set(expanded_type_ids).intersection(dept_type_ids))

    # Build asset query
    asset_query: dict = {"schedule_frequency": {"$ne": None}}
    if station_ids:
        asset_query["station_id"] = {"$in": station_ids}
    if expanded_type_ids is not None:
        if not expanded_type_ids:
            return {"from_date": range_start.date().isoformat(), "to_date": range_end.date().isoformat(),
                    "total_tasks": 0, "groups": []}
        asset_query["asset_type_id"] = {"$in": expanded_type_ids}
    if expanded_supervisor_ids is not None:
        if not expanded_supervisor_ids:
            return {"from_date": range_start.date().isoformat(), "to_date": range_end.date().isoformat(),
                    "total_tasks": 0, "groups": []}
        asset_query["assigned_supervisor_id"] = {"$in": expanded_supervisor_ids}

    assets = await assets_collection.find(asset_query).to_list(5000)

    # Pre-fetch lookup data
    type_ids_set = list({a.get("asset_type_id") for a in assets if a.get("asset_type_id")})
    station_ids_set = list({a.get("station_id") for a in assets if a.get("station_id")})
    location_ids_set = list({a.get("location_id") for a in assets if a.get("location_id")})
    sup_ids_set = list({a.get("assigned_supervisor_id") for a in assets if a.get("assigned_supervisor_id")})

    types_map = {}
    if type_ids_set:
        td = await asset_types_collection.find({"_id": {"$in": [ObjectId(t) for t in type_ids_set]}}).to_list(1000)
        types_map = {str(t["_id"]): {"name": t["name"], "department_id": t.get("department_id")} for t in td}
    stations_map = {}
    if station_ids_set:
        sd = await stations_collection.find({"_id": {"$in": [ObjectId(s) for s in station_ids_set]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in sd}
    locations_map = {}
    if location_ids_set:
        ld = await locations_collection.find({"_id": {"$in": [ObjectId(l) for l in location_ids_set]}}).to_list(1000)
        locations_map = {str(loc["_id"]): loc["name"] for loc in ld}
    sups_map = {}
    if sup_ids_set:
        ud = await users_collection.find({"_id": {"$in": [ObjectId(u) for u in sup_ids_set]}}).to_list(1000)
        sups_map = {str(u["_id"]): {"name": u.get("name"), "employee_id": u.get("employee_id")} for u in ud}

    now = datetime.utcnow()
    grouped: dict = {}
    for asset in assets:
        freq_days = _normalize_freq_days(asset.get("schedule_frequency"))
        if not freq_days or freq_days <= 0:
            continue
        last_inspected = asset.get("last_inspected")
        next_due = (last_inspected + timedelta(days=freq_days)) if last_inspected else (asset.get("created_at") or now)
        due_dates = []
        max_iters = 200
        iters = 0
        while next_due <= range_end and iters < max_iters:
            if next_due >= range_start:
                due_dates.append(next_due)
            next_due = next_due + timedelta(days=freq_days)
            iters += 1
        if not due_dates:
            continue
        type_id = asset.get("asset_type_id")
        type_info = types_map.get(type_id, {"name": "Unknown", "department_id": None})
        if type_id not in grouped:
            grouped[type_id] = {
                "asset_type_id": type_id,
                "asset_type_name": type_info["name"],
                "department_id": type_info.get("department_id"),
                "tasks": [],
            }
        sup_info = sups_map.get(asset.get("assigned_supervisor_id"), None)
        for d in due_dates:
            grouped[type_id]["tasks"].append({
                "asset_id": str(asset["_id"]),
                "asset_number": asset.get("asset_number"),
                "station_id": asset.get("station_id"),
                "station_name": stations_map.get(asset.get("station_id"), "Unknown"),
                "location_id": asset.get("location_id"),
                "location_name": locations_map.get(asset.get("location_id"), "Unknown"),
                "supervisor_id": asset.get("assigned_supervisor_id"),
                "supervisor_name": sup_info["name"] if sup_info else None,
                "supervisor_employee_id": sup_info["employee_id"] if sup_info else None,
                "due_date": d.isoformat(),
                "days_left": (d.date() - now.date()).days,
                "is_overdue": d < now,
                "frequency_days": freq_days,
                "asset_status": asset.get("status", "working"),
            })

    groups = list(grouped.values())
    for g in groups:
        g["tasks"].sort(key=lambda t: t["due_date"])
        g["task_count"] = len(g["tasks"])
    groups.sort(key=lambda g: g["asset_type_name"])

    return {
        "from_date": range_start.date().isoformat(),
        "to_date": range_end.date().isoformat(),
        "filters_applied": {
            "stations": station_ids or [],
            "departments": department_ids or [],
            "asset_types": asset_type_ids or [],
            "supervisors": supervisor_ids or [],
            "reporting_officers": reporting_officer_ids or [],
        },
        "total_tasks": sum(g["task_count"] for g in groups),
        "groups": groups,
    }


@router.get("/api/schedules/approving-supervisor/{user_id}/supervisors")
async def get_supervisors_under_approving(user_id: str):
    """Return the list of supervisors that work at any station assigned to this
    approving supervisor. Used to render the schedule overview for an approving sup."""
    asup = await users_collection.find_one({"_id": ObjectId(user_id)})
    if not asup:
        raise HTTPException(status_code=404, detail="User not found")
    asup_stations = asup.get("assigned_stations", []) or []
    if not asup_stations:
        return {"approving_supervisor_id": user_id, "supervisors": []}

    # Find supervisors with overlap in assigned_stations
    sup_docs = await users_collection.find({
        "role": UserRole.SUPERVISOR.value,
        "is_active": True,
        "assigned_stations": {"$in": asup_stations}
    }).to_list(1000)

    # For each supervisor, count assigned assets (with frequency set) for context
    results = []
    for s in sup_docs:
        # Count assets via implicit scoping (station + department)
        s_stations = list(s.get("assigned_stations") or [])
        s_dept = s.get("department_id")
        assigned_count = 0
        scheduled_count = 0
        if s_stations and s_dept:
            s_type_docs = await asset_types_collection.find(
                {"department_id": s_dept}, {"_id": 1}
            ).to_list(500)
            s_type_ids = [str(t["_id"]) for t in s_type_docs]
            if s_type_ids:
                base_q = {
                    "station_id": {"$in": s_stations},
                    "asset_type_id": {"$in": s_type_ids},
                }
                assigned_count = await assets_collection.count_documents(base_q)
                scheduled_count = await assets_collection.count_documents(
                    {**base_q, "schedule_frequency": {"$ne": None}}
                )
        # Department name
        dept_name = None
        if s.get("department_id"):
            dept = await departments_collection.find_one({"_id": ObjectId(s["department_id"])})
            dept_name = dept["name"] if dept else None
        # Stations overlap (only the ones shared with the approving sup)
        shared_stations = [st for st in (s.get("assigned_stations") or []) if st in asup_stations]
        results.append({
            "_id": str(s["_id"]),
            "employee_id": s.get("employee_id"),
            "name": s.get("name"),
            "department_id": s.get("department_id"),
            "department_name": dept_name,
            "assigned_stations": shared_stations,
            "assigned_assets_count": assigned_count,
            "scheduled_assets_count": scheduled_count,
        })
    results.sort(key=lambda r: r["name"] or "")
    return {"approving_supervisor_id": user_id, "supervisors": results}

