from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from bson import ObjectId
import io
import os
import uuid

from database import (now_ist, 
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


# ============ STATIONS ============
@router.post("/api/stations")
async def create_station(station: StationCreate):
    doc = {
        "name": station.name,
        "code": station.code,
        "zone": station.zone,
        "division": station.division,
        "approving_supervisor_id": station.approving_supervisor_id,
        "created_at": now_ist()
    }
    result = await stations_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@router.get("/api/stations")
async def list_stations():
    docs = await stations_collection.find().to_list(1000)
    # Batch fetch approving supervisors
    asup_ids = list(set(d.get("approving_supervisor_id") for d in docs if d.get("approving_supervisor_id")))
    asup_map = {}
    if asup_ids:
        asup_docs = await users_collection.find({"_id": {"$in": [ObjectId(aid) for aid in asup_ids]}}).to_list(1000)
        asup_map = {str(u["_id"]): u["name"] for u in asup_docs}
    
    for doc in docs:
        doc["approving_supervisor_name"] = asup_map.get(doc.get("approving_supervisor_id", ""), None)
    return [serialize_doc(d) for d in docs]


@router.get("/api/stations/{station_id}")
async def get_station(station_id: str):
    doc = await stations_collection.find_one({"_id": ObjectId(station_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Station not found")
    return serialize_doc(doc)


@router.put("/api/stations/{station_id}")
async def update_station(station_id: str, station: StationCreate):
    result = await stations_collection.update_one(
        {"_id": ObjectId(station_id)},
        {"$set": {
            "name": station.name,
            "code": station.code,
            "zone": station.zone,
            "division": station.division,
            "approving_supervisor_id": station.approving_supervisor_id
        }}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Station not found")
    doc = await stations_collection.find_one({"_id": ObjectId(station_id)})
    return serialize_doc(doc)


@router.delete("/api/stations/{station_id}")
async def delete_station(station_id: str):
    result = await stations_collection.delete_one({"_id": ObjectId(station_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Station not found")
    return {"message": "Station deleted"}
