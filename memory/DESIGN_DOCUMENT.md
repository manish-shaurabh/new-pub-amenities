# Railway Asset Inspection Management System
## Comprehensive Design Document
> Version 1.0 — Generated from production codebase, May 2026

---

## TABLE OF CONTENTS
1. [System Overview](#1-system-overview)
2. [Technology Stack](#2-technology-stack)
3. [Backend Architecture](#3-backend-architecture)
4. [Frontend Architecture](#4-frontend-architecture)
5. [Database Design](#5-database-design)
6. [API Reference](#6-api-reference)
7. [Security Controls](#7-security-controls)
8. [User Roles & Authorization Matrix](#8-user-roles--authorization-matrix)
9. [What Is Mocked / Not Fully Implemented](#9-what-is-mocked--not-fully-implemented)
10. [Design Tradeoffs](#10-design-tradeoffs)
11. [Cloud Migration Guide (Azure / AWS)](#11-cloud-migration-guide-azure--aws)

---

## 1. System Overview

The Railway Asset Inspection Management System is a **production-ready FARM stack application** (FastAPI + React + MongoDB) that digitizes the entire lifecycle of railway station asset maintenance:

```
Field Inspection → Defect Recording → Orange/Red/Yellow List Tracking
       → Approval Workflow → Analytics & Reporting → Notifications
```

### Core Business Flows

| Flow | Description |
|------|-------------|
| **Asset Master** | Hierarchical data: Department → Asset Type → Station → Location → Asset |
| **Inspection** | Supervisors record per-asset inspection results (OK / Not-OK / Needs Repair) with optional photo evidence |
| **Defect Lifecycle** | Not-OK creates an OL entry: Defective → (SUP marks working) → Pending Approval (Yellow) → ASUP approves → Resolved |
| **List Classification** | Open defects < 24 hours = Orange List; ≥ 24 hours = Red List; awaiting sign-off = Yellow List |
| **Threaded Remarks** | Immutable per-defect comment thread with tags, escalation types, and auto-logged system events |
| **Analytics** | FY benchmarks, department-level rollup matrix, coverage gap detection, per-SUP performance |
| **Notifications** | In-app notification chain: SUP → ASUP → RO → Admins → Superadmin on every defect event |

---

## 2. Technology Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| **Runtime** | Python | 3.11 | FastAPI ASGI via uvicorn |
| **Web Framework** | FastAPI | 0.110.1 | Async, Pydantic v2, OpenAPI auto-docs |
| **Database Driver** | Motor (async) + PyMongo (sync) | 3.3.1 / 4.5.0 | Motor for API routes, PyMongo for scripts |
| **Database** | MongoDB | 6.x | Document store; 14 collections |
| **Auth** | PyJWT + bcrypt | 2.12.1 / 4.1.3 | HS256 tokens, 24h expiry |
| **Validation** | Pydantic v2 | 2.12.5 | Request/response models, enum coercion |
| **Frontend** | React | 18.x | SPA with React Router v6 |
| **UI Library** | Shadcn/UI + Radix | — | Accessible component primitives |
| **HTTP Client** | Axios | — | With JWT interceptor + 401 redirect |
| **Charts** | Recharts | — | Pie, Bar, and Area charts |
| **CSS** | Tailwind CSS | — | Utility-first, dark-mode capable |
| **Process Manager** | Supervisor | — | Manages backend + frontend in container |
| **Reverse Proxy** | Nginx | — | Routes `/api/*` → port 8001, rest → port 3000 |
| **PDF Generation** | ReportLab | 4.5.0 | Installed; endpoint not yet wired (see §9) |
| **File/Object Store** | Local disk (`/app/backend/uploads`) | — | boto3 installed but not wired (see §9) |

---

## 3. Backend Architecture

### 3.1 Directory Layout

```
/app/backend/
├── server.py            # App factory: CORS, static mount, router injection (slim)
├── database.py          # Motor client, 14 collection references, serialize_doc()
├── models.py            # Pydantic v2 models, Enums (UserRole, OrangeListStatus, etc.)
├── helpers.py           # Shared business logic (health classification, notifications, metrics)
├── routers/             # 18 modular router files — one domain per file
│   ├── auth.py          # Login, /me
│   ├── departments.py   # CRUD + uniqueness guard
│   ├── stations.py      # CRUD, ASUP assignment per station
│   ├── locations.py     # CRUD, station-scoped
│   ├── asset_types.py   # CRUD, dept-scoped, checklist templates
│   ├── assets.py        # CRUD, paginated list, per-asset inspection history
│   ├── users.py         # CRUD, role promotion, supervisor linking
│   ├── inspections.py   # Create inspection, OL entry auto-creation for not_ok
│   ├── orange_list.py   # Defect lifecycle: mark-working, approve, reject, scoped list
│   ├── remarks.py       # Threaded remarks, tags, archival
│   ├── dashboards.py    # 5 role-specific dashboards + stats + station-health
│   ├── analytics.py     # Rollup matrix, FY benchmarks, coverage gaps, SUP performance
│   ├── admin.py         # Admin-only operations
│   ├── notifications.py # In-app notification CRUD
│   ├── schedules.py     # Inspection schedule definitions
│   ├── profiles.py      # User profile views
│   ├── uploads.py       # File upload to local disk
│   └── meta.py          # /api/health ping
├── scripts/             # One-off data migrations and backfill scripts
├── tests/
│   └── audit_data_consistency.py  # 68-check cross-system data audit
└── uploads/             # Uploaded photo files (local; not versioned)
```

### 3.2 Request Lifecycle

```
Client Request
    │
    ▼
Nginx (port 443/80)
    │  /api/* → :8001
    ▼
FastAPI ASGI (uvicorn)
    │
    ├── CORSMiddleware
    │
    ├── Router Dispatch (path + method match)
    │     │
    │     ├── Pydantic v2 request body validation
    │     ├── Query param extraction
    │     │
    │     ├── Business Logic (helpers.py / inline)
    │     │     ├── Motor async MongoDB queries
    │     │     └── serialize_doc() → removes BSON ObjectId / datetime types
    │     │
    │     └── JSON Response
    │
    └── Exception → HTTPException → JSON error body
```

### 3.3 Key Business Logic Files

#### `helpers.py` — Shared Domain Logic

| Function | Purpose |
|----------|---------|
| `_classify_health(asset, now, open_ol_entry)` | Returns `"working"`, `"orange"`, `"red"`, or `"yellow"` for a single asset. Uses the **open orange_list entry** as the authoritative `defective_since` source (not `asset.defective_since`). |
| `_compute_asset_metrics(asset, orange_records, now)` | Calculates mean time to repair, total downtime, defect count, and last repair date for a single asset's history. |
| `_dept_fy_avg_repair_seconds(dept_id, now)` | Returns the FY average repair time for a department (used in benchmark comparisons). **Currently implemented as Python loop over all OL records** — see §10 for the aggregation pipeline tradeoff. |
| `broadcast_asset_defect_notifications(asset, ...)` | Fan-out notification to the full chain: SUP → ASUP → RO → Umbrella RO (Commercial) → All Admins → All Superadmins. Deduplicates recipients. |

#### `_classify_health` Health Logic

```
If asset.status == "pending_approval"  →  "yellow"
Else if open OL entry exists:
    hours = (now - ol_entry.defective_since).total_seconds() / 3600
    if hours >= 24  →  "red"
    else            →  "orange"
Else (no open OL entry):
    if asset.status == "defective":
        use asset.defective_since as fallback (same threshold)
    else:
        → "working"
```

> **Single Source of Truth Rule**: The `orange_list` collection's open entry is always preferred over `asset.defective_since` to prevent clock-drift bugs (fixed in data consistency audit, May 2026).

### 3.4 Inspection → Defect Creation Flow

```
POST /api/inspections
    │
    ├── For each item with status == "not_ok":
    │     ├── Create orange_list entry (status=defective, defective_since=item.defective_since or now)
    │     ├── Update asset.status = "defective"
    │     ├── Create auto-remark ("Defect reported by <name>")
    │     └── broadcast_asset_defect_notifications(...)
    │
    └── For each item with status == "ok" where asset was previously defective:
          ├── Check if open OL entry exists
          └── If yes: asset.status back to "working", close OL entry (set resolved if no ASUP pending)
```

### 3.5 Defect Approval Workflow

```
Status:  defective  ──── SUP marks working ───►  pending_approval  ──── ASUP approves ───►  resolved
                                                         │
                                                         └── ASUP rejects ──► back to defective
```

---

## 4. Frontend Architecture

### 4.1 Directory Layout

```
/app/frontend/src/
├── App.js               # Route declarations, ProtectedRoute HOC
├── index.js             # React root mount, AuthProvider wrap
├── lib/
│   ├── api.js           # Axios instance + all API call functions (346 lines)
│   ├── auth-context.js  # React Context: user state, login/logout, role helpers
│   ├── err.js           # Centralised API error message extractor
│   ├── inspection-report.js  # Client-side inspection report generation
│   └── utils.js         # cn() Tailwind merge utility
├── components/
│   ├── AppLayout.js          # Sidebar nav (role-aware), header, main content shell
│   ├── OrangeListPanel.js    # Defect list with filters, status actions, remarks integration
│   ├── RemarksThread.js      # Full threaded remarks UI (post, display, tag pills)
│   ├── RemarkTagsManager.js  # Admin tag CRUD (slug, label, requires_ref toggle)
│   ├── AdminPerformanceMatrix.js  # Phase 4: Superadmin/Admin rollup matrix table
│   ├── SupervisorAnalyticsView.js # Per-SUP performance charts (MTTR, defect count)
│   ├── AssetHistoryDrawer.js      # Slide-out drawer: asset defect/repair timeline
│   ├── SupervisorHistoryDrawer.js # Slide-out drawer: SUP inspection history
│   ├── Pagination.js              # Reusable paginator
│   ├── dialogs/MarkDefectiveDialog.js  # Modal for quick defect mark from assets page
│   └── dashboards/
│       ├── SuperadminDashboard.js  # System-wide health, dept breakdown, matrix
│       ├── AdminDashboard.js       # Admin view: station health, coverage gaps
│       └── OversightDashboard.js   # ASUP/RO view: scoped health + categories
├── pages/
│   ├── LoginPage.js
│   ├── DashboardPage.js          # Role dispatcher → renders correct dashboard
│   ├── AssetsPage.js             # Asset CRUD + filter + mark-defective
│   ├── InspectionPage.js         # Inspection form builder
│   ├── InspectionHistoryPage.js  # Search/filter past inspections
│   ├── OrangeListPage.js         # Tabbed: Orange / Red / Yellow + remarks
│   ├── SchedulesPage.js          # Schedule management
│   ├── NotificationsPage.js      # Notification inbox
│   ├── AdminPage.js              # Dept/Station/Location/AssetType/User CRUD
│   └── ProfilePage.js            # User profile + password change
└── components/ui/                # Shadcn/UI primitives (50+ components)
```

### 4.2 Routing & Access Control

```jsx
// Route protection — two tiers
<ProtectedRoute>              // requires any authenticated user
<ProtectedRoute adminOnly>    // requires role in ['superadmin', 'admin']
```

| Route | Access | Page |
|-------|--------|------|
| `/login` | Public | LoginPage |
| `/` | All roles | DashboardPage (role-dispatched) |
| `/assets` | All roles | AssetsPage |
| `/inspection` | All roles | InspectionPage |
| `/inspection-history` | All roles | InspectionHistoryPage |
| `/orange-list` | All roles | OrangeListPage |
| `/schedules` | All roles | SchedulesPage |
| `/notifications` | All roles | NotificationsPage |
| `/admin` | superadmin / admin only | AdminPage |
| `/profile` | All roles | ProfilePage |

### 4.3 Auth Flow

```
1. User submits employee_id + password → POST /api/auth/login
2. Backend returns { token, user }
3. localStorage.setItem('token', ...) + localStorage.setItem('user', ...)
4. Axios interceptor injects Authorization: Bearer <token> on every request
5. On 401 response → localStorage cleared → redirect to /login
6. AuthContext exposes: user, login(), logout(), isAdmin(), isSuperadmin(), canApprove(), canInspect()
```

### 4.4 Dashboard Role Dispatch

`DashboardPage.js` reads `user.role` and renders:

| Role | Component Rendered |
|------|--------------------|
| `superadmin` | `SuperadminDashboard` |
| `admin` | `AdminDashboard` |
| `reporting_officer` | `OversightDashboard` (RO mode) |
| `approving_supervisor` | `OversightDashboard` (ASUP mode) |
| `supervisor` | Supervisor-specific view with `OrangeListPanel` + `SupervisorAnalyticsView` |

### 4.5 State Management

No Redux or Zustand. State is managed as:
- **Auth state**: `AuthContext` (React Context + localStorage persistence)
- **Server state**: Local `useState` + `useEffect` per component (fetch on mount)
- **Toast notifications**: `sonner` library via `Toaster` in `App.js`

---

## 5. Database Design

### 5.1 Collections & Schemas

#### `departments`
```json
{ "_id": ObjectId, "name": "Electrical", "code": "EL", "description": "...",
  "created_at": ISODate }
```
**Indexes**: `code` (unique, partial — non-null strings only)

#### `stations`
```json
{ "_id": ObjectId, "name": "DHANBAD", "code": "DHN", "zone": "ECR",
  "division": "DHN", "approving_supervisor_id": "ObjectId|null", "created_at": ISODate }
```

#### `locations`
```json
{ "_id": ObjectId, "name": "Platform 1", "station_id": "ObjectId",
  "description": "...", "created_at": ISODate }
```

#### `asset_types`
```json
{ "_id": ObjectId, "name": "Ceiling Fan", "department_id": "ObjectId",
  "checklist": [{ "name": "Blade check", "expected_value": "pass" }],
  "description": "...", "created_at": ISODate }
```

#### `assets`
```json
{ "_id": ObjectId, "asset_type_id": "ObjectId", "station_id": "ObjectId",
  "location_id": "ObjectId", "asset_number": "FAN-1",
  "status": "working|defective|pending_approval",
  "defective_since": ISODate|null, "description": "...",
  "schedule_frequency": 30, "last_inspected": ISODate|null,
  "next_due": ISODate|null, "created_at": ISODate }
```

#### `users`
```json
{ "_id": ObjectId, "employee_id": "SSE001", "name": "Rajesh Kumar",
  "role": "supervisor|reporting_officer|approving_supervisor|admin|superadmin",
  "department_id": "ObjectId|null", "assigned_stations": ["ObjectId"],
  "password": "<bcrypt>", "email": "...", "phone": "...",
  "is_active": true, "reports_to_id": "ObjectId|null", "created_at": ISODate }
```

#### `inspections`
```json
{ "_id": ObjectId, "inspection_type": "individual|sig",
  "station_id": "ObjectId", "inspector_id": "ObjectId",
  "items": [{ "asset_id": "ObjectId", "status": "ok|not_ok|needs_repair",
              "checklist_responses": [...], "remarks": "...",
              "photo_urls": ["..."], "defective_since": ISODate|null,
              "rectified_on": ISODate|null }],
  "participants": ["ObjectId"], "overall_remarks": "...",
  "inspection_at": ISODate, "created_at": ISODate }
```

#### `orange_list` — Canonical Defect Ledger
```json
{ "_id": ObjectId, "asset_id": "ObjectId", "inspection_id": "ObjectId",
  "reported_by": "ObjectId",
  "status": "defective|pending_approval|resolved",
  "defective_since": ISODate,
  "marked_working_at": ISODate|null, "marked_working_by": "ObjectId|null",
  "approved_at": ISODate|null, "approved_by": "ObjectId|null",
  "rejected_at": ISODate|null, "rejected_by": "ObjectId|null",
  "created_at": ISODate }
```
> This collection is the **single source of truth** for defect duration and classification.

#### `remarks`
```json
{ "_id": ObjectId, "orange_list_id": "ObjectId",
  "author_id": "ObjectId", "author_name": "...", "role": "supervisor",
  "type": "note|escalation|update|resolution|auto",
  "text": "...", "tag": "slug|null", "tag_ref": "...|null",
  "is_auto": false, "created_at": ISODate,
  "archived_after": ISODate|null }
```
**Constraint**: `text` max 300 chars; remarks are immutable (no PUT endpoint).

#### `remark_tags`
```json
{ "_id": ObjectId, "slug": "urgent", "label": "Urgent",
  "requires_ref": false, "archived": false,
  "is_default": true, "created_by": "ObjectId|null", "created_at": ISODate }
```

#### `notifications`
```json
{ "_id": ObjectId, "user_id": "ObjectId", "title": "...", "message": "...",
  "notification_type": "alert|info|warning",
  "related_entity_type": "orange_list|asset|inspection",
  "related_entity_id": "ObjectId|null",
  "is_read": false, "created_at": ISODate }
```

#### `schedules`
```json
{ "_id": ObjectId, "asset_id": "ObjectId",
  "frequency": "daily|weekly|monthly|quarterly",
  "set_by": "ObjectId", "created_at": ISODate }
```

#### `audit_log` *(schema defined, not actively written)*
```json
{ "_id": ObjectId, "action": "...", "user_id": "ObjectId",
  "entity_type": "...", "entity_id": "ObjectId",
  "before": {...}, "after": {...}, "created_at": ISODate }
```

### 5.2 Hierarchy Diagram

```
Department
    └── Asset Type (checklist template)
            └── Asset (instance)
                    └── located at Location
                    └── in Station
                    └── inspected by User (SUP)
                    └── OL Entry (defect lifecycle)
                              └── Remarks Thread
```

### 5.3 Implicit Scoping Model

There are **no explicit `assigned_assets` or `assigned_to` fields** on assets. Scope is inferred at query time:

```
Supervisor scope  =  assets WHERE station_id IN user.assigned_stations
                              AND asset_type.department_id == user.department_id

ASUP scope        =  assets WHERE station_id IN user.assigned_stations

RO scope          =  assets WHERE station_id IN user.assigned_stations
                              AND asset_type.department_id == user.department_id
                     (+ Commercial/umbrella dept if applicable)
```

---

## 6. API Reference

### Authentication
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/login` | None | Returns JWT token + user object |
| GET | `/api/auth/me` | `?token=` | Returns current user from token |

### Master Data (Admin only in practice)
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/departments` | List / Create |
| PUT/DELETE | `/api/departments/{id}` | Update / Delete |
| GET/POST | `/api/stations` | List / Create |
| GET/POST | `/api/locations` | List / Create (station_id param) |
| GET/POST | `/api/asset-types` | List / Create |
| GET/POST | `/api/assets` | Paginated list / Create |
| GET/PUT/DELETE | `/api/assets/{id}` | Get / Update / Delete |

### Users
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/users` | List / Create |
| GET/PUT/DELETE | `/api/users/{id}` | Get / Update / Delete |
| POST | `/api/users/{id}/grant-admin` | Promote to admin |
| POST | `/api/users/{id}/revoke-admin` | Demote from admin |
| POST | `/api/users/link-supervisors` | Assign SUPs to an RO |

### Inspections
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/inspections` | Create inspection (triggers OL + notifications) |
| GET | `/api/inspections` | List with filters (station, date, inspector, type) |
| GET | `/api/assets/{id}/inspections` | Asset-specific history |

### Orange List (Defect Lifecycle)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/orange-list` | Scoped list with enriched fields (hours_defective, list_type, asset_info). Filters: `list_type`, `status`, `for_user_id` |
| GET | `/api/orange-list/{id}` | Single OL entry |
| POST | `/api/orange-list/{id}/mark-working` | SUP signals defect is fixed (→ pending_approval) |
| POST | `/api/orange-list/{id}/approve` | ASUP approves (→ resolved) |
| POST | `/api/orange-list/{id}/reject` | ASUP rejects (→ back to defective) |

### Remarks
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/orange-list/{id}/remarks` | Full thread (items + read_only flag + archived flag) |
| POST | `/api/orange-list/{id}/remarks?current_user_id=` | Add remark (max 300 chars, immutable) |
| GET/POST/DELETE | `/api/remark-tags` | Manage tag vocabulary |

### Dashboards
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard/superadmin` | System-wide health + dept breakdown + totals |
| GET | `/api/dashboard/admin` | Admin-scoped health |
| GET | `/api/dashboard/supervisor/{user_id}` | SUP-scoped health + categories |
| GET | `/api/dashboard/approving-supervisor/{user_id}` | ASUP-scoped health |
| GET | `/api/dashboard/reporting-officer/{user_id}` | RO-scoped health |
| GET | `/api/dashboard/stats` | Legacy scalar stats (orange_count, red_count, pending, defective) |
| GET | `/api/dashboard/station-health` | Per-station breakdown |
| GET | `/api/dashboard/oversight/{user_id}/category-assets` | Drill-down by asset type |

### Analytics (Admin+)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/analytics/admin/rollup` | Department × Station matrix (asset count, MTTR, defect rate) |
| GET | `/api/analytics/admin/coverage-gaps` | Stations/depts with no inspections or supervisors |
| GET | `/api/analytics/admin/fy-benchmarks` | FY average repair time per department |
| GET | `/api/analytics/supervisor/{id}/performance` | Per-SUP inspection KPIs |

### Notifications / Schedules / Uploads
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notifications` | User's notification inbox (paginated) |
| PUT | `/api/notifications/{id}/read` | Mark read |
| GET/POST | `/api/schedules` | Schedule CRUD |
| POST | `/api/upload` | Single file upload → returns URL |
| POST | `/api/upload/multiple` | Batch file upload |
| GET | `/api/health` | Service health ping |

---

## 7. Security Controls

### 7.1 Authentication
| Control | Implementation | Strength |
|---------|---------------|----------|
| Password hashing | `bcrypt` (cost factor default ~12) | Strong — no plaintext passwords in DB |
| Token format | JWT (HS256), 24h expiry, `exp` claim validated | Adequate |
| Token storage | `localStorage` (client) | ⚠️ Vulnerable to XSS. HttpOnly cookie is preferred |
| Token refresh | Not implemented — expired tokens require re-login | Limitation |
| Account deactivation | `is_active` flag; login rejected if `false` | Present |
| Brute force protection | **Not implemented** | Gap — no rate limiting on login endpoint |

### 7.2 Authorization
| Control | Implementation | Status |
|---------|---------------|--------|
| Route protection (frontend) | `ProtectedRoute` HOC + `adminOnly` flag | Present |
| Role checks (backend) | Inline `if user.role not in [...]` guards in router handlers | Present but inconsistent |
| JWT-based identity on writes | ⚠️ Most write endpoints accept `current_user_id` as a **query parameter** — trusted without verifying against the JWT payload | **P0 Known Vulnerability** |
| Data scoping | Implicit station+dept scope enforced server-side on all dashboard and OL queries | Present |
| Cross-role containment | SUP ⊆ ASUP ⊆ SA verified by 68-check audit | Verified |

> **P0 Security Issue**: The `current_user_id` query parameter pattern means a logged-in user can supply any user's ID and act as them on write operations (create remark as another user, mark-working on behalf of another SUP, etc.). Fix: extract `user_id` from the JWT payload via a FastAPI `Depends()` dependency and reject mismatches.

### 7.3 CORS
```python
allow_origins=["*"]  # Currently open — should be restricted to production domain
```

### 7.4 Input Validation
| Control | Implementation |
|---------|---------------|
| Request body | Pydantic v2 field validators (min_length, max_length, regex, enum coercion) |
| Department code | Alphanumeric only, 1-8 chars, auto-uppercased |
| Remark text | 422 returned on > 300 chars |
| File uploads | Extension-based filename only; no MIME type verification |
| ObjectId validation | `bson.ObjectId()` construction catches malformed IDs (raises 500; should be 422) |

### 7.5 Data Integrity
| Control | Implementation |
|---------|---------------|
| OL single source of truth | `_classify_health` uses open OL entry, not `asset.defective_since` |
| Remark immutability | No PUT/DELETE endpoint for remarks |
| Department code uniqueness | MongoDB unique partial index on `code` field |
| Cascade delete | ⚠️ **P1 Gap**: Department deletion does not check child AssetTypes, Users, or Assets — orphans possible |

---

## 8. User Roles & Authorization Matrix

### 8.1 Role Hierarchy

```
Superadmin (SA)
    └── Admin
          ├── Approving Supervisor (ASUP) — per station
          │     └── Reporting Officer (RO) — per dept+station  
          │           └── Supervisor (SUP) — per dept+station
```

### 8.2 Role Definitions

| Role | Scope | Primary Responsibility |
|------|-------|----------------------|
| **Superadmin** | Global (all stations, all depts) | System configuration, user management, global analytics |
| **Admin** | Global (all stations, all depts) | Operational oversight, escalations, performance matrix |
| **Reporting Officer (RO)** | Department × Station | Track departmental defect trends, receive all alerts for their scope |
| **Approving Supervisor (ASUP)** | Station (all depts at that station) | Approve/reject "mark-working" requests from SUPs |
| **Supervisor (SUP)** | Department × Station | Conduct inspections, mark defects, mark working, post remarks |

### 8.3 Authorization Matrix

| Permission | Superadmin | Admin | ASUP | RO | SUP |
|-----------|:---:|:---:|:---:|:---:|:---:|
| **Master Data** | | | | | |
| Create/Edit Department | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create/Edit Station | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create/Edit Location | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create/Edit Asset Type | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create/Edit Asset | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Users** | | | | | |
| Create User | ✅ | ✅ | ❌ | ❌ | ❌ |
| Promote to Admin | ✅ | ❌ | ❌ | ❌ | ❌ |
| View All Users | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Inspections** | | | | | |
| Create Inspection | ✅ | ✅ | ✅ | ✅ | ✅ |
| View Inspection History | ✅ | ✅ | Scoped | Scoped | Scoped |
| **Orange / Red / Yellow List** | | | | | |
| View Orange List | ✅ | ✅ | Scoped | Scoped | Scoped |
| Mark Working (→ Yellow) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Approve Working (→ Resolved) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Reject Working (→ Defective) | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Remarks** | | | | | |
| Post Remark | ✅ | ✅ | ✅ | ✅ | ✅ |
| View Remarks Thread | ✅ | ✅ | ✅ | ✅ | ✅ |
| Manage Remark Tags | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Analytics** | | | | | |
| View Rollup Matrix | ✅ | ✅ | ❌ | ❌ | ❌ |
| View FY Benchmarks | ✅ | ✅ | ❌ | ❌ | ❌ |
| View Coverage Gaps | ✅ | ✅ | ❌ | ❌ | ❌ |
| View SUP Performance | ✅ | ✅ | Scoped | Scoped | Self only |
| **Dashboards** | | | | | |
| Superadmin Dashboard | ✅ | ❌ | ❌ | ❌ | ❌ |
| Admin Dashboard | ✅ | ✅ | ❌ | ❌ | ❌ |
| ASUP Dashboard | ✅ | ✅ | ✅ | ❌ | ❌ |
| RO Dashboard | ✅ | ✅ | ❌ | ✅ | ❌ |
| Supervisor Dashboard | ✅ | ✅ | ❌ | ❌ | ✅ |
| **Notifications** | | | | | |
| Receive Defect Alerts | ✅ | ✅ | ✅ | ✅ | ✅ |

### 8.4 Data Visibility Scoping

```
Superadmin / Admin   → All stations, all departments, all assets (no filter applied)
Approving Supervisor → All assets at their assigned_stations (any department)
Reporting Officer    → Assets at their assigned_stations WHERE asset_type.dept == their dept
Supervisor           → Assets at their assigned_stations WHERE asset_type.dept == their dept
```

---

## 9. What Is Mocked / Not Fully Implemented

| Feature | Status | Detail |
|---------|--------|--------|
| **External Notifications (SMS/WhatsApp/Email)** | ⚠️ MOCKED | Notification records are written to MongoDB and shown in the in-app inbox. No actual SMS, WhatsApp, or email is dispatched. `boto3`, `Twilio`, `SendGrid` are NOT wired. The `broadcast_asset_defect_notifications()` function only writes to the `notifications` collection. **The adapter infrastructure is ready** — a provider can be plugged in alongside the DB write. |
| **File Storage (S3 / Azure Blob)** | ⚠️ LOCAL ONLY | `POST /api/upload` writes to `/app/backend/uploads/` on local disk. `boto3` is installed but no S3 calls are made. Files are served via FastAPI `StaticFiles` mount. **Files will be lost on container restart** unless a persistent volume is mounted. |
| **PDF Export** | ⚠️ NOT WIRED | `reportlab==4.5.0` is installed. No `/api/export/pdf` endpoint exists. The `inspection-report.js` on the frontend generates a basic client-side text report only. A full PDF generation endpoint is in the backlog. |
| **Audit Log** | ⚠️ DEFINED, NOT WRITTEN | The `audit_log` collection is defined in `database.py`. No router currently writes change events to it. The intent was to record every create/update/delete with before/after state. |
| **Schedule Execution** | ⚠️ DEFINITIONS ONLY | `schedules` collection stores frequency definitions (daily/weekly/monthly/quarterly). No cron job or task queue executes them or sends reminders when inspections are overdue. `next_due` on assets is computed but not auto-enforced. |
| **Rate Limiting / Brute Force Protection** | ❌ NOT IMPLEMENTED | No `slowapi` or middleware rate-limiting on auth endpoints. |
| **Refresh Tokens** | ❌ NOT IMPLEMENTED | 24h JWT only. No sliding sessions or refresh endpoint. |
| **Cascade Delete** | ⚠️ P1 GAP | Department DELETE does not guard against child AssetTypes, Users, or Assets. Will create orphaned records. |
| **Server-side RBAC on writes** | ⚠️ P0 GAP | `current_user_id` query parameter is trusted without JWT verification. See §7.2. |

---

## 10. Design Tradeoffs

### 10.1 Python-Loop Analytics vs MongoDB Aggregation Pipelines

**Decision made**: Dashboard health counts and `_dept_fy_avg_repair_seconds` fetch all relevant documents into Python then compute metrics in loops.

**Why**: Faster to implement and easier to debug. Correctness is clearer in Python than nested `$group`/`$reduce` aggregation stages.

**Cost**: Linear O(N) Python time as asset/OL records grow. At ~1,000 assets and ~10,000 OL records (typical for a single railway division), latency is acceptable (< 200ms). At 50,000+ assets, dashboards would lag.

**Migration path**: Replace `_dept_fy_avg_repair_seconds` and dashboard rollup loops with:
```json
{ "$group": { "_id": "$department_id", "avgRepairSeconds": { "$avg": "$repair_duration_seconds" } } }
```

---

### 10.2 `current_user_id` Query Param vs JWT Dependency

**Decision made**: Write endpoints accept `?current_user_id=` as a query parameter and trust it.

**Why**: Enabled rapid development without writing a FastAPI `Depends()` chain upfront.

**Cost**: Security vulnerability — any authenticated user can impersonate any other.

**Migration path**:
```python
from fastapi import Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=["HS256"])
    return payload["user_id"]  # extracted from verified token — cannot be spoofed

@router.post("/api/orange-list/{id}/mark-working")
async def mark_working(id: str, req: MarkWorkingRequest, user_id: str = Depends(get_current_user)):
    # user_id is now guaranteed from JWT, not from request body/query
```

---

### 10.3 Implicit Scoping vs Explicit Assignment

**Decision made**: No `assigned_assets` list. Scope derived dynamically from `station_id` intersection and `asset_type.department_id`.

**Why**: Eliminates O(N) maintenance overhead of keeping assignment lists in sync as assets are added/moved. A SUP simply "owns" all assets in their station+dept.

**Cost**: Every scoped query must do a two-step join (user → type IDs → assets). A SUP reassignment has no explicit effect until the next query.

**Tradeoff**: Correct for the hierarchical railway org model. Would not fit a model where individual assets are dynamically assigned to individuals.

---

### 10.4 localStorage vs HttpOnly Cookie for JWT

**Decision made**: JWT stored in `localStorage`.

**Why**: Simpler to implement; works transparently with Axios interceptors without CORS credential complexity.

**Cost**: XSS attacks can steal the token. If any third-party script (analytics, CDN) is compromised, tokens are exposed.

**Migration path**: Move token to `HttpOnly; Secure; SameSite=Strict` cookie. Update Axios config to `withCredentials: true`. Update backend CORS to `allow_credentials=True` with explicit origins (not `*`).

---

### 10.5 `serialize_doc()` vs Pydantic Response Models

**Decision made**: MongoDB documents are converted to JSON via a custom `serialize_doc()` function, not via Pydantic `response_model=` FastAPI parameters.

**Why**: Pydantic `response_model` strips fields not declared in the model. Rapid iteration was easier with permissive document passthrough and computed fields added dynamically.

**Cost**: API responses include MongoDB internal fields unless manually excluded. No compile-time contract between DB shape and API response shape. Harder to auto-generate client SDK types.

---

### 10.6 Single-Region, Single-Instance Deployment

**Decision made**: Single uvicorn worker, single MongoDB instance, local file storage.

**Why**: Appropriate for a single railway division with < 50 concurrent users.

**Cost**: No horizontal scaling; file uploads lost on redeploy without persistent volumes.

**Migration path**: See §11 (Cloud Migration Guide).

---

### 10.7 Open CORS (`allow_origins=["*"]`)

**Decision made**: CORS unrestricted during development.

**Why**: Simplifies local and preview environment testing.

**Cost**: Any origin can call the API from a browser.

**Fix for production**: Set `CORS_ORIGINS=https://railway-asset-mgmt-1.emergent.host` in `.env` and parse it:
```python
allow_origins=os.environ.get("CORS_ORIGINS", "").split(",")
```

---

## 11. Cloud Migration Guide (Azure / AWS)

This section provides a concrete, step-by-step porting guide for both Azure and AWS. The app is a standard ASGI Python backend + React SPA + MongoDB — all three hyperscalers support this natively.

---

### 11.1 Architecture Target Diagram

```
                        ┌─────────────────────────────────────────┐
                        │          DNS (Route53 / Azure DNS)       │
                        └──────────────────┬──────────────────────┘
                                           │
                        ┌──────────────────▼──────────────────────┐
                        │       CDN / WAF                          │
                        │  (CloudFront / Azure Front Door)         │
                        │  - Serves React static build (S3/Blob)  │
                        │  - Proxies /api/* to backend             │
                        └──────┬─────────────────┬────────────────┘
                               │ /api/*           │ /* static
                ┌──────────────▼──────┐   ┌──────▼──────────────────┐
                │   Backend Service   │   │   Static Hosting        │
                │ (ECS Fargate /      │   │ (S3+CloudFront /        │
                │  Azure Container    │   │  Azure Static Web Apps) │
                │  Apps / App Service)│   └─────────────────────────┘
                │  FastAPI uvicorn    │
                └──────────┬──────────┘
                           │
               ┌───────────▼─────────────┐
               │  MongoDB Atlas (managed) │  ← or DocumentDB (AWS) / CosmosDB (Azure)
               └─────────────────────────┘
                           │
               ┌───────────▼─────────────┐
               │  Object Storage         │
               │  (S3 / Azure Blob)      │  ← file uploads
               └─────────────────────────┘
```

---

### 11.2 Migration Steps — AWS

#### Step 1: Database → MongoDB Atlas or Amazon DocumentDB

**Option A (Recommended): MongoDB Atlas on AWS**
- Create an Atlas cluster (M10+) in the same AWS region
- Enable VPC peering or Private Link between Atlas and your ECS VPC
- Update `MONGO_URL` in your secrets manager:
  ```
  mongodb+srv://<user>:<pass>@cluster.mongodb.net/railway_asset_inspection?retryWrites=true
  ```
- Run `mongodump` from your current instance and `mongorestore` to Atlas

**Option B: Amazon DocumentDB**
- DocumentDB is MongoDB 4.0-compatible; Motor 3.x works with it
- Caveat: Not all MongoDB operators are supported ($lookup with pipeline, some aggregation stages). Test your aggregation queries.
- Connection string format: `mongodb://<user>:<pass>@<cluster>.docdb.amazonaws.com:27017/?tls=true`

#### Step 2: File Storage → Amazon S3

Replace local disk writes in `routers/uploads.py`:

```python
# Install: pip install boto3
import boto3, uuid, os

s3 = boto3.client("s3",
    aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
    region_name=os.environ["AWS_REGION"],
)
BUCKET = os.environ["S3_BUCKET"]

@router.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1] or ".jpg"
    key = f"uploads/{uuid.uuid4()}{ext}"
    content = await file.read()
    s3.put_object(Bucket=BUCKET, Key=key, Body=content, ContentType=file.content_type)
    url = f"https://{BUCKET}.s3.amazonaws.com/{key}"
    return {"url": url, "filename": key}
```

Remove the `StaticFiles` mount from `server.py` — S3 serves files directly via CloudFront.

#### Step 3: Backend → AWS ECS Fargate

**Dockerfile** (place in `/app/backend/`):
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8001
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "2"]
```

**Deploy steps**:
1. Push image to Amazon ECR: `aws ecr get-login-password | docker login ... && docker push`
2. Create ECS Task Definition (Fargate, 0.5 vCPU / 1GB RAM minimum; scale up for analytics)
3. Create ECS Service with Application Load Balancer (ALB) on port 8001
4. Store all secrets in AWS Secrets Manager; inject as environment variables into the Task Definition:
   - `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `CORS_ORIGINS`, `S3_BUCKET`, `AWS_REGION`

#### Step 4: Frontend → S3 + CloudFront

```bash
# Build
cd /app/frontend
REACT_APP_BACKEND_URL=https://api.yourdomain.com yarn build

# Upload to S3
aws s3 sync build/ s3://your-frontend-bucket/ --delete

# Invalidate CloudFront
aws cloudfront create-invalidation --distribution-id XXXXX --paths "/*"
```

CloudFront behaviour rules:
- `/api/*` → Forward to ALB (backend)
- `/*` → Serve from S3 (SPA fallback: return `index.html` for all 404s)

#### Step 5: Environment Variables & Secrets

| Variable | Source | Where Used |
|----------|--------|-----------|
| `MONGO_URL` | AWS Secrets Manager | Backend container |
| `DB_NAME` | ECS Task env | Backend container |
| `JWT_SECRET` | AWS Secrets Manager | Backend container |
| `CORS_ORIGINS` | ECS Task env | Backend container |
| `S3_BUCKET` | ECS Task env | Backend container |
| `REACT_APP_BACKEND_URL` | Build-time env var | React build |

#### Step 6: Estimated AWS Cost (Production)

| Service | Spec | Estimated Cost/Month |
|---------|------|---------------------|
| ECS Fargate (backend) | 0.5 vCPU, 1GB, 2 tasks | ~$30 |
| MongoDB Atlas M10 | 2 vCPU, 2GB RAM, 10GB storage | ~$60 |
| S3 (files + frontend) | 10GB storage, 1M requests | ~$5 |
| CloudFront | 10GB transfer | ~$5 |
| ALB | 1 LCU | ~$20 |
| **Total** | | **~$120/month** |

---

### 11.3 Migration Steps — Azure

#### Step 1: Database → Azure Cosmos DB for MongoDB (vCore) or MongoDB Atlas on Azure

**Option A: Azure Cosmos DB for MongoDB vCore (Recommended)**
- Create a vCore cluster (2 vCores, 8GB RAM)
- Connection string: `mongodb+srv://<user>:<pass>@<cluster>.mongocluster.cosmos.azure.com/?tls=true`
- Motor 3.x is fully compatible
- Run `mongodump` / `mongorestore` for data migration

**Option B: MongoDB Atlas on Azure**
- Same as AWS Atlas steps above — Atlas is multi-cloud

#### Step 2: File Storage → Azure Blob Storage

```python
# Install: pip install azure-storage-blob
from azure.storage.blob import BlobServiceClient
import uuid, os

blob_service = BlobServiceClient.from_connection_string(os.environ["AZURE_STORAGE_CONNECTION_STRING"])
container_name = os.environ["AZURE_STORAGE_CONTAINER"]

@router.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    ext = os.path.splitext(file.filename or "")[1] or ".jpg"
    blob_name = f"uploads/{uuid.uuid4()}{ext}"
    content = await file.read()
    blob_client = blob_service.get_blob_client(container=container_name, blob=blob_name)
    blob_client.upload_blob(content, overwrite=True, content_settings=ContentSettings(content_type=file.content_type))
    url = f"https://{blob_service.account_name}.blob.core.windows.net/{container_name}/{blob_name}"
    return {"url": url, "filename": blob_name}
```

#### Step 3: Backend → Azure Container Apps (Recommended) or Azure App Service

**Azure Container Apps** (serverless, auto-scaling):
```bash
# Build and push to Azure Container Registry
az acr build --registry myregistry --image railway-backend:latest ./backend

# Deploy as Container App
az containerapp create \
  --name railway-backend \
  --resource-group railway-rg \
  --environment myenv \
  --image myregistry.azurecr.io/railway-backend:latest \
  --target-port 8001 \
  --ingress external \
  --env-vars MONGO_URL=secretref:mongo-url DB_NAME=railway_asset_inspection \
             JWT_SECRET=secretref:jwt-secret CORS_ORIGINS=https://railway.yourdomain.com
```

Store secrets in Azure Key Vault; reference via Container Apps managed identity.

#### Step 4: Frontend → Azure Static Web Apps

```bash
# In GitHub Actions (or manual):
cd /app/frontend
REACT_APP_BACKEND_URL=https://railway-backend.yourdomain.azurecontainerapps.io yarn build

# Deploy via Azure CLI
az staticwebapp deploy \
  --name railway-frontend \
  --resource-group railway-rg \
  --app-location "frontend" \
  --output-location "frontend/build"
```

Azure Static Web Apps supports:
- SPA routing (returns `index.html` for all deep links) via `staticwebapp.config.json`
- API proxy rules (route `/api/*` to Container Apps backend)

```json
// staticwebapp.config.json
{
  "navigationFallback": { "rewrite": "/index.html" },
  "routes": [
    { "route": "/api/*", "serve": "https://railway-backend.azurecontainerapps.io/api/*" }
  ]
}
```

#### Step 5: CI/CD Pipeline (GitHub Actions → Azure)

```yaml
name: Deploy to Azure
on:
  push:
    branches: [main]
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build backend image
        run: az acr build --registry ${{ secrets.ACR_NAME }} --image railway-backend:${{ github.sha }} ./backend
      - name: Update Container App
        run: az containerapp update --name railway-backend --image ${{ secrets.ACR_NAME }}.azurecr.io/railway-backend:${{ github.sha }}
      - name: Build frontend
        run: cd frontend && REACT_APP_BACKEND_URL=${{ secrets.API_URL }} yarn build
      - name: Deploy frontend
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          app_location: "frontend"
          output_location: "frontend/build"
```

#### Step 6: Estimated Azure Cost (Production)

| Service | Spec | Estimated Cost/Month |
|---------|------|---------------------|
| Container Apps (backend) | 0.5 vCPU, 1GB, 2 replicas | ~$25 |
| Cosmos DB vCore | 2 vCPU, 8GB | ~$65 |
| Azure Blob Storage | 10GB, 1M operations | ~$3 |
| Azure Static Web Apps | Standard plan | ~$9 |
| Azure Front Door | Standard tier | ~$35 |
| **Total** | | **~$137/month** |

---

### 11.4 Pre-Migration Checklist

Before deploying to either cloud:

- [ ] Fix `CORS_ORIGINS` — change from `"*"` to the production domain
- [ ] Fix `JWT_SECRET` — rotate to a strong random value (≥ 32 bytes), stored in Secrets Manager / Key Vault
- [ ] Fix **P0 auth vulnerability** — implement `get_current_user` Depends() before going to production
- [ ] Implement **cascade-delete guard** on departments (P1)
- [ ] Wire file uploads to S3 / Blob (local disk will not survive container restarts)
- [ ] Add health check endpoint response on `GET /api/health` (already exists as `/api/health` via `meta.py`)
- [ ] Set `uvicorn --workers N` based on vCPU count (N = 2 × vCPU + 1)
- [ ] Enable MongoDB connection pool settings for production concurrency
- [ ] Add `slowapi` or AWS WAF rate limiting on `/api/auth/login`
- [ ] Verify `mongodump` backup schedule is configured

---

### 11.5 MongoDB Index Recommendations for Production

Add these indexes before going live to support the most common query patterns:

```javascript
// Orange list — most queried collection
db.orange_list.createIndex({ "status": 1, "asset_id": 1 })
db.orange_list.createIndex({ "defective_since": 1 })
db.orange_list.createIndex({ "status": 1, "defective_since": -1 })

// Assets — scoping queries
db.assets.createIndex({ "station_id": 1, "asset_type_id": 1 })
db.assets.createIndex({ "status": 1 })

// Inspections — history lookups
db.inspections.createIndex({ "inspector_id": 1, "created_at": -1 })
db.inspections.createIndex({ "station_id": 1, "created_at": -1 })
db.inspections.createIndex({ "items.asset_id": 1 })

// Remarks — thread fetches
db.remarks.createIndex({ "orange_list_id": 1, "created_at": 1 })

// Notifications — inbox queries
db.notifications.createIndex({ "user_id": 1, "is_read": 1, "created_at": -1 })

// Users — role-based fan-out notifications
db.users.createIndex({ "role": 1, "department_id": 1, "is_active": 1 })
db.users.createIndex({ "role": 1, "assigned_stations": 1, "is_active": 1 })
```

---

*Document generated from the live codebase at `/app/`. For questions or amendments, refer to `/app/memory/PRD.md` and `/app/memory/CHANGELOG.md`.*
