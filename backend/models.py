from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum
import re


# Enums
class UserRole(str, Enum):
    SUPERADMIN = "superadmin"
    DIVISIONAL_ADMIN = "divisional_admin"
    ADMIN = "admin"
    REPORTING_OFFICER = "reporting_officer"
    APPROVING_SUPERVISOR = "approving_supervisor"
    SUPERVISOR = "supervisor"
    VIEWER = "viewer"  # Read-only auditor/observer. Can view dashboards, reports,
                        # asset registry, OL lists, schedules, history, and export
                        # PDF/Excel. Cannot create/edit/delete anything, cannot
                        # inspect, cannot mark working / approve / post remarks.


class AssetStatus(str, Enum):
    WORKING = "working"
    DEFECTIVE = "defective"
    PENDING_APPROVAL = "pending_approval"
    MISSING = "missing"  # Physically absent; tracked via OL row with kind='missing'.


class InspectionType(str, Enum):
    """Inspection type. Wire/DB representation is the lowercase `value` ('individual', 'sig')."""
    INDIVIDUAL = "individual"
    SIG = "sig"  # Station Inspection Group


class InspectionItemStatus(str, Enum):
    """Per-item inspection result.

    Wire/DB representation is the lowercase `value`:
      - 'ok'
      - 'not_ok'
      - 'needs_repair'
      - 'missing'         (asset physically absent — flows into OL with kind='missing')

    The Python enum NAMES are uppercase (idiomatic) but never serialized.
    Frontend should always send lowercase strings.
    """
    OK = "ok"
    NOT_OK = "not_ok"
    NEEDS_REPAIR = "needs_repair"
    MISSING = "missing"


class OrangeListKind(str, Enum):
    """Deficiency category on an Orange-List row.

    All three kinds share the same OL state machine (defective → pending_approval
    → resolved) and the same 24h orange→red aging threshold. `kind` is purely a
    classification used by the UI to render badges and by reports to break the
    count down. Existing rows without this field are treated as 'defective'.
    """
    DEFECTIVE = "defective"
    NEEDS_REPAIR = "needs_repair"
    MISSING = "missing"


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
    name: str = Field(..., min_length=1, max_length=120)
    code: str = Field(..., min_length=1, max_length=8)
    description: Optional[str] = None

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Name is required")
        return v

    @field_validator("code")
    @classmethod
    def _clean_code(cls, v: str) -> str:
        v = (v or "").strip().upper()
        if not v:
            raise ValueError("Code is required")
        if len(v) > 8:
            raise ValueError("Code must be 1-8 characters")
        if not re.fullmatch(r"[A-Z0-9]+", v):
            raise ValueError("Code may contain only letters and numbers")
        return v


class DepartmentResponse(BaseModel):
    id: str
    name: str
    code: str
    description: Optional[str] = None
    created_at: str


# Zone
class ZoneCreate(BaseModel):
    name: str
    code: str


class ZoneResponse(BaseModel):
    id: str
    name: str
    code: str
    created_at: str


# Division
class DivisionCreate(BaseModel):
    name: str
    code: str
    zone_id: str


class DivisionResponse(BaseModel):
    id: str
    name: str
    code: str
    zone_id: str
    zone_name: Optional[str] = None
    station_count: Optional[int] = 0
    created_at: str


# Station
class StationCreate(BaseModel):
    name: str
    code: str
    zone: Optional[str] = None
    division: Optional[str] = None
    division_id: Optional[str] = None            # structured FK to divisions collection
    approving_supervisor_id: Optional[str] = None


class StationResponse(BaseModel):
    id: str
    name: str
    code: str
    zone: Optional[str] = None
    division: Optional[str] = None
    division_id: Optional[str] = None
    division_name: Optional[str] = None
    approving_supervisor_id: Optional[str] = None
    approving_supervisor_name: Optional[str] = None
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
    tracking_mode: str = "individual"  # "individual" | "grouped"
    icon_key: Optional[str] = None    # e.g. "fan", "light", "cib" — overrides auto-detect


class AssetTypeResponse(BaseModel):
    id: str
    name: str
    department_id: str
    department_name: Optional[str] = None
    checklist: List[Dict[str, Any]] = []
    description: Optional[str] = None
    tracking_mode: str = "individual"
    created_at: str


