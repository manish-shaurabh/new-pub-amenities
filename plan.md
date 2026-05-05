# plan.md

## Objectives
- Deliver a production-usable Railway Asset Inspection Management System with:
  - Asset master data (stations/locations/asset types/assets)
  - Inspections (individual + SIG)
  - Defect tracking + Orange/Red list aging
  - Approval workflow:
    - Legacy (done): defective → working (pending approval) → approve
    - Current (done): **every inspection item requires Pass/Fail approval** by Approving Supervisor (or Admin/Superadmin)
  - Scheduling/due tracking:
    - **Asset-level custom inspection frequency in days**
    - **Role-based schedules view** (Supervisor / Approving Supervisor / Admin / Superadmin / RO)
    - **Superadmin optional advanced filters** (stations/departments/asset categories/ROs/supervisors)
  - Photo evidence uploads
  - Multi-role access with clear UX and strict scoping (users see only assigned stations/departments/assets)
- Ensure the core workflow is proven end-to-end:
  - inspection submit → pending approval → Pass applies effects → defect aging continues correctly
  - Fail keeps previous effective state and logs gap time
- Provide operational visibility with:
  - Role-specific dashboards (Supervisor, Approving Supervisor, Reporting Officer, Superadmin)
  - Minimal, clean UI with charts where helpful
  - "My Tasks" and approvals that are actionable from dashboard
- Improve usability with neat, categorized, collapsible UIs and quick access to inspection actions.
- Reduce recurring UI regressions by standardizing Shadcn `<Select>` placeholder handling (**never use empty string values**).

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

### Phase 3 — UX Restructure + Assignment Improvements ✅ COMPLETE (as of current scope)
**Goal:** Implement requested changes across Users, Assets, Inspections, History, and Scheduling.

#### Phase 3.0 — Stability Fix: Asset Registry Edit Crash (Shadcn Select empty string) ✅ COMPLETE
- Root cause: Shadcn `<SelectItem>` with `value=""`.
- Fix: `value="none"` sentinel + mapping `none ↔ null`.
- Verified with screenshot tool.

---

#### Phase 3.0.1 — Change: Inspection Frequency as Custom “Days” (Asset Registry) ✅ COMPLETE
**Why:** Frequency must be a user-entered number of days, not only daily/weekly/monthly/quarterly.

Delivered:
- Backend:
  - `schedule_frequency` changed to `Optional[int]` (days) in asset schema.
  - `_normalize_freq_days()` converts legacy strings (daily=1, weekly=7, monthly=30, quarterly=90) on reads.
  - On inspection Pass approval, assets update `last_inspected` and compute `next_due = now + freq_days` when frequency exists.
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
- Role-based filtering.
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
**Why:** Schedules should be the primary operational view (week default) and role-based navigation, plus supervisor transfer handling.

Delivered:
1. **Sidebar RBAC changes** (Frontend: `AppLayout.js`):
   - Asset Registry: visible **only** to Superadmin.
   - Orange List page: visible only to **Superadmin/Admin/Reporting Officer** (removed from Supervisor/ASUP).
   - Schedules: visible to all.

2. **Backend endpoints** (FastAPI):
   - `GET /api/schedules/supervisor/{user_id}?from_date=&to_date=`
     - Computes frequency-based inspection tasks from assets assigned to the supervisor.
     - Default range: today → today+7.
     - Returns **asset-category grouped** tasks with `due_date`, `days_left`, `is_overdue`, `frequency_days`.
   - `GET /api/schedules/approving-supervisor/{user_id}/supervisors`
     - Lists supervisors under the approving supervisor’s stations.
     - Includes department and asset counts.
   - `POST /api/admin/transfer-supervisor`
     - Bulk reassign (or unassign) assets from one supervisor to another.
     - Handles invalid IDs gracefully.
     - Audit logged.

3. **Frontend Schedules UI redesign** (`SchedulesPage.js` + `api.js`):
   - Supervisor view: date range picker + 7d/14d/30d presets + grouped tasks.
   - Approving Supervisor view: supervisor cards → click opens that supervisor schedule.
   - Admin/Superadmin/RO view (initial): supervisor picker.

4. **Admin Panel — Transfer tab** (`AdminPage.js`):
   - New “Transfer” tab.
   - From/To supervisor dropdowns + “Unassign” option.
   - Calls transfer endpoint.

Verification:
- Tested backend with scripted requests.
- Tested UI with screenshot tool across Superadmin and Supervisor roles.

---

#### Phase 3.0.3 — Superadmin Optional Advanced Schedules Filters ✅ COMPLETE
**Why:** Superadmin needs optional drill-down across stations/departments/asset categories/ROs/supervisors.

Delivered:
- Backend:
  - `GET /api/schedules/admin` with optional multi-filters:
    - `station_ids[]`, `department_ids[]`, `asset_type_ids[]`, `supervisor_ids[]`, `reporting_officer_ids[]`, `from_date`, `to_date`
    - Expands department→asset types and RO→supervisors when provided.
- Frontend:
  - Multi-select filter UI (Stations/Departments/Asset Categories/ROs/Supervisors) + Clear filters.
  - Date range + presets retained.
  - Tasks show supervisor name where relevant.

---

#### Phase 3.0.4 — Inspection Approval Overhaul (Every inspection item needs Pass/Fail) ✅ COMPLETE
**Why:** All inspections at stations require approval, and approvals are per-item (asset) within an inspection.

Delivered:
- Inspection submission:
  - Each inspection item stored with `approval_status=pending_approval` and review metadata.
  - Asset state changes are deferred until Pass.
