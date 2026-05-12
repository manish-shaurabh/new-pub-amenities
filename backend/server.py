"""Railway Asset Inspection Management System — FastAPI entry point.

After the Phase 6 refactor, this file is intentionally slim. All endpoints live in
`routers/*.py`. Helpers shared across routers live in `helpers.py`.

Behavior preserved:
  - All `/api/...` paths and HTTP methods unchanged
  - CORS middleware unchanged
  - Static `/api/uploads` mount unchanged
  - Auth, dependency-injection, and `serialize_doc` semantics unchanged
"""
import os
from dotenv import load_dotenv

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

load_dotenv()

# Routers — order does not affect URL resolution; just keeps imports tidy.
from routers import (
    meta,
    departments,
    stations,
    locations,
    asset_types,
    assets,
    users,
    auth,
    uploads,
    inspections,
    orange_list,
    notifications,
    schedules,
    admin,
    dashboards,
    analytics,
    profiles,
    remarks,
    reports,
    reports_builder,
    comparative,
    comparative_export,
    data_health,
)

app = FastAPI(title="Railway Asset Inspection Management System")


# Read-only Viewer enforcement (rejects mutations from `viewer` role).
# Registered BEFORE CORS so 403s still flow through CORS headers.
from viewer_guard import viewer_guard_middleware
app.middleware("http")(viewer_guard_middleware)


@app.on_event("startup")
async def _ensure_indexes():
    """Ensure unique constraints on department code.
    Name uniqueness is enforced at the application layer (case-insensitive) inside
    the create/update handlers because Mongo collation indexes can fail on certain
    legacy data. Non-fatal: logs and continues if an index cannot be created.
    """
    from database import departments_collection
    try:
        await departments_collection.create_index(
            "code", unique=True, name="uniq_dept_code",
            partialFilterExpression={"code": {"$exists": True, "$type": "string"}},
        )
    except Exception as e:
        print(f"[startup] could not create dept code index: {e}")

    # Seed default remark tags (idempotent)
    try:
        from routers.remarks import _seed_default_tags
        await _seed_default_tags()
    except Exception as e:
        print(f"[startup] could not seed remark tags: {e}")


# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static uploads directory (preserves the `/api/uploads/<file>` URL contract)
UPLOAD_DIR = "/app/backend/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Wire every router. Each router declares fully-qualified `/api/...` paths
# internally, so we include them with no prefix.
for r in (
    meta.router,
    departments.router,
    stations.router,
    locations.router,
    asset_types.router,
    assets.router,
    users.router,
    auth.router,
    uploads.router,
    inspections.router,
    orange_list.router,
    notifications.router,
    schedules.router,
    admin.router,
    dashboards.router,
    analytics.router,
    profiles.router,
    remarks.router,
    reports.router,
    reports_builder.router,
    comparative.router,
    comparative_export.router,
    data_health.router,
):
    app.include_router(r)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
