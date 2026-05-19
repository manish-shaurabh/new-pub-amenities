# Railway Asset Inspection Management System — PRD

## Original Problem Statement
Build a production-ready Railway Asset Inspection Management System with asset master data, assignment logic, inspection defect tracking, role-based access control, Zone/Division hierarchy, and E2E data consistency.

## Core Architecture
- **Stack**: FastAPI (backend) + React (frontend) + MongoDB
- **Auth**: JWT (employee_id-based login)
- **Roles**: superadmin / admin / divisional_admin / reporting_officer / approving_supervisor / supervisor / viewer
- **Hierarchy**: Zone → Division → Station → Location → Sub-Zone → Asset

## What's Been Implemented

### Phase 5.11: Landmark Editor + Missing Icon Overlay (May 2026)
- **Landmark Label Editor Panel**: Enhanced sidebar with inline rename, delete, count, and batch creation ("P.No 1-10").
- **Missing Asset Icon Overlay**: Missing items show grayed asset type icon + white X cross overlay.

### Phase 5.10: Platform Vision — 4 Bug Fixes (May 2026)
- Landmark save 500 error fix, sticky palette, sub-zone rename, full PDF export.

### Phase 5.9: Custom Icon Upload + Department Color Theming (May 2026)
- Custom SVG/PNG icon upload as data URIs in MongoDB. Department-based color theming.

### Phase 5.8–5.1: Previous Phases
- Health Explorer fix, "Missing" deficiency, Data Reconciliation, Mobile Canvas Bundle, Icon Library, Canvas-First Asset Creation, Platform Vision 2.0, Core System.

### Inspection Bottom Sheet Fix (May 2026)
- Fixed `updateItem` signature mismatch (was passing object instead of 3 args). Added "Missing" status option.

## Pending Issues
- Server-side auth/RBAC gaps (P1)
- Scoping gaps on global list endpoints (P1)
- Hardcoded JWT_SECRET (P1)
- Frontend code quality refactors (P2)

## Upcoming Tasks
- QR Code Generation + Scan Landing Flow (P1)
- User Manual PDF Generation (P1)
- Auth guards on canvas-landmarks endpoints

## Future/Backlog
- Schedule Execution, SMS/Telegram, S3 file storage
- Split oversized React components, transactional inspections

## Test Credentials
See `/app/memory/test_credentials.md`

## Test Reports
- `/app/test_reports/iteration_38.json` — Landmark fixes — 5/5 backend
- `/app/test_reports/iteration_37.json` — Custom Icon + Dept Theming — 8/8 backend
