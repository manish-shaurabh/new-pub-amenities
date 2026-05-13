"""Health Explorer — default dashboard's drill-down endpoint.

Single GET endpoint that powers the new Health Explorer dashboard. Returns
horizontal-cylinder-bar-friendly rows at each of 4 drill levels in two modes:

  MODE 'asset_type':
    L1 → rows grouped by asset-type (label=type name, value=% healthy)
    L2 (asset_type_id given) → rows grouped by station for that type
    L3 (asset_type_id + station_id given) → rows grouped by location
    L4 (asset_type_id + station_id + location_id) → individual assets

  MODE 'station':
    L1 → rows grouped by station
    L2 (station_id) → rows grouped by asset-type at that station
    L3 (station_id + asset_type_id) → rows grouped by location
    L4 (+ location_id) → individual assets

Health % = (working + yellow) / total — yellow is "fixed, awaiting approval"
so it counts as healthy for at-a-glance triage.

Scope per role:
  superadmin / admin / viewer → ALL assets (global)
  approving_supervisor       → assets at user.assigned_stations (any dept)
  supervisor / reporting_off → assets at user.assigned_stations AND
                                 asset_type.department == user.department_id

User-supplied filters (station_ids, dept_ids, asset_type_ids) intersect with
the role-scope.
"""
from __future__ import annotations

from typing import Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Query

from database import users_collection, now_ist
from routers.reports import _load_universe, _filter_assets_for_user, _classify, _empty_bucket

router = APIRouter()


# ─── Color thresholds (matches frontend) ────────────────────────────────────
def _health_color(pct: float) -> str:
    if pct >= 90:
        return "#0891b2"  # aqua cyan-600
    if pct >= 70:
        return "#f59e0b"  # amber
    return "#dc2626"      # red


def _csv(s: Optional[str]) -> List[str]:
    if not s:
        return []
    return [x.strip() for x in s.split(",") if x.strip()]


def _bucket_to_row(rid: str, label: str, bucket: Dict[str, int], *,
                   sub: str = "", drillable: bool = True,
                   extra: Optional[dict] = None) -> dict:
    total = sum(bucket.values())
    pct = round(((bucket["working"] + bucket["yellow"]) / total * 100), 1) if total else 100.0
    out = {
        "id": rid,
        "label": label or "—",
        "value": pct,           # cylinder bar fill (0-100)
        "n": total,             # asset count for tooltip
        "color": _health_color(pct),
        "sub": sub,
        "drillable": drillable,
        "pct_healthy": pct,
        "buckets": bucket,
    }
    if extra:
        out.update(extra)
    return out


