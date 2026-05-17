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


# ============ ASSET TYPES ============
@router.post("/api/asset-types")
async def create_asset_type(asset_type: AssetTypeCreate):
    doc = {
        "name": asset_type.name,
        "department_id": asset_type.department_id,
        "checklist": [item.model_dump() for item in asset_type.checklist],
        "description": asset_type.description,
        "tracking_mode": asset_type.tracking_mode if asset_type.tracking_mode in ("individual", "grouped") else "individual",
        "icon_key": asset_type.icon_key or None,
        "created_at": now_ist()
    }
    result = await asset_types_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@router.get("/api/asset-types")
async def list_asset_types(department_id: Optional[str] = None):
    query = {}
    if department_id:
        query["department_id"] = department_id
    docs = await asset_types_collection.find(query).to_list(1000)
    # Batch fetch departments
    dept_ids = list(set(d["department_id"] for d in docs if d.get("department_id")))
    depts_map = {}
    if dept_ids:
        depts_docs = await departments_collection.find({"_id": {"$in": [ObjectId(did) for did in dept_ids]}}).to_list(1000)
        depts_map = {str(d["_id"]): d["name"] for d in depts_docs}
    for doc in docs:
        doc["department_name"] = depts_map.get(doc["department_id"], "Unknown")
        # Default for legacy records that pre-date the tracking_mode field
        doc.setdefault("tracking_mode", "individual")
    return [serialize_doc(d) for d in docs]


@router.put("/api/asset-types/{asset_type_id}")
async def update_asset_type(asset_type_id: str, asset_type: AssetTypeCreate):
    result = await asset_types_collection.update_one(
        {"_id": ObjectId(asset_type_id)},
        {"$set": {
            "name": asset_type.name,
            "department_id": asset_type.department_id,
            "checklist": [item.model_dump() for item in asset_type.checklist],
            "description": asset_type.description,
            "tracking_mode": asset_type.tracking_mode if asset_type.tracking_mode in ("individual", "grouped") else "individual",
            "icon_key": asset_type.icon_key or None,
        }}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Asset type not found")
    doc = await asset_types_collection.find_one({"_id": ObjectId(asset_type_id)})
    return serialize_doc(doc)


@router.delete("/api/asset-types/{asset_type_id}")
async def delete_asset_type(asset_type_id: str):
    result = await asset_types_collection.delete_one({"_id": ObjectId(asset_type_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Asset type not found")
    return {"message": "Asset type deleted"}
