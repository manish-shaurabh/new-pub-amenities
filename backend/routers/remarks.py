"""Phase 5 — Threaded Remarks System.

Implements an immutable, threaded chronological log of remarks against each
orange-list (defect) entry. Captures both user-written remarks and auto-logged
system events.

Rules (approved):
  - Text length: max 300 chars
  - Tags: dynamic master managed by admin/superadmin (admin endpoints below).
    Default seeds: spare_pending, work_order (requires ref), escalated,
    under_observation, awaiting_contractor.
  - User-posted remarks are immutable (no edit/delete) — confirmed via UI prompt.
  - Auto-entries always immutable.
  - Visibility: read-only after orange-list is RESOLVED. Hidden 60 days after
    approval (archival TTL).
  - Permissions:
      * note         → any of SUP/ASUP/RO/Admin/Superadmin
      * observation  → ASUP/RO/Admin/Superadmin
      * escalation   → SUP/ASUP/RO/Admin/Superadmin
      * defect_report/rectification/approval/rejection → SYSTEM only
  - Notification fanout (manual posts):
      * note         → ASUP + RO scoped to asset's station/dept
      * observation  → SUP + ASUP scoped to asset's station/dept
      * escalation   → SUP + ASUP + RO scoped to asset's station/dept
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from bson import ObjectId
from pydantic import BaseModel, Field

from database import (
    serialize_doc,
    orange_list_collection,
    assets_collection,
    asset_types_collection,
    users_collection,
    notifications_collection,
    remarks_collection,
    remark_tags_collection,
)
from models import UserRole, OrangeListStatus

router = APIRouter()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
TEXT_MAX = 300
ARCHIVAL_DAYS = 60

USER_REMARK_TYPES = {"note", "observation", "escalation"}
SYSTEM_REMARK_TYPES = {"defect_report", "rectification", "approval", "rejection"}

# Who can post each manual type
_POSTER_ROLES = {
    "note": {
        UserRole.SUPERVISOR.value,
        UserRole.APPROVING_SUPERVISOR.value,
        UserRole.REPORTING_OFFICER.value,
        UserRole.ADMIN.value,
        UserRole.SUPERADMIN.value,
    },
    "observation": {
        UserRole.APPROVING_SUPERVISOR.value,
        UserRole.REPORTING_OFFICER.value,
        UserRole.ADMIN.value,
        UserRole.SUPERADMIN.value,
    },
    "escalation": {
        UserRole.SUPERVISOR.value,
        UserRole.APPROVING_SUPERVISOR.value,
        UserRole.REPORTING_OFFICER.value,
        UserRole.ADMIN.value,
        UserRole.SUPERADMIN.value,
    },
}

DEFAULT_TAGS = [
    {"slug": "spare_pending",     "label": "Spare Pending",      "requires_ref": False},
    {"slug": "work_order",        "label": "Work Order",         "requires_ref": True},
    {"slug": "escalated",         "label": "Escalated",          "requires_ref": False},
    {"slug": "under_observation", "label": "Under Observation",  "requires_ref": False},
    {"slug": "awaiting_contractor","label": "Awaiting Contractor","requires_ref": False},
]


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class RemarkCreate(BaseModel):
    type: str = Field(..., description="note | observation | escalation")
    text: str = Field(..., max_length=TEXT_MAX)
    tag: Optional[str] = None
    tag_ref: Optional[str] = None


class TagCreate(BaseModel):
    slug: str = Field(..., min_length=2, max_length=40)
    label: str = Field(..., min_length=2, max_length=60)
    requires_ref: bool = False


class TagUpdate(BaseModel):
    label: Optional[str] = None
    requires_ref: Optional[bool] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
async def _seed_default_tags():
    """Insert default tags on first call if collection is empty."""
    count = await remark_tags_collection.count_documents({})
    if count > 0:
        return
    now = datetime.now(timezone.utc)
    docs = [{**t, "archived": False, "is_default": True, "created_at": now} for t in DEFAULT_TAGS]
    await remark_tags_collection.insert_many(docs)


async def _resolve_tag(slug: Optional[str], tag_ref: Optional[str]):
    """Validate a tag slug exists and that tag_ref accompanies it when required.
    Returns (slug, label) or (None, None)."""
    if not slug:
        return None, None
    tag = await remark_tags_collection.find_one({"slug": slug, "archived": {"$ne": True}})
    if not tag:
        raise HTTPException(status_code=400, detail=f"Unknown or archived tag '{slug}'")
    if tag.get("requires_ref") and not (tag_ref or "").strip():
        raise HTTPException(status_code=400, detail=f"Tag '{slug}' requires a reference")
    return tag["slug"], tag.get("label")


async def _get_orange_item(item_id: str) -> dict:
    try:
        item = await orange_list_collection.find_one({"_id": ObjectId(item_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid orange list id")
    if not item:
        raise HTTPException(status_code=404, detail="Orange list item not found")
    return item


def _is_thread_readonly(item: dict) -> bool:
    """Thread is read-only once the defect is RESOLVED."""
    return item.get("status") == OrangeListStatus.RESOLVED.value


def _archival_cutoff(item: dict):
    """If the item is resolved, return the cutoff after which the thread is hidden."""
    if item.get("status") != OrangeListStatus.RESOLVED.value:
        return None
    approved_at = item.get("approved_at")
    if isinstance(approved_at, str):
        try:
            approved_at = datetime.fromisoformat(approved_at.replace("Z", "+00:00").replace("+00:00", ""))
        except Exception:
            return None
    if not isinstance(approved_at, datetime):
        return None
    return approved_at + timedelta(days=ARCHIVAL_DAYS)


async def _notify_fanout(asset: dict, remark_type: str, author_id: str, item_id: str, message: str):
    """Send notifications according to remark_type fanout rules."""
    if not asset:
        return
    station_id = asset.get("station_id")
    asset_type = None
    if asset.get("asset_type_id"):
        try:
            asset_type = await asset_types_collection.find_one({"_id": ObjectId(asset["asset_type_id"])})
        except Exception:
            asset_type = None
    dept_id = asset_type.get("department_id") if asset_type else None

    target_roles: set = set()
    if remark_type == "note":
        target_roles = {UserRole.APPROVING_SUPERVISOR.value, UserRole.REPORTING_OFFICER.value}
    elif remark_type == "observation":
        target_roles = {UserRole.SUPERVISOR.value, UserRole.APPROVING_SUPERVISOR.value}
    elif remark_type == "escalation":
        target_roles = {
            UserRole.SUPERVISOR.value,
            UserRole.APPROVING_SUPERVISOR.value,
            UserRole.REPORTING_OFFICER.value,
        }
    else:
        return

    recipients: set = set()
    for role in target_roles:
        q: dict = {"role": role, "is_active": True}
        if role == UserRole.APPROVING_SUPERVISOR.value:
            if station_id:
                q["assigned_stations"] = station_id
        else:
            # SUP / RO are scoped by both dept + station
            if dept_id:
                q["department_id"] = dept_id
            if station_id:
                q["assigned_stations"] = station_id
        async for u in users_collection.find(q, {"_id": 1}):
            recipients.add(str(u["_id"]))

    recipients.discard(author_id)
    if not recipients:
        return
    now = datetime.now(timezone.utc)
    docs = [
        {
            "user_id": uid,
            "title": f"New {remark_type} remark",
            "message": message,
            "notification_type": "alert" if remark_type == "escalation" else "info",
            "related_entity_type": "orange_list",
            "related_entity_id": item_id,
            "is_read": False,
            "created_at": now,
        }
        for uid in recipients
    ]
    await notifications_collection.insert_many(docs)


async def add_auto_remark(
    *,
    orange_list_id: str,
    asset_id: Optional[str],
    type: str,
    text: str,
    author_id: Optional[str] = None,
    author_name: Optional[str] = None,
    author_role: Optional[str] = None,
    tag: Optional[str] = None,
    tag_ref: Optional[str] = None,
    event_at: Optional[datetime] = None,  # When the event actually occurred (may differ for backdated defects)
):
    """Insert a system-generated remark. Used by orange_list/inspections hooks."""
    if type not in SYSTEM_REMARK_TYPES and type not in USER_REMARK_TYPES:
        return None
    text = (text or "")[:TEXT_MAX]
    doc = {
        "orange_list_id": orange_list_id,
        "asset_id": asset_id,
        "author_id": author_id,
        "author_name": author_name or "System",
        "role": author_role,
        "type": type,
        "text": text,
        "tag": tag,
        "tag_ref": tag_ref,
        "is_auto": True,
        "created_at": datetime.now(timezone.utc),
        # event_at: when the underlying event occurred — only set when different from created_at.
        # Enables UI to show "logged now, defect started T-30h" without mutating the audit timestamp.
        "event_at": event_at if event_at else None,
    }
    res = await remarks_collection.insert_one(doc)
    return str(res.inserted_id)


# ---------------------------------------------------------------------------
# Tag master endpoints (admin-managed)
# ---------------------------------------------------------------------------
@router.get("/api/remarks/tags")
async def list_tags(include_archived: bool = False):
    await _seed_default_tags()
    q = {} if include_archived else {"archived": {"$ne": True}}
    docs = await remark_tags_collection.find(q).sort("label", 1).to_list(500)
    return [serialize_doc(d) for d in docs]


@router.post("/api/remarks/tags")
async def create_tag(payload: TagCreate, current_user_id: str):
    user = await users_collection.find_one({"_id": ObjectId(current_user_id)})
    if not user or user.get("role") not in (UserRole.ADMIN.value, UserRole.SUPERADMIN.value):
        raise HTTPException(status_code=403, detail="Only admin/superadmin can manage tags")
    slug = payload.slug.strip().lower().replace(" ", "_")
    existing = await remark_tags_collection.find_one({"slug": slug})
    if existing:
        raise HTTPException(status_code=400, detail="Tag slug already exists")
    doc = {
        "slug": slug,
        "label": payload.label.strip(),
        "requires_ref": bool(payload.requires_ref),
        "archived": False,
        "is_default": False,
        "created_by": current_user_id,
        "created_at": datetime.now(timezone.utc),
    }
    res = await remark_tags_collection.insert_one(doc)
    out = await remark_tags_collection.find_one({"_id": res.inserted_id})
    return serialize_doc(out)


@router.put("/api/remarks/tags/{tag_id}")
async def update_tag(tag_id: str, payload: TagUpdate, current_user_id: str):
    user = await users_collection.find_one({"_id": ObjectId(current_user_id)})
    if not user or user.get("role") not in (UserRole.ADMIN.value, UserRole.SUPERADMIN.value):
        raise HTTPException(status_code=403, detail="Only admin/superadmin can manage tags")
    update: dict = {}
    if payload.label is not None:
        update["label"] = payload.label.strip()
    if payload.requires_ref is not None:
        update["requires_ref"] = bool(payload.requires_ref)
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await remark_tags_collection.update_one({"_id": ObjectId(tag_id)}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Tag not found")
    out = await remark_tags_collection.find_one({"_id": ObjectId(tag_id)})
    return serialize_doc(out)


@router.delete("/api/remarks/tags/{tag_id}")
async def archive_tag(tag_id: str, current_user_id: str):
    user = await users_collection.find_one({"_id": ObjectId(current_user_id)})
    if not user or user.get("role") not in (UserRole.ADMIN.value, UserRole.SUPERADMIN.value):
        raise HTTPException(status_code=403, detail="Only admin/superadmin can manage tags")
    res = await remark_tags_collection.update_one(
        {"_id": ObjectId(tag_id)}, {"$set": {"archived": True}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Tag not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Thread endpoints
# ---------------------------------------------------------------------------
@router.get("/api/orange-list/{item_id}/remarks")
async def list_remarks(item_id: str):
    item = await _get_orange_item(item_id)

    cutoff = _archival_cutoff(item)
    archived = bool(cutoff and datetime.now(timezone.utc) > cutoff)

    if archived:
        return {
            "items": [],
            "read_only": True,
            "archived": True,
            "archive_cutoff": cutoff.isoformat() if cutoff else None,
        }

    docs = await remarks_collection.find({"orange_list_id": item_id}).sort("created_at", 1).to_list(2000)
    return {
        "items": [serialize_doc(d) for d in docs],
        "read_only": _is_thread_readonly(item),
        "archived": False,
        "archive_cutoff": cutoff.isoformat() if cutoff else None,
    }


@router.post("/api/orange-list/{item_id}/remarks")
async def create_remark(item_id: str, payload: RemarkCreate, current_user_id: str):
    if payload.type not in USER_REMARK_TYPES:
        raise HTTPException(status_code=400, detail="Invalid remark type")
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Remark text is required")
    if len(text) > TEXT_MAX:
        raise HTTPException(status_code=400, detail=f"Remark exceeds {TEXT_MAX} characters")

    item = await _get_orange_item(item_id)
    if _is_thread_readonly(item):
        raise HTTPException(status_code=400, detail="Thread is read-only — defect is resolved")

    user = await users_collection.find_one({"_id": ObjectId(current_user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    role = user.get("role")
    allowed = _POSTER_ROLES.get(payload.type, set())
    if role not in allowed:
        raise HTTPException(status_code=403, detail=f"Your role cannot post {payload.type} remarks")

    tag_slug, _ = await _resolve_tag(payload.tag, payload.tag_ref)

    doc = {
        "orange_list_id": item_id,
        "asset_id": item.get("asset_id"),
        "author_id": current_user_id,
        "author_name": user.get("name") or "User",
        "role": role,
        "type": payload.type,
        "text": text,
        "tag": tag_slug,
        "tag_ref": (payload.tag_ref or "").strip() or None,
        "is_auto": False,
        "created_at": datetime.now(timezone.utc),
    }
    res = await remarks_collection.insert_one(doc)

    # Fanout notifications
    asset = None
    if item.get("asset_id"):
        try:
            asset = await assets_collection.find_one({"_id": ObjectId(item["asset_id"])})
        except Exception:
            asset = None
    msg_label = {"note": "Note", "observation": "Observation", "escalation": "Escalation"}[payload.type]
    asset_no = asset.get("asset_number") if asset else "asset"
    msg = f"{msg_label} on {asset_no} by {user.get('name','User')}: {text[:120]}"
    try:
        await _notify_fanout(asset or {}, payload.type, current_user_id, item_id, msg)
    except Exception as e:  # never fail the post on notification errors
        print(f"[remarks] notify fanout error: {e}")

    out = await remarks_collection.find_one({"_id": res.inserted_id})
    return serialize_doc(out)
