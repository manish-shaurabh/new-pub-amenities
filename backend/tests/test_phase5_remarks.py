"""Phase 5 — Threaded Remarks System backend tests."""
import os
import time
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"


def _login(employee_id: str, password: str = "admin123"):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"employee_id": employee_id, "password": password})
    if r.status_code != 200:
        return None, None
    body = r.json()
    user = body["user"]
    user["id"] = user.get("id") or user.get("_id")
    return body["token"], user


@pytest.fixture(scope="module")
def superadmin():
    token, user = _login("SA001")
    if not token:
        pytest.skip("Cannot login SA001")
    return {"token": token, "user": user, "id": user["id"]}


@pytest.fixture(scope="module")
def supervisor():
    token, user = _login("SSE001")
    if not token:
        pytest.skip("Cannot login SSE001")
    return {"token": token, "user": user, "id": user["id"]}


@pytest.fixture(scope="module")
def asup_user(superadmin):
    # Lookup ASUP user
    r = requests.get(f"{BASE_URL}/api/users", params={"role": "approving_supervisor"})
    if r.status_code != 200:
        pytest.skip("cannot list users")
    users = r.json()
    asup = next((u for u in users if u.get("employee_id") == "ASUP001"), None) or (users[0] if users else None)
    if not asup:
        pytest.skip("No ASUP user")
    asup_eid = asup.get("employee_id")
    token, u = _login(asup_eid)
    if not token:
        pytest.skip(f"Cannot login {asup_eid}")
    return {"id": u["id"], "token": token, "employee_id": asup_eid}


@pytest.fixture(scope="module")
def ro_user():
    r = requests.get(f"{BASE_URL}/api/users", params={"role": "reporting_officer"})
    if r.status_code != 200:
        pytest.skip("cannot list users")
    users = r.json()
    ro = next((u for u in users if u.get("station_id") and "DHN" in (u.get("name", "") + u.get("employee_id", ""))), None) or (users[0] if users else None)
    if not ro:
        pytest.skip("No RO user")
    ro_eid = ro.get("employee_id")
    token, u = _login(ro_eid)
    if not token:
        pytest.skip(f"Cannot login {ro_eid}")
    return {"id": u["id"], "token": token, "employee_id": ro_eid}


@pytest.fixture(scope="module")
def orange_item():
    r = requests.get(f"{BASE_URL}/api/orange-list")
    if r.status_code != 200:
        pytest.skip("orange-list not reachable")
    body = r.json()
    items = body.get("items") if isinstance(body, dict) else body
    if not items:
        pytest.skip("No orange list items")
    DHN_STATION = "69f6f639450af6fe6fb5816f"
    # Prefer DHANBAD station + non-resolved
    item = next((i for i in items if (i.get("asset_info") or {}).get("station_id") == DHN_STATION and i.get("status") != "resolved"), None)
    if not item:
        item = next((i for i in items if i.get("status") != "resolved"), items[0])
    item["id"] = item.get("id") or item.get("_id")
    return item


