# plan.md

## Objectives
- Deliver a production-usable **Railway Asset Inspection Management System** with:
  - Asset master data (departments/stations/locations/asset types/assets)
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
    - **Bulk asset allocation / reassignment from Superadmin dashboard** (done)
  - Operational visibility:
    - Role dashboards (Supervisor, Approving Supervisor, Reporting Officer, Admin, Superadmin)
    - Minimal, clean UI with charts where helpful
    - Actionable “My Tasks” and approvals queue
    - **Superadmin “View as” for RO/ASUP/Supervisor dashboards** (done)
  - Reporting:
    - Print-friendly inspection report including all remarks + photos
  - Notifications:
    - Bell dropdown (done)
    - **Full Notifications page** with pagination + filters + search + bulk actions + deep links (done)
  - **Manual Defect Marking (Admin/Superadmin):**
    - Mark an asset defective without a full inspection
    - Capture **failure date+time** (starts orange/red clock)
    - Auto-create audit trail + inspection history entry + orange list + notifications to full chain
  - **Department Governance:**
    - Only **Superadmin** can create/update/delete departments (Admin and below are read-only)
    - **Post-fix UX:** Department creation requires **Name + Code (1–8 chars)** with inline validation, and safe error rendering

- Ensure the core workflow is proven end-to-end:
  - inspection submit → items pending approval → Pass applies effects → defect aging continues correctly
  - Fail keeps previous effective state and logs gap time
  - manual mark-defective → orange-list entry + synthetic inspection + notifications fan-out

- Reduce recurring UI regressions by:
  - Standardizing Shadcn `<Select>` placeholder handling (**never use empty string values**)
  - Standardizing error rendering (avoid React crash on structured validation errors)
  - Prefer inline field-level validation for required form fields (Departments first; extend where needed)

- Improve maintainability and scalability:
  - **Backend refactored by splitting `server.py` into routers** while preserving route paths, `/api` prefix behavior, CORS, static mounts, and helper semantics (done).
  - Ensure large list endpoints support **server-side pagination** for performance.

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
   - `GET /api/schedules/approving-supervisor/{user_id}/supervisors`
   - `POST /api/admin/transfer-supervisor`
3. **Frontend Schedules UI redesign**:
   - Supervisor view: date range picker + presets + grouped tasks.
   - Approving Supervisor view: supervisor cards → click opens that supervisor schedule.
   - Admin/Superadmin/RO view: supervisor picker (later replaced by multi-filter).
4. **Admin Panel — Transfer tab**:
   - From/To supervisor dropdowns + “Unassign” option.

---

#### Phase 3.0.3 — Superadmin Optional Advanced Schedules Filters ✅ COMPLETE
Delivered:
- Backend:
  - `GET /api/schedules/admin` with optional multi-filters.
- Frontend:
  - Multi-select filter UI + clear filters.

---

#### Phase 3.0.4 — Inspection Approval Overhaul (Every inspection item needs Pass/Fail) ✅ COMPLETE
Delivered:
- Inspection submission stores each item as `approval_status=pending_approval`.
- Endpoints:
  - `GET /api/inspections/pending-approvals?reviewer_id=`
  - `POST /api/inspections/{inspection_id}/items/{item_index}/approve`
  - `POST /api/inspections/{inspection_id}/items/{item_index}/reject`
- Behavior:
  - **Pass:** applies effects (asset state, orange list insert, schedule updates).
  - **Fail:** no asset state change; logs `gap_seconds` in audit.
- Notifications:
  - Notifies station ASUP + admins/superadmins on submission.
  - Notifies inspector on approve/reject.

---

#### Phase 3.0.5 — Performance Analytics Endpoints ✅ COMPLETE
Delivered:
- `GET /api/analytics/supervisor/{user_id}`
- `GET /api/analytics/approving-supervisor/{user_id}/supervisors`
- `GET /api/analytics/asset/{asset_id}`

---

### Phase 4 — Role Dashboards (Minimalistic, Operational) ✅ COMPLETE
**Goal:** Implement role-specific dashboards with minimal, clean UI.

#### Phase 4.1 — Supervisor Dashboard ✅ COMPLETE
Delivered:
- Role-scoped station dropdown + department badge.
- Tabs: Overview / My Tasks / My Performance.
- Category buttons show **% functional time**.

