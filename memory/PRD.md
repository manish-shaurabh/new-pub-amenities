# Railway Asset Inspection Management System — PRD

## Original Problem Statement
Build a production-ready Railway Asset Inspection Management System. Scope includes asset master data, assignment logic, inspection defect tracking, strict role-based access control, Zone/Division hierarchy, and E2E data consistency. PRODUCT REQUIREMENTS: Robust auditing of inspection dates, MTTR analytics, hierarchical reporting, custom report builders, complex comparative data visualizations, comprehensive PDF/Excel exports, Admin Data Health tools, robust dual-pane Inspection UI with photo/GPS auto-capture, Health Explorer with division-wise drill-downs, Sub-Zone hierarchies (Platform -> Sub-zone), and Grouped Asset tracking mode (for high-volume identical assets like fans/lights), and Platform Blueprint / visual health canvas for spatial asset positioning.

## Core Architecture
- **Stack**: FastAPI (backend) + React (frontend) + MongoDB
- **Auth**: JWT (employee_id-based login)
- **Roles**: superadmin / admin / divisional_admin / reporting_officer / approving_supervisor / supervisor / viewer
- **Hierarchy**: Zone → Division → Station → Location → Sub-Zone → Asset

## DB Collections
- `users`, `stations`, `locations`, `departments`, `asset_types`, `assets`
- `sub_zones`: `{ _id, location_id, station_id, name, code, order, has_divider, divider_orientation, start_pillar, end_pillar }`
- `canvas_landmarks`: `{ _id, sub_zone_id, location_id, station_id, label, x, y, landmark_type }`
- `assets`: Added `sub_zone_id`, `tracking_mode` ('individual' | 'grouped'), `total_count`, `needs_repair_count`, `not_working_count`, `canvas_x`, `canvas_y`
- `asset_types`: Added `icon_key` (string), `custom_icon_url` (string, nullable — uploaded icon path)
- `inspections`: Added `sub_zone_health: [{sub_zone_id, responses, photos, remarks}]`
- `orange_list`, `notifications`, `schedules`, `remarks`

## What's Been Implemented (with dates)

### Phase 5.9: Custom Icon Upload + Department Color Theming (May 2026)
- **Custom Icon Upload (Option B)**:
  - New `custom_icon_url` field on `asset_types` collection and `AssetTypeCreate` model.
  - `POST /api/asset-types/{id}/upload-icon` — accepts SVG/PNG/JPG/WebP (max 512KB), stores in `/app/backend/uploads/icons/`, returns URL. Admin-only.
  - `DELETE /api/asset-types/{id}/icon` — removes custom icon file and nulls the field. Admin-only.
  - `GET /api/station-canvas` now passes `custom_icon_url` on each asset record.
  - Frontend `IconPicker.js` rewritten with two tabs: "Icon Library" (Lucide picker) and "Custom Upload" (drag-drop zone + format guide).
  - Canvas `AssetNode` renders custom uploaded icons when available.
- **Department-Based Color Theming (Option E)**:
  - `departmentTheme.js` library: 6 themes (Electrical=amber/circle, Civil=slate/rounded-rect, S&T=blue/diamond, Commercial=purple/circle, Mechanical=pink/rounded-rect, Default=teal/circle).
  - PlatformBlueprint AssetNode uses dept colors for working assets, blends with health status for defective/pending.
  - Different shapes, glow shadows, accent dots, enhanced tooltips with dept name.
  - DeptLegend component below blueprint. AssetTypePalette also dept-themed.
- **Tested**: 8/8 pytest pass + full frontend verification.

### Phase 5.8: Health Explorer Zone→Division Dropdown Fix (May 2026)
- Fixed `/api/dashboard/health-explorer/{user_id}/filters` missing `zone_id` and `assigned_stations`.

### Phase 5.7: "Missing" as First-Class Deficiency (May 2026)
- Added "Missing" button to inspection UI, OL rows with `kind='missing'`, purple badges, data-heal back-fills.

### Phase 5.6: Production Data Reconciliation (May 2026)
- `data_heal` router for admin-triggered idempotent heal of OL/asset status drift and division relinking.

### Phase 5.5: Mobile Inspection Redesign — Canvas-First Bundle (Feb 2026)
- MobileCanvasHeader, sub-zone pillar markers, map-default inspection, in-canvas filters, responsive icon sizing, SubZoneHealthCard.

### Phase 5.4: Full Lucide Icon Library Picker (Feb 2026)
- 3,590 icons selectable, searchable grid, `resolveIcon()` helper.

### Phase 5.3: Canvas-First Asset Creation (Feb 2026)
- AssetTypePalette, AssetDropPopover, server-generated asset codes, auto-create endpoint.

### Phase 5.2: Platform Vision 2.0 — Interactive Canvas CRUD (Feb 2026)
- Asset Type icon picker, palette, inline creation, per-asset action menu, sub-zone management, PDF export.

### Phase 1–5.1: Core System + Sub-Zones + Grouped Assets
- Full FARM stack auth, Asset Registry CRUD, Inspection workflow, Orange/Red List, Schedules, Notifications, Reports, Health Explorer, Zone/Division hierarchy.

## Pending / P0 Issues

### Issue 1: Landmark silent failure (P1)
- Canvas P.No marker placement errors swallowed. Need to surface actual error messages.

### Issue 2: Server-side auth/RBAC gaps (P1)
- Older endpoints trust `current_user_id` query param from client instead of extracting from JWT.

### Issue 3: Scoping gaps on global list endpoints (P1)
- GET /api/assets, /api/users, etc. don't enforce role scoping server-side. Blocked on Issue 2.

### Issue 4: Hardcoded fallback JWT_SECRET (P1)

### Issue 5: Frontend Code Quality Refactors (P2)
- 137 missing hook deps, array index keys, insecure localStorage tokens.

## Upcoming Tasks (P1)
- QR Code Generation + Scan Landing Flow
- User Manual PDF Generation
- JWT Secret hardening

## Future / Backlog
- Schedule Execution (cron/background tasks)
- Real SMS/Telegram notification provider
- File Storage migration to S3/Azure Blob
- Canvas position import from photo upload (AI-assisted)
- Split oversized React components (AdminPage 1900+ lines)
- Refactor POST /api/inspections to be transactional

## Test Credentials
See `/app/memory/test_credentials.md`

## Key API Endpoints
- `POST /api/auth/login`
- `GET /api/station-canvas?location_id=`
- `PATCH /api/assets/bulk/canvas`
- `POST /api/asset-types/{id}/upload-icon` — custom icon upload (admin-only)
- `DELETE /api/asset-types/{id}/icon` — remove custom icon (admin-only)
- `POST /api/data-heal/preview/{user_id}`
- `POST /api/data-heal/execute/{user_id}`

## Test Reports
- `/app/test_reports/iteration_37.json` — Phase 5.9 (Custom Icon + Dept Theming) — 8/8 backend
- `/app/test_reports/iteration_36.json` — Phase 5.5 (Mobile Canvas) — 7/7 backend
- `/app/test_reports/iteration_35.json` — Phase 5.3 (Canvas-First) — 13/13 backend
- `/app/test_reports/iteration_34.json` — Phase 5.2 (Platform Vision 2.0) — 9/9 backend
