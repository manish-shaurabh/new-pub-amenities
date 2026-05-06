"""
Backend API Testing for Railway Asset Inspection Management System
Tests all CRUD operations and workflows
"""
import requests
import sys
from datetime import datetime

BASE_URL = "https://asset-track-rail.preview.emergentagent.com/api"

class RailwayAPITester:
    def __init__(self):
        self.token = None
        self.user = None
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []
        
        # Store IDs for testing
        self.station_id = None
        self.location_id = None
        self.asset_id = None
        self.inspection_id = None
        self.orange_list_item_id = None

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
                response = requests.get(url, headers=headers, params=params)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, params=params)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)

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
                print(f"   Response: {response.text[:200]}")
                self.failed_tests.append(f"{name}: Expected {expected_status}, got {response.status_code}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            self.failed_tests.append(f"{name}: {str(e)}")
            return False, {}

    def test_health(self):
        """Test health check endpoint"""
        success, _ = self.run_test("Health Check", "GET", "health", 200)
        return success

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

    def test_dashboard_stats(self):
        """Test dashboard stats - should show orange_list_count and red_list_count separately (Change 4)"""
        success, response = self.run_test(
            "Dashboard Stats",
            "GET",
            "dashboard/stats",
            200
        )
        if success:
            print(f"   Total Assets: {response.get('total_assets')}")
            print(f"   Total Stations: {response.get('total_stations')}")
            print(f"   Total Users: {response.get('total_users')}")
            print(f"   Working Assets: {response.get('working_assets')}")
            print(f"   Defective Assets: {response.get('defective_assets')}")
            print(f"   Orange List Count: {response.get('orange_list_count')}")
            print(f"   Red List Count: {response.get('red_list_count')}")
            # Verify orange and red counts are present
            if 'orange_list_count' not in response or 'red_list_count' not in response:
                print("   ⚠️  WARNING: orange_list_count or red_list_count missing!")
        return success

    def test_departments(self):
        """Test departments list"""
        success, response = self.run_test(
            "List Departments",
            "GET",
            "departments",
            200
        )
        if success and len(response) > 0:
            print(f"   Found {len(response)} department(s)")
            print(f"   First: {response[0].get('name')} ({response[0].get('code')})")
        return success

    def test_stations(self):
        """Test stations list"""
        success, response = self.run_test(
            "List Stations",
            "GET",
            "stations",
            200
        )
        if success and len(response) > 0:
            self.station_id = response[0].get('_id')
            print(f"   Found {len(response)} station(s)")
            print(f"   First: {response[0].get('name')} ({response[0].get('code')})")
        return success

    def test_locations(self):
        """Test locations list"""
        success, response = self.run_test(
            "List Locations",
            "GET",
            "locations",
            200
        )
        if success and len(response) > 0:
            self.location_id = response[0].get('_id')
            print(f"   Found {len(response)} location(s)")
            print(f"   First: {response[0].get('name')} at {response[0].get('station_name')}")
        return success

    def test_asset_types(self):
        """Test asset types list"""
        success, response = self.run_test(
            "List Asset Types",
            "GET",
            "asset-types",
            200
        )
        if success and len(response) > 0:
            print(f"   Found {len(response)} asset type(s)")
            print(f"   First: {response[0].get('name')} - {len(response[0].get('checklist', []))} checklist items")
        return success

    def test_assets(self):
        """Test assets list - should show FAN-001, FAN-002, FAN-003"""
        success, response = self.run_test(
            "List Assets",
            "GET",
            "assets",
            200
        )
        if success:
            print(f"   Found {len(response)} asset(s)")
            for asset in response[:3]:
                print(f"   - {asset.get('asset_number')}: {asset.get('status')} at {asset.get('station_name')}")
            if len(response) > 0:
                self.asset_id = response[0].get('_id')
        return success

    def test_users(self):
        """Test users list"""
        success, response = self.run_test(
            "List Users",
            "GET",
            "users",
            200
        )
        if success:
            print(f"   Found {len(response)} user(s)")
            for user in response:
                print(f"   - {user.get('name')} ({user.get('employee_id')}): {user.get('role')}")
        return success

    def test_create_inspection(self):
        """Test creating an inspection with defective status"""
        if not self.station_id or not self.asset_id:
            print("⚠️  Skipping - Missing station or asset ID")
            return False
        
        success, response = self.run_test(
            "Create Inspection (Defective)",
            "POST",
            "inspections",
            200,
            data={
                "inspection_type": "individual",
                "station_id": self.station_id,
                "inspector_id": self.user.get('_id'),
                "items": [
                    {
                        "asset_id": self.asset_id,
                        "status": "not_ok",
                        "checklist_responses": [],
                        "remarks": "Test defect - fan not working",
                        "photo_urls": []
                    }
                ],
                "participants": [],
                "overall_remarks": "Test inspection"
            }
        )
        if success:
            self.inspection_id = response.get('_id')
            print(f"   Inspection ID: {self.inspection_id}")
        return success

    def test_inspection_history(self):
        """Test inspection history"""
        success, response = self.run_test(
            "List Inspections",
            "GET",
            "inspections",
            200
        )
        if success:
            print(f"   Found {len(response)} inspection(s)")
            if len(response) > 0:
                print(f"   Latest: {response[0].get('station_name')} by {response[0].get('inspector_name')}")
        return success

    def test_orange_list(self):
        """Test orange list - should show defective asset"""
        success, response = self.run_test(
            "List Orange List Items",
            "GET",
            "orange-list",
            200
        )
        if success:
            print(f"   Found {len(response)} orange list item(s)")
            if len(response) > 0:
                item = response[0]
                self.orange_list_item_id = item.get('_id')
                print(f"   - {item.get('asset_info', {}).get('asset_number')}: {item.get('status')}")
        return success

    def test_mark_working(self):
        """Test marking asset as working"""
        if not self.orange_list_item_id:
            print("⚠️  Skipping - No orange list item to mark working")
            return False
        
        success, response = self.run_test(
            "Mark Asset Working",
            "POST",
            f"orange-list/{self.orange_list_item_id}/mark-working",
            200,
            data={
                "marked_by": self.user.get('_id'),
                "remarks": "Test - repaired and verified"
            }
        )
        if success:
            print(f"   New status: {response.get('status')}")
        return success

    def test_approve_working(self):
        """Test approving working status"""
        if not self.orange_list_item_id:
            print("⚠️  Skipping - No orange list item to approve")
            return False
        
        success, response = self.run_test(
            "Approve Working Status",
            "POST",
            f"orange-list/{self.orange_list_item_id}/approve",
            200,
            data={
                "approved_by": self.user.get('_id'),
                "remarks": "Test - approved after field verification"
            }
        )
        if success:
            print(f"   New status: {response.get('status')}")
        return success

    def test_notifications(self):
        """Test notifications"""
        success, response = self.run_test(
            "List Notifications",
            "GET",
            "notifications",
            200,
            params={"user_id": self.user.get('_id')}
        )
        if success:
            print(f"   Found {len(response)} notification(s)")
        return success

    def test_unread_count(self):
        """Test unread notification count"""
        success, response = self.run_test(
            "Unread Notification Count",
            "GET",
            "notifications/unread-count",
            200,
            params={"user_id": self.user.get('_id')}
        )
        if success:
            print(f"   Unread count: {response.get('count')}")
        return success

    def test_schedules(self):
        """Test schedules"""
        success, response = self.run_test(
            "List Schedules",
            "GET",
            "schedules",
            200
        )
        if success:
            print(f"   Found {len(response)} schedule(s)")
        return success

    def test_station_health(self):
        """Test station-wise health endpoint (Change 6)"""
        success, response = self.run_test(
            "Station-wise Health Data",
            "GET",
            "dashboard/station-health",
            200
        )
        if success:
            print(f"   Found {len(response)} station(s) with health data")
            if len(response) > 0:
                station = response[0]
                print(f"   - {station.get('station_name')}: {station.get('working')}/{station.get('total')} working ({station.get('health_pct')}%)")
        return success

    def test_asset_type_health(self):
        """Test asset type health endpoint (Change 6)"""
        success, response = self.run_test(
            "Asset Type Health Data",
            "GET",
            "dashboard/asset-type-health",
            200
        )
        if success:
            print(f"   Found {len(response)} asset type(s) with health data")
            if len(response) > 0:
                asset_type = response[0]
                print(f"   - {asset_type.get('asset_type_name')}: {asset_type.get('working')}/{asset_type.get('total')} working")
        return success

    def test_orange_list_filter(self):
        """Test orange list with list_type filter (Change 4)"""
        # Test orange filter
        success_orange, response_orange = self.run_test(
            "Orange List (< 24hrs filter)",
            "GET",
            "orange-list",
            200,
            params={"list_type": "orange"}
        )
        if success_orange:
            print(f"   Found {len(response_orange)} orange list item(s)")
        
        # Test red filter
        success_red, response_red = self.run_test(
            "Red List (> 24hrs filter)",
            "GET",
            "orange-list",
            200,
            params={"list_type": "red"}
        )
        if success_red:
            print(f"   Found {len(response_red)} red list item(s)")
        
        return success_orange and success_red

    def test_export_excel(self):
        """Test Excel export endpoint (Change 4)"""
        success, _ = self.run_test(
            "Export Orange List to Excel",
            "GET",
            "orange-list/export/excel",
            200
        )
        return success

    def test_export_pdf(self):
        """Test PDF export endpoint (Change 4)"""
        success, _ = self.run_test(
            "Export Orange List to PDF",
            "GET",
            "orange-list/export/pdf",
            200
        )
        return success

    def test_grant_admin_authorization(self):
        """Test grant admin endpoint authorization (Change 5)"""
        # First, get a non-superadmin user ID (create one if needed)
        success_users, users = self.run_test(
            "List Users for Grant Admin Test",
            "GET",
            "users",
            200
        )
        
        if not success_users or len(users) == 0:
            print("   ⚠️  No users found to test grant admin")
            return False
        
        # Find a non-superadmin user to use as granted_by
        non_superadmin = None
        target_user = None
        for user in users:
            if user.get('role') != 'superadmin':
                if not non_superadmin:
                    non_superadmin = user
                else:
                    target_user = user
                    break
        
        if not non_superadmin or not target_user:
            print("   ⚠️  Need at least 2 non-superadmin users for this test")
            return False
        
        # Try to grant admin with non-superadmin user (should fail with 403)
        success, response = self.run_test(
            "Grant Admin (Non-Superadmin - Should Fail)",
            "POST",
            f"users/{target_user.get('_id')}/grant-admin",
            403,  # Expecting 403 Forbidden
            params={"granted_by": non_superadmin.get('_id')}
        )
        
        if success:
            print("   ✅ Correctly returned 403 for non-superadmin")
        
        return success

    def test_asset_update(self):
        """Test asset update endpoint (Change 5)"""
        if not self.asset_id:
            print("   ⚠️  No asset ID available for update test")
            return False
        
        # Get current asset details
        success_get, asset = self.run_test(
            "Get Asset for Update Test",
            "GET",
            f"assets/{self.asset_id}",
            200
        )
        
        if not success_get:
            return False
        
        # Update the asset description
        success, response = self.run_test(
            "Update Asset (PUT /api/assets/{id})",
            "PUT",
            f"assets/{self.asset_id}",
            200,
            data={
                "asset_type_id": asset.get('asset_type_id'),
                "station_id": asset.get('station_id'),
                "location_id": asset.get('location_id'),
                "asset_number": asset.get('asset_number'),
                "description": "Updated description - test",
                "schedule_frequency": asset.get('schedule_frequency')
            }
        )
        
        if success:
            print(f"   Updated asset: {response.get('asset_number')}")
        
        return success

    # ========== PHASE 7 TESTS ==========
    
    def test_superadmin_dashboard(self):
        """Test GET /api/dashboard/superadmin (Phase 7)"""
        success, response = self.run_test(
            "Superadmin Dashboard (Full)",
            "GET",
            "dashboard/superadmin",
            200
        )
        if success:
            print(f"   Total Assets: {response.get('totals', {}).get('assets')}")
            print(f"   Asset Categories: {len(response.get('asset_categories', []))}")
            print(f"   Stations: {len(response.get('stations', []))}")
            print(f"   Departments: {len(response.get('departments', []))}")
            print(f"   Supervisors: {len(response.get('supervisors', []))}")
            print(f"   Reporting Officers: {len(response.get('reporting_officers', []))}")
            print(f"   Approving Supervisors: {len(response.get('approving_supervisors', []))}")
        return success

    def test_superadmin_dashboard_station_filter(self):
        """Test GET /api/dashboard/superadmin with station_ids filter (Phase 7)"""
        if not self.station_id:
            print("   ⚠️  No station ID available for filter test")
            return False
        
        success, response = self.run_test(
            "Superadmin Dashboard (Station Filter)",
            "GET",
            f"dashboard/superadmin?station_ids={self.station_id}",
            200
        )
        if success:
            print(f"   Filtered Assets: {response.get('totals', {}).get('assets')}")
            print(f"   Filters Applied: {response.get('filters_applied', {})}")
        return success

    def test_oversight_category_assets_by_type(self):
        """Test GET /api/dashboard/oversight/{user_id}/category-assets?asset_type_id=X (Phase 7)"""
        # Get asset type ID first
        success_types, types = self.run_test(
            "Get Asset Types for Oversight Test",
            "GET",
            "asset-types",
            200
        )
        if not success_types or len(types) == 0:
            print("   ⚠️  No asset types available")
            return False
        
        asset_type_id = types[0].get('_id')
        success, response = self.run_test(
            "Oversight Category Assets (by asset_type_id)",
            "GET",
            f"dashboard/oversight/{self.user.get('_id')}/category-assets",
            200,
            params={"asset_type_id": asset_type_id}
        )
        if success:
            print(f"   Priority Assets: {len(response.get('priority', []))}")
            print(f"   Working Assets: {len(response.get('working', []))}")
        return success

    def test_oversight_category_assets_by_department(self):
        """Test GET /api/dashboard/oversight/{user_id}/category-assets?department_id=X (Phase 7)"""
        # Get department ID first
        success_depts, depts = self.run_test(
            "Get Departments for Oversight Test",
            "GET",
            "departments",
            200
        )
        if not success_depts or len(depts) == 0:
            print("   ⚠️  No departments available")
            return False
        
        dept_id = depts[0].get('_id')
        success, response = self.run_test(
            "Oversight Category Assets (by department_id)",
            "GET",
            f"dashboard/oversight/{self.user.get('_id')}/category-assets",
            200,
            params={"department_id": dept_id}
        )
        if success:
            print(f"   Priority Assets: {len(response.get('priority', []))}")
            print(f"   Working Assets: {len(response.get('working', []))}")
        return success

    def test_oversight_category_assets_by_station(self):
        """Test GET /api/dashboard/oversight/{user_id}/category-assets?station_id=X (Phase 7)"""
        if not self.station_id:
            print("   ⚠️  No station ID available")
            return False
        
        success, response = self.run_test(
            "Oversight Category Assets (by station_id)",
            "GET",
            f"dashboard/oversight/{self.user.get('_id')}/category-assets",
            200,
            params={"station_id": self.station_id}
        )
        if success:
            print(f"   Priority Assets: {len(response.get('priority', []))}")
            print(f"   Working Assets: {len(response.get('working', []))}")
        return success

    def test_oversight_category_assets_no_params(self):
        """Test GET /api/dashboard/oversight/{user_id}/category-assets with no params (should fail - Phase 7)"""
        success, response = self.run_test(
            "Oversight Category Assets (no params - should fail)",
            "GET",
            f"dashboard/oversight/{self.user.get('_id')}/category-assets",
            400  # Expecting 400 Bad Request
        )
        if success:
            print("   ✅ Correctly returned 400 for missing params")
        return success

    def test_assign_bulk_to_supervisor(self):
        """Test POST /api/admin/assets/assign-bulk (assign to supervisor - Phase 7)"""
        # Get a supervisor user
        success_users, users = self.run_test(
            "Get Users for Bulk Assign Test",
            "GET",
            "users",
            200
        )
        if not success_users:
            print("   ⚠️  Failed to get users")
            return False
        
        supervisor = None
        for user in users:
            if user.get('role') == 'supervisor':
                supervisor = user
                break
        
        if not supervisor:
            print("   ⚠️  No supervisor found for bulk assign test")
            return False
        
        # Get some assets
        success_assets, assets = self.run_test(
            "Get Assets for Bulk Assign Test",
            "GET",
            "assets",
            200
        )
        if not success_assets or len(assets) == 0:
            print("   ⚠️  No assets available")
            return False
        
        # Take first 2 assets
        asset_ids = [assets[0].get('_id')]
        if len(assets) > 1:
            asset_ids.append(assets[1].get('_id'))
        
        success, response = self.run_test(
            "Bulk Assign Assets to Supervisor",
            "POST",
            "admin/assets/assign-bulk",
            200,
            data={
                "asset_ids": asset_ids,
                "to_supervisor_id": supervisor.get('_id'),
                "performed_by": self.user.get('_id')
            }
        )
        if success:
            print(f"   Assets Updated: {response.get('assets_updated')}")
            print(f"   From Breakdown: {response.get('from_breakdown')}")
        return success

    def test_assign_bulk_unassign(self):
        """Test POST /api/admin/assets/assign-bulk (unassign - Phase 7)"""
        # Get some assets
        success_assets, assets = self.run_test(
            "Get Assets for Bulk Unassign Test",
            "GET",
            "assets",
            200
        )
        if not success_assets or len(assets) == 0:
            print("   ⚠️  No assets available")
            return False
        
        asset_ids = [assets[0].get('_id')]
        
        success, response = self.run_test(
            "Bulk Unassign Assets",
            "POST",
            "admin/assets/assign-bulk",
            200,
            data={
                "asset_ids": asset_ids,
                "to_supervisor_id": None,
                "performed_by": self.user.get('_id')
            }
        )
        if success:
            print(f"   Assets Updated: {response.get('assets_updated')}")
        return success

    def test_assign_bulk_non_supervisor(self):
        """Test POST /api/admin/assets/assign-bulk with non-supervisor (should fail - Phase 7)"""
        # Get a non-supervisor user
        success_users, users = self.run_test(
            "Get Users for Non-Supervisor Test",
            "GET",
            "users",
            200
        )
        if not success_users:
            print("   ⚠️  Failed to get users")
            return False
        
        non_supervisor = None
        for user in users:
            if user.get('role') != 'supervisor':
                non_supervisor = user
                break
        
        if not non_supervisor:
            print("   ⚠️  No non-supervisor found")
            return False
        
        # Get some assets
        success_assets, assets = self.run_test(
            "Get Assets for Non-Supervisor Test",
            "GET",
            "assets",
            200
        )
        if not success_assets or len(assets) == 0:
            print("   ⚠️  No assets available")
            return False
        
        asset_ids = [assets[0].get('_id')]
        
        success, response = self.run_test(
            "Bulk Assign to Non-Supervisor (should fail)",
            "POST",
            "admin/assets/assign-bulk",
            400,  # Expecting 400 Bad Request
            data={
                "asset_ids": asset_ids,
                "to_supervisor_id": non_supervisor.get('_id'),
                "performed_by": self.user.get('_id')
            }
        )
        if success:
            print("   ✅ Correctly returned 400 for non-supervisor target")
        return success

    def run_all_tests(self):
        """Run all tests in sequence"""
        print("=" * 60)
        print("Railway Asset Inspection Management System - API Tests")
        print("=" * 60)
        
        # Basic tests
        if not self.test_health():
            print("\n❌ Health check failed - backend may not be running")
            return False
        
        if not self.test_login():
            print("\n❌ Login failed - cannot proceed with authenticated tests")
            return False
        
        # Dashboard and data tests
        self.test_dashboard_stats()
        self.test_station_health()  # NEW: Change 6
        self.test_asset_type_health()  # NEW: Change 6
        self.test_departments()
        self.test_stations()
        self.test_locations()
        self.test_asset_types()
        self.test_assets()
        self.test_users()
        
        # Workflow tests
        self.test_create_inspection()
        self.test_inspection_history()
        self.test_orange_list()
        self.test_orange_list_filter()  # NEW: Change 4
        self.test_mark_working()
        self.test_approve_working()
        self.test_notifications()
        self.test_unread_count()
        self.test_schedules()
        
        # Export tests (Change 4)
        self.test_export_excel()
        self.test_export_pdf()
        
        # Authorization and update tests (Change 5)
        self.test_grant_admin_authorization()
        self.test_asset_update()
        
        # Phase 7 tests
        print("\n" + "=" * 60)
        print("PHASE 7 TESTS - Superadmin Dashboard & Bulk Assignment")
        print("=" * 60)
        self.test_superadmin_dashboard()
        self.test_superadmin_dashboard_station_filter()
        self.test_oversight_category_assets_by_type()
        self.test_oversight_category_assets_by_department()
        self.test_oversight_category_assets_by_station()
        self.test_oversight_category_assets_no_params()
        self.test_assign_bulk_to_supervisor()
        self.test_assign_bulk_unassign()
        self.test_assign_bulk_non_supervisor()
        
        # Print summary
        print("\n" + "=" * 60)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        print("=" * 60)
        
        if self.failed_tests:
            print("\n❌ Failed Tests:")
            for failure in self.failed_tests:
                print(f"   - {failure}")
        
        return self.tests_passed == self.tests_run


def main():
    tester = RailwayAPITester()
    success = tester.run_all_tests()
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
