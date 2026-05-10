"""
Comparative Reports — asset-stats drilldown + 3 lenses + grouped bar chart.

  GET /api/orange-list/{asset_id}/asset-stats?window_days=90
       Part A — per-asset stats for OL drilldown
  GET /api/reports/comparative/by-asset-type/{user_id}?station_ids=&window_days=
       Lens 1 — MTTR by asset-type at user's station(s)
  GET /api/reports/comparative/by-supervisor/{user_id}?dept_id=&asset_type_id=&window_days=
       Lens 2 — supervisor comparison within dept × asset-type (anonymised for SUP)
  GET /api/reports/comparative/grouped/{user_id}?level=&parent_id=&asset_type_ids=&window_days=&stat=
       Lens 3 — grouped bar chart, drillable Station → Location → Asset
"""
import statistics
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Query

from database import (
    users_collection, assets_collection, asset_types_collection,
    stations_collection, locations_collection,
    orange_list_collection, now_ist,
)

router = APIRouter()

# Color palette for asset-type bars (deterministic by id index)
PALETTE = ["#0e7c6b", "#0891b2", "#7c3aed", "#dc2626", "#f59e0b",
           "#10b981", "#3b82f6", "#ec4899", "#84cc16", "#f97316",
           "#06b6d4", "#a855f7"]


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


def _window_from_days(window_days: str):
    """Accept int days, 'fy', or 'all'. Returns (from_dt, to_dt)."""
    now = now_ist()
    if str(window_days).lower() == "all":
        return None, now
    if str(window_days).lower() == "fy":
        start = datetime(now.year if now.month >= 4 else now.year - 1, 4, 1)
        return start, now
    try:
        d = int(window_days)
        return now - timedelta(days=d), now
    except Exception:
        return now - timedelta(days=90), now


def _percentile(arr, p):
    if not arr: return None
    arr = sorted(arr)
    k = (len(arr) - 1) * p
    f = int(k); c = min(f + 1, len(arr) - 1)
    if f == c: return arr[f]
    return arr[f] + (arr[c] - arr[f]) * (k - f)


def _hrs_stats(hours: List[float]):
    """Compute summary stats for a list of repair-hour values."""
    n = len(hours)
    if n == 0:
        return {"n": 0, "median": None, "mean": None, "min": None,
                "max": None, "p75": None, "p90": None}
    return {
        "n": n,
        "median": round(_percentile(hours, 0.5), 1),
        "mean": round(sum(hours) / n, 1),
        "min": round(min(hours), 1),
        "max": round(max(hours), 1),
        "p75": round(_percentile(hours, 0.75), 1),
        "p90": round(_percentile(hours, 0.9), 1),
    }


def _resolved_repair_hours(ols, asset_id_or_set, win):
    """For a list of OLs and a single asset_id (or set of ids) and window,
    return list of resolved repair-hour values whose marked_working_at falls in window."""
    f_dt, t_dt = win
    out = []
    sset = {asset_id_or_set} if isinstance(asset_id_or_set, str) else asset_id_or_set
    for ol in ols:
        if ol.get("status") != "resolved": continue
        if ol.get("asset_id") not in sset: continue
        ds = _parse_dt(ol.get("defective_since"))
        mw = _parse_dt(ol.get("marked_working_at"))
        if not ds or not mw: continue
        if f_dt and mw < f_dt: continue
        if t_dt and mw > t_dt: continue
        hrs = (mw - ds).total_seconds() / 3600
        if hrs < 0: continue
        out.append(hrs)
    return out


