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

### May 2026 — Sprint A: Asset Identification Photo + GPS + Inspection UI Overhaul

**Asset Photo & GPS (Phase 1)**
- `models.py`: Added `identification_photo` (Optional[str] - base64 data URL, client-resized ≤1024px), `geo_lat` (Optional[float]), `geo_lng` (Optional[float]) to `AssetCreate` and `AssetResponse`.
- `routers/assets.py`: `create_asset` stores all three new fields. `update_asset` only updates `identification_photo` if non-null (null = keep existing photo).
- `pages/AssetsPage.js`: New "IDENTIFICATION PHOTO & GPS" section in Add/Edit form. Photo upload uses FileReader + Canvas API to resize to max 1024px @ 75% JPEG quality. `exifr` (v7.1.3) extracts GPS coordinates from photo EXIF data automatically on upload. Manual lat/lng fields with Google Maps link.
- Asset card shows photo thumbnail and MapPin icon (links to Google Maps) when GPS is stored.

**Inspection UI Overhaul (Phase 2)**
- `pages/InspectionPage.js` fully rewritten (~550 lines) with best-of-a/b/c design.
- **Top card**: TYPE (Individual/SIG tabs), STATION selector, DATE/TIME in a single compact row.
- **Progress banner**: "X of Y assets queued" with colored progress bar + "Clear all" shortcut.
- **Dual-pane on desktop** (hidden on mobile): Left sidebar sticky "LOCATIONS" nav with per-location counts and selected count indicators. Clicking a location scrolls-to the location block.
- **Mobile**: Horizontal scroll chip strip for location quick-nav.
- **Location blocks**: Each location has a sticky sub-header with name, asset count, selected count badge, and "Select all / Deselect all" bulk toggle.
- **Asset rows** (`AssetInspectionRow`): Checkbox (select/deselect), optional photo thumbnail, asset number (links to history), asset type badge, status badge, GPS map link, defective-since text.
- **Inline form expansion**: When asset is checked, form expands in-place with:
  - OK/Not OK/Needs Repair radio pill buttons
  - Defective Since date/time picker (auto-shown for NOT OK/NEEDS REPAIR)
  - Rectified On date/time picker (auto-shown for OK + asset.status=defective)
  - Collapsible Checklist (with pass/fail toggles and item counter)
  - Remarks textarea
  - Photo upload (Camera + Files)
- **Sticky bottom submit bar** with per-status breakdown (X OK · Y Not OK · Z Needs Repair).
- Deep-link (`?asset_id=`) still supported for QR-code-style single-asset inspections.
- SIG participant selector rendered inline in top card when SIG mode is active.

**Tested** (iteration_27): backend 16/16 PASS, frontend 100% — dual-pane layout, bulk-select, inline form, defective-since/rectified-on pickers, progress banner, sticky submit bar, full submit lifecycle all verified.


**Health Explorer dashboard** — mirrors `Comparative Reports → Section A` layout but for ASSET HEALTH (not MTTR). Mounted as the **default tab** at `/` with "Classic Dashboard" as a secondary tab. Replaces no existing functionality — additive.

**Backend** (`/app/backend/routers/health_explorer.py` — new, ~275 lines)
- `GET /api/dashboard/health-explorer/{user_id}` — single endpoint, 4-level drill via optional ancestor params:
  - L1 → groups by asset-type (or station, depending on `mode`)
  - L2 (one ancestor) → groups by station (or asset-type)
  - L3 (two ancestors) → groups by location
  - L4 (three ancestors) → individual assets (drillable=false; frontend opens `AssetHistoryDrawer`)
- Health % = `(working + yellow) / total` — yellow counts as healthy on the ground.
- Color tint per threshold: ≥90% aqua `#0891b2` · 70–90% amber `#f59e0b` · <70% red `#dc2626`.
- User-controlled filters (multi-select via CSV): `station_ids`, `dept_ids`, `asset_type_ids`. Intersected with role-scope.
- Role scope reused from `reports.py::_filter_assets_for_user`: SA/Admin/Viewer = global · ASUP = assigned stations · SUP/RO = assigned stations + own dept.
- Companion endpoint `GET /api/dashboard/health-explorer/{user_id}/filters` returns role-scoped filter options.

**Frontend** (`/app/frontend/src/components/HealthExplorer.js` — new)
- Reuses existing `<CylinderBar>` (aqua-glass gradient) and `<AssetHistoryDrawer>`.
- Mode toggle pill ("By Asset Type" / "By Station") persisted in `localStorage['health-explorer-mode']`.
- Multi-select chip dropdowns (Popover + Checkbox) — instant refresh on toggle, no Apply button.
- Breadcrumb navigation with click-to-jump and "All Types/Stations" reset.
- `DashboardPage.js` wraps role-dashboards in Tabs: `tab-health-explorer` (default) + `tab-classic-dashboard`.

**Viewer access to Reports Builder** (`ReportsBuilderPage.js`, `ReportsPage.js`)
- `canLoad = isSA || isViewer` — Builder tab now visible for viewers.
- `canWrite = isSA` — Save/Delete buttons hidden from viewers via `{canWrite && ...}` blocks at four sites:
  - Composer "Save as name…" + Save button
  - Saved-reports per-row Trash icon
  - Dossier "Save dossier" button + name input
  - Saved-dossiers per-row Trash icon
- Viewer keeps full Run / Export (CSV/Excel/PDF) / Add-to-Dossier / Export-dossier access.

**Tested** (`testing_agent_v3_fork` iteration_26): **backend 10/10 PASS** (test_health_explorer.py covers L1/L2/L4 drill, both modes, SA global, SUP scope=50 assets DHN+Electrical, VIEWER global, filters endpoint, filter narrowing). **Frontend 95%** — all role-based hide/show verified, mode-toggle localStorage persistence verified, no blocking issues. Test creds: SA001 / SSE001 / VIEW001 (all admin123 except viewer123).

### Feb 2026 — Read-only Viewer Role (auditor / observer)
**Purpose**: A new `viewer` user role for HQ executives, auditors, and board observers who need full visibility but ZERO mutation rights.

**Permissions (server-enforced)**
- ✅ View ALL dashboards (defaults to SuperadminDashboard scope — global)
- ✅ View Asset Registry, Orange/Red List, Schedules, Inspection History, Notifications, Reports (Health + Comparative + Builder)
- ✅ Download PDF / Excel exports (per-station, comparative, dossier, defective appendix)
- ✅ Run Report Builder queries (no save/delete)
- ❌ Cannot Create/Edit/Delete anything (assets, users, stations, departments, schedules, asset-types, tags)
- ❌ Cannot perform inspections (route + nav hidden + 403 if posted)
- ❌ Cannot mark working / approve / reject / post remarks
- ❌ Cannot access Admin panel
- ❌ Cannot save/delete saved-reports or dossiers

