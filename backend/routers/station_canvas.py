"""Station Canvas — aggregated asset-position data for the Platform Blueprint view.

GET /api/station-canvas?location_id=<id>   — single location
GET /api/station-canvas?station_id=<id>    — all locations at a station (overview)

Returns sub-zones with positioned assets (canvas_x, canvas_y), their current
health status derived from orange_list, plus landmark markers (P.No etc.).

Used by:
  - StationCanvasPage (read-only health view)
  - InspectionPage in Blueprint / Map mode
"""
from typing import Optional
from bson import ObjectId
from fastapi import APIRouter, HTTPException

from database import (
    now_ist, serialize_doc,
    assets_collection, asset_types_collection,
    locations_collection, stations_collection,
    sub_zones_collection, orange_list_collection,
    canvas_landmarks_collection,
)

router = APIRouter()

# ── Icon-hint keyword mapping ─────────────────────────────────────────────────
_ICON_HINTS = [
    (["fan", "blower", "exhaust", "ventilat"], "fan"),
    (["light", "lamp", "led", "bulb", "tube", "fluores", "cfl"], "light"),
    (["tap", "water", "fountain", "wash", "toilet", "bathroom", "wc"], "tap"),
    (["cib", "ceb", "circuit", "board", "panel", "mcb", "breaker", "fuse"], "cib"),
    (["wifi", " ap ", "router", "network", "internet", "hotspot"], "wifi"),
    (["sit", "bench", "seat", "chair", "waiting"], "seat"),
    (["fire", "extinguish", "alarm", "smoke", "sprinkler"], "fire"),
    (["cctv", "camera", "surveil"], "camera"),
    (["clock", "watch", "time display"], "clock"),
    (["ac ", "air condition", "hvac", "cooler", "air-con"], "ac"),
]


def _icon_hint(name: str) -> str:
    n = (" " + (name or "").lower() + " ")
    for keywords, hint in _ICON_HINTS:
        if any(kw in n for kw in keywords):
            return hint
    return "default"


