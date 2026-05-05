# plan.md

## Objectives
- Deliver a production-usable Railway Asset Inspection Management System with:
  - Asset master data (stations/locations/asset types/assets)
  - Inspections (individual + SIG)
  - Defect tracking + Orange/Red list aging
  - Approval workflow (mark working → approve)
  - Scheduling/due tracking
  - Photo evidence uploads
  - Multi-role access with clear UX
- Ensure the **core workflow** is proven end-to-end: inspection → mark defective → Orange List → mark working → approving supervisor field-verifies/approves → removed from Orange List.
- Provide operational visibility with analytics dashboards, exports, in-app notifications, and auditable event history.
- Improve day-to-day usability with **neat, categorized, collapsible UIs**, and quick access to **asset history** and **user inspection history** via modals/slide-outs.
- Prepare for production readiness: reporting/analytics, UX hardening, and external notifications (SMS/WhatsApp) + strict RBAC enforcement.

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
- **Authentication:** Employee ID + Password + JWT (login + session persistence).
- **App shell:** Responsive layout (sidebar + topbar) + notification bell.
- **Dashboard:** KPI stats, recent inspections, Orange List summary.
- **Asset Registry:** Search + filtering + CRUD (admin-only actions).
- **Inspections:**
  - Individual: station → location → assets → status/checklist/remarks/photos.
  - SIG: station-wide assets, participant selection, submit by approving supervisor.
  - UX: assets load on station select; location refines the list.
- **Orange List:** Defective tracking, mark working, approve/resolved workflow.
- **Notifications:** In-app bell icon + unread count + mark-all-read.
- **Schedules:** Due/overdue tracking + due-today list.
- **User Management:** CRUD + station assignment + role assignment.
- **Admin Panel:** Departments, Stations, Locations, Asset Types + checklist builder.
- **Role Management:** Superadmin can grant/revoke Admin powers.
- **File Upload:** Photo evidence upload and preview.
- **Audit Logging:** Key events captured and viewable via API.
- **Seed script:** Creates Superadmin + sample data for immediate usage.

Testing / Exit criteria met:
- Backend: **100% pass rate** (all tested endpoints and flows).
- Frontend: **95%+** (all major user journeys validated; only minor UX notes).
- A user can operate the app end-to-end in the browser with seeded data.

---

### Phase 2.1 — Admin Panel UX Improvements + Inspection Checklist Rendering ✅ COMPLETE
**Goal:** Implement requested admin UX changes and ensure checklists appear during inspection.

Delivered:
- Admin Panel:
  - ✅ Edit/update for Stations
  - ✅ Edit/update for Locations
  - ✅ Locations view reorganized into a station-grouped accordion
  - ✅ Edit/update for Asset Types (including checklist)
- Inspection Flow:
  - ✅ Checklist from Asset Type appears during inspection for selected assets
  - ✅ Checklist items are interactive and submitted with inspection payload

Exit criteria met:
- Checklist verified in UI during inspection (screenshots + live verification).

---

### Phase 3 — UX Restructure + Assignment Improvements (Current / Next)
**Goal:** Implement the next set of changes across Users, Assets, Inspections, and History for a categorized, faster workflow. Add supervisor assignment control in Asset Registry.

#### 3.1 User Management (Departments-first + categorized roles) (P0)
User stories:
1. As Admin/Superadmin, I can see **Departments first** and expand to see users.
2. Users inside a department are grouped by role (Supervisors, Approving Supervisors, Reporting Officers, Others).
3. I can still search users and filter by role across the full dataset.
4. I can **edit** and **delete** users.

Implementation steps:
- Frontend (`UsersPage.js`):
  - Replace flat list with department-grouped accordion.
  - Within each department, render role sections with counts.
  - Preserve existing search + role filter; apply after grouping.
  - Add Edit action that opens a modal/slide-out with the existing create form fields.
- Backend:
  - Reuse existing `PUT /api/users/{id}`.
  - Confirm `DELETE /api/users/{id}` is stable and add safeguards (cannot delete self, optionally cannot delete superadmin).

