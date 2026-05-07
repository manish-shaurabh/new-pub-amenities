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
