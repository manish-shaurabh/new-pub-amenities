"""Iteration 37 tests — Custom icon upload + Department theming canvas surfacing.

Coverage:
- POST /api/asset-types/{id}/upload-icon (SVG accepted, returns custom_icon_url)
- DELETE /api/asset-types/{id}/icon (removes file + nulls field)
- GET /api/asset-types includes `custom_icon_url`
- GET /api/station-canvas includes `custom_icon_url` on asset records
- Validation: rejects non-allowed extensions; rejects >512KB
"""
import io
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def auth_token(session):
    r = session.post(f"{BASE_URL}/api/auth/login", json={"employee_id": "SA001", "password": "admin123"})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture(scope="module")
def department_id(session, auth_headers):
    # Use existing Electrical department or first available
    r = session.get(f"{BASE_URL}/api/departments", headers=auth_headers)
    assert r.status_code == 200
    depts = r.json()
    assert len(depts) > 0
    # prefer Electrical
    for d in depts:
        if "electr" in (d.get("name", "") or "").lower():
            return d.get("id") or d.get("_id")
    return depts[0].get("id") or depts[0].get("_id")


@pytest.fixture(scope="module")
def asset_type_id(session, auth_headers, department_id):
    """Create a transient TEST asset type and clean up at teardown."""
    payload = {
        "name": "TEST_ICON_UPLOAD_iter37",
        "department_id": department_id,
        "checklist": [],
        "description": "iter37 custom icon test",
        "tracking_mode": "individual",
    }
    r = session.post(f"{BASE_URL}/api/asset-types", json=payload, headers=auth_headers)
    assert r.status_code == 200, f"create failed: {r.status_code} {r.text}"
    body = r.json()
    at_id = body.get("id") or body.get("_id")
    assert at_id
    yield at_id
    # teardown
    try:
        session.delete(f"{BASE_URL}/api/asset-types/{at_id}", headers=auth_headers)
    except Exception:
        pass


SAMPLE_SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="orange"/></svg>'


class TestCustomIconCRUD:
    """Custom Icon upload/list/delete lifecycle."""

    def test_initial_create_has_null_custom_icon(self, session, auth_headers, asset_type_id):
        r = session.get(f"{BASE_URL}/api/asset-types", headers=auth_headers)
        assert r.status_code == 200
        types = r.json()
        match = next((t for t in types if (t.get("id") or t.get("_id")) == asset_type_id), None)
        assert match is not None, "Newly-created asset type missing from list"
        assert "custom_icon_url" in match, "List response must expose custom_icon_url field"
        assert match["custom_icon_url"] in (None, ""), "Should be null on fresh asset type"

    def test_upload_svg_icon(self, session, auth_headers, asset_type_id):
        files = {"file": ("test_icon.svg", io.BytesIO(SAMPLE_SVG), "image/svg+xml")}
        # Don't send Content-Type header for multipart
        h = {k: v for k, v in auth_headers.items() if k.lower() != "content-type"}
        r = requests.post(f"{BASE_URL}/api/asset-types/{asset_type_id}/upload-icon", files=files, headers=h)
        assert r.status_code == 200, f"upload failed: {r.status_code} {r.text}"
        data = r.json()
        assert "custom_icon_url" in data
        url = data["custom_icon_url"]
        assert url.startswith("/api/uploads/icons/"), f"unexpected url: {url}"
        # File should be served back via static mount
        fetch = requests.get(f"{BASE_URL}{url}")
        assert fetch.status_code == 200, f"served file failed: {fetch.status_code}"
        assert b"<svg" in fetch.content

    def test_list_includes_custom_icon_url(self, session, auth_headers, asset_type_id):
        r = session.get(f"{BASE_URL}/api/asset-types", headers=auth_headers)
        assert r.status_code == 200
        types = r.json()
        match = next((t for t in types if (t.get("id") or t.get("_id")) == asset_type_id), None)
        assert match is not None
        assert match.get("custom_icon_url"), "Uploaded icon URL must persist in list"
        assert match["custom_icon_url"].startswith("/api/uploads/icons/")

    def test_reject_bad_extension(self, session, auth_headers, asset_type_id):
        files = {"file": ("malicious.exe", io.BytesIO(b"MZ\x90\x00"), "application/octet-stream")}
        h = {k: v for k, v in auth_headers.items() if k.lower() != "content-type"}
        r = requests.post(f"{BASE_URL}/api/asset-types/{asset_type_id}/upload-icon", files=files, headers=h)
        assert r.status_code == 400, f"Expected 400, got {r.status_code} {r.text}"

    def test_reject_oversize(self, session, auth_headers, asset_type_id):
        big = b"A" * (513 * 1024)
        files = {"file": ("big.png", io.BytesIO(big), "image/png")}
        h = {k: v for k, v in auth_headers.items() if k.lower() != "content-type"}
        r = requests.post(f"{BASE_URL}/api/asset-types/{asset_type_id}/upload-icon", files=files, headers=h)
        assert r.status_code == 400, f"Expected 400 for >512KB, got {r.status_code}"

    def test_delete_icon(self, session, auth_headers, asset_type_id):
        r = requests.delete(f"{BASE_URL}/api/asset-types/{asset_type_id}/icon", headers=auth_headers)
        assert r.status_code == 200, f"delete failed: {r.status_code} {r.text}"
        # Verify list now shows null
        r2 = session.get(f"{BASE_URL}/api/asset-types", headers=auth_headers)
        match = next((t for t in r2.json() if (t.get("id") or t.get("_id")) == asset_type_id), None)
        assert match is not None
        assert match.get("custom_icon_url") in (None, ""), "custom_icon_url must be nulled after delete"

    def test_upload_to_unknown_asset_type_404(self, session, auth_headers):
        files = {"file": ("test.svg", io.BytesIO(SAMPLE_SVG), "image/svg+xml")}
        h = {k: v for k, v in auth_headers.items() if k.lower() != "content-type"}
        # Valid ObjectId format that doesn't exist
        r = requests.post(f"{BASE_URL}/api/asset-types/000000000000000000000000/upload-icon", files=files, headers=h)
        assert r.status_code == 404


class TestStationCanvasCustomIcon:
    """Verify station-canvas surfaces custom_icon_url on assets."""

    def test_station_canvas_has_custom_icon_url_key(self, session, auth_headers):
        # Find a station that has locations + assets
        r = session.get(f"{BASE_URL}/api/stations", headers=auth_headers)
        assert r.status_code == 200
        stations = r.json()
        assert len(stations) > 0
        sid = stations[0].get("id") or stations[0].get("_id")
        # Try canvas for that station
        rc = session.get(f"{BASE_URL}/api/station-canvas?station_id={sid}", headers=auth_headers)
        assert rc.status_code == 200, f"canvas failed: {rc.status_code} {rc.text}"
        body = rc.json()
        assert "locations" in body
        # Find at least one asset in any location/sub-zone (or unzoned)
        found_asset = None
        for loc in body["locations"]:
            for sz in loc.get("sub_zones", []):
                for a in sz.get("assets", []):
                    found_asset = a; break
                if found_asset: break
            if not found_asset:
                for a in loc.get("unzoned_assets", []):
                    found_asset = a; break
            if found_asset: break
        if found_asset is None:
            pytest.skip("No assets found in any station canvas to verify custom_icon_url key")
        assert "custom_icon_url" in found_asset, "Asset on canvas must expose custom_icon_url key (even if null)"
        assert "department_id" in found_asset, "Asset must expose department_id for dept theming"
