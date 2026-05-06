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


# ============ BULK ASSET ASSIGNMENT ============
@router.post("/api/admin/assets/assign-bulk")
async def assign_assets_bulk(payload: dict):
    """Bulk-assign (or reassign) a list of assets to a supervisor.

    Body: {
        asset_ids: List[str]    # required, must be non-empty
        to_supervisor_id: Optional[str]   # if None/"" -> unassign
        performed_by: Optional[str]
    }
    Returns: {assets_updated, from_breakdown}.
    """
    asset_ids: List[str] = payload.get("asset_ids") or []
    to_id = payload.get("to_supervisor_id") or None
    performed_by = payload.get("performed_by")

    if not asset_ids or not isinstance(asset_ids, list):
        raise HTTPException(status_code=400, detail="asset_ids must be a non-empty list")

    # Validate target supervisor (when assigning)
    if to_id:
        try:
            target = await users_collection.find_one({"_id": ObjectId(to_id)})
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid to_supervisor_id")
        if not target or target.get("role") != UserRole.SUPERVISOR.value:
            raise HTTPException(status_code=400, detail="Target user is not a supervisor")

    # Convert IDs
    try:
        oids = [ObjectId(aid) for aid in asset_ids]
    except Exception:
        raise HTTPException(status_code=400, detail="One or more asset_ids are invalid")

    # Capture from-breakdown for the audit log (so reassignments are traceable)
    pre_assets = await assets_collection.find(
        {"_id": {"$in": oids}}, {"assigned_supervisor_id": 1}
    ).to_list(50000)
    from_breakdown: dict = {}
    for a in pre_assets:
        prev = a.get("assigned_supervisor_id") or None
        from_breakdown[prev or "__unassigned__"] = from_breakdown.get(prev or "__unassigned__", 0) + 1

    update = {"assigned_supervisor_id": to_id}
    result = await assets_collection.update_many(
        {"_id": {"$in": oids}},
        {"$set": update},
    )

    await audit_log_collection.insert_one({
        "entity_type": "assets",
        "entity_id": None,
        "action": "assign_bulk",
        "performed_by": performed_by,
        "details": {
            "to_supervisor_id": to_id,
            "asset_ids": asset_ids,
            "from_breakdown": from_breakdown,
            "assets_updated": result.modified_count,
        },
        "created_at": datetime.utcnow(),
    })

    return {
        "message": "Bulk assignment complete",
        "to_supervisor_id": to_id,
        "asset_ids": asset_ids,
        "assets_updated": result.modified_count,
        "from_breakdown": from_breakdown,
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
