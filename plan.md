# plan.md

## Objectives
- Deliver an MVP Railway Asset Inspection Management System for passenger-amenity assets with: asset master data, inspections (individual + SIG), Orange List workflow, scheduling/overdue tracking, photo evidence uploads, and multi-role access.
- Ensure the **core workflow** is proven end-to-end: inspection → mark defective → Orange List → mark working → approving supervisor field-verifies/approves → removed from Orange List.
- Provide operational visibility with an in-app notification center (bell icon + unread count) and auditable event history.
- Prepare for production readiness: reporting/analytics, hardening, and external notifications (SMS/WhatsApp) + strict RBAC enforcement.

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
  - UX improvement: assets load on station select; location refines the list.
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

### Phase 3 — Hardening + Reporting + Schedules/Overdue UX (Future)
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
- Overdue logic stable; metrics consistent; no broken flows from Phase 2.

---

### Phase 4 — Full RBAC Enforcement + External Notifications (SMS/WhatsApp) (Future)
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
1. Confirm external notification provider for **SMS + WhatsApp** (Twilio vs other) and obtain API keys for integration.
2. Decide photo storage target for production (local dev + S3-compatible in prod, e.g., MinIO/S3) and implement storage abstraction if needed.
3. Prioritize Phase 3 reporting requirements (exact KPIs, export formats, and management dashboards).

---

## Success Criteria
- Core flow works reliably: inspection → defect → Orange List → mark working → approve → removed, with full audit trail.
- SIG inspection works: station-wide coverage + participant list.
- Photos upload and display correctly.
- Scheduling produces correct due/overdue states and surfaces them clearly.
- Notifications: in-app works end-to-end; SMS/WhatsApp ready after provider integration.
- After Phase 4: RBAC correctly restricts access by role + station + department with strong security guarantees.
