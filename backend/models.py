from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


# Enums
class UserRole(str, Enum):
    SUPERADMIN = "superadmin"
    ADMIN = "admin"
    REPORTING_OFFICER = "reporting_officer"
    APPROVING_SUPERVISOR = "approving_supervisor"
    SUPERVISOR = "supervisor"


class AssetStatus(str, Enum):
    WORKING = "working"
    DEFECTIVE = "defective"
    PENDING_APPROVAL = "pending_approval"


class InspectionType(str, Enum):
    INDIVIDUAL = "individual"
    SIG = "sig"  # Station Inspection Group


class InspectionItemStatus(str, Enum):
    OK = "ok"
    NOT_OK = "not_ok"
    NEEDS_REPAIR = "needs_repair"


class ScheduleFrequency(str, Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"


class OrangeListStatus(str, Enum):
    DEFECTIVE = "defective"
    PENDING_APPROVAL = "pending_approval"
    RESOLVED = "resolved"


# Department
class DepartmentCreate(BaseModel):
    name: str
    code: str
    description: Optional[str] = None


class DepartmentResponse(BaseModel):
    id: str
    name: str
    code: str
    description: Optional[str] = None
    created_at: str


# Station
class StationCreate(BaseModel):
    name: str
    code: str
    zone: Optional[str] = None
    division: Optional[str] = None
    approving_supervisor_id: Optional[str] = None  # NEW: Each station has one Approving Supervisor


class StationResponse(BaseModel):
    id: str
    name: str
    code: str
    zone: Optional[str] = None
    division: Optional[str] = None
    approving_supervisor_id: Optional[str] = None  # NEW
    approving_supervisor_name: Optional[str] = None  # NEW
    created_at: str


# Location (within station)
class LocationCreate(BaseModel):
    name: str
    station_id: str
    description: Optional[str] = None


class LocationResponse(BaseModel):
    id: str
    name: str
    station_id: str
    station_name: Optional[str] = None
    description: Optional[str] = None
    created_at: str


# Asset Type
class ChecklistItem(BaseModel):
    name: str
    description: Optional[str] = None
    expected_value: Optional[str] = None


class AssetTypeCreate(BaseModel):
    name: str
    department_id: str
    checklist: List[ChecklistItem] = []
    description: Optional[str] = None


class AssetTypeResponse(BaseModel):
    id: str
    name: str
    department_id: str
    department_name: Optional[str] = None
    checklist: List[Dict[str, Any]] = []
    description: Optional[str] = None
    created_at: str


# Asset
class AssetCreate(BaseModel):
    asset_type_id: str
    station_id: str
    location_id: str
    asset_number: str
    description: Optional[str] = None
    schedule_frequency: Optional[ScheduleFrequency] = None
    assigned_supervisor_id: Optional[str] = None  # NEW: supervisor assignment


class AssetResponse(BaseModel):
    id: str
    asset_type_id: str
    asset_type_name: Optional[str] = None
    station_id: str
    station_name: Optional[str] = None
    location_id: str
    location_name: Optional[str] = None
    asset_number: str
    status: str = "working"
    description: Optional[str] = None
    schedule_frequency: Optional[str] = None
    assigned_supervisor_id: Optional[str] = None  # NEW
    assigned_supervisor_name: Optional[str] = None  # NEW
    last_inspected: Optional[str] = None
    next_due: Optional[str] = None
    created_at: str


# User
class UserCreate(BaseModel):
    employee_id: str
    name: str
    role: UserRole
    department_id: Optional[str] = None
    assigned_stations: List[str] = []
    password: str
    email: Optional[str] = None
    phone: Optional[str] = None
    reports_to_id: Optional[str] = None  # NEW: Supervisor links to Reporting Officer


class UserResponse(BaseModel):
    id: str
    employee_id: str
    name: str
    role: str
    department_id: Optional[str] = None
    department_name: Optional[str] = None
    assigned_stations: List[str] = []
    email: Optional[str] = None
    phone: Optional[str] = None
    is_active: bool = True
    reports_to_id: Optional[str] = None  # NEW
    reports_to_name: Optional[str] = None  # NEW
    created_at: str


class UserLogin(BaseModel):
    employee_id: str
    password: str


# Inspection
class InspectionItemRecord(BaseModel):
    asset_id: str
    status: InspectionItemStatus
    checklist_responses: List[Dict[str, Any]] = []
    remarks: Optional[str] = None
    photo_urls: List[str] = []
    defective_since: Optional[str] = None  # ISO date-time string when defect started


class InspectionCreate(BaseModel):
    inspection_type: InspectionType
    station_id: str
    inspector_id: str
    items: List[InspectionItemRecord]
    participants: List[str] = []  # For SIG - list of employee IDs
    overall_remarks: Optional[str] = None
    inspection_at: Optional[str] = None  # NEW: Manual inspection date/time (ISO)


class InspectionResponse(BaseModel):
    id: str
    inspection_type: str
    station_id: str
    station_name: Optional[str] = None
    inspector_id: str
    inspector_name: str
    items: List[Dict[str, Any]] = []
    participants: List[Dict[str, Any]] = []
    overall_remarks: Optional[str] = None
    inspection_at: Optional[str] = None  # NEW
    created_at: str


# Orange List
class OrangeListCreate(BaseModel):
    asset_id: str
    inspection_id: str
    reported_by: str
    remarks: Optional[str] = None


class MarkWorkingRequest(BaseModel):
    marked_by: str
    remarks: Optional[str] = None


class ApproveWorkingRequest(BaseModel):
    approved_by: str
    remarks: Optional[str] = None


# Notifications
class NotificationCreate(BaseModel):
    user_id: str
    title: str
    message: str
    notification_type: str = "info"
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[str] = None


# Schedules
class ScheduleCreate(BaseModel):
    asset_id: str
    frequency: ScheduleFrequency
    set_by: str
