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


# ============ USERS ============
async def _check_supervisor_station_dept_conflict(
    role: str, dept_id: Optional[str], assigned_stations: list, exclude_user_id: Optional[str] = None
):
    """Raise 409 if another active Supervisor already covers the same (station, dept) pair."""
    if role != UserRole.SUPERVISOR.value or not dept_id or not assigned_stations:
        return
    for sid in assigned_stations:
        conflict_query = {
            "role": UserRole.SUPERVISOR.value,
            "department_id": dept_id,
            "assigned_stations": sid,
            "is_active": True,
        }
        if exclude_user_id:
            conflict_query["_id"] = {"$ne": ObjectId(exclude_user_id)}
        conflict = await users_collection.find_one(conflict_query)
        if conflict:
            station = await stations_collection.find_one({"_id": ObjectId(sid)})
            dept = await departments_collection.find_one({"_id": ObjectId(dept_id)})
            sname = station["name"] if station else sid
            dname = dept["name"] if dept else dept_id
            raise HTTPException(
                status_code=409,
                detail=f"Station '{sname}' already has a Supervisor for Dept '{dname}': {conflict.get('name')}"
            )


@router.post("/api/users")
async def create_user(user: UserCreate):
    existing = await users_collection.find_one({"employee_id": user.employee_id})
    if existing:
        raise HTTPException(status_code=400, detail="Employee ID already exists")

    await _check_supervisor_station_dept_conflict(
        user.role.value, user.department_id, user.assigned_stations
    )

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


@router.get("/api/users")
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


@router.get("/api/users/supervisors")
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


@router.get("/api/users/station-staff")
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


@router.get("/api/users/{user_id}")
async def get_user(user_id: str):
    doc = await users_collection.find_one({"_id": ObjectId(user_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="User not found")
    doc.pop("password", None)
    return serialize_doc(doc)


@router.put("/api/users/{user_id}")
async def update_user(user_id: str, user: UserCreate):
    await _check_supervisor_station_dept_conflict(
        user.role.value, user.department_id, user.assigned_stations, exclude_user_id=user_id
    )
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


@router.delete("/api/users/{user_id}")
async def delete_user(user_id: str):
    result = await users_collection.delete_one({"_id": ObjectId(user_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User deleted"}


@router.post("/api/users/link-supervisors")
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
