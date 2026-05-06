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


@router.post("/api/admin/transfer-supervisor")
async def transfer_supervisor(payload: dict):
    """Bulk-reassign every asset from `from_supervisor_id` to `to_supervisor_id`.
    Used when a supervisor is transferred or retires.
    Body: {from_supervisor_id: str, to_supervisor_id: Optional[str]}.
    If to_supervisor_id is None or empty, the assets become unassigned."""
    from_id = payload.get("from_supervisor_id")
    to_id = payload.get("to_supervisor_id") or None
    if not from_id:
        raise HTTPException(status_code=400, detail="from_supervisor_id is required")

    try:
        from_user = await users_collection.find_one({"_id": ObjectId(from_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid from_supervisor_id")
    if not from_user:
        raise HTTPException(status_code=404, detail="Source supervisor not found")
    if to_id:
        try:
            to_user = await users_collection.find_one({"_id": ObjectId(to_id)})
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid to_supervisor_id")
        if not to_user:
            raise HTTPException(status_code=404, detail="Target supervisor not found")

    result = await assets_collection.update_many(
        {"assigned_supervisor_id": from_id},
        {"$set": {"assigned_supervisor_id": to_id}}
    )

    # Audit log
    await audit_log_collection.insert_one({
        "entity_type": "assets",
        "entity_id": None,
        "action": "transfer_supervisor",
        "performed_by": None,
        "details": {
            "from_supervisor_id": from_id,
            "to_supervisor_id": to_id,
            "assets_updated": result.modified_count,
        },
        "created_at": datetime.utcnow()
    })

    return {
        "message": "Reassignment complete",
        "from_supervisor_id": from_id,
        "to_supervisor_id": to_id,
        "assets_updated": result.modified_count,
    }

# ============ ROLE MANAGEMENT ============
# Change 5: Only Superadmin can grant admin powers (not Admin)
@router.post("/api/users/{user_id}/grant-admin")
async def grant_admin_powers(user_id: str, granted_by: str = Query(...)):
    granter = await users_collection.find_one({"_id": ObjectId(granted_by)})
    if not granter or granter["role"] != UserRole.SUPERADMIN.value:
        raise HTTPException(status_code=403, detail="Only superadmin can grant admin powers")
    
    result = await users_collection.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"role": UserRole.ADMIN.value}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    await audit_log_collection.insert_one({
        "entity_type": "user",
        "entity_id": user_id,
        "action": "granted_admin",
        "performed_by": granted_by,
        "created_at": datetime.utcnow()
    })
    
    return {"message": "Admin powers granted"}


@router.post("/api/users/{user_id}/revoke-admin")
async def revoke_admin_powers(user_id: str, revoked_by: str = Query(...), new_role: str = Query(...)):
    revoker = await users_collection.find_one({"_id": ObjectId(revoked_by)})
    if not revoker or revoker["role"] != UserRole.SUPERADMIN.value:
        raise HTTPException(status_code=403, detail="Only superadmin can revoke admin powers")
    
    if new_role not in [r.value for r in UserRole]:
        raise HTTPException(status_code=400, detail="Invalid role")
    
    result = await users_collection.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"role": new_role}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {"message": f"Role changed to {new_role}"}
