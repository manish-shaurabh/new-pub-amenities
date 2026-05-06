from datetime import datetime, timedelta
from typing import List, Optional
from bson import ObjectId

from database import (
    serialize_doc,
    asset_types_collection, orange_list_collection,
)
from models import ScheduleFrequency

RED_THRESHOLD_HOURS = 24

def _normalize_freq_days(value):
    """Convert legacy string frequency (daily/weekly/monthly/quarterly) to integer days.
    Returns int (days) or None. Numeric values pass through."""
    if value is None or value == "":
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        mapping = {"daily": 1, "weekly": 7, "monthly": 30, "quarterly": 90}
        if value in mapping:
            return mapping[value]
        try:
            return int(value)
        except (ValueError, TypeError):
            return None
    return None

def calculate_next_due(from_date: datetime, frequency: ScheduleFrequency) -> datetime:
    if frequency == ScheduleFrequency.DAILY:
        return from_date + timedelta(days=1)
    elif frequency == ScheduleFrequency.WEEKLY:
        return from_date + timedelta(weeks=1)
    elif frequency == ScheduleFrequency.MONTHLY:
        return from_date + timedelta(days=30)
    elif frequency == ScheduleFrequency.QUARTERLY:
        return from_date + timedelta(days=90)
    return from_date + timedelta(days=30)

def _compute_asset_metrics(asset: dict, orange_records: list, now: datetime) -> dict:
    """Compute average repair time and % uptime for a single asset using
    its orange-list history."""
    created_at = asset.get("created_at") or now
    if isinstance(created_at, str):
        try:
            created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00").replace("+00:00", ""))
        except Exception:
            created_at = now

    total_seconds = max(1, int((now - created_at).total_seconds()))
    repair_durations = []
    total_defective = 0

    for rec in orange_records:
        ds = rec.get("defective_since")
        if not ds:
            continue
        if isinstance(ds, str):
            try:
                ds = datetime.fromisoformat(ds.replace("Z", "+00:00").replace("+00:00", ""))
            except Exception:
                continue
        # End of defect window: approved_at > marked_working_at > now
        end = rec.get("approved_at") or rec.get("marked_working_at")
        if isinstance(end, str):
            try:
                end = datetime.fromisoformat(end.replace("Z", "+00:00").replace("+00:00", ""))
            except Exception:
                end = None
        if end and end >= ds:
            dur = int((end - ds).total_seconds())
            repair_durations.append(dur)
            total_defective += dur
        else:
            # Still ongoing
            ongoing = max(0, int((now - ds).total_seconds()))
            total_defective += ongoing

    avg_repair_seconds = int(sum(repair_durations) / len(repair_durations)) if repair_durations else 0
    pct_functional = max(0.0, min(100.0, (1 - total_defective / total_seconds) * 100))
    return {
        "avg_repair_seconds": avg_repair_seconds,
        "avg_repair_hours": round(avg_repair_seconds / 3600, 2),
        "pct_functional": round(pct_functional, 2),
        "defect_count": len(orange_records),
        "current_status": asset.get("status", "working"),
    }

async def _analytics_for_asset_set(asset_docs: list) -> list:
    """Build per-category analytics with nested per-asset metrics for a set of assets."""
    if not asset_docs:
        return []
    now = datetime.utcnow()

    asset_ids = [str(a["_id"]) for a in asset_docs]
    type_ids = list({a.get("asset_type_id") for a in asset_docs if a.get("asset_type_id")})

    # Fetch orange list history for these assets in one query
    history = await orange_list_collection.find({"asset_id": {"$in": asset_ids}}).to_list(10000)
    history_by_asset: dict = {}
    for rec in history:
        history_by_asset.setdefault(rec["asset_id"], []).append(rec)

    types_map = {}
    if type_ids:
        td = await asset_types_collection.find({"_id": {"$in": [ObjectId(t) for t in type_ids]}}).to_list(1000)
        types_map = {str(t["_id"]): t["name"] for t in td}

    # Compute per-asset metrics, group by type
    grouped: dict = {}
    for asset in asset_docs:
        aid = str(asset["_id"])
        type_id = asset.get("asset_type_id") or "unknown"
        type_name = types_map.get(type_id, "Unknown")
        m = _compute_asset_metrics(asset, history_by_asset.get(aid, []), now)
        m.update({
            "asset_id": aid,
            "asset_number": asset.get("asset_number"),
        })
        grouped.setdefault(type_id, {"asset_type_id": type_id, "asset_type_name": type_name, "assets": []})
        grouped[type_id]["assets"].append(m)

    # Aggregate per-category
    result = []
    for type_id, info in grouped.items():
        assets = info["assets"]
        avg_repairs = [a["avg_repair_seconds"] for a in assets if a["avg_repair_seconds"] > 0]
        avg_repair_seconds = int(sum(avg_repairs) / len(avg_repairs)) if avg_repairs else 0
        pct_functionals = [a["pct_functional"] for a in assets]
        avg_pct_functional = round(sum(pct_functionals) / len(pct_functionals), 2) if pct_functionals else 100.0
        defective_count = sum(1 for a in assets if a["current_status"] != "working")
        result.append({
            "asset_type_id": type_id,
            "asset_type_name": info["asset_type_name"],
            "asset_count": len(assets),
            "defective_count": defective_count,
            "working_count": len(assets) - defective_count,
            "avg_repair_seconds": avg_repair_seconds,
            "avg_repair_hours": round(avg_repair_seconds / 3600, 2),
            "pct_functional": avg_pct_functional,
            "assets": assets,
        })

    result.sort(key=lambda r: r["asset_type_name"])
    return result

def _classify_health(asset: dict, now: datetime) -> str:
    """Return 'working', 'orange', or 'red' based on defective duration."""
    if asset.get("status") == "working":
        return "working"
    ds = asset.get("defective_since")
    if not ds:
        return "orange"
    if isinstance(ds, str):
        try:
            ds = datetime.fromisoformat(ds.replace("Z", "+00:00").replace("+00:00", ""))
        except Exception:
            return "orange"
    hours = (now - ds).total_seconds() / 3600
    return "red" if hours > RED_THRESHOLD_HOURS else "orange"

