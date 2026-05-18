"""Sub-Zones — clusters of assets within a location.

Hierarchy: Station → Location → **Sub-Zone** → Asset.

Sub-zones also act as canvases for the Platform Blueprint view: each
sub-zone stores `has_divider` + `divider_orientation` so the blueprint
renderer knows to draw a visual dividing line across the canvas.
"""
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Query

from database import (
    now_ist, serialize_doc,
    sub_zones_collection, locations_collection, stations_collection,
    assets_collection,
)
from models import SubZoneCreate

router = APIRouter()


@router.post("/api/sub-zones")
async def create_sub_zone(sz: SubZoneCreate):
    loc = await locations_collection.find_one({"_id": ObjectId(sz.location_id)})
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    stn = await stations_collection.find_one({"_id": ObjectId(sz.station_id)})
    if not stn:
        raise HTTPException(status_code=404, detail="Station not found")
    if str(loc.get("station_id") or "") != sz.station_id:
        raise HTTPException(status_code=400, detail="Location does not belong to the given station")
    # Auto-assign `order` = count of existing sub-zones at this location so the
    # new one lands at the end with a unique, contiguous value (no more ties).
    next_order = await sub_zones_collection.count_documents({"location_id": sz.location_id})
    doc = {
        "name": sz.name.strip(),
        "code": (sz.code or "").strip() or None,
        "station_id": sz.station_id,
        "location_id": sz.location_id,
        "description": sz.description,
        "order": next_order,
        "has_divider": bool(sz.has_divider),
        "divider_orientation": sz.divider_orientation or "vertical",
        "start_pillar": (sz.start_pillar or "").strip() or None,
        "end_pillar": (sz.end_pillar or "").strip() or None,
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
    existing = await sub_zones_collection.find_one({"_id": ObjectId(sub_zone_id)})
    if not existing:
        raise HTTPException(status_code=404, detail="Sub-zone not found")
    update_fields = {
        "name": sz.name.strip(),
        "code": (sz.code or "").strip() or None,
        "station_id": sz.station_id,
        "location_id": sz.location_id,
        "description": sz.description,
        "has_divider": bool(sz.has_divider),
        "divider_orientation": sz.divider_orientation or "vertical",
        "start_pillar": (sz.start_pillar or "").strip() or None,
        "end_pillar": (sz.end_pillar or "").strip() or None,
    }
    # Only touch `order` if the client explicitly sent an integer ≥ 0; otherwise
    # preserve the existing value so accidental omissions don't reset the order
    # (and break the visual sequence).
    if sz.order is not None:
        update_fields["order"] = int(sz.order)
    result = await sub_zones_collection.update_one(
        {"_id": ObjectId(sub_zone_id)},
        {"$set": update_fields},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Sub-zone not found")
    doc = await sub_zones_collection.find_one({"_id": ObjectId(sub_zone_id)})
    return serialize_doc(doc)


@router.patch("/api/sub-zones/reorder")
async def reorder_sub_zones(payload: dict):
    """Bulk-renumber a list of sub-zones to contiguous 0..N-1 in the given order.

    Body: { location_id: str, ordered_ids: [sub_zone_id, ...] }

    All sub_zones must belong to the same location_id. Any sub-zones in that
    location not in `ordered_ids` are appended at the end in their current
    sort order, so partial reorder payloads are safe.

    Returns: { updated, ordered_ids: [final order] }
    """
    location_id = (payload.get("location_id") or "").strip()
    ordered_ids = payload.get("ordered_ids") or []
    if not location_id:
        raise HTTPException(status_code=400, detail="location_id is required")
    if not isinstance(ordered_ids, list) or not ordered_ids:
        raise HTTPException(status_code=400, detail="ordered_ids (non-empty list) is required")

    try:
        oids = [ObjectId(i) for i in ordered_ids]
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid sub_zone_id format")

    # Verify all belong to the same location
    docs = await sub_zones_collection.find(
        {"_id": {"$in": oids}, "location_id": location_id},
    ).to_list(len(oids))
    if len(docs) != len(set(ordered_ids)):
        raise HTTPException(
            status_code=400,
            detail="One or more sub-zones do not belong to the given location",
        )

    # Pull any "other" sub-zones in the same location not included in the payload
    others = await sub_zones_collection.find(
        {"location_id": location_id, "_id": {"$nin": oids}},
    ).sort([("order", 1), ("name", 1)]).to_list(2000)

    final_order = list(dict.fromkeys(ordered_ids)) + [str(o["_id"]) for o in others]

    updated = 0
    for idx, sz_id in enumerate(final_order):
        res = await sub_zones_collection.update_one(
            {"_id": ObjectId(sz_id)},
            {"$set": {"order": idx}},
        )
        updated += res.modified_count
    return {"updated": updated, "ordered_ids": final_order}


@router.delete("/api/sub-zones/{sub_zone_id}")
async def delete_sub_zone(sub_zone_id: str, force: bool = Query(False)):
    """Delete a sub-zone.

    If `force=false` (default) and assets are still assigned, returns 400 with
    the count so the frontend can prompt the user.

    If `force=true`, unassigns all assets (clears sub_zone_id + canvas_x/y) and
    then deletes the sub-zone. Does NOT delete the assets themselves.
    """
    in_use = await assets_collection.count_documents({"sub_zone_id": sub_zone_id})
    if in_use > 0 and not force:
        raise HTTPException(
            status_code=400,
            detail=f"ASSETS_ASSIGNED:{in_use}",
        )
    unassigned = 0
    if in_use > 0 and force:
        res = await assets_collection.update_many(
            {"sub_zone_id": sub_zone_id},
            {"$set": {"sub_zone_id": None, "canvas_x": None, "canvas_y": None}},
        )
        unassigned = res.modified_count
    # Also delete any canvas landmarks belonging to this sub-zone
    from database import canvas_landmarks_collection
    await canvas_landmarks_collection.delete_many({"sub_zone_id": sub_zone_id})

    result = await sub_zones_collection.delete_one({"_id": ObjectId(sub_zone_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Sub-zone not found")
    return {"message": "Sub-zone deleted", "unassigned_assets": unassigned}
