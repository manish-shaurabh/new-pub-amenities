import os
import uuid
import shutil
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
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
        "created_at": datetime.utcnow()
    }
    result = await stations_collection.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@app.get("/api/stations")
async def list_stations():
    docs = await stations_collection.find().to_list(1000)
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
        {"$set": {"name": station.name, "code": station.code, "zone": station.zone, "division": station.division}}
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
    # Verify station exists
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
    # Enrich with station names
    for doc in docs:
        station = await stations_collection.find_one({"_id": ObjectId(doc["station_id"])})
        doc["station_name"] = station["name"] if station else "Unknown"
    return [serialize_doc(d) for d in docs]


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
    for doc in docs:
        dept = await departments_collection.find_one({"_id": ObjectId(doc["department_id"])})
        doc["department_name"] = dept["name"] if dept else "Unknown"
    return [serialize_doc(d) for d in docs]


@app.delete("/api/asset-types/{asset_type_id}")
async def delete_asset_type(asset_type_id: str):
    result = await asset_types_collection.delete_one({"_id": ObjectId(asset_type_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Asset type not found")
    return {"message": "Asset type deleted"}


# ============ ASSETS ============
@app.post("/api/assets")
async def create_asset(asset: AssetCreate):
    # Verify references
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
        "last_inspected": None,
        "next_due": None,
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
    
    # If filtering by department, first get asset types for that department
    if department_id:
        dept_asset_types = await asset_types_collection.find({"department_id": department_id}).to_list(1000)
        type_ids = [str(at["_id"]) for at in dept_asset_types]
        query["asset_type_id"] = {"$in": type_ids}
    
    docs = await assets_collection.find(query).to_list(5000)
    
    # Enrich with names
    for doc in docs:
        asset_type = await asset_types_collection.find_one({"_id": ObjectId(doc["asset_type_id"])})
        station = await stations_collection.find_one({"_id": ObjectId(doc["station_id"])})
        location = await locations_collection.find_one({"_id": ObjectId(doc["location_id"])})
        doc["asset_type_name"] = asset_type["name"] if asset_type else "Unknown"
        doc["station_name"] = station["name"] if station else "Unknown"
        doc["location_name"] = location["name"] if location else "Unknown"
    
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


@app.delete("/api/assets/{asset_id}")
async def delete_asset(asset_id: str):
    result = await assets_collection.delete_one({"_id": ObjectId(asset_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"message": "Asset deleted"}


# ============ USERS ============
@app.post("/api/users")
async def create_user(user: UserCreate):
    # Check if employee_id already exists
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
    for doc in docs:
        doc.pop("password", None)
        if doc.get("department_id"):
            dept = await departments_collection.find_one({"_id": ObjectId(doc["department_id"])})
            doc["department_name"] = dept["name"] if dept else "Unknown"
    return [serialize_doc(d) for d in docs]


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
        "phone": user.phone
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
    # Verify inspector exists
    inspector = await users_collection.find_one({"_id": ObjectId(inspection.inspector_id)})
    if not inspector:
        raise HTTPException(status_code=404, detail="Inspector not found")
    
    # Process items and identify defective assets
    items_data = []
    defective_assets = []
    
    for item in inspection.items:
        item_dict = item.model_dump()
        items_data.append(item_dict)
        
        if item.status in [InspectionItemStatus.NOT_OK, InspectionItemStatus.NEEDS_REPAIR]:
            defective_assets.append(item.asset_id)
    
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
        "created_at": datetime.utcnow()
    }
    result = await inspections_collection.insert_one(doc)
    inspection_id = str(result.inserted_id)
    
    # Handle defective assets - add to Orange List
    for asset_id in defective_assets:
        # Update asset status
        await assets_collection.update_one(
            {"_id": ObjectId(asset_id)},
            {"$set": {"status": AssetStatus.DEFECTIVE.value}}
        )
        
        # Check if already in orange list
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
                "remarks": f"Marked defective during inspection",
                "marked_working_by": None,
                "marked_working_at": None,
                "approved_by": None,
                "approved_at": None,
                "created_at": datetime.utcnow()
            }
            await orange_list_collection.insert_one(orange_doc)
        
        # Notify responsible RO
        asset = await assets_collection.find_one({"_id": ObjectId(asset_id)})
        if asset:
            asset_type = await asset_types_collection.find_one({"_id": ObjectId(asset["asset_type_id"])})
            dept_id = asset_type["department_id"] if asset_type else None
            
            if dept_id:
                # Find ROs for this department + station
                ros = await users_collection.find({
                    "role": UserRole.REPORTING_OFFICER.value,
                    "department_id": dept_id,
                    "assigned_stations": asset["station_id"]
                }).to_list(100)
                
                for ro in ros:
                    notification = {
                        "user_id": str(ro["_id"]),
                        "title": "Asset Marked Defective",
                        "message": f"Asset {asset.get('asset_number', 'Unknown')} at station has been marked defective.",
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
            "details": {"inspection_id": inspection_id},
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
    
    for doc in docs:
        station = await stations_collection.find_one({"_id": ObjectId(doc["station_id"])})
        doc["station_name"] = station["name"] if station else "Unknown"
    
    return [serialize_doc(d) for d in docs]


@app.get("/api/inspections/{inspection_id}")
async def get_inspection(inspection_id: str):
    doc = await inspections_collection.find_one({"_id": ObjectId(inspection_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Inspection not found")
    station = await stations_collection.find_one({"_id": ObjectId(doc["station_id"])})
    doc["station_name"] = station["name"] if station else "Unknown"
    return serialize_doc(doc)


# ============ ORANGE LIST ============
@app.get("/api/orange-list")
async def list_orange_items(
    status: Optional[str] = None,
    station_id: Optional[str] = None,
    department_id: Optional[str] = None
):
    query = {}
    if status:
        query["status"] = status
    else:
        # By default show non-resolved items
        query["status"] = {"$ne": OrangeListStatus.RESOLVED.value}
    
    docs = await orange_list_collection.find(query).sort("created_at", -1).to_list(1000)
    
    enriched = []
    for doc in docs:
        asset = await assets_collection.find_one({"_id": ObjectId(doc["asset_id"])})
        if asset:
            if station_id and asset["station_id"] != station_id:
                continue
            asset_type = await asset_types_collection.find_one({"_id": ObjectId(asset["asset_type_id"])})
            if department_id and asset_type and asset_type["department_id"] != department_id:
                continue
            station = await stations_collection.find_one({"_id": ObjectId(asset["station_id"])})
            location = await locations_collection.find_one({"_id": ObjectId(asset["location_id"])})
            doc["asset_info"] = {
                "asset_number": asset.get("asset_number"),
                "asset_type_name": asset_type["name"] if asset_type else "Unknown",
                "station_name": station["name"] if station else "Unknown",
                "location_name": location["name"] if location else "Unknown",
                "department_id": asset_type["department_id"] if asset_type else None
            }
        
        # Get reporter name
        reporter = await users_collection.find_one({"_id": ObjectId(doc["reported_by"])})
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
    
    # Update asset status
    await assets_collection.update_one(
        {"_id": ObjectId(item["asset_id"])},
        {"$set": {"status": AssetStatus.PENDING_APPROVAL.value}}
    )
    
    # Audit log
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
    
    # Verify approver is an approving supervisor
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
    
    # Update asset status back to working
    await assets_collection.update_one(
        {"_id": ObjectId(item["asset_id"])},
        {"$set": {"status": AssetStatus.WORKING.value}}
    )
    
    # Audit log
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
    # Verify asset exists
    asset = await assets_collection.find_one({"_id": ObjectId(schedule.asset_id)})
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    
    # Calculate next due date
    now = datetime.utcnow()
    next_due = calculate_next_due(now, schedule.frequency)
    
    # Upsert schedule
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
    
    # Also update asset's schedule_frequency
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
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    
    query = {"next_due": {"$lte": today_end}}
    docs = await schedules_collection.find(query).to_list(1000)
    
    results = []
    for doc in docs:
        asset = await assets_collection.find_one({"_id": ObjectId(doc["asset_id"])})
        if asset:
            # If user_id filter, check if asset is in user's assigned stations
            if user_id:
                user = await users_collection.find_one({"_id": ObjectId(user_id)})
                if user and asset["station_id"] not in user.get("assigned_stations", []):
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
@app.get("/api/dashboard/stats")
async def get_dashboard_stats():
    total_assets = await assets_collection.count_documents({})
    working_assets = await assets_collection.count_documents({"status": AssetStatus.WORKING.value})
    defective_assets = await assets_collection.count_documents({"status": {"$ne": AssetStatus.WORKING.value}})
    
    orange_list_count = await orange_list_collection.count_documents({"status": {"$ne": OrangeListStatus.RESOLVED.value}})
    pending_approvals = await orange_list_collection.count_documents({"status": OrangeListStatus.PENDING_APPROVAL.value})
    
    total_inspections = await inspections_collection.count_documents({})
    
    # Overdue schedules
    overdue_count = await schedules_collection.count_documents({"next_due": {"$lt": datetime.utcnow()}})
    
    total_users = await users_collection.count_documents({})
    total_stations = await stations_collection.count_documents({})
    
    return {
        "total_assets": total_assets,
        "working_assets": working_assets,
        "defective_assets": defective_assets,
        "orange_list_count": orange_list_count,
        "pending_approvals": pending_approvals,
        "total_inspections": total_inspections,
        "overdue_count": overdue_count,
        "total_users": total_users,
        "total_stations": total_stations
    }


@app.get("/api/dashboard/recent-inspections")
async def get_recent_inspections(limit: int = 10):
    docs = await inspections_collection.find().sort("created_at", -1).to_list(limit)
    for doc in docs:
        station = await stations_collection.find_one({"_id": ObjectId(doc["station_id"])})
        doc["station_name"] = station["name"] if station else "Unknown"
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
@app.post("/api/users/{user_id}/grant-admin")
async def grant_admin_powers(user_id: str, granted_by: str = Query(...)):
    # Verify granter is superadmin
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
    # Verify revoker is superadmin
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
