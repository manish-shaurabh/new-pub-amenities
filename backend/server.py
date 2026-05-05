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
        "schedule_frequency": asset.schedule_frequency.value if asset.schedule_frequency else None,
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
        "schedule_frequency": asset.schedule_frequency.value if asset.schedule_frequency else None,
        "assigned_supervisor_id": asset.assigned_supervisor_id,
    }
    result = await assets_collection.update_one(
        {"_id": ObjectId(asset_id)},
        {"$set": update_data}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    doc = await assets_collection.find_one({"_id": ObjectId(asset_id)})
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
    inspector = await users_collection.find_one({"_id": ObjectId(inspection.inspector_id)})
    if not inspector:
        raise HTTPException(status_code=404, detail="Inspector not found")
    
    items_data = []
    defective_assets = []
    
    for item in inspection.items:
        item_dict = item.model_dump()
        items_data.append(item_dict)
        
        if item.status in [InspectionItemStatus.NOT_OK, InspectionItemStatus.NEEDS_REPAIR]:
            defective_assets.append({
                "asset_id": item.asset_id,
                "defective_since": item.defective_since  # Change 2: date/time from user
            })
    
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
    
    # Handle defective assets - add to Orange/Red List
    for defect_info in defective_assets:
        asset_id = defect_info["asset_id"]
        defective_since = defect_info.get("defective_since")
        
        # Parse defective_since or use current time
        if defective_since:
            try:
                defective_since_dt = datetime.fromisoformat(defective_since.replace('Z', '+00:00').replace('+00:00', ''))
            except (ValueError, AttributeError):
                defective_since_dt = datetime.utcnow()
        else:
            defective_since_dt = datetime.utcnow()
        
        # Update asset status and defective_since
        await assets_collection.update_one(
            {"_id": ObjectId(asset_id)},
            {"$set": {
                "status": AssetStatus.DEFECTIVE.value,
                "defective_since": defective_since_dt
            }}
        )
        
        # Check if already in orange/red list
        existing_orange = await orange_list_collection.find_one({
            "asset_id": asset_id,
            "status": {"$ne": OrangeListStatus.RESOLVED.value}
        })
        
        if not existing_orange:
            orange_doc = {
                "asset_id": asset_id,
                "inspection_id": inspection_id,
                "reported_by": inspection.inspector_id,
                "status": OrangeListStatus.DEFECTIVE.value,
                "defective_since": defective_since_dt,
                "remarks": "Marked defective during inspection",
                "marked_working_by": None,
                "marked_working_at": None,
                "approved_by": None,
                "approved_at": None,
                "created_at": datetime.utcnow()
            }
            await orange_list_collection.insert_one(orange_doc)
        
        # Change 1: TARGETED NOTIFICATIONS - only to assigned supervisor/RO/approving supervisor for this asset
        asset = await assets_collection.find_one({"_id": ObjectId(asset_id)})
        if asset:
            asset_type = await asset_types_collection.find_one({"_id": ObjectId(asset["asset_type_id"])})
            dept_id = asset_type["department_id"] if asset_type else None
            asset_station_id = asset["station_id"]
            
            # Find users to notify:
            # 1. Supervisors assigned to this station AND this department
            # 2. ROs assigned to this station AND this department
            # 3. Approving Supervisors assigned to this station
            # 4. All Admins and Superadmins
            
            notification_targets = []
            
            if dept_id:
                # Supervisors for this dept + station
                supervisors = await users_collection.find({
                    "role": UserRole.SUPERVISOR.value,
                    "department_id": dept_id,
                    "assigned_stations": asset_station_id
                }).to_list(100)
                notification_targets.extend(supervisors)
                
                # ROs for this dept + station
                ros = await users_collection.find({
                    "role": UserRole.REPORTING_OFFICER.value,
                    "department_id": dept_id,
                    "assigned_stations": asset_station_id
                }).to_list(100)
                notification_targets.extend(ros)
            
            # Approving Supervisors for this station
            approving_sups = await users_collection.find({
                "role": UserRole.APPROVING_SUPERVISOR.value,
                "assigned_stations": asset_station_id
            }).to_list(100)
            notification_targets.extend(approving_sups)
            
            # All Admins and Superadmins get all notifications
            admins = await users_collection.find({
                "role": {"$in": [UserRole.ADMIN.value, UserRole.SUPERADMIN.value]}
            }).to_list(100)
            notification_targets.extend(admins)
            
            # Remove duplicates and exclude the inspector themselves
            notified_ids = set()
            for target in notification_targets:
                target_id = str(target["_id"])
                if target_id != inspection.inspector_id and target_id not in notified_ids:
                    notified_ids.add(target_id)
                    notification = {
                        "user_id": target_id,
                        "title": "Asset Marked Defective",
                        "message": f"Asset {asset.get('asset_number', 'Unknown')} ({asset_type['name'] if asset_type else 'Unknown'}) at station has been marked defective since {defective_since_dt.strftime('%d-%b-%Y %H:%M')}.",
                        "notification_type": "alert",
                        "related_entity_type": "orange_list",
                        "related_entity_id": asset_id,
                        "is_read": False,
                        "created_at": datetime.utcnow()
                    }
                    await notifications_collection.insert_one(notification)
        
        # Audit log
        await audit_log_collection.insert_one({
            "entity_type": "asset",
            "entity_id": asset_id,
            "action": "marked_defective",
            "performed_by": inspection.inspector_id,
            "details": {"inspection_id": inspection_id, "defective_since": defective_since_dt.isoformat()},
            "created_at": datetime.utcnow()
        })
    
    # Update last_inspected for all inspected assets
    for item in inspection.items:
        await assets_collection.update_one(
            {"_id": ObjectId(item.asset_id)},
            {"$set": {"last_inspected": datetime.utcnow()}}
        )
    
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


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