---

#### Phase 4.2 — Single-Asset Inspection Deep Link ✅ COMPLETE
Delivered:
- `/inspection?asset_id=...` preloads the asset and runs in single-asset mode.

---

#### Phase 4.3 — Approving Supervisor Dashboard ✅ COMPLETE
Delivered:
- Oversight scope across ASUP stations.
- Clickable category cards → priority vs working list.
- “My Supervisors” analytics.
- Approvals queue UI.

---

#### Phase 4.4 — Reporting Officer Dashboard ✅ COMPLETE
Delivered:
- Same as ASUP dashboard but scoped and department-locked.

---

#### Phase 4.5 — Superadmin Dashboard Redesign (V1) ✅ COMPLETE
Delivered:
- Minimal operational dashboard with drill-down summary tabs.

---

#### Phase 4.6 — Inspection History Role-Scoping ✅ COMPLETE
Delivered:
- Backend `GET /api/inspections` supports `for_user_id` scoping.
- Frontend passes `for_user_id` for non-superadmin/admin roles.
- Pass/Fail/Pending badges per item.
- Deep-linking support:
  - `?asset_id=` (done)
  - `?inspection_id=` focus (done in Phase 6)

---

### Phase 5 — Notifications, Admin Dashboard, and Reporting ✅ COMPLETE

#### Phase 5.1 — Notifications scoping + deep links ✅ COMPLETE
Delivered:
- Bell dropdown with unread count, mark-all-read.
- Click notification → mark read → deep link into Inspection History.

---

#### Phase 5.2 — Admin Dashboard (filters + RO summaries) ✅ COMPLETE
Delivered:
- Admin dashboard implemented with optional multi-filters.

---

#### Phase 5.3 — Inspection Report Generation ✅ COMPLETE
Delivered:
- Print-friendly inspection report (`window.print()`) auto-open after submission and accessible from history modal.

---

### Phase 6 — Notifications Page + Deep-Link Focus + Backend Router Refactor ✅ COMPLETE
**Goal:** Improve operational usability (notifications discoverability + deep links) and backend maintainability.

#### Phase 6.1 — Full Notifications Page (new route) ✅ COMPLETE
Delivered:
- New route: **`/notifications`**
- UI features:
  - Pagination (20/page)
  - Filters: All/Unread/Read, Type, From/To date
  - Search (title/message)
  - Bulk actions: **Mark all read**, **Delete read** (with confirm)
  - Per-notification actions: open related, mark read/unread, delete
- App integration:
  - Sidebar nav item **Notifications** with unread badge
  - Bell dropdown includes **“View all notifications”** button
- Backend:
  - Extended `GET /api/notifications`:
    - Backwards-compatible flat list (default)
    - `paginated=true` response envelope with `items/total/page/page_size/total_pages`
    - Filters: `search`, `notification_type`, `from_date`, `to_date`
  - New endpoints:
    - `POST /api/notifications/{id}/unread`
    - `DELETE /api/notifications/{id}`
    - `POST /api/notifications/delete-read?user_id=`

#### Phase 6.2 — Implement `?inspection_id=` deep-link focus on Inspection History ✅ COMPLETE
Delivered:
- `/inspection-history?inspection_id=<id>`:
  - Auto-opens the **Inspection Details** modal
  - Renders an **“All Asset Items (N)”** section so the deep-link works for multi-item inspections
  - Handles not-found / not-in-scope by showing a user-facing error toast

#### Phase 6.3 — Refactor backend by splitting `/app/backend/server.py` into routers ✅ COMPLETE
Delivered:
- Refactored backend from a ~3084-line `server.py` into:
  - `server.py` (entry point, slim)
  - `helpers.py` (shared helper functions)
  - `routers/*.py` (router modules)
- Preserved:
  - Exact `/api/...` paths and methods
  - CORS settings
  - Static mount: `/api/uploads`
  - `serialize_doc` behavior

#### Phase 6.4 — Testing & verification for Phase 6 ✅ COMPLETE
Testing approach (per instruction: **use both**):
- Backend: 34/35 tests passed (**97.1%**)
- Frontend: **100%** pass rate, no regressions observed

---

