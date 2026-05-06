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
from helpers import _normalize_freq_days


# ============ INSPECTIONS ============
@router.post("/api/inspections")
async def create_inspection(inspection: InspectionCreate):
    """Submit an inspection. Effects (defect creation, yellow-list trigger) are applied
    immediately on submission — no ASUP approval gate on individual items."""
    inspector = await users_collection.find_one({"_id": ObjectId(inspection.inspector_id)})
    if not inspector:
        raise HTTPException(status_code=404, detail="Inspector not found")

    items_data = []
    for item in inspection.items:
        item_dict = item.model_dump()
        item_dict["approval_status"] = "auto_applied"
        item_dict["reviewed_by"] = None
        item_dict["reviewed_at"] = None
        item_dict["reviewer_remarks"] = None
        items_data.append(item_dict)

    # Resolve participant names for SIG
    participants_data = []
    if inspection.inspection_type == "sig" and inspection.participants:
        for emp_id in inspection.participants:
            participant = await users_collection.find_one({"employee_id": emp_id})
            if participant:
                participants_data.append({
                    "employee_id": emp_id,
                    "name": participant["name"],
                    "role": participant["role"]
                })
            else:
                participants_data.append({"employee_id": emp_id, "name": "Unknown", "role": "unknown"})

    doc = {
        "inspection_type": inspection.inspection_type.value,
        "station_id": inspection.station_id,
        "inspector_id": inspection.inspector_id,
        "inspector_name": inspector["name"],
        "items": items_data,
        "participants": participants_data,
        "overall_remarks": inspection.overall_remarks,
        "inspection_at": inspection.inspection_at or datetime.utcnow().isoformat(),
        "created_at": datetime.utcnow()
    }
    result = await inspections_collection.insert_one(doc)
    inspection_id = str(result.inserted_id)
    doc["_id"] = result.inserted_id

    # Apply effects immediately for all items
    for item in items_data:
        await _apply_inspection_item_effects(doc, item, inspection.inspector_id)

    # Notify ASUP and Admins that a new inspection was submitted (informational)
    station_doc = await stations_collection.find_one({"_id": ObjectId(inspection.station_id)})
    station_name = station_doc.get("name") if station_doc else "Unknown station"

    notify_user_ids = set()
    # ASUPs whose assigned_stations includes this station
    async for asup in users_collection.find({
        "role": UserRole.APPROVING_SUPERVISOR.value,
        "assigned_stations": inspection.station_id,
        "is_active": True,
    }, {"_id": 1}):
        notify_user_ids.add(str(asup["_id"]))
    admins = await users_collection.find({
        "role": {"$in": [UserRole.ADMIN.value, UserRole.SUPERADMIN.value]},
        "is_active": True,
    }).to_list(50)
    for a in admins:
        notify_user_ids.add(str(a["_id"]))
    notify_user_ids.discard(inspection.inspector_id)

    not_ok_count = sum(
        1 for it in items_data
        if it.get("status") in (InspectionItemStatus.NOT_OK.value, InspectionItemStatus.NEEDS_REPAIR.value)
    )

    for uid in notify_user_ids:
        msg = f"{inspector['name']} submitted an inspection at {station_name}."
        if not_ok_count:
            msg += f" {not_ok_count} defect(s) recorded."
        await notifications_collection.insert_one({
            "user_id": uid,
            "title": "Inspection Submitted",
            "message": msg,
            "notification_type": "info",
            "related_entity_type": "inspection",
            "related_entity_id": inspection_id,
            "is_read": False,
            "created_at": datetime.utcnow()
        })

    # Audit log
    await audit_log_collection.insert_one({
        "entity_type": "inspection",
        "entity_id": inspection_id,
        "action": "submitted",
        "performed_by": inspection.inspector_id,
        "details": {"item_count": len(items_data), "station_id": inspection.station_id, "defects": not_ok_count},
        "created_at": datetime.utcnow()
    })

    return serialize_doc(doc)


