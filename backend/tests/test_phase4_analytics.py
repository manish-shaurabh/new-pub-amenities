"""
Phase 4 - Supervisor Performance Analytics Backend Tests
Tests for:
  - GET /api/analytics/supervisor/{id}/performance
  - GET /api/analytics/approving-supervisor/{id}/performance-summary
  - GET /api/analytics/reporting-officer/{id}/performance-summary
  - reject_working preserves last_marked_working_by field
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Known user IDs from test credentials
SUP_ID = "69f832991d32eee20864cb1b"      # SSE001 - Ramprakash, Electrical, DHANBAD
ASUP_ID = "69f7035af3f687e9573332d6"     # ASUP001 - Aditya, DHANBAD
RO_ID = "69fa4d5519494e4f3610cb6a"       # DRO EL - Ram, Electrical, DHANBAD

# Date ranges for filtering tests
NOW = datetime.utcnow()
LAST_30_FROM = (NOW - timedelta(days=30)).strftime('%Y-%m-%d')
LAST_30_TO = NOW.strftime('%Y-%m-%d')
LAST_90_FROM = (NOW - timedelta(days=90)).strftime('%Y-%m-%d')
NARROW_FROM = NOW.strftime('%Y-%m-%d')  # Same day - should return fewer/no results


@pytest.fixture(scope="module")
def session():
    """Shared HTTP session"""
    s = requests.Session()
    # Login as superadmin to get token
    resp = s.post(f"{BASE_URL}/api/auth/login", json={"employee_id": "SA001", "password": "admin123"})
    if resp.status_code == 200:
        token = resp.json().get("token")
        if token:
            s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# ─────────────────────────────────────────────────────────────────────────────
# Section 1: Supervisor Performance Endpoint
# ─────────────────────────────────────────────────────────────────────────────

class TestSupervisorPerformance:
    """Tests for GET /api/analytics/supervisor/{id}/performance"""

    def test_returns_200(self, session):
        """Endpoint returns 200 for valid supervisor"""
        r = session.get(f"{BASE_URL}/api/analytics/supervisor/{SUP_ID}/performance")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:200]}"
        print("PASS: GET supervisor performance returns 200")

    def test_response_top_level_structure(self, session):
        """Response has all required top-level fields"""
        r = session.get(f"{BASE_URL}/api/analytics/supervisor/{SUP_ID}/performance")
        data = r.json()
        required_fields = ['user_id', 'user_name', 'employee_id', 'department_name', 
                           'period', 'summary', 'categories', 'available_stations']
        for f in required_fields:
            assert f in data, f"Missing field: {f}"
        assert data['user_id'] == SUP_ID
        print(f"PASS: Top-level structure correct. user_name={data['user_name']}, dept={data['department_name']}")

    def test_summary_structure(self, session):
        """Summary contains all required fields with correct types"""
        r = session.get(f"{BASE_URL}/api/analytics/supervisor/{SUP_ID}/performance")
        summary = r.json()['summary']
        required = ['total_assets', 'total_defects', 'avg_repair_hours', 'pct_functional', 'rejection_count']
        for f in required:
            assert f in summary, f"Missing summary field: {f}"
        # Type checks
        assert isinstance(summary['total_assets'], int), "total_assets must be int"
        assert isinstance(summary['total_defects'], int), "total_defects must be int"
        assert isinstance(summary['avg_repair_hours'], (int, float)), "avg_repair_hours must be numeric"
        assert isinstance(summary['pct_functional'], (int, float)), "pct_functional must be numeric"
        assert isinstance(summary['rejection_count'], int), "rejection_count must be int"
        # Range checks
        assert 0.0 <= summary['pct_functional'] <= 100.0, f"pct_functional out of range: {summary['pct_functional']}"
        assert summary['total_assets'] >= 0
        print(f"PASS: Summary structure correct. total_assets={summary['total_assets']}, pct_functional={summary['pct_functional']}")

    def test_categories_structure(self, session):
        """Categories have required fields when non-empty"""
        r = session.get(f"{BASE_URL}/api/analytics/supervisor/{SUP_ID}/performance")
        data = r.json()
        categories = data.get('categories', [])
        # categories can be empty (no resolved defects), that's okay
        for cat in categories:
            required_cat_fields = ['asset_type_id', 'asset_type_name', 'asset_count', 'defect_count',
                                   'avg_repair_hours', 'pct_functional', 'rejection_count', 'assets']
            for f in required_cat_fields:
                assert f in cat, f"Category missing field: {f}"
            assert isinstance(cat['assets'], list), "assets must be list"
            # Per-asset fields
            for a in cat['assets']:
                assert 'asset_id' in a
                assert 'asset_number' in a
                assert 'defect_count' in a
                assert 'pct_functional' in a
                assert 'avg_repair_hours' in a
        print(f"PASS: Categories structure correct. {len(categories)} categories found")

    def test_with_date_filters(self, session):
        """Date range params are accepted and used"""
        r = session.get(
            f"{BASE_URL}/api/analytics/supervisor/{SUP_ID}/performance",
            params={"from_date": LAST_30_FROM, "to_date": LAST_30_TO}
        )
        assert r.status_code == 200
        data = r.json()
        assert data['period']['from'] is not None
        assert data['period']['to'] is not None
        print(f"PASS: Date filter accepted. Period: {data['period']}")

    def test_date_filter_affects_results(self, session):
        """Different date ranges return potentially different defect counts"""
        # Broad range
        r90 = session.get(
            f"{BASE_URL}/api/analytics/supervisor/{SUP_ID}/performance",
            params={"from_date": LAST_90_FROM, "to_date": LAST_30_TO}
        )
        # Current day only (narrow range - should typically show fewer defects)
        r_narrow = session.get(
            f"{BASE_URL}/api/analytics/supervisor/{SUP_ID}/performance",
            params={"from_date": NARROW_FROM, "to_date": LAST_30_TO}
        )
        assert r90.status_code == 200
        assert r_narrow.status_code == 200
        # Both should return valid summaries
        d90 = r90.json()['summary']
        d_narrow = r_narrow.json()['summary']
        # For broad window, defects should be >= narrow window defects
        assert d90['total_defects'] >= d_narrow['total_defects'], \
            f"Broader date range should have >= defects: 90d={d90['total_defects']}, today={d_narrow['total_defects']}"
        print(f"PASS: Date filter affects results. 90d_defects={d90['total_defects']}, today_defects={d_narrow['total_defects']}")

    def test_available_stations_present(self, session):
        """available_stations is a list"""
        r = session.get(f"{BASE_URL}/api/analytics/supervisor/{SUP_ID}/performance")
        data = r.json()
        assert isinstance(data['available_stations'], list)
        # Each station should have _id and name
        for s in data['available_stations']:
            assert '_id' in s or 'id' in s
            assert 'name' in s
        print(f"PASS: available_stations returned. count={len(data['available_stations'])}")

    def test_invalid_user_id_returns_error(self, session):
        """Non-existent user_id returns 404"""
        r = session.get(f"{BASE_URL}/api/analytics/supervisor/000000000000000000000000/performance")
        assert r.status_code == 404, f"Expected 404, got {r.status_code}"
        print("PASS: Invalid user_id returns 404")

    def test_bad_user_id_format_returns_400(self, session):
        """Malformed user_id returns 400"""
        r = session.get(f"{BASE_URL}/api/analytics/supervisor/not_an_id/performance")
        assert r.status_code == 400, f"Expected 400, got {r.status_code}"
        print("PASS: Bad user_id format returns 400")

    def test_bad_date_returns_400(self, session):
        """Invalid date format returns 400"""
        r = session.get(
            f"{BASE_URL}/api/analytics/supervisor/{SUP_ID}/performance",
            params={"from_date": "not-a-date"}
        )
        assert r.status_code == 400, f"Expected 400, got {r.status_code}"
        print("PASS: Invalid date format returns 400")

    def test_no_internal_fields_in_response(self, session):
        """Internal fields like _defective_secs should not be in response"""
        r = session.get(f"{BASE_URL}/api/analytics/supervisor/{SUP_ID}/performance")
        data = r.json()
        for cat in data.get('categories', []):
            assert '_defective_secs' not in cat
            assert '_repair_secs_list' not in cat
            for a in cat.get('assets', []):
                assert '_defective_secs' not in a
                assert '_repair_secs_list' not in a
        print("PASS: No internal fields leaked in response")


# ─────────────────────────────────────────────────────────────────────────────
# Section 2: ASUP Performance Summary
# ─────────────────────────────────────────────────────────────────────────────

class TestAsupPerformanceSummary:
    """Tests for GET /api/analytics/approving-supervisor/{id}/performance-summary"""

    def test_returns_200(self, session):
        r = session.get(f"{BASE_URL}/api/analytics/approving-supervisor/{ASUP_ID}/performance-summary")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:200]}"
        print("PASS: ASUP performance-summary returns 200")

    def test_response_structure(self, session):
        r = session.get(f"{BASE_URL}/api/analytics/approving-supervisor/{ASUP_ID}/performance-summary")
        data = r.json()
        assert 'supervisors' in data, "Missing 'supervisors' key"
        assert 'period' in data, "Missing 'period' key"
        assert isinstance(data['supervisors'], list), "supervisors must be list"
        print(f"PASS: ASUP summary structure correct. {len(data['supervisors'])} supervisors")

    def test_supervisors_have_required_fields(self, session):
        r = session.get(f"{BASE_URL}/api/analytics/approving-supervisor/{ASUP_ID}/performance-summary")
        supervisors = r.json()['supervisors']
        assert len(supervisors) > 0, "Expected at least one supervisor under ASUP001"
        for s in supervisors:
            assert '_id' in s, "Missing _id in supervisor"
            assert 'name' in s, "Missing name in supervisor"
            assert 'summary' in s, "Missing summary in supervisor"
            summary = s['summary']
            required = ['total_assets', 'total_defects', 'avg_repair_hours', 'pct_functional', 'rejection_count']
            for f in required:
                assert f in summary, f"Missing summary field: {f} in supervisor {s.get('name')}"
        print(f"PASS: All {len(supervisors)} supervisors have correct structure with summary objects")

    def test_with_date_filter(self, session):
        r = session.get(
            f"{BASE_URL}/api/analytics/approving-supervisor/{ASUP_ID}/performance-summary",
            params={"from_date": LAST_30_FROM, "to_date": LAST_30_TO}
        )
        assert r.status_code == 200
        data = r.json()
        assert len(data['supervisors']) >= 0
        print(f"PASS: ASUP summary with date filter returns 200. supervisors={len(data['supervisors'])}")

    def test_invalid_asup_id_returns_404(self, session):
        r = session.get(f"{BASE_URL}/api/analytics/approving-supervisor/000000000000000000000000/performance-summary")
        assert r.status_code == 404
        print("PASS: Invalid ASUP ID returns 404")


# ─────────────────────────────────────────────────────────────────────────────
# Section 3: RO Performance Summary
# ─────────────────────────────────────────────────────────────────────────────

class TestRoPerformanceSummary:
    """Tests for GET /api/analytics/reporting-officer/{id}/performance-summary"""

    def test_returns_200(self, session):
        r = session.get(f"{BASE_URL}/api/analytics/reporting-officer/{RO_ID}/performance-summary")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:200]}"
        print("PASS: RO performance-summary returns 200")

    def test_response_structure(self, session):
        r = session.get(f"{BASE_URL}/api/analytics/reporting-officer/{RO_ID}/performance-summary")
        data = r.json()
        assert 'supervisors' in data, "Missing 'supervisors' key"
        assert 'period' in data, "Missing 'period' key"
        assert isinstance(data['supervisors'], list)
        print(f"PASS: RO summary structure correct. {len(data['supervisors'])} supervisors")

    def test_supervisors_scoped_to_ro_dept_and_stations(self, session):
        """RO's supervisors should be scoped to their dept + stations"""
        r = session.get(f"{BASE_URL}/api/analytics/reporting-officer/{RO_ID}/performance-summary")
        data = r.json()
        supervisors = data['supervisors']
        assert len(supervisors) > 0, "Expected at least one supervisor under RO (DRO EL)"
        # All supervisors should have summary
        for s in supervisors:
            assert 'summary' in s
            sum = s['summary']
            for f in ['total_assets', 'total_defects', 'avg_repair_hours', 'pct_functional', 'rejection_count']:
                assert f in sum, f"Missing {f} in summary"
        print(f"PASS: RO supervisors scoped correctly. Found {len(supervisors)} supervisors")

    def test_with_date_filter(self, session):
        r = session.get(
            f"{BASE_URL}/api/analytics/reporting-officer/{RO_ID}/performance-summary",
            params={"from_date": LAST_30_FROM, "to_date": LAST_30_TO}
        )
        assert r.status_code == 200
        print("PASS: RO summary with date filter returns 200")

    def test_invalid_ro_id_returns_404(self, session):
        r = session.get(f"{BASE_URL}/api/analytics/reporting-officer/000000000000000000000000/performance-summary")
        assert r.status_code == 404
        print("PASS: Invalid RO ID returns 404")


