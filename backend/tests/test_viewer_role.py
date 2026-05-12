"""Backend regression tests for the new 'viewer' (read-only) role.

Covers:
  - Login returns role=viewer
  - All READ endpoints return 200 for viewer
  - All mutation endpoints return 403 with the standard guard message
  - Whitelisted POSTs (auth/login, reports run, reports export) are NOT
    blocked by the middleware (status may be 200/422 from validation, but
    never 403 with the guard detail).
"""
import os
import requests
import pytest
from pathlib import Path

def _load_env():
    env_path = Path("/app/frontend/.env")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

_load_env()
BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
VIEWER_GUARD_DETAIL = "Viewer role is read-only. This action is not permitted."


@pytest.fixture(scope="module")
def viewer_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"employee_id": "VIEW001", "password": "viewer123"},
        timeout=15,
    )
    assert r.status_code == 200, f"Viewer login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["user"]["role"] == "viewer", f"Unexpected role: {data['user']['role']}"
    return data["token"], data["user"].get("id") or data["user"].get("_id")


@pytest.fixture(scope="module")
def sa_token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"employee_id": "SA001", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, f"SA login failed: {r.status_code} {r.text}"
    return r.json()["token"], r.json()["user"].get("id") or r.json()["user"].get("_id")


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


# ---------------- READ endpoints ----------------
class TestViewerReadAccess:
    def test_login_returns_viewer_role(self, viewer_token):
        tok, uid = viewer_token
        assert tok and uid

    def test_dashboard_stats(self, viewer_token):
        tok, uid = viewer_token
        r = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=_h(tok), timeout=15)
        assert r.status_code == 200, r.text

    def test_assets_list(self, viewer_token):
        tok, _ = viewer_token
        r = requests.get(f"{BASE_URL}/api/assets", headers=_h(tok), timeout=15)
        assert r.status_code == 200

    def test_orange_list(self, viewer_token):
        tok, _ = viewer_token
        r = requests.get(f"{BASE_URL}/api/orange-list", headers=_h(tok), timeout=15)
        assert r.status_code == 200

    def test_inspections(self, viewer_token):
        tok, _ = viewer_token
        r = requests.get(f"{BASE_URL}/api/inspections", headers=_h(tok), timeout=15)
        assert r.status_code == 200

    def test_schedules(self, viewer_token):
        tok, _ = viewer_token
        r = requests.get(f"{BASE_URL}/api/schedules", headers=_h(tok), timeout=15)
        assert r.status_code == 200

    def test_notifications(self, viewer_token):
        tok, uid = viewer_token
        r = requests.get(f"{BASE_URL}/api/notifications", headers=_h(tok), params={"user_id": uid}, timeout=15)
        assert r.status_code == 200

    def test_reports_builder_featured(self, viewer_token):
        tok, _ = viewer_token
        r = requests.get(f"{BASE_URL}/api/reports/builder/featured", headers=_h(tok), timeout=15)
        assert r.status_code == 200

    def test_comparative_by_asset_type(self, viewer_token):
        tok, uid = viewer_token
        r = requests.get(
            f"{BASE_URL}/api/reports/comparative/by-asset-type/{uid}",
            headers=_h(tok),
            timeout=15,
        )
        assert r.status_code == 200, r.text


# ---------------- BLOCKED mutations ----------------
class TestViewerMutationsBlocked:
    def _assert_blocked(self, response):
        assert response.status_code == 403, (
            f"Expected 403, got {response.status_code} body={response.text[:200]}"
        )
        body = response.json()
        assert body.get("detail") == VIEWER_GUARD_DETAIL, body

    def test_post_inspection_blocked(self, viewer_token):
        tok, _ = viewer_token
        r = requests.post(
            f"{BASE_URL}/api/inspections",
            headers=_h(tok),
            json={"asset_id": "x", "status": "working", "remarks": ""},
            timeout=15,
        )
        self._assert_blocked(r)

    def test_put_user_blocked(self, viewer_token):
        tok, uid = viewer_token
        r = requests.put(
            f"{BASE_URL}/api/users/{uid}",
            headers=_h(tok),
            json={"name": "Hacker"},
            timeout=15,
        )
        self._assert_blocked(r)

    def test_delete_asset_blocked(self, viewer_token):
        tok, _ = viewer_token
        r = requests.delete(f"{BASE_URL}/api/assets/non-existent", headers=_h(tok), timeout=15)
        self._assert_blocked(r)

    def test_data_health_clean_blocked(self, viewer_token):
        tok, uid = viewer_token
        r = requests.post(
            f"{BASE_URL}/api/data-health/clean/{uid}",
            headers=_h(tok),
            json={"category": "orphan_assets", "target_ids": []},
            timeout=15,
        )
        self._assert_blocked(r)

    def test_orange_list_post_blocked(self, viewer_token):
        tok, _ = viewer_token
        r = requests.post(
            f"{BASE_URL}/api/orange-list",
            headers=_h(tok),
            json={},
            timeout=15,
        )
        self._assert_blocked(r)

    def test_remarks_post_blocked(self, viewer_token):
        tok, _ = viewer_token
        r = requests.post(
            f"{BASE_URL}/api/remarks",
            headers=_h(tok),
            json={"asset_id": "x", "remark": "test"},
            timeout=15,
        )
        self._assert_blocked(r)


# ---------------- ALLOWED POSTs ----------------
class TestViewerAllowedPosts:
    """These POSTs must NOT be 403 from middleware. They can be 200/422 etc."""

    def _assert_not_guard_403(self, response):
        if response.status_code == 403:
            body = {}
            try:
                body = response.json()
            except Exception:
                pass
            assert body.get("detail") != VIEWER_GUARD_DETAIL, (
                f"Middleware wrongly blocked this whitelisted path: {response.url}"
            )

    def test_login_allowed(self):
        r = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"employee_id": "VIEW001", "password": "viewer123"},
            timeout=15,
        )
        assert r.status_code == 200

    def test_reports_builder_run_not_guard_blocked(self, viewer_token):
        tok, uid = viewer_token
        r = requests.post(
            f"{BASE_URL}/api/reports/builder/run/{uid}",
            headers=_h(tok),
            json={},
            timeout=15,
        )
        self._assert_not_guard_403(r)

    def test_dossier_run_not_guard_blocked(self, viewer_token):
        tok, uid = viewer_token
        r = requests.post(
            f"{BASE_URL}/api/reports/builder/dossier/run/{uid}",
            headers=_h(tok),
            json={},
            timeout=15,
        )
        self._assert_not_guard_403(r)

    def test_dossier_export_pdf_not_guard_blocked(self, viewer_token):
        tok, uid = viewer_token
        r = requests.post(
            f"{BASE_URL}/api/reports/builder/dossier/export/pdf/{uid}",
            headers=_h(tok),
            json={},
            timeout=15,
        )
        self._assert_not_guard_403(r)

    def test_comparative_export_pdf_not_guard_blocked(self, viewer_token):
        tok, uid = viewer_token
        r = requests.post(
            f"{BASE_URL}/api/reports/comparative/export/pdf/{uid}",
            headers=_h(tok),
            json={},
            timeout=15,
        )
        self._assert_not_guard_403(r)

    def test_comparative_export_excel_not_guard_blocked(self, viewer_token):
        tok, uid = viewer_token
        r = requests.post(
            f"{BASE_URL}/api/reports/comparative/export/excel/{uid}",
            headers=_h(tok),
            json={},
            timeout=15,
        )
        self._assert_not_guard_403(r)
