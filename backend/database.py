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
            result[key] = value.isoformat()
        elif isinstance(value, list):
            result[key] = [serialize_doc(item) if isinstance(item, dict) else 
                          str(item) if isinstance(item, ObjectId) else
                          item.isoformat() if isinstance(item, datetime) else item
                          for item in value]
        elif isinstance(value, dict):
            result[key] = serialize_doc(value)
        else:
            result[key] = value
    return result
