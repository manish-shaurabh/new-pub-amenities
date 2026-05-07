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
    OrangeListCreate, MarkWorkingRequest, ApproveWorkingRequest, RejectWorkingRequest,
    NotificationCreate, ScheduleCreate, ScheduleFrequency,
    UserRole, AssetStatus, OrangeListStatus,
)

router = APIRouter()


# ============ ORANGE LIST / RED LIST ============
# Change 4: Orange List < 24hrs, Red List > 24hrs
@router.get("/api/orange-list")
async def list_orange_items(
    status: Optional[str] = None,
    station_id: Optional[str] = None,
    department_id: Optional[str] = None,
    list_type: Optional[str] = None,  # "orange", "red", or None for all
    for_user_id: Optional[str] = None,
    paginated: bool = False,
    page: int = 1,
    page_size: int = 25,
):
    """List orange/red items.

    When `for_user_id` is provided, role-based scoping kicks in (mirrors the
    inspections endpoint logic) so each user sees only the entries relevant
    to them:

      - SUPERVISOR: only assets assigned to them OR entries they reported.
      - APPROVING_SUPERVISOR: only assets at stations they are assigned to.
      - REPORTING_OFFICER: only assets at their stations whose type belongs
        to their department.
      - ADMIN / SUPERADMIN: no scoping (see everything).
    """
    page_n = max(1, int(page or 1))
    size_n = max(1, min(int(page_size or 25), 200))

    def _empty():
        if not paginated:
            return []
        return {"items": [], "total": 0, "page": page_n, "page_size": size_n, "total_pages": 0}
    query = {}
    if status:
        query["status"] = status
    else:
        query["status"] = {"$ne": OrangeListStatus.RESOLVED.value}

    # ---- Role-based scoping
    scope_asset_ids: Optional[set] = None  # None = no scoping; set = restrict to these
    if for_user_id:
        try:
            user = await users_collection.find_one({"_id": ObjectId(for_user_id)})
        except Exception:
            user = None
        if not user:
            raise HTTPException(status_code=404, detail="for_user_id not found")
        role = user.get("role")
        if role == UserRole.SUPERVISOR.value:
            sup_stations = list(user.get("assigned_stations") or [])
            sup_dept = user.get("department_id")
            if not sup_stations or not sup_dept:
                return _empty()
            sup_types = await asset_types_collection.find(
                {"department_id": sup_dept}, {"_id": 1}
            ).to_list(2000)
            sup_type_ids = [str(t["_id"]) for t in sup_types]
            if not sup_type_ids:
                return _empty()
            mine = await assets_collection.find(
                {"station_id": {"$in": sup_stations}, "asset_type_id": {"$in": sup_type_ids}},
                {"_id": 1}
            ).to_list(20000)
            scope_asset_ids = {str(a["_id"]) for a in mine}
            if not scope_asset_ids:
                return _empty()
            # Strict station+dept scope only — consistent with the dashboard health counts.
            # (Phase 1 removed assigned_supervisor_id; reported_by OR clause is no longer needed.)
            query["asset_id"] = {"$in": list(scope_asset_ids)}
        elif role == UserRole.APPROVING_SUPERVISOR.value:
            asup_stations = list(user.get("assigned_stations") or [])
            if not asup_stations:
                return _empty()
            station_assets = await assets_collection.find(
                {"station_id": {"$in": asup_stations}}, {"_id": 1}
            ).to_list(20000)
            scope_asset_ids = {str(a["_id"]) for a in station_assets}
            if not scope_asset_ids:
                return _empty()
            query["asset_id"] = {"$in": list(scope_asset_ids)}
        elif role == UserRole.REPORTING_OFFICER.value:
            ro_stations = list(user.get("assigned_stations") or [])
            ro_dept = user.get("department_id")
            if not ro_stations or not ro_dept:
                return _empty()
            dept_types = await asset_types_collection.find(
                {"department_id": ro_dept}, {"_id": 1}
            ).to_list(2000)
            type_ids = [str(t["_id"]) for t in dept_types]
            if not type_ids:
                return _empty()
            ro_assets = await assets_collection.find(
                {"asset_type_id": {"$in": type_ids}, "station_id": {"$in": ro_stations}},
                {"_id": 1},
            ).to_list(20000)
            scope_asset_ids = {str(a["_id"]) for a in ro_assets}
            if not scope_asset_ids:
                return _empty()
            query["asset_id"] = {"$in": list(scope_asset_ids)}
        # admin/superadmin: no scoping

    docs = await orange_list_collection.find(query).sort("created_at", -1).to_list(1000)
    
    now = now_ist()
    
    # Batch fetch all related data to avoid N+1 queries
    asset_ids = list(set(doc["asset_id"] for doc in docs if doc.get("asset_id")))
    reporter_ids = list(set(doc["reported_by"] for doc in docs if doc.get("reported_by")))
    
    # Fetch all assets in one query
    assets_map = {}
    if asset_ids:
        assets_docs = await assets_collection.find({"_id": {"$in": [ObjectId(aid) for aid in asset_ids]}}).to_list(5000)
        assets_map = {str(a["_id"]): a for a in assets_docs}
    
    # Collect type/station/location IDs from assets
    type_ids = list(set(a["asset_type_id"] for a in assets_map.values() if a.get("asset_type_id")))
    s_ids = list(set(a["station_id"] for a in assets_map.values() if a.get("station_id")))
    loc_ids = list(set(a["location_id"] for a in assets_map.values() if a.get("location_id")))
    
    # Batch fetch asset types, stations, locations, reporters
    types_map = {}
    if type_ids:
        types_docs = await asset_types_collection.find({"_id": {"$in": [ObjectId(tid) for tid in type_ids]}}).to_list(1000)
        types_map = {str(t["_id"]): t for t in types_docs}
    
    stations_map = {}
    if s_ids:
        stations_docs = await stations_collection.find({"_id": {"$in": [ObjectId(sid) for sid in s_ids]}}).to_list(1000)
        stations_map = {str(s["_id"]): s for s in stations_docs}
    
    locations_map = {}
    if loc_ids:
        locs_docs = await locations_collection.find({"_id": {"$in": [ObjectId(lid) for lid in loc_ids]}}).to_list(1000)
        locations_map = {str(l["_id"]): l for l in locs_docs}
    
    reporters_map = {}
    if reporter_ids:
        reporters_docs = await users_collection.find({"_id": {"$in": [ObjectId(rid) for rid in reporter_ids]}}).to_list(1000)
        reporters_map = {str(r["_id"]): r for r in reporters_docs}
    
    enriched = []
    
    for doc in docs:
        asset = assets_map.get(doc["asset_id"])
        if not asset:
            continue
        if station_id and asset["station_id"] != station_id:
            continue
        
        asset_type = types_map.get(asset.get("asset_type_id", ""))
        if department_id and asset_type and asset_type["department_id"] != department_id:
            continue
        
        station = stations_map.get(asset.get("station_id", ""))
        location = locations_map.get(asset.get("location_id", ""))
        
        # Calculate duration and classify as orange/red.
        # pending_approval items are "yellow" — skip them when filtering by list_type
        # so that ?list_type=orange/red only returns genuinely defective entries.
        if list_type and doc.get("status") == OrangeListStatus.PENDING_APPROVAL.value:
            continue

        defective_since = doc.get("defective_since") or doc.get("created_at")
        if isinstance(defective_since, str):
            try:
                defective_since = datetime.fromisoformat(defective_since)
            except ValueError:
                defective_since = doc.get("created_at", now)
        
        hours_defective = (now - defective_since).total_seconds() / 3600 if defective_since else 0
        is_red = hours_defective > 24
        item_list_type = "red" if is_red else "orange"
        
        # Filter by list_type if specified
        if list_type and list_type != item_list_type:
            continue
        
        doc["asset_info"] = {
            "asset_number": asset.get("asset_number"),
            "asset_type_name": asset_type["name"] if asset_type else "Unknown",
            "station_name": station["name"] if station else "Unknown",
            "station_id": asset["station_id"],
            "location_name": location["name"] if location else "Unknown",
            "location_id": asset["location_id"],
            "department_id": asset_type["department_id"] if asset_type else None
        }
        doc["list_type"] = item_list_type
        doc["hours_defective"] = round(hours_defective, 1)
        doc["defective_since"] = defective_since.isoformat() if defective_since else None
        
        # Get reporter name from batch-fetched map
        reporter = reporters_map.get(doc.get("reported_by", ""))
        doc["reporter_name"] = reporter["name"] if reporter else "Unknown"
        
        enriched.append(serialize_doc(doc))

    if not paginated:
        return enriched

    total = len(enriched)
    start = (page_n - 1) * size_n
    end = start + size_n
    items = enriched[start:end]
    total_pages = (total + size_n - 1) // size_n if size_n else 1
    return {
        "items": items,
        "total": total,
        "page": page_n,
        "page_size": size_n,
        "total_pages": total_pages,
    }


