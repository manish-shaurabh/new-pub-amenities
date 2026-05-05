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
- Reduce recurring UI regressions by standardizing Shadcn `<Select>` placeholder handling (never use empty string values).

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
**Goal:** Implement the next set of changes across Users, Assets, Inspections, and History for a categorized, faster workflow.

#### Phase 3.0 — Stability Fix: Asset Registry Edit Crash (Shadcn Select empty string) ✅ COMPLETE
Context / root cause:
- Asset Registry Edit modal crashed due to Shadcn UI `<SelectItem>` using an empty string: `<SelectItem value="">No Assignment</SelectItem>`.

Fix implemented:
- Frontend (`/app/frontend/src/pages/AssetsPage.js`):
  - Replaced `value=""` with `value="none"` for “No Assignment”.
  - Updated `handleCreate` and `handleUpdate` to map `"none" → null` when sending to backend.

Verification:
- Confirmed via screenshot tool:
  - Edit modal opens cleanly.
  - Assigned Supervisor dropdown opens and shows “No Assignment” + supervisor list without crashing.

Hardening note (recurring regression):
- Standardize: **never use empty string values in Shadcn SelectItem**; use sentinel values (e.g., `"none"`) and translate in handlers.

---

#### 3.1 User Management (Departments-first + categorized roles) ✅ COMPLETE
Delivered (recent session):
- User Management moved inside Admin Panel.
- Station Personnel Mapping implemented in Admin Panel.
- Linking Supervisors to Reporting Officers implemented (backend + frontend).

Exit criteria met:
- Admin Panel supports dynamic user management with station personnel mapping and supervisor → reporting officer linking.

---

#### 3.2 Asset Registry (Grouped by Asset Type + asset detail + supervisor history) ✅ COMPLETE
Delivered (recent session):
- Asset Registry grouped by type.
- Shows supervisor names.
- Clickable supervisor name opens Supervisor History drawer.
- Clickable asset number opens Asset History drawer.

Note:
- Manual “assign supervisor” functionality exists via `assigned_supervisor_id` in asset form.

---

#### 3.3 New Inspection (Role-based filtering + rectification timestamp + photo deletion + remarks attribution) ✅ COMPLETE
Delivered (recent session):
- Role-based filtering:
  - Superadmin: sees all.
  - Approving supervisor: sees assigned stations.
  - Supervisor: sees assigned station + department.
- Inspection flow enhancements:
  - Backdated defect logging supported.
  - “Remarks By” tracking stored.
  - “Rectified On” date/time picker when marking a defective asset as OK.
  - Photo management: allow delete before submission.

---

#### 3.4 Inspection History (Asset-wise grouping) ✅ COMPLETE
Delivered (recent session):
- Inspection History restructured to be asset-wise grouped.

---

### Phase 4 — Dashboards + Notifications UX/Logic (Next, P1) ⏳ NOT STARTED
**Goal:** Implement role-specific dashboards and a clear, actionable notifications UX.

Dependency:
- User explicitly requested: **ideate on dashboards and notifications before implementation**.

User stories (to be finalized with user):
1. Each role sees a dashboard relevant to their responsibilities:
   - Superadmin → global health overview.
   - Admin → admin ops overview.
   - Reporting Officer → assets/defects/approvals relevant to their reporting scope.
   - Approving Supervisor → pending approvals queue and station health.
   - Supervisor → my assets, due inspections, my defects.
2. Notifications are visible in a dedicated view (in addition to bell dropdown), filterable, and markable as read.
3. Notification triggers align with the Orange/Red escalation and approval workflow.

Implementation steps:
- Ideation workshop (with user):
  - Confirm KPI/widget list per role.
  - Confirm notification trigger events and recipients.
  - Confirm whether Red/Orange should generate reminders and on what cadence.
- Backend:
  - Add/adjust analytics endpoints as needed (aggregation by station/department/type/time).
  - Ensure notification query endpoints support pagination/filters (unread, type, date range).
- Frontend:
  - Build role-specific dashboard layouts.
  - Add Notifications page/button to view all notifications.

Exit criteria:
- User-approved dashboard definitions and notification triggers documented.
- Dashboard and notifications implemented and verified for at least Superadmin + one operational role.

---

### Phase 5 — Hardening + Reporting + Schedules/Overdue UX (Future)
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
- Overdue logic stable; metrics consistent; no broken flows from Phase 4.

---

### Phase 6 — Full RBAC Enforcement + External Notifications (SMS/WhatsApp) (Future)
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
1. **Phase 4 ideation session** (Dashboards + Notifications): user to provide role-wise KPI logic and notification trigger events.
2. Based on ideation outcomes:
   - Implement dashboard endpoints/widgets.
   - Add Notifications full-page UI.
3. Prevent recurrence:
   - Add a quick repo check (grep/lint rule) to fail CI/build if `SelectItem value=""` exists.

---

## Success Criteria
- Core flow works reliably: inspection → defect → Orange List → mark working → approve → removed, with full audit trail.
- Admin UX supports fast maintenance: categorized pages, modals/slide-outs, minimal scrolling.
- Assets are discoverable by type; asset and supervisor histories are one click away.
- Rectification tracking captures “Rectified On” accurately and is visible in history.
- Scheduling produces correct due/overdue states and surfaces them clearly.
- Notifications: in-app works end-to-end; Notifications page provides complete visibility.
- After Phase 6: RBAC correctly restricts access by role + station + department with strong security guarantees; external SMS/WhatsApp ready/working.
