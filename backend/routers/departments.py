from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from bson import ObjectId
from pymongo.errors import DuplicateKeyError
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


# ============ DEPARTMENTS ============
async def _require_superadmin(current_user_id: Optional[str]):
    """Raise 403 unless the given user_id belongs to a superadmin."""
    if not current_user_id:
        raise HTTPException(status_code=403, detail="Only Super Admin can manage departments")
    try:
        u = await users_collection.find_one({"_id": ObjectId(current_user_id)})
    except Exception:
        u = None
    if not u or u.get("role") != UserRole.SUPERADMIN.value:
        raise HTTPException(status_code=403, detail="Only Super Admin can manage departments")
    return u


@router.post("/api/departments")
async def create_department(dept: DepartmentCreate, current_user_id: Optional[str] = Query(None)):
    await _require_superadmin(current_user_id)
    # Pydantic validators already uppercased code & trimmed name.
    existing = await departments_collection.find_one({
        "$or": [
            {"name": {"$regex": f"^{dept.name}$", "$options": "i"}},
            {"code": dept.code},
        ]
    })
    if existing:
        which = "name" if (existing.get("name", "").strip().lower() == dept.name.strip().lower()) else "code"
        raise HTTPException(
            status_code=409,
            detail=f"A department with this {which} already exists"
        )
    doc = {
        "name": dept.name,
        "code": dept.code,
        "description": dept.description,
        "created_at": now_ist()
    }
    try:
        result = await departments_collection.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=409, detail="Department already exists")
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
async def update_department(dept_id: str, dept: DepartmentCreate, current_user_id: Optional[str] = Query(None)):
    await _require_superadmin(current_user_id)
    # Block collisions with a *different* department
    collision = await departments_collection.find_one({
        "_id": {"$ne": ObjectId(dept_id)},
        "$or": [
            {"name": {"$regex": f"^{dept.name}$", "$options": "i"}},
            {"code": dept.code},
        ]
    })
    if collision:
        which = "name" if (collision.get("name", "").strip().lower() == dept.name.strip().lower()) else "code"
        raise HTTPException(status_code=409, detail=f"Another department with this {which} already exists")
    result = await departments_collection.update_one(
        {"_id": ObjectId(dept_id)},
        {"$set": {"name": dept.name, "code": dept.code, "description": dept.description}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Department not found")
    doc = await departments_collection.find_one({"_id": ObjectId(dept_id)})
    return serialize_doc(doc)


@router.delete("/api/departments/{dept_id}")
async def delete_department(dept_id: str, current_user_id: Optional[str] = Query(None)):
    await _require_superadmin(current_user_id)
    # Block deletion if any asset type still references this department
    in_use = await asset_types_collection.count_documents({"department_id": dept_id})
    if in_use > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete: {in_use} asset type(s) still reference this department"
        )
    result = await departments_collection.delete_one({"_id": ObjectId(dept_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Department not found")
    return {"message": "Department deleted"}