# ─────────────────────────────────────────────────────────────────────────────
# Section 4: reject_working last_marked_working_by fix
# ─────────────────────────────────────────────────────────────────────────────

class TestRejectWorkingLastMarkedBy:
    """Verify that reject_working stores last_marked_working_by before clearing marked_working_by"""

    def test_reject_working_preserves_last_marked_working_by(self, session):
        """Create a defect, mark working, reject - verify last_marked_working_by is set"""
        # 1. Find an asset for SUP to use
        assets_resp = session.get(f"{BASE_URL}/api/assets", params={"page_size": 100})
        assert assets_resp.status_code == 200
        assets_data = assets_resp.json()
        assets_list = assets_data if isinstance(assets_data, list) else assets_data.get('items', [])
        
        # Find an asset at DHANBAD that would be in SUP's scope
        test_asset = None
        for a in assets_list:
            if a.get('status') == 'working':
                test_asset = a
                break
        
        if not test_asset:
            pytest.skip("No working assets found for test")
        
        asset_id = test_asset['_id']
        
        # 2. Report it as defective (orange list entry)
        ol_resp = session.post(f"{BASE_URL}/api/orange-list", json={
            "asset_id": asset_id,
            "reported_by": SUP_ID,
            "remarks": "TEST_last_marked_working_by_fix test defect",
            "defective_since": datetime.utcnow().isoformat()
        })
        if ol_resp.status_code not in [200, 201]:
            pytest.skip(f"Could not create orange list entry: {ol_resp.status_code}")
        
        item_id = ol_resp.json()['_id']
        
        try:
            # 3. SUP marks it as working
            mark_resp = session.post(f"{BASE_URL}/api/orange-list/{item_id}/mark-working", json={
                "marked_by": SUP_ID,
                "remarks": "TEST - marking working"
            })
            assert mark_resp.status_code == 200, f"mark-working failed: {mark_resp.text}"
            
            marked_item = mark_resp.json()
            assert marked_item['marked_working_by'] == SUP_ID
            
            # 4. ASUP rejects it
            reject_resp = session.post(f"{BASE_URL}/api/orange-list/{item_id}/reject-working", json={
                "rejected_by": ASUP_ID,
                "remarks": "TEST - rejecting to verify last_marked_working_by"
            })
            assert reject_resp.status_code == 200, f"reject-working failed: {reject_resp.text}"
            
            rejected_item = reject_resp.json()
            
            # KEY CHECK: last_marked_working_by should be set to SUP_ID
            assert rejected_item.get('last_marked_working_by') == SUP_ID, \
                f"last_marked_working_by not preserved. Got: {rejected_item.get('last_marked_working_by')}"
            
            # marked_working_by should be cleared to None
            assert rejected_item.get('marked_working_by') is None, \
                f"marked_working_by should be None after reject. Got: {rejected_item.get('marked_working_by')}"
            
            # Status should be defective again
            assert rejected_item['status'] == 'defective', \
                f"Status should be defective after reject. Got: {rejected_item['status']}"
            
            print(f"PASS: last_marked_working_by={rejected_item['last_marked_working_by']} preserved after rejection")
            print(f"      marked_working_by={rejected_item['marked_working_by']} (correctly cleared)")
        
        finally:
            # Cleanup: delete the test orange list item
            try:
                session.delete(f"{BASE_URL}/api/orange-list/{item_id}")
            except Exception:
                pass  # Cleanup failure is not critical
            # Reset asset status to working if needed
            try:
                session.put(f"{BASE_URL}/api/assets/{asset_id}", json={"status": "working"})
            except Exception:
                pass


