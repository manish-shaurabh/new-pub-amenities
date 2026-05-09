"""
Reports Builder — Superadmin-only customisable report engine.

A single generic engine that handles:
  metrics    : pct_working | mttr | defect_frequency | rejection_rate | inspection_volume
  dimensions : station | location | department | asset_type | supervisor | time_bucket
  cross-tab  : up to 2 dimensions (dim_x × dim_y → matrix cells)
  filters    : station_ids, dept_ids, asset_type_ids, role, list_type, status
  windows    : last_7d | last_30d | last_90d | last_180d | fy | all_time | custom

Endpoints
  POST /api/reports/builder/run/{user_id}      — execute a config, return rows/matrix
  GET  /api/reports/builder/saved/{user_id}    — list saved configs
  POST /api/reports/builder/save/{user_id}     — save a config
  DELETE /api/reports/builder/saved/{id}/{user_id}
  GET  /api/reports/builder/featured           — 8 ready-made configs
  GET  /api/reports/builder/dimensions/{user_id} — filter option metadata
  POST /api/reports/builder/export/{fmt}/{user_id} (fmt=pdf|excel|csv)

All endpoints reject non-superadmin users.
"""
import io
import csv
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from database import (
    users_collection, assets_collection, asset_types_collection,
    stations_collection, locations_collection, departments_collection,
    orange_list_collection, inspections_collection, saved_reports_collection,
    now_ist,
)

router = APIRouter()


# ════════════════════════════════════════════════════════════════════════════
# Auth gate — Superadmin only
# ════════════════════════════════════════════════════════════════════════════
async def _ensure_sa(user_id: str) -> dict:
    try:
        u = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if u.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Superadmin only")
    return u


# ════════════════════════════════════════════════════════════════════════════
# Datetime helper (handles naive IST strings/datetimes uniformly)
# ════════════════════════════════════════════════════════════════════════════
def _parse_dt(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.replace(tzinfo=None) if v.tzinfo else v
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v.replace("Z", "").replace("+00:00", ""))
        except Exception:
            return None
    return None


# ════════════════════════════════════════════════════════════════════════════
# Time window
# ════════════════════════════════════════════════════════════════════════════
def _window(window: str, custom_from: Optional[str], custom_to: Optional[str]):
    """Return (from_dt, to_dt) — both naive IST, inclusive."""
    now = now_ist()
    if window == "all_time":
        return None, now
    if window == "custom":
        return _parse_dt(custom_from), _parse_dt(custom_to) or now
    if window == "fy":
        # Indian FY: Apr 1 – Mar 31
        if now.month >= 4:
            start = datetime(now.year, 4, 1)
        else:
            start = datetime(now.year - 1, 4, 1)
        return start, now
    days = {"last_7d": 7, "last_30d": 30, "last_90d": 90, "last_180d": 180}.get(window)
    if days:
        return now - timedelta(days=days), now
    return None, now


# ════════════════════════════════════════════════════════════════════════════
# Universe loader (single trip — small dataset)
# ════════════════════════════════════════════════════════════════════════════
async def _load_universe(filters: dict):
    """Pre-filter assets/users/etc. Returns a dict of dicts indexed by _id."""
    assets = await assets_collection.find({}).to_list(20000)
    types = await asset_types_collection.find({}).to_list(2000)
    stations = await stations_collection.find({}).to_list(2000)
    locations = await locations_collection.find({}).to_list(5000)
    depts = await departments_collection.find({}).to_list(500)
    users = await users_collection.find({}).to_list(5000)
    type_by_id = {str(t["_id"]): t for t in types}
    station_by_id = {str(s["_id"]): s for s in stations}
    location_by_id = {str(l["_id"]): l for l in locations}
    dept_by_id = {str(d["_id"]): d for d in depts}
    user_by_id = {str(u["_id"]): u for u in users}

    # Apply filters at asset level
    f_stations = set(filters.get("station_ids") or [])
    f_depts = set(filters.get("dept_ids") or [])
    f_types = set(filters.get("asset_type_ids") or [])
    if f_stations or f_depts or f_types:
        def _ok(a):
            if f_stations and a.get("station_id") not in f_stations:
                return False
            t = type_by_id.get(a.get("asset_type_id"), {})
            if f_depts and t.get("department_id") not in f_depts:
                return False
            if f_types and a.get("asset_type_id") not in f_types:
                return False
            return True
        assets = [a for a in assets if _ok(a)]

    return {
        "assets": assets,
        "type_by_id": type_by_id,
        "station_by_id": station_by_id,
        "location_by_id": location_by_id,
        "dept_by_id": dept_by_id,
        "user_by_id": user_by_id,
    }


