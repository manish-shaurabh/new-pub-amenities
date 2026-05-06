from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from bson import ObjectId
import io
import os
import uuid

from database import (
    serialize_doc,
    departments_collection, stations_collection, locations_collection,
    asset_types_collection, assets_collection, users_collection,
    inspections_collection, orange_list_collection, notifications_collection,
    schedules_collection, audit_log_collection,
)
from models import (
    DepartmentCreate, StationCreate, LocationCreate,
    AssetTypeCreate, AssetCreate, UserCreate, UserLogin,
    InspectionCreate, InspectionItemStatus,
    OrangeListCreate, MarkWorkingRequest, ApproveWorkingRequest,
    NotificationCreate, ScheduleCreate, ScheduleFrequency,
    UserRole, AssetStatus, OrangeListStatus,
)

router = APIRouter()


# ============ NOTIFICATIONS ============
@router.get("/api/notifications")
async def list_notifications(
    user_id: str,
    unread_only: bool = False,
    page: int = 1,
    page_size: int = 100,
    search: Optional[str] = None,
    notification_type: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    paginated: bool = False,
):
    """List notifications for a user.

    Backwards-compatible: when `paginated=False` (default), returns a flat list
    of notifications (newest first, capped by `page_size`, max 100). When
    `paginated=True`, returns an envelope `{ items, total, page, page_size, total_pages }`
    suitable for the full Notifications page.
    """
    query = {"user_id": user_id}
    if unread_only:
        query["is_read"] = False
    if notification_type:
        query["notification_type"] = notification_type
    # Date range filter on created_at (ISO strings stored)
    if from_date or to_date:
        date_q = {}
        if from_date:
            date_q["$gte"] = from_date
        if to_date:
            date_q["$lte"] = to_date
        query["created_at"] = date_q
    if search:
        # case-insensitive search across title and message
        query["$or"] = [
            {"title": {"$regex": search, "$options": "i"}},
            {"message": {"$regex": search, "$options": "i"}},
        ]

    page = max(1, int(page or 1))
    page_size = max(1, min(int(page_size or 100), 100))

    if not paginated:
        docs = await notifications_collection.find(query).sort("created_at", -1).to_list(page_size)
        return [serialize_doc(d) for d in docs]

    total = await notifications_collection.count_documents(query)
    skip = (page - 1) * page_size
    cursor = notifications_collection.find(query).sort("created_at", -1).skip(skip).limit(page_size)
    docs = await cursor.to_list(page_size)
    total_pages = (total + page_size - 1) // page_size if page_size else 1
    return {
        "items": [serialize_doc(d) for d in docs],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


@router.post("/api/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str):
    result = await notifications_collection.update_one(
        {"_id": ObjectId(notification_id)},
        {"$set": {"is_read": True}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"message": "Notification marked as read"}


@router.post("/api/notifications/{notification_id}/unread")
async def mark_notification_unread(notification_id: str):
    result = await notifications_collection.update_one(
        {"_id": ObjectId(notification_id)},
        {"$set": {"is_read": False}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"message": "Notification marked as unread"}


@router.delete("/api/notifications/{notification_id}")
async def delete_notification(notification_id: str):
    result = await notifications_collection.delete_one({"_id": ObjectId(notification_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"message": "Notification deleted"}


@router.post("/api/notifications/delete-read")
async def delete_read_notifications(user_id: str = Query(...)):
    """Bulk delete all notifications already marked as read for this user."""
    result = await notifications_collection.delete_many({"user_id": user_id, "is_read": True})
    return {"message": "Read notifications deleted", "deleted": result.deleted_count}


@router.post("/api/notifications/mark-all-read")
async def mark_all_notifications_read(user_id: str = Query(...)):
    await notifications_collection.update_many(
        {"user_id": user_id, "is_read": False},
        {"$set": {"is_read": True}}
    )
    return {"message": "All notifications marked as read"}


@router.get("/api/notifications/unread-count")
async def get_unread_count(user_id: str = Query(...)):
    count = await notifications_collection.count_documents({"user_id": user_id, "is_read": False})
    return {"count": count}
