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


class StationResponse(BaseModel):
    id: str
    name: str
    code: str
    zone: Optional[str] = None
    division: Optional[str] = None
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


class InspectionCreate(BaseModel):
    inspection_type: InspectionType
    station_id: str
    inspector_id: str
    items: List[InspectionItemRecord]
    participants: List[str] = []  # For SIG - list of employee IDs
    overall_remarks: Optional[str] = None


class InspectionResponse(BaseModel):
    id: str
    inspection_type: str
    station_id: str
    station_name: Optional[str] = None
    inspector_id: str
    inspector_name: Optional[str] = None
    items: List[Dict[str, Any]] = []
    participants: List[Dict[str, Any]] = []
    overall_remarks: Optional[str] = None
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


class OrangeListResponse(BaseModel):
    id: str
    asset_id: str
    asset_info: Optional[Dict[str, Any]] = None
    inspection_id: str
    reported_by: str
    reporter_name: Optional[str] = None
    status: str
    remarks: Optional[str] = None
    marked_working_by: Optional[str] = None
    marked_working_at: Optional[str] = None
    approved_by: Optional[str] = None
    approved_at: Optional[str] = None
    created_at: str


# Notification
class NotificationCreate(BaseModel):
    user_id: str
    title: str
    message: str
    notification_type: str = "info"  # info, warning, alert
    related_entity_type: Optional[str] = None  # asset, inspection, orange_list
    related_entity_id: Optional[str] = None


class NotificationResponse(BaseModel):
    id: str
    user_id: str
    title: str
    message: str
    notification_type: str
    is_read: bool = False
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[str] = None
    created_at: str


# Schedule
class ScheduleCreate(BaseModel):
    asset_id: str
    frequency: ScheduleFrequency
    set_by: str  # user_id of admin/RO who set it


class ScheduleResponse(BaseModel):
    id: str
    asset_id: str
    asset_info: Optional[Dict[str, Any]] = None
    frequency: str
    set_by: str
    next_due: Optional[str] = None
    last_inspected: Optional[str] = None
    is_overdue: bool = False
    created_at: str
