from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from bson import ObjectId

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
from helpers import _compute_asset_metrics, _analytics_for_asset_set


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _parse_dt_param(s: Optional[str], fallback: datetime) -> datetime:
    if not s:
        return fallback
    try:
        return datetime.fromisoformat(s)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid date: {s}")


def _coerce_dt(v) -> Optional[datetime]:
    """Coerce a MongoDB datetime or ISO string to a naive datetime."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.replace(tzinfo=None) if v.tzinfo else v
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(
                v.replace("Z", "+00:00").replace("+00:00", "")
            )
        except Exception:
            return None
    return None


def _asset_performance(asset_records: list, user_id: str,
                       range_start: datetime, range_end: datetime) -> dict:
    """
    Compute per-asset performance metrics.
    Option A: uses marked_working_at − defective_since (SUP's own rectification time).
    Only resolved defects (marked_working_at is set) within the date range.
    % Functional is relative to the selected date-range window.
    """
    period_secs = max(1, int((range_end - range_start).total_seconds()))
    repair_secs_list = []
    defective_secs = 0
    defect_count = 0
    rejection_count = 0

    for rec in asset_records:
        ds = _coerce_dt(rec.get("defective_since"))
        if not ds:
            continue

        # Rejection count: records where this SUP had their claim rejected
        if (rec.get("last_marked_working_by") == user_id
                and rec.get("rejected_by")
                and range_start <= ds <= range_end):
            rejection_count += 1

        # Only resolved defects within range window
        mw = _coerce_dt(rec.get("marked_working_at"))
        if not mw or mw <= ds:
            continue
        if ds < range_start or ds > range_end:
            continue

        defect_count += 1
        repair_secs_list.append(int((mw - ds).total_seconds()))

        # Clip to date-range window for % functional
        eff_s = max(ds, range_start)
        eff_e = min(mw, range_end)
        if eff_e > eff_s:
            defective_secs += int((eff_e - eff_s).total_seconds())

    avg_repair = (
        int(sum(repair_secs_list) / len(repair_secs_list))
        if repair_secs_list else 0
    )
    pct_functional = max(0.0, min(100.0,
        (1 - defective_secs / period_secs) * 100
    ))
    return {
        "defect_count": defect_count,
        "avg_repair_seconds": avg_repair,
        "avg_repair_hours": round(avg_repair / 3600, 2),
        "pct_functional": round(pct_functional, 2),
        "rejection_count": rejection_count,
        "_defective_secs": defective_secs,        # internal, removed before response
        "_repair_secs_list": repair_secs_list,    # internal
    }


async def _assets_for_supervisor(user: dict,
                                  station_id: Optional[str] = None,
                                  location_id: Optional[str] = None) -> list:
    """Return assets scoped to a supervisor (implicit dept+station), with optional filters."""
    sup_stations = list(user.get("assigned_stations") or [])
    dept_id = user.get("department_id")
    if not sup_stations or not dept_id:
        return []
    if station_id:
        if station_id not in sup_stations:
            return []
        query_stations = [station_id]
    else:
        query_stations = sup_stations
    tdocs = await asset_types_collection.find(
        {"department_id": dept_id}, {"_id": 1}
    ).to_list(2000)
    type_ids = [str(t["_id"]) for t in tdocs]
    if not type_ids:
        return []
    q = {"station_id": {"$in": query_stations}, "asset_type_id": {"$in": type_ids}}
    if location_id:
        q["location_id"] = location_id
    return await assets_collection.find(q).to_list(5000)


async def _build_comparison_summary(sup_docs: list,
                                     range_start: datetime,
                                     range_end: datetime) -> list:
    """
    Build performance summary rows for a list of supervisor documents.
    Batches asset + OL queries for efficiency.
    """
    if not sup_docs:
        return []

    # Collect dept IDs for batch lookup
    dept_ids = list({s.get("department_id") for s in sup_docs if s.get("department_id")})
    dept_name_map = {}
    if dept_ids:
        for d in await departments_collection.find(
            {"_id": {"$in": [ObjectId(x) for x in dept_ids]}}, {"_id": 1, "name": 1}
        ).to_list(200):
            dept_name_map[str(d["_id"])] = d.get("name", "")

    # Per-supervisor: get assets
    sup_to_assets: dict = {}
    all_asset_ids: set = set()
    for s in sup_docs:
        sid = str(s["_id"])
        assets = await _assets_for_supervisor(s)
        sup_to_assets[sid] = assets
        all_asset_ids.update(str(a["_id"]) for a in assets)

    # Batch fetch all OL records for all assets
    records_by_asset: dict = {}
    if all_asset_ids:
        for rec in await orange_list_collection.find(
            {"asset_id": {"$in": list(all_asset_ids)}}
        ).to_list(50000):
            records_by_asset.setdefault(rec["asset_id"], []).append(rec)

    period_secs = max(1, int((range_end - range_start).total_seconds()))
    result = []

    for s in sup_docs:
        sid = str(s["_id"])
        assets = sup_to_assets.get(sid, [])
        all_repair_secs: list = []
        total_defective_secs = 0
        total_defects = 0
        total_rejections = 0

        for asset in assets:
            aid = str(asset["_id"])
            m = _asset_performance(records_by_asset.get(aid, []), sid, range_start, range_end)
            total_defects += m["defect_count"]
            all_repair_secs.extend(m["_repair_secs_list"])
            total_defective_secs += m["_defective_secs"]
            total_rejections += m["rejection_count"]

        avg_repair = (
            int(sum(all_repair_secs) / len(all_repair_secs)) if all_repair_secs else 0
        )
        total_possible = period_secs * max(1, len(assets))
        pct_f = max(0.0, min(100.0, (1 - total_defective_secs / total_possible) * 100))

        result.append({
            "_id": sid,
            "name": s.get("name"),
            "employee_id": s.get("employee_id"),
            "department_name": dept_name_map.get(s.get("department_id", ""), ""),
            "summary": {
                "total_assets": len(assets),
                "total_defects": total_defects,
                "avg_repair_seconds": avg_repair,
                "avg_repair_hours": round(avg_repair / 3600, 2),
                "pct_functional": round(pct_f, 2),
                "rejection_count": total_rejections,
            },
        })

    result.sort(key=lambda x: (x.get("name") or "").lower())
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api/analytics/supervisor/{user_id}/performance")
async def supervisor_performance(
    user_id: str,
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    station_id: Optional[str] = Query(None),
    location_id: Optional[str] = Query(None),
):
    """
    Full performance analytics for a single supervisor.
    Date range: from_date / to_date (ISO, defaults to last 30 days).
    Filters: station_id, location_id (optional sub-filters within supervisor's scope).
    Metrics use Option A timing: marked_working_at − defective_since.
    Only resolved defects are counted; unresolved are excluded.
    """
    now = datetime.utcnow()
    range_end = _parse_dt_param(to_date, now)
    range_start = _parse_dt_param(from_date, now - timedelta(days=30))

    try:
        user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    dept_id = user.get("department_id")
    dept_name = None
    if dept_id:
        dept_doc = await departments_collection.find_one({"_id": ObjectId(dept_id)})
        dept_name = dept_doc.get("name") if dept_doc else None

    empty_response = {
        "user_id": user_id,
        "user_name": user.get("name"),
        "employee_id": user.get("employee_id"),
        "department_name": dept_name,
        "period": {"from": range_start.isoformat(), "to": range_end.isoformat()},
        "summary": {
            "total_assets": 0, "total_defects": 0,
            "avg_repair_seconds": 0, "avg_repair_hours": 0.0,
            "pct_functional": 100.0, "rejection_count": 0,
        },
        "categories": [],
        "available_stations": [],
        "available_locations": [],
    }

    assets = await _assets_for_supervisor(user, station_id, location_id)
    if not assets:
        # Still fetch available_stations for the filter UI
        all_assets = await _assets_for_supervisor(user)
        station_ids_all = list({a.get("station_id") for a in all_assets if a.get("station_id")})
        stn_docs = await stations_collection.find(
            {"_id": {"$in": [ObjectId(x) for x in station_ids_all]}}, {"_id": 1, "name": 1}
        ).to_list(100)
        empty_response["available_stations"] = [
            {"_id": str(s["_id"]), "name": s.get("name", "")} for s in stn_docs
        ]
        return empty_response

    asset_ids = [str(a["_id"]) for a in assets]

    # Batch lookups
    station_ids = list({a.get("station_id") for a in assets if a.get("station_id")})
    location_ids_set = list({a.get("location_id") for a in assets if a.get("location_id")})
    all_type_ids = list({a.get("asset_type_id") for a in assets if a.get("asset_type_id")})

    station_map, location_map, type_name_map = {}, {}, {}
    if station_ids:
        for s in await stations_collection.find(
            {"_id": {"$in": [ObjectId(x) for x in station_ids]}}, {"_id": 1, "name": 1}
        ).to_list(100):
            station_map[str(s["_id"])] = s.get("name", "")
    if location_ids_set:
        for loc in await locations_collection.find(
            {"_id": {"$in": [ObjectId(x) for x in location_ids_set]}}, {"_id": 1, "name": 1}
        ).to_list(500):
            location_map[str(loc["_id"])] = loc.get("name", "")
    if all_type_ids:
        for t in await asset_types_collection.find(
            {"_id": {"$in": [ObjectId(x) for x in all_type_ids]}}, {"_id": 1, "name": 1}
        ).to_list(200):
            type_name_map[str(t["_id"])] = t.get("name", "Unknown")

    # All OL records for these assets
    records_by_asset: dict = {}
    for rec in await orange_list_collection.find(
        {"asset_id": {"$in": asset_ids}}
    ).to_list(20000):
        records_by_asset.setdefault(rec["asset_id"], []).append(rec)

    # Per-asset → grouped by type
    grouped: dict = {}
    all_repair_secs: list = []
    total_defective_secs_overall = 0
    total_defects_overall = 0
    total_rejections_overall = 0
    period_secs = max(1, int((range_end - range_start).total_seconds()))

    for asset in assets:
        aid = str(asset["_id"])
        type_id = asset.get("asset_type_id") or "unknown"
        type_name = type_name_map.get(type_id, "Unknown")

        m = _asset_performance(records_by_asset.get(aid, []), user_id, range_start, range_end)

        total_defects_overall += m["defect_count"]
        all_repair_secs.extend(m["_repair_secs_list"])
        total_defective_secs_overall += m["_defective_secs"]
        total_rejections_overall += m["rejection_count"]

        asset_row = {
            "asset_id": aid,
            "asset_number": asset.get("asset_number", ""),
            "station_name": station_map.get(asset.get("station_id", ""), ""),
            "location_name": location_map.get(asset.get("location_id", ""), ""),
            "defect_count": m["defect_count"],
            "avg_repair_seconds": m["avg_repair_seconds"],
            "avg_repair_hours": m["avg_repair_hours"],
            "pct_functional": m["pct_functional"],
            "rejection_count": m["rejection_count"],
        }

        if type_id not in grouped:
            grouped[type_id] = {"name": type_name, "assets": []}
        grouped[type_id]["assets"].append(asset_row)

    # Category aggregates
    categories = []
    for type_id, info in grouped.items():
        cat_assets = info["assets"]
        cat_repair = [a["avg_repair_seconds"] for a in cat_assets if a["avg_repair_seconds"] > 0]
        cat_avg = int(sum(cat_repair) / len(cat_repair)) if cat_repair else 0
        cat_pct = (
            round(sum(a["pct_functional"] for a in cat_assets) / len(cat_assets), 2)
            if cat_assets else 100.0
        )
        categories.append({
            "asset_type_id": type_id,
            "asset_type_name": info["name"],
            "asset_count": len(cat_assets),
            "defect_count": sum(a["defect_count"] for a in cat_assets),
            "avg_repair_seconds": cat_avg,
            "avg_repair_hours": round(cat_avg / 3600, 2),
            "pct_functional": cat_pct,
            "rejection_count": sum(a["rejection_count"] for a in cat_assets),
            "assets": cat_assets,
        })
    categories.sort(key=lambda c: c["asset_type_name"])

    overall_avg = (
        int(sum(all_repair_secs) / len(all_repair_secs)) if all_repair_secs else 0
    )
    total_possible = period_secs * len(assets)
    overall_pct = max(0.0, min(100.0,
        (1 - total_defective_secs_overall / max(1, total_possible)) * 100
    ))

    return {
        "user_id": user_id,
        "user_name": user.get("name"),
        "employee_id": user.get("employee_id"),
        "department_name": dept_name,
        "period": {"from": range_start.isoformat(), "to": range_end.isoformat()},
        "summary": {
            "total_assets": len(assets),
            "total_defects": total_defects_overall,
            "avg_repair_seconds": overall_avg,
            "avg_repair_hours": round(overall_avg / 3600, 2),
            "pct_functional": round(overall_pct, 2),
            "rejection_count": total_rejections_overall,
        },
        "categories": categories,
        "available_stations": [
            {"_id": sid, "name": station_map.get(sid, "")} for sid in station_ids
        ],
        "available_locations": [
            {"_id": lid, "name": location_map.get(lid, "")} for lid in location_ids_set
        ],
    }


@router.get("/api/analytics/approving-supervisor/{user_id}/performance-summary")
async def asup_performance_summary(
    user_id: str,
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
):
    """Comparison table: summary performance for all supervisors under an ASUP."""
    try:
        asup = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not asup:
        raise HTTPException(status_code=404, detail="User not found")

    now = datetime.utcnow()
    range_end = _parse_dt_param(to_date, now)
    range_start = _parse_dt_param(from_date, now - timedelta(days=30))

    asup_stations = list(asup.get("assigned_stations") or [])
    if not asup_stations:
        return {"supervisors": [], "period": {"from": range_start.isoformat(), "to": range_end.isoformat()}}

    sup_docs = await users_collection.find({
        "role": UserRole.SUPERVISOR.value,
        "is_active": True,
        "assigned_stations": {"$in": asup_stations},
    }).to_list(500)

    supervisors = await _build_comparison_summary(sup_docs, range_start, range_end)
    return {
        "supervisors": supervisors,
        "period": {"from": range_start.isoformat(), "to": range_end.isoformat()},
    }


@router.get("/api/analytics/reporting-officer/{user_id}/performance-summary")
async def ro_performance_summary(
    user_id: str,
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
):
    """Comparison table: summary performance for all supervisors under an RO."""
    try:
        ro = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not ro:
        raise HTTPException(status_code=404, detail="User not found")

    now = datetime.utcnow()
    range_end = _parse_dt_param(to_date, now)
    range_start = _parse_dt_param(from_date, now - timedelta(days=30))

    ro_stations = list(ro.get("assigned_stations") or [])
    ro_dept = ro.get("department_id")
    if not ro_stations:
        return {"supervisors": [], "period": {"from": range_start.isoformat(), "to": range_end.isoformat()}}

    query: dict = {
        "role": UserRole.SUPERVISOR.value,
        "is_active": True,
        "assigned_stations": {"$in": ro_stations},
    }
    if ro_dept:
        query["department_id"] = ro_dept

    sup_docs = await users_collection.find(query).to_list(500)
    supervisors = await _build_comparison_summary(sup_docs, range_start, range_end)
    return {
        "supervisors": supervisors,
        "period": {"from": range_start.isoformat(), "to": range_end.isoformat()},
    }


# ─────────────────────────────────────────────────────────────────────────────
# Legacy endpoints (kept for backward compatibility)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api/analytics/supervisor/{user_id}")
async def supervisor_analytics(user_id: str):
    """Legacy: all-time analytics, no date filter. Use /performance for new UI."""
    try:
        user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    sup_stations = list(user.get("assigned_stations") or [])
    dept_id = user.get("department_id")
    if sup_stations and dept_id:
        tdocs = await asset_types_collection.find({"department_id": dept_id}, {"_id": 1}).to_list(2000)
        sup_type_ids = [str(t["_id"]) for t in tdocs]
        assets = await assets_collection.find({
            "station_id": {"$in": sup_stations},
            "asset_type_id": {"$in": sup_type_ids}
        }).to_list(5000) if sup_type_ids else []
    else:
        assets = []
    categories = await _analytics_for_asset_set(assets)

    overall_pct = round(
        sum(c["pct_functional"] * c["asset_count"] for c in categories)
        / max(1, sum(c["asset_count"] for c in categories)), 2
    ) if categories else 100.0
    return {
        "user_id": user_id,
        "user_name": user.get("name"),
        "total_assets": sum(c["asset_count"] for c in categories),
        "overall_pct_functional": overall_pct,
        "categories": categories,
    }


@router.get("/api/analytics/approving-supervisor/{user_id}/supervisors")
async def approving_supervisor_analytics(user_id: str):
    """Legacy list. For comparison table with date filters use /performance-summary."""
    try:
        asup = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not asup:
        raise HTTPException(status_code=404, detail="User not found")

    asup_stations = asup.get("assigned_stations", []) or []
    if not asup_stations:
        return {"approving_supervisor_id": user_id, "supervisors": []}

    sup_docs = await users_collection.find({
        "role": UserRole.SUPERVISOR.value,
        "is_active": True,
        "assigned_stations": {"$in": asup_stations}
    }).to_list(1000)

    out = []
    for s in sup_docs:
        sid = str(s["_id"])
        sup_stations_a = list(s.get("assigned_stations") or [])
        sup_dept_a = s.get("department_id")
        if sup_stations_a and sup_dept_a:
            _td = await asset_types_collection.find({"department_id": sup_dept_a}, {"_id": 1}).to_list(2000)
            _tids = [str(t["_id"]) for t in _td]
            assets = await assets_collection.find({
                "station_id": {"$in": sup_stations_a},
                "asset_type_id": {"$in": _tids}
            }).to_list(5000) if _tids else []
        else:
            assets = []
        categories = await _analytics_for_asset_set(assets)
        slim = [{k: v for k, v in c.items() if k != "assets"} for c in categories]
        dept_name = None
        if s.get("department_id"):
            dept = await departments_collection.find_one({"_id": ObjectId(s["department_id"])})
            dept_name = dept["name"] if dept else None
        out.append({
            "_id": sid,
            "name": s.get("name"),
            "employee_id": s.get("employee_id"),
            "department_name": dept_name,
            "total_assets": sum(c["asset_count"] for c in categories),
            "categories": slim,
        })
    out.sort(key=lambda x: x["name"] or "")
    return {"approving_supervisor_id": user_id, "supervisors": out}


@router.get("/api/analytics/asset/{asset_id}")
async def asset_analytics(asset_id: str):
    """Performance analytics for a single asset."""
    try:
        asset = await assets_collection.find_one({"_id": ObjectId(asset_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid asset_id")
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    history = await orange_list_collection.find({"asset_id": asset_id}).to_list(10000)
    return _compute_asset_metrics(asset, history, datetime.utcnow())