# Asset
class AssetCreate(BaseModel):
    asset_type_id: str
    station_id: str
    location_id: str
    asset_number: Optional[str] = None  # Auto-generated for grouped assets
    description: Optional[str] = None
    schedule_frequency: Optional[int] = None  # number of days between inspections
    identification_photo: Optional[str] = None  # base64-encoded image (client-resized ≤200 KB)
    geo_lat: Optional[float] = None             # GPS latitude (WGS-84)
    geo_lng: Optional[float] = None             # GPS longitude (WGS-84)
    # ── Grouped-asset fields (used when asset_type.tracking_mode == 'grouped') ─
    sub_zone_id: Optional[str] = None
    total_count: Optional[int] = None
    needs_repair_count: Optional[int] = 0
    not_working_count: Optional[int] = 0
    # ── Canvas Blueprint position (admin-set, percentage of sub-zone canvas) ─
    canvas_x: Optional[float] = None   # 0-100
    canvas_y: Optional[float] = None   # 0-100


# Sub-Zone (clusters of identical grouped assets within a location, e.g.,
# "Platform 1 → Sub-Zone A" containing 120 fans tracked as a single group).
class SubZoneCreate(BaseModel):
    name: str
    code: Optional[str] = None
    station_id: str
    location_id: str
    description: Optional[str] = None
    order: Optional[int] = None
    # Canvas Blueprint settings
    has_divider: Optional[bool] = False          # Show center dividing line on canvas
    divider_orientation: Optional[str] = "vertical"  # "vertical" | "horizontal"
    # Physical pillar markers (anchor labels rendered at canvas edges)
    start_pillar: Optional[str] = None  # e.g. "P12"  (left/high-end edge)
    end_pillar: Optional[str] = None    # e.g. "P18"  (right/low-end edge)


# Canvas Landmark (P.No markers, pole references, etc. on the platform blueprint)
class CanvasLandmarkCreate(BaseModel):
    sub_zone_id: str
    location_id: str
    station_id: str
    label: str             # e.g. "P.No 27", "P.No 28"
    x: float               # 0-100 percentage of canvas width
    y: float               # 0-100 percentage of canvas height
    landmark_type: Optional[str] = "pole"   # "pole", "point", "custom"


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
    schedule_frequency: Optional[int] = None  # days between inspections
    last_inspected: Optional[str] = None
    next_due: Optional[str] = None
    identification_photo: Optional[str] = None
    geo_lat: Optional[float] = None
    geo_lng: Optional[float] = None
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
    reports_to_id: Optional[str] = None
    assigned_division_id: Optional[str] = None  # for divisional_admin role


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
    reports_to_id: Optional[str] = None
    reports_to_name: Optional[str] = None
    assigned_division_id: Optional[str] = None
    assigned_division_name: Optional[str] = None
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
    remarks_by: Optional[str] = None  # NEW: Track who made the remarks
    photo_urls: List[str] = []
    defective_since: Optional[str] = None  # ISO date-time string when defect started
    rectified_on: Optional[str] = None     # NEW: ISO date-time when fixed/marked OK
    # ── Grouped asset counts (used only when asset.tracking_mode == 'grouped') ─
    # Inspector enters how many units need repair / are not working out of the
    # group's total_count. status is derived server-side from these counts.
    group_counts: Optional[Dict[str, int]] = None  # {needs_repair, not_working}


class InspectionCreate(BaseModel):
    inspection_type: InspectionType
    station_id: str
    inspector_id: str
    items: List[InspectionItemRecord]
    participants: List[str] = []  # For SIG - list of employee IDs
    overall_remarks: Optional[str] = None
    inspection_at: Optional[str] = None  # NEW: Manual inspection date/time (ISO)
    # Per-sub-zone "shed health" responses captured during the inspection.
    # Each entry: {sub_zone_id, location_id, responses: {key: ok|not_ok},
    #              photos: {key: [url, ...]}, remarks: str}
    # Recognised question keys: shed_roof_condition, cleanliness, lighting, water_seepage
    sub_zone_health: List[Dict[str, Any]] = []


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
    marked_working_at: Optional[datetime] = None  # user-entered; defaults to now in endpoint


class RejectWorkingRequest(BaseModel):
    rejected_by: str
    remarks: str  # required — ASUP must explain why rejected


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
