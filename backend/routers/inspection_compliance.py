"""
Inspection Compliance Monitor

Endpoints:
  GET  /api/inspection-compliance/supervisor-activity/{user_id}
  GET  /api/inspection-compliance/missing-heatmap/{user_id}
  GET  /api/inspection-compliance/sig-history/{user_id}
  POST /api/inspection-compliance/sig/{inspection_id}/export/pdf
  GET  /api/settings/compliance-threshold
  PUT  /api/settings/compliance-threshold
"""
from __future__ import annotations

import io
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from database import (
    db, users_collection, stations_collection, assets_collection,
    asset_types_collection, locations_collection, inspections_collection,
    now_ist, serialize_doc, _dt_to_iso,
)

# ReportLab
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer,
    Table, TableStyle, PageBreak, KeepTogether,
)

router = APIRouter()

system_settings_collection = db["system_settings"]
DEFAULT_OVERDUE_DAYS = 7


# ─── Settings helpers ────────────────────────────────────────────────────────
async def _get_threshold() -> int:
    doc = await system_settings_collection.find_one({"key": "compliance_overdue_days"})
    return int(doc["value"]) if doc else DEFAULT_OVERDUE_DAYS


def _sup_status(last_dt, threshold_days: int) -> str:
    """active / due_soon / overdue / never based on days since last inspection."""
    if not last_dt:
        return "never"
    if isinstance(last_dt, str):
        try:
            last_dt = datetime.fromisoformat(last_dt.replace("Z", "").replace("+00:00", ""))
        except Exception:
            return "unknown"
    if last_dt.tzinfo is not None:
        last_dt = last_dt.replace(tzinfo=None)
    days_since = (now_ist() - last_dt).days
    if days_since <= 3:
        return "active"
    if days_since <= threshold_days:
        return "due_soon"
    return "overdue"


def _parse_dt(val) -> Optional[datetime]:
    if isinstance(val, datetime):
        return val.replace(tzinfo=None) if val.tzinfo else val
    if isinstance(val, str):
        try:
            d = datetime.fromisoformat(val.replace("Z", "").replace("+00:00", ""))
            return d.replace(tzinfo=None) if d.tzinfo else d
        except Exception:
            return None
    return None


# ─── GET /api/settings/compliance-threshold ──────────────────────────────────
@router.get("/api/settings/compliance-threshold")
async def get_compliance_threshold():
    return {"overdue_days": await _get_threshold()}


# ─── PUT /api/settings/compliance-threshold ──────────────────────────────────
class ThresholdBody(BaseModel):
    overdue_days: int
    current_user_id: str


@router.put("/api/settings/compliance-threshold")
async def update_compliance_threshold(body: ThresholdBody):
    try:
        user = await users_collection.find_one({"_id": ObjectId(body.current_user_id)})
    except Exception:
        raise HTTPException(400, "Invalid current_user_id")
    if not user:
        raise HTTPException(404, "User not found")
    allowed = {"superadmin", "admin", "divisional_admin"}
    if user.get("role") not in allowed:
        raise HTTPException(403, "Only admins may change this setting")
    days = max(1, min(90, body.overdue_days))
    await system_settings_collection.update_one(
        {"key": "compliance_overdue_days"},
        {"$set": {"key": "compliance_overdue_days", "value": days, "updated_at": now_ist()}},
        upsert=True,
    )
    return {"overdue_days": days}


