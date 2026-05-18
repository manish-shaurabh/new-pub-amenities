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
- `sub_zones`: `{ _id, location_id, station_id, name, code, order, has_divider, divider_orientation, start_pillar, end_pillar }`  *(start_pillar/end_pillar added Feb 2026)*
- `canvas_landmarks`: `{ _id, sub_zone_id, location_id, station_id, label, x, y, landmark_type }`
- `assets`: Added `sub_zone_id`, `tracking_mode` ('individual' | 'grouped'), `total_count`, `needs_repair_count`, `not_working_count`, `canvas_x`, `canvas_y`
- `inspections`: Added `sub_zone_health: [{sub_zone_id, responses, photos, remarks}]` (Feb 2026)
- `orange_list`, `notifications`, `schedules`, `remarks`

## What's Been Implemented (with dates)

### Phase 5.6: Production Data Reconciliation (May 2026)
- **New `data_heal` router** (`/app/backend/routers/data_heal.py`) — admin-triggered idempotent heal for two known production drifts:
  1. **Orange List ⇄ Asset Status (two-way reconcile)**:
     - Forward: assets with `status ∈ {defective, pending_approval}` and no active OL row → back-fill an OL row using `asset.defective_since` (or `now_ist()`).
     - Backward: open OL rows whose asset shows `status=working` → flip asset back to defective/pending_approval and mirror OL's `defective_since`.
  2. **Division relink**: divisions whose `zone_id` does not match any existing zone are relinked to the canonical zone (preferring `code='ECR'`).
- **Endpoints** (all superadmin-only):
  - `POST /api/data-heal/preview/{user_id}` — dry-run report (counts + sample IDs, no writes)
  - `POST /api/data-heal/execute/{user_id}` — applies changes + writes audit doc
  - `GET  /api/data-heal/audit/{user_id}?limit=20` — history of past heals (filtered to `category='data_heal_reconcile'`)
- **Frontend** — `DataReconcilePanel.js` embedded inside Admin → Health tab (`/app/frontend/src/components/DataReconcilePanel.js`). Preview-first UI with breakdown cards (OL forward / OL backward / Divisions), expandable sample list, confirmation modal with checkbox guard, and inline 10-row audit history. `data-testid`: `data-reconcile-panel`, `reconcile-preview-btn`, `reconcile-execute-btn`, `reconcile-confirm-checkbox`, `reconcile-confirm-execute`.
- **Audit** — written to existing `data_health_audit` collection with `category='data_heal_reconcile'` so it interleaves with other Data Health actions.
- **Tested**: `/app/backend/tests/test_data_heal.py` — 4/4 pytest pass. Seeds synthetic forward + backward + orphan-division drift, asserts heal applies, verifies via direct DB reads, then asserts second run is a no-op (idempotent). Also confirms `403` for non-superadmin and `200` for audit endpoint.

### Phase 5.5: Mobile Inspection Redesign — Canvas-First Bundle (Feb 2026)
- **Compact `MobileCanvasHeader`** (`/app/frontend/src/components/MobileCanvasHeader.js`) — single sticky-row header replacing the bulky chip grid on Platform Vision. Includes: station select, location popover with inline search, filter popover (Department + Asset Type), and More menu (Refresh / PDF / Edit Canvas). Applied to both `StationCanvasPage` and used on mobile + desktop. `data-testid`: `mobile-canvas-header`, `mch-location-trigger`, `mch-location-popover`, `mch-filter-trigger`, `mch-more-trigger`, `mch-pdf-btn`, `mch-edit-toggle`.
- **Sub-zone pillar markers** — added `start_pillar` and `end_pillar` (string) fields to `sub_zones`. Rendered at canvas edges in `PlatformBlueprint` (left = start, right = end). Falls back to generic "High End ← / → Low End" when not set. New form inputs `subzone-start-pillar` and `subzone-end-pillar` in the SubZoneForm dialog.
- **Map-default Inspection** — `InspectionPage` now defaults `viewMode = 'map'` and auto-selects the first location with assets, so inspectors land directly on the visual blueprint.
- **In-canvas filter dropdowns** — Inspection map view exposes Department + Asset Type selects above the blueprint (`map-dept-filter`, `map-type-filter`). Non-matching assets are dimmed to 20% opacity (existing `filters` plumbing in PlatformBlueprint).
- **Responsive icon sizing** — `PlatformBlueprint.SubZoneCanvas` uses a `ResizeObserver` to scale asset node size between 24–46px based on rendered canvas width AND asset density (≥20 assets → smaller). Prevents icon overlap on narrow mobile canvases.
- **Per-sub-zone Shed Health card** (`/app/frontend/src/components/SubZoneHealthCard.js`) — new collapsible card rendered below each sub-zone canvas in inspection map view. Four fixed questions: shed_roof_condition, cleanliness, lighting, water_seepage. Each answer = OK / Not OK. **Photo is MANDATORY when answer is "not_ok"** (validated client-side before submit). Optional remarks. `data-testid`: `subzone-health-card-{id}`, `subzone-health-toggle-{id}`, `shed-{key}-ok-{szId}`, `shed-{key}-notok-{szId}`, `shed-{key}-photo-btn-{szId}`, `shed-remarks-{szId}`.
- **Backend**: `POST /api/inspections` now accepts an optional `sub_zone_health` array which is persisted as-is (backward compatible — defaults to `[]`). `station-canvas` endpoint surfaces pillar fields.
- **Tested**: `/app/test_reports/iteration_36.json` — backend pytest 7/7 PASS (pillar create/get/update/clear, station-canvas surfacing, inspection w/ & w/o sub_zone_health). Frontend smoke verified. Regression suite at `/app/backend/tests/test_mobile_inspection_iter36.py`.

