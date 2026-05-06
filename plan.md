# plan.md

## Objectives
- Deliver a production-usable **Railway Asset Inspection Management System** with:
  - Asset master data (stations/locations/asset types/assets)
  - Inspections (individual + SIG)
  - Defect tracking + Orange/Red aging
  - Approval workflow:
    - Legacy (done): defective → working (pending approval) → approve
    - Current (done): **every inspection item requires Pass/Fail approval** by Approving Supervisor (or Admin/Superadmin)
  - Scheduling/due tracking:
    - **Asset-level custom inspection frequency in days**
    - **Role-based schedules view** (Supervisor / Approving Supervisor / Admin / Superadmin / RO)
    - **Superadmin optional advanced filters** (stations/departments/asset categories/ROs/supervisors)
  - Photo evidence uploads + deletion before submit
  - Multi-role access with clear UX and strict scoping (users see only assigned stations/departments/assets)
  - Admin tooling:
    - Station personnel mapping
    - Linking supervisors → reporting officers
    - Bulk reassignment of assets (supervisor transfer/retirement)
  - Operational visibility:
    - Role dashboards (Supervisor, Approving Supervisor, Reporting Officer, Admin, Superadmin)
    - Minimal, clean UI with charts where helpful
    - Actionable “My Tasks” and approvals queue
  - Reporting:
    - Print-friendly inspection report including all remarks + photos
  - Notifications:
    - Bell dropdown (done)
    - **Full Notifications page** with pagination + filters and deep links (planned)
- Ensure the core workflow is proven end-to-end:
  - inspection submit → items pending approval → Pass applies effects → defect aging continues correctly
  - Fail keeps previous effective state and logs gap time
- Reduce recurring UI regressions by standardizing Shadcn `<Select>` placeholder handling (**never use empty string values**).
- Improve maintainability and scalability:
  - **Refactor backend by splitting `server.py` into routers** while preserving route paths, `/api` prefix behavior, dependencies, and helper functions.

---

## Implementation Steps

### Phase 1 — Core Flow POC (isolation, must pass before full app) ✅ COMPLETE
**Goal:** Validate the hardest parts with minimal UI: workflows + file upload + notification hooks.

Delivered user stories:
1. Submit an inspection for an asset with status, checklist answers, remarks, and photos.
2. Mark an asset defective and see it appear in the Orange List.
3. Supervisor/RO can mark a defective asset as “working (pending approval)”.
4. Approving supervisor can verify in the field and approve “working” so it exits the Orange List.
5. Reporting Officer receives an in-app alert when assets in their dept+station are marked defective.

Implemented:
- FastAPI + MongoDB data model (Departments, Stations, Locations, Asset Types with checklist schema, Assets, Users, Inspections, Orange List items, Notifications, Schedules, Audit Log).
- Photo uploads (local storage) + URL persistence.
- In-app notifications persisted in DB.
- Audit logging for key state changes.

Exit criteria met:
- Scripted test proves the full flow with real MongoDB + real file writes.

---

### Phase 2 — V1 App Development (MVP UI + core modules) ✅ COMPLETE
**Goal:** Build a usable web app around the proven core and deliver end-to-end workflows.

Delivered user stories:
1. Admin can create and manage stations, locations, departments, asset types (with checklists), and assets.
2. Supervisor/RO can filter station/location assets and perform an individual inspection.
3. Approving supervisor can start a SIG inspection (station-wide) and submit it with participant names.
4. RO can view defective assets in Orange List and monitor rectification state.
5. Users can view Orange List, inspection history, and audit trail.

Implemented (Frontend + Backend):
- Authentication: Employee ID + Password + JWT.
- App shell: Responsive layout (sidebar + topbar) + notification bell.
- Dashboard: KPI stats + charts (later redesigned per role).
- Asset Registry: Search + filtering + CRUD (admin-only actions).
- Inspections: Individual + SIG.
- Orange List: Defective tracking and approval workflow.
- Notifications: In-app bell dropdown + unread count + mark-all-read.
- Schedules: Due/overdue tracking + due-today list (superseded by frequency-based schedules).
- User Management: CRUD + assignments.
- Admin Panel: Departments, Stations, Locations, Asset Types + checklist builder.
- Role Management: Superadmin can grant/revoke Admin.
- File Upload: Photo evidence upload and preview.
- Audit Logging.