# ─── GET /api/inspection-compliance/supervisor-activity/{user_id} ─────────────
@router.get("/api/inspection-compliance/supervisor-activity/{user_id}")
async def supervisor_activity(
    user_id: str,
    station_id: Optional[str] = Query(None),
    dept_id: Optional[str] = Query(None),
):
    try:
        req_user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(400, "Invalid user_id")
    if not req_user:
        raise HTTPException(404, "User not found")

    threshold = await _get_threshold()
    role = req_user.get("role", "")

    # Build supervisor query with role-based scoping
    sup_q: dict = {"role": "supervisor"}
    if role == "reporting_officer":
        sup_q["assigned_stations"] = {"$in": req_user.get("assigned_stations") or []}
        if req_user.get("department_id"):
            sup_q["department_id"] = req_user["department_id"]
    elif role == "approving_supervisor":
        sup_q["assigned_stations"] = {"$in": req_user.get("assigned_stations") or []}
    elif role == "divisional_admin":
        # Scope to stations in the DA's division
        assigned_div = req_user.get("assigned_division_id")
        if assigned_div:
            div_doc = await db["divisions"].find_one({"_id": ObjectId(assigned_div)})
            if div_doc:
                div_stations = div_doc.get("assigned_stations") or []
                sup_q["assigned_stations"] = {"$in": div_stations}
    elif role == "supervisor":
        # Supervisor sees only themselves
        sup_q["_id"] = req_user["_id"]

    # Optional additional filters from query params
    if station_id:
        if "assigned_stations" in sup_q:
            existing = sup_q["assigned_stations"].get("$in", [])
            if station_id in existing:
                sup_q["assigned_stations"] = {"$in": [station_id]}
            else:
                return []
        else:
            sup_q["assigned_stations"] = {"$in": [station_id]}
    if dept_id:
        sup_q["department_id"] = dept_id

    supervisors = await users_collection.find(sup_q, {"password": 0}).to_list(1000)

    # Build station name lookup
    all_station_ids = list({sid for s in supervisors for sid in (s.get("assigned_stations") or [])})
    station_docs = await stations_collection.find(
        {"_id": {"$in": [ObjectId(sid) for sid in all_station_ids if sid]}},
        {"name": 1}
    ).to_list(1000) if all_station_ids else []
    station_name_map = {str(s["_id"]): s["name"] for s in station_docs}

    # Build department name lookup
    dept_docs = await db["departments"].find({}, {"name": 1, "code": 1}).to_list(200)
    dept_name_map = {str(d["_id"]): d.get("code", d["name"]) for d in dept_docs}

    # Load all inspections for these supervisors in one batch
    sup_ids = [str(s["_id"]) for s in supervisors]
    if not sup_ids:
        return []

    now = now_ist()
    d7_ago = now - timedelta(days=7)
    d30_ago = now - timedelta(days=30)

    all_insps = await inspections_collection.find(
        {"inspector_id": {"$in": sup_ids}},
        {"inspector_id": 1, "inspection_type": 1, "created_at": 1, "station_id": 1}
    ).sort("created_at", -1).to_list(50000)

    # Group by inspector
    by_inspector: Dict[str, List[dict]] = {}
    for insp in all_insps:
        iid = insp.get("inspector_id", "")
        by_inspector.setdefault(iid, []).append(insp)

    rows = []
    for sup in supervisors:
        sid = str(sup["_id"])
        insps = by_inspector.get(sid, [])

        last_individual_dt: Optional[datetime] = None
        last_sig_dt: Optional[datetime] = None
        count_7d = 0
        count_30d = 0

        for insp in insps:
            dt = _parse_dt(insp.get("created_at"))
            if not dt:
                continue
            itype = insp.get("inspection_type", "individual")
            if itype == "individual" and (last_individual_dt is None or dt > last_individual_dt):
                last_individual_dt = dt
            elif itype == "sig" and (last_sig_dt is None or dt > last_sig_dt):
                last_sig_dt = dt
            if dt >= d7_ago:
                count_7d += 1
            if dt >= d30_ago:
                count_30d += 1

        # Determine overall last inspection for status calculation
        last_any = None
        if last_individual_dt and last_sig_dt:
            last_any = max(last_individual_dt, last_sig_dt)
        else:
            last_any = last_individual_dt or last_sig_dt

        status = _sup_status(last_any, threshold)

        rows.append({
            "user_id": sid,
            "name": sup.get("name", ""),
            "employee_id": sup.get("employee_id", ""),
            "department_id": sup.get("department_id", ""),
            "department_name": dept_name_map.get(sup.get("department_id", ""), "—"),
            "assigned_stations": sup.get("assigned_stations") or [],
            "station_names": [station_name_map.get(s, s) for s in (sup.get("assigned_stations") or [])],
            "last_individual": _dt_to_iso(last_individual_dt) if last_individual_dt else None,
            "last_sig": _dt_to_iso(last_sig_dt) if last_sig_dt else None,
            "last_any": _dt_to_iso(last_any) if last_any else None,
            "count_7d": count_7d,
            "count_30d": count_30d,
            "status": status,
            "days_since_last": (now - last_any).days if last_any else None,
        })

    # Sort: overdue first, then never, then due_soon, then active
    order = {"overdue": 0, "never": 1, "due_soon": 2, "active": 3, "unknown": 4}
    rows.sort(key=lambda r: (order.get(r["status"], 4), -(r["days_since_last"] or 9999)))
    return rows