# ════════════════════════════════════════════════════════════════════════════
# Dimension extractors — return (key, label) for an asset/event row
# ════════════════════════════════════════════════════════════════════════════
def _dim_for_asset(U: dict, asset: dict, dim: str):
    if dim == "station":
        s = U["station_by_id"].get(asset.get("station_id"), {})
        return asset.get("station_id") or "—", s.get("name", "—")
    if dim == "location":
        l = U["location_by_id"].get(asset.get("location_id"), {})
        return asset.get("location_id") or "—", l.get("name", "—")
    if dim == "department":
        t = U["type_by_id"].get(asset.get("asset_type_id"), {})
        d = U["dept_by_id"].get(t.get("department_id"), {})
        return t.get("department_id") or "—", d.get("name", "—")
    if dim == "asset_type":
        t = U["type_by_id"].get(asset.get("asset_type_id"), {})
        return asset.get("asset_type_id") or "—", t.get("name", "—")
    return "—", "—"


def _dim_for_user(U: dict, user_id: str, dim: str):
    u = U["user_by_id"].get(user_id, {})
    if dim == "supervisor":
        return user_id or "—", u.get("name") or u.get("employee_id") or "—"
    return None


def _dim_for_time(dt: datetime, dim: str):
    if not dt:
        return None
    if dim == "time_bucket_day":
        return dt.strftime("%Y-%m-%d"), dt.strftime("%d %b %Y")
    if dim == "time_bucket_week":
        # ISO week
        y, w, _ = dt.isocalendar()
        return f"{y}-W{w:02d}", f"{y} W{w:02d}"
    if dim == "time_bucket_month":
        return dt.strftime("%Y-%m"), dt.strftime("%b %Y")
    if dim == "time_bucket_quarter":
        q = (dt.month - 1) // 3 + 1
        return f"{dt.year}-Q{q}", f"{dt.year} Q{q}"
    return None


def _key_label(U: dict, asset: Optional[dict], event: Optional[dict],
               dim: str) -> tuple:
    """Resolve a (key, label) tuple for any dimension+row combination."""
    if dim.startswith("time_bucket"):
        # event must carry its own anchor datetime
        dt = event.get("_event_dt") if event else None
        return _dim_for_time(dt, dim) or ("—", "—")
    if dim == "supervisor":
        # event-level: who acted (reported_by / marked_working_by / inspector_id)
        actor = (event or {}).get("_actor_id")
        return _dim_for_user(U, actor, dim) or ("—", "—")
    # asset-level
    if asset:
        return _dim_for_asset(U, asset, dim)
    return ("—", "—")


# ════════════════════════════════════════════════════════════════════════════
# Metric engine — each metric returns a list of "events", each event is a row
# that contributes to one cell. Then we aggregate per (key_x, key_y).
# ════════════════════════════════════════════════════════════════════════════
def _classify(asset, ol_open):
    st = asset.get("status")
    if st == "working":
        return "working"
    if st == "pending_approval":
        return "yellow"
    ds = (ol_open or {}).get("defective_since") or asset.get("defective_since")
    ds_dt = _parse_dt(ds)
    if not ds_dt:
        return "orange"
    hours = (now_ist() - ds_dt).total_seconds() / 3600
    return "red" if hours > 24 else "orange"


def _percentile(arr: List[float], p: float):
    if not arr:
        return None
    arr = sorted(arr)
    k = (len(arr) - 1) * p
    f = int(k); c = min(f + 1, len(arr) - 1)
    if f == c:
        return arr[f]
    return arr[f] + (arr[c] - arr[f]) * (k - f)


async def _events_pct_working(U: dict, win, filters):
    """Each asset in scope is one event with class=working/yellow/orange/red."""
    open_ols = await orange_list_collection.find(
        {"status": {"$ne": "resolved"}}).to_list(20000)
    ol_by_asset = {ol["asset_id"]: ol for ol in open_ols}
    events = []
    for a in U["assets"]:
        cls = _classify(a, ol_by_asset.get(str(a["_id"])))
        events.append({"_asset": a, "_value": 1 if cls in ("working", "yellow") else 0,
                       "_class": cls})
    return events


