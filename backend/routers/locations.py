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


# ============ LOCATIONS ============
@router.post("/api/locations")
async def create_location(location: LocationCreate):
    station = await stations_collection.find_one({"_id": ObjectId(location.station_id)})
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")
    doc = {
        "name": location.name,
        "station_id": location.station_id,
        "description": location.description,
        "created_at": datetime.utcnow()
    }
    result = await locations_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@router.get("/api/locations")
async def list_locations(station_id: Optional[str] = None):
    query = {}
    if station_id:
        query["station_id"] = station_id
    docs = await locations_collection.find(query).to_list(1000)
    # Batch fetch stations
    station_ids = list(set(d["station_id"] for d in docs if d.get("station_id")))
    stations_map = {}
    if station_ids:
        stations_docs = await stations_collection.find({"_id": {"$in": [ObjectId(sid) for sid in station_ids]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in stations_docs}
    for doc in docs:
        doc["station_name"] = stations_map.get(doc["station_id"], "Unknown")
    return [serialize_doc(d) for d in docs]


@router.put("/api/locations/{location_id}")
async def update_location(location_id: str, location: LocationCreate):
    result = await locations_collection.update_one(
        {"_id": ObjectId(location_id)},
        {"$set": {"name": location.name, "station_id": location.station_id, "description": location.description}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Location not found")
    doc = await locations_collection.find_one({"_id": ObjectId(location_id)})
    return serialize_doc(doc)


@router.delete("/api/locations/{location_id}")
async def delete_location(location_id: str):
    result = await locations_collection.delete_one({"_id": ObjectId(location_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Location not found")
    return {"message": "Location deleted"}