# ─── GET /api/inspection-compliance/missing-heatmap/{user_id} ─────────────────
@router.get("/api/inspection-compliance/missing-heatmap/{user_id}")
async def missing_heatmap(user_id: str):
    try:
        req_user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(400, "Invalid user_id")
    if not req_user:
        raise HTTPException(404, "User not found")

    role = req_user.get("role", "")

    # Determine visible station_ids
    if role in ("superadmin", "admin", "viewer", "divisional_admin"):
        if role == "divisional_admin":
            assigned_div = req_user.get("assigned_division_id")
            if assigned_div:
                div_doc = await db["divisions"].find_one({"_id": ObjectId(assigned_div)})
                visible_stations = set(div_doc.get("assigned_stations") or []) if div_doc else set()
            else:
                visible_stations = None
        else:
            visible_stations = None  # all stations
    else:
        visible_stations = set(req_user.get("assigned_stations") or [])

    # Load stations
    station_q = {} if visible_stations is None else {"_id": {"$in": [ObjectId(s) for s in visible_stations if s]}}
    station_docs = await stations_collection.find(station_q, {"name": 1, "code": 1}).to_list(500)
    station_list = [{"id": str(s["_id"]), "name": s.get("name", ""), "code": s.get("code", "")} for s in station_docs]
    station_ids_set = {s["id"] for s in station_list}

    # Load assets (only for visible stations) to determine which asset types exist per station
    asset_q: dict = {}
    if visible_stations is not None:
        asset_q["station_id"] = {"$in": list(visible_stations)}

    # For supervisor/RO, further scope by department
    if role in ("supervisor", "reporting_officer") and req_user.get("department_id"):
        dept_types = await asset_types_collection.find(
            {"department_id": req_user["department_id"]}, {"_id": 1}
        ).to_list(2000)
        type_ids = [str(t["_id"]) for t in dept_types]
        asset_q["asset_type_id"] = {"$in": type_ids}

    asset_docs = await assets_collection.find(
        asset_q, {"station_id": 1, "asset_type_id": 1}
    ).to_list(50000)

    # Map asset_id -> (station_id, asset_type_id)
    asset_map: Dict[str, tuple] = {}
    # Get unique asset types that appear in the visible scope
    type_ids_in_scope: set = set()
    station_type_pairs: set = set()
    for a in asset_docs:
        aid = str(a["_id"])
        sid = a.get("station_id", "")
        tid = a.get("asset_type_id", "")
        if sid and tid:
            asset_map[aid] = (sid, tid)
            type_ids_in_scope.add(tid)
            if sid in station_ids_set:
                station_type_pairs.add((sid, tid))

    # Load asset type names (cap at 12 most common types for display)
    type_docs = await asset_types_collection.find(
        {"_id": {"$in": [ObjectId(tid) for tid in type_ids_in_scope if tid]}},
        {"name": 1}
    ).to_list(1000)
    type_name_map = {str(t["_id"]): t.get("name", "Unknown") for t in type_docs}

    # Determine top asset types by occurrence across all visible stations
    type_freq: Dict[str, int] = {}
    for _, tid in station_type_pairs:
        type_freq[tid] = type_freq.get(tid, 0) + 1
    top_types = sorted(type_freq.keys(), key=lambda t: -type_freq[t])[:10]

    # Load recent inspections (last 180 days) to compute last inspection per (station, type)
    cutoff = now_ist() - timedelta(days=180)
    recent_inspections = await inspections_collection.find(
        {"created_at": {"$gte": cutoff}},
        {"station_id": 1, "items": 1, "created_at": 1}
    ).to_list(100000)

    # Build last_inspection_map: (station_id, type_id) -> max(inspection_date)
    last_map: Dict[tuple, datetime] = {}
    for insp in recent_inspections:
        insp_dt = _parse_dt(insp.get("created_at"))
        if not insp_dt:
            continue
        insp_station = insp.get("station_id", "")
        if insp_station not in station_ids_set:
            continue
        for item in insp.get("items", []):
            a_id = item.get("asset_id", "")
            pair = asset_map.get(a_id)
            if pair:
                key = (insp_station, pair[1])
                if key not in last_map or insp_dt > last_map[key]:
                    last_map[key] = insp_dt

    now = now_ist()

    # Build grid
    grid = []
    for station in station_list:
        sid = station["id"]
        row = {"station": station, "cells": {}}
        for tid in top_types:
            if (sid, tid) not in station_type_pairs:
                row["cells"][tid] = None  # type doesn't exist at this station
                continue
            last_dt = last_map.get((sid, tid))
            if last_dt:
                days_since = (now - last_dt).days
                row["cells"][tid] = {
                    "last_inspection": _dt_to_iso(last_dt),
                    "days_since": days_since,
                }
            else:
                row["cells"][tid] = {
                    "last_inspection": None,
                    "days_since": None,
                }
        grid.append(row)

    return {
        "asset_types": [{"id": tid, "name": type_name_map.get(tid, "Unknown")} for tid in top_types],
        "grid": grid,
    }