async def _events_mttr(U: dict, win, filters):
    """Resolved OL entries inside the window. value = repair hours."""
    f_dt, t_dt = win
    asset_ids = {str(a["_id"]) for a in U["assets"]}
    q = {"status": "resolved"}
    if f_dt or t_dt:
        # We anchor on marked_working_at (the moment the SUP fixed it)
        # Stored as ISO strings → use a Python-side filter for simplicity & correctness.
        pass
    ols = await orange_list_collection.find(q).to_list(50000)
    asset_by_id = {str(a["_id"]): a for a in U["assets"]}
    events = []
    for ol in ols:
        if ol.get("asset_id") not in asset_ids:
            continue
        ds = _parse_dt(ol.get("defective_since"))
        mw = _parse_dt(ol.get("marked_working_at"))
        if not ds or not mw:
            continue
        if f_dt and mw < f_dt:
            continue
        if t_dt and mw > t_dt:
            continue
        hours = (mw - ds).total_seconds() / 3600
        if hours < 0:
            continue
        events.append({
            "_asset": asset_by_id.get(ol.get("asset_id")),
            "_value": hours,
            "_event_dt": mw,
            "_actor_id": ol.get("marked_working_by"),
        })
    return events


async def _events_defect_frequency(U: dict, win, filters):
    """Each new OL entry inside window = 1 event."""
    f_dt, t_dt = win
    asset_ids = {str(a["_id"]) for a in U["assets"]}
    asset_by_id = {str(a["_id"]): a for a in U["assets"]}
    ols = await orange_list_collection.find({}).to_list(50000)
    events = []
    for ol in ols:
        if ol.get("asset_id") not in asset_ids:
            continue
        ds = _parse_dt(ol.get("defective_since")) or _parse_dt(ol.get("created_at"))
        if not ds:
            continue
        if f_dt and ds < f_dt:
            continue
        if t_dt and ds > t_dt:
            continue
        events.append({
            "_asset": asset_by_id.get(ol.get("asset_id")),
            "_value": 1,
            "_event_dt": ds,
            "_actor_id": ol.get("reported_by"),
        })
    return events


async def _events_rejection_rate(U: dict, win, filters):
    """Each closed (approved or rejected) verdict in window = 1 event.
    _value = 1 if rejected else 0."""
    f_dt, t_dt = win
    asset_ids = {str(a["_id"]) for a in U["assets"]}
    asset_by_id = {str(a["_id"]): a for a in U["assets"]}
    ols = await orange_list_collection.find({"status": {"$in": ["resolved", "defective"]}}).to_list(50000)
    events = []
    for ol in ols:
        if ol.get("asset_id") not in asset_ids:
            continue
        verdict = None
        verdict_dt = None
        actor = None
        if ol.get("status") == "resolved" and ol.get("approved_at"):
            verdict = 0
            verdict_dt = _parse_dt(ol.get("approved_at"))
            actor = ol.get("approved_by")
        elif ol.get("rejection_remarks") or ol.get("rejected_at"):
            verdict = 1
            verdict_dt = _parse_dt(ol.get("rejected_at"))
            actor = ol.get("rejected_by") or ol.get("approved_by")
        if verdict is None or not verdict_dt:
            continue
        if f_dt and verdict_dt < f_dt:
            continue
        if t_dt and verdict_dt > t_dt:
            continue
        events.append({
            "_asset": asset_by_id.get(ol.get("asset_id")),
            "_value": verdict,
            "_event_dt": verdict_dt,
            "_actor_id": actor,
        })
    return events


async def _events_inspection_volume(U: dict, win, filters):
    f_dt, t_dt = win
    asset_ids = {str(a["_id"]) for a in U["assets"]}
    asset_by_id = {str(a["_id"]): a for a in U["assets"]}
    inspections = await inspections_collection.find({}).to_list(50000)
    events = []
    for ins in inspections:
        ins_dt = _parse_dt(ins.get("inspection_at"))
        if not ins_dt:
            continue
        if f_dt and ins_dt < f_dt:
            continue
        if t_dt and ins_dt > t_dt:
            continue
        for it in ins.get("items", []):
            if it.get("asset_id") not in asset_ids:
                continue
            events.append({
                "_asset": asset_by_id.get(it.get("asset_id")),
                "_value": 1,
                "_event_dt": ins_dt,
                "_actor_id": ins.get("inspector_id"),
            })
    return events


