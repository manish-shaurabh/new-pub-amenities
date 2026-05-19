"""Canvas Landmarks — P.No markers and reference points on the Platform Blueprint.

Landmarks are positioned on a sub-zone canvas and rendered as labeled pins
(e.g., "P.No 27", "P.No 28") to help inspectors orient themselves.
"""
from typing import Optional
from bson import ObjectId
from fastapi import APIRouter, HTTPException

from database import now_ist, serialize_doc, canvas_landmarks_collection
from models import CanvasLandmarkCreate

router = APIRouter()


def _normalize_id(doc):
    """Expose MongoDB _id as `id` and drop `_id` from the response."""
    if doc is None:
        return None
    if "_id" in doc and "id" not in doc:
        doc["id"] = doc["_id"]
    doc.pop("_id", None)
    return doc


@router.get("/api/canvas-landmarks")
async def list_landmarks(
    sub_zone_id: Optional[str] = None,
    location_id: Optional[str] = None,
    station_id: Optional[str] = None,
):
    query = {}
    if sub_zone_id:
        query["sub_zone_id"] = sub_zone_id
    elif location_id:
        query["location_id"] = location_id
    elif station_id:
        query["station_id"] = station_id
    docs = await canvas_landmarks_collection.find(query).sort("label", 1).to_list(500)
    return [_normalize_id(serialize_doc(d)) for d in docs]


@router.post("/api/canvas-landmarks")
async def create_landmark(lm: CanvasLandmarkCreate):
    doc = {
        "sub_zone_id": lm.sub_zone_id,
        "location_id": lm.location_id,
        "station_id": lm.station_id,
        "label": lm.label.strip(),
        "x": float(lm.x),
        "y": float(lm.y),
        "landmark_type": lm.landmark_type or "pole",
        "created_at": now_ist(),
    }
    result = await canvas_landmarks_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return _normalize_id(serialize_doc(doc))


@router.put("/api/canvas-landmarks/{landmark_id}")
async def update_landmark(landmark_id: str, lm: CanvasLandmarkCreate):
    result = await canvas_landmarks_collection.update_one(
        {"_id": ObjectId(landmark_id)},
        {"$set": {
            "label": lm.label.strip(),
            "x": float(lm.x),
            "y": float(lm.y),
            "landmark_type": lm.landmark_type or "pole",
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Landmark not found")
    doc = await canvas_landmarks_collection.find_one({"_id": ObjectId(landmark_id)})
    return _normalize_id(serialize_doc(doc))


@router.delete("/api/canvas-landmarks/{landmark_id}")
async def delete_landmark(landmark_id: str):
    result = await canvas_landmarks_collection.delete_one({"_id": ObjectId(landmark_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Landmark not found")
    return {"message": "Landmark deleted"}
