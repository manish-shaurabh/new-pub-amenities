"""Zones and Divisions management.

Hierarchy: Zone → Division → Station → Location → Asset

Only SuperAdmin can create/edit/delete zones and divisions.
Divisional Admins can read their own division.

Endpoints:
  GET  /api/zones
  POST /api/zones
  PUT  /api/zones/{id}
  DELETE /api/zones/{id}

  GET  /api/divisions
  POST /api/divisions
  PUT  /api/divisions/{id}
  DELETE /api/divisions/{id}

  GET  /api/divisions/{id}/stations   — stations belonging to a division
  POST /api/divisions/{id}/assign-stations  — bulk-assign stations to a division
"""
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Query
from pymongo.errors import DuplicateKeyError

from database import (
    zones_collection, divisions_collection, stations_collection,
    users_collection, serialize_doc, now_ist,
)
from models import ZoneCreate, DivisionCreate

router = APIRouter()


# ────────────────────────────────────────────────────────────────
# Auth helper
# ────────────────────────────────────────────────────────────────
async def _require_superadmin(current_user_id: Optional[str]):
    if not current_user_id:
        raise HTTPException(status_code=403, detail="SuperAdmin required")
    try:
        u = await users_collection.find_one({"_id": ObjectId(current_user_id)})
    except Exception:
        u = None
    if not u or u.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="SuperAdmin required")


# ────────────────────────────────────────────────────────────────
# ZONES
# ────────────────────────────────────────────────────────────────

@router.get("/api/zones")
async def list_zones():
    docs = await zones_collection.find().sort("name", 1).to_list(1000)
    return [serialize_doc(d) for d in docs]


@router.post("/api/zones")
async def create_zone(zone: ZoneCreate, current_user_id: Optional[str] = Query(None)):
    await _require_superadmin(current_user_id)
    code = zone.code.strip().upper()
    existing = await zones_collection.find_one({"$or": [
        {"name": {"$regex": f"^{zone.name.strip()}$", "$options": "i"}},
        {"code": code},
    ]})
    if existing:
        raise HTTPException(status_code=409, detail="Zone with this name or code already exists")
    doc = {"name": zone.name.strip(), "code": code, "created_at": now_ist()}
    result = await zones_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@router.put("/api/zones/{zone_id}")