# ===== Approval helpers =====
async def _apply_inspection_item_effects(inspection_doc: dict, item: dict, reviewer_id: str):
    """Apply asset / orange-list state changes immediately when an inspection is submitted.

    • NOT_OK / NEEDS_REPAIR  → asset defective + open orange-list entry
    • OK (asset was defective) → move orange-list entry to pending_approval (Yellow List)
    • OK (asset was working)  → only update last_inspected / next_due
    """
    asset_id = item["asset_id"]
    inspection_id = str(inspection_doc["_id"])
    inspector_id = inspection_doc["inspector_id"]
    item_status = item.get("status")

    if item_status in (InspectionItemStatus.NOT_OK.value, InspectionItemStatus.NEEDS_REPAIR.value):
        # ── Defective path ──────────────────────────────────────────────────────
        defective_since = item.get("defective_since")
        if defective_since:
            try:
                defective_since_dt = datetime.fromisoformat(
                    defective_since.replace('Z', '+00:00').replace('+00:00', '')
                )
            except (ValueError, AttributeError):
                defective_since_dt = datetime.utcnow()
        else:
            defective_since_dt = datetime.utcnow()

        await assets_collection.update_one(
            {"_id": ObjectId(asset_id)},
            {"$set": {
                "status": AssetStatus.DEFECTIVE.value,
                "defective_since": defective_since_dt,
            }}
        )

        existing = await orange_list_collection.find_one({
            "asset_id": asset_id,
            "status": {"$ne": OrangeListStatus.RESOLVED.value}
        })
        if not existing:
            remarks_text = item.get("remarks") or "Marked defective during inspection"
            await orange_list_collection.insert_one({
                "asset_id": asset_id,
                "inspection_id": inspection_id,
                "reported_by": inspector_id,
                "status": OrangeListStatus.DEFECTIVE.value,
                "defective_since": defective_since_dt,
                "remarks": remarks_text,
                "marked_working_by": None,
                "marked_working_at": None,
                "approved_by": None,
                "approved_at": None,
                "created_at": datetime.utcnow()
            })

        # Notify supervisors / ROs / ASUPs
        asset = await assets_collection.find_one({"_id": ObjectId(asset_id)})
        if asset:
            asset_type = await asset_types_collection.find_one({"_id": ObjectId(asset["asset_type_id"])})
            dept_id = asset_type["department_id"] if asset_type else None
            station_id = asset["station_id"]
            targets = []
            if dept_id:
                targets += await users_collection.find({
                    "role": UserRole.SUPERVISOR.value, "department_id": dept_id, "assigned_stations": station_id
                }).to_list(100)
                targets += await users_collection.find({
                    "role": UserRole.REPORTING_OFFICER.value, "department_id": dept_id, "assigned_stations": station_id
                }).to_list(100)
            seen = set()
            for t in targets:
                tid = str(t["_id"])
                if tid in seen or tid == inspector_id:
                    continue
                seen.add(tid)
                await notifications_collection.insert_one({
                    "user_id": tid,
                    "title": "Asset Marked Defective",
                    "message": f"Asset {asset.get('asset_number','Unknown')} ({asset_type['name'] if asset_type else 'Unknown'}) marked defective since {defective_since_dt.strftime('%d-%b-%Y %H:%M')}.",
                    "notification_type": "alert",
                    "related_entity_type": "orange_list",
                    "related_entity_id": asset_id,
                    "is_read": False,
                    "created_at": datetime.utcnow()
                })

    elif item_status == InspectionItemStatus.OK.value:
        # ── OK path — check if asset was previously defective ──────────────────
        asset_doc = await assets_collection.find_one({"_id": ObjectId(asset_id)})
        if asset_doc and asset_doc.get("status") == AssetStatus.DEFECTIVE.value:
            # Supervisor rectified a defective asset → move orange list entry to Yellow List
            rectified_on = item.get("rectified_on")
            if rectified_on:
                try:
                    rectified_dt = datetime.fromisoformat(
                        rectified_on.replace('Z', '+00:00').replace('+00:00', '')
                    )
                except (ValueError, AttributeError):
                    rectified_dt = datetime.utcnow()
            else:
                rectified_dt = datetime.utcnow()

            open_entry = await orange_list_collection.find_one({
                "asset_id": asset_id,
                "status": OrangeListStatus.DEFECTIVE.value
            })
            if open_entry:
                await orange_list_collection.update_one(
                    {"_id": open_entry["_id"]},
                    {"$set": {
                        "status": OrangeListStatus.PENDING_APPROVAL.value,
                        "marked_working_by": inspector_id,
                        "marked_working_at": rectified_dt,
                        "working_remarks": item.get("remarks") or "Marked working during inspection",
                        "inspection_id_rectified": inspection_id,
                    }}
                )

            await assets_collection.update_one(
                {"_id": ObjectId(asset_id)},
                {"$set": {"status": AssetStatus.PENDING_APPROVAL.value}}
            )

            # Notify ASUP at that station to verify in field
            station_id = asset_doc.get("station_id")
            if station_id:
                asup_notified = set()
                async for asup in users_collection.find({
                    "role": UserRole.APPROVING_SUPERVISOR.value,
                    "assigned_stations": station_id,
                    "is_active": True,
                }, {"_id": 1, "name": 1}):
                    asup_id_str = str(asup["_id"])
                    if asup_id_str in asup_notified:
                        continue
                    asup_notified.add(asup_id_str)
                    await notifications_collection.insert_one({
                        "user_id": asup_id_str,
                        "title": "Asset Reported Rectified",
                        "message": f"Asset {asset_doc.get('asset_number','Unknown')} at station has been reported working by {inspection_doc.get('inspector_name','Inspector')}. Please verify in field.",
                        "notification_type": "info",
                        "related_entity_type": "orange_list",
                        "related_entity_id": asset_id,
                        "is_read": False,
                        "created_at": datetime.utcnow()
                    })

    # Update last_inspected and next_due for all items
    now_ts = datetime.utcnow()
    update_fields = {"last_inspected": now_ts}
    asset_doc2 = await assets_collection.find_one({"_id": ObjectId(asset_id)})
    if asset_doc2:
        freq_days = _normalize_freq_days(asset_doc2.get("schedule_frequency"))
        if freq_days and freq_days > 0:
            update_fields["next_due"] = now_ts + timedelta(days=freq_days)
    await assets_collection.update_one({"_id": ObjectId(asset_id)}, {"$set": update_fields})

    await audit_log_collection.insert_one({
        "entity_type": "inspection_item",
        "entity_id": f"{inspection_id}:{asset_id}",
        "action": "auto_applied",
        "performed_by": reviewer_id,
        "details": {"inspection_id": inspection_id, "asset_id": asset_id, "item_status": item_status},
        "created_at": datetime.utcnow()
    })


