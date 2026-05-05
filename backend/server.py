import os
import uuid
import shutil
import io
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from bson import ObjectId

load_dotenv()

from database import (
    db, serialize_doc,
    departments_collection, stations_collection, locations_collection,
    asset_types_collection, assets_collection, users_collection,
    inspections_collection, orange_list_collection, notifications_collection,
    schedules_collection, audit_log_collection
)
from models import (
    DepartmentCreate, StationCreate, LocationCreate,
    AssetTypeCreate, AssetCreate, UserCreate, UserLogin,
    InspectionCreate, InspectionItemStatus,
    OrangeListCreate, MarkWorkingRequest, ApproveWorkingRequest,
    NotificationCreate, ScheduleCreate, ScheduleFrequency,
    UserRole, AssetStatus, OrangeListStatus
)

app = FastAPI(title="Railway Asset Inspection Management System")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Uploads directory
UPLOAD_DIR = "/app/backend/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


# ============ HEALTH CHECK ============
@app.get("/api/health")
async def health_check():
    return {"status": "healthy", "service": "Railway Asset Inspection Management System"}


# ============ DEPARTMENTS ============
@app.post("/api/departments")
async def create_department(dept: DepartmentCreate):
    doc = {
        "name": dept.name,
        "code": dept.code,
        "description": dept.description,
        "created_at": datetime.utcnow()
    }
    result = await departments_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@app.get("/api/departments")
async def list_departments():
    docs = await departments_collection.find().to_list(1000)
    return [serialize_doc(d) for d in docs]