# ════════════════════════════════════════════════════════════════════════════
# Part A — Per-asset stats for Orange/Red list drilldown
# ════════════════════════════════════════════════════════════════════════════
@router.get("/api/orange-list/{asset_id}/asset-stats")
async def asset_stats(asset_id: str, window_days: str = Query("90")):
    try:
        asset = await assets_collection.find_one({"_id": ObjectId(asset_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid asset_id")
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    f_dt, t_dt = _window_from_days(window_days)
    win = (f_dt, t_dt)
    asset_id_str = str(asset["_id"])
    all_ols = await orange_list_collection.find(
        {"asset_id": asset_id_str}).to_list(2000)

    # In-window resolved repairs
    hours = _resolved_repair_hours(all_ols, asset_id_str, win)
    stats = _hrs_stats(hours)
    times_defective = sum(
        1 for ol in all_ols
        if (_parse_dt(ol.get("defective_since")) or datetime.min) >= (f_dt or datetime.min)
        and (_parse_dt(ol.get("defective_since")) or datetime.max) <= t_dt
    )

    # Functional period % — clamp each defective interval to the window
    win_start = f_dt or min(
        ([_parse_dt(ol.get("defective_since")) for ol in all_ols if _parse_dt(ol.get("defective_since"))] or [now_ist()]))
    total_secs = (t_dt - win_start).total_seconds() if win_start else 0
    defective_secs = 0
    for ol in all_ols:
        ds = _parse_dt(ol.get("defective_since"))
        if not ds: continue
        end = _parse_dt(ol.get("marked_working_at")) or _parse_dt(ol.get("approved_at")) or t_dt
        # Clamp to window
        a = max(ds, win_start) if win_start else ds
        b = min(end, t_dt)
        if b > a:
            defective_secs += (b - a).total_seconds()
    functional_pct = round(max(0, (1 - defective_secs / total_secs)) * 100, 1) if total_secs > 0 else None

    # Trend: compare median to prior window
    prev_win = None
    if f_dt and isinstance(window_days, str) and window_days.isdigit():
        prev_to = f_dt
        prev_from = prev_to - (t_dt - f_dt)
        prev_hours = _resolved_repair_hours(all_ols, asset_id_str, (prev_from, prev_to))
        prev_med = _hrs_stats(prev_hours).get("median")
        if stats["median"] is not None and prev_med is not None and prev_med > 0:
            delta_pct = round((stats["median"] - prev_med) / prev_med * 100, 1)
            prev_win = {"median": prev_med, "delta_pct": delta_pct,
                        "n": len(prev_hours)}

    # Tentative ETA for currently-open defect (if any): falls back to dept-type median
    open_ol = next((ol for ol in all_ols if ol.get("status") != "resolved"), None)
    eta_hrs = None
    eta_source = None
    if open_ol:
        ds = _parse_dt(open_ol.get("defective_since"))
        elapsed = round((now_ist() - ds).total_seconds() / 3600, 1) if ds else None
        if stats["median"] is not None and stats["n"] >= 3:
            eta_hrs = stats["median"]; eta_source = "asset"
        else:
            # Fall back to asset-type median across same station
            type_id = asset.get("asset_type_id")
            station_id = asset.get("station_id")
            cohort = await assets_collection.find({
                "asset_type_id": type_id, "station_id": station_id
            }).to_list(2000)
            cohort_ids = {str(a["_id"]) for a in cohort}
            cohort_ols = await orange_list_collection.find(
                {"asset_id": {"$in": list(cohort_ids)}, "status": "resolved"}).to_list(20000)
            cohort_hours = _resolved_repair_hours(cohort_ols, cohort_ids, win)
            cohort_stats = _hrs_stats(cohort_hours)
            if cohort_stats["median"] is not None:
                eta_hrs = cohort_stats["median"]; eta_source = "asset_type@station"
        open_ol = {
            "id": str(open_ol["_id"]),
            "defective_since": str(open_ol.get("defective_since") or ""),
            "elapsed_hrs": elapsed,
            "list_type": (open_ol.get("list_type") or "").lower(),
        }

    type_doc = await asset_types_collection.find_one({"_id": ObjectId(asset["asset_type_id"])}) if asset.get("asset_type_id") else None
    station_doc = await stations_collection.find_one({"_id": ObjectId(asset["station_id"])}) if asset.get("station_id") else None
    location_doc = await locations_collection.find_one({"_id": ObjectId(asset["location_id"])}) if asset.get("location_id") else None

    return {
        "asset_id": asset_id_str,
        "asset_number": asset.get("asset_number"),
        "asset_type": (type_doc or {}).get("name"),
        "station": (station_doc or {}).get("name"),
        "location": (location_doc or {}).get("name"),
        "window_days": window_days,
        "window": {"from": f_dt.isoformat() if f_dt else None,
                   "to": t_dt.isoformat()},
        "times_defective": times_defective,
        "stats": stats,
        "functional_pct": functional_pct,
        "eta_hrs": eta_hrs,
        "eta_source": eta_source,
        "open_ol": open_ol,
        "trend": prev_win,
        "repair_history": [
            {"defective_since": str(ol.get("defective_since") or ""),
             "marked_working_at": str(ol.get("marked_working_at") or ""),
             "hours": round((_parse_dt(ol.get("marked_working_at")) - _parse_dt(ol.get("defective_since"))).total_seconds() / 3600, 1)
                if _parse_dt(ol.get("marked_working_at")) and _parse_dt(ol.get("defective_since")) else None,
             "list_type": (ol.get("list_type") or "").lower()}
            for ol in sorted(all_ols, key=lambda o: o.get("defective_since") or "", reverse=True)
            if ol.get("status") == "resolved"
        ][:50],
    }


# ════════════════════════════════════════════════════════════════════════════
# Part B — Comparative lenses (role-scoped)
# ════════════════════════════════════════════════════════════════════════════
async def _user_or_404(user_id: str):
    try:
        u = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return u


def _user_station_ids(user: dict) -> List[str]:
    role = user.get("role")
    if role in ("admin", "superadmin"):
        return []  # empty = all
    return list(user.get("assigned_stations") or [])


@router.get("/api/reports/comparative/by-asset-type/{user_id}")
async def by_asset_type(user_id: str,
                        station_ids: Optional[str] = Query(None),
                        dept_id: Optional[str] = Query(None),
                        window_days: str = Query("90"),
                        stat: str = Query("median")):
    """Lens 1 — MTTR by asset-type within user's station scope."""
    user = await _user_or_404(user_id)
    f_dt, t_dt = _window_from_days(window_days)
    win = (f_dt, t_dt)
    user_stns = _user_station_ids(user)
    explicit = [s for s in (station_ids.split(",") if station_ids else []) if s]
    scope = set(explicit) if explicit else set(user_stns)
    q = {}
    if scope: q["station_id"] = {"$in": list(scope)}
    assets = await assets_collection.find(q).to_list(20000)
    types = await asset_types_collection.find({}).to_list(2000)
    type_by_id = {str(t["_id"]): t for t in types}
    # Apply dept filter
    if dept_id:
        assets = [a for a in assets
                  if (type_by_id.get(a.get("asset_type_id")) or {}).get("department_id") == dept_id]
    asset_ids = {str(a["_id"]) for a in assets}
    by_type: Dict[str, set] = {}
    for a in assets:
        by_type.setdefault(a.get("asset_type_id"), set()).add(str(a["_id"]))
    if not by_type:
        return {"window_days": window_days, "rows": []}
    ols = await orange_list_collection.find(
        {"asset_id": {"$in": list(asset_ids)}, "status": "resolved"}).to_list(50000)
    rows = []
    for tid, ids in by_type.items():
        hours = _resolved_repair_hours(ols, ids, win)
        s = _hrs_stats(hours)
        rows.append({
            "asset_type_id": tid,
            "label": (type_by_id.get(tid) or {}).get("name", "—"),
            **s,
        })
    rows = [r for r in rows if r.get("n", 0) > 0]
    rows.sort(key=lambda r: -(r.get(stat) or 0))
    return {"window_days": window_days, "stat": stat, "rows": rows,
            "scope_station_ids": list(scope)}


@router.get("/api/reports/comparative/by-supervisor/{user_id}")
async def by_supervisor(user_id: str,
                        dept_id: Optional[str] = Query(None),
                        asset_type_id: Optional[str] = Query(None),
                        window_days: str = Query("90"),
                        stat: str = Query("median")):
    """Lens 2 — supervisor comparison within dept × asset-type. Anonymises peers for SUP role."""
    user = await _user_or_404(user_id)
    f_dt, t_dt = _window_from_days(window_days)
    win = (f_dt, t_dt)

    # Default dept/asset_type to user's
    dept_id = dept_id or user.get("department_id")
    if not asset_type_id:
        return {"error": "asset_type_id is required",
                "window_days": window_days, "rows": []}

    # Find sups in same dept
    sups = await users_collection.find(
        {"role": "supervisor", "department_id": dept_id, "is_active": True}).to_list(2000)
    if not sups:
        return {"window_days": window_days, "rows": []}

    # Asset pool: assets of given type at any of the sup's stations
    sup_stations: Dict[str, set] = {}
    all_stns = set()
    for s in sups:
        stns = set(s.get("assigned_stations") or [])
        sup_stations[str(s["_id"])] = stns
        all_stns |= stns

    asset_q = {"asset_type_id": asset_type_id}
    if all_stns: asset_q["station_id"] = {"$in": list(all_stns)}
    assets = await assets_collection.find(asset_q).to_list(20000)
    asset_by_station: Dict[str, set] = {}
    for a in assets:
        asset_by_station.setdefault(a.get("station_id"), set()).add(str(a["_id"]))

    # OL pool
    all_asset_ids = {aid for ids in asset_by_station.values() for aid in ids}
    ols = await orange_list_collection.find(
        {"asset_id": {"$in": list(all_asset_ids)}, "status": "resolved"}).to_list(50000)

    # For each sup, find OLs whose marked_working_by == sup OR asset is at their stations
    role = user.get("role")
    is_anonymous = role == "supervisor"  # SUP sees peers anonymised

    rows = []
    for i, sup in enumerate(sups):
        sid = str(sup["_id"])
        # Pull repairs marked by this sup (gives true credit)
        sup_repairs = [ol for ol in ols if ol.get("marked_working_by") == sid]
        hours = _resolved_repair_hours(sup_repairs,
                                       {str(ol["asset_id"]) for ol in sup_repairs}, win)
        s = _hrs_stats(hours)
        is_self = (sid == user_id)
        rows.append({
            "supervisor_id": sid if not is_anonymous or is_self else None,
            "label": sup.get("name") if (not is_anonymous or is_self) else f"Peer {i + 1}",
            "is_self": is_self,
            **s,
        })
    rows.sort(key=lambda r: ((r.get(stat) is None), -(r.get(stat) or 0)))
    return {"window_days": window_days, "stat": stat, "rows": rows,
            "dept_id": dept_id, "asset_type_id": asset_type_id,
            "anonymised": is_anonymous}


@router.get("/api/reports/comparative/grouped/{user_id}")
async def grouped_drilldown(user_id: str,
                            level: str = Query("station"),
                            parent_id: Optional[str] = Query(None),
                            asset_type_ids: Optional[str] = Query(None),
                            window_days: str = Query("90"),
                            stat: str = Query("median")):
    """Lens 3 — grouped bars drillable Station → Location → Asset.

    level=station        → groups = stations in scope, bars per asset-type
    level=location       → groups = locations within parent_id (station), bars per asset-type
    level=asset          → groups = single asset bars, color-coded by asset_type
    """
    user = await _user_or_404(user_id)
    f_dt, t_dt = _window_from_days(window_days)
    win = (f_dt, t_dt)
    user_stns = set(_user_station_ids(user))

    # ── Determine selected asset types ──
    types = await asset_types_collection.find({}).to_list(2000)
    type_by_id = {str(t["_id"]): t for t in types}
    explicit_types = [t for t in (asset_type_ids.split(",") if asset_type_ids else []) if t]
    if not explicit_types:
        # Default = top-5 by event count globally in window
        all_ols = await orange_list_collection.find(
            {"status": "resolved"}).to_list(50000)
        all_assets = await assets_collection.find({}).to_list(20000)
        type_of_asset = {str(a["_id"]): a.get("asset_type_id") for a in all_assets}
        type_counts: Dict[str, int] = {}
        for ol in all_ols:
            mw = _parse_dt(ol.get("marked_working_at"))
            if not mw or not f_dt: continue
            if f_dt and mw < f_dt: continue
            if t_dt and mw > t_dt: continue
            tid = type_of_asset.get(ol.get("asset_id"))
            if tid: type_counts[tid] = type_counts.get(tid, 0) + 1
        explicit_types = [t for t, _ in sorted(type_counts.items(), key=lambda kv: -kv[1])[:5]]
    type_palette = {tid: PALETTE[i % len(PALETTE)] for i, tid in enumerate(explicit_types)}
    type_meta = [{"id": tid, "name": (type_by_id.get(tid) or {}).get("name", "—"),
                  "color": type_palette[tid]} for tid in explicit_types]

    # ── Asset scope ──
    asset_q: Dict[str, Any] = {"asset_type_id": {"$in": explicit_types}}
    breadcrumbs = [{"level": "root", "label": "All Stations"}]
    if level == "location":
        if not parent_id:
            raise HTTPException(status_code=400, detail="parent_id required for level=location")
        asset_q["station_id"] = parent_id
        sdoc = await stations_collection.find_one({"_id": ObjectId(parent_id)})
        breadcrumbs.append({"level": "station", "id": parent_id,
                            "label": (sdoc or {}).get("name", "—")})
    elif level == "asset":
        if not parent_id:
            raise HTTPException(status_code=400, detail="parent_id required for level=asset")
        asset_q["location_id"] = parent_id
        ldoc = await locations_collection.find_one({"_id": ObjectId(parent_id)})
        if ldoc:
            sdoc = await stations_collection.find_one({"_id": ObjectId(ldoc.get("station_id"))})
            breadcrumbs.append({"level": "station", "id": ldoc.get("station_id"),
                                "label": (sdoc or {}).get("name", "—")})
            breadcrumbs.append({"level": "location", "id": parent_id,
                                "label": ldoc.get("name", "—")})
    else:  # station
        if user_stns:
            asset_q["station_id"] = {"$in": list(user_stns)}

    assets = await assets_collection.find(asset_q).to_list(20000)
    asset_ids = [str(a["_id"]) for a in assets]
    asset_by_id = {str(a["_id"]): a for a in assets}
    if not assets:
        return {"level": level, "parent_id": parent_id,
                "window_days": window_days, "stat": stat,
                "asset_types": type_meta, "groups": [], "breadcrumbs": breadcrumbs}

    ols = await orange_list_collection.find(
        {"asset_id": {"$in": asset_ids}, "status": "resolved"}).to_list(50000)

    # ── Build groups ──
    if level == "asset":
        # Each asset = its own group with one bar
        groups = []
        for a in assets:
            aid = str(a["_id"])
            hours = _resolved_repair_hours(ols, aid, win)
            s = _hrs_stats(hours)
            tid = a.get("asset_type_id")
            groups.append({
                "id": aid, "label": a.get("asset_number") or "—",
                "drillable": False,
                "bars": [{"asset_type_id": tid,
                          "asset_type": (type_by_id.get(tid) or {}).get("name", "—"),
                          "color": type_palette.get(tid, "#94a3b8"),
                          **s}],
                "_sort_value": s.get(stat) or 0,
            })
        groups.sort(key=lambda g: -g["_sort_value"])
        for g in groups: g.pop("_sort_value", None)
        return {"level": "asset", "parent_id": parent_id,
                "window_days": window_days, "stat": stat,
                "asset_types": type_meta, "groups": groups,
                "breadcrumbs": breadcrumbs}

    # station / location levels: bucket assets by group_key
    group_key_field = "station_id" if level == "station" else "location_id"
    groups_idx: Dict[str, List[str]] = {}
    for a in assets:
        gk = a.get(group_key_field)
        if gk: groups_idx.setdefault(gk, []).append(str(a["_id"]))

    out = []
    for gk, ids in groups_idx.items():
        bars = []
        # Group assets in this group by asset_type, restricted to selected types
        ids_by_type: Dict[str, set] = {}
        for aid in ids:
            tid = asset_by_id[aid].get("asset_type_id")
            if tid in type_palette:
                ids_by_type.setdefault(tid, set()).add(aid)
        for tid in explicit_types:  # iterate in selected order so cluster ordering is stable
            type_asset_ids = ids_by_type.get(tid, set())
            hours = _resolved_repair_hours(ols, type_asset_ids, win)
            s = _hrs_stats(hours)
            bars.append({"asset_type_id": tid,
                         "asset_type": (type_by_id.get(tid) or {}).get("name", "—"),
                         "color": type_palette[tid],
                         **s})
        # Cluster's sort value = max bar value (worst-first)
        sort_value = max([(b.get(stat) or 0) for b in bars] or [0])
        # Group label
        if level == "station":
            sd = await stations_collection.find_one({"_id": ObjectId(gk)})
            label = (sd or {}).get("name", "—")
        else:
            ld = await locations_collection.find_one({"_id": ObjectId(gk)})
            label = (ld or {}).get("name", "—")
        out.append({"id": gk, "label": label, "drillable": True,
                    "bars": bars, "_sort_value": sort_value})

    out.sort(key=lambda g: -g["_sort_value"])
    for g in out: g.pop("_sort_value", None)
    return {"level": level, "parent_id": parent_id,
            "window_days": window_days, "stat": stat,
            "asset_types": type_meta, "groups": out,
            "breadcrumbs": breadcrumbs}
