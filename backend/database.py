import os
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "railway_asset_inspection")

# Async client for FastAPI
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# Sync client for scripts/testing
sync_client = MongoClient(MONGO_URL)
sync_db = sync_client[DB_NAME]

# Collections
departments_collection = db["departments"]
stations_collection = db["stations"]
locations_collection = db["locations"]
asset_types_collection = db["asset_types"]
assets_collection = db["assets"]
users_collection = db["users"]
inspections_collection = db["inspections"]
orange_list_collection = db["orange_list"]
notifications_collection = db["notifications"]
schedules_collection = db["schedules"]
audit_log_collection = db["audit_log"]
remarks_collection = db["remarks"]
remark_tags_collection = db["remark_tags"]


def get_db():
    return db


def _dt_to_iso(dt) -> str:
    """
    Serialize a datetime to an ISO 8601 string with an explicit UTC marker.
    Naive datetimes (stored by legacy datetime.utcnow() calls) are treated
    as UTC and get a trailing 'Z'.  Timezone-aware datetimes already carry
    offset information and are serialised via isoformat().

    JavaScript parses bare "2026-05-07T09:21:19" as **local time**, which
    renders wrong for every non-UTC user.  Adding 'Z' (or '+00:00') forces
    correct UTC interpretation so the browser converts to local time properly.
    """
    if dt.tzinfo is None:
        return dt.isoformat() + "Z"
    return dt.isoformat()


def serialize_doc(doc):
    """Convert MongoDB document to JSON-serializable dict."""
    if doc is None:
        return None
    from bson import ObjectId
    from datetime import datetime

    result = {}
    for key, value in doc.items():
        if isinstance(value, ObjectId):
            result[key] = str(value)
        elif isinstance(value, datetime):
            result[key] = _dt_to_iso(value)
        elif isinstance(value, list):
            result[key] = [serialize_doc(item) if isinstance(item, dict) else
                           str(item) if isinstance(item, ObjectId) else
                           _dt_to_iso(item) if isinstance(item, datetime) else item
                           for item in value]
        elif isinstance(value, dict):
            result[key] = serialize_doc(value)
        else:
            result[key] = value
    return result
