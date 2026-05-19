# Railway Asset Inspection Management System — PRD

## Original Problem Statement
Build a production-ready Railway Asset Inspection Management System with asset master data, assignment logic, inspection defect tracking, role-based access control, Zone/Division hierarchy, and E2E data consistency.

## Core Architecture
- **Stack**: FastAPI (backend) + React (frontend) + MongoDB
- **Auth**: JWT (employee_id-based login)
- **Roles**: superadmin / admin / divisional_admin / reporting_officer / approving_supervisor / supervisor / viewer
- **Hierarchy**: Zone → Division → Station → Location → Sub-Zone → Asset

## What's Been Implemented

### Phase 5.10: Platform Vision — 4 Bug Fixes (May 2026)
- **Landmark save 500 error**: CanvasLandmarkCreate model `location_id`/`station_id` made optional. CanvasEditor now UPDATES moved existing landmarks (was only creating new ones). Landmarks draggable on canvas. Router fixed to normalize `_id` → `id`.
- **Sticky palette**: Wrapped AssetTypePalette in `position: sticky` wrapper.
- **Sub-zone rename**: Inline edit in edit mode — click name → input → Enter/blur saves via PUT /api/sub-zones.
- **Full PDF export**: Captures entire platform-blueprint-root with multi-page slicing.

### Phase 5.9: Custom Icon Upload + Department Color Theming (May 2026)
- Custom SVG/PNG icon upload per asset type, stored as data URIs in MongoDB (survives redeploys).
- Department-based color theming (6 themes with distinct shapes/colors).

### Phase 5.8–5.1: Previous Phases
- Health Explorer fix, "Missing" deficiency, Data Reconciliation, Mobile Canvas Bundle, Icon Library, Canvas-First Asset Creation, Platform Vision 2.0, Core System.

## Pending Issues
- Landmark silent failure error surfacing (P1)
- Server-side auth/RBAC gaps (P1)
- Scoping gaps on global list endpoints (P1)
- Hardcoded JWT_SECRET (P1)
- Frontend code quality refactors (P2)

## Upcoming Tasks
- QR Code Generation + Scan Landing Flow (P1)
- User Manual PDF Generation (P1)
- Auth guards on canvas-landmarks endpoints

## Future/Backlog
- Schedule Execution, SMS/Telegram notifications, S3 file storage
- Split oversized React components, transactional inspections

## Test Credentials
See `/app/memory/test_credentials.md`

## Test Reports
- `/app/test_reports/iteration_38.json` — Landmark fixes — 5/5 backend
- `/app/test_reports/iteration_37.json` — Custom Icon + Dept Theming — 8/8 backend