# ─── GET /api/inspection-compliance/sig-history/{user_id} ────────────────────
@router.get("/api/inspection-compliance/sig-history/{user_id}")
async def sig_history(
    user_id: str,
    station_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    try:
        req_user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(400, "Invalid user_id")
    if not req_user:
        raise HTTPException(404, "User not found")

    role = req_user.get("role", "")
    query: dict = {"inspection_type": "sig"}

    # Role scoping
    if role in ("supervisor", "reporting_officer", "approving_supervisor"):
        visible = list(req_user.get("assigned_stations") or [])
        if not visible:
            return {"items": [], "total": 0, "page": page, "page_size": page_size, "total_pages": 0}
        query["station_id"] = {"$in": visible}
    elif role == "divisional_admin":
        assigned_div = req_user.get("assigned_division_id")
        if assigned_div:
            div_doc = await db["divisions"].find_one({"_id": ObjectId(assigned_div)})
            if div_doc:
                query["station_id"] = {"$in": div_doc.get("assigned_stations") or []}

    if station_id:
        query["station_id"] = station_id

    total = await inspections_collection.count_documents(query)
    skip = (page - 1) * page_size
    docs = await inspections_collection.find(query).sort("created_at", -1).skip(skip).limit(page_size).to_list(page_size)

    # Enrich with station names and asset counts
    station_ids = list({d["station_id"] for d in docs if d.get("station_id")})
    station_map = {}
    if station_ids:
        st_docs = await stations_collection.find(
            {"_id": {"$in": [ObjectId(s) for s in station_ids]}}, {"name": 1}
        ).to_list(1000)
        station_map = {str(s["_id"]): s["name"] for s in st_docs}

    items = []
    for doc in docs:
        s = serialize_doc(doc)
        s["station_name"] = station_map.get(doc.get("station_id", ""), "Unknown")
        s["total_assets"] = len(doc.get("items", []))
        s["defect_count"] = sum(1 for it in doc.get("items", []) if it.get("status") in ("not_ok", "needs_repair"))
        items.append(s)

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if page_size else 1,
    }


