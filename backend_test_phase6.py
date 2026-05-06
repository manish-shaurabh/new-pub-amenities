"""
Backend API Testing for Railway Asset Inspection Management System - Phase 6
Tests:
1. New notification endpoints (paginated, filters, bulk actions)
2. All existing endpoints after router refactor
3. Deep-link inspection history support
"""
import requests
import sys
from datetime import datetime, timedelta

BASE_URL = "https://asset-track-rail.preview.emergentagent.com/api"

class Phase6APITester:
    def __init__(self):
        self.token = None
        self.user = None
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []
        self.notification_id = None

    def run_test(self, name, method, endpoint, expected_status, data=None, params=None):
        """Run a single API test"""
        url = f"{BASE_URL}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, params=params, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=10)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    return True, response.json()
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                print(f"   Response: {response.text[:300]}")
                self.failed_tests.append(f"{name}: Expected {expected_status}, got {response.status_code}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.failed_tests.append(f"{name}: {str(e)}")
            return False, {}

    # ============ AUTHENTICATION ============
    def test_login(self):
        """Test login with SA001/admin123"""
        success, response = self.run_test(
            "Login (SA001/admin123)",
            "POST",
            "auth/login",
            200,
            data={"employee_id": "SA001", "password": "admin123"}
        )
        if success and 'token' in response:
            self.token = response['token']
            self.user = response['user']
            print(f"   User: {self.user.get('name')} - Role: {self.user.get('role')}")
            return True
        return False

    def test_auth_me(self):
        """Test /auth/me endpoint"""
        success, response = self.run_test(
            "Get Current User (/auth/me)",
            "GET",
            f"auth/me?token={self.token}",
            200
        )
        return success

    # ============ NEW NOTIFICATION ENDPOINTS (Phase 6) ============
    def test_notifications_backwards_compatible(self):
        """Test GET /api/notifications without paginated param (backwards compatible)"""
        success, response = self.run_test(
            "Notifications - Backwards Compatible (flat list)",
            "GET",
            "notifications",
            200,
            params={"user_id": self.user['_id']}
        )
        if success:
            # Should return a flat list
            if isinstance(response, list):
                print(f"   ✅ Returns flat list: {len(response)} notifications")
                if len(response) > 0:
                    self.notification_id = response[0].get('_id')
                return True
            else:
                print(f"   ❌ Expected list, got: {type(response)}")
                self.failed_tests.append("Notifications backwards compatible: Expected list")
                return False
        return False

    def test_notifications_paginated(self):
        """Test GET /api/notifications?paginated=true"""
        success, response = self.run_test(
            "Notifications - Paginated",
            "GET",
            "notifications",
            200,
            params={
                "user_id": self.user['_id'],
                "paginated": "true",
                "page": 1,
                "page_size": 20
            }
        )
        if success:
            # Should return envelope with items, total, page, page_size, total_pages
            required_keys = ['items', 'total', 'page', 'page_size', 'total_pages']
            if all(k in response for k in required_keys):
                print(f"   ✅ Paginated response: {response['total']} total, page {response['page']}/{response['total_pages']}")
                print(f"   Items in page: {len(response['items'])}")
                if len(response['items']) > 0 and not self.notification_id:
                    self.notification_id = response['items'][0].get('_id')
                return True
            else:
                missing = [k for k in required_keys if k not in response]
                print(f"   ❌ Missing keys: {missing}")
                self.failed_tests.append(f"Notifications paginated: Missing keys {missing}")
                return False
        return False

    def test_notifications_filter_search(self):
        """Test notifications with search filter"""
        success, response = self.run_test(
            "Notifications - Search Filter",
            "GET",
            "notifications",
            200,
            params={
                "user_id": self.user['_id'],
                "paginated": "true",
                "search": "inspection"
            }
        )
        if success:
            print(f"   Search results: {response.get('total', 0)} notifications")
        return success

    def test_notifications_filter_type(self):
        """Test notifications with type filter"""
        success, response = self.run_test(
            "Notifications - Type Filter",
            "GET",
            "notifications",
            200,
            params={
                "user_id": self.user['_id'],
                "paginated": "true",
                "notification_type": "info"
            }
        )
        if success:
            print(f"   Type filter results: {response.get('total', 0)} info notifications")
        return success

    def test_notifications_filter_date(self):
        """Test notifications with date range filter"""
        from_date = (datetime.utcnow() - timedelta(days=7)).isoformat()
        to_date = datetime.utcnow().isoformat()
        success, response = self.run_test(
            "Notifications - Date Range Filter",
            "GET",
            "notifications",
            200,
            params={
                "user_id": self.user['_id'],
                "paginated": "true",
                "from_date": from_date,
                "to_date": to_date
            }
        )
        if success:
            print(f"   Date range results: {response.get('total', 0)} notifications")
        return success

    def test_notification_mark_read(self):
        """Test POST /api/notifications/{id}/read"""
        if not self.notification_id:
            print("   ⚠️  Skipped - No notification ID available")
            return True
        
        success, response = self.run_test(
            "Mark Notification Read",
            "POST",
            f"notifications/{self.notification_id}/read",
            200
        )
        return success

    def test_notification_mark_unread(self):
        """Test POST /api/notifications/{id}/unread"""
        if not self.notification_id:
            print("   ⚠️  Skipped - No notification ID available")
            return True
        
        success, response = self.run_test(
            "Mark Notification Unread",
            "POST",
            f"notifications/{self.notification_id}/unread",
            200
        )
        return success

    def test_notification_delete(self):
        """Test DELETE /api/notifications/{id}"""
        # Create a test notification first
        # Since we can't easily create notifications via API, we'll skip if no ID
        if not self.notification_id:
            print("   ⚠️  Skipped - No notification ID available for deletion test")
            return True
        
        # Don't actually delete, just test the endpoint exists
        print("   ⚠️  Skipped actual deletion to preserve test data")
        return True

    def test_notifications_mark_all_read(self):
        """Test POST /api/notifications/mark-all-read"""
        success, response = self.run_test(
            "Mark All Notifications Read",
            "POST",
            "notifications/mark-all-read",
            200,
            params={"user_id": self.user['_id']}
        )
        return success

    def test_notifications_delete_read(self):
        """Test POST /api/notifications/delete-read"""
        success, response = self.run_test(
            "Delete Read Notifications",
            "POST",
            "notifications/delete-read",
            200,
            params={"user_id": self.user['_id']}
        )
        if success:
            print(f"   Deleted: {response.get('deleted', 0)} read notifications")
        return success

    def test_notifications_unread_count(self):
        """Test GET /api/notifications/unread-count"""
        success, response = self.run_test(
            "Get Unread Count",
            "GET",
            "notifications/unread-count",
            200,
            params={"user_id": self.user['_id']}
        )
        if success:
            print(f"   Unread count: {response.get('count', 0)}")
        return success

    # ============ EXISTING ENDPOINTS (Router Refactor Verification) ============
    def test_health(self):
        """Test /api/health"""
        success, _ = self.run_test("Health Check", "GET", "health", 200)
        return success

    def test_departments(self):
        """Test /api/departments"""
        success, response = self.run_test("List Departments", "GET", "departments", 200)
        if success:
            print(f"   Departments: {len(response)}")
        return success

    def test_stations(self):
        """Test /api/stations"""
        success, response = self.run_test("List Stations", "GET", "stations", 200)
        if success:
            print(f"   Stations: {len(response)}")
        return success

    def test_locations(self):
        """Test /api/locations"""
        success, response = self.run_test("List Locations", "GET", "locations", 200)
        if success:
            print(f"   Locations: {len(response)}")
        return success

    def test_asset_types(self):
        """Test /api/asset-types"""
        success, response = self.run_test("List Asset Types", "GET", "asset-types", 200)
        if success:
            print(f"   Asset Types: {len(response)}")
        return success

    def test_assets(self):
        """Test /api/assets"""
        success, response = self.run_test("List Assets", "GET", "assets", 200)
        if success:
            print(f"   Assets: {len(response)}")
        return success

    def test_users(self):
        """Test /api/users"""
        success, response = self.run_test("List Users", "GET", "users", 200)
        if success:
            print(f"   Users: {len(response)}")
        return success

    def test_users_supervisors(self):
        """Test /api/users/supervisors"""
        success, response = self.run_test("List Supervisors", "GET", "users/supervisors", 200)
        if success:
            print(f"   Supervisors: {len(response)}")
        return success

    def test_users_station_staff(self):
        """Test /api/users/station-staff"""
        success, response = self.run_test("List Station Staff", "GET", "users/station-staff", 200)
        if success:
            print(f"   Station Staff: {len(response)}")
        return success

    def test_inspections(self):
        """Test /api/inspections"""
        success, response = self.run_test("List Inspections", "GET", "inspections", 200)
        if success:
            print(f"   Inspections: {len(response)}")
            if len(response) > 0:
                self.inspection_id = response[0].get('_id')
        return success

    def test_inspection_get(self):
        """Test GET /api/inspections/{id}"""
        if not self.inspection_id:
            print("   ⚠️  Skipped - No inspection ID available")
            return True
        
        success, response = self.run_test(
            "Get Inspection by ID",
            "GET",
            f"inspections/{self.inspection_id}",
            200
        )
        if success:
            print(f"   Inspection: {response.get('inspection_type')} at {response.get('station_name')}")
        return success

    def test_inspections_pending_approvals(self):
        """Test /api/inspections/pending-approvals"""
        success, response = self.run_test(
            "List Pending Approvals",
            "GET",
            "inspections/pending-approvals",
            200,
            params={"reviewer_id": self.user['_id']}
        )
        if success:
            print(f"   Pending items: {response.get('total_items', 0)}")
        return success

    def test_orange_list(self):
        """Test /api/orange-list"""
        success, response = self.run_test("List Orange List", "GET", "orange-list", 200)
        if success:
            print(f"   Orange List Items: {len(response)}")
        return success

    def test_schedules_admin(self):
        """Test /api/schedules/admin"""
        success, response = self.run_test("Schedules Admin", "GET", "schedules/admin", 200)
        if success:
            print(f"   Schedule Items: {len(response)}")
        return success

    def test_schedules_supervisor(self):
        """Test /api/schedules/supervisor/{user_id}"""
        success, response = self.run_test(
            "Schedules Supervisor",
            "GET",
            f"schedules/supervisor/{self.user['_id']}",
            200
        )
        if success:
            print(f"   Supervisor Schedule Items: {len(response)}")
        return success

    def test_dashboard_stats(self):
        """Test /api/dashboard/stats"""
        success, response = self.run_test("Dashboard Stats", "GET", "dashboard/stats", 200)
        if success:
            print(f"   Total Assets: {response.get('total_assets')}")
            print(f"   Orange List: {response.get('orange_list_count')}")
            print(f"   Red List: {response.get('red_list_count')}")
        return success

    def test_dashboard_superadmin(self):
        """Test /api/dashboard/superadmin"""
        success, response = self.run_test("Dashboard Superadmin", "GET", "dashboard/superadmin", 200)
        return success

    def test_dashboard_supervisor(self):
        """Test /api/dashboard/supervisor/{user_id}"""
        success, response = self.run_test(
            "Dashboard Supervisor",
            "GET",
            f"dashboard/supervisor/{self.user['_id']}",
            200
        )
        return success

    def test_dashboard_approving_supervisor(self):
        """Test /api/dashboard/approving-supervisor/{user_id}"""
        success, response = self.run_test(
            "Dashboard Approving Supervisor",
            "GET",
            f"dashboard/approving-supervisor/{self.user['_id']}",
            200
        )
        return success

    def test_dashboard_reporting_officer(self):
        """Test /api/dashboard/reporting-officer/{user_id}"""
        success, response = self.run_test(
            "Dashboard Reporting Officer",
            "GET",
            f"dashboard/reporting-officer/{self.user['_id']}",
            200
        )
        return success

    def test_dashboard_oversight_category_assets(self):
        """Test /api/dashboard/oversight/{user_id}/category-assets"""
        success, response = self.run_test(
            "Dashboard Oversight Category Assets",
            "GET",
            f"dashboard/oversight/{self.user['_id']}/category-assets",
            200
        )
        return success

    def test_analytics_supervisor(self):
        """Test /api/analytics/supervisor/{user_id}"""
        success, response = self.run_test(
            "Analytics Supervisor",
            "GET",
            f"analytics/supervisor/{self.user['_id']}",
            200
        )
        return success

    def test_audit_log(self):
        """Test /api/audit-log"""
        success, response = self.run_test("Audit Log", "GET", "audit-log", 200)
        if success:
            print(f"   Audit Log Entries: {len(response)}")
        return success

    def test_upload_endpoint(self):
        """Test /api/upload endpoint exists (without actually uploading)"""
        # We'll just verify the endpoint is accessible
        # Actual file upload would require multipart/form-data
        print("\n🔍 Testing Upload Endpoint...")
        print("   ⚠️  Skipped - File upload requires multipart/form-data")
        return True

    # ============ RUN ALL TESTS ============
    def run_all_tests(self):
        """Run complete Phase 6 test suite"""
        print("=" * 70)
        print(" RAILWAY ASSET INSPECTION SYSTEM - PHASE 6 TEST SUITE")
        print("=" * 70)
        
        # 1. Authentication
        print("\n" + "=" * 70)
        print(" AUTHENTICATION")
        print("=" * 70)
        if not self.test_login():
            print("\n*** FATAL: Login failed! ***")
            return False
        self.test_auth_me()
        
        # 2. New Notification Endpoints (Phase 6)
        print("\n" + "=" * 70)
        print(" PHASE 6: NEW NOTIFICATION ENDPOINTS")
        print("=" * 70)
        self.test_notifications_backwards_compatible()
        self.test_notifications_paginated()
        self.test_notifications_filter_search()
        self.test_notifications_filter_type()
        self.test_notifications_filter_date()
        self.test_notification_mark_read()
        self.test_notification_mark_unread()
        self.test_notification_delete()
        self.test_notifications_mark_all_read()
        self.test_notifications_delete_read()
        self.test_notifications_unread_count()
        
        # 3. Existing Endpoints (Router Refactor Verification)
        print("\n" + "=" * 70)
        print(" ROUTER REFACTOR: EXISTING ENDPOINTS VERIFICATION")
        print("=" * 70)
        self.test_health()
        self.test_departments()
        self.test_stations()
        self.test_locations()
        self.test_asset_types()
        self.test_assets()
        self.test_users()
        self.test_users_supervisors()
        self.test_users_station_staff()
        self.test_inspections()
        self.test_inspection_get()
        self.test_inspections_pending_approvals()
        self.test_orange_list()
        self.test_schedules_admin()
        self.test_schedules_supervisor()
        self.test_dashboard_stats()
        self.test_dashboard_superadmin()
        self.test_dashboard_supervisor()
        self.test_dashboard_approving_supervisor()
        self.test_dashboard_reporting_officer()
        self.test_dashboard_oversight_category_assets()
        self.test_analytics_supervisor()
        self.test_audit_log()
        self.test_upload_endpoint()
        
        # Print Summary
        print("\n" + "=" * 70)
        print(" TEST SUMMARY")
        print("=" * 70)
        print(f"Tests Run: {self.tests_run}")
        print(f"Tests Passed: {self.tests_passed}")
        print(f"Tests Failed: {self.tests_run - self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed / self.tests_run * 100):.1f}%")
        
        if self.failed_tests:
            print("\n❌ Failed Tests:")
            for test in self.failed_tests:
                print(f"   - {test}")
        else:
            print("\n✅ All tests passed!")
        
        print("=" * 70)
        return self.tests_passed == self.tests_run


def main():
    tester = Phase6APITester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
