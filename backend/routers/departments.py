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


# ============ DEPARTMENTS ============
@router.post("/api/departments")
async def create_department(dept: DepartmentCreate):
    doc = {
        "name": dept.name,
        "code": dept.code,
        "description": dept.description,
        "created_at": datetime.utcnow()
    }
    result = await departments_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@router.get("/api/departments")
async def list_departments():
    docs = await departments_collection.find().to_list(1000)
    return [serialize_doc(d) for d in docs]


@router.get("/api/departments/{dept_id}")
async def get_department(dept_id: str):
    doc = await departments_collection.find_one({"_id": ObjectId(dept_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Department not found")
    return serialize_doc(doc)


@router.put("/api/departments/{dept_id}")
async def update_department(dept_id: str, dept: DepartmentCreate):
    result = await departments_collection.update_one(
        {"_id": ObjectId(dept_id)},
        {"$set": {"name": dept.name, "code": dept.code, "description": dept.description}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Department not found")
    doc = await departments_collection.find_one({"_id": ObjectId(dept_id)})
    return serialize_doc(doc)


@router.delete("/api/departments/{dept_id}")
async def delete_department(dept_id: str):
    result = await departments_collection.delete_one({"_id": ObjectId(dept_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Department not found")
    return {"message": "Department deleted"}