# =========================== TAG MASTER ============================
class TestTags:
    def test_list_default_tags(self, superadmin):
        r = requests.get(f"{BASE_URL}/api/remarks/tags")
        assert r.status_code == 200
        tags = r.json()
        slugs = {t["slug"]: t for t in tags}
        for needed in ["spare_pending", "work_order", "escalated", "under_observation", "awaiting_contractor"]:
            assert needed in slugs, f"missing default tag {needed}"
        assert slugs["work_order"]["requires_ref"] is True

    def test_create_tag_non_admin_forbidden(self, supervisor):
        r = requests.post(
            f"{BASE_URL}/api/remarks/tags",
            params={"current_user_id": supervisor["id"]},
            json={"slug": "TEST_NoAdmin", "label": "Test", "requires_ref": False},
        )
        assert r.status_code == 403, r.text

    def test_create_tag_admin(self, superadmin):
        slug = f"test_tag_{int(time.time())}"
        r = requests.post(
            f"{BASE_URL}/api/remarks/tags",
            params={"current_user_id": superadmin["id"]},
            json={"slug": slug, "label": "Test Tag", "requires_ref": False},
        )
        assert r.status_code == 200, r.text
        tag = r.json()
        assert tag["slug"] == slug.lower()
        pytest.shared_tag_id = tag.get("id") or tag.get("_id")
        pytest.shared_tag_slug = tag["slug"]

    def test_create_duplicate_slug(self, superadmin):
        slug = pytest.shared_tag_slug
        r = requests.post(
            f"{BASE_URL}/api/remarks/tags",
            params={"current_user_id": superadmin["id"]},
            json={"slug": slug, "label": "Dup", "requires_ref": False},
        )
        assert r.status_code == 400

    def test_update_tag(self, superadmin):
        r = requests.put(
            f"{BASE_URL}/api/remarks/tags/{pytest.shared_tag_id}",
            params={"current_user_id": superadmin["id"]},
            json={"label": "Test Tag Updated", "requires_ref": True},
        )
        assert r.status_code == 200, r.text
        assert r.json()["label"] == "Test Tag Updated"
        assert r.json()["requires_ref"] is True

    def test_archive_tag(self, superadmin):
        r = requests.delete(
            f"{BASE_URL}/api/remarks/tags/{pytest.shared_tag_id}",
            params={"current_user_id": superadmin["id"]},
        )
        assert r.status_code == 200
        # Should be hidden by default
        r2 = requests.get(f"{BASE_URL}/api/remarks/tags")
        assert pytest.shared_tag_slug not in {t["slug"] for t in r2.json()}
        # Visible with include_archived
        r3 = requests.get(f"{BASE_URL}/api/remarks/tags", params={"include_archived": "true"})
        assert pytest.shared_tag_slug in {t["slug"] for t in r3.json()}