# ─── POST /api/inspection-compliance/sig/{inspection_id}/export/pdf ───────────
@router.post("/api/inspection-compliance/sig/{inspection_id}/export/pdf")
async def export_sig_pdf(inspection_id: str):
    try:
        doc = await inspections_collection.find_one({"_id": ObjectId(inspection_id)})
    except Exception:
        raise HTTPException(400, "Invalid inspection_id")
    if not doc:
        raise HTTPException(404, "Inspection not found")
    if doc.get("inspection_type") != "sig":
        raise HTTPException(400, "Not a SIG inspection")

    station = await stations_collection.find_one({"_id": ObjectId(doc["station_id"])})
    station_name = station["name"] if station else "Unknown"

    # Enrich items with asset details
    asset_ids = [it.get("asset_id") for it in doc.get("items", []) if it.get("asset_id")]
    asset_docs = await assets_collection.find(
        {"_id": {"$in": [ObjectId(a) for a in asset_ids]}}
    ).to_list(1000) if asset_ids else []
    asset_map = {str(a["_id"]): a for a in asset_docs}

    # Enrich each item
    location_ids = list({a.get("location_id") for a in asset_docs if a.get("location_id")})
    loc_docs = await locations_collection.find(
        {"_id": {"$in": [ObjectId(lid) for lid in location_ids]}}
    ).to_list(1000) if location_ids else []
    loc_map = {str(loc["_id"]): loc.get("name", "") for loc in loc_docs}

    enriched_items = []
    for item in doc.get("items", []):
        asset = asset_map.get(item.get("asset_id", ""), {})
        enriched_items.append({
            "asset_number": asset.get("asset_number", item.get("asset_id", "")),
            "asset_type_name": asset.get("asset_type_name", ""),
            "location_name": loc_map.get(asset.get("location_id", ""), ""),
            "status": item.get("status", ""),
            "remarks": item.get("remarks", ""),
        })

    pdf_bytes = _build_sig_pdf(doc, station_name, enriched_items)
    insp_date = str(doc.get("inspection_at", ""))[:10]
    filename = f"SIG_Inspection_{station_name}_{insp_date}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─── PDF Builder ─────────────────────────────────────────────────────────────
