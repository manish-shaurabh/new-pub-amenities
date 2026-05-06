# Railway Asset Inspection Management System — PRD

## Original Problem Statement
Build a production-ready Railway Asset Inspection Management System. Scope includes:
- Asset master data with station/location/type hierarchy
- Assignment logic (role-based: Superadmin → Admin → RO → ASUP → SUP)
- Inspection defect tracking
- Orange/Red list system based on defect duration
- Role-based access control (RBAC)
- Profile tab for RO, ASUP, SUP showing stations and assets

## Architecture
- Stack: FARM (FastAPI, React, MongoDB)
- Auth: JWT with strict RBAC
- Backend: Modular routers in /app/backend/routers/
- Frontend: React pages + Shadcn UI components
- Notifications: Infrastructure present (SMS/WhatsApp pending API keys)

## Role Hierarchy
Superadmin → Admin → Reporting Officer (RO) → Approving Supervisor (ASUP) → Supervisor (SUP)

## Asset Scoping Model (Phase 1 — IMPLEMENTED)
- **Supervisor**: assets where `station_id IN sup.assigned_stations AND asset_type.dept == sup.department_id`
- **ASUP**: assets where `station_id IN asup.assigned_stations` (all depts)
- **RO**: same as Supervisor (station+dept, read-only)
- **Constraint**: per (station, department) → max ONE active Supervisor (enforced on user create/update)
- No more `asset.assigned_supervisor_id` manual assignment

## What's Been Implemented

### Phase 1 — Asset Linkage + Profile Tab (DONE — May 2026)
- Removed `assigned_supervisor_id` from AssetCreate schema and all scoping queries
- Fixed implicit station+dept scoping in inspections.py, orange_list.py, dashboards.py, analytics.py
- Fixed ASUP approval to check `asup.assigned_stations` (403 if station not in jurisdiction)
- Added (station, dept) uniqueness constraint on Supervisor creation/update
- Fixed broadcast_asset_defect_notifications to find ASUP via assigned_stations
- New `GET /api/profiles/{user_id}` endpoint — returns full station/location/asset breakdown
- New ProfilePage.js — role-adaptive: SUP (station→location→assets), ASUP (station→dept→location→assets with dept filter), RO (same as SUP + My Supervisors tab)
- Sidebar: "My Profile" for SUP/ASUP/RO; Orange/Red List now accessible by all roles
- Sidebar user block clickable → navigates to /profile
- Removed "Allocate Assets" tab from SuperadminDashboard (semantically obsolete)
- All tested via testing_agent_v4_fork (iteration_7.json) — 100% backend, 90%+ frontend

### Earlier Features (All DONE)
- Department creation with code (1-8 chars, auto-uppercase, unique)
- Asset Registry with server-side pagination
- Orange/Red List with export PDF/Excel
- Comprehensive inspection flow
- Notification infrastructure
- Admin panel: Users, Stations, Locations, Departments, Asset Types

## Pending Phases (Backlog)

### Phase 2 — Inspection & Approval Workflow (P0 next)
- Remove per-item ASUP approval gate from inspections
- Auto-apply effects on submission
- Date/time entry (with defaults) for both mark-defective and mark-working events
- When defective asset marked OK during inspection → auto-trigger Yellow List
- Add Reject-Working endpoint
- Rename "Pending" tab → "Yellow List"

### Phase 3 — Orange List Panel in Role Dashboards (P1)
- Reusable OrangeListPanel component
- Supervisor: new "Defects" tab with Mark Working
- ASUP: "My Tasks" tab → Yellow List with Approve/Reject
- RO: new "Dept Defects" tab (read-only + add remarks)

### Phase 4 — Rectification Performance Analytics (P1)
- Defect period = defective_since → marked_working_at (user-entered)
- Per-incident breakdown for Supervisor
- Supervisor comparison by date range for RO

### Phase 5 — Remarks Thread (P2)
- remarks_log[] on orange list documents
- Role-typed entries (defect_report, progress_update, instruction, etc.)
- POST /api/orange-list/{id}/remarks endpoint
- UI: expandable thread on each defect card

### Future
- SMS/WhatsApp notification integration (infrastructure present, needs API keys)
- Profile page: Schedule Summary tab