Testing / Exit criteria met:
- Backend: major flows verified.
- Frontend: key user journeys verified.

---

### Phase 2.1 — Admin Panel UX Improvements + Inspection Checklist Rendering ✅ COMPLETE
**Goal:** Implement requested admin UX changes and ensure checklists appear during inspection.

Delivered:
- Admin Panel:
  - Edit/update for Stations
  - Edit/update for Locations
  - Locations reorganized into a station-grouped accordion
  - Edit/update for Asset Types (including checklist)
- Inspection Flow:
  - Checklist from Asset Type appears during inspection for selected assets
  - Checklist items interactive and submitted with inspection payload

---

### Phase 3 — UX Restructure + Assignment Improvements ✅ COMPLETE
**Goal:** Implement requested changes across Users, Assets, Inspections, History, and Scheduling.

#### Phase 3.0 — Stability Fix: Asset Registry Edit Crash (Shadcn Select empty string) ✅ COMPLETE
- Root cause: Shadcn `<SelectItem>` with `value=""`.
- Fix: `value="none"` sentinel + mapping `none ↔ null`.
- Verified with screenshot tool.

---

#### Phase 3.0.1 — Change: Inspection Frequency as Custom “Days” (Asset Registry) ✅ COMPLETE
**Why:** Frequency must be a user-entered number of days.

Delivered:
- Backend:
  - `schedule_frequency` changed to `Optional[int]` (days) in asset schema.
  - `_normalize_freq_days()` converts legacy strings (daily=1, weekly=7, monthly=30, quarterly=90) on reads.
  - On inspection **Pass approval**, assets update `last_inspected` and compute `next_due = now + freq_days`.
- Frontend:
  - Frequency select replaced by `Input type=number` labeled “Inspection Frequency (days)”.
  - Asset badge displays “every Nd”.

---

#### Phase 3.1 — User Management Enhancements ✅ COMPLETE
Delivered:
- User Management moved inside Admin Panel.
- Station Personnel Mapping implemented.
- Linking Supervisors to Reporting Officers (backend + frontend).

---

#### Phase 3.2 — Asset Registry Restructure + History Drawers ✅ COMPLETE
Delivered:
- Group by asset type.
- Shows supervisor name.
- Clickable asset and supervisor history drawers.

---

#### Phase 3.3 — New Inspection Improvements ✅ COMPLETE
Delivered:
- Role-based filtering for assets.
- Backdated defect logging.
- Remarks attribution (`remarks_by`).
- Rectified On date/time when marking OK.
- Photo deletion before submission.

---

#### Phase 3.4 — Inspection History Restructure ✅ COMPLETE
Delivered:
- Asset-wise grouping.

---

#### Phase 3.0.2 — Role-based Sidebar + Frequency-based Schedules + Transfer Supervisor ✅ COMPLETE
**Why:** Schedules should be the primary operational view (week default) and role-based navigation.

Delivered:
1. **Sidebar RBAC changes** (Frontend: `AppLayout.js`):
   - Asset Registry: visible **only** to Superadmin.
   - Orange List page: visible only to **Superadmin/Admin/Reporting Officer** (removed from Supervisor/ASUP).
   - Schedules: visible to all.
2. **Backend endpoints**:
   - `GET /api/schedules/supervisor/{user_id}?from_date=&to_date=`
     - Computes frequency-based inspection tasks from assets assigned to the supervisor.
     - Default range: today → today+7.
     - Returns asset-category grouped tasks with due_date + days_left.
   - `GET /api/schedules/approving-supervisor/{user_id}/supervisors`
     - Lists supervisors under the approving supervisor’s stations.
   - `POST /api/admin/transfer-supervisor`
     - Bulk reassign (or unassign) assets from one supervisor to another.
     - Audit logged.