### Phase 5.4: Full Lucide Icon Library Picker (Feb 2026)
- **3,590 icons** now selectable on every Asset Type — the old 18-preset library is kept as a "Recommended" row pinned at the top of the picker.
- **New `IconPicker` component** (`/app/frontend/src/components/IconPicker.js`) — searchable grid with: live search across the full Lucide library, paginated "Show more" loader (120 per page), inline "Selected" badge, and a "Reset (auto-detect from name)" link.
- **`resolveIcon(key)` helper** in `/app/frontend/src/lib/assetIcons.js` — single resolver used by every renderer (PlatformBlueprint, CanvasEditor, AssetTypePalette, AssetDropPopover) that accepts BOTH the legacy short keys (`"fan"`, `"light"`, …) and PascalCase Lucide names (`"Train"`, `"Hammer"`, …) and falls back to `Circle`.
- **Backward-compatible** — all existing `icon_key` values continue rendering unchanged; new picks just store the PascalCase name string.
- **Sub-zone reorder fix** also shipped this session: new `PATCH /api/sub-zones/reorder` endpoint, contiguous order on create, startup migration to heal legacy ties.

### Phase 5.3: Canvas-First Asset Creation (Feb 2026)
- **AssetTypePalette revamp** — sidebar now has a search box, multi-select department category chips (with counts), and a draggable icon grid. Chips and search are AND-combined. `data-testid`: `palette-search`, `palette-dept-chip-{id}`, `palette-type-{id}`, `palette-clear-filters`.
- **AssetDropPopover** (new component) — replaces the old AssetQuickForm. Pre-fills a server-generated asset code via `POST /api/assets/preview-code`, with editable input, optional description, and a `total_count` field for grouped types. Enter to confirm, Escape to cancel.
- **Server-generated asset codes** — atomic, deterministic pattern `{ZONE}-{DIV}-{STN}-{LOC}-[{SZ}-]{TYPE}-{seq:04d}`. New `asset_code_counters` collection holds per-bucket sequences via `findOneAndUpdate $inc`.
- **`POST /api/assets/auto-create`** — canvas-first creation endpoint. Auto-resolves hierarchy (sub_zone → location → station → division → zone, dept from asset_type) and generates the code. Accepts `asset_number_override` for custom conventions; supports grouped (requires `total_count`); supports station-level "unassigned to sub-zone" creation.
- **`POST /api/assets/preview-code`** — non-destructive preview of the next code.
- **Department now strictly required on `asset_types`** — `POST/PUT /api/asset-types` reject empty/missing `department_id` with 400. Admin form disables Submit until a department is chosen and shows an inline warning (`data-testid="at-dept-required-warn"`).
- **Startup migration** (`_migrate_asset_types_require_dept`) — hard-deletes any legacy asset_types missing `department_id` AND cascade-deletes their assets (option A per user decision).
- **Asset delete confirmation** — `window.confirm` replaced with shadcn `AlertDialog` (`data-testid`: `delete-asset-alert`, `delete-asset-confirm`, `delete-asset-cancel`) showing the asset code and explicit warning about cascade deletion.
- **Tested**: `/app/test_reports/iteration_35.json` — 13/13 backend pytest pass, frontend smoke verified (palette filters, popover open with pre-filled code, Escape dismissal).

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