**Backend**
- `models.py`: Added `VIEWER = "viewer"` to `UserRole` enum.
- New `/app/backend/viewer_guard.py` — FastAPI middleware that decodes JWT and rejects any `POST/PUT/PATCH/DELETE` from viewers, EXCEPT the explicit safe-POST allowlist:
  - `/api/auth/login`, `/api/auth/refresh`
  - Any path containing `/export/` (PDF/Excel generators)
  - `/api/reports/builder/run*`, `/api/reports/builder/dossier/run*`, `/api/reports/builder/dossier/export/*`
  - `/api/reports/comparative/export/*`
  - `*/activity-wipe/preview` (DRY-RUN only)
- `reports_builder.py::_ensure_sa()` now allows `superadmin OR viewer` (mutations still 403'd by middleware).
- `reports.py`: viewer added to admin/superadmin role group in `_filter_assets_for_user`, the RO-card view, and the drill ring grouping → viewer gets the same global SA-style health dashboard at `/api/reports/health/{id}`.

**Frontend**
- `lib/auth-context.js` — added `isViewer()` helper.
- `components/AppLayout.js` — sidebar nav hides `/inspection` and `/admin` for viewers; role label "Viewer (Read-only)" surfaces in user dropdown.
- `App.js` — new `blockViewer` prop on `ProtectedRoute`; `/inspection` redirects viewers to `/`; `/admin` already adminOnly.
- `pages/UsersPage.js` + `pages/AdminPage.js` — Add-User Role dropdown gains "Viewer (Read-only)" option (Superadmin-only). Filter dropdown gains Viewer row. `isSuperadmin` gates both Super Admin and Viewer options.
- `components/dashboards/SuperadminDashboard.js` — header badge now shows "Viewer · Read-only" for viewers (was hardcoded "Superadmin").

**Verified**: `testing_agent_v3_fork` iteration_25 — **backend 21/21 PASS** (`test_viewer_role.py`: read access, mutations blocked, allowed POSTs whitelist), **frontend 100%** on all retest items (badge, nav, /reports load, AdminPage dropdown). Test creds: VIEW001 / viewer123 (global scope).

**Future**: scoped viewers (per-station assignment), watermarked "VIEW-ONLY" PDFs.

### Feb 2026 — Ghost Defective Assets (asset_status_ghost) — P0 fix
**Background**: After Activity Wipe removes OL rows, `assets.status` was left stuck on `defective`/`pending_approval`, polluting dashboards with phantom defective rows.

**Backend** (`/app/backend/routers/data_health.py`)
- New `_find_ghost_status_assets()` — returns assets whose status implies defect but have NO open OL row.
- `scan()` now includes 12th category `asset_status_ghost` (count + sample {id, asset_number, status, defective_since}).
- New `_clean_asset_status_ghost(asset_ids)` cleaner — resets `status='working'` and `$unset` `defective_since` (does NOT delete the asset).
- `clean()` route + `_ids_for_category()` wired for the new category.
- **Root-cause fix**: `activity_wipe_execute` now invokes the ghost detector after OL deletion and auto-resets matching asset rows in the same transaction (`summary.asset_status_reset` returned).

**Frontend** (`/app/frontend/src/components/DataHealthPanel.js`)
- New `CATEGORY_META.asset_status_ghost` (👻, red, perRecord=true). Also added `orphan_asset_type_refs` meta (🪪) that was missing.
- `SampleRow` now also surfaces `status` in the subParts so ghost rows show "FAN-2 · defective" inline.

**Tested** (`testing_agent_v3_fork` iteration_23): backend 13/13 + frontend 100%. Inject ghost → scan 1 → clean → 0 verified. Activity wipe auto-reset verified (asset_status_reset:1). Bulk-preview 500 bug from iteration_22 also fixed (regression check passed).

### Feb 2026 — Activity Wipe (time-window bulk delete for self-test data)
**Backend** (`/app/backend/routers/data_health.py`)
- New endpoints:
  - `POST /api/data-health/activity-wipe/preview/{user_id}` — body `{cutoff_date, collections[]}` → returns per-collection count + 5-row sample + total. Admin can view; doesn't mutate.
  - `POST /api/data-health/activity-wipe/execute/{user_id}` — same body → atomic delete + audit log row. Superadmin only.
- Supports collections: `inspections`, `orange_list`, `remarks`, `schedules` (your pick).
- **Bug found & fixed mid-build**: `created_at` is stored as `datetime` (not ISO string). String comparison `<=` returned 0 because of BSON type ordering. Fix: parse cutoff to a `datetime` via `_parse_cutoff()` and build a hybrid OR query that matches BOTH `datetime` AND ISO-string variants of every date field.
- Dangling-remark cleanup: if you wipe OLs but not remarks, the executor sweeps orphan remarks left behind.

**Frontend** (`/app/frontend/src/components/DataHealthPanel.js`)
- New **Activity Wipe card** (superadmin-only) inserted above the audit log.
- UI: date picker for cutoff + 4 collection checkboxes + Preview button → shows per-collection counts + total → Wipe button gated by "I understand" confirmation dialog.
- Audit log table at bottom auto-refreshes after a wipe and shows category=`activity_wipe` rows.

**Verified end-to-end**:
- Preview with cutoff `2026-12-31` → 292 records (106 inspections + 79 OL + 105 remarks + 2 schedules) — matches DB
- Preview with cutoff `2026-04-15` → 2 records — date filter working correctly
- Execute → audit log entry created
- Asset/station/user master data untouched

### Feb 2026 — Orphan Asset-Type Refs + Station/Location Duplicates + Hide Unnamed
**Backend** (`/app/backend/routers/data_health.py`)
- **New category** `orphan_asset_type_refs` — detects assets whose `asset_type_id` points to a deleted asset-type. Cleanup cascade-deletes those assets via `_cascade_delete_assets`.
- **Extended duplicates** — `duplicates` category now includes:
  - Duplicate user `employee_id` (existing)
  - Duplicate asset `asset_number` (existing)
  - **Duplicate station names** — case-insensitive, whitespace-trimmed (new)
  - **Duplicate location names within the same station** — case-insensitive (new)
- New helper `_find_duplicates_text` (case-insensitive + trim) and `_find_dup_locations` (grouped by station_id).
- Bug fix: previous `_find_duplicates_text` had repeated `$ne` keys which only matched empty-string and ignored null; replaced with `$nin: [None, ""]`.

**Frontend** (`/app/frontend/src/pages/ComparativeReportsPage.js`)
- **MTTR Explorer now HIDES asset-type rows with empty/missing names entirely** — no more "(unnamed)" pollution in the chart. The data is still surfaced in Admin → Health → `unnamed_asset_types` or `orphan_asset_type_refs` for the admin to clean.
- Removed unused `_unnamed` toast warning and the bottom warning banner.

**Verified end-to-end**: injected a bogus orphan-type-ref asset → scan detects it → cleanup cascade-deletes it → scan returns 0.

### Feb 2026 — Excel Polish: Row Striping + Frozen Header
- Added `_stripe_rows()` and `_freeze_below_header()` helpers in `comparative_export.py`.
- All Excel data sheets (By Asset Type, Peer Matrix, Drilldown, Drilldown — Full, Defective Only, Last Inspections, Remarks) now have:
  - **Subtle slate-50 alternating row stripes** (`#F8FAFC`) — matches the PDF visual rhythm
  - **Frozen panes** at the header row — header stays sticky while scrolling long defective/remark lists
- Highlight-protected rows (red/orange defective + teal self in peer matrix) are excluded from stripe overwrites via a `skip_rows` set.
- Verified via openpyxl: every sheet shows `freeze_panes: A2` (or `A4` for the Drilldown sheet with a 3-row preamble) and alternating fill pattern `white / F8FAFC / white / F8FAFC …`.

### Feb 2026 — PDF Export Text-Wrap Fix
- **Problem**: Defective Assets appendix in the Comparative Reports PDF showed overlapping cells — `PLATFORM SURFACEPLATFORM SURFACEDHANBAD`, `FAN 11 (UNDER SHEDCEILING FAEND)` because ReportLab `Table` doesn't auto-wrap plain string cells.
- **Fix in `/app/backend/routers/comparative_export.py`**:
  - Added two new paragraph styles `cell` and `cell_b` (with `wordWrap="CJK"`)
  - Added helper `P(text, style)` that wraps every string in a ReportLab `Paragraph` with HTML-escape so `<`/`>`/`&` in names don't break rendering
  - Updated **all 7 PDF tables** (Card A, peer matrix, drill table, full hierarchy, defective appendix, last inspection, remarks) to use `P()` for every text cell
  - Tightened column widths so long names get more room; added `splitByRow=1` so tables paginate cleanly
  - Remarks body limit raised from 140 → 280 chars
- **Verified**: Defective Assets PDF now shows multi-line wrapped location names like `Platform No-1 (Under Shed-5)` instead of overlapping. Card A / Drill / Full Hierarchy all render cleanly.
- Excel export untouched (Excel wraps natively).

### Feb 2026 — Cascade-DELETE wired into Admin endpoints
- `DELETE /api/assets/{id}` now cascades via `_cascade_delete_assets`: removes OL entries → remarks → strips from inspection items[] → deletes schedules → deletes the asset. Returns `cascade_summary` in response.
- `DELETE /api/stations/{id}` now cascades via `_cascade_delete_stations`: locations → assets (with their full cascade) → station-level inspections → schedules → strips station_id from `users.assigned_stations`.
- `DELETE /api/users/{id}` now cascades via `_cascade_delete_users`: nulls out user refs in OL/approvals/inspections (preserves audit), then deletes the user.
- Added `_cascade_delete_assets` helper in `data_health.py` (previously only had stations/users/asset_types).
- End-to-end verified: a single test station deletion cleaned 14 dependent records.

### Feb 2026 — Admin Data Health Panel (cascade-delete orphans, test residue, duplicates)
**Backend** (`/app/backend/routers/data_health.py` — new)
- `GET /api/data-health/scan/{user_id}` — scans 10 categories: `orphan_inspection_items`, `orphan_ol_entries`, `orphan_remarks`, `test_users`, `test_stations`, `unnamed_asset_types`, `zero_activity_stations`, `zero_activity_users`, `stale_records`, `duplicates`.
- `GET /api/data-health/preview/{user_id}?category=&target_id=` — returns cascade-impact for a single record (station: locations+assets+OLs+remarks+inspections+schedules; user: OL/inspection ref counts with null-out note) or bulk-summary for orphan-style categories.
- `POST /api/data-health/clean/{user_id}` — atomic cascade-delete; superadmin-only.
- `GET /api/data-health/audit/{user_id}` — last N cleanups with performed_by_name + summary.
- Permissions: admin can view, superadmin can execute.
- Cascade helpers: `_cascade_delete_stations` (locations→assets→OLs→remarks→inspections+items+schedules), `_cascade_delete_users` (nulls user refs on OL/inspections instead of deleting them — preserves audit), `_cascade_delete_asset_types` (refuses if assets reference them).

**Frontend** (`/app/frontend/src/components/DataHealthPanel.js` — new)
- New `/admin → Health` tab with 10 category cards (icon, count, sample list, Preview + Clean buttons).
- Per-record inline preview & delete icons within each card.
- Two-step UX: Preview cascade impact dialog → final confirm dialog with **"I understand"** checkbox that gates the execute button.
- Audit log table at bottom of panel.
- Admin role sees view-only ("Superadmin required" banner); superadmin sees execute buttons.

**Bug fixed mid-iteration**: Initial `preview()` for bulk categories crashed with 500 because it called `scan()` directly leaving `stale_months` as a FastAPI `Query()` sentinel. Fix: explicit `stale_months=STALE_MONTHS_DEFAULT` arg in the helper call.

**Tested**: `testing_agent_v3_fork` iteration_22 — backend now 100% (bug above patched & re-verified via curl), frontend 100% (10 cards, badge, rescan, confirm checkbox gating, audit table all PASS). End-to-end smoke: orphan_inspection_items count 4→0; test_stations count 3→2 after single-target cascade.

### Feb 2026 — Comparative Reports v3 (Section C removed, drill folded into A)
**Backend** (`/app/backend/routers/comparative.py` — 5 new endpoints appended)
- `GET /api/reports/comparative/asset-type/locations/{user_id}` — Level 2: locations grouped by station for a given asset-type
- `GET /api/reports/comparative/asset-type/assets/{user_id}` — Level 3: individual assets at (type, location) with `status` (working/yellow/orange/red), `list_type`, `days_defective`, `last_inspection_at`
- `GET /api/reports/comparative/station-supervisors/{user_id}` — SUPs at one station with department tag + MTTR
- `GET /api/reports/comparative/ros/{user_id}?dept_id=` — list of ROs (dept-cascadable) with dept + station codes
- `GET /api/reports/comparative/ro-supervisors/{user_id}?ro_id=` — RO header (name, dept, station codes, **avg_mttr**, sup_count) + per-SUP MTTR rows

**Frontend**
- **Section C removed entirely** (no more 4-level grouped chart card)
- Section A → `SectionAExplorer`: AssetType → Locations (grouped by station with sticky headers) → Assets (with WORKING/YELLOW/ORANGE/RED status badges + days-defective + last-inspection-date) → existing `AssetHistoryDrawer`
- Section B → `SectionBPeers`: single-select Category (Station / RO). Station mode shows SUPs with dept-coded chips. RO mode shows RO header card (avg MTTR + sup_count + dept + station codes) + SUP cylinders. Click any SUP → navigates to `/performance/<sup_id>`.
- New page: `/app/frontend/src/pages/PerformanceSheetPage.js` wraps existing `SupervisorAnalyticsView` for the new route.
- New route `/performance/:userId` wired in `App.js`.
- **Station multi-select** added to top toolbar (filters Section A scope).
- `CylinderBar` upgraded: 6-stop gradient, drop-shadow filter, ambient occlusion overlay, deeper end-cap shading, V-shape zigzag break with white outline for outliers > 2× p90.
- '—' / empty asset-type names rendered as `(unnamed)`, non-drillable, with admin warning banner for SA/Admin only.
- Tested via `testing_agent_v3_fork` iteration_21: backend 14/14, frontend 100% (Section A 4-level drill, Section B station+RO modes, /performance route navigation, station multi-select, cylinder visuals all verified).

### Feb 2026 — Comparative Reports PDF/Excel Export with Configurable Sections
**Backend** (`/app/backend/routers/comparative_export.py` — new)
- `POST /api/reports/comparative/export/pdf/{user_id}` and `POST /api/reports/comparative/export/excel/{user_id}` accepting `ExportRequest` body: `window_days, stat, dept_id, asset_type_ids, drill_state{level,parent_id,parent_asset_type_id}, sections{card_a,card_b,card_c_current,card_c_full,defective,remarks,last_inspection}, style`.
- **PDF** (ReportLab, A4 portrait): cover with filter chips · Card A table with semantic-colored mini cylinder bars · Card B with embedded radar SVG + peer matrix table · Card C current view (or full hierarchy if requested) · defective-only landscape table · last-inspection table · remarks appendix (last 5 per defective asset, grouped by asset).
- **Excel** (openpyxl): multi-sheet workbook — Summary | By Asset Type | Peer Matrix | Drilldown | Defective Only | Last Inspections | Remarks. Self row in Peer Matrix highlighted teal; defective rows tinted red/orange by list type.
- SUP role anonymisation honored in both formats; current user always shown with real name + ★ marker.

**Frontend** (`/app/frontend/src/components/ComparativeExportDialog.js` — new; `pages/ComparativeReportsPage.js` updated)
- `ComparativeQuickDownload` inline buttons (PDF / Excel / Configure…) at top of Comparative tab — uses default sections.
- `ComparativeExportDialog` with 7 section toggles (data-testid `comp-export-{section}`) + style picker (Detailed / Compact). Filters and current drill state are inherited from the page.
- Drill stack lifted to parent so exports always reflect what the user is currently viewing.
- Tested via `testing_agent_v3_fork` iteration_20: backend 11/11 + frontend dialog/toggles/network all PASS. PDF=19KB %PDF-1.4 valid; Excel=14KB 7-sheet workbook parseable.

### Feb 2026 — Comparative Reports v2 (4-level drilldown + 3D cylinder bars + radar)
**Backend** (`/app/backend/routers/comparative.py`)
- `GET /api/reports/comparative/grouped/{user_id}` extended to **4 levels**: `station` → `location_summary` → `location_types` → `asset`. New `parent_asset_type_id` query param for the asset level. Empty stations now hidden. Returns `p90` in payload (used for broken-axis detection in UI).
- New `dept_id` filter cascades through grouped + by-asset-type endpoints; restricts asset-types to that dept.
- New `GET /api/reports/comparative/by-supervisor-radar/{user_id}` — returns axes (asset-types) × series (supervisors with per-axis median repair hours). Anonymises peer names for SUP role; current user always sees their own real name with `is_self=true`.

**Frontend**
- New `/app/frontend/src/components/CylinderBar.js` — horizontal 3D aqua-glass cylinder bars: per-item gradient (light top → mid → dark bottom), inner glass shine strip, full ellipse end-cap, broken-axis zigzag (∿) when value > 2× p90 with bold red ★ at numeric tip. "No data" rows show grey dashed shell. Tooltip shows n/min/max.
- New `/app/frontend/src/components/RadarChart.js` — labeled spider chart, axes = asset-types; teal self polygon overlays light-blue peer polygons; per-axis "you: X hrs" labels at axis tips.
- `/app/frontend/src/pages/ComparativeReportsPage.js` rewritten:
  - Card A — horizontal CylinderBar with **semantic** coloring (green=fast repair, red=slow), no longer index-based.
  - Card B — RadarChart with admin/SA empty-state copy when no department selected.
  - Card C — 4-level drilldown using horizontal CylinderBar with click-to-drill and breadcrumb navigation; clicking an asset opens AssetHistoryDrawer.
  - Department dropdown cascades into asset-type picker and all 3 cards.
- Tested via `testing_agent_v3_fork` iteration_19: backend 10/10, frontend 100% (cylinder-bar-chart, radar-chart, card-c-root, comp-dept, comp-stat all verified; 4-level drill Station → DHANBAD → Platform No-1 → Ceiling Fan → FAN-9 confirmed; broken-axis zigzag + ★ visible on outlier; semantic coloring confirmed). Audit 10/10 PASS.

### Feb 2026 — Asset stats drilldown + Comparative reports tab
**Backend** (`/app/backend/routers/comparative.py`)
- `GET /api/orange-list/{asset_id}/asset-stats?window_days=` — per-asset stats: times defective · min/max/median/mean repair · functional% · ETA (asset history fallback to asset-type@station median) · trend (Δ% vs prior window)
- `GET /api/reports/comparative/by-asset-type/{user_id}` — Lens 1: MTTR by asset type at user's station scope
- `GET /api/reports/comparative/by-supervisor/{user_id}` — Lens 2: peer supervisor comparison; **anonymised for SUP role**, real names for RO/ASUP/Admin/SA; current user always has their own real name + highlight
- `GET /api/reports/comparative/grouped/{user_id}` — Lens 3: 3-level drilldown engine (level=station → location → asset). Returns groups with bars per asset-type. Default top-5 asset types globally (configurable via `asset_type_ids`)

**Frontend Part A** — Orange/Red list rows enriched
- Asset numbers are clickable + 📊 history icon → opens `<AssetHistoryDrawer>`
- Inline `ETA ~Xh` badge on every defective row (background-loaded, capped to 30 calls)
- Drawer extended with: window picker (7/15/30/90/FY/all), 6 stat cards (times defective · functional% · n · median/min/max), ETA + trend strip, repair history list — both in `OrangeListPage.js` and the legacy `OrangeListPanel.js`

**Frontend Part B** — New "Comparative" tab in `/reports`, visible to SUP/RO/ASUP/Admin/SA
- Top toolbar: Window · Stat (Median/Mean) · Asset Type (for Card B) · Asset Types multi-select (for Card C, default top-5)
- **Card A** — MTTR by asset type at user's stations (single bar list)
- **Card B** — Comparative supervisors within dept × asset type, "you" highlighted; SUP sees peers as "Peer 1/2/…"
- **Card C** — Pure-SVG **grouped vertical bar chart** with breadcrumb-driven drilldown:
  - Level 1: clusters of asset-type bars per station
  - Level 2 (click a station): clusters per location within that station
  - Level 3 (click a location): one bar per individual asset, color-coded by asset type, click → opens `<AssetHistoryDrawer>` from Part A
- Worst-first sort at every level · empty grey placeholder bars for missing data · interactive tooltips with min/max/n

**Verified end-to-end**: backend curl tests all pass (Part A + 3 lenses); UI smoke confirms 24 ETA chips, 25 clickable asset links, stats strip in drawer; Card C renders 5-bar clusters at level 1, drills cleanly to locations at level 2; audit 10/10 PASS.

### Feb 2026 — Reports Builder v2 (all 6 layers — comprehensive)
**Backend** (`/app/backend/routers/reports_builder.py`)
- **Layer 1 — Dimensions** (19 total): + ro · asup · inspector · reporter · list_type · defect_age_band · repair_age_band · hour_of_day · day_of_week · per-asset
- **Layer 2 — Metrics** (12 total): + first_time_fix_rate · recurrence_rate · backlog_age · throughput · avg_approval_lag · pct_pending · inspection_coverage. MTTR/backlog/avg_approval_lag now expose p25/p75/p90/p99/min/max/mean
- **Layer 3 — Filters**: + asset_statuses · list_types · repair_cap_hours · recurrence_within_days · include_rejected_in_mttr · hour_from/to · compare_to_previous (returns deltas)
- **Layer 4 — Output controls**: sort_by/sort_dir · top_n · bucket_other_after · totals_row · n_threshold · viz hint · annotations (title/subtitle/note)
- **Layer 5 — Multi-section dossiers**: `/dossier/run`, `/dossier/save`, `/dossier/saved`, `/dossier/export/pdf` (cover page + per-section), `/dossier/export/excel` (one sheet per section)
- **Layer 6 — Run history**: every successful run logged to `report_runs`; `/runs/{user_id}` returns last N. New collections: `report_runs`, `saved_dossiers`

**Frontend** (`/app/frontend/src/pages/ReportsBuilderPage.js`)
- 3 sub-tabs inside Builder:
  - **Single Report** — Featured library (8) · Composer with collapsible "advanced" panel exposing all Layer 3-4 controls · Result panel auto-renders Bar / Donut / Line / Heatmap by viz pick · Δ vs previous-period column · "Add to Dossier" button
  - **Dossier** — Cover editor + sections list (drag up/down, rename, delete) · Save/PDF/Excel · Saved dossiers panel
  - **History** — Last 20 runs · click any to instantly re-apply

**Verified end-to-end**: backend curl tests all pass (12 metrics, 19 dims, output controls, compare-to deltas, dossier 4-page PDF, dossier 4-sheet Excel); frontend smoke shows all 3 tabs rendering, advanced filters expanded, dossier with 2 sections, 6-row history. Audit 10/10 PASS.

### Feb 2026 — Reports Builder (Phase 1 + 2 of Option C)
**Backend** (`/app/backend/routers/reports_builder.py`)
- Generic engine: 5 metrics (`pct_working`, `mttr`, `defect_frequency`, `rejection_rate`, `inspection_volume`) × 9 dimensions (station, location, dept, asset_type, supervisor, day/week/month/quarter) × 7 time windows (7d/30d/90d/180d/FY/all/custom).
- 2-dimension cross-tab support → server returns matrix structure consumable as a heatmap.
- Filters: station_ids, dept_ids, asset_type_ids (multi-select).
- Endpoints (all SA-only via `_ensure_sa()` gate):
  - `POST /api/reports/builder/run/{user_id}` — execute config, return rows or matrix
  - `GET  /api/reports/builder/featured` — 8 ready configs (no-auth list)
  - `GET  /api/reports/builder/dimensions/{user_id}` — UI metadata
  - `GET/POST/DELETE /api/reports/builder/saved/{...}` — saved-reports CRUD (per-owner)
  - `POST /api/reports/builder/export/{csv|excel|pdf}/{user_id}`
- New collection: `saved_reports`.

**Frontend** (`/app/frontend/src/pages/ReportsBuilderPage.js`)
- New "Builder" tab inside `/reports` (Tabs wrapper around existing Dashboards view; Builder shown only to SuperAdmin).
- 3-column layout: Featured library | Composer + Result | Saved reports.
- Composer: 4 dropdowns (Metric / Group X / Cross Y / Window) + filter multi-selects (Stations/Depts/Asset Types).
- Result: bar chart + table for single-dim; color-graded heatmap for cross-tab; MTTR shows extra p75/p90/min/max/mean columns.
- Save current config (named) and one-click apply from featured/saved cards.
- CSV / Excel / PDF export buttons run the same config server-side.

**Verified**: SA can run, save, delete configs; 8 featured cards apply correctly; heatmap renders for Defect Freq Station×AssetType cross-tab; 403 gate confirmed for non-SA users; audit 10/10 PASS.

### Feb 2026 — Per-station 30-day Health Trend sparkline (Reports)
- **Backend** (`reports.py`):
  - New `_compute_30day_trend(station_assets, all_ols_by_asset, now_dt)` — computes per-day % working (incl. yellow) for the last 30 days by reconstructing each asset's defective intervals from OL history (defective_since → earliest of marked_working_at/approved_at). Returns 30-element array (idx 0 = 29d ago, idx 29 = today).
  - `_load_universe()` now also pulls all OL entries (incl. resolved) grouped by asset.
  - `_build_station_card()` adds `trend_30d: [...]` to its response.
  - Verified: SUP DHANBAD card returns `[98, 98, ..., 78, 66, 38, 36, 36]` reflecting the recent defect surge.
- **Frontend** (`ReportsPage.js`):
  - New `<HealthSparkline>` component — SVG line+area chart with:
    - Color matched to current % (gradient red→green)
    - 80% reference line (red dashed)
    - End-point dot + min-point marker
    - Header: `30-DAY TREND` + delta indicator (▲/▼ with color)
    - Footer: `30d ago · X%` / `min Y%` / `today · Z%`
  - Wired into `StationCard` — appears below LocationBars on every station card (direct SUP view + RO/ASUP/Admin/SA drill drawers).
- **Verified**: rendered in SUP and SA drill views; audit 10/10 PASS; no regressions.
- **New route `/reports`** added to all roles' nav. Role-aware view:
  - **SUP**: per-station cards with concentric asset-type rings + location bars (worst-first)
  - **RO / ASUP**: per-supervisor mini-cards → click drills into drawer with that SUP's station cards
  - **Admin / SuperAdmin**: per-RO cards with concentric department rings + supervisor bars → drill chain
- **Center % design**: smooth gradient (≤80% deep red → 100% pure green). Shared between backend `health_color()` and frontend `gradientColor()`.
- **% formula**: `(working + yellow) / total` per user spec.
- **Concentric rings**: each ring = one asset_type (SUP) or department (Admin/SA). W shown as light grey, Y/O/R emphasized.
- **G13/G14**: 0-asset stations hidden; 0-defect stations show "✓ ALL CLEAR" badge.
- **PDF export** (ReportLab, A4 portrait): cover + per-card pages with summary tables and color-coded % cells.
- **Excel export** (openpyxl): multi-sheet (Summary, view-specific, flat Assets per F12).
- **Drill-down**: dialog/drawer with nested drills (RO → SUP → station), each level has its own export buttons.
- **Files**: `/app/backend/routers/reports.py`, `/app/frontend/src/pages/ReportsPage.js`. Wired into `server.py` + `App.js` + nav.
- **Verified**: SA endpoint returns `view: ros` with 3 RO cards; PDF generates valid `%PDF-1.4` (6.1KB); Excel generates valid `.xlsx`. E2E lifecycle 0 discrepancies. Audit 10/10 PASS.

### Feb 2026 — Input focus-loss bug fix (asset/user creation, 1-char-per-click typing)
- **Bug**: Typing in asset_number / employee_id / name / description fields captured only 1 character per click. Even slow typing failed.
- **Root cause**: `AssetForm` and `UserForm` were defined **inside** their parent components as nested arrow-function components. Every parent re-render created a new component identity, causing React's reconciler to unmount+remount the form on every keystroke — the `<Input>` lost focus each time.
- **Fix**: Renamed to `renderAssetForm` / `renderUserForm` (lowercase) and invoked as function calls `{renderAssetForm(false)}` instead of as components `<AssetForm isEdit={false} />`. This makes the returned JSX part of the parent's render tree — no component identity change, no unmount, focus is preserved.
- **Files changed**: `AssetsPage.js:199`, `UsersPage.js:174` + 4 call sites.
- **Expected: typing "TEST-ASSET-12345" now captures all 16 characters in one flow.**

### Feb 2026 — Frontend `.toISOString()` IST→UTC roundtrip bug fix
- **Bug**: User types "20 Feb 2026, 23:30" → `.setHours(23,30)` + `.toISOString()` shifts to UTC → backend stores `2026-02-20T18:00:00` as naive IST → PDF/dashboards render as 6 PM (5h30m off). Affected 4 user-input datetime flows.
- **Fix**: New `toIstLiteral(dateInput, timeStr)` in `/app/frontend/src/lib/utils.js` extracts LOCAL Y/M/D from the picker's Date and applies the user's typed `HH:mm` directly — no UTC roundtrip.
- **Applied to all 4 places**:
  1. `InspectionPage.js` — `inspection_at`, `defective_since`, `rectified_on`
  2. `OrangeListPage.js` — `marked_working_at`
  3. `OrangeListPanel.js` — `marked_working_at`
  4. `MarkDefectiveDialog.js` — `defective_at`
- **Self-heal added in backend**: `_apply_inspection_item_effects()` now back-fills null `OL.defective_since` with the canonical value on next inspection, preventing the legacy-data 500 that surfaced earlier.
- **Verified**: E2E lifecycle 0 discrepancies; manual test shows user input "20 Feb 2026 23:30" now stored and rendered as "20 Feb 2026, 11:30 PM" everywhere.

### Feb 2026 — Comprehensive E2E Lifecycle Test Harness
- **`/app/backend/tests/e2e_full_lifecycle.py`**: 10-phase orchestrator that creates a full org slice (1 station, 3 users — RO/ASUP/SUP, 2 asset types, 5 assets across Electrical+Commercial), runs the entire defect lifecycle (inspection → orange/red → mark working → approve/reject → re-inspect → auto-reject), exercises remarks from all 4 roles, validates IST literal format on every API response, runs the 10-invariant audit, and **guarantees full cleanup** via `try/finally` (deletes by tracked _ids + tag-prefix sweep + asset/user link sweep).
- **Verified on preview**: RUN_ID=5D02488A — 0 discrepancies. All 10 phases passed:
  - List type assignments (E0=red @ 30h, E1/C0=orange @ 2h)
  - Cross-role scope (SUP=Electrical only, ASUP=all 3 cross-dept, RO=Electrical at station)
  - Mark working → Yellow
  - ASUP approve → Resolved (asset.defective_since cleared)
  - ASUP reject → back to defective with **clock preserved** (canonical defective_since intact)
  - All 4 roles post remarks; SA reads all 4 with correct role tags
  - Auto-reject on re-inspection of yellow → defective with clock preserved
  - All datetimes across superadmin/supervisor/approving-supervisor/reporting-officer endpoints are bare IST literals (no Z, no +05:30)
  - Audit: 10/10 PASS
- **Cleanup confirmed**: asset count 74 → 74 (zero net change). All test inspections, OL entries, remarks, notifications, audit_log entries, asset_types, station, and users removed.

### Feb 2026 — Auto-reject on re-inspection + canonical `defective_since`
- **Auto-reject path**: when NOT_OK or NEEDS_REPAIR is filed on a YELLOW (pending_approval) asset, the system reverts the OL to defective, clears `marked_working_by/at` (preserved as `last_marked_working_by`), sets `rejection_remarks/rejected_by/rejected_at`, posts a `rejection` auto-remark, notifies the original SUP + ROs/SUPs/ASUPs, and writes audit log `re_inspection_auto_rejected`. **Clock (`OL.defective_since`) is NEVER reset.**
- **Canonical `defective_since`**: `OL.defective_since` is the immutable source of truth. `asset.defective_since` is mirrored from OL on every write — never overwritten with the new inspection's typed value. Notifications, dashboards, PDFs all read from this canonical field.
- **Inspection POST response** now returns `auto_rejections: [{asset_id, ol_id}]`. Frontend toast: *"Inspection submitted. ⚠ N asset(s) re-reported defective — prior rectification claim auto-rejected."*
- **PDF inspection report fix** (`inspection-report.js`): replaced hardcoded "PENDING APPROVAL" badge with live classifier (ORANGE/RED/YELLOW/RESOLVED/PASS) computed from `asset.status` + `ol_defective_since`. When canonical and inspector-typed `defective_since` differ, both are shown. All datetimes use the shared IST literal formatter.
- **Audit invariant I9** added — every defective/pending asset must have `asset.defective_since == OL.defective_since`. Audit now 10/10 PASS.
- **Drift scanner** at `/app/backend/scripts/diff_defective_since.py` (read-only).
- **Verified by `testing_agent_v3_fork` iteration 18**: 8/8 backend + 6/6 classifier + 10/10 audit all pass. Net DB shift: yellow 9→3, OLs created/transitioned per test scenarios.

### Feb 2026 — Cross-UI IST consistency hardening (post-Phase IST)
- **OL page tab badge counts fixed** — previously badges showed only counts within the current paginated page (e.g., "Red (12)" when API truth was 30). Now `OrangeListPage.js` fetches the full unpaginated list once, derives Orange/Red/Yellow buckets in memory, and paginates client-side per active tab. Tab badges always reflect true totals.
- **Remarks drawer datetime format unified** — auto-event timestamps inside `RemarksThread.js` now use the shared `formatDateTime()` helper (was previously inline `new Date().toLocaleString` with different format options). Across OL row → drawer → asset history, the same datetime now renders byte-identically.
- **Verified by `testing_agent_v3_fork` iteration 17**: 13/13 backend tests pass (+5 new cross-UI tests in `test_ist_cross_ui_consistency.py`) + frontend Playwright covered Superadmin/SUP/ASUP across 7 spec items including byte-identical cross-page timestamp comparison. Zero `Z`, `+05:30`, `GMT`, `UTC` strings on any rendered page.

### Feb 2026 — Phase IST + List Consistency Audit
- **IST-only datetime model** — system operates exclusively in Indian Standard Time. Backend uses `now_ist()` (naive IST datetimes). `_dt_to_iso()` emits bare ISO strings (no `Z`, no offset). Frontend `formatDateTime` parses literal string parts via `Intl` formatter — no JS Date timezone math, so display always matches storage regardless of browser TZ. Legacy UTC data displays with a one-time +5h30m label shift (accepted tradeoff per user choice 1b).
- **Timestamp-ordering hard-reject (HTTP 400)** on:
  - `POST /api/inspections` — rejects future `inspection_at`, future `defective_since`, or `defective_since > inspection_at`
  - `POST /api/orange-list/{id}/mark-working` — rejects future `marked_working_at` or `marked_working_at < defective_since`
  - 5-minute clock-skew tolerance on all checks
- **Pending Verification tile split** — yellow (rectified, awaiting ASUP verification) is now its own dedicated tile separate from "Active Defects". Implemented on Superadmin, Admin, SUP, ASUP/RO dashboards. Pie chart legend on every dashboard shows Working/Orange/Red only.
- **List-consistency audit** — new read-only audit script `/app/backend/tests/audit_list_consistency.py` (9 invariants × all assets) + pytest wrapper `test_list_consistency.py`. Catches asset-OL drift, list exclusivity violations, time-math anomalies, orphaned records. Currently 9/9 PASS.
- **DB cleanup** — fixed 1 stray asset with non-canonical status, removed 3 orphaned resolved OL entries pointing to deleted assets, clamped 1 historical bad-timestamp resolved OL.
- **Test files added**: `/app/backend/tests/test_ist_and_validation.py` (7 tests covering IST format + 400-validations) by testing agent.

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

### Phase 2 — Inspection & Approval Workflow (DONE — May 2026)
- Removed per-item ASUP approval gate from inspections; auto-applied effects on submission
- Date/time entry (with defaults) for both mark-defective and mark-working events
- When defective asset marked OK during inspection → auto-triggers Yellow List (pending_approval)
- Added Reject-Working endpoint (`POST /api/orange-list/{id}/reject-working`)
- Renamed "Pending" tab → "Yellow List" in OrangeListPage
- Added `marked_working_at` date/time picker in Mark Working dialog
- Added Reject button (ASUP only) in Yellow List tab
- Added `rejectWorking` API method in api.js
- All tested: 16/16 backend tests pass, 100% frontend flows verified (iteration_8.json)

### Phase 3 — Orange List Panel in Role Dashboards (DONE — May 2026)
- Created reusable `OrangeListPanel` component (`/app/frontend/src/components/OrangeListPanel.js`)
  - mode='sup': Orange + Red tabs, Mark Working action (with date/time picker dialog)
  - mode='asup': Yellow List only, Approve + Reject actions
  - mode='ro': Orange + Red + Yellow tabs, read-only
- Removed "My Tasks" tab from SUP, ASUP, and RO dashboards
- SUP dashboard: replaced with "Defects" tab using OrangeListPanel mode='sup'
- ASUP dashboard: replaced with "Yellow List" tab using OrangeListPanel mode='asup'
- RO dashboard: replaced with "Dept Defects" tab using OrangeListPanel mode='ro'
- All tested: 32/32 frontend checks pass (iteration_9.json), zero regressions

### Phase 4 — Supervisor Performance Analytics (DONE — May 2026)
- Data model fix: `reject_working` now preserves `last_marked_working_by` for rejection count tracking
- New `GET /api/analytics/supervisor/{id}/performance` — date range + station/location filters, Option A timing, only resolved defects, rejection count
- New `GET /api/analytics/approving-supervisor/{id}/performance-summary` — comparison table for ASUP
- New `GET /api/analytics/reporting-officer/{id}/performance-summary` — comparison table for RO
- New `GET /api/dashboard/admin` — admin dashboard endpoint (was missing)
- New `SupervisorAnalyticsView.js` — reusable component with filters, 4 stat cards, category cards, per-asset rows
- SUP "My Performance" tab now uses SupervisorAnalyticsView with date/station/location filters
- ASUP + RO dashboards: new "Performance" tab with sortable comparison table + click-to-drill-down
- Admin dashboard: "Performance Analytics" button → inline panel with station/dept filter → supervisor picker → full analytics
- Fix 1: `GET /api/schedules/supervisor/{user_id}` — replaced dead `assigned_supervisor_id` query with implicit station+department scoping
- Fix 2: `GET /api/schedules/approving-supervisor/{id}/supervisors` — asset counts now use implicit scoping
- Fix 3: `approve_working` — SUP who marked asset working now notified when ASUP approves
- Fix 4: `approve_working` + `reject_working` — ROs scoped to asset's dept+station now notified on both approve and reject
- All tested: 26/26 backend tests pass (iteration_10.json, test_phase4_fixes.py)
- Defect period = defective_since → marked_working_at (user-entered)
- Per-incident breakdown for Supervisor
- Supervisor comparison by date range for RO

### Phase 5 — Threaded Remarks System (DONE — May 2026)
- New collections: `remarks`, `remark_tags`
- New router `/app/backend/routers/remarks.py`:
  - `GET /api/orange-list/{id}/remarks` — full thread w/ read_only + archival flags (60-day TTL after approval)
  - `POST /api/orange-list/{id}/remarks` — immutable post; types: note / observation / escalation; 300-char limit (Pydantic)
  - `GET /api/remarks/tags` (+ POST/PUT/DELETE — admin/superadmin only) — dynamic tag master
- Default tags seeded on startup: spare_pending, work_order (requires_ref), escalated, under_observation, awaiting_contractor
- Permissions per type:
  - note → SUP/ASUP/RO/Admin/Superadmin
  - observation → ASUP/RO/Admin/Superadmin
  - escalation → all roles
- Auto-remarks logged via `add_auto_remark()` hooks on:
  - inspection submit (defect_report + rectification)
  - orange_list mark_working (rectification)
  - orange_list approve_working (approval)
  - orange_list reject_working (rejection)
- Notification fanout: note→ASUP+RO, observation→SUP+ASUP, escalation→SUP+ASUP+RO (scoped to asset's station/dept)
- Frontend:
  - `RemarksThread.js` — expandable thread + composer (300-char counter, type/tag select, work_order ref input, one-time confirmation dialog)
  - `RemarkTagsManager.js` — admin Tags tab CRUD UI
  - `OrangeListPanel.js` + `OrangeListPage.js` — "Remarks" toggle on each defect row
  - `AdminPage.js` — new "Tags" tab
- Tested via `testing_agent_v3_fork` (iteration_13.json): 18/18 backend, 100% on critical UI flows

### Phase 4 Extensions — Hierarchical Analytics (DONE — May 2026)
- New `GET /api/analytics/admin/rollup` — Stations × Departments performance matrix with:
  - Per-cell aggregates (sup_count, asset_count, total_defects, avg_repair, pct_functional, rejection_count, zero_defect, is_orphan, sup_ids)
  - Per-department FY benchmark (Indian financial year Apr 1–Mar 31)
  - Date-range filter (from/to)
  - Admin/superadmin guard via `current_user_id` query param
- New `GET /api/analytics/admin/coverage-gaps` — orphan SUP/ASUP/RO detection
  - Missing SUP entries severity=red (per Station × Dept)
  - Missing ASUP entries severity=amber (per Station)
  - Missing RO entries severity=amber (per Station × Dept)
  - Same admin guard
- Existing ASUP/RO `/performance-summary` endpoints now return per-row `benchmark` (FY label + fy_avg_repair_hours) and `summary.zero_defect` flag; row sort behaviour unchanged
- New `_fy_window` / `_fy_label` / `_dept_fy_avg_repair_seconds` helpers in analytics.py
- Frontend:
  - `AdminPerformanceMatrix.js` (new) — coverage-gaps banner + Stations × Departments matrix + Tier 2 inline expand (cell/row/col → SUP comparison list) + Tier 3 drill (full SupervisorAnalyticsView)
  - `OversightDashboard` PerformanceComparisonTab — added "Dept FY ★" column with delta arrow (▲ red / ▼ green) and ★ icon for zero-defect rows (emerald-tinted background)
  - `SupervisorAnalyticsView` — added "By Type | By Station" toggle when SUP has >1 station; ★ + "Zero defects in this period" label in header when applicable
  - `SuperadminDashboard` — new "Performance" tab using AdminPerformanceMatrix
  - `AdminDashboard` — "Performance Analytics" button now opens AdminPerformanceMatrix
- Tested via `testing_agent_v3_fork` (iteration_14.json): 20/20 backend, 100% on critical UI flows. No bugs.

### Asset Health Source-of-Truth Fix (May 2026)
- **Bug found:** Superadmin dashboard's orange/red counts disagreed with the Orange/Red List page (6 orange / 8 red on dashboard vs 1 orange / 13 red on list — both totalling 14). Root cause: `_classify_health()` read `asset.defective_since` which was `None` on 4 assets while their orange_list entry held the correct timestamp. Additionally, `reject_working` reset `asset.status='defective'` but didn't restore `asset.defective_since`.
- **Fixes:**
  1. **Read-side (option A):** `_classify_health(asset, now, open_ol_entry=None)` now treats orange_list as the canonical source. New `_open_ol_entry(history)` helper picks the most-recent non-resolved entry. All 5 dashboard endpoints (admin/superadmin/asup/ro/dashboards) now pre-fetch OL history and pass the open entry.
  2. **Write-side (option B-lite):** `orange_list.reject_working` now also restores `asset.defective_since` from the OL entry.
  3. **Backfill:** `/app/backend/scripts/backfill_defective_since.py` (idempotent) — sync existing assets where the two sources disagree. Ran once: 2 assets fixed, 12 unchanged, 0 stale-working.
- **Verified:** `/api/dashboard/superadmin` health and `/api/orange-list` now both report consistent counts. 54/54 regression tests still pass.

### Yellow Slice & Inspection Enum Audit (May 2026)
- **Yellow slice in dashboard pie chart:**
  - `_classify_health()` now returns `'yellow'` for `status='pending_approval'` (rectified, awaiting ASUP verification) — separate from `'orange'`/`'red'` age-classification of active defects.
  - All dashboard accumulator dicts in `dashboards.py` now include `"yellow": 0`.
  - Frontend `SuperadminDashboard.js` pie chart adds 4th yellow slice (`#eab308`); `HealthBadges` shows yellow count badge; `DrillDownView` row badge styling handles yellow class.
- **Inspection enum audit:** Backend, frontend, and DB all consistently use lowercase `ok`/`not_ok`/`needs_repair` and `individual`/`sig`. Added explicit docstrings to `InspectionType` and `InspectionItemStatus` enums in `models.py` to prevent future testing-agent confusion.

### Future / Backlog
- SMS/WhatsApp notification integration (infrastructure present, needs API keys)
- Profile page: Schedule Summary tab
- Optimize `_dept_fy_avg_repair_seconds` via Mongo `$match` aggregation (currently filters in Python)
- Performance matrix: documented caveat that SUPs assigned to N stations have asset_count summed across all N rows

### Data Consistency Audit — 3 Bugs Fixed (May 2026)
A 68-check cross-system audit was run covering 17 test phases with variable-date defect injection across 6 assets (1h, 10h, 25h, 50h, 96h, 192h defective). Three bugs were found and fixed:

#### Bug 1: `GET /api/dashboard/stats` — orange+red count included pending_approval
- **Root cause:** `all_defective` query used `status != resolved`, so `pending_approval` items (yellow) leaked into `orange_list_count` / `red_list_count`.
- **Fix:** Changed query to `status == defective` only (`/app/backend/routers/dashboards.py` line ~42).

#### Bug 2: `GET /api/orange-list?list_type=orange/red` — returned pending_approval items
- **Root cause:** `list_type` filter only compared computed orange/red classification (based on time), not the actual status. `pending_approval` items with < 24h defective_since were returned as "orange".
- **Fix:** Added an early `continue` for `pending_approval` status entries when `list_type` filter is active (`/app/backend/routers/orange_list.py` line ~195).

#### Bug 3: SUP-scoped orange list had cross-department pollution
- **Root cause:** The `$or: [reported_by=sup_id, asset_in_scope]` logic in SUPERVISOR OL scoping included assets from other departments if the SUP was the `inspector_id`. This caused OL list count > dashboard health count for the same SUP.
- **Fix:** Removed legacy `reported_by` OR clause. Now uses strict station+dept scope only: `query["asset_id"] = {"$in": list(scope_asset_ids)}` (`/app/backend/routers/orange_list.py` line ~79-97).
- **Note:** This is consistent with Phase 1 (removal of `assigned_supervisor_id`); the `reported_by` OR clause was a pre-Phase-1 remnant.

**Audit result: 68/68 PASS** — All dashboards (Superadmin, Admin, SUP, ASUP, RO), orange-list endpoint, stats, station health, drill-downs, filter consistency, remarks thread, yellow lifecycle, and role-scoping containment (SUP ⊆ ASUP ⊆ SA) all verified consistent.