METRIC_FNS = {
    "pct_working": _events_pct_working,
    "mttr": _events_mttr,
    "defect_frequency": _events_defect_frequency,
    "rejection_rate": _events_rejection_rate,
    "inspection_volume": _events_inspection_volume,
}


# ════════════════════════════════════════════════════════════════════════════
# Aggregator — combine events into cells per (dim_x, dim_y)
# ════════════════════════════════════════════════════════════════════════════
def _aggregate(events: List[dict], metric: str, U: dict,
               dim_x: str, dim_y: Optional[str]) -> dict:
    """Return {
      "rows":   [{"key_x": "...", "label_x": "...", "value": ...,
                  "ext": {extra metric stats}}, ...]   # if no dim_y
      "matrix": [[cell, ...], ...] with row_keys, col_keys              # if dim_y
    }
    """
    cells: Dict[tuple, List[float]] = defaultdict(list)
    label_x: Dict[str, str] = {}
    label_y: Dict[str, str] = {}

    for e in events:
        kx, lx = _key_label(U, e.get("_asset"), e, dim_x)
        ky = ly = None
        if dim_y:
            ky, ly = _key_label(U, e.get("_asset"), e, dim_y)
        if not kx:
            continue
        label_x[kx] = lx
        if dim_y and ky:
            label_y[ky] = ly
            cells[(kx, ky)].append(e["_value"])
        else:
            cells[(kx, None)].append(e["_value"])

    def _stat(arr):
        n = len(arr)
        if n == 0:
            return {"n": 0, "value": None}
        if metric == "pct_working":
            return {"n": n, "value": round(sum(arr) / n * 100, 1)}
        if metric == "mttr":
            return {
                "n": n,
                "value": round(_percentile(arr, 0.5), 1),
                "p75": round(_percentile(arr, 0.75), 1),
                "p90": round(_percentile(arr, 0.90), 1),
                "min": round(min(arr), 1),
                "max": round(max(arr), 1),
                "mean": round(sum(arr) / n, 1),
            }
        if metric == "defect_frequency" or metric == "inspection_volume":
            return {"n": n, "value": int(sum(arr))}
        if metric == "rejection_rate":
            return {"n": n, "value": round(sum(arr) / n * 100, 1)}
        return {"n": n, "value": None}

    if not dim_y:
        rows = []
        for kx, vals in cells.items():
            stat = _stat(vals)
            rows.append({"key_x": kx[0], "label_x": label_x.get(kx[0], "—"), **stat})
        rows.sort(key=lambda r: -(r["value"] or 0))
        return {"rows": rows}

    # 2-dim matrix
    row_keys = sorted(label_x.keys(), key=lambda k: label_x.get(k, ""))
    col_keys = sorted(label_y.keys(), key=lambda k: label_y.get(k, ""))
    matrix = []
    for rk in row_keys:
        row_cells = []
        for ck in col_keys:
            vals = cells.get((rk, ck), [])
            row_cells.append(_stat(vals))
        matrix.append(row_cells)
    return {
        "row_keys": row_keys,
        "row_labels": [label_x.get(k, "—") for k in row_keys],
        "col_keys": col_keys,
        "col_labels": [label_y.get(k, "—") for k in col_keys],
        "matrix": matrix,
    }


# ════════════════════════════════════════════════════════════════════════════
# Run engine
# ════════════════════════════════════════════════════════════════════════════
class BuilderConfig(BaseModel):
    metric: str
    dim_x: str
    dim_y: Optional[str] = None
    window: str = "last_30d"
    custom_from: Optional[str] = None
    custom_to: Optional[str] = None
    filters: Dict[str, Any] = Field(default_factory=dict)