@router.get("/api/dashboard/health-explorer/{user_id}")
async def health_explorer(
    user_id: str,
    mode: str = Query("asset_type", regex="^(asset_type|station)$"),
    # Drill ancestors (all optional; presence implies deeper level)
    asset_type_id: Optional[str] = None,
    station_id: Optional[str] = None,
    location_id: Optional[str] = None,
    # User-controlled filters (multi via comma-separated)
    station_ids: Optional[str] = None,
    dept_ids: Optional[str] = None,
    asset_type_ids: Optional[str] = None,
):
    try:
        user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    U = await _load_universe()

    # Role-scope the asset universe
    scoped = _filter_assets_for_user(U, user)

    # User-filter intersection
    f_stations = set(_csv(station_ids))
    f_depts = set(_csv(dept_ids))
    f_types = set(_csv(asset_type_ids))
    if f_stations:
        scoped = [a for a in scoped if a.get("station_id") in f_stations]
    if f_types:
        scoped = [a for a in scoped if a.get("asset_type_id") in f_types]
    if f_depts:
        scoped = [a for a in scoped
                  if U["type_by_id"].get(a.get("asset_type_id"), {}).get("department_id") in f_depts]

    # Apply drill-ancestor filters
    if asset_type_id:
        scoped = [a for a in scoped if a.get("asset_type_id") == asset_type_id]
    if station_id:
        scoped = [a for a in scoped if a.get("station_id") == station_id]
    if location_id:
        scoped = [a for a in scoped if a.get("location_id") == location_id]

    # Determine current level from ancestors set
    if location_id:
        level = 4
    elif (mode == "asset_type" and asset_type_id and station_id) or \
         (mode == "station" and station_id and asset_type_id):
        level = 3
    elif (mode == "asset_type" and asset_type_id) or (mode == "station" and station_id):
        level = 2
    else:
        level = 1

    # Build breadcrumb
    breadcrumb: List[dict] = []
    if mode == "asset_type":
        if asset_type_id:
            t = U["type_by_id"].get(asset_type_id, {})
            breadcrumb.append({"kind": "asset_type", "id": asset_type_id, "label": t.get("name") or "—"})
        if station_id:
            s = U["station_by_id"].get(station_id, {})
            breadcrumb.append({"kind": "station", "id": station_id, "label": s.get("name") or "—"})
    else:  # mode == "station"
        if station_id:
            s = U["station_by_id"].get(station_id, {})
            breadcrumb.append({"kind": "station", "id": station_id, "label": s.get("name") or "—"})
        if asset_type_id:
            t = U["type_by_id"].get(asset_type_id, {})
            breadcrumb.append({"kind": "asset_type", "id": asset_type_id, "label": t.get("name") or "—"})
    if location_id:
        loc = U["location_by_id"].get(location_id, {})
        breadcrumb.append({"kind": "location", "id": location_id, "label": loc.get("name") or "—"})

    # Aggregate by current grouping
    rows: List[dict] = []

    if level == 4:
        # Individual assets — one row per asset, drillable=False (frontend opens AssetHistoryDrawer)
        for a in scoped:
            cls = _classify(a, U["ol_by_asset"].get(str(a["_id"])))
            bucket = _empty_bucket()
            bucket[cls] = 1
            sub = ""
            ol = U["ol_by_asset"].get(str(a["_id"]))
            ds = ol.get("defective_since") if ol else a.get("defective_since")
            if cls != "working":
                sub = f"{cls.upper()}"
                if ds:
                    sub += f" · since {str(ds)[:16]}"
            row = _bucket_to_row(str(a["_id"]),
                                 a.get("asset_number") or "—",
                                 bucket, sub=sub, drillable=False,
                                 extra={"status": cls,
                                        "asset_number": a.get("asset_number"),
                                        "defective_since": str(ds) if ds else None})
            rows.append(row)
        # Sort worst first (red > orange > yellow > working)
        order = {"red": 0, "orange": 1, "yellow": 2, "working": 3}
        rows.sort(key=lambda r: order.get(r.get("status"), 99))
    else:
        # Decide grouping key for this level
        if level == 1:
            group_key = "asset_type_id" if mode == "asset_type" else "station_id"
        elif level == 2:
            group_key = "station_id" if mode == "asset_type" else "asset_type_id"
        else:  # level == 3
            group_key = "location_id"

        # Group
        agg: Dict[str, Dict[str, int]] = {}
        labels: Dict[str, str] = {}
        for a in scoped:
            k = a.get(group_key) or "—"
            if k not in agg:
                agg[k] = _empty_bucket()
                if group_key == "asset_type_id":
                    labels[k] = U["type_by_id"].get(k, {}).get("name") or "—"
                elif group_key == "station_id":
                    labels[k] = U["station_by_id"].get(k, {}).get("name") or "—"
                elif group_key == "location_id":
                    labels[k] = U["location_by_id"].get(k, {}).get("name") or "—"
            cls = _classify(a, U["ol_by_asset"].get(str(a["_id"])))
            agg[k][cls] += 1
        for k, bucket in agg.items():
            label = labels.get(k, "—")
            if not label or label == "—":
                # Hide unnamed rows (these are admin/data-health concerns)
                continue
            row = _bucket_to_row(k, label, bucket)
            rows.append(row)
        # Worst-first (lowest pct first)
        rows.sort(key=lambda r: r["value"])

    # Summary across the current scope
    summary_bucket = _empty_bucket()
    for a in scoped:
        cls = _classify(a, U["ol_by_asset"].get(str(a["_id"])))
        summary_bucket[cls] += 1
    s_total = sum(summary_bucket.values())
    s_healthy = summary_bucket["working"] + summary_bucket["yellow"]
    s_pct = round((s_healthy / s_total * 100), 1) if s_total else 100.0

    return {
        "mode": mode,
        "level": level,
        "breadcrumb": breadcrumb,
        "rows": rows,
        "summary": {
            "total": s_total,
            "healthy": s_healthy,
            "pct_healthy": s_pct,
            "buckets": summary_bucket,
            "color": _health_color(s_pct),
        },
        "generated_at": now_ist().isoformat(),
    }


@router.get("/api/dashboard/health-explorer/{user_id}/filters")
async def health_explorer_filters(user_id: str):
    """Return the multi-select filter options scoped to the user.

    Frontend pulls this once on mount to populate Station / Dept / Asset Type
    chip dropdowns. Each list reflects role-scope (SUP only sees their stations
    and their dept, etc.).
    """
    try:
        user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    U = await _load_universe()
    scoped = _filter_assets_for_user(U, user)
    # Unique station_ids in scope
    station_ids = sorted({a.get("station_id") for a in scoped if a.get("station_id")})
    asset_type_ids = sorted({a.get("asset_type_id") for a in scoped if a.get("asset_type_id")})
    dept_ids = sorted({
        U["type_by_id"].get(a.get("asset_type_id"), {}).get("department_id")
        for a in scoped
        if U["type_by_id"].get(a.get("asset_type_id"), {}).get("department_id")
    })
    return {
        "stations": [{"id": sid, "name": U["station_by_id"].get(sid, {}).get("name") or "—",
                      "code": U["station_by_id"].get(sid, {}).get("code") or ""}
                     for sid in station_ids],
        "departments": [{"id": did, "name": U["dept_by_id"].get(did, {}).get("name") or "—"}
                        for did in dept_ids],
        "asset_types": [{"id": tid, "name": U["type_by_id"].get(tid, {}).get("name") or "—",
                         "department_id": U["type_by_id"].get(tid, {}).get("department_id")}
                        for tid in asset_type_ids],
    }
