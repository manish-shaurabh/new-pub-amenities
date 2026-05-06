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


def _fy_window(now: Optional[datetime] = None):
    """Return (start, end) of the current Indian financial year (Apr 1 → Mar 31).
    `end` is the *exclusive* upper bound (Apr 1 of next FY) so callers can use
    `start <= ds < end` checks. The displayed label uses inclusive Mar 31.
    """
    now = now or datetime.utcnow()
    if now.month >= 4:
        start_year = now.year
    else:
        start_year = now.year - 1
    start = datetime(start_year, 4, 1)
    end = datetime(start_year + 1, 4, 1)
    return start, end


def _fy_label(start: datetime) -> str:
    """e.g. FY 25-26 for window starting Apr 1 2025."""
    return f"FY {start.year % 100:02d}-{(start.year + 1) % 100:02d}"


async def _dept_fy_avg_repair_seconds(dept_id: str,
                                       fy_start: datetime,
                                       fy_end: datetime) -> int:
    """Average repair time (seconds) across ALL resolved defects of all assets
    in the given department during the FY window.

    Uses Option A timing (marked_working_at − defective_since) and weights every
    incident equally regardless of which supervisor handled it. Returns 0 when
    no resolved defects exist in the window.
    """
    if not dept_id:
        return 0
    type_docs = await asset_types_collection.find(
        {"department_id": dept_id}, {"_id": 1}
    ).to_list(2000)
    type_ids = [str(t["_id"]) for t in type_docs]
    if not type_ids:
        return 0
    asset_docs = await assets_collection.find(
        {"asset_type_id": {"$in": type_ids}}, {"_id": 1}
    ).to_list(50000)
    asset_ids = [str(a["_id"]) for a in asset_docs]
    if not asset_ids:
        return 0
    records = await orange_list_collection.find(
        {"asset_id": {"$in": asset_ids}}
    ).to_list(200000)

    durations = []
    for rec in records:
        ds = _coerce_dt(rec.get("defective_since"))
        mw = _coerce_dt(rec.get("marked_working_at"))
        if not ds or not mw or mw <= ds:
            continue
        if ds < fy_start or ds >= fy_end:
            continue
        durations.append(int((mw - ds).total_seconds()))
    if not durations:
        return 0
    return int(sum(durations) / len(durations))


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
    Each row also carries the supervisor's department FY avg-repair benchmark.
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

    # Compute FY benchmark once per department (used by every row)
    fy_start, fy_end = _fy_window()
    fy_label = _fy_label(fy_start)
    dept_fy_benchmark: dict = {}
    for did in dept_ids:
        dept_fy_benchmark[did] = await _dept_fy_avg_repair_seconds(did, fy_start, fy_end)

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

        dept_id = s.get("department_id") or ""
        bench_secs = dept_fy_benchmark.get(dept_id, 0)
        result.append({
            "_id": sid,
            "name": s.get("name"),
            "employee_id": s.get("employee_id"),
            "department_name": dept_name_map.get(dept_id, ""),
            "department_id": dept_id,
            "summary": {
                "total_assets": len(assets),
                "total_defects": total_defects,
                "avg_repair_seconds": avg_repair,
                "avg_repair_hours": round(avg_repair / 3600, 2),
                "pct_functional": round(pct_f, 2),
                "rejection_count": total_rejections,
                "zero_defect": total_defects == 0,
            },
            "benchmark": {
                "scope": "department",
                "fy_label": fy_label,
                "fy_avg_repair_seconds": bench_secs,
                "fy_avg_repair_hours": round(bench_secs / 3600, 2),
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


# ─────────────────────────────────────────────────────────────────────────────
# Phase 4 Extensions — Admin rollup + coverage gaps
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/api/analytics/admin/rollup")
async def admin_rollup_matrix(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
):
    """Station-row × Department-column performance rollup matrix.

    Each cell aggregates across every active SUP at that (station, department)
    intersection. A cell with `sup_count = 0` indicates an orphaned slot
    (no active supervisor assigned).
    """
    now = datetime.utcnow()
    range_end = _parse_dt_param(to_date, now)
    range_start = _parse_dt_param(from_date, now - timedelta(days=30))

    # Load all stations & departments (axes)
    stations = await stations_collection.find({}).to_list(2000)
    departments = await departments_collection.find({}).to_list(500)
    stations.sort(key=lambda s: (s.get("name") or "").lower())
    departments.sort(key=lambda d: (d.get("name") or "").lower())

    station_axis = [{"_id": str(s["_id"]), "name": s.get("name", "")} for s in stations]
    dept_axis = [{"_id": str(d["_id"]), "name": d.get("name", "")} for d in departments]

    # Active SUPs grouped by (station, dept)
    sup_docs = await users_collection.find({
        "role": UserRole.SUPERVISOR.value, "is_active": True,
    }).to_list(5000)

    by_cell: dict = {}  # (station_id, dept_id) -> [sup_ids]
    for s in sup_docs:
        dept_id = s.get("department_id")
        for st_id in (s.get("assigned_stations") or []):
            by_cell.setdefault((st_id, dept_id), []).append(str(s["_id"]))

    # Build the comparison summary once for ALL SUPs to amortise cost
    all_sup_summary = await _build_comparison_summary(sup_docs, range_start, range_end)
    sup_by_id = {row["_id"]: row for row in all_sup_summary}

    # FY benchmark per dept (only computed where it's needed)
    fy_start, fy_end = _fy_window(now)
    fy_label = _fy_label(fy_start)

    matrix = []
    for st in station_axis:
        row = {"station_id": st["_id"], "station_name": st["name"], "cells": []}
        for dept in dept_axis:
            sup_ids = by_cell.get((st["_id"], dept["_id"]), [])
            sup_count = len(sup_ids)
            if sup_count == 0:
                row["cells"].append({
                    "station_id": st["_id"],
                    "department_id": dept["_id"],
                    "sup_count": 0,
                    "asset_count": 0,
                    "total_defects": 0,
                    "avg_repair_seconds": 0,
                    "avg_repair_hours": 0.0,
                    "pct_functional": None,
                    "rejection_count": 0,
                    "zero_defect": False,
                    "is_orphan": True,
                })
                continue

            # Aggregate per-cell (we only need station-scoped slice of each SUP, but
            # for simplicity we use the SUP's own summary row — it already accounts
            # for all the SUP's stations. Where a SUP serves multiple stations we
            # split assets evenly only for the asset_count display; metric averages
            # are still meaningful because the SUP is the same person on both rows.)
            total_assets = sum(sup_by_id.get(sid, {}).get("summary", {}).get("total_assets", 0) for sid in sup_ids)
            total_defects = sum(sup_by_id.get(sid, {}).get("summary", {}).get("total_defects", 0) for sid in sup_ids)
            rejections = sum(sup_by_id.get(sid, {}).get("summary", {}).get("rejection_count", 0) for sid in sup_ids)
            avg_h_list = [sup_by_id.get(sid, {}).get("summary", {}).get("avg_repair_hours", 0) for sid in sup_ids if sup_by_id.get(sid, {}).get("summary", {}).get("avg_repair_hours", 0) > 0]
            avg_h = round(sum(avg_h_list) / len(avg_h_list), 2) if avg_h_list else 0.0
            pct_list = [sup_by_id.get(sid, {}).get("summary", {}).get("pct_functional", 100.0) for sid in sup_ids]
            pct_f = round(sum(pct_list) / len(pct_list), 2) if pct_list else 100.0

            row["cells"].append({
                "station_id": st["_id"],
                "department_id": dept["_id"],
                "sup_count": sup_count,
                "sup_ids": sup_ids,
                "asset_count": total_assets,
                "total_defects": total_defects,
                "avg_repair_seconds": int(avg_h * 3600),
                "avg_repair_hours": avg_h,
                "pct_functional": pct_f,
                "rejection_count": rejections,
                "zero_defect": total_defects == 0 and total_assets > 0,
                "is_orphan": False,
            })
        matrix.append(row)

    # Department FY benchmarks (computed once per dept regardless of station)
    dept_benchmarks = {}
    for dept in dept_axis:
        secs = await _dept_fy_avg_repair_seconds(dept["_id"], fy_start, fy_end)
        dept_benchmarks[dept["_id"]] = {
            "fy_label": fy_label,
            "fy_avg_repair_seconds": secs,
            "fy_avg_repair_hours": round(secs / 3600, 2),
        }

    return {
        "period": {"from": range_start.isoformat(), "to": range_end.isoformat()},
        "fy": {"label": fy_label, "from": fy_start.isoformat(), "to": fy_end.isoformat()},
        "stations": station_axis,
        "departments": dept_axis,
        "matrix": matrix,
        "dept_benchmarks": dept_benchmarks,
    }


@router.get("/api/analytics/admin/coverage-gaps")
async def admin_coverage_gaps():
    """Detect orphaned (Station × Department) combinations missing role coverage.

    Returns three lists:
      missing_sup  : (station_id, dept_id) lacks an active SUP   — RED severity
      missing_asup : station_id lacks an active ASUP             — AMBER severity
      missing_ro   : (station_id, dept_id) lacks an active RO    — AMBER severity
    """
    stations = await stations_collection.find({}).to_list(2000)
    departments = await departments_collection.find({}).to_list(500)
    stn_name = {str(s["_id"]): s.get("name", "") for s in stations}
    dept_name = {str(d["_id"]): d.get("name", "") for d in departments}

    sups = await users_collection.find(
        {"role": UserRole.SUPERVISOR.value, "is_active": True},
        {"assigned_stations": 1, "department_id": 1},
    ).to_list(5000)
    sup_keys = set()
    for s in sups:
        for st in (s.get("assigned_stations") or []):
            sup_keys.add((st, s.get("department_id")))

    asups = await users_collection.find(
        {"role": UserRole.APPROVING_SUPERVISOR.value, "is_active": True},
        {"assigned_stations": 1},
    ).to_list(2000)
    asup_stations = set()
    for a in asups:
        for st in (a.get("assigned_stations") or []):
            asup_stations.add(st)

    ros = await users_collection.find(
        {"role": UserRole.REPORTING_OFFICER.value, "is_active": True},
        {"assigned_stations": 1, "department_id": 1},
    ).to_list(2000)
    ro_keys = set()
    for r in ros:
        for st in (r.get("assigned_stations") or []):
            ro_keys.add((st, r.get("department_id")))

    missing_sup = []
    missing_ro = []
    for st_id in stn_name:
        for d_id in dept_name:
            if (st_id, d_id) not in sup_keys:
                missing_sup.append({
                    "station_id": st_id, "station_name": stn_name[st_id],
                    "department_id": d_id, "department_name": dept_name[d_id],
                    "severity": "red",
                })
            if (st_id, d_id) not in ro_keys:
                missing_ro.append({
                    "station_id": st_id, "station_name": stn_name[st_id],
                    "department_id": d_id, "department_name": dept_name[d_id],
                    "severity": "amber",
                })

    missing_asup = [
        {"station_id": st_id, "station_name": stn_name[st_id], "severity": "amber"}
        for st_id in stn_name if st_id not in asup_stations
    ]

    return {
        "missing_sup": missing_sup,
        "missing_asup": missing_asup,
        "missing_ro": missing_ro,
        "totals": {
            "missing_sup": len(missing_sup),
            "missing_asup": len(missing_asup),
            "missing_ro": len(missing_ro),
        },
    }