Exit criteria:
- Users page supports Create, Edit, Delete.
- Department accordion + role grouping works with search/filter.

#### 3.2 Asset Registry (Grouped by Asset Type + asset detail + supervisor assignment) (P0)
User stories:
1. As Admin/RO, I see assets grouped under headings of each **Asset Type** (collapsible).
2. Asset name is clickable → opens a slide-out showing that asset’s inspection history.
3. For each asset, I can see assigned **Supervisor(s)** for that asset’s station+department.
4. As Admin, I can manually **allot/assign** an asset to a selected supervisor (not auto-only).

Implementation steps:
- Data model change:
  - Add `assigned_supervisor_ids: string[]` (or `assigned_supervisor_id: string`) to `assets`.
  - Decide single vs multiple assignment:
    - Default: single primary supervisor (simpler) but allow future extension.
- Backend:
  - Update Asset schemas and endpoints:
    - `POST/PUT /api/assets` accept supervisor assignment.
    - `GET /api/assets` returns assigned supervisors (ids + display names) and available supervisors for assignment (optional).
  - Add helper endpoint if needed:
    - `GET /api/users/supervisors?station_id=...&department_id=...` → active supervisors list.
- Frontend (`AssetsPage.js`):
  - Group by asset type with Collapsible/Accordion sections.
  - Add supervisor “chip/button” (clickable) to open **Supervisor Inspection History** slide-out.
  - Add “Assign Supervisor” action in asset card (Admin-only) to choose from supervisors filtered by station+department.
  - Make asset number clickable to open Asset History slide-out.

Exit criteria:
- Assets are grouped by type, collapsible.
- Asset detail slide-out works.
- Supervisor assignment is manual and visible.

#### 3.3 New Inspection (Assets grouped by Asset Type + quick history access) (P0)
User stories:
1. During inspection, assets appear grouped by **Asset Type** (collapsible headers).
2. Asset name is clickable → opens asset history slide-out without leaving the inspection form.

Implementation steps:
- Frontend (`InspectionPage.js`):
  - Transform assets list into groups keyed by `asset_type_name`.
  - Add clickable asset number that opens asset history slide-out.
  - Keep selection controls intact for both Individual and SIG modes.

Exit criteria:
- Inspection page shows grouped assets and history slide-out.

#### 3.4 Inspection Date/Time Fixes (Manual entry + calendar UI distortion) (P0)
User stories:
1. Inspector can enter **inspection date/time manually** (for history correctness).
2. Calendar popover renders correctly (no distortion).
3. Time selection saves exactly what the user selected.

Implementation steps:
- Backend:
  - Extend inspection create schema to accept `inspection_datetime` (ISO) and store it (instead of only server `created_at` for display).
  - Keep `created_at` as system timestamp; add `inspection_at` as user-provided.
- Frontend:
  - Add date+time input to inspection submission (top-level for the inspection).
  - Fix Popover/Calendar CSS constraints (z-index, overflow containers, width).
  - Fix time parsing and ISO generation to prevent “random time”.

Exit criteria:
- Inspection list/detail uses `inspection_at` for display.
- Manual date/time works reliably.

#### 3.5 Inspection History (Asset-wise, latest-first, collapsible + clickable) (P0)
User stories:
1. Inspection history view is asset-wise (not station-wise list).
2. Under each asset heading, inspections are ordered **latest → oldest**.
3. Headings are collapsible for neat UI.
4. Asset name clickable → opens asset history slide-out.

Implementation steps:
- Backend:
  - Add endpoint(s) for asset-centric history:
    - `GET /api/inspections/by-asset?asset_id=...`
    - or `GET /api/assets/{id}/inspections`.
  - Enrich inspection items with asset_number/type_name for display.
- Frontend (`InspectionHistoryPage.js`):
  - Replace flat inspection list with asset-grouped accordion.
  - Keep existing filters (station/type) but apply to grouped results.
  - Add slide-out details for inspection and asset.

