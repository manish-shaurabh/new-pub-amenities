"""Read-only Viewer enforcement middleware.

The `viewer` role is granted full read access (dashboards, reports, OL list,
asset registry, exports) but must NOT mutate any data. This middleware decodes
the JWT from the `Authorization: Bearer` header and rejects every mutation
HTTP method (POST/PUT/PATCH/DELETE) from viewers, except for a small allowlist
of POSTs that are server-side queries with NO write side-effects:

  * `/api/auth/login` and `/api/auth/refresh` (auth lifecycle)
  * Any path containing `/export/` (PDF/Excel report generators — read-only)
  * `/api/reports/builder/run`, `/api/reports/builder/dossier/run`,
    `/api/reports/builder/dossier/export/*` (analytics queries with no
    persisted state for viewer)
  * `/api/data-health/activity-wipe/preview/*` and any `*/preview/*`
    (DRY-RUN preview endpoints — they do not delete)

Rejected with a 403 + clear human-readable detail. Frontend should additionally
hide mutation controls, but server-side enforcement is the source of truth.
"""
from __future__ import annotations

import os
from typing import Callable

import jwt
from fastapi import Request
from fastapi.responses import JSONResponse

_MUTATING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def _is_viewer_safe_post(path: str) -> bool:
    """Whitelist of POST paths that are safe for viewers (no DB mutations)."""
    # Auth lifecycle
    if path in ("/api/auth/login", "/api/auth/refresh"):
        return True
    # Any export endpoint (PDF/Excel generators) — pure read
    if "/export/" in path:
        return True
    # Report builder runs are server-side queries, not stored mutations.
    # They DO write to `report_runs` (analytics audit), but that is silent log,
    # not user content. Allow for viewers so they can use the analytics UI.
    if path.startswith("/api/reports/builder/run"):
        return True
    # Dossier RUN and EXPORT are read-only queries.
    # `dossier/save` is a real mutation (persists user-curated dossier) — block.
    if path.startswith("/api/reports/builder/dossier/run"):
        return True
    if path.startswith("/api/reports/builder/dossier/export/"):
        return True
    # Comparative export bodies (POST with filter body, returns PDF/Excel)
    if path.startswith("/api/reports/comparative/export/"):
        return True
    # Data-health PREVIEW (dry-run) is OK — but the actor still must be admin/
    # superadmin to hit it server-side, so viewers will be 403'd there anyway.
    if "/activity-wipe/preview" in path:
        return True
    return False


async def viewer_guard_middleware(request: Request, call_next: Callable):
    """Block mutating requests from `viewer` role users."""
    if request.method not in _MUTATING_METHODS:
        return await call_next(request)

    auth_header = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    if not auth_header.lower().startswith("bearer "):
        return await call_next(request)

    token = auth_header.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(
            token,
            os.environ.get("JWT_SECRET", "railway-secret-key"),
            algorithms=["HS256"],
        )
    except Exception:
        return await call_next(request)  # let downstream handle bad tokens

    if payload.get("role") != "viewer":
        return await call_next(request)

    path = request.url.path
    if _is_viewer_safe_post(path):
        return await call_next(request)

    return JSONResponse(
        status_code=403,
        content={
            "detail": "Viewer role is read-only. This action is not permitted.",
        },
    )