async def _run_config(cfg: BuilderConfig) -> dict:
    if cfg.metric not in METRIC_FNS:
        raise HTTPException(status_code=400, detail=f"Unknown metric '{cfg.metric}'")
    win = _window(cfg.window, cfg.custom_from, cfg.custom_to)
    U = await _load_universe(cfg.filters or {})
    events = await METRIC_FNS[cfg.metric](U, win, cfg.filters or {})
    agg = _aggregate(events, cfg.metric, U, cfg.dim_x, cfg.dim_y)
    return {
        "config": cfg.dict(),
        "window": {"from": win[0].isoformat() if win[0] else None,
                   "to": win[1].isoformat() if win[1] else None},
        "asset_pool_size": len(U["assets"]),
        "event_count": len(events),
        **agg,
        "generated_at": now_ist().isoformat(),
    }


@router.post("/api/reports/builder/run/{user_id}")
async def builder_run(user_id: str, cfg: BuilderConfig):
    await _ensure_sa(user_id)
    return await _run_config(cfg)


# ════════════════════════════════════════════════════════════════════════════
# Saved reports CRUD
# ════════════════════════════════════════════════════════════════════════════
class SavedReportCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    config: BuilderConfig


@router.get("/api/reports/builder/saved/{user_id}")
async def list_saved(user_id: str):
    await _ensure_sa(user_id)
    docs = await saved_reports_collection.find({"owner_id": user_id}).sort("created_at", -1).to_list(500)
    return [{
        "_id": str(d["_id"]),
        "name": d["name"],
        "config": d["config"],
        "created_at": d.get("created_at"),
    } for d in docs]


@router.post("/api/reports/builder/save/{user_id}")
async def save_report(user_id: str, payload: SavedReportCreate):
    await _ensure_sa(user_id)
    doc = {
        "owner_id": user_id,
        "name": payload.name,
        "config": payload.config.dict(),
        "created_at": now_ist().isoformat(),
    }
    res = await saved_reports_collection.insert_one(doc)
    return {"_id": str(res.inserted_id), **{k: v for k, v in doc.items() if k != "_id"}}


