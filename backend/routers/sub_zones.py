"""Sub-Zones — clusters of identical grouped assets within a location.

Hierarchy: Station → Location → **Sub-Zone** → (grouped) Asset.

Example: "Platform 1 → Sub-Zone A" can host a single grouped asset of
120 fans tracked together. Inspections record counts (needs_repair,
not_working) instead of per-unit status.
"""
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException

from database import (
    now_ist, serialize_doc,
    sub_zones_collection, locations_collection, stations_collection,
    assets_collection,
)
from models import SubZoneCreate

router = APIRouter()


@router.post("/api/sub-zones")
async def create_sub_zone(sz: SubZoneCreate):
    # Validate FKs
    loc = await locations_collection.find_one({"_id": ObjectId(sz.location_id)})
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    stn = await stations_collection.find_one({"_id": ObjectId(sz.station_id)})
    if not stn:
        raise HTTPException(status_code=404, detail="Station not found")
    # Sanity: location must belong to station
    if str(loc.get("station_id") or "") != sz.station_id:
        raise HTTPException(status_code=400, detail="Location does not belong to the given station")
    doc = {
        "name": sz.name.strip(),
        "code": (sz.code or "").strip() or None,
        "station_id": sz.station_id,
        "location_id": sz.location_id,
        "description": sz.description,
        "order": int(sz.order or 0),
        "created_at": now_ist(),
    }
    result = await sub_zones_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@router.get("/api/sub-zones")
async def list_sub_zones(location_id: Optional[str] = None, station_id: Optional[str] = None):
    query = {}
    if location_id:
        query["location_id"] = location_id
    if station_id:
        query["station_id"] = station_id
    docs = await sub_zones_collection.find(query).sort([("order", 1), ("name", 1)]).to_list(2000)
    # Enrich with location & station name for client convenience
    loc_ids = list({d.get("location_id") for d in docs if d.get("location_id")})
    stn_ids = list({d.get("station_id") for d in docs if d.get("station_id")})
    loc_map, stn_map = {}, {}
    if loc_ids:
        loc_docs = await locations_collection.find(
            {"_id": {"$in": [ObjectId(i) for i in loc_ids]}}
        ).to_list(2000)
        loc_map = {str(loc["_id"]): loc.get("name") for loc in loc_docs}
    if stn_ids:
        stn_docs = await stations_collection.find(
            {"_id": {"$in": [ObjectId(i) for i in stn_ids]}}
        ).to_list(2000)
        stn_map = {str(s["_id"]): s.get("name") for s in stn_docs}
    for d in docs:
        d["location_name"] = loc_map.get(d.get("location_id"), "—")
        d["station_name"] = stn_map.get(d.get("station_id"), "—")
    return [serialize_doc(d) for d in docs]


@router.put("/api/sub-zones/{sub_zone_id}")
async def update_sub_zone(sub_zone_id: str, sz: SubZoneCreate):
    result = await sub_zones_collection.update_one(
        {"_id": ObjectId(sub_zone_id)},
        {"$set": {
            "name": sz.name.strip(),
            "code": (sz.code or "").strip() or None,
            "station_id": sz.station_id,
            "location_id": sz.location_id,
            "description": sz.description,
            "order": int(sz.order or 0),
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Sub-zone not found")
    doc = await sub_zones_collection.find_one({"_id": ObjectId(sub_zone_id)})
    return serialize_doc(doc)


@router.delete("/api/sub-zones/{sub_zone_id}")
async def delete_sub_zone(sub_zone_id: str):
    # Refuse if any asset still references this sub-zone
    in_use = await assets_collection.count_documents({"sub_zone_id": sub_zone_id})
    if in_use > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete — {in_use} asset(s) still belong to this sub-zone",
        )
    result = await sub_zones_collection.delete_one({"_id": ObjectId(sub_zone_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Sub-zone not found")
    return {"message": "Sub-zone deleted"}
