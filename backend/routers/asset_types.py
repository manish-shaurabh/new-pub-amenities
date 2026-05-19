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
def _validate_asset_type_payload(asset_type: AssetTypeCreate):
    name = (asset_type.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Asset type name is required")
    dept_id = (asset_type.department_id or "").strip()
    if not dept_id:
        raise HTTPException(
            status_code=400,
            detail="Department is required. Asset types cannot exist without a department.",
        )
    try:
        ObjectId(dept_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid department_id format")
    return name, dept_id


async def _ensure_department_exists(dept_id: str):
    dept = await departments_collection.find_one({"_id": ObjectId(dept_id)})
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    return dept


@router.post("/api/asset-types")
async def create_asset_type(asset_type: AssetTypeCreate):
    name, dept_id = _validate_asset_type_payload(asset_type)
    await _ensure_department_exists(dept_id)
    doc = {
        "name": name,
        "department_id": dept_id,
        "checklist": [item.model_dump() for item in asset_type.checklist],
        "description": asset_type.description,
        "tracking_mode": asset_type.tracking_mode if asset_type.tracking_mode in ("individual", "grouped") else "individual",
        "icon_key": asset_type.icon_key or None,
        "custom_icon_url": asset_type.custom_icon_url or None,
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
    name, dept_id = _validate_asset_type_payload(asset_type)
    await _ensure_department_exists(dept_id)
    result = await asset_types_collection.update_one(
        {"_id": ObjectId(asset_type_id)},
        {"$set": {
            "name": name,
            "department_id": dept_id,
            "checklist": [item.model_dump() for item in asset_type.checklist],
            "description": asset_type.description,
            "tracking_mode": asset_type.tracking_mode if asset_type.tracking_mode in ("individual", "grouped") else "individual",
            "icon_key": asset_type.icon_key or None,
            "custom_icon_url": asset_type.custom_icon_url or None,
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


ICON_UPLOAD_DIR = "/app/backend/uploads/icons"
os.makedirs(ICON_UPLOAD_DIR, exist_ok=True)
ALLOWED_ICON_EXTENSIONS = {".svg", ".png", ".jpg", ".jpeg", ".webp"}
MAX_ICON_SIZE = 512 * 1024  # 512 KB
ADMIN_ROLES = {"superadmin", "admin", "divisional_admin"}


async def _require_admin(user_id: str):
    """Lightweight admin guard for icon management."""
    if not user_id:
        raise HTTPException(status_code=401, detail="user_id required")
    try:
        u = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not u or u.get("role") not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Admin role required")


@router.post("/api/asset-types/{asset_type_id}/upload-icon")
async def upload_asset_type_icon(asset_type_id: str, file: UploadFile = File(...), current_user_id: str = Query(default="")):
    await _require_admin(current_user_id)
    doc = await asset_types_collection.find_one({"_id": ObjectId(asset_type_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Asset type not found")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_ICON_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported format. Allowed: {', '.join(ALLOWED_ICON_EXTENSIONS)}")

    content = await file.read()
    if len(content) > MAX_ICON_SIZE:
        raise HTTPException(status_code=400, detail="Icon file must be under 512 KB")

    # Pre-process SVGs: replace 'currentColor' with a concrete dark color
    # so the icon renders correctly inside <img> tags (which can't inherit CSS color)
    if ext == ".svg":
        try:
            text = content.decode("utf-8")
            text = text.replace('stroke="currentColor"', 'stroke="#1e293b"')
            text = text.replace("stroke='currentColor'", "stroke='#1e293b'")
            text = text.replace('fill="currentColor"', 'fill="#1e293b"')
            text = text.replace("fill='currentColor'", "fill='#1e293b'")
            # Bump stroke-width for small icon rendering (thin strokes disappear at 24px)
            text = text.replace('stroke-width="1"', 'stroke-width="1.5"')
            text = text.replace('stroke-width="2"', 'stroke-width="2.5"')
            content = text.encode("utf-8")
        except Exception:
            pass  # If decode fails, store the original binary

    unique_name = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(ICON_UPLOAD_DIR, unique_name)
    with open(file_path, "wb") as f:
        f.write(content)

    icon_url = f"/api/uploads/icons/{unique_name}"

    # Remove old custom icon file if exists
    old_url = doc.get("custom_icon_url")
    if old_url and old_url.startswith("/api/uploads/icons/"):
        old_path = os.path.join(ICON_UPLOAD_DIR, old_url.split("/")[-1])
        if os.path.exists(old_path):
            os.remove(old_path)

    await asset_types_collection.update_one(
        {"_id": ObjectId(asset_type_id)},
        {"$set": {"custom_icon_url": icon_url}}
    )
    return {"custom_icon_url": icon_url}


@router.delete("/api/asset-types/{asset_type_id}/icon")
async def delete_asset_type_icon(asset_type_id: str, current_user_id: str = Query(default="")):
    await _require_admin(current_user_id)
    doc = await asset_types_collection.find_one({"_id": ObjectId(asset_type_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Asset type not found")
    old_url = doc.get("custom_icon_url")
    if old_url and old_url.startswith("/api/uploads/icons/"):
        old_path = os.path.join(ICON_UPLOAD_DIR, old_url.split("/")[-1])
        if os.path.exists(old_path):
            os.remove(old_path)
    await asset_types_collection.update_one(
        {"_id": ObjectId(asset_type_id)},
        {"$set": {"custom_icon_url": None}}
    )
    return {"message": "Custom icon removed"}
