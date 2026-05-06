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
from helpers import _compute_asset_metrics, _analytics_for_asset_set


@router.get("/api/analytics/supervisor/{user_id}")
async def supervisor_analytics(user_id: str):
    """Performance analytics for a supervisor: per-category metrics for assets
    allocated to them, with nested per-asset breakdown."""
    try:
        user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Implicit station + department scoping (Phase 1)
    sup_stations = list(user.get("assigned_stations") or [])
    dept_id = user.get("department_id")
    if sup_stations and dept_id:
        tdocs = await asset_types_collection.find({"department_id": dept_id}, {"_id": 1}).to_list(2000)
        sup_type_ids = [str(t["_id"]) for t in tdocs]
        assets = await assets_collection.find({
            "station_id": {"$in": sup_stations},
            "asset_type_id": {"$in": sup_type_ids}
        }).to_list(5000) if sup_type_ids else []
    else:
        assets = []
    categories = await _analytics_for_asset_set(assets)

    overall_pct = round(sum(c["pct_functional"] * c["asset_count"] for c in categories) / max(1, sum(c["asset_count"] for c in categories)), 2) if categories else 100.0
    return {
        "user_id": user_id,
        "user_name": user.get("name"),
        "total_assets": sum(c["asset_count"] for c in categories),
        "overall_pct_functional": overall_pct,
        "categories": categories,
    }


@router.get("/api/analytics/approving-supervisor/{user_id}/supervisors")
async def approving_supervisor_analytics(user_id: str):
    """For each supervisor under this approving sup, return their per-category analytics."""
    try:
        asup = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not asup:
        raise HTTPException(status_code=404, detail="User not found")

    asup_stations = asup.get("assigned_stations", []) or []
    if not asup_stations:
        return {"approving_supervisor_id": user_id, "supervisors": []}

    sup_docs = await users_collection.find({
        "role": UserRole.SUPERVISOR.value,
        "is_active": True,
        "assigned_stations": {"$in": asup_stations}
    }).to_list(1000)

    out = []
    for s in sup_docs:
        sid = str(s["_id"])
        sup_stations_a = list(s.get("assigned_stations") or [])
        sup_dept_a = s.get("department_id")
        if sup_stations_a and sup_dept_a:
            _td = await asset_types_collection.find({"department_id": sup_dept_a}, {"_id": 1}).to_list(2000)
            _tids = [str(t["_id"]) for t in _td]
            assets = await assets_collection.find({
                "station_id": {"$in": sup_stations_a},
                "asset_type_id": {"$in": _tids}
            }).to_list(5000) if _tids else []
        else:
            assets = []
        categories = await _analytics_for_asset_set(assets)
        # Strip the per-asset list to keep payload manageable; keep aggregates
        slim = [{k: v for k, v in c.items() if k != "assets"} for c in categories]
        # Department name
        dept_name = None
        if s.get("department_id"):
            dept = await departments_collection.find_one({"_id": ObjectId(s["department_id"])})
            dept_name = dept["name"] if dept else None
        out.append({
            "_id": sid,
            "name": s.get("name"),
            "employee_id": s.get("employee_id"),
            "department_name": dept_name,
            "total_assets": sum(c["asset_count"] for c in categories),
            "categories": slim,
        })
    out.sort(key=lambda x: x["name"] or "")
    return {"approving_supervisor_id": user_id, "supervisors": out}


@router.get("/api/analytics/asset/{asset_id}")
async def asset_analytics(asset_id: str):
    """Performance analytics for a single asset."""
    try:
        asset = await assets_collection.find_one({"_id": ObjectId(asset_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid asset_id")
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    history = await orange_list_collection.find({"asset_id": asset_id}).to_list(10000)
    return _compute_asset_metrics(asset, history, datetime.utcnow())
