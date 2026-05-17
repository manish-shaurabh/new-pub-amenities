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
    schedules_collection, audit_log_collection, sub_zones_collection,
    asset_code_counters_collection,
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


@router.post("/api/assets/auto-create")
async def auto_create_asset(payload: dict):
    """Canvas-first asset creation.

    Identity is auto-resolved from the drop context:
      sub_zone → location → station → division → zone, and dept from asset_type.
    Asset code is server-generated: {ZONE}-{DIV}-{STN}-{LOC}-[{SZ}-]{TYPE}-{seq}.

    Body:
      asset_type_id (required)
      station_id    (required when sub_zone_id is missing)
      sub_zone_id   (optional — when missing, asset is station-level "unassigned")
      location_id   (optional — auto-derived from sub_zone when present)
      canvas_x, canvas_y (optional floats 0-100)
      description   (optional)
      asset_number_override (optional — when provided, replaces server-generated code)
      total_count   (required for grouped types)
    """
    from asset_code_generator import resolve_hierarchy, generate_asset_code

    asset_type_id = (payload.get("asset_type_id") or "").strip()
    if not asset_type_id:
        raise HTTPException(status_code=400, detail="asset_type_id is required")
    try:
        asset_type = await asset_types_collection.find_one({"_id": ObjectId(asset_type_id)})
    except Exception:
        asset_type = None
    if not asset_type:
        raise HTTPException(status_code=404, detail="Asset type not found")
    if not (asset_type.get("department_id") or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Asset type has no department configured; please fix it in Admin → Asset Types first.",
        )

    sub_zone_id = (payload.get("sub_zone_id") or "").strip() or None
    location_id = (payload.get("location_id") or "").strip() or None
    station_id = (payload.get("station_id") or "").strip() or None

    if not sub_zone_id and not station_id:
        raise HTTPException(status_code=400, detail="station_id is required when sub_zone_id is missing")

    try:
        hierarchy = await resolve_hierarchy(
            station_id=station_id or "",
            location_id=location_id,
            sub_zone_id=sub_zone_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    station = hierarchy["station"]
    location = hierarchy["location"]
    sub_zone = hierarchy["sub_zone"]

    if not station:
        raise HTTPException(status_code=404, detail="Station could not be resolved")

    # Build canonical IDs
    resolved_station_id = str(station["_id"])
    resolved_location_id = str(location["_id"]) if location else None
    resolved_sub_zone_id = str(sub_zone["_id"]) if sub_zone else None

    tracking_mode = (asset_type.get("tracking_mode") or "individual")
    if tracking_mode == "grouped":
        if not resolved_sub_zone_id:
            raise HTTPException(status_code=400, detail="Grouped assets require a sub_zone")
        total_count = payload.get("total_count")
        if not total_count or int(total_count) <= 0:
            raise HTTPException(status_code=400, detail="Grouped assets require total_count > 0")
        total_count = int(total_count)
    else:
        total_count = None

    # Generate or accept asset code
    override = (payload.get("asset_number_override") or "").strip()
    if override:
        # Must be unique
        if await assets_collection.find_one({"asset_number": override}):
            raise HTTPException(status_code=409, detail=f"Asset number '{override}' already exists")
        asset_number = override
    else:
        try:
            asset_number, _ = await generate_asset_code(
                asset_type=asset_type,
                station=station,
                location=location,
                sub_zone=sub_zone,
                division=hierarchy["division"],
                zone=hierarchy["zone"],
            )
        except RuntimeError as e:
            raise HTTPException(status_code=500, detail=str(e))

    # Canvas position (validate range)
    def _clamp(v):
        if v is None:
            return None
        try:
            f = float(v)
        except (TypeError, ValueError):
            return None
        return max(0.0, min(100.0, f))

    canvas_x = _clamp(payload.get("canvas_x"))
    canvas_y = _clamp(payload.get("canvas_y"))

    doc = {
        "asset_type_id": asset_type_id,
        "station_id": resolved_station_id,
        "location_id": resolved_location_id,
        "asset_number": asset_number,
        "status": AssetStatus.WORKING.value,
        "description": (payload.get("description") or "").strip() or None,
        "schedule_frequency": None,
        "last_inspected": None,
        "next_due": None,
        "defective_since": None,
        "identification_photo": None,
        "geo_lat": None,
        "geo_lng": None,
        "tracking_mode": tracking_mode,
        "sub_zone_id": resolved_sub_zone_id,
        "total_count": total_count,
        "needs_repair_count": 0 if tracking_mode == "grouped" else None,
        "not_working_count": 0 if tracking_mode == "grouped" else None,
        "canvas_x": canvas_x,
        "canvas_y": canvas_y,
        "created_at": now_ist(),
    }
    result = await assets_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    # Enrich response for the UI
    out = serialize_doc(doc)
    out["asset_type_name"] = asset_type.get("name", "")
    out["station_name"] = station.get("name", "")
    out["location_name"] = (location or {}).get("name") if location else None
    out["sub_zone_name"] = (sub_zone or {}).get("name") if sub_zone else None
    out["department_id"] = asset_type.get("department_id")
    return out


@router.post("/api/assets/preview-code")
async def preview_asset_code(payload: dict):
    """Preview what the auto-generated asset code WOULD be, without persisting.

    Same body as /api/assets/auto-create. Used by the drop-popover to show a
    suggested code to the user.

    Note: This does NOT consume a sequence number. The actual create call will
    generate a fresh code (which may differ by 1+ if a concurrent create happens).
    """
    from asset_code_generator import resolve_hierarchy, _slug

    asset_type_id = (payload.get("asset_type_id") or "").strip()
    if not asset_type_id:
        raise HTTPException(status_code=400, detail="asset_type_id is required")
    try:
        asset_type = await asset_types_collection.find_one({"_id": ObjectId(asset_type_id)})
    except Exception:
        asset_type = None
    if not asset_type:
        raise HTTPException(status_code=404, detail="Asset type not found")

    sub_zone_id = (payload.get("sub_zone_id") or "").strip() or None
    location_id = (payload.get("location_id") or "").strip() or None
    station_id = (payload.get("station_id") or "").strip() or None

    if not sub_zone_id and not station_id:
        raise HTTPException(status_code=400, detail="station_id is required when sub_zone_id is missing")

    try:
        h = await resolve_hierarchy(
            station_id=station_id or "",
            location_id=location_id,
            sub_zone_id=sub_zone_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    station = h["station"]
    location = h["location"]
    sub_zone = h["sub_zone"]
    division = h["division"]
    zone = h["zone"]
    if not station:
        raise HTTPException(status_code=404, detail="Station could not be resolved")

    zone_tok = _slug(zone.get("code") or zone.get("name") if zone else "", fallback="ZX", max_len=6)
    div_tok = _slug(division.get("code") or division.get("name") if division else "", fallback="DX", max_len=6)
    stn_tok = _slug(station.get("code") or station.get("name") if station else "", fallback="STN", max_len=8)
    loc_tok = _slug(location.get("code") or location.get("name") if location else "", fallback="STN", max_len=8)
    sz_tok = _slug(sub_zone.get("code") or sub_zone.get("name") if sub_zone else "", fallback="", max_len=6)
    type_tok = _slug(asset_type.get("code") or asset_type.get("name") or "", fallback="TYP", max_len=8)
    parts = [zone_tok, div_tok, stn_tok, loc_tok]
    if sz_tok:
        parts.append(sz_tok)
    parts.append(type_tok)
    bucket = ":".join(parts)
    # Read counter without incrementing
    cur = await asset_code_counters_collection.find_one({"_id": bucket})
    next_seq = int(cur.get("seq", 0)) + 1 if cur else 1
    code_preview = "-".join(parts) + f"-{next_seq:04d}"
    return {
        "preview_code": code_preview,
        "context": {
            "zone": zone.get("name") if zone else None,
            "division": division.get("name") if division else None,
            "station": station.get("name") if station else None,
            "location": location.get("name") if location else None,
            "sub_zone": sub_zone.get("name") if sub_zone else None,
            "asset_type": asset_type.get("name"),
            "department_id": asset_type.get("department_id"),
            "tracking_mode": asset_type.get("tracking_mode") or "individual",
        },
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

    tracking_mode = asset_type.get("tracking_mode") or "individual"
    asset_number = (asset.asset_number or "").strip()

    sub_zone_doc = None
    if tracking_mode == "grouped":
        # Grouped assets MUST have sub_zone + positive total_count.
        if not asset.sub_zone_id:
            raise HTTPException(status_code=400, detail="Grouped assets require a sub_zone_id")
        if not asset.total_count or int(asset.total_count) <= 0:
            raise HTTPException(status_code=400, detail="Grouped assets require total_count > 0")
        sub_zone_doc = await sub_zones_collection.find_one({"_id": ObjectId(asset.sub_zone_id)})
        if not sub_zone_doc:
            raise HTTPException(status_code=404, detail="Sub-zone not found")
        if str(sub_zone_doc.get("location_id") or "") != asset.location_id:
            raise HTTPException(status_code=400, detail="Sub-zone does not belong to the chosen location")
        # Auto-generate canonical asset_number: TYPE-STATION-LOCATION-SUBZONE
        def _slug(s: str) -> str:
            return "".join(ch.upper() if ch.isalnum() else "-"
                           for ch in (s or "").strip())[:24].strip("-") or "X"
        type_slug = _slug(asset_type.get("name") or "")
        stn_slug = _slug(station.get("code") or station.get("name") or "")
        loc_slug = _slug(location.get("name") or "")
        sub_slug = _slug(sub_zone_doc.get("code") or sub_zone_doc.get("name") or "")
        asset_number = f"{type_slug}-{stn_slug}-{loc_slug}-{sub_slug}"
        # Enforce uniqueness — append numeric suffix on conflict
        base = asset_number
        n = 1
        while await assets_collection.find_one({"asset_number": asset_number}):
            n += 1
            asset_number = f"{base}-{n}"
    else:
        if not asset_number:
            raise HTTPException(status_code=400, detail="asset_number is required for individual assets")
        # Individual assets MAY optionally belong to a sub-zone for inspection
        # navigation. Validate it lives in the chosen location if provided.
        if asset.sub_zone_id:
            sub_zone_doc = await sub_zones_collection.find_one({"_id": ObjectId(asset.sub_zone_id)})
            if not sub_zone_doc:
                raise HTTPException(status_code=404, detail="Sub-zone not found")
            if str(sub_zone_doc.get("location_id") or "") != asset.location_id:
                raise HTTPException(status_code=400, detail="Sub-zone does not belong to the chosen location")

    doc = {
        "asset_type_id": asset.asset_type_id,
        "station_id": asset.station_id,
        "location_id": asset.location_id,
        "asset_number": asset_number,
        "status": AssetStatus.WORKING.value,
        "description": asset.description,
        "schedule_frequency": asset.schedule_frequency if asset.schedule_frequency else None,
        "last_inspected": None,
        "next_due": None,
        "defective_since": None,
        "identification_photo": asset.identification_photo or None,
        "geo_lat": asset.geo_lat,
        "geo_lng": asset.geo_lng,
        "tracking_mode": tracking_mode,
        "sub_zone_id": asset.sub_zone_id or None,
        "total_count": int(asset.total_count) if tracking_mode == "grouped" else None,
        "needs_repair_count": 0 if tracking_mode == "grouped" else None,
        "not_working_count": 0 if tracking_mode == "grouped" else None,
        "canvas_x": asset.canvas_x,
        "canvas_y": asset.canvas_y,
        "created_at": now_ist()
    }
    result = await assets_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@router.get("/api/assets")
async def list_assets(
    station_id: Optional[str] = None,
    location_id: Optional[str] = None,
    sub_zone_id: Optional[str] = None,
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
      - station_id, location_id, sub_zone_id, asset_type_id, status, department_id
      - search: case-insensitive substring of asset_number
    """
    query = {}
    if station_id:
        query["station_id"] = station_id
    if location_id:
        query["location_id"] = location_id
    if sub_zone_id:
        query["sub_zone_id"] = sub_zone_id
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
    sub_zone_ids = list(set(d.get("sub_zone_id") for d in docs if d.get("sub_zone_id")))
    types_map = {}
    types_checklist_map = {}
    types_dept_map = {}
    types_mode_map = {}
    if type_ids:
        types_docs = await asset_types_collection.find({"_id": {"$in": [ObjectId(tid) for tid in type_ids]}}).to_list(1000)
        types_map = {str(t["_id"]): t["name"] for t in types_docs}
        types_checklist_map = {str(t["_id"]): t.get("checklist", []) for t in types_docs}
        types_dept_map = {str(t["_id"]): t.get("department_id") for t in types_docs}
        types_mode_map = {str(t["_id"]): (t.get("tracking_mode") or "individual") for t in types_docs}
    stations_map = {}
    if station_ids:
        stations_docs = await stations_collection.find({"_id": {"$in": [ObjectId(sid) for sid in station_ids]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in stations_docs}
    locations_map = {}
    if location_ids:
        locs_docs = await locations_collection.find({"_id": {"$in": [ObjectId(lid) for lid in location_ids]}}).to_list(1000)
        locations_map = {str(l["_id"]): l["name"] for l in locs_docs}
    sub_zones_map = {}
    if sub_zone_ids:
        sz_docs = await sub_zones_collection.find({"_id": {"$in": [ObjectId(zid) for zid in sub_zone_ids]}}).to_list(1000)
        sub_zones_map = {str(z["_id"]): z.get("name") for z in sz_docs}

    for doc in docs:
        doc["asset_type_name"] = types_map.get(doc["asset_type_id"], "Unknown")
        doc["station_name"] = stations_map.get(doc["station_id"], "Unknown")
        doc["location_name"] = locations_map.get(doc["location_id"], "Unknown")
        doc["checklist"] = types_checklist_map.get(doc["asset_type_id"], [])
        doc["department_id"] = types_dept_map.get(doc["asset_type_id"])
        # Tracking-mode and grouped enrichment
        doc["tracking_mode"] = doc.get("tracking_mode") or types_mode_map.get(doc["asset_type_id"], "individual")
        if doc.get("sub_zone_id"):
            doc["sub_zone_name"] = sub_zones_map.get(doc["sub_zone_id"], "—")
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
    doc["tracking_mode"] = doc.get("tracking_mode") or (asset_type.get("tracking_mode") if asset_type else "individual") or "individual"
    if doc.get("sub_zone_id"):
        sz = await sub_zones_collection.find_one({"_id": ObjectId(doc["sub_zone_id"])})
        doc["sub_zone_name"] = sz.get("name") if sz else "—"
    doc["schedule_frequency"] = _normalize_freq_days(doc.get("schedule_frequency"))
    return serialize_doc(doc)


# Change 5: Asset EDIT endpoint
@router.put("/api/assets/{asset_id}")
async def update_asset(asset_id: str, asset: AssetCreate):
    existing = await assets_collection.find_one({"_id": ObjectId(asset_id)})
    if not existing:
        raise HTTPException(status_code=404, detail="Asset not found")
    tracking_mode = existing.get("tracking_mode") or "individual"
    update_data = {
        "asset_type_id": asset.asset_type_id,
        "station_id": asset.station_id,
        "location_id": asset.location_id,
        "description": asset.description,
        "schedule_frequency": asset.schedule_frequency if asset.schedule_frequency else None,
        "geo_lat": asset.geo_lat,
        "geo_lng": asset.geo_lng,
    }
    # For grouped assets, allow editing sub_zone + total_count; asset_number stays auto-generated.
    if tracking_mode == "grouped":
        if asset.sub_zone_id:
            update_data["sub_zone_id"] = asset.sub_zone_id
        if asset.total_count is not None:
            if int(asset.total_count) <= 0:
                raise HTTPException(status_code=400, detail="total_count must be > 0")
            update_data["total_count"] = int(asset.total_count)
    else:
        # Individual asset — allow renaming + optional sub_zone assignment
        if asset.asset_number:
            update_data["asset_number"] = asset.asset_number
        # Validate sub_zone matches target location when provided
        target_loc = asset.location_id or existing.get("location_id")
        if asset.sub_zone_id:
            sz = await sub_zones_collection.find_one({"_id": ObjectId(asset.sub_zone_id)})
            if not sz:
                raise HTTPException(status_code=404, detail="Sub-zone not found")
            if str(sz.get("location_id") or "") != target_loc:
                raise HTTPException(status_code=400, detail="Sub-zone does not belong to the chosen location")
            update_data["sub_zone_id"] = asset.sub_zone_id
        else:
            # Allow explicit clear by sending null
            update_data["sub_zone_id"] = None
    # Only update photo if provided (None means keep existing)
    if asset.identification_photo is not None:
        update_data["identification_photo"] = asset.identification_photo
    # Canvas position — always update (None clears the position)
    if asset.canvas_x is not None or asset.canvas_y is not None:
        update_data["canvas_x"] = asset.canvas_x
        update_data["canvas_y"] = asset.canvas_y
    result = await assets_collection.update_one(
        {"_id": ObjectId(asset_id)},
        {"$set": update_data}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    doc = await assets_collection.find_one({"_id": ObjectId(asset_id)})
    doc["schedule_frequency"] = _normalize_freq_days(doc.get("schedule_frequency"))
    return serialize_doc(doc)


@router.patch("/api/assets/{asset_id}/status")
async def patch_asset_status(asset_id: str, payload: dict):
    """Update an asset's lifecycle status (e.g. mark/unmark as missing).

    Body: { status: "working" | "missing" }

    Use specialised endpoints for `not_ok` / `needs_repair` (mark-defective)
    and for inspection approvals. This endpoint is for simple toggles only.
    """
    new_status = (payload or {}).get("status")
    if new_status not in ("working", "missing"):
        raise HTTPException(
            status_code=400,
            detail="status must be 'working' or 'missing'",
        )
    existing = await assets_collection.find_one({"_id": ObjectId(asset_id)})
    if not existing:
        raise HTTPException(status_code=404, detail="Asset not found")
    await assets_collection.update_one(
        {"_id": ObjectId(asset_id)},
        {"$set": {"status": new_status}},
    )
    doc = await assets_collection.find_one({"_id": ObjectId(asset_id)})
    return serialize_doc(doc)


@router.patch("/api/assets/bulk/sub-zone")
async def bulk_assign_sub_zone(payload: dict):
    """Bulk-assign (or clear) a sub-zone for a list of INDIVIDUAL assets.

    Body: { asset_ids: [str], sub_zone_id: str | null }

    Constraints:
      • All assets must share the same `location_id`.
      • If `sub_zone_id` is given, the sub-zone must belong to that location.
      • Grouped assets are excluded (their sub_zone_id is structural).

    Returns: { matched, modified, skipped_grouped }
    """
    asset_ids = payload.get("asset_ids") or []
    sub_zone_id = payload.get("sub_zone_id")
    if not asset_ids or not isinstance(asset_ids, list):
        raise HTTPException(status_code=400, detail="asset_ids (non-empty list) is required")
    try:
        oids = [ObjectId(a) for a in asset_ids]
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid asset_id format")
    docs = await assets_collection.find({"_id": {"$in": oids}}).to_list(len(oids))
    if not docs:
        raise HTTPException(status_code=404, detail="No assets found")
    # All targeted assets must share location
    locs = {d.get("location_id") for d in docs}
    if len(locs) != 1:
        raise HTTPException(status_code=400, detail="All selected assets must belong to the same location")
    target_location = next(iter(locs))
    # Validate sub_zone if provided
    if sub_zone_id:
        sz = await sub_zones_collection.find_one({"_id": ObjectId(sub_zone_id)})
        if not sz:
            raise HTTPException(status_code=404, detail="Sub-zone not found")
        if str(sz.get("location_id") or "") != target_location:
            raise HTTPException(status_code=400, detail="Sub-zone does not belong to the assets' location")
    # Exclude grouped — their sub_zone is structural and shouldn't be reassigned in bulk.
    eligible_ids = [d["_id"] for d in docs if (d.get("tracking_mode") or "individual") != "grouped"]
    skipped_grouped = len(docs) - len(eligible_ids)
    if not eligible_ids:
        return {"matched": 0, "modified": 0, "skipped_grouped": skipped_grouped}
    result = await assets_collection.update_many(
        {"_id": {"$in": eligible_ids}},
        {"$set": {"sub_zone_id": sub_zone_id or None}}
    )
    return {
        "matched": result.matched_count,
        "modified": result.modified_count,
        "skipped_grouped": skipped_grouped,
    }


@router.patch("/api/assets/bulk/canvas")
async def bulk_update_canvas_positions(payload: dict):
    """Bulk-update canvas_x / canvas_y for a list of assets.

    Body: { positions: [ { asset_id, canvas_x, canvas_y } ] }
    canvas_x/canvas_y are floats 0-100 (percentage of sub-zone canvas).
    Pass null to clear a position.
    """
    positions = payload.get("positions") or []
    if not isinstance(positions, list):
        raise HTTPException(status_code=400, detail="positions must be a list")
    updated = 0
    for item in positions:
        aid = item.get("asset_id")
        if not aid:
            continue
        try:
            oid = ObjectId(aid)
        except Exception:
            continue
        cx = item.get("canvas_x")
        cy = item.get("canvas_y")
        await assets_collection.update_one(
            {"_id": oid},
            {"$set": {"canvas_x": cx, "canvas_y": cy}},
        )
        updated += 1
    return {"updated": updated}


@router.patch("/api/assets/{asset_id}/canvas")
async def update_asset_canvas_position(asset_id: str, payload: dict):
    """Update canvas position for a single asset."""
    try:
        oid = ObjectId(asset_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid asset_id")
    doc = await assets_collection.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Asset not found")
    await assets_collection.update_one(
        {"_id": oid},
        {"$set": {"canvas_x": payload.get("canvas_x"), "canvas_y": payload.get("canvas_y")}},
    )
    return {"ok": True, "canvas_x": payload.get("canvas_x"), "canvas_y": payload.get("canvas_y")}


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
