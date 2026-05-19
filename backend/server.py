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
    data_heal,
    health_explorer,
    zones_divisions,
    inspection_compliance,
    sub_zones,
    canvas_landmarks,
    station_canvas,
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

    # Migrate: ensure ECR zone, Dhanbad Division, and tag all existing stations
    try:
        await _migrate_zones_divisions()
    except Exception as e:
        print(f"[startup] zone/division migration failed: {e}")

    # Migrate: hard-delete asset_types without a department + cascade their assets
    try:
        await _migrate_asset_types_require_dept()
    except Exception as e:
        print(f"[startup] asset_types dept-required migration failed: {e}")

    # Migrate: re-number sub-zone `order` to contiguous 0..N-1 per location
    try:
        await _migrate_sub_zone_orders()
    except Exception as e:
        print(f"[startup] sub_zones order renumber migration failed: {e}")

    # Migrate: fix SVG icons that use 'currentColor' (doesn't work in <img> tags)
    try:
        await _migrate_svg_icons_current_color()
    except Exception as e:
        print(f"[startup] SVG icon currentColor migration failed: {e}")


async def _migrate_svg_icons_current_color():
    """Migrate custom_icon_url from file paths to data URIs.
    File paths (/api/uploads/icons/...) are ephemeral and lost on redeploy.
    Data URIs (data:image/...) are stored in MongoDB and persist forever."""
    from database import asset_types_collection
    import base64 as b64

    # Find asset types with file-path-based icons (need migration)
    cursor = asset_types_collection.find({
        "custom_icon_url": {"$exists": True, "$ne": None, "$not": {"$regex": "^data:"}},
    })
    migrated = 0
    async for doc in cursor:
        old_url = doc.get("custom_icon_url", "")
        if not old_url or old_url.startswith("data:"):
            continue

        # Try to read from local filesystem
        if old_url.startswith("/api/uploads/icons/"):
            fname = old_url.split("/")[-1]
            fpath = f"/app/backend/uploads/icons/{fname}"
            try:
                with open(fpath, "rb") as f:
                    content = f.read()
            except FileNotFoundError:
                # File lost — clear the broken reference
                await asset_types_collection.update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"custom_icon_url": None}},
                )
                migrated += 1
                continue

            ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else "png"
            if ext == "svg":
                try:
                    text = content.decode("utf-8")
                    text = text.replace('stroke="currentColor"', 'stroke="#1e293b"')
                    text = text.replace("stroke='currentColor'", "stroke='#1e293b'")
                    text = text.replace('fill="currentColor"', 'fill="#1e293b"')
                    text = text.replace("fill='currentColor'", "fill='#1e293b'")
                    text = text.replace('stroke-width="1"', 'stroke-width="1.5"')
                    text = text.replace('stroke-width="2"', 'stroke-width="2.5"')
                    data_uri = "data:image/svg+xml;base64," + b64.b64encode(text.encode("utf-8")).decode("ascii")
                except Exception:
                    data_uri = "data:image/svg+xml;base64," + b64.b64encode(content).decode("ascii")
            else:
                mime_map = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}
                mime = mime_map.get(ext, "image/png")
                data_uri = f"data:{mime};base64," + b64.b64encode(content).decode("ascii")

            await asset_types_collection.update_one(
                {"_id": doc["_id"]},
                {"$set": {"custom_icon_url": data_uri}},
            )
            migrated += 1

    if migrated:
        print(f"[migration] Migrated {migrated} custom icon(s) from file paths to data URIs")



async def _migrate_sub_zone_orders():
    """Ensure every (location_id) bucket of sub-zones has unique, contiguous orders.

    Legacy data has many sub-zones with `order = 0` (or 99 from the create form),
    making the swap-based reorder logic a no-op. We normalize per-location to
    `0, 1, 2, ...` based on the current sort key (order asc, name asc) so any
    pre-existing visual order is preserved as a starting point.
    """
    from database import sub_zones_collection
    pipeline = [
        {"$sort": {"location_id": 1, "order": 1, "name": 1}},
        {"$group": {"_id": "$location_id", "ids": {"$push": "$_id"}}},
    ]
    bumped = 0
    async for grp in sub_zones_collection.aggregate(pipeline):
        ids = grp.get("ids") or []
        if len(ids) <= 1:
            continue
        for new_order, sz_id in enumerate(ids):
            res = await sub_zones_collection.update_one(
                {"_id": sz_id, "$or": [{"order": {"$ne": new_order}}, {"order": {"$exists": False}}]},
                {"$set": {"order": new_order}},
            )
            bumped += res.modified_count
    if bumped:
        print(f"[migration] Renumbered {bumped} sub-zone order(s) to contiguous values")


async def _migrate_asset_types_require_dept():
    """One-shot cleanup: asset_types must have a non-empty department_id.

    Per product decision (option A): hard-delete any asset_type that violates this
    rule AND cascade-delete every asset that references it.
    """
    from database import asset_types_collection, assets_collection
    invalid_filter = {
        "$or": [
            {"department_id": {"$exists": False}},
            {"department_id": None},
            {"department_id": ""},
        ]
    }
    bad_types = await asset_types_collection.find(invalid_filter).to_list(10000)
    if not bad_types:
        return
    bad_type_ids = [str(t["_id"]) for t in bad_types]
    assets_deleted = await assets_collection.delete_many({"asset_type_id": {"$in": bad_type_ids}})
    types_deleted = await asset_types_collection.delete_many(invalid_filter)
    print(f"[migration] Cleaned asset_types without dept: removed "
          f"{types_deleted.deleted_count} type(s) and {assets_deleted.deleted_count} asset(s)")


async def _migrate_zones_divisions():
    """Idempotent: create ECR zone + Dhanbad Division and tag all un-tagged stations."""
    from database import zones_collection, divisions_collection, stations_collection, now_ist
    # 1. ECR zone
    ecr = await zones_collection.find_one({"code": "ECR"})
    if not ecr:
        res = await zones_collection.insert_one({
            "name": "East Central Railway", "code": "ECR", "created_at": now_ist()
        })
        ecr_id = str(res.inserted_id)
        print("[migration] Created ECR zone")
    else:
        ecr_id = str(ecr["_id"])

    # 2. Dhanbad Division
    dhn = await divisions_collection.find_one({"code": "DHN"})
    if not dhn:
        res = await divisions_collection.insert_one({
            "name": "Dhanbad Division", "code": "DHN", "zone_id": ecr_id, "created_at": now_ist()
        })
        dhn_id = str(res.inserted_id)
        print("[migration] Created Dhanbad Division")
    else:
        dhn_id = str(dhn["_id"])

    # 3. Tag all stations that don't have division_id yet
    result = await stations_collection.update_many(
        {"$or": [{"division_id": {"$exists": False}}, {"division_id": None}]},
        {"$set": {"division_id": dhn_id}},
    )
    if result.modified_count:
        print(f"[migration] Tagged {result.modified_count} station(s) → Dhanbad Division")


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
    data_heal.router,
    health_explorer.router,
    zones_divisions.router,
    inspection_compliance.router,
    sub_zones.router,
    canvas_landmarks.router,
    station_canvas.router,
):
    app.include_router(r)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