3. **Frontend Schedules UI redesign**:
   - Supervisor view: date range picker + 7d/14d/30d presets + grouped tasks.
   - Approving Supervisor view: supervisor cards → click opens that supervisor schedule.
   - Admin/Superadmin/RO view: supervisor picker (later replaced by multi-filter).
4. **Admin Panel — Transfer tab**:
   - From/To supervisor dropdowns + “Unassign” option.

---

#### Phase 3.0.3 — Superadmin Optional Advanced Schedules Filters ✅ COMPLETE
Delivered:
- Backend:
  - `GET /api/schedules/admin` with optional multi-filters:
    - `station_ids[]`, `department_ids[]`, `asset_type_ids[]`, `supervisor_ids[]`, `reporting_officer_ids[]`, `from_date`, `to_date`.
- Frontend:
  - Multi-select filter UI + Clear filters.
  - Tasks show supervisor name where relevant.

---

#### Phase 3.0.4 — Inspection Approval Overhaul (Every inspection item needs Pass/Fail) ✅ COMPLETE
**Why:** All inspections require approval, and approvals are per-item (asset) within an inspection.

Delivered:
- Inspection submission:
  - Each item stored with `approval_status=pending_approval` + review metadata.
  - Asset state changes are deferred until Pass.
- Endpoints:
  - `GET /api/inspections/pending-approvals?reviewer_id=`
  - `POST /api/inspections/{inspection_id}/items/{item_index}/approve`
  - `POST /api/inspections/{inspection_id}/items/{item_index}/reject`
- Behavior:
  - **Pass:** applies effects (defective updates, orange list insert if needed, last_inspected/next_due updates).
  - **Fail:** applies no asset state change; logs `gap_seconds` + audit entry.
- Notifications:
  - Notifies station ASUP + admins/superadmins on submission.
  - Notifies inspector on approve/reject.

---

#### Phase 3.0.5 — Performance Analytics Endpoints ✅ COMPLETE
Delivered:
- `GET /api/analytics/supervisor/{user_id}`
  - Per-category aggregates + per-asset breakdown:
    - avg repair time, % time functional (lifetime), defect count, current status.
- `GET /api/analytics/approving-supervisor/{user_id}/supervisors`
  - Supervisor comparison list with per-category aggregates.
- `GET /api/analytics/asset/{asset_id}`
  - Single asset metrics.

---

### Phase 4 — Role Dashboards (Minimalistic, Operational) ✅ COMPLETE
**Goal:** Implement role-specific dashboards with minimal, clean UI, removing old “Recent Inspections”/legacy blocks and surfacing actionable tasks.

#### Phase 4.1 — Supervisor Dashboard ✅ COMPLETE
Delivered per agreed logic:
- Scope: only assets allocated to the supervisor.
- Station dropdown (assigned stations only).
- Department badge highlighted.
- Tabs:
  - **Overview:** asset health pie + asset-type clickable buttons with summary counts.
  - **My Tasks:** sub-tabs “My Assets” and “Pending Tasks”, category-wise collapsible lists.
  - **My Performance:** category-wise avg repair time + % functional, collapsible per-asset list.
- Enhancement (done): Asset-category buttons now also show **% functional time**.

---

#### Phase 4.2 — Single-Asset Inspection Deep Link ✅ COMPLETE
Delivered:
- `/inspection?asset_id=...` now:
  - loads the asset
  - preselects station/location
  - preselects the asset and builds its checklist
  - shows a “Single-asset inspection” banner with a button to switch back to multi-asset mode.

---

#### Phase 4.3 — Approving Supervisor Dashboard ✅ COMPLETE
Delivered per agreed logic:
- Scope: all assets across stations assigned to ASUP.
- Station dropdown + department dropdown.
- Overview:
  - Overall Health pie
  - Station snapshot list (click → drill-down)
  - **Clickable asset category buttons**