### Phase 7 — Superadmin Dashboard Overhaul + View-As + Asset Allocation ✅ COMPLETE
**Goal:** Upgrade Superadmin to a true command-center dashboard:
- Category-wise health (like RO dashboard)
- Station-wise health (like RO dashboard)
- Department health replacing “divisions”
- Clickable drill-down for every overview tile
- Ability for Superadmin to enter RO/ASUP/Supervisor dashboards via click
- Direct asset allocation/reassignment from Superadmin dashboard

#### Phase 7.1 — Superadmin Overview: Category/Station/Department health blocks ✅ COMPLETE
Delivered:
- Superadmin overview now shows:
  - **Asset category-wise health** (working/orange/red + % functional)
  - **Station-wise health** (working/orange/red + % functional)
  - **Department-wise health** (working/orange/red + % functional)
- Added **multi-station filter** (popover multi-select with search)

Backend support:
- `GET /api/dashboard/superadmin` accepts `station_ids` (multi) and returns:
  - `asset_categories`, `stations`, `departments`
  - `pct_functional` per group
  - `available_stations` for filter
  - `supervisors` list with asset counts

#### Phase 7.2 — Click-to-drill-down asset lists (priority vs working) ✅ COMPLETE
Delivered:
- Every overview card is clickable and opens a **drill-down view** with:
  - Priority list (orange/red) + Working list
  - Back button

Backend support:
- Extended `GET /api/dashboard/oversight/{user_id}/category-assets`:
  - Accepts `department_id`
  - Accepts `station_id` without requiring asset_type_id/department_id

#### Phase 7.3 — “View as” navigation from Superadmin dashboard ✅ COMPLETE
Delivered:
- Superadmin tabs:
  - Reporting Officers
  - Approving Supervisors
  - Supervisors
- Clicking any row navigates to `/?as=<user_id>` and renders that user’s dashboard.

#### Phase 7.4 — Allocate Assets tab (single + bulk) ✅ COMPLETE
Delivered:
- New Superadmin dashboard tab: **Allocate Assets**
  - Quick Assign (single)
  - Bulk Allocate / Reassign

Backend support:
- `POST /api/admin/assets/assign-bulk`

#### Phase 7.5 — Testing & verification for Phase 7 ✅ COMPLETE
- Backend: **100%**
- Frontend: **100%**

---

### Phase 8 — Bug Fixes + Manual Mark-Defective + Orange List Scoping ✅ COMPLETE
**Goal:** Stabilize admin UX, enforce department governance, fix orange list role visibility, and add a manual defect entry path.

#### Phase 8.1 — Fix React runtime error on structured validation errors ✅ COMPLETE
Delivered:
- Added `frontend/src/lib/err.js` with `errString()`.
- Patched error handling across pages/components to prevent React crashes on Pydantic arrays.

#### Phase 8.2 — Departments governance: Superadmin-only manage ✅ COMPLETE
Delivered:
- Backend enforces superadmin-only for POST/PUT/DELETE.
- Frontend shows Depts tab controls only for superadmin; read-only for others.

#### Phase 8.3 — Manual Mark-Defective (Admin/Superadmin) ✅ COMPLETE
Delivered:
- Backend endpoint: `POST /api/assets/{asset_id}/mark-defective`.
- Synthetic inspection + orange list + audit + notifications.

#### Phase 8.4 — Orange List scoping + refresh ✅ COMPLETE
Delivered:
- Backend role-based scoping for Orange List via `for_user_id`.
- Frontend uses scoped calls and has Refresh.

#### Phase 8.5 — Testing & verification for Phase 8 ✅ COMPLETE
- Backend: **100%**
- Frontend: **100%**

---

### Phase 9 — Server-side Pagination for Large Lists + Validation ✅ COMPLETE
**Goal:** Improve performance and UI stability for large datasets.

Delivered:
- Backend:
  - Added/standardized pagination params on:
    - `GET /api/assets`
    - `GET /api/inspections`
    - `GET /api/orange-list`
  - Response envelope validated by testing agent:
    - `{ items, total, page, page_size, total_pages }`
- Frontend:
  - Integrated shared `<Pagination />` component into:
    - `AssetsPage.js`
    - `InspectionHistoryPage.js`
    - `OrangeListPage.js`
- Testing & evidence:
  - Comprehensive test run (iteration_6) validated pagination + drill-down behavior and captured screenshots.

