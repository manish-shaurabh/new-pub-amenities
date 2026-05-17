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
- `sub_zones`: `{ _id, location_id, station_id, name, code, order, has_divider, divider_orientation }`
- `canvas_landmarks`: `{ _id, sub_zone_id, location_id, station_id, label, x, y, landmark_type }`
- `assets`: Added `sub_zone_id`, `tracking_mode` ('individual' | 'grouped'), `total_count`, `needs_repair_count`, `not_working_count`, `canvas_x`, `canvas_y`
- `inspections`, `orange_list`, `notifications`, `schedules`, `remarks`

## What's Been Implemented (with dates)

### Phase 5.2: Platform Vision 2.0 — Interactive Canvas CRUD (Feb 2026)
- **Asset Type icon picker** — admin selects icon_key from 18 presets (fan, light, tap, cib, wifi, seat, fire, camera, clock, ac, toilet, door, tv, phone, sign, bin, lock, safety, default). Auto-detected from name if blank. `icon_key` stored on asset_types.
- **AssetTypePalette** — right sidebar in edit mode showing all asset types grouped by department, drag-to-canvas or click-to-select.
- **Inline asset creation from canvas** — select/drop asset type → click canvas → mini form (asset_number, description) → asset created at exact (canvas_x, canvas_y) with `POST /api/assets`.
- **Per-asset action menu** (edit mode) — Edit Details / Reposition / Mark Missing / Delete with `data-testid="asset-action-{edit|reposition|mark-missing|delete}"`.
- **PATCH /api/assets/{id}/status** — toggles status between `working` and `missing` (new endpoint). Missing assets render as gray-bordered X on canvas.
- **Sub-zone management from canvas** — add / reorder (↑↓) / delete (with force-delete-on-conflict confirmation showing asset count) / configure center divider (vertical/horizontal).
- **Location quick-create** — "+ Location" button in edit-mode header.
- **PDF Export** — `Download` button generates A4 landscape PDF via html2canvas + jsPDF capturing the full PlatformBlueprint root, with station+location header and IST timestamp.
- **Tested**: `/app/test_reports/iteration_34.json` — backend 9/9 pytest, frontend smoke 100% (palette, edit mode, action menu, PDF download, admin icon picker).

### Phase 1–3: Core System (pre-Jun 2025)
- Full FARM stack auth with JWT, role-based access
- Asset Registry CRUD + bulk operations
- Inspection workflow (dual-pane UI, photo upload, GPS)
- Orange List / Red List with 24h threshold
- Schedules, Notifications
- Reports + custom report builder
- Health Explorer with drill-down
- Zone/Division hierarchy + global filters

### Phase 4: Sub-Zones & Grouped Assets (Jan 2026)
- Sub-Zone CRUD (Admin Panel) — Station → Location → Sub-Zone → Asset
- "Grouped" asset tracking mode (total_count, needs_repair_count, not_working_count)
- Bulk sub-zone assignment in Asset Registry
- Inspection Page: 3-tier sub-zone grouping with grouped asset numeric inputs
- Personnel Map Zone/Division fix + password hash scrub

### Phase 5: Platform Vision / Blueprint (May 2026)
- **StationCanvasPage** (`/station-canvas`) — "Platform Vision" page
  - Station selector + Location tabs
  - Dept / Asset Type filters with highlight+dim behavior
  - Live health color legend (Working/Pending/Orange/Red)
  - Edit canvas button per sub-zone (admin only)
- **PlatformBlueprint.js** — shared canvas renderer (health + inspection modes)
  - Sub-zone canvases with 16:9 aspect ratio
  - Asset icons (fan/light/tap/cib/wifi/seat/etc.) at their (canvas_x, canvas_y) positions
  - Center dividing line (configurable per sub-zone: vertical/horizontal)
  - Landmark markers (P.No pins)
  - Health status color rings
  - Hover tooltips, tap-to-inspect support
  - Unpositioned assets strip
- **CanvasEditor.js** — admin drag-and-drop positioning tool
  - Click unpositioned asset → click canvas to place
  - Drag placed asset to reposition
  - Add/remove landmark markers (P.No 27, P.No 28, etc.)
  - Saves via PATCH /api/assets/bulk/canvas + canvas-landmarks CRUD
- **InspectionPage map view** — List/Map view toggle
  - Blueprint view shows inspection session state overlay
  - Tap-to-inspect: click asset → bottom sheet with inspection form
- **Sub-zone improvements**:
  - Force-delete with asset unassign (DELETE /api/sub-zones/{id}?force=true)
  - has_divider + divider_orientation fields on sub-zones
  - Canvas editor button per sub-zone in Admin Panel
- **Backend endpoints added**:
  - `GET /api/station-canvas?location_id=&station_id=` — aggregated blueprint data
  - `PATCH /api/assets/bulk/canvas` — bulk canvas position update
  - `PATCH /api/assets/{id}/canvas` — single asset position update
  - `GET/POST/PUT/DELETE /api/canvas-landmarks` — P.No landmark management

## Pending / P0 Issues

### Issue 1: Server-side auth/RBAC gaps (P1)
- Older endpoints trust `current_user_id` query param from client instead of extracting from JWT
- Fix: use `get_current_user` FastAPI dependency
- Status: NOT STARTED

### Issue 2: Scoping gaps on global list endpoints (P1)
- GET /api/assets, /api/users, /api/departments, /api/stations don't enforce role scoping
- Status: NOT STARTED (blocked on Issue 1)

### Issue 3: Inspection creation non-transactional (P2)
- POST /api/inspections does sequential writes with no rollback
- Status: NOT STARTED

### Issue 4: Hardcoded fallback JWT_SECRET (P1)
- Status: NOT STARTED

## Upcoming Tasks (P1)
- QR Code Generation + Scan Landing Flow (Phase 4 from earlier plan)
- JWT Secret hardening

## Future / Backlog
- Schedule Execution (cron/background tasks for inspection schedules)
- Real SMS/Telegram notification provider
- File Storage migration to S3/Azure Blob for asset photos
- Canvas position import from photo upload (AI-assisted placement)
- Multi-platform stitching view

## Test Credentials
See `/app/memory/test_credentials.md`

## Key API Endpoints
- `POST /api/auth/login` — employee_id + password
- `GET /api/station-canvas?location_id=` — blueprint data
- `PATCH /api/assets/bulk/canvas` — bulk position update
- `DELETE /api/sub-zones/{id}?force=true` — force delete + unassign
- `GET /api/canvas-landmarks?sub_zone_id=` — P.No markers
- `GET /api/users/station-staff` — personnel map

## Test Reports
- `/app/test_reports/iteration_34.json` — Phase 5.2 (Platform Vision 2.0) — 9/9 backend, 100% frontend smoke
- `/app/test_reports/iteration_33.json` — Phase 5.1 (30/30 backend, 100% frontend)
