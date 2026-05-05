# plan.md

## Objectives
- Deliver a production-usable Railway Asset Inspection Management System with:
  - Asset master data (stations/locations/asset types/assets)
  - Inspections (individual + SIG)
  - Defect tracking + Orange/Red list aging
  - Approval workflow:
    - Current: defective → working (pending approval) → approve
    - Upcoming: **every inspection requires Pass/Fail approval by Approving Supervisor (or Superadmin)**
  - Scheduling/due tracking:
    - **Asset-level custom inspection frequency in days**
    - **Role-based schedules view** (Supervisor / Approving Supervisor / Admin)
  - Photo evidence uploads
  - Multi-role access with clear UX
- Ensure the core workflow is proven end-to-end: inspection → mark defective → Orange List → mark working → approve → removed from Orange List.
- Provide operational visibility with analytics dashboards, exports, in-app notifications, and auditable event history.
- Improve usability with neat, categorized, collapsible UIs and quick access to asset/supervisor histories.
- Prepare for production readiness: reporting/analytics, UX hardening, and external notifications (SMS/WhatsApp) + strict RBAC enforcement.
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
- Scripted POC test suite validating the full lifecycle.

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
- Dashboard: KPI stats + charts + recent inspections + Orange List summary (will be redesigned per role).
- Asset Registry: Search + filtering + CRUD (admin-only actions).
- Inspections: Individual + SIG.
- Orange List: Defective tracking and approval workflow.
- Notifications: In-app bell dropdown + unread count + mark-all-read.
- Schedules: Due/overdue tracking + due-today list (later replaced with frequency-based schedules).
- User Management: CRUD + assignments.
- Admin Panel: Departments, Stations, Locations, Asset Types + checklist builder.
- Role Management: Superadmin can grant/revoke Admin.
- File Upload: Photo evidence upload and preview.
- Audit Logging.
- Seed script.

Testing / Exit criteria met:
- Backend: 100% pass rate for tested flows.
- Frontend: 95%+ for major user journeys.

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
  - On inspection submission, assets update `last_inspected` and compute `next_due = now + freq_days` when frequency exists.
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
**Why:** User requested schedules to be the primary operational view (week default) and role-based navigation, plus supervisor transfer handling.

Delivered:
1. **Sidebar RBAC changes** (Frontend: `AppLayout.js`):
   - Asset Registry: visible **only** to Superadmin.
   - Orange List: visible only to **Superadmin/Admin/Reporting Officer**.
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
   - Admin/Superadmin/RO view: pick supervisor dropdown → view schedule.

4. **Admin Panel — Transfer tab** (`AdminPage.js`):
   - New “Transfer” tab.
   - From/To supervisor dropdowns + “Unassign” option.
   - Calls transfer endpoint.

Verification:
- Tested backend with scripted requests.
- Tested UI with screenshot tool across Superadmin and Supervisor roles.

---

### Phase 4 — Dashboards + Notifications UX/Logic (Next, P1) ⏳ PENDING (awaiting remaining user input)
**Goal:** Implement role-specific dashboards and a clean, minimal UX per the new dashboard requirements.

Known requirements from user (captured):
- Dashboard should be minimalistic; remove “Orange/Red list (active)” block from dashboard.
- Supervisor dashboard (planned): station dropdown, dept highlight, asset-type buttons with summary counts, My Tasks (My Assets / Pending Tasks), single-asset inspection via task click, health pie charts, My Performance metrics.
- Approving Supervisor dashboard (planned): station dropdown + department dropdown, My Supervisors analytics, station health pie, collapsible station → asset category → assets list, My Tasks = approvals queue with Pass/Fail.
- **Every inspection requires approval** (Approving Supervisor or Superadmin). Fail should revert effective state and preserve defect aging.

Missing inputs (blocked by user):
- Admin dashboard logic.
- Reporting Officer dashboard logic.

Implementation steps:
1. Dashboard design pass: implement Supervisor + Approving Supervisor first, then Admin/RO when user provides logic.
2. Add a dedicated Notifications page/button (user requested earlier) after dashboard scope is locked.
3. Implement updated approval workflow (Pass/Fail for all inspections) and integrate into dashboards “My Tasks”.

Exit criteria:
- Supervisor and Approving Supervisor dashboards match the agreed logic.
- Approval queue works end-to-end (Pass/Fail + audit + history integrity).

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
1. **Continue Phase 4 ideation**: user to provide Admin + Reporting Officer dashboard logic.
2. Implement **Supervisor dashboard** and **Approving Supervisor dashboard** per the detailed requirements already provided.
3. Implement **inspection approval for every inspection** (Pass/Fail), ensuring defect aging and inspection history rules.
4. Add Notifications full-page view (after dashboard UX is finalized).

---

## Success Criteria
- Core workflow works reliably with full audit trail.
- Scheduling:
  - Frequency is configured in days.
  - Supervisor/Approving Supervisor/Admin can view schedules as requested (week default + date range).
  - Supervisor transfer/reassignment supported.
- Dashboards are role-specific, minimal, and operationally useful.
- Every inspection requires approval at the station level (Approving Supervisor/Superadmin).
- Notifications and approvals are actionable from the UI.
