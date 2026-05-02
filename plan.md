# plan.md

## Objectives
- Deliver an MVP Railway Asset Inspection Management System for passenger-amenity assets with: asset master data, inspections (individual + SIG), Orange List workflow, scheduling/overdue tracking, photos, and role-based access.
- Prove the **core workflow** end-to-end before scaling: create inspection → mark defective → Orange List → mark working → approving supervisor verifies/approves → removed from Orange List.
- Stand up notification infrastructure: in-app notifications live; SMS/WhatsApp pluggable (provider TBD).

---

## Implementation Steps

### Phase 1 — Core Flow POC (isolation, must pass before full app)
**Goal:** Validate the hardest parts with minimal UI: workflows + file upload + notification hooks.

User stories:
1. As a supervisor, I can submit an inspection for an asset with status, checklist answers, remarks, and photos.
2. As a supervisor, I can mark an asset defective and see it appear in the Orange List.
3. As a supervisor/RO, I can mark a defective asset as “working (pending approval)”.
4. As an approving supervisor, I can verify in the field and approve “working” so it exits the Orange List.
5. As an RO, I receive an in-app alert when assets in my dept+station are marked defective.

Steps:
- Web search: best practices for FastAPI + MongoDB modeling (events/audit), multipart uploads to object storage, and notification architecture (outbox pattern).
- Minimal backend (FastAPI + MongoDB) with seed script:
  - Entities: Department, Station, Location, AssetType (with checklist schema), Asset, User (no auth yet), Inspection, DefectTicket(Orange List item), Notification.
  - Core endpoints (no RBAC yet): create inspection, upload photo(s), mark defective, list Orange items, mark working, approve working, list notifications.
- File upload POC:
  - Implement object storage adapter (local/S3-compatible) + store URLs in Mongo.
  - Confirm upload + retrieval works.
- Notification POC:
  - In-app notifications persisted.
  - SMS/WhatsApp adapters as interfaces + stub “send” implementation (logs) + outbox table/collection to prevent loss.
- POC verification checklist (must be green):
  - One inspection submission creates immutable record.
  - Defective → Orange item created with correct asset link and responsible RO resolved.
  - Mark working sets status to pending-approval; approve closes Orange item.
  - Photos upload and are viewable.
  - In-app notification created for RO.

Exit criteria:
- Scripted test (pytest or simple runner) proves the full flow with real Mongo + real file writes.

---

### Phase 2 — V1 App Development (MVP UI + core modules; defer auth until Phase 4)
**Goal:** Build usable web app around proven core; include RBAC guards only after auth phase.

User stories:
1. As an admin, I can create stations, locations, departments, asset types (with checklist), and assets.
2. As a supervisor, I can quickly filter my station/location assets and perform an individual inspection.
3. As an approving supervisor, I can start a SIG inspection for a station and submit it with participant names.
4. As an RO, I can view all defective assets for my dept+station and their current rectification state.
5. As any user, I can view Orange List and drill into history (inspections + status changes + photos).

Steps:
- Frontend (React + shadcn):
  - Pages: Asset Registry, Inspection (Individual), SIG Inspection, Orange List, Notifications (bell), Basic Dashboard.
  - UX focus: fast asset search, offline-friendly form behavior (draft/save locally optional), photo capture/upload.
- Backend expansion:
  - Full CRUD: Departments, Stations, Locations, AssetTypes (checklist schema), Assets, Users (still no auth enforcement).
  - SIG inspection: generates station-wide asset checklist; one submission includes participants (names + employee IDs).
  - Scheduling: per-asset frequency + next_due calculation; overdue query endpoints.
  - Audit trail: append-only event log for asset status changes and approvals.
- Integrate frontend↔backend; ensure all states handled (loading/empty/error).
- End Phase 2: 1 round E2E testing (core journeys + SIG + uploads).

Exit criteria:
- A user can operate the app end-to-end in browser with seeded data and no manual DB edits.

---

### Phase 3 — Hardening + Reporting + Schedules/Overdue UX
**Goal:** Make MVP reliable and manager-usable.

User stories:
1. As an admin/RO, I can set/adjust inspection frequency per asset type or per asset.
2. As a supervisor, I can see what’s due today/this week for my assigned stations.
3. As an RO, I can export a station’s Orange List and inspection history.
4. As an approving supervisor, I can see pending approvals queue and complete verification quickly.
5. As management, I can view completion/overdue metrics by station and department.

Steps:
- Reporting endpoints + UI widgets: completion rate, overdue counts, defect aging, top defective asset types.
- Scheduler job (app-level cron/worker):
  - Generates due/overdue flags and notification outbox items.
- Notification improvements:
  - Persist delivery attempts; retry policy; admin view for failures.
- Testing: add regression suite for workflows + schedule computations.
- End Phase 3: 1 round E2E testing.

Exit criteria:
- Overdue logic stable; metrics consistent; no broken flows from Phase 2.

---

### Phase 4 — Authentication + RBAC + External Notifications (provider integration)
**Goal:** Secure system with EmployeeID+Password + JWT and enforce role permissions; integrate SMS/WhatsApp when provider chosen.

User stories:
1. As a user, I can log in using employee ID + password and stay signed in securely.
2. As an admin, I can create users and assign roles, departments, and stations.
3. As an RO, I only see stations/departments assigned to me.
4. As superadmin, I can grant/revoke admin privileges.
5. As an RO, I receive SMS/WhatsApp alerts for new defective assets (when enabled).

Steps:
- Implement auth (password hashing, JWT, refresh, session invalidation).
- RBAC enforcement on backend routes + frontend route guards.
- Provider integration (Twilio or other) once selected; keep adapters.
- End Phase 4: 1 round E2E testing including multi-user role checks.

Exit criteria:
- No privilege escalation; all role restrictions validated; notifications deliver in real channel (if keys provided).

---

## Next Actions
1. Confirm notification provider approach: **Twilio vs other vs keep stub until keys**.
2. Confirm object storage target for photos: **local dev + S3-compatible in prod** (e.g., MinIO/S3).
3. Proceed with Phase 1 POC: implement minimal data model + endpoints + file upload + in-app notification + scripted flow test.

---

## Success Criteria
- Core flow works reliably: inspection → defect → Orange List → mark working → approve → removed, with full audit trail.
- SIG inspection works: station-wide assets + participant list + multi-dept coverage.
- Photos upload and display correctly in UI.
- Scheduling produces correct due/overdue states and surfaces them in UI.
- Notifications: in-app works end-to-end; SMS/WhatsApp infra ready and integratable without refactor.
- After auth phase: RBAC correctly restricts access by role + station + department.