@router.post("/api/orange-list/{item_id}/mark-working")
async def mark_working(item_id: str, request: MarkWorkingRequest):
    item = await orange_list_collection.find_one({"_id": ObjectId(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Orange list item not found")

    if item["status"] != OrangeListStatus.DEFECTIVE.value:
        raise HTTPException(status_code=400, detail="Item is not in defective status")

    # Use user-entered timestamp if provided, otherwise now
    marked_working_dt = request.marked_working_at or now_ist()
    # Coerce to naive IST for storage and comparison
    if hasattr(marked_working_dt, "tzinfo") and marked_working_dt.tzinfo is not None:
        marked_working_dt = marked_working_dt.replace(tzinfo=None)
    # ─── Validation: marked_working_at must be ≥ defective_since and ≤ now ──
    now_n = now_ist()
    if marked_working_dt > now_n + timedelta(minutes=5):
        raise HTTPException(status_code=400, detail="marked_working_at cannot be in the future")
    ds = item.get("defective_since")
    if isinstance(ds, datetime):
        ds_n = ds.replace(tzinfo=None) if ds.tzinfo is not None else ds
        if marked_working_dt < ds_n:
            raise HTTPException(
                status_code=400,
                detail="marked_working_at cannot be earlier than defective_since",
            )

    await orange_list_collection.update_one(
        {"_id": ObjectId(item_id)},
        {"$set": {
            "status": OrangeListStatus.PENDING_APPROVAL.value,
            "marked_working_by": request.marked_by,
            "marked_working_at": marked_working_dt,
            "working_remarks": request.remarks
        }}
    )

    await assets_collection.update_one(
        {"_id": ObjectId(item["asset_id"])},
        {"$set": {"status": AssetStatus.PENDING_APPROVAL.value}}
    )

    # Notify ASUP at that station to verify in field
    asset_doc = await assets_collection.find_one({"_id": ObjectId(item["asset_id"])})
    marker = await users_collection.find_one({"_id": ObjectId(request.marked_by)})
    marker_name = marker.get("name", "Supervisor") if marker else "Supervisor"
    if asset_doc:
        station_id = asset_doc.get("station_id")
        if station_id:
            async for asup in users_collection.find({
                "role": UserRole.APPROVING_SUPERVISOR.value,
                "assigned_stations": station_id,
                "is_active": True,
            }, {"_id": 1}):
                await notifications_collection.insert_one({
                    "user_id": str(asup["_id"]),
                    "title": "Asset Reported Rectified",
                    "message": f"Asset {asset_doc.get('asset_number', 'Unknown')} has been marked working by {marker_name}. Please verify in field.",
                    "notification_type": "info",
                    "related_entity_type": "orange_list",
                    "related_entity_id": item_id,
                    "is_read": False,
                    "created_at": now_ist()
                })

    await audit_log_collection.insert_one({
        "entity_type": "orange_list",
        "entity_id": item_id,
        "action": "marked_working",
        "performed_by": request.marked_by,
        "details": {"remarks": request.remarks, "marked_working_at": marked_working_dt.isoformat()},
        "created_at": now_ist()
    })

    # Auto-log remark
    try:
        from routers.remarks import add_auto_remark
        await add_auto_remark(
            orange_list_id=item_id,
            asset_id=item.get("asset_id"),
            type="rectification",
            text=(request.remarks or "Marked working").strip()[:300],
            author_id=request.marked_by,
            author_name=marker_name,
            author_role=(marker.get("role") if marker else None),
        )
    except Exception as e:
        print(f"[orange_list] auto-remark (mark_working) failed: {e}")

    updated = await orange_list_collection.find_one({"_id": ObjectId(item_id)})
    return serialize_doc(updated)


@router.post("/api/orange-list/{item_id}/reject-working")
async def reject_working(item_id: str, request: RejectWorkingRequest):
    """ASUP rejects a rectification claim — asset goes back to Defective, defect clock continues."""
    item = await orange_list_collection.find_one({"_id": ObjectId(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Orange list item not found")

    if item["status"] != OrangeListStatus.PENDING_APPROVAL.value:
        raise HTTPException(status_code=400, detail="Item is not pending approval")

    rejector = await users_collection.find_one({"_id": ObjectId(request.rejected_by)})
    if not rejector:
        raise HTTPException(status_code=404, detail="Rejector not found")
    if rejector["role"] not in [UserRole.APPROVING_SUPERVISOR.value, UserRole.ADMIN.value, UserRole.SUPERADMIN.value]:
        raise HTTPException(status_code=403, detail="Only approving supervisors or admins can reject")
    if rejector["role"] == UserRole.APPROVING_SUPERVISOR.value:
        asset_doc_check = await assets_collection.find_one({"_id": ObjectId(item["asset_id"])})
        if asset_doc_check:
            asup_stations = list(rejector.get("assigned_stations") or [])
            if asset_doc_check.get("station_id") not in asup_stations:
                raise HTTPException(status_code=403, detail="This station is not under your jurisdiction")

    now = now_ist()
    await orange_list_collection.update_one(
        {"_id": ObjectId(item_id)},
        {"$set": {
            "status": OrangeListStatus.DEFECTIVE.value,
            "last_marked_working_by": item.get("marked_working_by"),   # preserve for analytics
            "marked_working_by": None,
            "marked_working_at": None,
            "working_remarks": None,
            "rejection_remarks": request.remarks,
            "rejected_by": request.rejected_by,
            "rejected_at": now,
        }}
    )

    # Restore asset to defective. Also restore asset.defective_since to match
    # the open OL entry's defective_since so dashboards & profiles stay in sync.
    ol_ds = item.get("defective_since")
    asset_update = {"status": AssetStatus.DEFECTIVE.value}
    if ol_ds:
        asset_update["defective_since"] = ol_ds
    await assets_collection.update_one(
        {"_id": ObjectId(item["asset_id"])},
        {"$set": asset_update}
    )

    # Notify the person who marked it working (SUP)
    if item.get("marked_working_by"):
        asset_doc = await assets_collection.find_one({"_id": ObjectId(item["asset_id"])})
        await notifications_collection.insert_one({
            "user_id": item["marked_working_by"],
            "title": "Rectification Rejected",
            "message": f"Your rectification claim for asset {asset_doc.get('asset_number','Unknown') if asset_doc else 'Unknown'} was rejected by {rejector['name']}. Reason: {request.remarks}. Please re-inspect.",
            "notification_type": "alert",
            "related_entity_type": "orange_list",
            "related_entity_id": item_id,
            "is_read": False,
            "created_at": now
        })
    else:
        asset_doc = await assets_collection.find_one({"_id": ObjectId(item["asset_id"])})

    # Notify ROs scoped to this asset (dept + station)
    if asset_doc:
        station_id = asset_doc.get("station_id")
        asset_type = None
        if asset_doc.get("asset_type_id"):
            asset_type = await asset_types_collection.find_one(
                {"_id": ObjectId(asset_doc["asset_type_id"])}
            )
        dept_id = asset_type.get("department_id") if asset_type else None
        if dept_id and station_id:
            seen_ids = {request.rejected_by, item.get("marked_working_by")} - {None}
            async for ro in users_collection.find({
                "role": UserRole.REPORTING_OFFICER.value,
                "department_id": dept_id,
                "assigned_stations": station_id,
                "is_active": True,
            }, {"_id": 1}):
                ro_id = str(ro["_id"])
                if ro_id in seen_ids:
                    continue
                seen_ids.add(ro_id)
                await notifications_collection.insert_one({
                    "user_id": ro_id,
                    "title": "Rectification Rejected",
                    "message": (
                        f"Rectification of asset {asset_doc.get('asset_number','Unknown')} "
                        f"in your department was rejected by {rejector['name']}. "
                        f"Asset remains defective. Reason: {request.remarks}."
                    ),
                    "notification_type": "alert",
                    "related_entity_type": "orange_list",
                    "related_entity_id": item_id,
                    "is_read": False,
                    "created_at": now
                })

    await audit_log_collection.insert_one({
        "entity_type": "orange_list",
        "entity_id": item_id,
        "action": "rejected_working",
        "performed_by": request.rejected_by,
        "details": {"remarks": request.remarks},
        "created_at": now
    })

    # Auto-log remark
    try:
        from routers.remarks import add_auto_remark
        await add_auto_remark(
            orange_list_id=item_id,
            asset_id=item.get("asset_id"),
            type="rejection",
            text=(request.remarks or "Rectification rejected").strip()[:300],
            author_id=request.rejected_by,
            author_name=rejector.get("name") if rejector else "ASUP",
            author_role=rejector.get("role") if rejector else None,
        )
    except Exception as e:
        print(f"[orange_list] auto-remark (reject_working) failed: {e}")

    updated = await orange_list_collection.find_one({"_id": ObjectId(item_id)})
    return serialize_doc(updated)


@router.post("/api/orange-list/{item_id}/approve")
async def approve_working(item_id: str, request: ApproveWorkingRequest):
    item = await orange_list_collection.find_one({"_id": ObjectId(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Orange list item not found")
    
    if item["status"] != OrangeListStatus.PENDING_APPROVAL.value:
        raise HTTPException(status_code=400, detail="Item is not pending approval")
    
    approver = await users_collection.find_one({"_id": ObjectId(request.approved_by)})
    if not approver:
        raise HTTPException(status_code=404, detail="Approver not found")
    approver_role = approver["role"]
    if approver_role not in [UserRole.APPROVING_SUPERVISOR.value, UserRole.ADMIN.value, UserRole.SUPERADMIN.value]:
        raise HTTPException(status_code=403, detail="Only approving supervisors, admins, or superadmins can approve")
    if approver_role == UserRole.APPROVING_SUPERVISOR.value:
        asset_doc = await assets_collection.find_one({"_id": ObjectId(item["asset_id"])})
        if asset_doc:
            asset_station = asset_doc.get("station_id")
            asup_stations = list(approver.get("assigned_stations") or [])
            if asset_station not in asup_stations:
                raise HTTPException(status_code=403, detail="This station is not under your jurisdiction")
    
    await orange_list_collection.update_one(
        {"_id": ObjectId(item_id)},
        {"$set": {
            "status": OrangeListStatus.RESOLVED.value,
            "approved_by": request.approved_by,
            "approved_at": now_ist(),
            "approval_remarks": request.remarks
        }}
    )
    
    await assets_collection.update_one(
        {"_id": ObjectId(item["asset_id"])},
        {"$set": {"status": AssetStatus.WORKING.value, "defective_since": None}}
    )
    
    await audit_log_collection.insert_one({
        "entity_type": "orange_list",
        "entity_id": item_id,
        "action": "approved_working",
        "performed_by": request.approved_by,
        "details": {"remarks": request.remarks},
        "created_at": now_ist()
    })

    # ── Notifications ──────────────────────────────────────────────────────────
    asset_doc = await assets_collection.find_one({"_id": ObjectId(item["asset_id"])})
    asset_num = asset_doc.get("asset_number", "Unknown") if asset_doc else "Unknown"

    # 1) Notify the supervisor who marked it working
    if item.get("marked_working_by"):
        await notifications_collection.insert_one({
            "user_id": item["marked_working_by"],
            "title": "Rectification Approved",
            "message": (
                f"Your rectification of asset {asset_num} has been approved by "
                f"{approver['name']}. Asset is now marked Working."
            ),
            "notification_type": "info",
            "related_entity_type": "orange_list",
            "related_entity_id": item_id,
            "is_read": False,
            "created_at": now_ist()
        })

    # 2) Notify ROs scoped to this asset (dept + station)
    if asset_doc:
        station_id = asset_doc.get("station_id")
        asset_type = None
        if asset_doc.get("asset_type_id"):
            asset_type = await asset_types_collection.find_one(
                {"_id": ObjectId(asset_doc["asset_type_id"])}
            )
        dept_id = asset_type.get("department_id") if asset_type else None
        if dept_id and station_id:
            seen_ids = {request.approved_by, item.get("marked_working_by")} - {None}
            async for ro in users_collection.find({
                "role": UserRole.REPORTING_OFFICER.value,
                "department_id": dept_id,
                "assigned_stations": station_id,
                "is_active": True,
            }, {"_id": 1}):
                ro_id = str(ro["_id"])
                if ro_id in seen_ids:
                    continue
                seen_ids.add(ro_id)
                await notifications_collection.insert_one({
                    "user_id": ro_id,
                    "title": "Asset Rectification Approved",
                    "message": (
                        f"Asset {asset_num} in your department has been approved as "
                        f"Working by {approver['name']}."
                    ),
                    "notification_type": "info",
                    "related_entity_type": "orange_list",
                    "related_entity_id": item_id,
                    "is_read": False,
                    "created_at": now_ist()
                })
    
    # Auto-log remark
    try:
        from routers.remarks import add_auto_remark
        await add_auto_remark(
            orange_list_id=item_id,
            asset_id=item.get("asset_id"),
            type="approval",
            text=(request.remarks or "Rectification approved").strip()[:300],
            author_id=request.approved_by,
            author_name=approver.get("name") if approver else "ASUP",
            author_role=approver.get("role") if approver else None,
        )
    except Exception as e:
        print(f"[orange_list] auto-remark (approve_working) failed: {e}")

    updated = await orange_list_collection.find_one({"_id": ObjectId(item_id)})
    return serialize_doc(updated)


# Change 4: Export Orange/Red List as Excel
@router.get("/api/orange-list/export/excel")
async def export_orange_list_excel(list_type: Optional[str] = None):
    import openpyxl
    
    items = await list_orange_items(list_type=list_type)
    
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Defective Assets"
    
    # Headers
    headers = ["Asset Number", "Asset Type", "Station", "Location", "Status", "List Type", 
               "Defective Since", "Hours Defective", "Reported By", "Remarks"]
    ws.append(headers)
    
    for item in items:
        ws.append([
            item.get("asset_info", {}).get("asset_number", ""),
            item.get("asset_info", {}).get("asset_type_name", ""),
            item.get("asset_info", {}).get("station_name", ""),
            item.get("asset_info", {}).get("location_name", ""),
            item.get("status", ""),
            item.get("list_type", "").upper(),
            item.get("defective_since", ""),
            item.get("hours_defective", 0),
            item.get("reporter_name", ""),
            item.get("remarks", "")
        ])
    
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"defective_assets_{list_type or 'all'}_{now_ist().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# Change 4: Export Orange/Red List as PDF
@router.get("/api/orange-list/export/pdf")
async def export_orange_list_pdf(list_type: Optional[str] = None):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    
    items = await list_orange_items(list_type=list_type)
    
    output = io.BytesIO()
    doc = SimpleDocTemplate(output, pagesize=landscape(A4))
    elements = []
    styles = getSampleStyleSheet()
    
    # Title
    title = f"{'Red' if list_type == 'red' else 'Orange' if list_type == 'orange' else 'Defective'} List Report - {now_ist().strftime('%d %b %Y')}"
    elements.append(Paragraph(title, styles['Title']))
    elements.append(Spacer(1, 20))
    
    # Table data
    data = [["Asset No.", "Type", "Station", "Location", "List", "Defective Since", "Hours", "Reporter"]]
    for item in items:
        data.append([
            item.get("asset_info", {}).get("asset_number", ""),
            item.get("asset_info", {}).get("asset_type_name", ""),
            item.get("asset_info", {}).get("station_name", ""),
            item.get("asset_info", {}).get("location_name", ""),
            item.get("list_type", "").upper(),
            item.get("defective_since", "")[:16] if item.get("defective_since") else "",
            str(item.get("hours_defective", 0)),
            item.get("reporter_name", "")
        ])
    
    if len(data) > 1:
        table = Table(data)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0e7c6b')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f5f5f5')]),
        ]))
        elements.append(table)
    else:
        elements.append(Paragraph("No defective assets found.", styles['Normal']))
    
    doc.build(elements)
    output.seek(0)
    
    filename = f"defective_assets_{list_type or 'all'}_{now_ist().strftime('%Y%m%d_%H%M')}.pdf"
    return StreamingResponse(
        output,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
