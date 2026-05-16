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
from helpers import _normalize_freq_days, broadcast_asset_defect_notifications


# ============ MARK DEFECTIVE (manual, by Admin / Super Admin) ============
@router.post("/api/assets/{asset_id}/mark-defective")
async def mark_asset_defective(asset_id: str, payload: dict):
    """Manually mark an asset defective without going through the inspection flow.

    Body: {
        status: "not_ok" | "needs_repair",   (required)
        remarks: str                         (required, ≥ 10 chars),
        defective_at: ISO datetime           (required, not in the future),
        performed_by: <user_id>              (required, must be admin/superadmin),
        photo_urls: [str]                    (optional)
    }

    Side effects (single transaction):
      - Synthetic inspection (inspection_type='manual_marking') for audit/visibility.
      - Asset.status flips to the chosen defective state.
      - Asset.defective_since is set to defective_at (only if asset is currently working —
        otherwise the original clock keeps running per business rule).
      - Orange-list entry created.
      - Notifications fan out via broadcast_asset_defect_notifications.
      - Audit-log entry.
    """
    # --- validate body
    status = payload.get("status")
    if status not in ("not_ok", "needs_repair"):
        raise HTTPException(status_code=400, detail="status must be 'not_ok' or 'needs_repair'")
    remarks = (payload.get("remarks") or "").strip()
    if len(remarks) < 10:
        raise HTTPException(status_code=400, detail="Remarks must be at least 10 characters")
    defective_at_raw = payload.get("defective_at")
    if not defective_at_raw:
        raise HTTPException(status_code=400, detail="defective_at is required")
    try:
        # Accept "Z" and "+00:00"
        s = defective_at_raw.replace("Z", "+00:00") if isinstance(defective_at_raw, str) else defective_at_raw
        defective_at = datetime.fromisoformat(s) if isinstance(s, str) else s
        if defective_at.tzinfo is not None:
            defective_at = defective_at.replace(tzinfo=None)
    except Exception:
        raise HTTPException(status_code=400, detail="defective_at must be a valid ISO datetime")
    now = now_ist()
    if defective_at > now + timedelta(minutes=1):
        raise HTTPException(status_code=400, detail="defective_at cannot be in the future")
    performed_by = payload.get("performed_by")
    if not performed_by:
        raise HTTPException(status_code=403, detail="performed_by is required")
    photo_urls = payload.get("photo_urls") or []

    # --- auth gate
    try:
        actor = await users_collection.find_one({"_id": ObjectId(performed_by)})
    except Exception:
        actor = None
    if not actor or actor.get("role") not in (UserRole.ADMIN.value, UserRole.SUPERADMIN.value):
        raise HTTPException(status_code=403, detail="Only Admin or Super Admin can mark assets defective")

    # --- load asset
    try:
        asset = await assets_collection.find_one({"_id": ObjectId(asset_id)})
    except Exception:
        asset = None
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    # --- determine the orange-list / asset clock anchor
    # Rule: if asset is currently working, set defective_since = defective_at.
    # If asset is already defective, KEEP the existing clock running (don't reset).
    asset_was_working = asset.get("status", "working") == "working"
    if asset_was_working:
        new_defective_since = defective_at
    else:
        new_defective_since = asset.get("defective_since") or defective_at

    # --- 1) Synthetic inspection for traceability
    insp_doc = {
        "inspection_type": "manual_marking",
        "inspector_id": performed_by,
        "station_id": asset.get("station_id"),
        "items": [
            {
                "asset_id": asset_id,
                "status": status,
                "remarks": remarks,
                "checklist_responses": [],
                "photo_urls": photo_urls,
                "approval_status": "approved",  # admin/SA action is final, no second-level approval required
                "approved_by": performed_by,
                "approved_at": now,
            }
        ],
        "remarks": f"[Manually marked defective by {actor.get('name') or actor.get('employee_id')}] {remarks}",
        "created_at": defective_at,    # so timeline reflects the failure moment
        "submitted_at": now,
    }
    insp_result = await inspections_collection.insert_one(insp_doc)
    inspection_id = str(insp_result.inserted_id)

    # --- 2) Update asset state
    await assets_collection.update_one(
        {"_id": asset["_id"]},
        {"$set": {
            "status": status,
            "defective_since": new_defective_since,
            "rectified_on": None,
        }},
    )

    # --- 3) Orange-list entry
    ol_doc = {
        "asset_id": asset_id,
        "reported_by": performed_by,
        "inspection_id": inspection_id,
        "defective_since": new_defective_since,
        "status": OrangeListStatus.DEFECTIVE.value,
        "remarks": remarks,
        "list_type": "orange",     # the classifier on read will flip to "red" after 24h
        "created_at": now,
    }
    ol_res = await orange_list_collection.insert_one(ol_doc)
    orange_id = str(ol_res.inserted_id)

    # --- 4) Notifications
    asset_label = asset.get("asset_number") or asset_id
    type_label = ""
    try:
        atype = await asset_types_collection.find_one({"_id": ObjectId(asset.get("asset_type_id"))}) if asset.get("asset_type_id") else None
        if atype:
            type_label = atype.get("name", "")
    except Exception:
        pass
    title = f"Asset marked defective: {asset_label}"
    msg = (
        f"{type_label + ' ' if type_label else ''}{asset_label} was marked "
        f"{'NEEDS REPAIR' if status == 'needs_repair' else 'NOT OK'} by "
        f"{actor.get('name') or actor.get('employee_id')} (defective since "
        f"{new_defective_since.strftime('%d %b %Y, %H:%M')}). Remarks: {remarks}"
    )
    notified = await broadcast_asset_defect_notifications(
        asset,
        title=title,
        message=msg,
        notification_type="alert",
        related_entity_type="orange_list",
        related_entity_id=orange_id,
        performed_by=performed_by,
    )

    # --- 5) Audit log
    await audit_log_collection.insert_one({
        "entity_type": "assets",
        "entity_id": asset_id,
        "action": "manual_mark_defective",
        "performed_by": performed_by,
        "details": {
            "status": status,
            "defective_at": new_defective_since.isoformat(),
            "asset_was_working": asset_was_working,
            "remarks": remarks,
            "inspection_id": inspection_id,
            "orange_list_id": orange_id,
            "notified_count": notified,
        },
        "created_at": now,
    })

    return {
        "message": "Asset marked defective",
        "asset_id": asset_id,
        "inspection_id": inspection_id,
        "orange_list_id": orange_id,
        "defective_since": new_defective_since.isoformat(),
        "notified_count": notified,
    }


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
        "last_inspected": None,
        "next_due": None,
        "defective_since": None,
        "identification_photo": asset.identification_photo or None,
        "geo_lat": asset.geo_lat,
        "geo_lng": asset.geo_lng,
        "created_at": now_ist()
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
    department_id: Optional[str] = None,
    search: Optional[str] = None,
    paginated: bool = False,
    page: int = 1,
    page_size: int = 50,
):
    """List assets with optional pagination + server-side filters/search.

    Backwards-compatible: when `paginated=False` (default) returns a flat list
    capped at 5000 docs. When `paginated=True`, returns
    `{items, total, page, page_size, total_pages}`.

    Filters (all optional):
      - station_id, location_id, asset_type_id, status, department_id
      - search: case-insensitive substring of asset_number
    """
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
        if not type_ids:
            return ([] if not paginated
                    else {"items": [], "total": 0, "page": page, "page_size": page_size, "total_pages": 0})
        # Don't clobber an explicit asset_type_id filter
        if "asset_type_id" in query:
            query["asset_type_id"] = {"$and": [query["asset_type_id"], {"$in": type_ids}]}
        else:
            query["asset_type_id"] = {"$in": type_ids}
    if search:
        query["asset_number"] = {"$regex": search.strip(), "$options": "i"}

    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or 50), 500))

    if not paginated:
        docs = await assets_collection.find(query).to_list(5000)
    else:
        skip = (page - 1) * page_size
        docs = await assets_collection.find(query).sort("asset_number", 1).skip(skip).limit(page_size).to_list(page_size)
    
    # Batch fetch related data
    type_ids = list(set(d["asset_type_id"] for d in docs if d.get("asset_type_id")))
    station_ids = list(set(d["station_id"] for d in docs if d.get("station_id")))
    location_ids = list(set(d["location_id"] for d in docs if d.get("location_id")))
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

    for doc in docs:
        doc["asset_type_name"] = types_map.get(doc["asset_type_id"], "Unknown")
        doc["station_name"] = stations_map.get(doc["station_id"], "Unknown")
        doc["location_name"] = locations_map.get(doc["location_id"], "Unknown")
        doc["checklist"] = types_checklist_map.get(doc["asset_type_id"], [])
        doc["department_id"] = types_dept_map.get(doc["asset_type_id"])
        doc["schedule_frequency"] = _normalize_freq_days(doc.get("schedule_frequency"))

    items_serialized = [serialize_doc(d) for d in docs]
    if not paginated:
        return items_serialized
    total = await assets_collection.count_documents(query)
    total_pages = (total + page_size - 1) // page_size if page_size else 1
    return {
        "items": items_serialized,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


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
        "geo_lat": asset.geo_lat,
        "geo_lng": asset.geo_lng,
    }
    # Only update photo if provided (None means keep existing)
    if asset.identification_photo is not None:
        update_data["identification_photo"] = asset.identification_photo
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
    """Cascade-delete: removes OL entries → remarks; strips from inspection
    items; deletes schedules referencing this asset; finally deletes the asset.
    """
    if not await assets_collection.find_one({"_id": ObjectId(asset_id)}):
        raise HTTPException(status_code=404, detail="Asset not found")
    from routers.data_health import _cascade_delete_assets
    summary = await _cascade_delete_assets([asset_id])
    return {"message": "Asset deleted", "cascade_summary": summary}