async def _can_review_inspection(reviewer: dict, inspection_doc: dict) -> bool:
    """Allowed reviewers: Superadmin, Admin, or the Approving Supervisor for the station."""
    if not reviewer:
        return False
    role = reviewer.get("role")
    if role in (UserRole.SUPERADMIN.value, UserRole.ADMIN.value):
        return True
    if role == UserRole.APPROVING_SUPERVISOR.value:
        station_id = inspection_doc.get("station_id")
        if station_id:
            station = await stations_collection.find_one({"_id": ObjectId(station_id)})
            if station and station.get("approving_supervisor_id") == str(reviewer["_id"]):
                return True
    return False


@router.post("/api/inspections/{inspection_id}/items/{item_index}/approve")
async def approve_inspection_item(inspection_id: str, item_index: int, payload: dict):
    """Mark a single inspection item as Pass. Body: {reviewer_id, remarks?}."""
    reviewer_id = payload.get("reviewer_id")
    remarks = payload.get("remarks")
    if not reviewer_id:
        raise HTTPException(status_code=400, detail="reviewer_id is required")
    try:
        insp = await inspections_collection.find_one({"_id": ObjectId(inspection_id)})
        reviewer = await users_collection.find_one({"_id": ObjectId(reviewer_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid id format")
    if not insp:
        raise HTTPException(status_code=404, detail="Inspection not found")
    if not reviewer:
        raise HTTPException(status_code=404, detail="Reviewer not found")
    if not await _can_review_inspection(reviewer, insp):
        raise HTTPException(status_code=403, detail="You are not authorized to review this inspection")
    items = insp.get("items", [])
    if item_index < 0 or item_index >= len(items):
        raise HTTPException(status_code=404, detail="Item index out of range")
    item = items[item_index]
    if item.get("approval_status") != "pending_approval":
        raise HTTPException(status_code=400, detail=f"Item already {item.get('approval_status')}")

    # Apply effects then mark item approved
    await _apply_inspection_item_effects(insp, item, reviewer_id)
    items[item_index]["approval_status"] = "approved"
    items[item_index]["reviewed_by"] = reviewer_id
    items[item_index]["reviewed_at"] = datetime.utcnow()
    items[item_index]["reviewer_remarks"] = remarks
    await inspections_collection.update_one(
        {"_id": ObjectId(inspection_id)},
        {"$set": {"items": items}}
    )

    # Notify the original inspector
    await notifications_collection.insert_one({
        "user_id": insp["inspector_id"],
        "title": "Inspection Item Approved",
        "message": f"Your inspection item for asset {item.get('asset_id')} was approved by {reviewer['name']}.",
        "notification_type": "info",
        "related_entity_type": "inspection",
        "related_entity_id": inspection_id,
        "is_read": False,
        "created_at": datetime.utcnow()
    })

    return {"message": "Item approved", "inspection_id": inspection_id, "item_index": item_index}


@router.post("/api/inspections/{inspection_id}/items/{item_index}/reject")
async def reject_inspection_item(inspection_id: str, item_index: int, payload: dict):
    """Mark a single inspection item as Fail. Body: {reviewer_id, remarks?}.
    Asset state is NOT changed; if the asset was already defective, its original
    defective_since is preserved. The gap between submission and rejection is logged."""
    reviewer_id = payload.get("reviewer_id")
    remarks = payload.get("remarks")
    if not reviewer_id:
        raise HTTPException(status_code=400, detail="reviewer_id is required")
    try:
        insp = await inspections_collection.find_one({"_id": ObjectId(inspection_id)})
        reviewer = await users_collection.find_one({"_id": ObjectId(reviewer_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid id format")
    if not insp:
        raise HTTPException(status_code=404, detail="Inspection not found")
    if not reviewer:
        raise HTTPException(status_code=404, detail="Reviewer not found")
    if not await _can_review_inspection(reviewer, insp):
        raise HTTPException(status_code=403, detail="You are not authorized to review this inspection")
    items = insp.get("items", [])
    if item_index < 0 or item_index >= len(items):
        raise HTTPException(status_code=404, detail="Item index out of range")
    item = items[item_index]
    if item.get("approval_status") != "pending_approval":
        raise HTTPException(status_code=400, detail=f"Item already {item.get('approval_status')}")

    submission_time = insp.get("created_at") or datetime.utcnow()
    rejection_time = datetime.utcnow()
    gap_seconds = max(0, int((rejection_time - submission_time).total_seconds()))

    items[item_index]["approval_status"] = "rejected"
    items[item_index]["reviewed_by"] = reviewer_id
    items[item_index]["reviewed_at"] = rejection_time
    items[item_index]["reviewer_remarks"] = remarks
    items[item_index]["gap_seconds"] = gap_seconds
    await inspections_collection.update_one(
        {"_id": ObjectId(inspection_id)},
        {"$set": {"items": items}}
    )

    # Audit log captures the gap-time
    await audit_log_collection.insert_one({
        "entity_type": "inspection_item",
        "entity_id": f"{inspection_id}:{item.get('asset_id')}",
        "action": "rejected",
        "performed_by": reviewer_id,
        "details": {
            "inspection_id": inspection_id,
            "asset_id": item.get("asset_id"),
            "item_status": item.get("status"),
            "submitted_at": submission_time.isoformat() if hasattr(submission_time, 'isoformat') else str(submission_time),
            "rejected_at": rejection_time.isoformat(),
            "gap_seconds": gap_seconds,
            "reviewer_remarks": remarks,
        },
        "created_at": rejection_time
    })

    # Notify the original inspector
    await notifications_collection.insert_one({
        "user_id": insp["inspector_id"],
        "title": "Inspection Item Rejected",
        "message": f"Your inspection item for asset {item.get('asset_id')} was rejected by {reviewer['name']}. Re-inspect the asset.",
        "notification_type": "alert",
        "related_entity_type": "inspection",
        "related_entity_id": inspection_id,
        "is_read": False,
        "created_at": datetime.utcnow()
    })

    return {
        "message": "Item rejected",
        "inspection_id": inspection_id,
        "item_index": item_index,
        "gap_seconds": gap_seconds,
    }


@router.get("/api/inspections/pending-approvals")
async def list_pending_approvals(reviewer_id: str = Query(...)):
    """Return inspection items pending Pass/Fail for this reviewer.
    - Approving Supervisor: items at stations where they are the assigned ASUP.
    - Superadmin / Admin: all pending items.
    """
    try:
        reviewer = await users_collection.find_one({"_id": ObjectId(reviewer_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid reviewer_id")
    if not reviewer:
        raise HTTPException(status_code=404, detail="Reviewer not found")

    role = reviewer.get("role")
    station_filter = None
    if role == UserRole.APPROVING_SUPERVISOR.value:
        stations = await stations_collection.find(
            {"approving_supervisor_id": reviewer_id}
        ).to_list(1000)
        station_ids = [str(s["_id"]) for s in stations]
        if not station_ids:
            return {"reviewer_id": reviewer_id, "total_items": 0, "inspections": []}
        station_filter = {"$in": station_ids}
    elif role not in (UserRole.SUPERADMIN.value, UserRole.ADMIN.value):
        raise HTTPException(status_code=403, detail="Not authorized to review inspections")

    query = {"items.approval_status": "pending_approval"}
    if station_filter is not None:
        query["station_id"] = station_filter

    insps = await inspections_collection.find(query).sort("created_at", -1).to_list(500)

    # Pre-fetch related lookups
    asset_ids = list({it["asset_id"] for d in insps for it in d.get("items", []) if it.get("asset_id")})
    assets_map = {}
    if asset_ids:
        ad = await assets_collection.find({"_id": {"$in": [ObjectId(a) for a in asset_ids]}}).to_list(1000)
        assets_map = {str(a["_id"]): a for a in ad}
    type_ids = list({a.get("asset_type_id") for a in assets_map.values() if a.get("asset_type_id")})
    types_map = {}
    if type_ids:
        td = await asset_types_collection.find({"_id": {"$in": [ObjectId(t) for t in type_ids]}}).to_list(1000)
        types_map = {str(t["_id"]): t["name"] for t in td}
    station_ids_all = list({d.get("station_id") for d in insps if d.get("station_id")})
    stations_map = {}
    if station_ids_all:
        sd = await stations_collection.find({"_id": {"$in": [ObjectId(s) for s in station_ids_all]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in sd}

    out_inspections = []
    total_items = 0
    for d in insps:
        pending_items = []
        for idx, it in enumerate(d.get("items", [])):
            if it.get("approval_status") == "pending_approval":
                asset = assets_map.get(it.get("asset_id"))
                pending_items.append({
                    "item_index": idx,
                    "asset_id": it.get("asset_id"),
                    "asset_number": asset.get("asset_number") if asset else None,
                    "asset_type_name": types_map.get(asset.get("asset_type_id")) if asset else None,
                    "status": it.get("status"),
                    "remarks": it.get("remarks"),
                    "remarks_by": it.get("remarks_by"),
                    "photo_urls": it.get("photo_urls", []),
                    "defective_since": it.get("defective_since"),
                    "rectified_on": it.get("rectified_on"),
                    "checklist_responses": it.get("checklist_responses", []),
                })
        if not pending_items:
            continue
        total_items += len(pending_items)
        out_inspections.append({
            "inspection_id": str(d["_id"]),
            "inspection_type": d.get("inspection_type"),
            "station_id": d.get("station_id"),
            "station_name": stations_map.get(d.get("station_id"), "Unknown"),
            "inspector_id": d.get("inspector_id"),
            "inspector_name": d.get("inspector_name"),
            "submitted_at": d.get("created_at").isoformat() if d.get("created_at") else None,
            "overall_remarks": d.get("overall_remarks"),
            "pending_items": pending_items,
        })

    return {"reviewer_id": reviewer_id, "total_items": total_items, "inspections": out_inspections}


@router.get("/api/inspections")
async def list_inspections(
    station_id: Optional[str] = None,
    inspector_id: Optional[str] = None,
    inspection_type: Optional[str] = None,
    for_user_id: Optional[str] = None,
    limit: int = 50,
    paginated: bool = False,
    page: int = 1,
    page_size: int = 25,
):
    """List inspections, optionally paginated.

    Backwards-compatible: when `paginated=False` (default) returns a flat list
    capped by `limit`. When `paginated=True`, returns
    `{items, total, page, page_size, total_pages}` after applying the same
    role-based scoping.
    """
    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or 25), 200))

    def _empty():
        if not paginated:
            return []
        return {"items": [], "total": 0, "page": page, "page_size": page_size, "total_pages": 0}

    query: dict = {}
    if station_id:
        query["station_id"] = station_id
    if inspector_id:
        query["inspector_id"] = inspector_id
    if inspection_type:
        query["inspection_type"] = inspection_type

    # Role-scoped filtering when for_user_id is provided.
    # Supervisor: inspections where they were the inspector OR items include
    #             assets allocated to them (either way, they can see it).
    # Approving Supervisor: only inspections at stations where they are the assigned ASUP.
    # Reporting Officer: stations in their assigned_stations AND items must include
    #                    assets whose type belongs to their department.
    # Superadmin / Admin: no scoping.
    asset_id_filter: Optional[set] = None
    supervisor_was_inspector = False
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
            if sup_stations and sup_dept:
                dept_types = await asset_types_collection.find(
                    {"department_id": sup_dept}, {"_id": 1}
                ).to_list(2000)
                sup_type_ids = [str(t["_id"]) for t in dept_types]
                mine = await assets_collection.find(
                    {"station_id": {"$in": sup_stations}, "asset_type_id": {"$in": sup_type_ids}},
                    {"_id": 1}
                ).to_list(20000)
                asset_id_filter = {str(a["_id"]) for a in mine}
            else:
                asset_id_filter = set()
            or_clauses = [{"inspector_id": for_user_id}]
            if asset_id_filter:
                or_clauses.append({"items.asset_id": {"$in": list(asset_id_filter)}})
            if any(k in query for k in ("$or", "$and")):
                query.setdefault("$and", []).append({"$or": or_clauses})
            else:
                query["$or"] = or_clauses
            supervisor_was_inspector = True  # signal to keep all items if inspector
        elif role == UserRole.APPROVING_SUPERVISOR.value:
            asup_stations = list(user.get("assigned_stations") or [])
            if not asup_stations:
                return _empty()
            if "station_id" in query:
                if query["station_id"] not in asup_stations:
                    return _empty()
            else:
                query["station_id"] = {"$in": asup_stations}
        elif role == UserRole.REPORTING_OFFICER.value:
            ro_stations = list(user.get("assigned_stations") or [])
            ro_dept = user.get("department_id")
            if not ro_stations or not ro_dept:
                return _empty()
            if "station_id" in query:
                if query["station_id"] not in ro_stations:
                    return _empty()
            else:
                query["station_id"] = {"$in": ro_stations}
            # Build set of asset ids in this RO's department
            dept_types = await asset_types_collection.find(
                {"department_id": ro_dept}, {"_id": 1}
            ).to_list(2000)
            type_ids = [str(t["_id"]) for t in dept_types]
            if not type_ids:
                return _empty()
            dept_assets = await assets_collection.find(
                {"asset_type_id": {"$in": type_ids}}, {"_id": 1}
            ).to_list(20000)
            asset_id_filter = {str(a["_id"]) for a in dept_assets}
            if not asset_id_filter:
                return _empty()
            query["items.asset_id"] = {"$in": list(asset_id_filter)}

    # Pagination — count after scoping is applied (which is reflected in `query`)
    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or 25), 200))

    if not paginated:
        docs = await inspections_collection.find(query).sort("created_at", -1).to_list(limit)
    else:
        skip = (page - 1) * page_size
        cursor = inspections_collection.find(query).sort("created_at", -1).skip(skip).limit(page_size)
        docs = await cursor.to_list(page_size)

    # When asset_id_filter is set, also strip items not relevant to the user
    # so they only see "their" assets per inspection — UNLESS the user was
    # the inspector themselves (in which case show every item they recorded).
    if asset_id_filter is not None:
        for d in docs:
            if supervisor_was_inspector and d.get("inspector_id") == for_user_id:
                # Keep all items the supervisor inspected
                continue
            d["items"] = [it for it in d.get("items", []) if it.get("asset_id") in asset_id_filter]

    # Batch fetch stations
    station_ids = list(set(d["station_id"] for d in docs if d.get("station_id")))
    stations_map = {}
    if station_ids:
        stations_docs = await stations_collection.find({"_id": {"$in": [ObjectId(sid) for sid in station_ids]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in stations_docs}
    for doc in docs:
        doc["station_name"] = stations_map.get(doc["station_id"], "Unknown")

    items_serialized = [serialize_doc(d) for d in docs]

    if not paginated:
        return items_serialized

    total = await inspections_collection.count_documents(query)
    total_pages = (total + page_size - 1) // page_size if page_size else 1
    return {
        "items": items_serialized,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


@router.get("/api/inspections/{inspection_id}")
async def get_inspection(inspection_id: str):
    doc = await inspections_collection.find_one({"_id": ObjectId(inspection_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Inspection not found")
    station = await stations_collection.find_one({"_id": ObjectId(doc["station_id"])})
    doc["station_name"] = station["name"] if station else "Unknown"
    return serialize_doc(doc)


@router.get("/api/assets/{asset_id}/inspections")
async def get_asset_inspections(asset_id: str, limit: int = 50):
    """Get inspection history for a specific asset"""
    # Find all inspections that include this asset
    inspections = await inspections_collection.find(
        {"items.asset_id": asset_id}
    ).sort("created_at", -1).to_list(limit)
    
    # Enrich with station names
    station_ids = list(set(i["station_id"] for i in inspections if i.get("station_id")))
    stations_map = {}
    if station_ids:
        stations_docs = await stations_collection.find({"_id": {"$in": [ObjectId(sid) for sid in station_ids]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in stations_docs}
    
    # Filter items to only show this asset's inspection data
    for insp in inspections:
        insp["station_name"] = stations_map.get(insp["station_id"], "Unknown")
        insp["items"] = [item for item in insp.get("items", []) if item.get("asset_id") == asset_id]
    
    return [serialize_doc(i) for i in inspections]


@router.get("/api/users/{user_id}/inspections")
async def get_user_inspections(user_id: str, limit: int = 50):
    """Get inspection history for a specific user (supervisor/inspector)"""
    inspections = await inspections_collection.find(
        {"inspector_id": user_id}
    ).sort("created_at", -1).to_list(limit)
    
    station_ids = list(set(i["station_id"] for i in inspections if i.get("station_id")))
    stations_map = {}
    if station_ids:
        stations_docs = await stations_collection.find({"_id": {"$in": [ObjectId(sid) for sid in station_ids]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in stations_docs}
    
    for insp in inspections:
        insp["station_name"] = stations_map.get(insp["station_id"], "Unknown")
    
    return [serialize_doc(i) for i in inspections]