@router.get("/api/station-canvas")
async def get_station_canvas(
    location_id: Optional[str] = None,
    station_id: Optional[str] = None,
    dept_id: Optional[str] = None,
):
    """Aggregated canvas data: sub-zones + assets + landmarks for a location."""
    if not location_id and not station_id:
        raise HTTPException(status_code=400, detail="location_id or station_id is required")

    # --- fetch locations ---
    if location_id:
        loc_docs = [await locations_collection.find_one({"_id": ObjectId(location_id)})]
        if not loc_docs[0]:
            raise HTTPException(status_code=404, detail="Location not found")
    else:
        loc_docs = await locations_collection.find({"station_id": station_id}).sort("name", 1).to_list(200)

    # --- fetch all sub-zones for the scope ---
    sz_query = {}
    if location_id:
        sz_query["location_id"] = location_id
    else:
        sz_query["station_id"] = station_id
    all_sub_zones = await sub_zones_collection.find(sz_query).sort([("order", 1), ("name", 1)]).to_list(2000)

    # --- fetch assets ---
    asset_query = {}
    if location_id:
        asset_query["location_id"] = location_id
    else:
        asset_query["station_id"] = station_id
    all_assets = await assets_collection.find(asset_query).to_list(10000)

    # --- asset type info ---
    type_ids = list({a.get("asset_type_id") for a in all_assets if a.get("asset_type_id")})
    types_map, types_dept_map, types_icon_map = {}, {}, {}
    if type_ids:
        type_docs = await asset_types_collection.find(
            {"_id": {"$in": [ObjectId(tid) for tid in type_ids]}}
        ).to_list(1000)
        types_map = {str(t["_id"]): t.get("name", "Unknown") for t in type_docs}
        types_dept_map = {str(t["_id"]): t.get("department_id") for t in type_docs}
        # icon_key: use explicit admin assignment if set, else auto-detect from name
        types_icon_map = {
            str(t["_id"]): t.get("icon_key") or _icon_hint(t.get("name", ""))
            for t in type_docs
        }

    # --- dept filter ---
    if dept_id:
        all_assets = [a for a in all_assets if types_dept_map.get(a.get("asset_type_id")) == dept_id]

    # --- open OL entries for health status ---
    asset_ids_str = [str(a["_id"]) for a in all_assets]
    open_ols = {}
    if asset_ids_str:
        ol_docs = await orange_list_collection.find({
            "asset_id": {"$in": asset_ids_str},
            "status": {"$in": ["defective", "pending_approval"]},
        }).to_list(10000)
        now = now_ist()
        for ol in ol_docs:
            aid = ol.get("asset_id")
            if aid not in open_ols:
                ds = ol.get("defective_since")
                hours = 0.0
                if ds and hasattr(ds, "replace"):
                    try:
                        hours = (now - ds).total_seconds() / 3600
                    except Exception:
                        pass
                open_ols[aid] = {
                    "list_type": "red" if hours >= 24 else "orange",
                    "hours_defective": round(hours, 1),
                }

    # --- build asset map per sub_zone_id and per location_id ---
    # key: sub_zone_id or None; sub-key: location_id
    sz_asset_map = {}   # {sub_zone_id: [asset_data]}
    loc_unzoned_map = {}  # {location_id: [asset_data]}  (assets with no sub_zone)

    for a in all_assets:
        type_name = types_map.get(a.get("asset_type_id", ""), "Unknown")
        ol_info = open_ols.get(str(a["_id"]), {})
        asset_data = {
            "id": str(a["_id"]),
            "asset_number": a.get("asset_number", ""),
            "asset_type_id": a.get("asset_type_id", ""),
            "asset_type_name": type_name,
            "asset_type_icon_hint": types_icon_map.get(a.get("asset_type_id", ""), "default"),
            "department_id": types_dept_map.get(a.get("asset_type_id", "")),
            "location_id": a.get("location_id"),
            "sub_zone_id": a.get("sub_zone_id"),
            "canvas_x": a.get("canvas_x"),
            "canvas_y": a.get("canvas_y"),
            "status": a.get("status", "working"),
            "list_type": ol_info.get("list_type"),
            "hours_defective": ol_info.get("hours_defective"),
            "tracking_mode": a.get("tracking_mode", "individual"),
            "total_count": a.get("total_count"),
            "needs_repair_count": a.get("needs_repair_count", 0),
            "not_working_count": a.get("not_working_count", 0),
            "description": a.get("description", ""),
        }
        sz_id = a.get("sub_zone_id")
        if sz_id:
            sz_asset_map.setdefault(sz_id, []).append(asset_data)
        else:
            loc_id = a.get("location_id", "")
            loc_unzoned_map.setdefault(loc_id, []).append(asset_data)

    # --- landmarks ---
    lm_query = {}
    if location_id:
        lm_query["location_id"] = location_id
    else:
        lm_query["station_id"] = station_id
    all_landmarks = await canvas_landmarks_collection.find(lm_query).to_list(2000)
    lm_map = {}  # {sub_zone_id: [landmark_data]}
    for lm in all_landmarks:
        sz_id = lm.get("sub_zone_id")
        lm_data = {
            "id": str(lm["_id"]),
            "label": lm.get("label", ""),
            "x": lm.get("x", 0),
            "y": lm.get("y", 0),
            "landmark_type": lm.get("landmark_type", "pole"),
        }
        if sz_id:
            lm_map.setdefault(sz_id, []).append(lm_data)

    # --- group sub-zones by location ---
    sz_by_loc = {}  # {location_id: [sz_doc]}
    for sz in all_sub_zones:
        sz_by_loc.setdefault(sz.get("location_id"), []).append(sz)

    # --- assemble per-location result ---
    locations_result = []
    for loc in loc_docs:
        if not loc:
            continue
        loc_id = str(loc["_id"])
        loc_sub_zones = sz_by_loc.get(loc_id, [])
        sz_result = []
        for sz in loc_sub_zones:
            sz_id = str(sz["_id"])
            sz_result.append({
                "id": sz_id,
                "name": sz.get("name", ""),
                "code": sz.get("code", ""),
                "order": sz.get("order", 0),
                "description": sz.get("description", ""),
                "has_divider": sz.get("has_divider", False),
                "divider_orientation": sz.get("divider_orientation", "vertical"),
                "assets": sz_asset_map.get(sz_id, []),
                "landmarks": lm_map.get(sz_id, []),
            })
        locations_result.append({
            "id": loc_id,
            "name": loc.get("name", ""),
            "station_id": loc.get("station_id", ""),
            "sub_zones": sz_result,
            "unzoned_assets": loc_unzoned_map.get(loc_id, []),
        })

    return {"locations": locations_result}