- Drill-down:
  - Station → asset category → assets list with current status.
  - Enhancement (done): clicking an **asset category card** opens a dedicated list:
    - **Priority** (Not OK / Needs Repair / orange/red) on top, newest defects first
    - **Working** assets separated
  - Enhancement (done): asset-category cards show **% functional time**.
- “My Supervisors”:
  - Supervisor-wise analytics (avg repair time, % functional by category).
- “My Tasks”:
  - Approval queue UI: approve/reject each inspection item individually.
  - Uses backend pending-approvals + approve/reject endpoints.

---

#### Phase 4.4 — Reporting Officer Dashboard ✅ COMPLETE
Delivered:
- Same structure as ASUP dashboard, but scoped:
  - assigned stations
  - **locked** department (RO’s department)
  - supervisors reporting to the RO
- Enhancements (done):
  - asset-category cards show **% functional time**
  - clicking category cards opens priority/working split list

---

#### Phase 4.5 — Superadmin Dashboard Redesign ✅ COMPLETE
Delivered:
- Minimal operational dashboard backed by `GET /api/dashboard/superadmin`:
  - Five summary buttons: **Asset Categories / Stations / Divisions / Reporting Officers / Approving Supervisors**
  - Tab views with clean list rows showing health counts where applicable.
  - System-wide health donut chart.

---

#### Phase 4.6 — Inspection History Role-Scoping ✅ COMPLETE
Delivered:
- Backend `GET /api/inspections` now supports `for_user_id` scoping:
  - Supervisor: only inspections containing assets allocated to them (items trimmed)
  - Approving Supervisor: inspections at their stations
  - Reporting Officer: inspections at their stations for assets in their department (items trimmed)
  - Superadmin/Admin: unscoped
- Frontend `InspectionHistoryPage` passes `for_user_id` for non-superadmin/admin roles.
- Enhancement (done): Inspection History UI renders **Pass/Fail/Pending** badges per item (based on `approval_status`) and shows reviewer remarks.
- Enhancement (done): Inspection History supports deep-linking `?asset_id=` (used by notifications).
- Enhancement (planned): implement deep-link focus behavior for `?inspection_id=`.

---

### Phase 5 — Notifications, Admin Dashboard, and Reporting ✅ COMPLETE

#### Phase 5.1 — Notifications scoping + deep links ✅ COMPLETE
Delivered:
- Notifications dropdown items are clickable.
- Notifications are marked read on click.
- Deep link behavior:
  - `related_entity_type=orange_list|asset` → opens `/inspection-history?asset_id=...`
  - `related_entity_type=inspection` → opens `/inspection-history?inspection_id=...` (reserved; pending focus behavior)
- Note: server-side notification targeting already restricts notifications to relevant roles/stations/departments.

---

#### Phase 5.2 — Admin Dashboard (filters + RO summaries) ✅ COMPLETE
Delivered:
- Admin dashboard implemented (replaced placeholder).
- Supports optional multi-filters:
  - stations, departments, reporting officers
- Shows:
  - overall health pie
  - stations snapshot with collapsible station → category breakdown
  - categories tab
  - reporting officers summary tab

---

#### Phase 5.3 — Inspection Report Generation ✅ COMPLETE
Delivered:
- Print-friendly HTML report builder (`/app/frontend/src/lib/inspection-report.js`).
- Automatically opens a printable report after submitting a new inspection.
- “Print Report” button available in Inspection History inspection details modal.
- Report includes:
  - inspection metadata (type, station, inspector, timestamps)
  - per-item status + approval badge
  - checklist responses
  - remarks (remarks_by + text)
  - reviewer remarks
  - photo thumbnails

---

### Phase 6 — Notifications Page + Deep-Link Focus + Backend Router Refactor 🚧 IN PROGRESS
**Goal:** Improve operational usability (notifications discoverability and deep links) and improve backend maintainability.