@app.get("/api/departments/{dept_id}")
async def get_department(dept_id: str):
    doc = await departments_collection.find_one({"_id": ObjectId(dept_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Department not found")
    return serialize_doc(doc)


@app.put("/api/departments/{dept_id}")
async def update_department(dept_id: str, dept: DepartmentCreate):
    result = await departments_collection.update_one(
        {"_id": ObjectId(dept_id)},
        {"$set": {"name": dept.name, "code": dept.code, "description": dept.description}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Department not found")
    doc = await departments_collection.find_one({"_id": ObjectId(dept_id)})
    return serialize_doc(doc)


@app.delete("/api/departments/{dept_id}")
async def delete_department(dept_id: str):
    result = await departments_collection.delete_one({"_id": ObjectId(dept_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Department not found")
    return {"message": "Department deleted"}


# ============ STATIONS ============
@app.post("/api/stations")
async def create_station(station: StationCreate):
    doc = {
        "name": station.name,
        "code": station.code,
        "zone": station.zone,
        "division": station.division,
        "approving_supervisor_id": station.approving_supervisor_id,
        "created_at": datetime.utcnow()
    }
    result = await stations_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@app.get("/api/stations")
async def list_stations():
    docs = await stations_collection.find().to_list(1000)
    # Batch fetch approving supervisors
    asup_ids = list(set(d.get("approving_supervisor_id") for d in docs if d.get("approving_supervisor_id")))
    asup_map = {}
    if asup_ids:
        asup_docs = await users_collection.find({"_id": {"$in": [ObjectId(aid) for aid in asup_ids]}}).to_list(1000)
        asup_map = {str(u["_id"]): u["name"] for u in asup_docs}
    
    for doc in docs:
        doc["approving_supervisor_name"] = asup_map.get(doc.get("approving_supervisor_id", ""), None)
    return [serialize_doc(d) for d in docs]


@app.get("/api/stations/{station_id}")
async def get_station(station_id: str):
    doc = await stations_collection.find_one({"_id": ObjectId(station_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Station not found")
    return serialize_doc(doc)


@app.put("/api/stations/{station_id}")
async def update_station(station_id: str, station: StationCreate):
    result = await stations_collection.update_one(
        {"_id": ObjectId(station_id)},
        {"$set": {
            "name": station.name,
            "code": station.code,
            "zone": station.zone,
            "division": station.division,
            "approving_supervisor_id": station.approving_supervisor_id
        }}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Station not found")
    doc = await stations_collection.find_one({"_id": ObjectId(station_id)})
    return serialize_doc(doc)


@app.delete("/api/stations/{station_id}")
async def delete_station(station_id: str):
    result = await stations_collection.delete_one({"_id": ObjectId(station_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Station not found")
    return {"message": "Station deleted"}


# ============ LOCATIONS ============
@app.post("/api/locations")
async def create_location(location: LocationCreate):
    station = await stations_collection.find_one({"_id": ObjectId(location.station_id)})
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")
    doc = {
        "name": location.name,
        "station_id": location.station_id,
        "description": location.description,
        "created_at": datetime.utcnow()
    }
    result = await locations_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@app.get("/api/locations")
async def list_locations(station_id: Optional[str] = None):
    query = {}
    if station_id:
        query["station_id"] = station_id
    docs = await locations_collection.find(query).to_list(1000)
    # Batch fetch stations
    station_ids = list(set(d["station_id"] for d in docs if d.get("station_id")))
    stations_map = {}
    if station_ids:
        stations_docs = await stations_collection.find({"_id": {"$in": [ObjectId(sid) for sid in station_ids]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in stations_docs}
    for doc in docs:
        doc["station_name"] = stations_map.get(doc["station_id"], "Unknown")
    return [serialize_doc(d) for d in docs]


@app.put("/api/locations/{location_id}")
async def update_location(location_id: str, location: LocationCreate):
    result = await locations_collection.update_one(
        {"_id": ObjectId(location_id)},
        {"$set": {"name": location.name, "station_id": location.station_id, "description": location.description}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Location not found")
    doc = await locations_collection.find_one({"_id": ObjectId(location_id)})
    return serialize_doc(doc)


@app.delete("/api/locations/{location_id}")
async def delete_location(location_id: str):
    result = await locations_collection.delete_one({"_id": ObjectId(location_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Location not found")
    return {"message": "Location deleted"}


# ============ ASSET TYPES ============
@app.post("/api/asset-types")
async def create_asset_type(asset_type: AssetTypeCreate):
    doc = {
        "name": asset_type.name,
        "department_id": asset_type.department_id,
        "checklist": [item.model_dump() for item in asset_type.checklist],
        "description": asset_type.description,
        "created_at": datetime.utcnow()
    }
    result = await asset_types_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@app.get("/api/asset-types")
async def list_asset_types(department_id: Optional[str] = None):
    query = {}
    if department_id:
        query["department_id"] = department_id
    docs = await asset_types_collection.find(query).to_list(1000)
    # Batch fetch departments
    dept_ids = list(set(d["department_id"] for d in docs if d.get("department_id")))
    depts_map = {}
    if dept_ids:
        depts_docs = await departments_collection.find({"_id": {"$in": [ObjectId(did) for did in dept_ids]}}).to_list(1000)
        depts_map = {str(d["_id"]): d["name"] for d in depts_docs}
    for doc in docs:
        doc["department_name"] = depts_map.get(doc["department_id"], "Unknown")
    return [serialize_doc(d) for d in docs]


@app.put("/api/asset-types/{asset_type_id}")
async def update_asset_type(asset_type_id: str, asset_type: AssetTypeCreate):
    result = await asset_types_collection.update_one(
        {"_id": ObjectId(asset_type_id)},
        {"$set": {
            "name": asset_type.name,
            "department_id": asset_type.department_id,
            "checklist": [item.model_dump() for item in asset_type.checklist],
            "description": asset_type.description
        }}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Asset type not found")
    doc = await asset_types_collection.find_one({"_id": ObjectId(asset_type_id)})
    return serialize_doc(doc)


@app.delete("/api/asset-types/{asset_type_id}")
async def delete_asset_type(asset_type_id: str):
    result = await asset_types_collection.delete_one({"_id": ObjectId(asset_type_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Asset type not found")
    return {"message": "Asset type deleted"}


# ============ ASSETS ============
def _normalize_freq_days(value):
    """Convert legacy string frequency (daily/weekly/monthly/quarterly) to integer days.
    Returns int (days) or None. Numeric values pass through."""
    if value is None or value == "":
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        mapping = {"daily": 1, "weekly": 7, "monthly": 30, "quarterly": 90}
        if value in mapping:
            return mapping[value]
        try:
            return int(value)
        except (ValueError, TypeError):
            return None
    return None


@app.post("/api/assets")
async def create_asset(asset: AssetCreate):
    asset_type = await asset_types_collection.find_one({"_id": ObjectId(asset.asset_type_id)})
    if not asset_type:
        raise HTTPException(status_code=404, detail="Asset type not found")
    station = await stations_collection.find_one({"_id": ObjectId(asset.station_id)})
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")
    location = await locations_collection.find_one({"_id": ObjectId(asset.location_id)})
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    
    doc = {
        "asset_type_id": asset.asset_type_id,
        "station_id": asset.station_id,
        "location_id": asset.location_id,
        "asset_number": asset.asset_number,
        "status": AssetStatus.WORKING.value,
        "description": asset.description,
        "schedule_frequency": asset.schedule_frequency if asset.schedule_frequency else None,
        "assigned_supervisor_id": asset.assigned_supervisor_id,
        "last_inspected": None,
        "next_due": None,
        "defective_since": None,
        "created_at": datetime.utcnow()
    }
    result = await assets_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@app.get("/api/assets")
async def list_assets(
    station_id: Optional[str] = None,
    location_id: Optional[str] = None,
    asset_type_id: Optional[str] = None,
    status: Optional[str] = None,
    department_id: Optional[str] = None
):
    query = {}
    if station_id:
        query["station_id"] = station_id
    if location_id:
        query["location_id"] = location_id
    if asset_type_id:
        query["asset_type_id"] = asset_type_id
    if status:
        query["status"] = status
    if department_id:
        dept_asset_types = await asset_types_collection.find({"department_id": department_id}).to_list(1000)
        type_ids = [str(at["_id"]) for at in dept_asset_types]
        query["asset_type_id"] = {"$in": type_ids}
    
    docs = await assets_collection.find(query).to_list(5000)
    
    # Batch fetch related data
    type_ids = list(set(d["asset_type_id"] for d in docs if d.get("asset_type_id")))
    station_ids = list(set(d["station_id"] for d in docs if d.get("station_id")))
    location_ids = list(set(d["location_id"] for d in docs if d.get("location_id")))
    supervisor_ids = list(set(d.get("assigned_supervisor_id") for d in docs if d.get("assigned_supervisor_id")))
    
    types_map = {}
    types_checklist_map = {}
    types_dept_map = {}
    if type_ids:
        types_docs = await asset_types_collection.find({"_id": {"$in": [ObjectId(tid) for tid in type_ids]}}).to_list(1000)
        types_map = {str(t["_id"]): t["name"] for t in types_docs}
        types_checklist_map = {str(t["_id"]): t.get("checklist", []) for t in types_docs}
        types_dept_map = {str(t["_id"]): t.get("department_id") for t in types_docs}
    stations_map = {}
    if station_ids:
        stations_docs = await stations_collection.find({"_id": {"$in": [ObjectId(sid) for sid in station_ids]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in stations_docs}
    locations_map = {}
    if location_ids:
        locs_docs = await locations_collection.find({"_id": {"$in": [ObjectId(lid) for lid in location_ids]}}).to_list(1000)
        locations_map = {str(l["_id"]): l["name"] for l in locs_docs}
    supervisors_map = {}
    if supervisor_ids:
        supervisors_docs = await users_collection.find({"_id": {"$in": [ObjectId(sid) for sid in supervisor_ids]}}).to_list(1000)
        supervisors_map = {str(u["_id"]): u["name"] for u in supervisors_docs}
    
    for doc in docs:
        doc["asset_type_name"] = types_map.get(doc["asset_type_id"], "Unknown")
        doc["station_name"] = stations_map.get(doc["station_id"], "Unknown")
        doc["location_name"] = locations_map.get(doc["location_id"], "Unknown")
        doc["checklist"] = types_checklist_map.get(doc["asset_type_id"], [])
        doc["assigned_supervisor_name"] = supervisors_map.get(doc.get("assigned_supervisor_id", ""), None)
        doc["department_id"] = types_dept_map.get(doc["asset_type_id"])
        doc["schedule_frequency"] = _normalize_freq_days(doc.get("schedule_frequency"))
    
    return [serialize_doc(d) for d in docs]


@app.get("/api/assets/{asset_id}")
async def get_asset(asset_id: str):
    doc = await assets_collection.find_one({"_id": ObjectId(asset_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Asset not found")
    asset_type = await asset_types_collection.find_one({"_id": ObjectId(doc["asset_type_id"])})
    station = await stations_collection.find_one({"_id": ObjectId(doc["station_id"])})
    location = await locations_collection.find_one({"_id": ObjectId(doc["location_id"])})
    doc["asset_type_name"] = asset_type["name"] if asset_type else "Unknown"
    doc["station_name"] = station["name"] if station else "Unknown"
    doc["location_name"] = location["name"] if location else "Unknown"
    if asset_type:
        doc["checklist"] = asset_type.get("checklist", [])
    doc["schedule_frequency"] = _normalize_freq_days(doc.get("schedule_frequency"))
    return serialize_doc(doc)


# Change 5: Asset EDIT endpoint
@app.put("/api/assets/{asset_id}")
async def update_asset(asset_id: str, asset: AssetCreate):
    update_data = {
        "asset_type_id": asset.asset_type_id,
        "station_id": asset.station_id,
        "location_id": asset.location_id,
        "asset_number": asset.asset_number,
        "description": asset.description,
        "schedule_frequency": asset.schedule_frequency if asset.schedule_frequency else None,
        "assigned_supervisor_id": asset.assigned_supervisor_id,
    }
    result = await assets_collection.update_one(
        {"_id": ObjectId(asset_id)},
        {"$set": update_data}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    doc = await assets_collection.find_one({"_id": ObjectId(asset_id)})
    doc["schedule_frequency"] = _normalize_freq_days(doc.get("schedule_frequency"))
    return serialize_doc(doc)


@app.delete("/api/assets/{asset_id}")
async def delete_asset(asset_id: str):
    result = await assets_collection.delete_one({"_id": ObjectId(asset_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"message": "Asset deleted"}


# ============ USERS ============
@app.post("/api/users")
async def create_user(user: UserCreate):
    existing = await users_collection.find_one({"employee_id": user.employee_id})
    if existing:
        raise HTTPException(status_code=400, detail="Employee ID already exists")
    
    import bcrypt
    hashed_password = bcrypt.hashpw(user.password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    
    doc = {
        "employee_id": user.employee_id,
        "name": user.name,
        "role": user.role.value,
        "department_id": user.department_id,
        "assigned_stations": user.assigned_stations,
        "password": hashed_password,
        "email": user.email,
        "phone": user.phone,
        "reports_to_id": user.reports_to_id,
        "is_active": True,
        "created_at": datetime.utcnow()
    }
    result = await users_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    doc.pop("password", None)
    return serialize_doc(doc)


@app.get("/api/users")
async def list_users(role: Optional[str] = None, department_id: Optional[str] = None):
    query = {}
    if role:
        query["role"] = role
    if department_id:
        query["department_id"] = department_id
    docs = await users_collection.find(query).to_list(1000)
    # Batch fetch departments and reports_to users
    dept_ids = list(set(d.get("department_id") for d in docs if d.get("department_id")))
    reports_to_ids = list(set(d.get("reports_to_id") for d in docs if d.get("reports_to_id")))
    
    depts_map = {}
    if dept_ids:
        depts_docs = await departments_collection.find({"_id": {"$in": [ObjectId(did) for did in dept_ids]}}).to_list(1000)
        depts_map = {str(d["_id"]): d["name"] for d in depts_docs}
    
    reports_to_map = {}
    if reports_to_ids:
        reports_to_docs = await users_collection.find({"_id": {"$in": [ObjectId(rid) for rid in reports_to_ids]}}).to_list(1000)
        reports_to_map = {str(u["_id"]): u["name"] for u in reports_to_docs}
    
    for doc in docs:
        doc.pop("password", None)
        doc["department_name"] = depts_map.get(doc.get("department_id", ""), "")
        doc["reports_to_name"] = reports_to_map.get(doc.get("reports_to_id", ""), None)
    return [serialize_doc(d) for d in docs]


@app.get("/api/users/supervisors")
async def list_supervisors_for_assignment(
    station_id: Optional[str] = None,
    department_id: Optional[str] = None
):
    """Get active supervisors for asset assignment"""
    query = {
        "role": {"$in": [UserRole.SUPERVISOR.value, UserRole.APPROVING_SUPERVISOR.value]},
        "is_active": True
    }
    if station_id:
        query["assigned_stations"] = station_id
    if department_id:
        query["department_id"] = department_id
    
    docs = await users_collection.find(query).to_list(1000)
    for doc in docs:
        doc.pop("password", None)
    return [serialize_doc(d) for d in docs]


@app.get("/api/users/supervisors")
async def list_supervisors_for_assignment(
    station_id: Optional[str] = None,
    department_id: Optional[str] = None
):
    """Get active supervisors for asset assignment"""
    query = {
        "role": {"$in": [UserRole.SUPERVISOR.value, UserRole.APPROVING_SUPERVISOR.value]},
        "is_active": True
    }
    if station_id:
        query["assigned_stations"] = station_id
    if department_id:
        query["department_id"] = department_id
    
    docs = await users_collection.find(query).to_list(1000)
    for doc in docs:
        doc.pop("password", None)
    return [serialize_doc(d) for d in docs]


@app.get("/api/users/station-staff")
async def get_station_wise_staff():
    """Get station-wise view of all staff (Supervisors, Reporting Officers, Approving Supervisors)"""
    stations = await stations_collection.find({}).to_list(1000)
    users = await users_collection.find({"role": {"$in": ["supervisor", "reporting_officer", "approving_supervisor"]}}).to_list(1000)
    
    # Build station-wise staff map
    station_staff = []
    for station in stations:
        station_id = str(station["_id"])
        
        # Find approving supervisor for this station
        approving_supervisor = None
        if station.get("approving_supervisor_id"):
            approving_supervisor = next((u for u in users if str(u["_id"]) == station["approving_supervisor_id"]), None)
        
        # Find supervisors assigned to this station
        supervisors = [u for u in users if u["role"] == "supervisor" and station_id in u.get("assigned_stations", [])]
        
        # Find reporting officers for this station's department (through supervisors)
        ro_ids = set(s.get("reports_to_id") for s in supervisors if s.get("reports_to_id"))
        reporting_officers = [u for u in users if str(u["_id"]) in ro_ids]
        
        station_staff.append({
            "station_id": station_id,
            "station_name": station["name"],
            "approving_supervisor": serialize_doc(approving_supervisor) if approving_supervisor else None,
            "supervisors": [serialize_doc(s) for s in supervisors],
            "reporting_officers": [serialize_doc(ro) for ro in reporting_officers]
        })
    
    return station_staff


@app.get("/api/users/{user_id}")
async def get_user(user_id: str):
    doc = await users_collection.find_one({"_id": ObjectId(user_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")
    doc.pop("password", None)
    return serialize_doc(doc)


@app.put("/api/users/{user_id}")
async def update_user(user_id: str, user: UserCreate):
    update_data = {
        "name": user.name,
        "role": user.role.value,
        "department_id": user.department_id,
        "assigned_stations": user.assigned_stations,
        "email": user.email,
        "phone": user.phone,
        "reports_to_id": user.reports_to_id
    }
    if user.password:
        import bcrypt
        update_data["password"] = bcrypt.hashpw(user.password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    
    result = await users_collection.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": update_data}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    doc = await users_collection.find_one({"_id": ObjectId(user_id)})
    doc.pop("password", None)
    return serialize_doc(doc)


@app.delete("/api/users/{user_id}")
async def delete_user(user_id: str):
    result = await users_collection.delete_one({"_id": ObjectId(user_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User deleted"}


@app.post("/api/users/link-supervisors")
async def link_supervisors_to_reporting_officer(payload: dict):
    """Link multiple supervisors to a reporting officer"""
    reporting_officer_id = payload.get("reporting_officer_id")
    supervisor_ids = payload.get("supervisor_ids", [])
    
    if not reporting_officer_id or not supervisor_ids:
        raise HTTPException(status_code=400, detail="Missing reporting_officer_id or supervisor_ids")
    
    # Verify reporting officer exists
    ro = await users_collection.find_one({"_id": ObjectId(reporting_officer_id)})
    if not ro or ro["role"] != "reporting_officer":
        raise HTTPException(status_code=400, detail="Invalid reporting officer")
    
    # Update all supervisors
    result = await users_collection.update_many(
        {"_id": {"$in": [ObjectId(sid) for sid in supervisor_ids]}},
        {"$set": {"reports_to_id": reporting_officer_id}}
    )
    
    return {"message": f"{result.modified_count} supervisors linked", "modified_count": result.modified_count}


# ============ AUTH ============
@app.post("/api/auth/login")
async def login(credentials: UserLogin):
    import bcrypt
    import jwt
    
    user = await users_collection.find_one({"employee_id": credentials.employee_id})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not bcrypt.checkpw(credentials.password.encode('utf-8'), user["password"].encode('utf-8')):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="Account is deactivated")
    
    token_data = {
        "user_id": str(user["_id"]),
        "employee_id": user["employee_id"],
        "role": user["role"],
        "exp": datetime.utcnow() + timedelta(hours=24)
    }
    token = jwt.encode(token_data, os.environ.get("JWT_SECRET", "railway-secret-key"), algorithm="HS256")
    
    user_data = serialize_doc(user)
    user_data.pop("password", None)
    
    return {"token": token, "user": user_data}


@app.get("/api/auth/me")
async def get_current_user(token: str = Query(...)):
    import jwt
    try:
        payload = jwt.decode(token, os.environ.get("JWT_SECRET", "railway-secret-key"), algorithms=["HS256"])
        user = await users_collection.find_one({"_id": ObjectId(payload["user_id"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user.pop("password", None)
        return serialize_doc(user)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ============ FILE UPLOAD ============
@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    file_extension = os.path.splitext(file.filename)[1] if file.filename else ".jpg"
    unique_filename = f"{uuid.uuid4()}{file_extension}"
    file_path = os.path.join(UPLOAD_DIR, unique_filename)
    
    with open(file_path, "wb") as buffer:
        content = await file.read()
        buffer.write(content)
    
    file_url = f"/api/uploads/{unique_filename}"
    return {"url": file_url, "filename": unique_filename}


@app.post("/api/upload/multiple")
async def upload_multiple_files(files: List[UploadFile] = File(...)):
    urls = []
    for file in files:
        file_extension = os.path.splitext(file.filename)[1] if file.filename else ".jpg"
        unique_filename = f"{uuid.uuid4()}{file_extension}"
        file_path = os.path.join(UPLOAD_DIR, unique_filename)
        
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
        
        urls.append(f"/api/uploads/{unique_filename}")
    
    return {"urls": urls}


# ============ INSPECTIONS ============
@app.post("/api/inspections")
async def create_inspection(inspection: InspectionCreate):
    """Submit an inspection. Each item is stored with approval_status='pending_approval';
    no asset state changes are applied until an Approving Supervisor (or Superadmin) marks
    each item Pass or Fail."""
    inspector = await users_collection.find_one({"_id": ObjectId(inspection.inspector_id)})
    if not inspector:
        raise HTTPException(status_code=404, detail="Inspector not found")

    items_data = []
    for item in inspection.items:
        item_dict = item.model_dump()
        item_dict["approval_status"] = "pending_approval"
        item_dict["reviewed_by"] = None
        item_dict["reviewed_at"] = None
        item_dict["reviewer_remarks"] = None
        items_data.append(item_dict)

    # Resolve participant names for SIG
    participants_data = []
    if inspection.inspection_type == "sig" and inspection.participants:
        for emp_id in inspection.participants:
            participant = await users_collection.find_one({"employee_id": emp_id})
            if participant:
                participants_data.append({
                    "employee_id": emp_id,
                    "name": participant["name"],
                    "role": participant["role"]
                })
            else:
                participants_data.append({"employee_id": emp_id, "name": "Unknown", "role": "unknown"})

    doc = {
        "inspection_type": inspection.inspection_type.value,
        "station_id": inspection.station_id,
        "inspector_id": inspection.inspector_id,
        "inspector_name": inspector["name"],
        "items": items_data,
        "participants": participants_data,
        "overall_remarks": inspection.overall_remarks,
        "inspection_at": inspection.inspection_at or datetime.utcnow().isoformat(),
        "created_at": datetime.utcnow()
    }
    result = await inspections_collection.insert_one(doc)
    inspection_id = str(result.inserted_id)

    # Notify approvers (Approving Supervisor for the station + Admins/Superadmins) that
    # there are inspection items awaiting their review.
    station_doc = await stations_collection.find_one({"_id": ObjectId(inspection.station_id)})
    station_name = station_doc.get("name") if station_doc else "Unknown station"
    asup_id = station_doc.get("approving_supervisor_id") if station_doc else None

    notify_user_ids = set()
    if asup_id:
        notify_user_ids.add(asup_id)
    admins = await users_collection.find({
        "role": {"$in": [UserRole.ADMIN.value, UserRole.SUPERADMIN.value]},
        "is_active": True,
    }).to_list(50)
    for a in admins:
        notify_user_ids.add(str(a["_id"]))
    notify_user_ids.discard(inspection.inspector_id)

    for uid in notify_user_ids:
        await notifications_collection.insert_one({
            "user_id": uid,
            "title": "Inspection Awaiting Approval",
            "message": f"{len(items_data)} item(s) submitted by {inspector['name']} at {station_name} require Pass/Fail review.",
            "notification_type": "info",
            "related_entity_type": "inspection",
            "related_entity_id": inspection_id,
            "is_read": False,
            "created_at": datetime.utcnow()
        })

    # Audit log
    await audit_log_collection.insert_one({
        "entity_type": "inspection",
        "entity_id": inspection_id,
        "action": "submitted",
        "performed_by": inspection.inspector_id,
        "details": {"item_count": len(items_data), "station_id": inspection.station_id},
        "created_at": datetime.utcnow()
    })

    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


# ===== Approval helpers =====
async def _apply_inspection_item_effects(inspection_doc: dict, item: dict, reviewer_id: str):
    """Apply the asset/orange-list state changes that the inspection item represents.
    Called when an item is approved (Pass)."""
    asset_id = item["asset_id"]
    inspection_id = str(inspection_doc["_id"])
    inspector_id = inspection_doc["inspector_id"]
    item_status = item.get("status")

    if item_status in (InspectionItemStatus.NOT_OK.value, InspectionItemStatus.NEEDS_REPAIR.value):
        # Mark asset defective and add to orange list (if not already)
        defective_since = item.get("defective_since")
        if defective_since:
            try:
                defective_since_dt = datetime.fromisoformat(
                    defective_since.replace('Z', '+00:00').replace('+00:00', '')
                )
            except (ValueError, AttributeError):
                defective_since_dt = datetime.utcnow()
        else:
            defective_since_dt = datetime.utcnow()

        await assets_collection.update_one(
            {"_id": ObjectId(asset_id)},
            {"$set": {
                "status": AssetStatus.DEFECTIVE.value,
                "defective_since": defective_since_dt,
            }}
        )

        existing = await orange_list_collection.find_one({
            "asset_id": asset_id,
            "status": {"$ne": OrangeListStatus.RESOLVED.value}
        })
        if not existing:
            await orange_list_collection.insert_one({
                "asset_id": asset_id,
                "inspection_id": inspection_id,
                "reported_by": inspector_id,
                "status": OrangeListStatus.DEFECTIVE.value,
                "defective_since": defective_since_dt,
                "remarks": "Marked defective during inspection (approved)",
                "marked_working_by": None,
                "marked_working_at": None,
                "approved_by": None,
                "approved_at": None,
                "created_at": datetime.utcnow()
            })

        # Notify supervisors / ROs / ASUPs (existing behavior)
        asset = await assets_collection.find_one({"_id": ObjectId(asset_id)})
        if asset:
            asset_type = await asset_types_collection.find_one({"_id": ObjectId(asset["asset_type_id"])})
            dept_id = asset_type["department_id"] if asset_type else None
            station_id = asset["station_id"]
            targets = []
            if dept_id:
                targets += await users_collection.find({
                    "role": UserRole.SUPERVISOR.value, "department_id": dept_id, "assigned_stations": station_id
                }).to_list(100)
                targets += await users_collection.find({
                    "role": UserRole.REPORTING_OFFICER.value, "department_id": dept_id, "assigned_stations": station_id
                }).to_list(100)
            seen = set()
            for t in targets:
                tid = str(t["_id"])
                if tid in seen or tid == inspector_id:
                    continue
                seen.add(tid)
                await notifications_collection.insert_one({
                    "user_id": tid,
                    "title": "Asset Marked Defective",
                    "message": f"Asset {asset.get('asset_number','Unknown')} ({asset_type['name'] if asset_type else 'Unknown'}) marked defective since {defective_since_dt.strftime('%d-%b-%Y %H:%M')}.",
                    "notification_type": "alert",
                    "related_entity_type": "orange_list",
                    "related_entity_id": asset_id,
                    "is_read": False,
                    "created_at": datetime.utcnow()
                })

    # Update last_inspected and next_due (only on Pass)
    now_ts = datetime.utcnow()
    update_fields = {"last_inspected": now_ts}
    asset_doc = await assets_collection.find_one({"_id": ObjectId(asset_id)})
    if asset_doc:
        freq_days = _normalize_freq_days(asset_doc.get("schedule_frequency"))
        if freq_days and freq_days > 0:
            update_fields["next_due"] = now_ts + timedelta(days=freq_days)
    await assets_collection.update_one({"_id": ObjectId(asset_id)}, {"$set": update_fields})

    await audit_log_collection.insert_one({
        "entity_type": "inspection_item",
        "entity_id": f"{inspection_id}:{asset_id}",
        "action": "approved",
        "performed_by": reviewer_id,
        "details": {"inspection_id": inspection_id, "asset_id": asset_id, "item_status": item_status},
        "created_at": datetime.utcnow()
    })


async def _can_review_inspection(reviewer: dict, inspection_doc: dict) -> bool:
    """Allowed reviewers: Superadmin, Admin, or the Approving Supervisor for the station."""
    if not reviewer:
        return False
    role = reviewer.get("role")
    if role in (UserRole.SUPERADMIN.value, UserRole.ADMIN.value):
        return True
    if role == UserRole.APPROVING_SUPERVISOR.value:
        station_id = inspection_doc.get("station_id")
        if station_id:
            station = await stations_collection.find_one({"_id": ObjectId(station_id)})
            if station and station.get("approving_supervisor_id") == str(reviewer["_id"]):
                return True
    return False


@app.post("/api/inspections/{inspection_id}/items/{item_index}/approve")
async def approve_inspection_item(inspection_id: str, item_index: int, payload: dict):
    """Mark a single inspection item as Pass. Body: {reviewer_id, remarks?}."""
    reviewer_id = payload.get("reviewer_id")
    remarks = payload.get("remarks")
    if not reviewer_id:
        raise HTTPException(status_code=400, detail="reviewer_id is required")
    try:
        insp = await inspections_collection.find_one({"_id": ObjectId(inspection_id)})
        reviewer = await users_collection.find_one({"_id": ObjectId(reviewer_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid id format")
    if not insp:
        raise HTTPException(status_code=404, detail="Inspection not found")
    if not reviewer:
        raise HTTPException(status_code=404, detail="Reviewer not found")
    if not await _can_review_inspection(reviewer, insp):
        raise HTTPException(status_code=403, detail="You are not authorized to review this inspection")
    items = insp.get("items", [])
    if item_index < 0 or item_index >= len(items):
        raise HTTPException(status_code=404, detail="Item index out of range")
    item = items[item_index]
    if item.get("approval_status") != "pending_approval":
        raise HTTPException(status_code=400, detail=f"Item already {item.get('approval_status')}")

    # Apply effects then mark item approved
    await _apply_inspection_item_effects(insp, item, reviewer_id)
    items[item_index]["approval_status"] = "approved"
    items[item_index]["reviewed_by"] = reviewer_id
    items[item_index]["reviewed_at"] = datetime.utcnow()
    items[item_index]["reviewer_remarks"] = remarks
    await inspections_collection.update_one(
        {"_id": ObjectId(inspection_id)},
        {"$set": {"items": items}}
    )

    # Notify the original inspector
    await notifications_collection.insert_one({
        "user_id": insp["inspector_id"],
        "title": "Inspection Item Approved",
        "message": f"Your inspection item for asset {item.get('asset_id')} was approved by {reviewer['name']}.",
        "notification_type": "info",
        "related_entity_type": "inspection",
        "related_entity_id": inspection_id,
        "is_read": False,
        "created_at": datetime.utcnow()
    })

    return {"message": "Item approved", "inspection_id": inspection_id, "item_index": item_index}


@app.post("/api/inspections/{inspection_id}/items/{item_index}/reject")
async def reject_inspection_item(inspection_id: str, item_index: int, payload: dict):
    """Mark a single inspection item as Fail. Body: {reviewer_id, remarks?}.
    Asset state is NOT changed; if the asset was already defective, its original
    defective_since is preserved. The gap between submission and rejection is logged."""
    reviewer_id = payload.get("reviewer_id")
    remarks = payload.get("remarks")
    if not reviewer_id:
        raise HTTPException(status_code=400, detail="reviewer_id is required")
    try:
        insp = await inspections_collection.find_one({"_id": ObjectId(inspection_id)})
        reviewer = await users_collection.find_one({"_id": ObjectId(reviewer_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid id format")
    if not insp:
        raise HTTPException(status_code=404, detail="Inspection not found")
    if not reviewer:
        raise HTTPException(status_code=404, detail="Reviewer not found")
    if not await _can_review_inspection(reviewer, insp):
        raise HTTPException(status_code=403, detail="You are not authorized to review this inspection")
    items = insp.get("items", [])
    if item_index < 0 or item_index >= len(items):
        raise HTTPException(status_code=404, detail="Item index out of range")
    item = items[item_index]
    if item.get("approval_status") != "pending_approval":
        raise HTTPException(status_code=400, detail=f"Item already {item.get('approval_status')}")

    submission_time = insp.get("created_at") or datetime.utcnow()
    rejection_time = datetime.utcnow()
    gap_seconds = max(0, int((rejection_time - submission_time).total_seconds()))

    items[item_index]["approval_status"] = "rejected"
    items[item_index]["reviewed_by"] = reviewer_id
    items[item_index]["reviewed_at"] = rejection_time
    items[item_index]["reviewer_remarks"] = remarks
    items[item_index]["gap_seconds"] = gap_seconds
    await inspections_collection.update_one(
        {"_id": ObjectId(inspection_id)},
        {"$set": {"items": items}}
    )

    # Audit log captures the gap-time
    await audit_log_collection.insert_one({
        "entity_type": "inspection_item",
        "entity_id": f"{inspection_id}:{item.get('asset_id')}",
        "action": "rejected",
        "performed_by": reviewer_id,
        "details": {
            "inspection_id": inspection_id,
            "asset_id": item.get("asset_id"),
            "item_status": item.get("status"),
            "submitted_at": submission_time.isoformat() if hasattr(submission_time, 'isoformat') else str(submission_time),
            "rejected_at": rejection_time.isoformat(),
            "gap_seconds": gap_seconds,
            "reviewer_remarks": remarks,
        },
        "created_at": rejection_time
    })

    # Notify the original inspector
    await notifications_collection.insert_one({
        "user_id": insp["inspector_id"],
        "title": "Inspection Item Rejected",
        "message": f"Your inspection item for asset {item.get('asset_id')} was rejected by {reviewer['name']}. Re-inspect the asset.",
        "notification_type": "alert",
        "related_entity_type": "inspection",
        "related_entity_id": inspection_id,
        "is_read": False,
        "created_at": datetime.utcnow()
    })

    return {
        "message": "Item rejected",
        "inspection_id": inspection_id,
        "item_index": item_index,
        "gap_seconds": gap_seconds,
    }


@app.get("/api/inspections/pending-approvals")
async def list_pending_approvals(reviewer_id: str = Query(...)):
    """Return inspection items pending Pass/Fail for this reviewer.
    - Approving Supervisor: items at stations where they are the assigned ASUP.
    - Superadmin / Admin: all pending items.
    """
    try:
        reviewer = await users_collection.find_one({"_id": ObjectId(reviewer_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid reviewer_id")
    if not reviewer:
        raise HTTPException(status_code=404, detail="Reviewer not found")

    role = reviewer.get("role")
    station_filter = None
    if role == UserRole.APPROVING_SUPERVISOR.value:
        stations = await stations_collection.find(
            {"approving_supervisor_id": reviewer_id}
        ).to_list(1000)
        station_ids = [str(s["_id"]) for s in stations]
        if not station_ids:
            return {"reviewer_id": reviewer_id, "total_items": 0, "inspections": []}
        station_filter = {"$in": station_ids}
    elif role not in (UserRole.SUPERADMIN.value, UserRole.ADMIN.value):
        raise HTTPException(status_code=403, detail="Not authorized to review inspections")

    query = {"items.approval_status": "pending_approval"}
    if station_filter is not None:
        query["station_id"] = station_filter

    insps = await inspections_collection.find(query).sort("created_at", -1).to_list(500)

    # Pre-fetch related lookups
    asset_ids = list({it["asset_id"] for d in insps for it in d.get("items", []) if it.get("asset_id")})
    assets_map = {}
    if asset_ids:
        ad = await assets_collection.find({"_id": {"$in": [ObjectId(a) for a in asset_ids]}}).to_list(1000)
        assets_map = {str(a["_id"]): a for a in ad}
    type_ids = list({a.get("asset_type_id") for a in assets_map.values() if a.get("asset_type_id")})
    types_map = {}
    if type_ids:
        td = await asset_types_collection.find({"_id": {"$in": [ObjectId(t) for t in type_ids]}}).to_list(1000)
        types_map = {str(t["_id"]): t["name"] for t in td}
    station_ids_all = list({d.get("station_id") for d in insps if d.get("station_id")})
    stations_map = {}
    if station_ids_all:
        sd = await stations_collection.find({"_id": {"$in": [ObjectId(s) for s in station_ids_all]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in sd}

    out_inspections = []
    total_items = 0
    for d in insps:
        pending_items = []
        for idx, it in enumerate(d.get("items", [])):
            if it.get("approval_status") == "pending_approval":
                asset = assets_map.get(it.get("asset_id"))
                pending_items.append({
                    "item_index": idx,
                    "asset_id": it.get("asset_id"),
                    "asset_number": asset.get("asset_number") if asset else None,
                    "asset_type_name": types_map.get(asset.get("asset_type_id")) if asset else None,
                    "status": it.get("status"),
                    "remarks": it.get("remarks"),
                    "remarks_by": it.get("remarks_by"),
                    "photo_urls": it.get("photo_urls", []),
                    "defective_since": it.get("defective_since"),
                    "rectified_on": it.get("rectified_on"),
                    "checklist_responses": it.get("checklist_responses", []),
                })
        if not pending_items:
            continue
        total_items += len(pending_items)
        out_inspections.append({
            "inspection_id": str(d["_id"]),
            "inspection_type": d.get("inspection_type"),
            "station_id": d.get("station_id"),
            "station_name": stations_map.get(d.get("station_id"), "Unknown"),
            "inspector_id": d.get("inspector_id"),
            "inspector_name": d.get("inspector_name"),
            "submitted_at": d.get("created_at").isoformat() if d.get("created_at") else None,
            "overall_remarks": d.get("overall_remarks"),
            "pending_items": pending_items,
        })

    return {"reviewer_id": reviewer_id, "total_items": total_items, "inspections": out_inspections}


@app.get("/api/inspections")
async def list_inspections(
    station_id: Optional[str] = None,
    inspector_id: Optional[str] = None,
    inspection_type: Optional[str] = None,
    limit: int = 50
):
    query = {}
    if station_id:
        query["station_id"] = station_id
    if inspector_id:
        query["inspector_id"] = inspector_id
    if inspection_type:
        query["inspection_type"] = inspection_type
    
    docs = await inspections_collection.find(query).sort("created_at", -1).to_list(limit)
    
    # Batch fetch stations
    station_ids = list(set(d["station_id"] for d in docs if d.get("station_id")))
    stations_map = {}
    if station_ids:
        stations_docs = await stations_collection.find({"_id": {"$in": [ObjectId(sid) for sid in station_ids]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in stations_docs}
    for doc in docs:
        doc["station_name"] = stations_map.get(doc["station_id"], "Unknown")
    
    return [serialize_doc(d) for d in docs]


@app.get("/api/inspections/{inspection_id}")
async def get_inspection(inspection_id: str):
    doc = await inspections_collection.find_one({"_id": ObjectId(inspection_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Inspection not found")
    station = await stations_collection.find_one({"_id": ObjectId(doc["station_id"])})
    doc["station_name"] = station["name"] if station else "Unknown"
    return serialize_doc(doc)


@app.get("/api/assets/{asset_id}/inspections")
async def get_asset_inspections(asset_id: str, limit: int = 50):
    """Get inspection history for a specific asset"""
    # Find all inspections that include this asset
    inspections = await inspections_collection.find(
        {"items.asset_id": asset_id}
    ).sort("created_at", -1).to_list(limit)
    
    # Enrich with station names
    station_ids = list(set(i["station_id"] for i in inspections if i.get("station_id")))
    stations_map = {}
    if station_ids:
        stations_docs = await stations_collection.find({"_id": {"$in": [ObjectId(sid) for sid in station_ids]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in stations_docs}
    
    # Filter items to only show this asset's inspection data
    for insp in inspections:
        insp["station_name"] = stations_map.get(insp["station_id"], "Unknown")
        insp["items"] = [item for item in insp.get("items", []) if item.get("asset_id") == asset_id]
    
    return [serialize_doc(i) for i in inspections]


@app.get("/api/users/{user_id}/inspections")
async def get_user_inspections(user_id: str, limit: int = 50):
    """Get inspection history for a specific user (supervisor/inspector)"""
    inspections = await inspections_collection.find(
        {"inspector_id": user_id}
    ).sort("created_at", -1).to_list(limit)
    
    station_ids = list(set(i["station_id"] for i in inspections if i.get("station_id")))
    stations_map = {}
    if station_ids:
        stations_docs = await stations_collection.find({"_id": {"$in": [ObjectId(sid) for sid in station_ids]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in stations_docs}
    
    for insp in inspections:
        insp["station_name"] = stations_map.get(insp["station_id"], "Unknown")
    
    return [serialize_doc(i) for i in inspections]


# ============ ORANGE LIST / RED LIST ============
# Change 4: Orange List < 24hrs, Red List > 24hrs
@app.get("/api/orange-list")
async def list_orange_items(
    status: Optional[str] = None,
    station_id: Optional[str] = None,
    department_id: Optional[str] = None,
    list_type: Optional[str] = None  # "orange", "red", or None for all
):
    query = {}
    if status:
        query["status"] = status
    else:
        query["status"] = {"$ne": OrangeListStatus.RESOLVED.value}
    
    docs = await orange_list_collection.find(query).sort("created_at", -1).to_list(1000)
    
    now = datetime.utcnow()
    
    # Batch fetch all related data to avoid N+1 queries
    asset_ids = list(set(doc["asset_id"] for doc in docs if doc.get("asset_id")))
    reporter_ids = list(set(doc["reported_by"] for doc in docs if doc.get("reported_by")))
    
    # Fetch all assets in one query
    assets_map = {}
    if asset_ids:
        assets_docs = await assets_collection.find({"_id": {"$in": [ObjectId(aid) for aid in asset_ids]}}).to_list(5000)
        assets_map = {str(a["_id"]): a for a in assets_docs}
    
    # Collect type/station/location IDs from assets
    type_ids = list(set(a["asset_type_id"] for a in assets_map.values() if a.get("asset_type_id")))
    s_ids = list(set(a["station_id"] for a in assets_map.values() if a.get("station_id")))
    loc_ids = list(set(a["location_id"] for a in assets_map.values() if a.get("location_id")))
    
    # Batch fetch asset types, stations, locations, reporters
    types_map = {}
    if type_ids:
        types_docs = await asset_types_collection.find({"_id": {"$in": [ObjectId(tid) for tid in type_ids]}}).to_list(1000)
        types_map = {str(t["_id"]): t for t in types_docs}
    
    stations_map = {}
    if s_ids:
        stations_docs = await stations_collection.find({"_id": {"$in": [ObjectId(sid) for sid in s_ids]}}).to_list(1000)
        stations_map = {str(s["_id"]): s for s in stations_docs}
    
    locations_map = {}
    if loc_ids:
        locs_docs = await locations_collection.find({"_id": {"$in": [ObjectId(lid) for lid in loc_ids]}}).to_list(1000)
        locations_map = {str(l["_id"]): l for l in locs_docs}
    
    reporters_map = {}
    if reporter_ids:
        reporters_docs = await users_collection.find({"_id": {"$in": [ObjectId(rid) for rid in reporter_ids]}}).to_list(1000)
        reporters_map = {str(r["_id"]): r for r in reporters_docs}
    
    enriched = []
    
    for doc in docs:
        asset = assets_map.get(doc["asset_id"])
        if not asset:
            continue
        if station_id and asset["station_id"] != station_id:
            continue
        
        asset_type = types_map.get(asset.get("asset_type_id", ""))
        if department_id and asset_type and asset_type["department_id"] != department_id:
            continue
        
        station = stations_map.get(asset.get("station_id", ""))
        location = locations_map.get(asset.get("location_id", ""))
        
        # Calculate duration and classify as orange/red
        defective_since = doc.get("defective_since") or doc.get("created_at")
        if isinstance(defective_since, str):
            try:
                defective_since = datetime.fromisoformat(defective_since)
            except ValueError:
                defective_since = doc.get("created_at", now)
        
        hours_defective = (now - defective_since).total_seconds() / 3600 if defective_since else 0
        is_red = hours_defective > 24
        item_list_type = "red" if is_red else "orange"
        
        # Filter by list_type if specified
        if list_type and list_type != item_list_type:
            continue
        
        doc["asset_info"] = {
            "asset_number": asset.get("asset_number"),
            "asset_type_name": asset_type["name"] if asset_type else "Unknown",
            "station_name": station["name"] if station else "Unknown",
            "station_id": asset["station_id"],
            "location_name": location["name"] if location else "Unknown",
            "location_id": asset["location_id"],
            "department_id": asset_type["department_id"] if asset_type else None
        }
        doc["list_type"] = item_list_type
        doc["hours_defective"] = round(hours_defective, 1)
        doc["defective_since"] = defective_since.isoformat() if defective_since else None
        
        # Get reporter name from batch-fetched map
        reporter = reporters_map.get(doc.get("reported_by", ""))
        doc["reporter_name"] = reporter["name"] if reporter else "Unknown"
        
        enriched.append(serialize_doc(doc))
    
    return enriched


@app.post("/api/orange-list/{item_id}/mark-working")
async def mark_working(item_id: str, request: MarkWorkingRequest):
    item = await orange_list_collection.find_one({"_id": ObjectId(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Orange list item not found")
    
    if item["status"] != OrangeListStatus.DEFECTIVE.value:
        raise HTTPException(status_code=400, detail="Item is not in defective status")
    
    await orange_list_collection.update_one(
        {"_id": ObjectId(item_id)},
        {"$set": {
            "status": OrangeListStatus.PENDING_APPROVAL.value,
            "marked_working_by": request.marked_by,
            "marked_working_at": datetime.utcnow(),
            "working_remarks": request.remarks
        }}
    )
    
    await assets_collection.update_one(
        {"_id": ObjectId(item["asset_id"])},
        {"$set": {"status": AssetStatus.PENDING_APPROVAL.value}}
    )
    
    await audit_log_collection.insert_one({
        "entity_type": "orange_list",
        "entity_id": item_id,
        "action": "marked_working",
        "performed_by": request.marked_by,
        "details": {"remarks": request.remarks},
        "created_at": datetime.utcnow()
    })
    
    updated = await orange_list_collection.find_one({"_id": ObjectId(item_id)})
    return serialize_doc(updated)


@app.post("/api/orange-list/{item_id}/approve")
async def approve_working(item_id: str, request: ApproveWorkingRequest):
    item = await orange_list_collection.find_one({"_id": ObjectId(item_id)})
    if not item:
        raise HTTPException(status_code=404, detail="Orange list item not found")
    
    if item["status"] != OrangeListStatus.PENDING_APPROVAL.value:
        raise HTTPException(status_code=400, detail="Item is not pending approval")
    
    approver = await users_collection.find_one({"_id": ObjectId(request.approved_by)})
    if not approver or approver["role"] not in [UserRole.APPROVING_SUPERVISOR.value, UserRole.ADMIN.value, UserRole.SUPERADMIN.value]:
        raise HTTPException(status_code=403, detail="Only approving supervisors, admins, or superadmins can approve")
    
    await orange_list_collection.update_one(
        {"_id": ObjectId(item_id)},
        {"$set": {
            "status": OrangeListStatus.RESOLVED.value,
            "approved_by": request.approved_by,
            "approved_at": datetime.utcnow(),
            "approval_remarks": request.remarks
        }}
    )
    
    await assets_collection.update_one(
        {"_id": ObjectId(item["asset_id"])},
        {"$set": {"status": AssetStatus.WORKING.value, "defective_since": None}}
    )
    
    await audit_log_collection.insert_one({
        "entity_type": "orange_list",
        "entity_id": item_id,
        "action": "approved_working",
        "performed_by": request.approved_by,
        "details": {"remarks": request.remarks},
        "created_at": datetime.utcnow()
    })
    
    updated = await orange_list_collection.find_one({"_id": ObjectId(item_id)})
    return serialize_doc(updated)


# Change 4: Export Orange/Red List as Excel
@app.get("/api/orange-list/export/excel")
async def export_orange_list_excel(list_type: Optional[str] = None):
    import openpyxl
    
    items = await list_orange_items(list_type=list_type)
    
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Defective Assets"
    
    # Headers
    headers = ["Asset Number", "Asset Type", "Station", "Location", "Status", "List Type", 
               "Defective Since", "Hours Defective", "Reported By", "Remarks"]
    ws.append(headers)
    
    for item in items:
        ws.append([
            item.get("asset_info", {}).get("asset_number", ""),
            item.get("asset_info", {}).get("asset_type_name", ""),
            item.get("asset_info", {}).get("station_name", ""),
            item.get("asset_info", {}).get("location_name", ""),
            item.get("status", ""),
            item.get("list_type", "").upper(),
            item.get("defective_since", ""),
            item.get("hours_defective", 0),
            item.get("reporter_name", ""),
            item.get("remarks", "")
        ])
    
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    
    filename = f"defective_assets_{list_type or 'all'}_{datetime.utcnow().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# Change 4: Export Orange/Red List as PDF
@app.get("/api/orange-list/export/pdf")
async def export_orange_list_pdf(list_type: Optional[str] = None):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet
    
    items = await list_orange_items(list_type=list_type)
    
    output = io.BytesIO()
    doc = SimpleDocTemplate(output, pagesize=landscape(A4))
    elements = []
    styles = getSampleStyleSheet()
    
    # Title
    title = f"{'Red' if list_type == 'red' else 'Orange' if list_type == 'orange' else 'Defective'} List Report - {datetime.utcnow().strftime('%d %b %Y')}"
    elements.append(Paragraph(title, styles['Title']))
    elements.append(Spacer(1, 20))
    
    # Table data
    data = [["Asset No.", "Type", "Station", "Location", "List", "Defective Since", "Hours", "Reporter"]]
    for item in items:
        data.append([
            item.get("asset_info", {}).get("asset_number", ""),
            item.get("asset_info", {}).get("asset_type_name", ""),
            item.get("asset_info", {}).get("station_name", ""),
            item.get("asset_info", {}).get("location_name", ""),
            item.get("list_type", "").upper(),
            item.get("defective_since", "")[:16] if item.get("defective_since") else "",
            str(item.get("hours_defective", 0)),
            item.get("reporter_name", "")
        ])
    
    if len(data) > 1:
        table = Table(data)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0e7c6b')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f5f5f5')]),
        ]))
        elements.append(table)
    else:
        elements.append(Paragraph("No defective assets found.", styles['Normal']))
    
    doc.build(elements)
    output.seek(0)
    
    filename = f"defective_assets_{list_type or 'all'}_{datetime.utcnow().strftime('%Y%m%d_%H%M')}.pdf"
    return StreamingResponse(
        output,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# ============ NOTIFICATIONS ============
@app.get("/api/notifications")
async def list_notifications(user_id: str, unread_only: bool = False):
    query = {"user_id": user_id}
    if unread_only:
        query["is_read"] = False
    docs = await notifications_collection.find(query).sort("created_at", -1).to_list(100)
    return [serialize_doc(d) for d in docs]


@app.post("/api/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str):
    result = await notifications_collection.update_one(
        {"_id": ObjectId(notification_id)},
        {"$set": {"is_read": True}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"message": "Notification marked as read"}


@app.post("/api/notifications/mark-all-read")
async def mark_all_notifications_read(user_id: str = Query(...)):
    await notifications_collection.update_many(
        {"user_id": user_id, "is_read": False},
        {"$set": {"is_read": True}}
    )
    return {"message": "All notifications marked as read"}


@app.get("/api/notifications/unread-count")
async def get_unread_count(user_id: str = Query(...)):
    count = await notifications_collection.count_documents({"user_id": user_id, "is_read": False})
    return {"count": count}


# ============ SCHEDULES ============
@app.post("/api/schedules")
async def create_schedule(schedule: ScheduleCreate):
    asset = await assets_collection.find_one({"_id": ObjectId(schedule.asset_id)})
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    
    now = datetime.utcnow()
    next_due = calculate_next_due(now, schedule.frequency)
    
    await schedules_collection.update_one(
        {"asset_id": schedule.asset_id},
        {"$set": {
            "asset_id": schedule.asset_id,
            "frequency": schedule.frequency.value,
            "set_by": schedule.set_by,
            "next_due": next_due,
            "last_inspected": asset.get("last_inspected"),
            "created_at": now
        }},
        upsert=True
    )
    
    await assets_collection.update_one(
        {"_id": ObjectId(schedule.asset_id)},
        {"$set": {"schedule_frequency": schedule.frequency.value, "next_due": next_due}}
    )
    
    return {"message": "Schedule set", "next_due": next_due.isoformat()}


@app.get("/api/schedules")
async def list_schedules(overdue_only: bool = False):
    query = {}
    if overdue_only:
        query["next_due"] = {"$lt": datetime.utcnow()}
    
    docs = await schedules_collection.find(query).to_list(1000)
    
    for doc in docs:
        asset = await assets_collection.find_one({"_id": ObjectId(doc["asset_id"])})
        if asset:
            asset_type = await asset_types_collection.find_one({"_id": ObjectId(asset["asset_type_id"])})
            station = await stations_collection.find_one({"_id": ObjectId(asset["station_id"])})
            doc["asset_info"] = {
                "asset_number": asset.get("asset_number"),
                "asset_type_name": asset_type["name"] if asset_type else "Unknown",
                "station_name": station["name"] if station else "Unknown"
            }
        doc["is_overdue"] = doc.get("next_due", datetime.utcnow()) < datetime.utcnow() if doc.get("next_due") else False
    
    return [serialize_doc(d) for d in docs]


@app.get("/api/schedules/due-today")
async def get_due_today(user_id: Optional[str] = None):
    today_end = datetime.utcnow().replace(hour=23, minute=59, second=59)
    
    query = {"next_due": {"$lte": today_end}}
    docs = await schedules_collection.find(query).to_list(1000)
    
    results = []
    for doc in docs:
        asset = await assets_collection.find_one({"_id": ObjectId(doc["asset_id"])})
        if asset:
            if user_id:
                user = await users_collection.find_one({"_id": ObjectId(user_id)})
                if user and user.get("role") not in ["superadmin", "admin"] and asset["station_id"] not in user.get("assigned_stations", []):
                    continue
            
            asset_type = await asset_types_collection.find_one({"_id": ObjectId(asset["asset_type_id"])})
            station = await stations_collection.find_one({"_id": ObjectId(asset["station_id"])})
            location = await locations_collection.find_one({"_id": ObjectId(asset["location_id"])})
            doc["asset_info"] = {
                "asset_id": str(asset["_id"]),
                "asset_number": asset.get("asset_number"),
                "asset_type_name": asset_type["name"] if asset_type else "Unknown",
                "station_name": station["name"] if station else "Unknown",
                "location_name": location["name"] if location else "Unknown"
            }
            doc["is_overdue"] = doc.get("next_due", datetime.utcnow()) < datetime.utcnow()
            results.append(serialize_doc(doc))
    
    return results


# ============ SUPERVISOR SCHEDULE (asset-frequency-based) ============
@app.get("/api/schedules/supervisor/{user_id}")
async def get_supervisor_schedule(
    user_id: str,
    from_date: Optional[str] = None,  # ISO date "YYYY-MM-DD"
    to_date: Optional[str] = None,
):
    """Compute upcoming inspection tasks for a supervisor based on assigned assets'
    schedule_frequency (in days). Default range: today \u2192 today+7.
    Returns tasks grouped by asset type."""
    user = await users_collection.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Parse / default the date range
    try:
        if from_date:
            range_start = datetime.strptime(from_date, "%Y-%m-%d")
        else:
            today = datetime.utcnow()
            range_start = datetime(today.year, today.month, today.day)
        if to_date:
            range_end = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
        else:
            range_end = range_start + timedelta(days=7)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format; use YYYY-MM-DD")

    if range_end < range_start:
        raise HTTPException(status_code=400, detail="to_date must be on or after from_date")

    # Find all assets assigned to this supervisor with a frequency set
    asset_query = {
        "assigned_supervisor_id": user_id,
        "schedule_frequency": {"$ne": None}
    }
    assets = await assets_collection.find(asset_query).to_list(2000)

    # Pre-fetch related data
    type_ids = list({a.get("asset_type_id") for a in assets if a.get("asset_type_id")})
    station_ids = list({a.get("station_id") for a in assets if a.get("station_id")})
    location_ids = list({a.get("location_id") for a in assets if a.get("location_id")})

    types_map = {}
    if type_ids:
        types_docs = await asset_types_collection.find({"_id": {"$in": [ObjectId(t) for t in type_ids]}}).to_list(1000)
        types_map = {str(t["_id"]): {"name": t["name"], "department_id": t.get("department_id")} for t in types_docs}
    stations_map = {}
    if station_ids:
        s_docs = await stations_collection.find({"_id": {"$in": [ObjectId(s) for s in station_ids]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in s_docs}
    locations_map = {}
    if location_ids:
        l_docs = await locations_collection.find({"_id": {"$in": [ObjectId(lid) for lid in location_ids]}}).to_list(1000)
        locations_map = {str(loc["_id"]): loc["name"] for loc in l_docs}

    now = datetime.utcnow()
    grouped: dict = {}

    for asset in assets:
        freq_days = _normalize_freq_days(asset.get("schedule_frequency"))
        if not freq_days or freq_days <= 0:
            continue

        # Determine first inspection date in (or before) the range
        last_inspected = asset.get("last_inspected")
        if last_inspected:
            next_due = last_inspected + timedelta(days=freq_days)
        else:
            # Never inspected -> due immediately (use creation or now)
            next_due = asset.get("created_at") or now

        # Walk forward by frequency, collecting due dates within the range
        due_dates = []
        max_iters = 200  # safety cap
        iters = 0
        while next_due <= range_end and iters < max_iters:
            if next_due >= range_start:
                due_dates.append(next_due)
            next_due = next_due + timedelta(days=freq_days)
            iters += 1

        if not due_dates:
            continue

        type_id = asset.get("asset_type_id")
        type_info = types_map.get(type_id, {"name": "Unknown", "department_id": None})
        type_name = type_info["name"]
        if type_id not in grouped:
            grouped[type_id] = {
                "asset_type_id": type_id,
                "asset_type_name": type_name,
                "department_id": type_info.get("department_id"),
                "tasks": []
            }
        for d in due_dates:
            days_left = (d.date() - now.date()).days
            grouped[type_id]["tasks"].append({
                "asset_id": str(asset["_id"]),
                "asset_number": asset.get("asset_number"),
                "station_id": asset.get("station_id"),
                "station_name": stations_map.get(asset.get("station_id"), "Unknown"),
                "location_id": asset.get("location_id"),
                "location_name": locations_map.get(asset.get("location_id"), "Unknown"),
                "due_date": d.isoformat(),
                "days_left": days_left,  # negative => overdue
                "is_overdue": d < now,
                "frequency_days": freq_days,
                "asset_status": asset.get("status", "working"),
            })

    # Sort tasks within each group by due date
    groups = list(grouped.values())
    for g in groups:
        g["tasks"].sort(key=lambda t: t["due_date"])
        g["task_count"] = len(g["tasks"])
    groups.sort(key=lambda g: g["asset_type_name"])

    return {
        "user_id": user_id,
        "user_name": user.get("name"),
        "department_id": user.get("department_id"),
        "from_date": range_start.date().isoformat(),
        "to_date": range_end.date().isoformat(),
        "total_tasks": sum(g["task_count"] for g in groups),
        "groups": groups,
    }


@app.get("/api/schedules/admin")
async def get_admin_schedule(
    station_ids: Optional[List[str]] = Query(None),
    department_ids: Optional[List[str]] = Query(None),
    asset_type_ids: Optional[List[str]] = Query(None),
    supervisor_ids: Optional[List[str]] = Query(None),
    reporting_officer_ids: Optional[List[str]] = Query(None),
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
):
    """Multi-filter schedule view for Superadmin / Admin / Reporting Officer.
    All filters are optional; when omitted, no filter is applied for that dimension.
    Returns tasks grouped by asset type, with supervisor info on each task."""
    # Parse date range
    try:
        if from_date:
            range_start = datetime.strptime(from_date, "%Y-%m-%d")
        else:
            today = datetime.utcnow()
            range_start = datetime(today.year, today.month, today.day)
        if to_date:
            range_end = datetime.strptime(to_date, "%Y-%m-%d").replace(hour=23, minute=59, second=59)
        else:
            range_end = range_start + timedelta(days=7)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format; use YYYY-MM-DD")
    if range_end < range_start:
        raise HTTPException(status_code=400, detail="to_date must be on or after from_date")

    # If reporting_officer_ids passed, expand to supervisor_ids who report to them
    expanded_supervisor_ids = list(supervisor_ids) if supervisor_ids else None
    if reporting_officer_ids:
        ro_supervisors = await users_collection.find({
            "role": UserRole.SUPERVISOR.value,
            "reports_to_id": {"$in": reporting_officer_ids}
        }).to_list(1000)
        ro_sup_ids = [str(s["_id"]) for s in ro_supervisors]
        if expanded_supervisor_ids is None:
            expanded_supervisor_ids = ro_sup_ids
        else:
            # Intersect when both filters are provided
            expanded_supervisor_ids = list(set(expanded_supervisor_ids).intersection(ro_sup_ids))

    # If department_ids passed, expand to asset_type_ids in those departments
    expanded_type_ids = list(asset_type_ids) if asset_type_ids else None
    if department_ids:
        dept_types = await asset_types_collection.find({
            "department_id": {"$in": department_ids}
        }).to_list(1000)
        dept_type_ids = [str(t["_id"]) for t in dept_types]
        if expanded_type_ids is None:
            expanded_type_ids = dept_type_ids
        else:
            expanded_type_ids = list(set(expanded_type_ids).intersection(dept_type_ids))

    # Build asset query
    asset_query: dict = {"schedule_frequency": {"$ne": None}}
    if station_ids:
        asset_query["station_id"] = {"$in": station_ids}
    if expanded_type_ids is not None:
        if not expanded_type_ids:
            return {"from_date": range_start.date().isoformat(), "to_date": range_end.date().isoformat(),
                    "total_tasks": 0, "groups": []}
        asset_query["asset_type_id"] = {"$in": expanded_type_ids}
    if expanded_supervisor_ids is not None:
        if not expanded_supervisor_ids:
            return {"from_date": range_start.date().isoformat(), "to_date": range_end.date().isoformat(),
                    "total_tasks": 0, "groups": []}
        asset_query["assigned_supervisor_id"] = {"$in": expanded_supervisor_ids}

    assets = await assets_collection.find(asset_query).to_list(5000)

    # Pre-fetch lookup data
    type_ids_set = list({a.get("asset_type_id") for a in assets if a.get("asset_type_id")})
    station_ids_set = list({a.get("station_id") for a in assets if a.get("station_id")})
    location_ids_set = list({a.get("location_id") for a in assets if a.get("location_id")})
    sup_ids_set = list({a.get("assigned_supervisor_id") for a in assets if a.get("assigned_supervisor_id")})

    types_map = {}
    if type_ids_set:
        td = await asset_types_collection.find({"_id": {"$in": [ObjectId(t) for t in type_ids_set]}}).to_list(1000)
        types_map = {str(t["_id"]): {"name": t["name"], "department_id": t.get("department_id")} for t in td}
    stations_map = {}
    if station_ids_set:
        sd = await stations_collection.find({"_id": {"$in": [ObjectId(s) for s in station_ids_set]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in sd}
    locations_map = {}
    if location_ids_set:
        ld = await locations_collection.find({"_id": {"$in": [ObjectId(l) for l in location_ids_set]}}).to_list(1000)
        locations_map = {str(loc["_id"]): loc["name"] for loc in ld}
    sups_map = {}
    if sup_ids_set:
        ud = await users_collection.find({"_id": {"$in": [ObjectId(u) for u in sup_ids_set]}}).to_list(1000)
        sups_map = {str(u["_id"]): {"name": u.get("name"), "employee_id": u.get("employee_id")} for u in ud}

    now = datetime.utcnow()
    grouped: dict = {}
    for asset in assets:
        freq_days = _normalize_freq_days(asset.get("schedule_frequency"))
        if not freq_days or freq_days <= 0:
            continue
        last_inspected = asset.get("last_inspected")
        next_due = (last_inspected + timedelta(days=freq_days)) if last_inspected else (asset.get("created_at") or now)
        due_dates = []
        max_iters = 200
        iters = 0
        while next_due <= range_end and iters < max_iters:
            if next_due >= range_start:
                due_dates.append(next_due)
            next_due = next_due + timedelta(days=freq_days)
            iters += 1
        if not due_dates:
            continue
        type_id = asset.get("asset_type_id")
        type_info = types_map.get(type_id, {"name": "Unknown", "department_id": None})
        if type_id not in grouped:
            grouped[type_id] = {
                "asset_type_id": type_id,
                "asset_type_name": type_info["name"],
                "department_id": type_info.get("department_id"),
                "tasks": [],
            }
        sup_info = sups_map.get(asset.get("assigned_supervisor_id"), None)
        for d in due_dates:
            grouped[type_id]["tasks"].append({
                "asset_id": str(asset["_id"]),
                "asset_number": asset.get("asset_number"),
                "station_id": asset.get("station_id"),
                "station_name": stations_map.get(asset.get("station_id"), "Unknown"),
                "location_id": asset.get("location_id"),
                "location_name": locations_map.get(asset.get("location_id"), "Unknown"),
                "supervisor_id": asset.get("assigned_supervisor_id"),
                "supervisor_name": sup_info["name"] if sup_info else None,
                "supervisor_employee_id": sup_info["employee_id"] if sup_info else None,
                "due_date": d.isoformat(),
                "days_left": (d.date() - now.date()).days,
                "is_overdue": d < now,
                "frequency_days": freq_days,
                "asset_status": asset.get("status", "working"),
            })

    groups = list(grouped.values())
    for g in groups:
        g["tasks"].sort(key=lambda t: t["due_date"])
        g["task_count"] = len(g["tasks"])
    groups.sort(key=lambda g: g["asset_type_name"])

    return {
        "from_date": range_start.date().isoformat(),
        "to_date": range_end.date().isoformat(),
        "filters_applied": {
            "stations": station_ids or [],
            "departments": department_ids or [],
            "asset_types": asset_type_ids or [],
            "supervisors": supervisor_ids or [],
            "reporting_officers": reporting_officer_ids or [],
        },
        "total_tasks": sum(g["task_count"] for g in groups),
        "groups": groups,
    }


@app.get("/api/schedules/approving-supervisor/{user_id}/supervisors")
async def get_supervisors_under_approving(user_id: str):
    """Return the list of supervisors that work at any station assigned to this
    approving supervisor. Used to render the schedule overview for an approving sup."""
    asup = await users_collection.find_one({"_id": ObjectId(user_id)})
    if not asup:
        raise HTTPException(status_code=404, detail="User not found")
    asup_stations = asup.get("assigned_stations", []) or []
    if not asup_stations:
        return {"approving_supervisor_id": user_id, "supervisors": []}

    # Find supervisors with overlap in assigned_stations
    sup_docs = await users_collection.find({
        "role": UserRole.SUPERVISOR.value,
        "is_active": True,
        "assigned_stations": {"$in": asup_stations}
    }).to_list(1000)

    # For each supervisor, count assigned assets (with frequency set) for context
    results = []
    for s in sup_docs:
        sid = str(s["_id"])
        assigned_count = await assets_collection.count_documents({"assigned_supervisor_id": sid})
        scheduled_count = await assets_collection.count_documents({
            "assigned_supervisor_id": sid,
            "schedule_frequency": {"$ne": None}
        })
        # Department name
        dept_name = None
        if s.get("department_id"):
            dept = await departments_collection.find_one({"_id": ObjectId(s["department_id"])})
            dept_name = dept["name"] if dept else None
        # Stations overlap (only the ones shared with the approving sup)
        shared_stations = [st for st in (s.get("assigned_stations") or []) if st in asup_stations]
        results.append({
            "_id": sid,
            "employee_id": s.get("employee_id"),
            "name": s.get("name"),
            "department_id": s.get("department_id"),
            "department_name": dept_name,
            "assigned_stations": shared_stations,
            "assigned_assets_count": assigned_count,
            "scheduled_assets_count": scheduled_count,
        })
    results.sort(key=lambda r: r["name"] or "")
    return {"approving_supervisor_id": user_id, "supervisors": results}


@app.post("/api/admin/transfer-supervisor")
async def transfer_supervisor(payload: dict):
    """Bulk-reassign every asset from `from_supervisor_id` to `to_supervisor_id`.
    Used when a supervisor is transferred or retires.
    Body: {from_supervisor_id: str, to_supervisor_id: Optional[str]}.
    If to_supervisor_id is None or empty, the assets become unassigned."""
    from_id = payload.get("from_supervisor_id")
    to_id = payload.get("to_supervisor_id") or None
    if not from_id:
        raise HTTPException(status_code=400, detail="from_supervisor_id is required")

    try:
        from_user = await users_collection.find_one({"_id": ObjectId(from_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid from_supervisor_id")
    if not from_user:
        raise HTTPException(status_code=404, detail="Source supervisor not found")
    if to_id:
        try:
            to_user = await users_collection.find_one({"_id": ObjectId(to_id)})
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid to_supervisor_id")
        if not to_user:
            raise HTTPException(status_code=404, detail="Target supervisor not found")

    result = await assets_collection.update_many(
        {"assigned_supervisor_id": from_id},
        {"$set": {"assigned_supervisor_id": to_id}}
    )

    # Audit log
    await audit_log_collection.insert_one({
        "entity_type": "assets",
        "entity_id": None,
        "action": "transfer_supervisor",
        "performed_by": None,
        "details": {
            "from_supervisor_id": from_id,
            "to_supervisor_id": to_id,
            "assets_updated": result.modified_count,
        },
        "created_at": datetime.utcnow()
    })

    return {
        "message": "Reassignment complete",
        "from_supervisor_id": from_id,
        "to_supervisor_id": to_id,
        "assets_updated": result.modified_count,
    }


# ============ DASHBOARD ============
# Change 6: Enhanced dashboard with station-wise and asset-wise data
@app.get("/api/dashboard/stats")
async def get_dashboard_stats():
    total_assets = await assets_collection.count_documents({})
    working_assets = await assets_collection.count_documents({"status": AssetStatus.WORKING.value})
    defective_assets = await assets_collection.count_documents({"status": {"$ne": AssetStatus.WORKING.value}})
    
    now = datetime.utcnow()
    
    # Orange list (< 24 hrs) and Red list (> 24 hrs)
    all_defective = await orange_list_collection.find({"status": {"$ne": OrangeListStatus.RESOLVED.value}}).to_list(5000)
    orange_count = 0
    red_count = 0
    for item in all_defective:
        defective_since = item.get("defective_since") or item.get("created_at")
        if isinstance(defective_since, datetime):
            hours = (now - defective_since).total_seconds() / 3600
        else:
            hours = 0
        if hours > 24:
            red_count += 1
        else:
            orange_count += 1
    
    pending_approvals = await orange_list_collection.count_documents({"status": OrangeListStatus.PENDING_APPROVAL.value})
    total_inspections = await inspections_collection.count_documents({})
    overdue_count = await schedules_collection.count_documents({"next_due": {"$lt": now}})
    total_users = await users_collection.count_documents({})
    total_stations = await stations_collection.count_documents({})
    
    return {
        "total_assets": total_assets,
        "working_assets": working_assets,
        "defective_assets": defective_assets,
        "orange_list_count": orange_count,
        "red_list_count": red_count,
        "pending_approvals": pending_approvals,
        "total_inspections": total_inspections,
        "overdue_count": overdue_count,
        "total_users": total_users,
        "total_stations": total_stations
    }


# Change 6: Station-wise health data for charts
@app.get("/api/dashboard/station-health")
async def get_station_health():
    stations = await stations_collection.find().to_list(1000)
    result = []
    for station in stations:
        station_id = str(station["_id"])
        total = await assets_collection.count_documents({"station_id": station_id})
        working = await assets_collection.count_documents({"station_id": station_id, "status": "working"})
        defective = total - working
        result.append({
            "station_name": station["name"],
            "station_id": station_id,
            "total": total,
            "working": working,
            "defective": defective,
            "health_pct": round((working / total * 100) if total > 0 else 100, 1)
        })
    return result


# Change 6: Asset type health data for charts
@app.get("/api/dashboard/asset-type-health")
async def get_asset_type_health():
    asset_types = await asset_types_collection.find().to_list(1000)
    result = []
    for at in asset_types:
        at_id = str(at["_id"])
        total = await assets_collection.count_documents({"asset_type_id": at_id})
        working = await assets_collection.count_documents({"asset_type_id": at_id, "status": "working"})
        defective = total - working
        result.append({
            "asset_type_name": at["name"],
            "asset_type_id": at_id,
            "total": total,
            "working": working,
            "defective": defective,
            "health_pct": round((working / total * 100) if total > 0 else 100, 1)
        })
    return result


@app.get("/api/dashboard/recent-inspections")
async def get_recent_inspections(limit: int = 10):
    docs = await inspections_collection.find().sort("created_at", -1).to_list(limit)
    station_ids = list(set(d["station_id"] for d in docs if d.get("station_id")))
    stations_map = {}
    if station_ids:
        stations_docs = await stations_collection.find({"_id": {"$in": [ObjectId(sid) for sid in station_ids]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in stations_docs}
    for doc in docs:
        doc["station_name"] = stations_map.get(doc["station_id"], "Unknown")
    return [serialize_doc(d) for d in docs]


# ============ AUDIT LOG ============
@app.get("/api/audit-log")
async def get_audit_log(entity_type: Optional[str] = None, entity_id: Optional[str] = None, limit: int = 50):
    query = {}
    if entity_type:
        query["entity_type"] = entity_type
    if entity_id:
        query["entity_id"] = entity_id
    docs = await audit_log_collection.find(query).sort("created_at", -1).to_list(limit)
    return [serialize_doc(d) for d in docs]


# ============ ROLE MANAGEMENT ============
# Change 5: Only Superadmin can grant admin powers (not Admin)
@app.post("/api/users/{user_id}/grant-admin")
async def grant_admin_powers(user_id: str, granted_by: str = Query(...)):
    granter = await users_collection.find_one({"_id": ObjectId(granted_by)})
    if not granter or granter["role"] != UserRole.SUPERADMIN.value:
        raise HTTPException(status_code=403, detail="Only superadmin can grant admin powers")
    
    result = await users_collection.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"role": UserRole.ADMIN.value}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    await audit_log_collection.insert_one({
        "entity_type": "user",
        "entity_id": user_id,
        "action": "granted_admin",
        "performed_by": granted_by,
        "created_at": datetime.utcnow()
    })
    
    return {"message": "Admin powers granted"}


@app.post("/api/users/{user_id}/revoke-admin")
async def revoke_admin_powers(user_id: str, revoked_by: str = Query(...), new_role: str = Query(...)):
    revoker = await users_collection.find_one({"_id": ObjectId(revoked_by)})
    if not revoker or revoker["role"] != UserRole.SUPERADMIN.value:
        raise HTTPException(status_code=403, detail="Only superadmin can revoke admin powers")
    
    if new_role not in [r.value for r in UserRole]:
        raise HTTPException(status_code=400, detail="Invalid role")
    
    result = await users_collection.update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"role": new_role}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {"message": f"Role changed to {new_role}"}


# ============ HELPER FUNCTIONS ============
def calculate_next_due(from_date: datetime, frequency: ScheduleFrequency) -> datetime:
    if frequency == ScheduleFrequency.DAILY:
        return from_date + timedelta(days=1)
    elif frequency == ScheduleFrequency.WEEKLY:
        return from_date + timedelta(weeks=1)
    elif frequency == ScheduleFrequency.MONTHLY:
        return from_date + timedelta(days=30)
    elif frequency == ScheduleFrequency.QUARTERLY:
        return from_date + timedelta(days=90)
    return from_date + timedelta(days=30)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)


# ============ ANALYTICS / PERFORMANCE ============
def _compute_asset_metrics(asset: dict, orange_records: list, now: datetime) -> dict:
    """Compute average repair time and % uptime for a single asset using
    its orange-list history."""
    created_at = asset.get("created_at") or now
    if isinstance(created_at, str):
        try:
            created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00").replace("+00:00", ""))
        except Exception:
            created_at = now

    total_seconds = max(1, int((now - created_at).total_seconds()))
    repair_durations = []
    total_defective = 0

    for rec in orange_records:
        ds = rec.get("defective_since")
        if not ds:
            continue
        if isinstance(ds, str):
            try:
                ds = datetime.fromisoformat(ds.replace("Z", "+00:00").replace("+00:00", ""))
            except Exception:
                continue
        # End of defect window: approved_at > marked_working_at > now
        end = rec.get("approved_at") or rec.get("marked_working_at")
        if isinstance(end, str):
            try:
                end = datetime.fromisoformat(end.replace("Z", "+00:00").replace("+00:00", ""))
            except Exception:
                end = None
        if end and end >= ds:
            dur = int((end - ds).total_seconds())
            repair_durations.append(dur)
            total_defective += dur
        else:
            # Still ongoing
            ongoing = max(0, int((now - ds).total_seconds()))
            total_defective += ongoing

    avg_repair_seconds = int(sum(repair_durations) / len(repair_durations)) if repair_durations else 0
    pct_functional = max(0.0, min(100.0, (1 - total_defective / total_seconds) * 100))
    return {
        "avg_repair_seconds": avg_repair_seconds,
        "avg_repair_hours": round(avg_repair_seconds / 3600, 2),
        "pct_functional": round(pct_functional, 2),
        "defect_count": len(orange_records),
        "current_status": asset.get("status", "working"),
    }


async def _analytics_for_asset_set(asset_docs: list) -> list:
    """Build per-category analytics with nested per-asset metrics for a set of assets."""
    if not asset_docs:
        return []
    now = datetime.utcnow()

    asset_ids = [str(a["_id"]) for a in asset_docs]
    type_ids = list({a.get("asset_type_id") for a in asset_docs if a.get("asset_type_id")})

    # Fetch orange list history for these assets in one query
    history = await orange_list_collection.find({"asset_id": {"$in": asset_ids}}).to_list(10000)
    history_by_asset: dict = {}
    for rec in history:
        history_by_asset.setdefault(rec["asset_id"], []).append(rec)

    types_map = {}
    if type_ids:
        td = await asset_types_collection.find({"_id": {"$in": [ObjectId(t) for t in type_ids]}}).to_list(1000)
        types_map = {str(t["_id"]): t["name"] for t in td}

    # Compute per-asset metrics, group by type
    grouped: dict = {}
    for asset in asset_docs:
        aid = str(asset["_id"])
        type_id = asset.get("asset_type_id") or "unknown"
        type_name = types_map.get(type_id, "Unknown")
        m = _compute_asset_metrics(asset, history_by_asset.get(aid, []), now)
        m.update({
            "asset_id": aid,
            "asset_number": asset.get("asset_number"),
        })
        grouped.setdefault(type_id, {"asset_type_id": type_id, "asset_type_name": type_name, "assets": []})
        grouped[type_id]["assets"].append(m)

    # Aggregate per-category
    result = []
    for type_id, info in grouped.items():
        assets = info["assets"]
        avg_repairs = [a["avg_repair_seconds"] for a in assets if a["avg_repair_seconds"] > 0]
        avg_repair_seconds = int(sum(avg_repairs) / len(avg_repairs)) if avg_repairs else 0
        pct_functionals = [a["pct_functional"] for a in assets]
        avg_pct_functional = round(sum(pct_functionals) / len(pct_functionals), 2) if pct_functionals else 100.0
        defective_count = sum(1 for a in assets if a["current_status"] != "working")
        result.append({
            "asset_type_id": type_id,
            "asset_type_name": info["asset_type_name"],
            "asset_count": len(assets),
            "defective_count": defective_count,
            "working_count": len(assets) - defective_count,
            "avg_repair_seconds": avg_repair_seconds,
            "avg_repair_hours": round(avg_repair_seconds / 3600, 2),
            "pct_functional": avg_pct_functional,
            "assets": assets,
        })

    result.sort(key=lambda r: r["asset_type_name"])
    return result


@app.get("/api/analytics/supervisor/{user_id}")
async def supervisor_analytics(user_id: str):
    """Performance analytics for a supervisor: per-category metrics for assets
    allocated to them, with nested per-asset breakdown."""
    try:
        user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    assets = await assets_collection.find({"assigned_supervisor_id": user_id}).to_list(5000)
    categories = await _analytics_for_asset_set(assets)

    overall_pct = round(sum(c["pct_functional"] * c["asset_count"] for c in categories) / max(1, sum(c["asset_count"] for c in categories)), 2) if categories else 100.0
    return {
        "user_id": user_id,
        "user_name": user.get("name"),
        "total_assets": sum(c["asset_count"] for c in categories),
        "overall_pct_functional": overall_pct,
        "categories": categories,
    }


@app.get("/api/analytics/approving-supervisor/{user_id}/supervisors")
async def approving_supervisor_analytics(user_id: str):
    """For each supervisor under this approving sup, return their per-category analytics."""
    try:
        asup = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not asup:
        raise HTTPException(status_code=404, detail="User not found")

    asup_stations = asup.get("assigned_stations", []) or []
    if not asup_stations:
        return {"approving_supervisor_id": user_id, "supervisors": []}

    sup_docs = await users_collection.find({
        "role": UserRole.SUPERVISOR.value,
        "is_active": True,
        "assigned_stations": {"$in": asup_stations}
    }).to_list(1000)

    out = []
    for s in sup_docs:
        sid = str(s["_id"])
        assets = await assets_collection.find({"assigned_supervisor_id": sid}).to_list(5000)
        categories = await _analytics_for_asset_set(assets)
        # Strip the per-asset list to keep payload manageable; keep aggregates
        slim = [{k: v for k, v in c.items() if k != "assets"} for c in categories]
        # Department name
        dept_name = None
        if s.get("department_id"):
            dept = await departments_collection.find_one({"_id": ObjectId(s["department_id"])})
            dept_name = dept["name"] if dept else None
        out.append({
            "_id": sid,
            "name": s.get("name"),
            "employee_id": s.get("employee_id"),
            "department_name": dept_name,
            "total_assets": sum(c["asset_count"] for c in categories),
            "categories": slim,
        })
    out.sort(key=lambda x: x["name"] or "")
    return {"approving_supervisor_id": user_id, "supervisors": out}


@app.get("/api/analytics/asset/{asset_id}")
async def asset_analytics(asset_id: str):
    """Performance analytics for a single asset."""
    try:
        asset = await assets_collection.find_one({"_id": ObjectId(asset_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid asset_id")
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    history = await orange_list_collection.find({"asset_id": asset_id}).to_list(10000)
    return _compute_asset_metrics(asset, history, datetime.utcnow())


# ============ DASHBOARD (role-scoped) ============
RED_THRESHOLD_HOURS = 24


def _classify_health(asset: dict, now: datetime) -> str:
    """Return 'working', 'orange', or 'red' based on defective duration."""
    if asset.get("status") == "working":
        return "working"
    ds = asset.get("defective_since")
    if not ds:
        return "orange"
    if isinstance(ds, str):
        try:
            ds = datetime.fromisoformat(ds.replace("Z", "+00:00").replace("+00:00", ""))
        except Exception:
            return "orange"
    hours = (now - ds).total_seconds() / 3600
    return "red" if hours > RED_THRESHOLD_HOURS else "orange"


@app.get("/api/dashboard/supervisor/{user_id}")
async def supervisor_dashboard(user_id: str, station_id: Optional[str] = None):
    """Dashboard payload for a supervisor: per-category buttons + health pie data
    scoped to assets allocated to them. Optional station_id filter."""
    try:
        user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    query = {"assigned_supervisor_id": user_id}
    if station_id:
        query["station_id"] = station_id
    assets = await assets_collection.find(query).to_list(5000)

    # Lookups
    type_ids = list({a.get("asset_type_id") for a in assets if a.get("asset_type_id")})
    station_ids_seen = list({a.get("station_id") for a in assets if a.get("station_id")})
    types_map = {}
    if type_ids:
        td = await asset_types_collection.find({"_id": {"$in": [ObjectId(t) for t in type_ids]}}).to_list(1000)
        types_map = {str(t["_id"]): t["name"] for t in td}
    stations_map = {}
    if station_ids_seen:
        sd = await stations_collection.find({"_id": {"$in": [ObjectId(s) for s in station_ids_seen]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in sd}
    department_name = None
    if user.get("department_id"):
        dept = await departments_collection.find_one({"_id": ObjectId(user["department_id"])})
        department_name = dept["name"] if dept else None

    # Build the user's available stations list (for dropdown). Use assigned_stations
    user_stations = []
    user_station_ids = user.get("assigned_stations") or []
    if user_station_ids:
        ud = await stations_collection.find({"_id": {"$in": [ObjectId(s) for s in user_station_ids]}}).to_list(100)
        user_stations = [{"_id": str(s["_id"]), "name": s.get("name")} for s in ud]

    now = datetime.utcnow()
    grouped: dict = {}
    health_counts = {"working": 0, "orange": 0, "red": 0}

    for asset in assets:
        type_id = asset.get("asset_type_id") or "unknown"
        type_name = types_map.get(type_id, "Unknown")
        cls = _classify_health(asset, now)
        health_counts[cls] += 1
        bucket = grouped.setdefault(type_id, {
            "asset_type_id": type_id,
            "asset_type_name": type_name,
            "asset_count": 0,
            "working": 0, "orange": 0, "red": 0,
        })
        bucket["asset_count"] += 1
        bucket[cls] += 1

    categories = sorted(grouped.values(), key=lambda c: c["asset_type_name"])
    return {
        "user_id": user_id,
        "user_name": user.get("name"),
        "department_id": user.get("department_id"),
        "department_name": department_name,
        "available_stations": user_stations,
        "selected_station_id": station_id,
        "total_assets": len(assets),
        "health": health_counts,
        "categories": categories,
    }


@app.get("/api/dashboard/supervisor/{user_id}/my-tasks")
async def supervisor_my_tasks(user_id: str, station_id: Optional[str] = None):
    """Returns asset lists for a supervisor's My Tasks page:
    - my_assets: every allocated asset
    - pending_tasks: assets currently NOT in working condition, grouped by category
    """
    try:
        user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    query = {"assigned_supervisor_id": user_id}
    if station_id:
        query["station_id"] = station_id
    assets = await assets_collection.find(query).to_list(5000)

    type_ids = list({a.get("asset_type_id") for a in assets if a.get("asset_type_id")})
    station_ids_seen = list({a.get("station_id") for a in assets if a.get("station_id")})
    location_ids_seen = list({a.get("location_id") for a in assets if a.get("location_id")})
    types_map = {}
    if type_ids:
        td = await asset_types_collection.find({"_id": {"$in": [ObjectId(t) for t in type_ids]}}).to_list(1000)
        types_map = {str(t["_id"]): t["name"] for t in td}
    stations_map = {}
    if station_ids_seen:
        sd = await stations_collection.find({"_id": {"$in": [ObjectId(s) for s in station_ids_seen]}}).to_list(1000)
        stations_map = {str(s["_id"]): s["name"] for s in sd}
    locations_map = {}
    if location_ids_seen:
        ld = await locations_collection.find({"_id": {"$in": [ObjectId(l) for l in location_ids_seen]}}).to_list(1000)
        locations_map = {str(loc["_id"]): loc["name"] for loc in ld}

    now = datetime.utcnow()
    by_category: dict = {}
    pending_by_category: dict = {}

    for asset in assets:
        type_id = asset.get("asset_type_id") or "unknown"
        type_name = types_map.get(type_id, "Unknown")
        cls = _classify_health(asset, now)
        item = {
            "_id": str(asset["_id"]),
            "asset_number": asset.get("asset_number"),
            "station_name": stations_map.get(asset.get("station_id"), "Unknown"),
            "location_name": locations_map.get(asset.get("location_id"), "Unknown"),
            "status": asset.get("status", "working"),
            "health_class": cls,
            "defective_since": asset.get("defective_since").isoformat() if isinstance(asset.get("defective_since"), datetime) else asset.get("defective_since"),
            "asset_type_id": type_id,
            "asset_type_name": type_name,
        }
        by_category.setdefault(type_id, {"asset_type_id": type_id, "asset_type_name": type_name, "assets": []})["assets"].append(item)
        if cls != "working":
            pending_by_category.setdefault(type_id, {"asset_type_id": type_id, "asset_type_name": type_name, "assets": []})["assets"].append(item)

    by_category_list = sorted(by_category.values(), key=lambda c: c["asset_type_name"])
    pending_list = sorted(pending_by_category.values(), key=lambda c: c["asset_type_name"])
    for c in by_category_list:
        c["asset_count"] = len(c["assets"])
    for c in pending_list:
        c["asset_count"] = len(c["assets"])

    return {
        "user_id": user_id,
        "user_name": user.get("name"),
        "selected_station_id": station_id,
        "my_assets": by_category_list,
        "pending_tasks": pending_list,
        "totals": {
            "total": sum(c["asset_count"] for c in by_category_list),
            "pending": sum(c["asset_count"] for c in pending_list),
        },
    }