- Approval endpoints:
  - `GET /api/inspections/pending-approvals?reviewer_id=`
  - `POST /api/inspections/{inspection_id}/items/{item_index}/approve`
  - `POST /api/inspections/{inspection_id}/items/{item_index}/reject`
- Behavior:
  - **Pass:** applies effects (defective updates, orange list insert if needed, last_inspected/next_due updates).
  - **Fail:** applies no asset state change; logs `gap_seconds` and audit entry.
- Notifications:
  - Notifies station ASUP + admins/superadmins on submission.
  - Notifies inspector on approve/reject.

Verified with scripted tests:
- Pending status after submission.
- Pass changes asset state.
- Reject keeps asset state.

---

#### Phase 3.0.5 — Performance Analytics Endpoints ✅ COMPLETE
**Why:** Support “My Performance” views and supervisor comparison analytics.

Delivered:
- `GET /api/analytics/supervisor/{user_id}`
  - Per-category aggregate metrics + per-asset breakdown:
    - avg repair time, % time functional (lifetime), defect count, current status.
- `GET /api/analytics/approving-supervisor/{user_id}/supervisors`
  - Supervisor comparison list with per-category aggregates (assets list omitted for payload size).
- `GET /api/analytics/asset/{asset_id}`
  - Single asset metrics.

---

### Phase 4 — Role Dashboards (Minimalistic, Operational) 🚧 IN PROGRESS
**Goal:** Implement role-specific dashboards with minimal, clean UI, removing the old “Recent Inspections” and “Orange/Red list (active)” blocks, and surfacing actionable tasks.

#### Phase 4.1 — Supervisor Dashboard ✅ COMPLETE
Implemented exactly per agreed logic:
- Scope: only assets allocated to the supervisor.
- Station dropdown for filtering (based on assigned stations).
- Department badge highlighted.
- Tabs:
  - **Overview:** asset health pie chart + asset-type clickable buttons with summary counts.
  - **My Tasks:** sub-tabs “My Assets” and “Pending Tasks” (only non-working assets), category-wise collapsible lists.
  - **My Performance:** category-wise average repair time + % time functional, collapsible per-asset list.

Notes:
- Clicking an asset in My Tasks navigates to `New Inspection` with a deep link (requires Phase 4.2 enhancement to pre-select asset automatically).
- Verified with screenshot tool.

---

#### Phase 4.2 — Single-Asset Inspection Deep Link (from dashboard) ⏳ PENDING
**Goal:** When navigating to `/inspection?asset_id=...`, the New Inspection page should:
- Pre-select the specific asset.
- Switch to single-asset mode automatically.

---

#### Phase 4.3 — Approving Supervisor Dashboard ⏳ NEXT (Priority)
**Goal:** Match agreed UI/logic:
- Scope: all assets across stations assigned to ASUP.
- Station dropdown + department dropdown.
- Asset-type buttons with summaries.
- “My Supervisors” button/view:
  - Supervisor-wise analytics (avg repair time, % functional by category).
- Station health pie + drill-down by station.
- Collapsible station → asset category → assets list with status + avg repair time + % functional.
- **My Tasks:** approval queue:
  - List pending inspection items from supervisors under ASUP.
  - Approve/Reject each item individually.
  - Superadmin can also approve/reject.

Blocked only on frontend implementation (backend is ready).

---

#### Phase 4.4 — Reporting Officer Dashboard ⏳ PENDING
**Goal:** “Like Approving Supervisor but scoped”:
- RO sees only:
  - assigned stations
  - their department
  - supervisors who report to them
- Same style of analytics/health views but filtered.

---

#### Phase 4.5 — Superadmin Dashboard Redesign ⏳ PENDING
**Goal:** System-wide operational dashboard with drill-down:
- Asset category buttons (all)
- ROs summary
- Approving Supervisors summary
- Stations summary
- Divisions summary
- Drill-downs to match the same metrics shown in other dashboards

---

### Phase 5 — Hardening + Reporting + Scheduling Ops (Future)
- Bulk operations for scheduling/assignment.
- Export reports.
- Improved audit and idempotency.
- Notification reminders and escalation policy.

---

### Phase 6 — Strict RBAC + External Notifications (SMS/WhatsApp) (Future)
- Strong backend enforcement by role + station + department.
- Outbox + retry for SMS/WhatsApp integration.

---

## Next Actions
1. **Phase 4.3 (Approving Supervisor Dashboard)** — implement UI, starting with **My Tasks approvals queue** (Pass/Fail per item) since backend is ready.
2. **Phase 4.2** — implement `/inspection?asset_id=` deep link preselection.
3. **Phase 4.4** — Reporting Officer dashboard scoped to assigned stations + department + linked supervisors.
4. **Phase 4.5** — Superadmin dashboard redesign with drill-down.

---

## Success Criteria
- Core workflow works reliably with full audit trail.
- Scheduling:
  - Frequency configured in days.
  - Supervisor/ASUP/Admin/Superadmin/RO can view schedules as requested (week default + date range + filters).
  - Supervisor transfer/reassignment supported.
- Dashboards:
  - Supervisor dashboard matches agreed logic and is minimalistic.
  - Approving Supervisor dashboard includes approvals queue and supervisor analytics.
  - Reporting Officer and Superadmin dashboards show only relevant scope and drill-down.
- Approval:
  - Every inspection item requires Pass/Fail approval.
  - Fail preserves defect aging (no state applied) and gap is audit logged.
- Notifications and approvals are actionable from the UI.
