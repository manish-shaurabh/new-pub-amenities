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
        """Test dashboard stats - should show 3 assets, 1 station, 1 user"""
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
        self.test_mark_working()
        self.test_approve_working()
        self.test_notifications()
        self.test_unread_count()
        self.test_schedules()
        
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