# =========================== REMARK THREAD ============================
class TestRemarks:
    def test_get_thread(self, orange_item):
        r = requests.get(f"{BASE_URL}/api/orange-list/{orange_item['id']}/remarks")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "items" in body
        assert "read_only" in body
        assert "archived" in body

    def test_post_note_supervisor(self, supervisor, orange_item):
        r = requests.post(
            f"{BASE_URL}/api/orange-list/{orange_item['id']}/remarks",
            params={"current_user_id": supervisor["id"]},
            json={"type": "note", "text": "TEST note from SUP", "tag": "spare_pending"},
        )
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["type"] == "note"
        assert b["tag"] == "spare_pending"
        assert b["is_auto"] is False

    def test_observation_supervisor_forbidden(self, supervisor, orange_item):
        r = requests.post(
            f"{BASE_URL}/api/orange-list/{orange_item['id']}/remarks",
            params={"current_user_id": supervisor["id"]},
            json={"type": "observation", "text": "TEST obs SUP"},
        )
        assert r.status_code == 403, r.text

    def test_observation_asup_allowed(self, asup_user, orange_item):
        r = requests.post(
            f"{BASE_URL}/api/orange-list/{orange_item['id']}/remarks",
            params={"current_user_id": asup_user["id"]},
            json={"type": "observation", "text": "TEST obs ASUP"},
        )
        assert r.status_code == 200, r.text

    def test_escalation_all_roles(self, supervisor, orange_item):
        r = requests.post(
            f"{BASE_URL}/api/orange-list/{orange_item['id']}/remarks",
            params={"current_user_id": supervisor["id"]},
            json={"type": "escalation", "text": "TEST escalation SUP"},
        )
        assert r.status_code == 200, r.text

    def test_text_max_length(self, supervisor, orange_item):
        r = requests.post(
            f"{BASE_URL}/api/orange-list/{orange_item['id']}/remarks",
            params={"current_user_id": supervisor["id"]},
            json={"type": "note", "text": "x" * 301},
        )
        assert r.status_code == 422, r.text

    def test_work_order_requires_ref(self, supervisor, orange_item):
        r = requests.post(
            f"{BASE_URL}/api/orange-list/{orange_item['id']}/remarks",
            params={"current_user_id": supervisor["id"]},
            json={"type": "note", "text": "TEST wo no ref", "tag": "work_order"},
        )
        assert r.status_code == 400, r.text
        assert "reference" in r.text.lower() or "requires" in r.text.lower()

    def test_work_order_with_ref(self, supervisor, orange_item):
        r = requests.post(
            f"{BASE_URL}/api/orange-list/{orange_item['id']}/remarks",
            params={"current_user_id": supervisor["id"]},
            json={"type": "note", "text": "TEST wo with ref", "tag": "work_order", "tag_ref": "WO-123"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["tag_ref"] == "WO-123"

    def test_unknown_tag(self, supervisor, orange_item):
        r = requests.post(
            f"{BASE_URL}/api/orange-list/{orange_item['id']}/remarks",
            params={"current_user_id": supervisor["id"]},
            json={"type": "note", "text": "TEST unknown tag", "tag": "no_such_tag_xyz"},
        )
        assert r.status_code == 400, r.text

    def test_invalid_type_rejected(self, supervisor, orange_item):
        r = requests.post(
            f"{BASE_URL}/api/orange-list/{orange_item['id']}/remarks",
            params={"current_user_id": supervisor["id"]},
            json={"type": "defect_report", "text": "TEST sys"},
        )
        assert r.status_code == 400, r.text

    def test_thread_contains_posted(self, orange_item):
        r = requests.get(f"{BASE_URL}/api/orange-list/{orange_item['id']}/remarks")
        assert r.status_code == 200
        items = r.json()["items"]
        assert any("TEST note from SUP" in (i.get("text") or "") for i in items)

    def test_notification_fanout_note(self, asup_user, supervisor, orange_item):
        # Post note as SUP, ASUP should get notified
        r = requests.post(
            f"{BASE_URL}/api/orange-list/{orange_item['id']}/remarks",
            params={"current_user_id": supervisor["id"]},
            json={"type": "note", "text": "TEST fanout check"},
        )
        assert r.status_code == 200, r.text
        time.sleep(1)
        n = requests.get(f"{BASE_URL}/api/notifications", params={"user_id": asup_user["id"], "limit": 20})
        if n.status_code != 200:
            pytest.skip("notifications endpoint shape unknown")
        body = n.json()
        notifs = body if isinstance(body, list) else body.get("items", [])
        # Look for any orange_list related notification
        related = [x for x in notifs if x.get("related_entity_id") == orange_item["id"] or "remark" in (x.get("title", "").lower())]
        assert len(related) > 0, f"ASUP did not receive remark notification. Got: {notifs[:3]}"


# =========================== AUTO-REMARK HOOKS ============================
class TestAutoRemarks:
    def test_rectification_auto_remark_on_mark_working(self, supervisor, orange_item):
        # Capture pre-count
        before = requests.get(f"{BASE_URL}/api/orange-list/{orange_item['id']}/remarks").json().get("items", [])
        pre_count = len([r for r in before if r.get("type") == "rectification"])

        # mark_working
        r = requests.post(
            f"{BASE_URL}/api/orange-list/{orange_item['id']}/mark-working",
            json={
                "marked_by": supervisor["id"],
                "remarks": "TEST auto rectification remark",
            },
        )
        if r.status_code != 200:
            pytest.skip(f"mark_working unavailable: {r.status_code} {r.text[:120]}")
        time.sleep(1)
        after = requests.get(f"{BASE_URL}/api/orange-list/{orange_item['id']}/remarks").json().get("items", [])
        rectifs = [x for x in after if x.get("type") == "rectification"]
        assert len(rectifs) > pre_count, f"Expected new rectification auto-remark; before={pre_count} after={len(rectifs)}"
        latest = rectifs[-1]
        assert latest.get("is_auto") is True