def _build_sig_pdf(inspection: dict, station_name: str, items: list) -> bytes:
    buf = io.BytesIO()
    participants = inspection.get("participants", [])
    insp_date = str(inspection.get("inspection_at", ""))[:16]
    inspector_name = inspection.get("inspector_name", "")
    insp_ref = str(inspection.get("_id", ""))[-8:].upper()

    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", fontSize=16, fontName="Helvetica-Bold", spaceAfter=4)
    h2 = ParagraphStyle("h2", fontSize=11, fontName="Helvetica-Bold", spaceAfter=4)
    cell_s = ParagraphStyle("cell", fontSize=8, fontName="Helvetica", leading=10)
    cell_b = ParagraphStyle("cell_b", fontSize=8, fontName="Helvetica-Bold", leading=10)
    small = ParagraphStyle("small", fontSize=7, fontName="Helvetica", textColor=colors.HexColor("#555555"))

    # Color map for status
    STATUS_COLOR = {
        "ok": colors.HexColor("#059669"),
        "not_ok": colors.HexColor("#dc2626"),
        "needs_repair": colors.HexColor("#d97706"),
    }

    def P(text, style=cell_s):
        return Paragraph(str(text) if text else "—", style)

    def status_label(s):
        m = {"ok": "OK", "not_ok": "NOT OK", "needs_repair": "NEEDS REPAIR"}
        return m.get(s, s.upper() if s else "—")

    # Page dimensions
    W, H = A4
    LEFT_MARGIN = 15 * mm
    RIGHT_MARGIN = 15 * mm
    TOP_MARGIN = 20 * mm
    BOTTOM_MARGIN = 30 * mm  # extra bottom for footer

    # Track total pages via a list
    page_counter = [0]

    class SigDocTemplate(BaseDocTemplate):
        def __init__(self, buffer, **kw):
            super().__init__(buffer, **kw)
            body_frame = Frame(
                LEFT_MARGIN,
                BOTTOM_MARGIN,
                W - LEFT_MARGIN - RIGHT_MARGIN,
                H - TOP_MARGIN - BOTTOM_MARGIN,
                id="body",
            )
            self.addPageTemplates([
                PageTemplate(id="main", frames=[body_frame], onPage=_draw_page_deco)
            ])

    def _draw_page_deco(canvas, doc):
        page_counter[0] = doc.page
        canvas.saveState()
        w, h = A4

        # Top header bar
        canvas.setFillColor(colors.HexColor("#1e293b"))
        canvas.rect(0, h - 14 * mm, w, 14 * mm, fill=1, stroke=0)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 10)
        canvas.drawString(15 * mm, h - 9 * mm, "SIG INSPECTION REPORT")
        canvas.setFont("Helvetica", 8)
        canvas.drawString(70 * mm, h - 9 * mm, f"Station: {station_name}")
        canvas.drawString(120 * mm, h - 9 * mm, f"Date: {insp_date}")
        canvas.drawRightString(w - 15 * mm, h - 9 * mm, f"Ref: #{insp_ref}")

        # Footer separator line
        canvas.setStrokeColor(colors.HexColor("#e2e8f0"))
        canvas.setLineWidth(0.5)
        canvas.line(15 * mm, 27 * mm, w - 15 * mm, 27 * mm)

        # Participant footer text (small)
        canvas.setFont("Helvetica-Bold", 6.5)
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.drawString(15 * mm, 23 * mm, "PARTICIPANTS:")

        canvas.setFont("Helvetica", 6.5)
        x_cursor = 40 * mm
        for i, p in enumerate(participants):
            name_str = p.get("name", "")
            role_str = p.get("role", "").replace("_", " ").title()
            label = f"{name_str} ({role_str})"
            if x_cursor + len(label) * 3.5 > w - 15 * mm:
                break  # truncate if too long
            canvas.drawString(x_cursor, 23 * mm, label)
            x_cursor += len(label) * 3.5 + 4 * mm
            if i < len(participants) - 1 and x_cursor < w - 30 * mm:
                canvas.drawString(x_cursor - 2 * mm, 23 * mm, "·")

        # Signature placeholder line
        canvas.setStrokeColor(colors.HexColor("#94a3b8"))
        canvas.setLineWidth(0.3)
        canvas.line(15 * mm, 19 * mm, w - 15 * mm, 19 * mm)
        canvas.setFont("Helvetica", 5.5)
        x_sig = 15 * mm
        sig_width = (w - 30 * mm) / max(len(participants), 1)
        for p in participants:
            canvas.drawCentredString(x_sig + sig_width / 2, 16.5 * mm, p.get("name", ""))
            x_sig += sig_width

        # Page number
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#94a3b8"))
        canvas.drawRightString(w - 15 * mm, 14 * mm, f"Page {doc.page}")

        canvas.restoreState()

    story = []

    # Cover section
    story.append(Spacer(1, 4 * mm))
    story.append(P(f"SIG Inspection Report — {station_name}", h1))
    story.append(P(f"Date: {insp_date}    |    Convened by: {inspector_name}    |    Ref: #{insp_ref}", small))
    story.append(P(f"Total Assets Inspected: {len(items)}    |    Participants: {len(participants)}", small))
    story.append(Spacer(1, 6 * mm))

    # Assets table
    story.append(P("INSPECTION FINDINGS", h2))
    story.append(Spacer(1, 2 * mm))

    col_widths = [25 * mm, 30 * mm, 40 * mm, 22 * mm, 53 * mm]
    headers = ["Asset No.", "Type", "Location", "Result", "Remarks"]
    header_row = [P(h, cell_b) for h in headers]

    table_data = [header_row]
    for item in items:
        status = item.get("status", "")
        status_color = STATUS_COLOR.get(status, colors.black)
        status_para = Paragraph(
            f'<font color="#{status_color.hexval().lstrip("#")}">{status_label(status)}</font>',
            cell_s
        )
        row = [
            P(item.get("asset_number", ""), cell_b),
            P(item.get("asset_type_name", "")),
            P(item.get("location_name", "")),
            status_para,
            P(item.get("remarks", "")),
        ]
        table_data.append(row)

    tbl = Table(table_data, colWidths=col_widths, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#e2e8f0")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(tbl)

    # ── Signature Page (last page) ────────────────────────────────────────────
    story.append(PageBreak())

    sig_h1 = ParagraphStyle("sig_h1", fontSize=18, fontName="Helvetica-Bold",
                             textColor=colors.HexColor("#1e293b"), spaceAfter=6)
    sig_h2 = ParagraphStyle("sig_h2", fontSize=11, fontName="Helvetica-Bold",
                             textColor=colors.HexColor("#475569"), spaceAfter=4)
    sig_body = ParagraphStyle("sig_body", fontSize=9, fontName="Helvetica",
                               textColor=colors.HexColor("#334155"), spaceAfter=3, leading=14)

    story.append(Spacer(1, 10 * mm))
    story.append(P("INSPECTION CERTIFICATE", sig_h1))
    story.append(Spacer(1, 4 * mm))

    cert_text = (
        f"This is to certify that a Special Inspection Group (SIG) inspection was duly conducted "
        f"at <b>{station_name}</b> on <b>{insp_date}</b>. "
        f"A total of <b>{len(items)}</b> assets were inspected during this session. "
        f"The results of the inspection have been recorded above. "
        f"All undersigned participants were present throughout the duration of this inspection."
    )
    story.append(P(cert_text, sig_body))
    story.append(Spacer(1, 8 * mm))

    story.append(P("PARTICIPANT SIGNATURES", sig_h2))
    story.append(Spacer(1, 4 * mm))

    # Signature blocks in a 2-column grid
    sig_cols = 2
    sig_rows = []
    for i in range(0, len(participants), sig_cols):
        row_cells = []
        for j in range(sig_cols):
            if i + j < len(participants):
                p = participants[i + j]
                cell_content = [
                    Spacer(1, 18 * mm),  # Space for actual signature
                    Paragraph("_" * 40, ParagraphStyle("sigline", fontSize=9, fontName="Helvetica")),
                    Spacer(1, 2 * mm),
                    P(f"<b>{p.get('name', '')}</b>", cell_b),
                    P(p.get("role", "").replace("_", " ").title(), small),
                    P(f"ID: {p.get('employee_id', p.get('name', ''))}", small),
                ]
            else:
                cell_content = [Spacer(1, 1)]
            row_cells.append(cell_content)
        sig_rows.append(row_cells)

    sig_col_width = (W - LEFT_MARGIN - RIGHT_MARGIN) / sig_cols
    for row_cells in sig_rows:
        sig_tbl_data = [row_cells]
        sig_tbl = Table(sig_tbl_data, colWidths=[sig_col_width] * sig_cols)
        sig_tbl.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 16),
            ("BOX", (0, 0), (0, 0), 0.5, colors.HexColor("#e2e8f0")),
            ("BOX", (1, 0), (1, 0), 0.5, colors.HexColor("#e2e8f0")) if sig_cols > 1 else ("SPAN", (0, 0), (0, 0)),
        ]))
        story.append(sig_tbl)
        story.append(Spacer(1, 4 * mm))

    doc_obj = SigDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=LEFT_MARGIN,
        rightMargin=RIGHT_MARGIN,
        topMargin=TOP_MARGIN,
        bottomMargin=BOTTOM_MARGIN,
    )
    doc_obj.build(story)
    return buf.getvalue()