@router.delete("/api/reports/builder/saved/{report_id}/{user_id}")
async def delete_saved(report_id: str, user_id: str):
    await _ensure_sa(user_id)
    try:
        oid = ObjectId(report_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid id")
    res = await saved_reports_collection.delete_one({"_id": oid, "owner_id": user_id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Not found")
    return {"deleted": True}


# ════════════════════════════════════════════════════════════════════════════
# Featured library — 8 ready-made configs (no DB hit, just static list)
# ════════════════════════════════════════════════════════════════════════════
FEATURED: List[dict] = [
    {
        "id": "today_new_defects_by_station",
        "name": "Today's New Defects by Station",
        "description": "Count of new OL entries opened in the last 24 hours, grouped by station.",
        "config": {"metric": "defect_frequency", "dim_x": "station",
                   "window": "last_7d", "filters": {}},
    },
    {
        "id": "weekly_mttr_by_asset_type",
        "name": "Weekly MTTR by Asset Type",
        "description": "Median repair hours over the last 7 days, grouped by asset type.",
        "config": {"metric": "mttr", "dim_x": "asset_type",
                   "window": "last_7d", "filters": {}},
    },
    {
        "id": "worst_locations_30d",
        "name": "Worst Locations (last 30d)",
        "description": "% Working by Location — worst-first.",
        "config": {"metric": "pct_working", "dim_x": "location",
                   "window": "last_30d", "filters": {}},
    },
    {
        "id": "slow_supervisors_30d",
        "name": "Slowest Supervisors by MTTR (last 30d)",
        "description": "Median repair hours per supervisor.",
        "config": {"metric": "mttr", "dim_x": "supervisor",
                   "window": "last_30d", "filters": {}},
    },
    {
        "id": "defect_heatmap_station_x_type",
        "name": "Defect Frequency Heatmap — Station × Asset Type",
        "description": "Count of defects per station × asset type. (cross-tab)",
        "config": {"metric": "defect_frequency", "dim_x": "station",
                   "dim_y": "asset_type", "window": "last_30d", "filters": {}},
    },
    {
        "id": "rejection_rate_supervisor_90d",
        "name": "Rejection Rate by Supervisor (last 90d)",
        "description": "% of mark-working claims rejected per supervisor.",
        "config": {"metric": "rejection_rate", "dim_x": "supervisor",
                   "window": "last_90d", "filters": {}},
    },
    {
        "id": "fy_mttr_by_dept",
        "name": "FY-to-date MTTR by Department",
        "description": "Median repair hours since Apr 1 per department.",
        "config": {"metric": "mttr", "dim_x": "department",
                   "window": "fy", "filters": {}},
    },
    {
        "id": "inspection_volume_inspector_7d",
        "name": "Inspection Volume by Inspector (last 7d)",
        "description": "Inspection items per inspector over the last week.",
        "config": {"metric": "inspection_volume", "dim_x": "supervisor",
                   "window": "last_7d", "filters": {}},
    },
]


@router.get("/api/reports/builder/featured")
async def featured():
    return FEATURED


# ════════════════════════════════════════════════════════════════════════════
# Dimensions metadata (for filter dropdowns)
# ════════════════════════════════════════════════════════════════════════════
@router.get("/api/reports/builder/dimensions/{user_id}")
async def dims_meta(user_id: str):
    await _ensure_sa(user_id)
    stations = await stations_collection.find({}).to_list(2000)
    depts = await departments_collection.find({}).to_list(500)
    types = await asset_types_collection.find({}).to_list(2000)
    return {
        "stations": [{"id": str(s["_id"]), "name": s.get("name", "")} for s in stations],
        "departments": [{"id": str(d["_id"]), "name": d.get("name", "")} for d in depts],
        "asset_types": [{"id": str(t["_id"]), "name": t.get("name", "")} for t in types],
        "metrics": [
            {"id": "pct_working", "name": "% Working", "unit": "%"},
            {"id": "mttr", "name": "MTTR (median repair hours)", "unit": "hrs"},
            {"id": "defect_frequency", "name": "Defect Frequency (new defects)", "unit": "count"},
            {"id": "rejection_rate", "name": "Rejection Rate", "unit": "%"},
            {"id": "inspection_volume", "name": "Inspection Volume", "unit": "count"},
        ],
        "dimensions": [
            {"id": "station", "name": "Station"},
            {"id": "location", "name": "Location"},
            {"id": "department", "name": "Department"},
            {"id": "asset_type", "name": "Asset Type"},
            {"id": "supervisor", "name": "Person (actor)"},
            {"id": "time_bucket_day", "name": "Day"},
            {"id": "time_bucket_week", "name": "Week"},
            {"id": "time_bucket_month", "name": "Month"},
            {"id": "time_bucket_quarter", "name": "Quarter (FY-aligned)"},
        ],
        "windows": [
            {"id": "last_7d", "name": "Last 7 days"},
            {"id": "last_30d", "name": "Last 30 days"},
            {"id": "last_90d", "name": "Last 90 days"},
            {"id": "last_180d", "name": "Last 180 days"},
            {"id": "fy", "name": "Current Financial Year"},
            {"id": "all_time", "name": "All time"},
            {"id": "custom", "name": "Custom range"},
        ],
    }


# ════════════════════════════════════════════════════════════════════════════
# Exports — CSV / Excel / PDF
# ════════════════════════════════════════════════════════════════════════════
def _flatten_for_export(result: dict) -> tuple:
    """Return (headers, rows) flattening either single-dim rows or 2-dim matrix.
    For mttr we expand p75/p90/min/max columns."""
    cfg = result["config"]
    metric = cfg["metric"]
    extra_cols = []
    if metric == "mttr":
        extra_cols = ["p75", "p90", "min", "max", "mean"]

    if "matrix" in result:
        headers = ["Row \\ Col"] + result["col_labels"]
        rows = []
        for ridx, rk in enumerate(result["row_keys"]):
            row = [result["row_labels"][ridx]]
            for cell in result["matrix"][ridx]:
                v = cell.get("value")
                row.append("" if v is None else v)
            rows.append(row)
        return headers, rows

    headers = [_dim_label(cfg["dim_x"]), "Value", "n"] + [c.upper() for c in extra_cols]
    rows = []
    for r in result["rows"]:
        row = [r["label_x"], r["value"], r["n"]]
        for c in extra_cols:
            row.append(r.get(c))
        rows.append(row)
    return headers, rows


def _dim_label(dim: str) -> str:
    return {
        "station": "Station", "location": "Location", "department": "Department",
        "asset_type": "Asset Type", "supervisor": "Person",
        "time_bucket_day": "Day", "time_bucket_week": "Week",
        "time_bucket_month": "Month", "time_bucket_quarter": "Quarter",
    }.get(dim, dim)


def _metric_label(m: str) -> str:
    return {
        "pct_working": "% Working",
        "mttr": "MTTR (median hrs)",
        "defect_frequency": "Defect Frequency",
        "rejection_rate": "Rejection Rate (%)",
        "inspection_volume": "Inspection Volume",
    }.get(m, m)


@router.post("/api/reports/builder/export/csv/{user_id}")
async def export_csv(user_id: str, cfg: BuilderConfig):
    await _ensure_sa(user_id)
    result = await _run_config(cfg)
    headers, rows = _flatten_for_export(result)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([f"Metric: {_metric_label(cfg.metric)}"])
    w.writerow([f"Window: {cfg.window}", f"Generated: {result['generated_at']}"])
    w.writerow([])
    w.writerow(headers)
    for r in rows:
        w.writerow(r)
    out = io.BytesIO(buf.getvalue().encode("utf-8"))
    fname = f"builder-{cfg.metric}-{now_ist().strftime('%Y%m%d-%H%M')}.csv"
    return StreamingResponse(out, media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})


@router.post("/api/reports/builder/export/excel/{user_id}")
async def export_excel(user_id: str, cfg: BuilderConfig):
    await _ensure_sa(user_id)
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    result = await _run_config(cfg)
    headers, rows = _flatten_for_export(result)
    wb = Workbook()
    ws = wb.active
    ws.title = "Report"
    teal = PatternFill("solid", fgColor="0E7C6B")
    bold_white = Font(bold=True, color="FFFFFF")
    ws.append([f"Metric: {_metric_label(cfg.metric)}"])
    ws.append([f"Window: {cfg.window}", f"Generated: {result['generated_at']}"])
    ws.append([])
    ws.append(headers)
    for c in ws[4]:
        c.fill = teal; c.font = bold_white
        c.alignment = Alignment(horizontal="center")
    for r in rows:
        ws.append(r)
    ws.freeze_panes = "A5"
    for col in range(1, len(headers) + 1):
        ws.column_dimensions[chr(64 + col)].width = 22
    out = io.BytesIO()
    wb.save(out); out.seek(0)
    fname = f"builder-{cfg.metric}-{now_ist().strftime('%Y%m%d-%H%M')}.xlsx"
    return StreamingResponse(
        out,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.post("/api/reports/builder/export/pdf/{user_id}")
async def export_pdf(user_id: str, cfg: BuilderConfig):
    await _ensure_sa(user_id)
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    result = await _run_config(cfg)
    headers, rows = _flatten_for_export(result)
    out = io.BytesIO()
    doc = SimpleDocTemplate(out, pagesize=landscape(A4),
                            leftMargin=12*mm, rightMargin=12*mm,
                            topMargin=12*mm, bottomMargin=12*mm,
                            title="Custom Report")
    styles = getSampleStyleSheet()
    title = ParagraphStyle("t", parent=styles["Heading1"], fontSize=14,
                           textColor=colors.HexColor("#0e7c6b"), spaceAfter=4)
    sub = ParagraphStyle("s", parent=styles["Normal"], fontSize=8,
                         textColor=colors.HexColor("#64748b"))
    elements = [Paragraph(_metric_label(cfg.metric), title)]
    elements.append(Paragraph(
        f"Dim X: <b>{_dim_label(cfg.dim_x)}</b>"
        + (f" · Dim Y: <b>{_dim_label(cfg.dim_y)}</b>" if cfg.dim_y else "")
        + f" · Window: <b>{cfg.window}</b> · {len(rows)} row(s)", sub))
    elements.append(Spacer(1, 8))
    if rows:
        data = [headers] + [[("" if c is None else str(c)) for c in r] for r in rows]
        t = Table(data, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0e7c6b")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#cbd5e1")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1),
             [colors.white, colors.HexColor("#f8fafc")]),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        elements.append(t)
    else:
        elements.append(Paragraph("No data for this configuration.", styles["Normal"]))
    doc.build(elements)
    out.seek(0)
    fname = f"builder-{cfg.metric}-{now_ist().strftime('%Y%m%d-%H%M')}.pdf"
    return StreamingResponse(out, media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="{fname}"'})