#### Phase 6.1 — Full Notifications Page (new route) 🚧 IN PROGRESS
Scope:
- Add a dedicated **Notifications** page/route (e.g. `/notifications`) accessible to all authenticated roles.
- Features:
  - Pagination (e.g. 20/page)
  - Filters: read/unread, type, date range
  - Search by title/message text (if supported)
  - Bulk actions: mark all read (and optional delete if desired)
  - Click notification → mark read → deep link to relevant view:
    - `asset` / `orange_list` → `/inspection-history?asset_id=...`
    - `inspection` → `/inspection-history?inspection_id=...`
- Backend changes expected:
  - Extend `GET /api/notifications` to support pagination/filters (while preserving existing behavior for dropdown usage).
  - Add safe defaults and indexes if needed for large datasets.

#### Phase 6.2 — Implement `?inspection_id=` deep-link focus on Inspection History 🚧 IN PROGRESS
Scope:
- When landing on `/inspection-history?inspection_id=...`:
  - Auto-open the relevant inspection detail modal (and, if needed, the containing asset collapsible section).
  - Ensure it works with role-scoped `for_user_id` behavior (i.e., user can only open inspections they are allowed to see).
  - Fallback behavior if inspection not found / not in scope: show a user-friendly message.

#### Phase 6.3 — Refactor backend by splitting `/app/backend/server.py` into routers 🚧 IN PROGRESS
Scope:
- Split into multiple router modules for maintainability, while strictly preserving:
  - All existing route paths and HTTP methods (including `/api/...` paths)
  - Auth/dependency behavior and helper utilities (e.g., `serialize_doc` usage)
  - CORS middleware and static uploads mounting
- Proposed router modules:
  - `auth.py`, `users.py`, `assets.py`, `inspections.py`, `schedules.py`, `dashboards.py`, `analytics.py`, `notifications.py`, `admin.py`, `uploads.py`, plus `meta/health.py` and `meta/audit.py` (exact split flexible).
- Keep `server.py` as the entry point:
  - app creation + CORS + static files + `include_router(...)` only.

#### Phase 6.4 — Testing & verification for Phase 6 🚧 IN PROGRESS
Testing approach (per latest instruction: “use both”):
- Backend:
  - Run existing backend script tests (e.g. `test_core.py` if applicable) and perform quick API smoke tests for key routes.
  - Confirm that all endpoints still respond under the same paths post-refactor.
- Frontend:
  - UI smoke tests using the app:
    - Notifications dropdown still works
    - New Notifications page loads, filters/pagination work
    - Clicking a notification deep-links correctly
    - `?inspection_id=` opens inspection details

---

## Next Actions (Optional / Future)
1. **Integrate real SMS/WhatsApp provider** (adapter infrastructure exists; pending API keys).
2. **Pagination for other large datasets** (inspections, assets, orange list) if performance requires.
3. Add unit tests for approval edge cases and schedule computations.

---

## Success Criteria
- Core workflow works reliably with full audit trail.
- Scheduling:
  - Frequency configured in days.
  - Supervisor/ASUP/Admin/Superadmin/RO can view schedules (week default + date range + filters).
  - Supervisor transfer/reassignment supported.
- Dashboards:
  - Supervisor / ASUP / RO / Admin / Superadmin dashboards match agreed logic and are minimalistic.
  - Approvals are actionable (Pass/Fail per item) from dashboards.
  - **% functional time** is visible to stakeholders per asset category (and via performance view per asset).
- Approval:
  - Every inspection item requires Pass/Fail approval.
  - Fail preserves defect aging (no state applied) and gap is audit logged.
- Scoping:
  - Each stakeholder sees only assigned stations/departments/assets in dashboard, notifications, and inspection history.
- Notifications:
  - Dropdown remains functional (quick view).
  - **Full Notifications page** supports pagination/filters and deep links.
  - `?inspection_id=` deep links open the correct inspection details when in scope.
- Reporting:
  - Printable inspection report is available after submission and from inspection history.
- Maintainability:
  - Backend is modularized into routers with no route regressions.
- Stability:
  - No Shadcn Select empty-string regressions (`value=""` not used).
