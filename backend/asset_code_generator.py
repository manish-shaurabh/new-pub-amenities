"""Atomic, deterministic asset code generator.

Pattern: {ZONE}-{DIV}-{STN}-{LOC}-[{SZ}-]{TYPE}-{seq:04d}
- LOC slot is required (single token per user requirement) — falls back to a
  station-level placeholder "STN" if no specific location is bound.
- SZ slot is included only when a sub-zone is given (station-level unassigned
  assets skip this token).
- seq is an atomic, per-bucket monotonic counter held in `asset_code_counters`.
- The full code is forced unique by retrying the counter on conflict (very rare).
"""
from bson import ObjectId
from typing import Optional, Tuple
from database import (
    asset_code_counters_collection, assets_collection,
    stations_collection, locations_collection, sub_zones_collection,
    asset_types_collection, departments_collection,
    divisions_collection, zones_collection,
)


def _slug(value: Optional[str], fallback: str, max_len: int = 8) -> str:
    s = "".join(ch.upper() if ch.isalnum() else "-" for ch in (value or "").strip())
    s = s.strip("-")
    if not s:
        s = fallback
    s = s[:max_len].strip("-")
    return s or fallback


async def _next_seq(bucket_key: str) -> int:
    """Atomic counter increment for a given hierarchy bucket."""
    doc = await asset_code_counters_collection.find_one_and_update(
        {"_id": bucket_key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,  # AFTER
    )
    # When upserting fresh, doc may already contain seq=1 (find_one_and_update with return_document=True returns the post-image)
    return int(doc.get("seq", 1)) if doc else 1


async def resolve_hierarchy(
    *,
    station_id: str,
    location_id: Optional[str] = None,
    sub_zone_id: Optional[str] = None,
) -> dict:
    """Walk up the hierarchy and return all parent docs.

    If `sub_zone_id` is given, station_id/location_id are auto-derived from it
    (and any provided station_id/location_id must match).
    Returns a dict with keys: station, location, sub_zone, division, zone, dept (None).
    """
    sub_zone = None
    location = None
    station = None

    if sub_zone_id:
        try:
            sub_zone = await sub_zones_collection.find_one({"_id": ObjectId(sub_zone_id)})
        except Exception:
            sub_zone = None
        if not sub_zone:
            raise ValueError("Sub-zone not found")
        loc_id = sub_zone.get("location_id")
        stn_id = sub_zone.get("station_id")
        try:
            location = await locations_collection.find_one({"_id": ObjectId(loc_id)}) if loc_id else None
        except Exception:
            location = None
        try:
            station = await stations_collection.find_one({"_id": ObjectId(stn_id)}) if stn_id else None
        except Exception:
            station = None
    else:
        if location_id:
            try:
                location = await locations_collection.find_one({"_id": ObjectId(location_id)})
            except Exception:
                location = None
            if not location:
                raise ValueError("Location not found")
        try:
            station = await stations_collection.find_one({"_id": ObjectId(station_id)})
        except Exception:
            station = None
        if not station:
            raise ValueError("Station not found")

    # Division
    division = None
    if station and station.get("division_id"):
        try:
            division = await divisions_collection.find_one({"_id": ObjectId(station["division_id"])})
        except Exception:
            division = None

    # Zone
    zone = None
    if division and division.get("zone_id"):
        try:
            zone = await zones_collection.find_one({"_id": ObjectId(division["zone_id"])})
        except Exception:
            zone = None

    return {
        "station": station,
        "location": location,
        "sub_zone": sub_zone,
        "division": division,
        "zone": zone,
    }


async def generate_asset_code(
    *,
    asset_type: dict,
    station: dict,
    location: Optional[dict],
    sub_zone: Optional[dict],
    division: Optional[dict],
    zone: Optional[dict],
) -> Tuple[str, str]:
    """Generate {ZONE}-{DIV}-{STN}-{LOC}-[{SZ}-]{TYPE}-{seq} ensuring uniqueness.

    Returns (code, bucket_key).
    """
    zone_tok = _slug(zone.get("code") or zone.get("name") if zone else "", fallback="ZX", max_len=6)
    div_tok = _slug(division.get("code") or division.get("name") if division else "", fallback="DX", max_len=6)
    stn_tok = _slug(station.get("code") or station.get("name") if station else "", fallback="STN", max_len=8)
    loc_tok = _slug(location.get("code") or location.get("name") if location else "", fallback="STN", max_len=8)
    sz_tok = _slug(sub_zone.get("code") or sub_zone.get("name") if sub_zone else "", fallback="", max_len=6)
    type_tok = _slug(asset_type.get("code") or asset_type.get("name") or "", fallback="TYP", max_len=8)

    bucket_parts = [zone_tok, div_tok, stn_tok, loc_tok]
    if sz_tok:
        bucket_parts.append(sz_tok)
    bucket_parts.append(type_tok)
    bucket_key = ":".join(bucket_parts)

    # Retry loop (collision-safe — typically resolves on first iteration)
    for _ in range(5):
        seq = await _next_seq(bucket_key)
        code_prefix = "-".join(bucket_parts)
        code = f"{code_prefix}-{seq:04d}"
        existing = await assets_collection.find_one({"asset_number": code})
        if not existing:
            return code, bucket_key
    raise RuntimeError("Could not generate a unique asset code after 5 retries")