async def update_zone(zone_id: str, zone: ZoneCreate, current_user_id: Optional[str] = Query(None)):
    await _require_superadmin(current_user_id)
    code = zone.code.strip().upper()
    collision = await zones_collection.find_one({
        "_id": {"$ne": ObjectId(zone_id)},
        "$or": [
            {"name": {"$regex": f"^{zone.name.strip()}$", "$options": "i"}},
            {"code": code},
        ],
    })
    if collision:
        raise HTTPException(status_code=409, detail="Another zone with this name or code exists")
    result = await zones_collection.update_one(
        {"_id": ObjectId(zone_id)},
        {"$set": {"name": zone.name.strip(), "code": code}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Zone not found")
    doc = await zones_collection.find_one({"_id": ObjectId(zone_id)})
    return serialize_doc(doc)


@router.delete("/api/zones/{zone_id}")
async def delete_zone(zone_id: str, current_user_id: Optional[str] = Query(None)):
    await _require_superadmin(current_user_id)
    in_use = await divisions_collection.count_documents({"zone_id": zone_id})
    if in_use > 0:
        raise HTTPException(status_code=409,
                            detail=f"Cannot delete: {in_use} division(s) still reference this zone")
    result = await zones_collection.delete_one({"_id": ObjectId(zone_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Zone not found")
    return {"message": "Zone deleted"}


# ────────────────────────────────────────────────────────────────
# DIVISIONS
# ────────────────────────────────────────────────────────────────

@router.get("/api/divisions")
async def list_divisions():
    docs = await divisions_collection.find().sort("name", 1).to_list(1000)
    zone_ids = list({d.get("zone_id") for d in docs if d.get("zone_id")})
    zone_map = {}
    if zone_ids:
        zone_docs = await zones_collection.find({"_id": {"$in": [ObjectId(z) for z in zone_ids]}}).to_list(1000)
        zone_map = {str(z["_id"]): z.get("name", "—") for z in zone_docs}
    # count stations per division and collect assigned_stations ids
    all_stations = await stations_collection.find({}, {"_id": 1, "division_id": 1}).to_list(10000)
    station_counts: dict = {}
    assigned_stations_map: dict = {}
    for s in all_stations:
        div_id = s.get("division_id")
        if div_id:
            station_counts[div_id] = station_counts.get(div_id, 0) + 1
            assigned_stations_map.setdefault(div_id, []).append(str(s["_id"]))

    result = []
    for d in docs:
        sd = serialize_doc(d)
        div_id_str = str(d["_id"])
        sd["zone_name"] = zone_map.get(str(d.get("zone_id", "")), "—")
        sd["station_count"] = station_counts.get(div_id_str, 0)
        sd["assigned_stations"] = assigned_stations_map.get(div_id_str, [])
        result.append(sd)
    return result


@router.get("/api/divisions/{division_id}")
async def get_division(division_id: str):
    doc = await divisions_collection.find_one({"_id": ObjectId(division_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Division not found")
    zone = await zones_collection.find_one({"_id": ObjectId(doc.get("zone_id", ""))}) if doc.get("zone_id") else None
    sd = serialize_doc(doc)
    sd["zone_name"] = zone.get("name") if zone else "—"
    return sd


@router.post("/api/divisions")
async def create_division(div: DivisionCreate, current_user_id: Optional[str] = Query(None)):
    await _require_superadmin(current_user_id)
    # Validate zone exists
    try:
        zone = await zones_collection.find_one({"_id": ObjectId(div.zone_id)})
    except Exception:
        zone = None
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    code = div.code.strip().upper()
    existing = await divisions_collection.find_one({"$or": [
        {"name": {"$regex": f"^{div.name.strip()}$", "$options": "i"}},
        {"code": code},
    ]})
    if existing:
        raise HTTPException(status_code=409, detail="Division with this name or code already exists")
    doc = {"name": div.name.strip(), "code": code, "zone_id": div.zone_id, "created_at": now_ist()}
    result = await divisions_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    sd = serialize_doc(doc)
    sd["zone_name"] = zone.get("name")
    return sd


@router.put("/api/divisions/{division_id}")
async def update_division(division_id: str, div: DivisionCreate, current_user_id: Optional[str] = Query(None)):
    await _require_superadmin(current_user_id)
    code = div.code.strip().upper()
    collision = await divisions_collection.find_one({
        "_id": {"$ne": ObjectId(division_id)},
        "$or": [
            {"name": {"$regex": f"^{div.name.strip()}$", "$options": "i"}},
            {"code": code},
        ],
    })
    if collision:
        raise HTTPException(status_code=409, detail="Another division with this name or code exists")
    result = await divisions_collection.update_one(
        {"_id": ObjectId(division_id)},
        {"$set": {"name": div.name.strip(), "code": code, "zone_id": div.zone_id}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Division not found")
    doc = await divisions_collection.find_one({"_id": ObjectId(division_id)})
    return serialize_doc(doc)


@router.delete("/api/divisions/{division_id}")
async def delete_division(division_id: str, current_user_id: Optional[str] = Query(None)):
    await _require_superadmin(current_user_id)
    in_use = await stations_collection.count_documents({"division_id": division_id})
    if in_use > 0:
        raise HTTPException(status_code=409,
                            detail=f"Cannot delete: {in_use} station(s) still assigned to this division. Re-assign or delete them first.")
    # Also block if a divisional_admin is assigned
    da_count = await users_collection.count_documents({"assigned_division_id": division_id})
    if da_count > 0:
        raise HTTPException(status_code=409,
                            detail=f"Cannot delete: {da_count} divisional admin(s) are assigned to this division")
    result = await divisions_collection.delete_one({"_id": ObjectId(division_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Division not found")
    return {"message": "Division deleted"}


@router.get("/api/divisions/{division_id}/stations")
async def get_division_stations(division_id: str):
    docs = await stations_collection.find({"division_id": division_id}).to_list(1000)
    return [serialize_doc(d) for d in docs]


@router.post("/api/divisions/{division_id}/assign-stations")
async def assign_stations_to_division(
    division_id: str,
    station_ids: List[str],
    current_user_id: Optional[str] = Query(None),
):
    await _require_superadmin(current_user_id)
    div = await divisions_collection.find_one({"_id": ObjectId(division_id)})
    if not div:
        raise HTTPException(status_code=404, detail="Division not found")
    result = await stations_collection.update_many(
        {"_id": {"$in": [ObjectId(sid) for sid in station_ids]}},
        {"$set": {"division_id": division_id}},
    )
    return {"message": f"{result.modified_count} station(s) assigned to division"}