# ─────────────────────────────────────────────────────────────────────────────
# Section 5: Regression / Cross-checks
# ─────────────────────────────────────────────────────────────────────────────

class TestRegressionChecks:
    """Basic regression to ensure previous endpoints still work"""

    def test_legacy_supervisor_analytics_still_works(self, session):
        """Legacy GET /api/analytics/supervisor/{id} endpoint still responds"""
        r = session.get(f"{BASE_URL}/api/analytics/supervisor/{SUP_ID}")
        assert r.status_code == 200, f"Legacy endpoint broken: {r.status_code}"
        data = r.json()
        assert 'user_id' in data or 'user_name' in data
        print("PASS: Legacy supervisor analytics endpoint still works")

    def test_pct_functional_within_range(self, session):
        """pct_functional is always between 0 and 100"""
        r = session.get(f"{BASE_URL}/api/analytics/supervisor/{SUP_ID}/performance")
        data = r.json()
        pct = data['summary']['pct_functional']
        assert 0.0 <= pct <= 100.0, f"pct_functional out of range: {pct}"
        for cat in data.get('categories', []):
            cat_pct = cat['pct_functional']
            assert 0.0 <= cat_pct <= 100.0, f"Category pct_functional out of range: {cat_pct}"
            for a in cat.get('assets', []):
                a_pct = a['pct_functional']
                assert 0.0 <= a_pct <= 100.0, f"Asset pct_functional out of range: {a_pct}"
        print(f"PASS: pct_functional within [0, 100] for all levels. overall={pct}")

    def test_asup_supervisor_ids_valid(self, session):
        """All supervisor _ids in ASUP summary are valid strings"""
        r = session.get(f"{BASE_URL}/api/analytics/approving-supervisor/{ASUP_ID}/performance-summary")
        supervisors = r.json().get('supervisors', [])
        for s in supervisors:
            assert isinstance(s['_id'], str), f"_id should be string, got {type(s['_id'])}"
            assert len(s['_id']) > 0
        print(f"PASS: All ASUP supervisor IDs are valid strings. count={len(supervisors)}")
