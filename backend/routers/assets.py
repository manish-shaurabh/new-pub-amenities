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
from helpers import _normalize_freq_days


@router.post("/api/assets")
async def create_asset(asset: AssetCreate):
    asset_type = await asset_types_collection.find_one({"_id": ObjectId(asset.asset_type_id)})
    if not asset_type:
        raise HTTPException(status_code=404, detail="Asset type not found")
    station = await stations_collection.find_one({"_id": ObjectId(asset.station_id)})
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")
    location = await locations_collection.find_one({"_id": ObjectId(asset.location_id)})
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    
    doc = {
        "asset_type_id": asset.asset_type_id,
        "station_id": asset.station_id,
        "location_id": asset.location_id,
        "asset_number": asset.asset_number,
        "status": AssetStatus.WORKING.value,
        "description": asset.description,
        "schedule_frequency": asset.schedule_frequency if asset.schedule_frequency else None,
        "assigned_supervisor_id": asset.assigned_supervisor_id,
        "last_inspected": None,
        "next_due": None,
        "defective_since": None,
        "created_at": datetime.utcnow()
    }
    result = await assets_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@router.get("/api/assets")
async def list_assets(
    station_id: Optional[str] = None,
    location_id: Optional[str] = None,
    asset_type_id: Optional[str] = None,
    status: Optional[str] = None,
    department_id: Optional[str] = None
):
    query = {}
    if station_id:
        query["station_id"] = station_id
    if location_id:
        query["location_id"] = location_id
    if asset_type_id:
        query["asset_type_id"] = asset_type_id
    if status:
        query["status"] = status
    if department_id:
        dept_asset_types = await asset_types_collection.find({"department_id": department_id}).to_list(1000)
        type_ids = [str(at["_id"]) for at in dept_asset_types]
        query["asset_type_id"] = {"$in": type_ids}
    
    docs = await assets_collection.find(query).to_list(5000)
    
    # Batch fetch related data
    type_ids = list(set(d["asset_type_id"] for d in docs if d.get("asset_type_id")))
    station_ids = list(set(d["station_id"] for d in docs if d.get("station_id")))
    location_ids = list(set(d["location_id"] for d in docs if d.get("location_id")))
    supervisor_ids = list(set(d.get("assigned_supervisor_id") for d in docs if d.get("assigned_supervisor_id")))
    
    types_map = {}
    types_checklist_map = {}
    types_dept_map = {}
    if type_ids:
        types_docs = await asset_types_collection.find({"_id": {"$in": [ObjectId(tid) for tid in type_ids]}}).to_list(1000)
        types_map = {str(t["_id"]): t["name"] for t in types_docs}
        types_checklist_map = {str(t["_id"]): t.get("checklist", []) for t in types_docs}
        types_dept_map = {str(t["_id"]): t.get("department_id") for t in types_docs}
    stations_map = {}
    if station_ids:
        stations_docs = await stations_collection.find({"_id": {"$in": [ObjectId(sid) for sid in station_ids]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in stations_docs}
    locations_map = {}
    if location_ids:
        locs_docs = await locations_collection.find({"_id": {"$in": [ObjectId(lid) for lid in location_ids]}}).to_list(1000)
        locations_map = {str(l["_id"]): l["name"] for l in locs_docs}
    supervisors_map = {}
    if supervisor_ids:
        supervisors_docs = await users_collection.find({"_id": {"$in": [ObjectId(sid) for sid in supervisor_ids]}}).to_list(1000)
        supervisors_map = {str(u["_id"]): u["name"] for u in supervisors_docs}
    
    for doc in docs:
        doc["asset_type_name"] = types_map.get(doc["asset_type_id"], "Unknown")
        doc["station_name"] = stations_map.get(doc["station_id"], "Unknown")
        doc["location_name"] = locations_map.get(doc["location_id"], "Unknown")
        doc["checklist"] = types_checklist_map.get(doc["asset_type_id"], [])
        doc["assigned_supervisor_name"] = supervisors_map.get(doc.get("assigned_supervisor_id", ""), None)
        doc["department_id"] = types_dept_map.get(doc["asset_type_id"])
        doc["schedule_frequency"] = _normalize_freq_days(doc.get("schedule_frequency"))
    
    return [serialize_doc(d) for d in docs]


@router.get("/api/assets/{asset_id}")
async def get_asset(asset_id: str):
    doc = await assets_collection.find_one({"_id": ObjectId(asset_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Asset not found")
    asset_type = await asset_types_collection.find_one({"_id": ObjectId(doc["asset_type_id"])})
    station = await stations_collection.find_one({"_id": ObjectId(doc["station_id"])})
    location = await locations_collection.find_one({"_id": ObjectId(doc["location_id"])})
    doc["asset_type_name"] = asset_type["name"] if asset_type else "Unknown"
    doc["station_name"] = station["name"] if station else "Unknown"
    doc["location_name"] = location["name"] if location else "Unknown"
    if asset_type:
        doc["checklist"] = asset_type.get("checklist", [])
    doc["schedule_frequency"] = _normalize_freq_days(doc.get("schedule_frequency"))
    return serialize_doc(doc)


# Change 5: Asset EDIT endpoint
@router.put("/api/assets/{asset_id}")
async def update_asset(asset_id: str, asset: AssetCreate):
    update_data = {
        "asset_type_id": asset.asset_type_id,
        "station_id": asset.station_id,
        "location_id": asset.location_id,
        "asset_number": asset.asset_number,
        "description": asset.description,
        "schedule_frequency": asset.schedule_frequency if asset.schedule_frequency else None,
        "assigned_supervisor_id": asset.assigned_supervisor_id,
    }
    result = await assets_collection.update_one(
        {"_id": ObjectId(asset_id)},
        {"$set": update_data}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    doc = await assets_collection.find_one({"_id": ObjectId(asset_id)})
    doc["schedule_frequency"] = _normalize_freq_days(doc.get("schedule_frequency"))
    return serialize_doc(doc)


@router.delete("/api/assets/{asset_id}")
async def delete_asset(asset_id: str):
    result = await assets_collection.delete_one({"_id": ObjectId(asset_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"message": "Asset deleted"}