---

### Phase 10 — Department Creation UX Fix (Superadmin) ✅ COMPLETE
**Goal:** Fix the user-reported issue “department creation not working” by improving validation UX and backend rules.

Root cause:
- Backend required `code`, but UI dialog didn’t collect it; validation surfaced only via a brief toast and could be missed.

Delivered:
- Backend:
  - `DepartmentCreate` validators:
    - `code` required, **1–8 chars**, `A-Z0-9` only, auto-uppercase
    - friendly errors
  - Duplicate handling:
    - Pre-check for duplicate name (case-insensitive) and code
    - Returns **409** with user-friendly message
  - Unique index:
    - Unique index on `departments.code` (`uniq_dept_code`)
- Frontend (`AdminPage.js` Depts dialog):
  - Added **Code*** field with:
    - auto-uppercase
    - invalid character stripping
    - inline red validation errors (no more “silent failure”)
  - Required-field asterisks on Name/Code
  - Success toast includes department name
  - Departments list shows a **code badge** next to the name
- Data hygiene (preview environment):
  - Merged duplicate `S&T` department entries and normalized legacy codes to comply with new rules.
- Testing:
  - API smoke tests confirm expected 422/409/200 behavior
  - Screenshot verification confirms inline validation is visible and stable.

**User action required:** Superadmin to verify the improved department creation UX in the UI.

---

## Next Actions (Optional / Future)
1. **P2 — Fix ASUP approval scoping** (OPEN):
   - Current deficiency from iteration_6: Approving Supervisor cannot approve inspections unless `station.approving_supervisor_id` is set.
   - Proposed fix:
     - Allow approval if ASUP is either:
       - station.approving_supervisor_id **OR**
       - station_id is in ASUP `assigned_stations`
   - Also ensure defect notification fan-out includes ASUP via the correct station mapping.
2. Integrate real SMS/WhatsApp provider (adapter infrastructure exists; pending API keys).
3. Add automated unit tests for approval edge cases and schedule computations.
4. Optional: Add notification retention policies and MongoDB indexes for notifications.
5. Optional: Add permission-aware view-as constraints (admin can view-as only within scope) if required.
6. Optional: Add an admin UI to configure umbrella notification recipients instead of hard-coded “Commercial”.

---

## Success Criteria
- Core workflow works reliably with full audit trail.
- Scheduling:
  - Frequency configured in days.
  - Supervisor/ASUP/Admin/Superadmin/RO can view schedules.
  - Supervisor transfer/reassignment supported.
- Dashboards:
  - Supervisor / ASUP / RO / Admin / Superadmin dashboards match agreed logic.
  - Superadmin overview includes category/station/department health + drill-down.
  - Superadmin can view-as RO/ASUP/Supervisor.
  - Superadmin can allocate/reassign assets directly.
  - Approvals actionable (Pass/Fail per item).
  - **% functional time** visible per asset category.
- Approval:
  - Every inspection item requires Pass/Fail approval.
  - Fail preserves defect aging and audit logs gap time.
  - **ASUP approval works for assigned stations** (P2 open item).
- Scoping:
  - Stakeholders see only assigned stations/departments/assets.
  - Orange list is role-scoped when `for_user_id` is provided.
- Pagination:
  - Assets, Inspections, Orange List lists are server-side paginated and stable at scale.
- Notifications:
  - Dropdown remains functional.
  - Full Notifications page supports pagination/filters/search/bulk actions.
  - Defect notifications reach the full chain (Supervisor, ASUP, RO, RO Commercial, Admin, Superadmin).
  - Deep links:
    - `?asset_id=` opens asset drawer
    - `?inspection_id=` opens inspection modal in all-items mode
- Manual defect marking:
  - Admin/Superadmin can mark defective with a failure timestamp.
  - Does not reset the defect clock if already defective.
  - Generates synthetic inspection + orange list entry + audit + notifications.
- Reporting:
  - Printable inspection report available after submission and from history.
- Maintainability:
  - Backend modularized into routers with no route regressions.
- Stability:
  - No Shadcn Select empty-string regressions (`value=""` not used).
  - No React runtime crashes on structured error payloads.
  - Department creation UX is self-explanatory (Name + Code required, inline errors).