Exit criteria:
- History page is asset-first, collapsible, clickable.

---

### Phase 4 — Hardening + Reporting + Schedules/Overdue UX (Future)
**Goal:** Make the MVP production-ready and management-usable with stronger reporting, reliability, and scheduling experience.

User stories:
1. Admin/RO can set/adjust inspection frequency per asset type and/or per asset with bulk operations.
2. Supervisors can see what’s due today/this week for their assigned stations (personalized queues).
3. RO can export Orange List + inspection history (station/department/date filters).
4. Approving supervisors can see a focused “Pending Approvals” queue and complete verification quickly.
5. Management can view completion/overdue metrics by station, department, asset type, and time.

Implementation steps:
- Reporting endpoints + UI widgets:
  - Completion rate, overdue counts, defect aging, recurring defect hotspots.
  - Trends by station/department/asset type.
- Scheduling UX improvements:
  - “My Due Items” queue, calendar/list toggle, bulk scheduling.
  - Clear overdue severity and aging indicators.
- Background processing:
  - Scheduler job/worker to compute due/overdue, generate notification outbox messages, and retry.
- Notification hardening:
  - Persist delivery attempts, retry policy, admin visibility for failures.
- Data quality + audit hardening:
  - Stronger validation, idempotency on inspection submission, and improved audit log structure.
- Testing:
  - Regression suite for workflows + schedule computations; E2E test pass.

Exit criteria:
- Overdue logic stable; metrics consistent; no broken flows from Phase 3.

---

### Phase 5 — Full RBAC Enforcement + External Notifications (SMS/WhatsApp) (Future)
**Goal:** Enforce strict role- and assignment-based access + integrate external notifications.

User stories:
1. Users log in with Employee ID + password; secure sessions and refresh flow as needed.
2. Admin can create users and assign roles, departments, and stations with enforceable constraints.
3. RO only sees stations/departments assigned to them; supervisors constrained to assigned stations/areas.
4. Superadmin can grant/revoke admin privileges safely with full audit.
5. RO receives SMS/WhatsApp alerts for new defective assets (and optional reminders for overdue inspections).

Implementation steps:
- RBAC enforcement:
  - Backend route guards by role + assigned stations + department.
  - Frontend route/menu guards aligned with backend.
  - Prevent privilege escalation and enforce least-privilege.
- External notification integration:
  - Choose provider (e.g., Twilio or equivalent) for SMS + WhatsApp.
  - Implement provider adapters + outbox/retry logic.
  - Admin settings for enabling/disabling channels per role/station.
- Security hardening:
  - Rate limiting on login, password policy, audit all role changes.
- Testing:
  - Multi-user role tests validating access boundaries; notification delivery tests in staging.

Exit criteria:
- No privilege escalation; all role restrictions validated.
- SMS/WhatsApp notifications deliver reliably with retries and failure visibility.

---

## Next Actions
1. **Phase 3 execution order (recommended):**
   - 3.4 Inspection date/time fixes (unblocks accurate history)
   - 3.1 User management restructure + edit
   - 3.2 Asset registry grouping + supervisor assignment
   - 3.3 New inspection grouping + quick asset history
   - 3.5 Inspection history asset-wise restructure
2. Confirm **single vs multiple supervisor** assignment per asset (defaulting to single primary).
3. Confirm naming/UX for slide-outs:
   - “Asset History” drawer
   - “Supervisor History” drawer

---

## Success Criteria
- Core flow works reliably: inspection → defect → Orange List → mark working → approve → removed, with full audit trail.
- Admin UX supports fast maintenance: categorized pages, modals/slide-outs, minimal scrolling.
- Assets are discoverable by type; asset and supervisor histories are one click away.
- Manual inspection date/time is accurate and consistently displayed.
- Scheduling produces correct due/overdue states and surfaces them clearly.
- Notifications: in-app works end-to-end; SMS/WhatsApp ready after provider integration.
- After Phase 5: RBAC correctly restricts access by role + station + department with strong security guarantees.
