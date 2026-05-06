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


# ============ ORANGE LIST / RED LIST ============
# Change 4: Orange List < 24hrs, Red List > 24hrs
@router.get("/api/orange-list")
async def list_orange_items(
    status: Optional[str] = None,
    station_id: Optional[str] = None,
    department_id: Optional[str] = None,
    list_type: Optional[str] = None  # "orange", "red", or None for all
):
    query = {}
    if status:
        query["status"] = status
    else:
        query["status"] = {"$ne": OrangeListStatus.RESOLVED.value}
    
    docs = await orange_list_collection.find(query).sort("created_at", -1).to_list(1000)
    
    now = datetime.utcnow()
    
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
        
        # Calculate duration and classify as orange/red
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
    
    return enriched


@router.post("/api/orange-list/{item_id}/mark-working")
async def mark_working(item_id: str, request: MarkWorkingRequest):
    item = await orange_list_collection.find_one({"_id": ObjectId(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Orange list item not found")
    
    if item["status"] != OrangeListStatus.DEFECTIVE.value:
        raise HTTPException(status_code=400, detail="Item is not in defective status")
    
    await orange_list_collection.update_one(
        {"_id": ObjectId(item_id)},
        {"$set": {
            "status": OrangeListStatus.PENDING_APPROVAL.value,
            "marked_working_by": request.marked_by,
            "marked_working_at": datetime.utcnow(),
            "working_remarks": request.remarks
        }}
    )
    
    await assets_collection.update_one(
        {"_id": ObjectId(item["asset_id"])},
        {"$set": {"status": AssetStatus.PENDING_APPROVAL.value}}
    )
    
    await audit_log_collection.insert_one({
        "entity_type": "orange_list",
        "entity_id": item_id,
        "action": "marked_working",
        "performed_by": request.marked_by,
        "details": {"remarks": request.remarks},
        "created_at": datetime.utcnow()
    })
    
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
    if not approver or approver["role"] not in [UserRole.APPROVING_SUPERVISOR.value, UserRole.ADMIN.value, UserRole.SUPERADMIN.value]:
        raise HTTPException(status_code=403, detail="Only approving supervisors, admins, or superadmins can approve")
    
    await orange_list_collection.update_one(
        {"_id": ObjectId(item_id)},
        {"$set": {
            "status": OrangeListStatus.RESOLVED.value,
            "approved_by": request.approved_by,
            "approved_at": datetime.utcnow(),
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
        "created_at": datetime.utcnow()
    })
    
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
    
    filename = f"defective_assets_{list_type or 'all'}_{datetime.utcnow().strftime('%Y%m%d_%H%M')}.xlsx"
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
    title = f"{'Red' if list_type == 'red' else 'Orange' if list_type == 'orange' else 'Defective'} List Report - {datetime.utcnow().strftime('%d %b %Y')}"
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
    
    filename = f"defective_assets_{list_type or 'all'}_{datetime.utcnow().strftime('%Y%m%d_%H%M')}.pdf"
    return StreamingResponse(
        output,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
