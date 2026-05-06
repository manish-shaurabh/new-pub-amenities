"""
Comprehensive Backend API Test for Railway Asset Inspection Management System
Tests all endpoints with focus on:
1. Department creation (user reported as broken)
2. Pagination validation for assets, inspections, orange-list
3. Role-based scoping
4. Notification fan-out
5. Orange/Red list aging calculation
"""

import requests
import sys
from datetime import datetime, timedelta
import time

# Use the public endpoint
BASE_URL = "https://rail-inspect-phase2.preview.emergentagent.com/api"

class RailwayAssetTester:
    def __init__(self):
        self.base_url = BASE_URL
        self.superadmin_token = None
        self.superadmin_id = None
        self.test_data = {}
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []
        
    def log(self, message, level="INFO"):
        """Log test messages"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] [{level}] {message}")
    
    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None, params=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        if headers is None:
            headers = {'Content-Type': 'application/json'}
        
        self.tests_run += 1
        self.log(f"Testing {name}...")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params, timeout=30)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, params=params, timeout=30)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, params=params, timeout=30)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, params=params, timeout=30)
            
            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                self.log(f"✅ PASSED - {name} (Status: {response.status_code})", "PASS")
            else:
                self.log(f"❌ FAILED - {name} (Expected {expected_status}, got {response.status_code})", "FAIL")
                self.log(f"Response: {response.text[:500]}", "ERROR")
                self.failed_tests.append({
                    "test": name,
                    "expected": expected_status,
                    "actual": response.status_code,
                    "response": response.text[:500]
                })
            
            try:
                return success, response.json() if response.text else {}
            except:
                return success, {"raw": response.text}
        
        except Exception as e:
            self.log(f"❌ FAILED - {name} - Error: {str(e)}", "ERROR")
            self.failed_tests.append({
                "test": name,
                "error": str(e)
            })
            return False, {}
    
    def test_login(self):
        """Test login as Superadmin"""
        self.log("=" * 60)
        self.log("TESTING: LOGIN")
        self.log("=" * 60)
        
        success, response = self.run_test(
            "Login as Superadmin (SA001)",
            "POST",
            "auth/login",
            200,
            data={"employee_id": "SA001", "password": "admin123"}
        )
        
        if success and 'token' in response:
            self.superadmin_token = response['token']
            self.superadmin_id = response['user']['_id']
            self.log(f"Superadmin ID: {self.superadmin_id}")
            return True
        return False
    
    def test_departments_crud(self):
        """Test Department CRUD - USER REPORTED THIS AS BROKEN"""
        self.log("=" * 60)
        self.log("TESTING: DEPARTMENTS CRUD (User reported creation not working)")
        self.log("=" * 60)
        
        timestamp = int(time.time())
        dept_name = f"TEST_DEPT_{timestamp}"
        
        # Test CREATE with current_user_id query param (required for Superadmin auth)
        self.log("Testing Department Creation with current_user_id param...")
        success, response = self.run_test(
            "Create Department (with current_user_id)",
            "POST",
            "departments",
            200,
            data={
                "name": dept_name,
                "code": f"TD{timestamp}",
                "description": "Test department for comprehensive testing"
            },
            params={"current_user_id": self.superadmin_id}
        )
        
        if success and '_id' in response:
            dept_id = response['_id']
            self.test_data['department_id'] = dept_id
            self.log(f"Created department: {dept_id}")
            
            # Test GET list
            success, response = self.run_test(
                "List Departments",
                "GET",
                "departments",
                200
            )
            
            # Test GET single
            success, response = self.run_test(
                "Get Department by ID",
                "GET",
                f"departments/{dept_id}",
                200
            )
            
            # Test UPDATE
            success, response = self.run_test(
                "Update Department",
                "PUT",
                f"departments/{dept_id}",
                200,
                data={
                    "name": f"{dept_name}_UPDATED",
                    "code": f"TD{timestamp}",
                    "description": "Updated description"
                },
                params={"current_user_id": self.superadmin_id}
            )
            
            return True
        else:
            self.log("❌ CRITICAL: Department creation failed - this was reported by user", "ERROR")
            return False
    
    def test_stations_crud(self):
        """Test Stations CRUD"""
        self.log("=" * 60)
        self.log("TESTING: STATIONS CRUD")
        self.log("=" * 60)
        
        timestamp = int(time.time())
        station_name = f"TEST_STATION_{timestamp}"
        
        success, response = self.run_test(
            "Create Station",
            "POST",
            "stations",
            200,
            data={
                "name": station_name,
                "code": f"TS{timestamp}",
                "zone": "Western",
                "division": "Mumbai",
                "approving_supervisor_id": None
            }
        )
        
        if success and '_id' in response:
            station_id = response['_id']
            self.test_data['station_id'] = station_id
            self.log(f"Created station: {station_id}")
            
            # Test GET list
            self.run_test("List Stations", "GET", "stations", 200)
            
            # Test GET single
            self.run_test("Get Station by ID", "GET", f"stations/{station_id}", 200)
            
            return True
        return False
    
    def test_locations_crud(self):
        """Test Locations CRUD"""
        self.log("=" * 60)
        self.log("TESTING: LOCATIONS CRUD")
        self.log("=" * 60)
        
        if 'station_id' not in self.test_data:
            self.log("Skipping locations test - no station created", "WARN")
            return False
        
        timestamp = int(time.time())
        location_name = f"TEST_LOCATION_{timestamp}"
        
        success, response = self.run_test(
            "Create Location",
            "POST",
            "locations",
            200,
            data={
                "name": location_name,
                "station_id": self.test_data['station_id'],
                "description": "Test location"
            }
        )
        
        if success and '_id' in response:
            location_id = response['_id']
            self.test_data['location_id'] = location_id
            self.log(f"Created location: {location_id}")
            
            # Test GET list
            self.run_test("List Locations", "GET", "locations", 200)
            
            return True
        return False
    
    def test_asset_types_crud(self):
        """Test Asset Types CRUD"""
        self.log("=" * 60)
        self.log("TESTING: ASSET TYPES CRUD")
        self.log("=" * 60)
        
        if 'department_id' not in self.test_data:
            self.log("Skipping asset types test - no department created", "WARN")
            return False
        
        timestamp = int(time.time())
        
        success, response = self.run_test(
            "Create Asset Type",
            "POST",
            "asset-types",
            200,
            data={
                "name": f"TEST_ASSET_TYPE_{timestamp}",
                "department_id": self.test_data['department_id'],
                "description": "Test asset type",
                "checklist": [
                    {"name": "Check power supply", "description": "Verify power supply is working"},
                    {"name": "Check connections", "description": "Verify all connections are secure"},
                    {"name": "Visual inspection", "description": "Perform visual inspection"}
                ]
            }
        )
        
        if success and '_id' in response:
            asset_type_id = response['_id']
            self.test_data['asset_type_id'] = asset_type_id
            self.log(f"Created asset type: {asset_type_id}")
            
            # Test GET list
            self.run_test("List Asset Types", "GET", "asset-types", 200)
            
            return True
        return False
    
    def test_users_crud(self):
        """Test Users CRUD with reports_to chain"""
        self.log("=" * 60)
        self.log("TESTING: USERS CRUD (Reporting Chain)")
        self.log("=" * 60)
        
        if 'department_id' not in self.test_data or 'station_id' not in self.test_data:
            self.log("Skipping users test - missing department or station", "WARN")
            return False
        
        timestamp = int(time.time())
        
        # Create Reporting Officer
        success, response = self.run_test(
            "Create Reporting Officer",
            "POST",
            "users",
            200,
            data={
                "employee_id": f"RO{timestamp}",
                "name": f"Test RO {timestamp}",
                "role": "reporting_officer",
                "department_id": self.test_data['department_id'],
                "assigned_stations": [self.test_data['station_id']],
                "password": "test123",
                "email": f"ro{timestamp}@test.com",
                "phone": "1234567890",
                "reports_to_id": None
            }
        )
        
        if success and '_id' in response:
            ro_id = response['_id']
            self.test_data['ro_id'] = ro_id
            self.log(f"Created Reporting Officer: {ro_id}")
        
        # Create Approving Supervisor
        success, response = self.run_test(
            "Create Approving Supervisor",
            "POST",
            "users",
            200,
            data={
                "employee_id": f"ASUP{timestamp}",
                "name": f"Test ASUP {timestamp}",
                "role": "approving_supervisor",
                "department_id": self.test_data['department_id'],
                "assigned_stations": [self.test_data['station_id']],
                "password": "test123",
                "email": f"asup{timestamp}@test.com",
                "phone": "1234567890",
                "reports_to_id": self.test_data.get('ro_id')
            }
        )
        
        if success and '_id' in response:
            asup_id = response['_id']
            self.test_data['asup_id'] = asup_id
            self.log(f"Created Approving Supervisor: {asup_id}")
        
        # Create Supervisor
        success, response = self.run_test(
            "Create Supervisor",
            "POST",
            "users",
            200,
            data={
                "employee_id": f"SUP{timestamp}",
                "name": f"Test Supervisor {timestamp}",
                "role": "supervisor",
                "department_id": self.test_data['department_id'],
                "assigned_stations": [self.test_data['station_id']],
                "password": "test123",
                "email": f"sup{timestamp}@test.com",
                "phone": "1234567890",
                "reports_to_id": self.test_data.get('asup_id')
            }
        )
        
        if success and '_id' in response:
            sup_id = response['_id']
            self.test_data['supervisor_id'] = sup_id
            self.log(f"Created Supervisor: {sup_id}")
            
            # Test GET list
            self.run_test("List Users", "GET", "users", 200)
            
            return True
        return False
    
    def test_assets_crud_and_pagination(self):
        """Test Assets CRUD and NEW PAGINATION feature"""
        self.log("=" * 60)
        self.log("TESTING: ASSETS CRUD & PAGINATION")
        self.log("=" * 60)
        
        if not all(k in self.test_data for k in ['asset_type_id', 'station_id', 'location_id']):
            self.log("Skipping assets test - missing prerequisites", "WARN")
            return False
        
        timestamp = int(time.time())
        
        # Create Asset
        success, response = self.run_test(
            "Create Asset",
            "POST",
            "assets",
            200,
            data={
                "asset_type_id": self.test_data['asset_type_id'],
                "station_id": self.test_data['station_id'],
                "location_id": self.test_data['location_id'],
                "asset_number": f"TEST_ASSET_{timestamp}",
                "description": "Test asset for comprehensive testing",
                "schedule_frequency": 7,  # 7 days = weekly
                "assigned_supervisor_id": self.test_data.get('supervisor_id')
            }
        )
        
        if success and '_id' in response:
            asset_id = response['_id']
            self.test_data['asset_id'] = asset_id
            self.log(f"Created asset: {asset_id}")
            
            # Test GET list (non-paginated - backwards compatible)
            success, response = self.run_test(
                "List Assets (non-paginated)",
                "GET",
                "assets",
                200
            )
            
            # Test NEW PAGINATION feature
            success, response = self.run_test(
                "List Assets (paginated - NEW FEATURE)",
                "GET",
                "assets",
                200,
                params={"paginated": "true", "page": 1, "page_size": 20}
            )
            
            if success:
                # Validate pagination envelope
                if all(k in response for k in ['items', 'total', 'page', 'page_size', 'total_pages']):
                    self.log("✅ Pagination envelope validated: items, total, page, page_size, total_pages present")
                    self.tests_passed += 1
                else:
                    self.log("❌ Pagination envelope incomplete", "ERROR")
                    self.failed_tests.append({
                        "test": "Assets Pagination Envelope",
                        "issue": "Missing required fields in pagination response"
                    })
            
            return True
        return False
    
    def test_inspections_and_pagination(self):
        """Test Inspections workflow and pagination"""
        self.log("=" * 60)
        self.log("TESTING: INSPECTIONS & PAGINATION")
        self.log("=" * 60)
        
        if not all(k in self.test_data for k in ['asset_id', 'supervisor_id', 'station_id']):
            self.log("Skipping inspections test - missing prerequisites", "WARN")
            return False
        
        # Create Inspection with FAIL item
        success, response = self.run_test(
            "Create Inspection (with FAIL item)",
            "POST",
            "inspections",
            200,
            data={
                "inspection_type": "individual",
                "station_id": self.test_data['station_id'],
                "inspector_id": self.test_data['supervisor_id'],
                "items": [
                    {
                        "asset_id": self.test_data['asset_id'],
                        "status": "not_ok",
                        "remarks": "Asset found defective during inspection - test case",
                        "checklist_responses": [
                            {"item": "Check power supply", "response": "fail"},
                            {"item": "Check connections", "response": "pass"}
                        ],
                        "photo_urls": []
                    }
                ],
                "overall_remarks": "Test inspection with defective asset",
                "inspection_at": datetime.utcnow().isoformat()
            }
        )
        
        if success and '_id' in response:
            inspection_id = response['_id']
            self.test_data['inspection_id'] = inspection_id
            self.log(f"Created inspection: {inspection_id}")
            
            # Test GET list (non-paginated)
            self.run_test(
                "List Inspections (non-paginated)",
                "GET",
                "inspections",
                200
            )
            
            # Test NEW PAGINATION feature
            success, response = self.run_test(
                "List Inspections (paginated - NEW FEATURE)",
                "GET",
                "inspections",
                200,
                params={"paginated": "true", "page": 1, "page_size": 20}
            )
            
            if success:
                # Validate pagination envelope
                if all(k in response for k in ['items', 'total', 'page', 'page_size', 'total_pages']):
                    self.log("✅ Inspections pagination envelope validated")
                    self.tests_passed += 1
                else:
                    self.log("❌ Inspections pagination envelope incomplete", "ERROR")
            
            return True
        return False
    
    def test_inspection_approval(self):
        """Test Inspection Approval workflow"""
        self.log("=" * 60)
        self.log("TESTING: INSPECTION APPROVAL")
        self.log("=" * 60)
        
        if not all(k in self.test_data for k in ['inspection_id', 'asup_id']):
            self.log("Skipping approval test - missing prerequisites", "WARN")
            return False
        
        # Approve inspection item (item_index = 0)
        success, response = self.run_test(
            "Approve Inspection Item",
            "POST",
            f"inspections/{self.test_data['inspection_id']}/items/0/approve",
            200,
            data={
                "reviewer_id": self.test_data['asup_id'],
                "remarks": "Approved - defect confirmed"
            }
        )
        
        if success:
            self.log("✅ Inspection approved - asset should now be defective")
            return True
        return False
    
    def test_mark_defective_manual(self):
        """Test Manual Mark Defective with past date for RED list"""
        self.log("=" * 60)
        self.log("TESTING: MANUAL MARK DEFECTIVE (for RED list aging)")
        self.log("=" * 60)
        
        if 'asset_id' not in self.test_data:
            self.log("Skipping mark-defective test - no asset created", "WARN")
            return False
        
        # Mark defective with date 35 days ago to force RED list
        defective_date = (datetime.utcnow() - timedelta(days=35)).isoformat()
        
        success, response = self.run_test(
            "Mark Asset Defective (35 days ago for RED list)",
            "POST",
            f"assets/{self.test_data['asset_id']}/mark-defective",
            200,
            data={
                "status": "needs_repair",
                "remarks": "Manually marked defective for RED list testing - 35 days ago",
                "defective_at": defective_date,
                "performed_by": self.superadmin_id,
                "photo_urls": []
            }
        )
        
        if success:
            self.log("✅ Asset marked defective with past date")
            if 'orange_list_id' in response:
                self.test_data['orange_list_id'] = response['orange_list_id']
            return True
        return False
    
    def test_orange_red_list_and_pagination(self):
        """Test Orange/Red List with aging calculation and pagination"""
        self.log("=" * 60)
        self.log("TESTING: ORANGE/RED LIST & AGING CALCULATION")
        self.log("=" * 60)
        
        # Test GET list (non-paginated)
        success, response = self.run_test(
            "List Orange/Red Items (non-paginated)",
            "GET",
            "orange-list",
            200
        )
        
        if success and len(response) > 0:
            # Check aging calculation
            for item in response:
                if 'hours_defective' in item and 'list_type' in item:
                    hours = item['hours_defective']
                    list_type = item['list_type']
                    expected_type = "red" if hours > 24 else "orange"
                    
                    if list_type == expected_type:
                        self.log(f"✅ Aging correct: {hours}h → {list_type} list")
                    else:
                        self.log(f"❌ Aging incorrect: {hours}h → {list_type} (expected {expected_type})", "ERROR")
                        self.failed_tests.append({
                            "test": "Orange/Red List Aging",
                            "issue": f"Item with {hours}h classified as {list_type}, expected {expected_type}"
                        })
        
        # Test NEW PAGINATION feature
        success, response = self.run_test(
            "List Orange/Red Items (paginated - NEW FEATURE)",
            "GET",
            "orange-list",
            200,
            params={"paginated": "true", "page": 1, "page_size": 20}
        )
        
        if success:
            # Validate pagination envelope
            if all(k in response for k in ['items', 'total', 'page', 'page_size', 'total_pages']):
                self.log("✅ Orange/Red list pagination envelope validated")
                self.tests_passed += 1
            else:
                self.log("❌ Orange/Red list pagination envelope incomplete", "ERROR")
        
        # Test RED list filter
        success, response = self.run_test(
            "List RED Items Only",
            "GET",
            "orange-list",
            200,
            params={"list_type": "red"}
        )
        
        if success:
            red_count = len(response) if isinstance(response, list) else len(response.get('items', []))
            self.log(f"Found {red_count} RED list items")
        
        return True
    
    def test_notifications_fanout(self):
        """Test Notification Fan-out to all roles"""
        self.log("=" * 60)
        self.log("TESTING: NOTIFICATION FAN-OUT")
        self.log("=" * 60)
        
        # Check notifications for each role
        roles_to_check = [
            ('Supervisor', self.test_data.get('supervisor_id')),
            ('Approving Supervisor', self.test_data.get('asup_id')),
            ('Reporting Officer', self.test_data.get('ro_id')),
            ('Superadmin', self.superadmin_id)
        ]
        
        for role_name, user_id in roles_to_check:
            if user_id:
                success, response = self.run_test(
                    f"Get Notifications for {role_name}",
                    "GET",
                    "notifications",
                    200,
                    params={"user_id": user_id}
                )
                
                if success:
                    notif_count = len(response) if isinstance(response, list) else len(response.get('items', []))
                    self.log(f"{role_name} has {notif_count} notifications")
                    
                    # Check for defective asset notification
                    notifications = response if isinstance(response, list) else response.get('items', [])
                    has_defect_notif = any('defective' in n.get('title', '').lower() or 
                                          'defective' in n.get('message', '').lower() 
                                          for n in notifications)
                    
                    if has_defect_notif:
                        self.log(f"✅ {role_name} received defective asset notification")
                    else:
                        self.log(f"⚠️  {role_name} did NOT receive defective asset notification", "WARN")
        
        return True
    
    def test_role_scoping(self):
        """Test Role-based Scoping"""
        self.log("=" * 60)
        self.log("TESTING: ROLE-BASED SCOPING")
        self.log("=" * 60)
        
        # Test that Admin CANNOT create departments (should get 403)
        # First, create an Admin user
        timestamp = int(time.time())
        success, response = self.run_test(
            "Create Admin User",
            "POST",
            "users",
            200,
            data={
                "employee_id": f"ADMIN{timestamp}",
                "name": f"Test Admin {timestamp}",
                "role": "admin",
                "department_id": self.test_data.get('department_id'),
                "assigned_stations": [self.test_data.get('station_id')],
                "password": "test123",
                "email": f"admin{timestamp}@test.com",
                "phone": "1234567890",
                "reports_to_id": None
            }
        )
        
        if success and '_id' in response:
            admin_id = response['_id']
            
            # Try to create department as Admin (should fail with 403)
            success, response = self.run_test(
                "Admin tries to Create Department (should FAIL with 403)",
                "POST",
                "departments",
                403,  # Expecting 403 Forbidden
                data={
                    "name": f"SHOULD_FAIL_{timestamp}",
                    "code": "FAIL",
                    "description": "This should not be created"
                },
                params={"current_user_id": admin_id}
            )
            
            if success:
                self.log("✅ Admin correctly blocked from creating department (403)")
            else:
                self.log("❌ Admin was able to create department (security issue!)", "ERROR")
        
        return True
    
    def print_summary(self):
        """Print test summary"""
        self.log("=" * 60)
        self.log("TEST SUMMARY")
        self.log("=" * 60)
        self.log(f"Total Tests Run: {self.tests_run}")
        self.log(f"Tests Passed: {self.tests_passed}")
        self.log(f"Tests Failed: {len(self.failed_tests)}")
        self.log(f"Success Rate: {(self.tests_passed/self.tests_run*100):.1f}%")
        
        if self.failed_tests:
            self.log("\n" + "=" * 60)
            self.log("FAILED TESTS DETAILS")
            self.log("=" * 60)
            for i, failure in enumerate(self.failed_tests, 1):
                self.log(f"\n{i}. {failure.get('test', 'Unknown Test')}")
                for key, value in failure.items():
                    if key != 'test':
                        self.log(f"   {key}: {value}")
        
        self.log("\n" + "=" * 60)
        self.log("TEST DATA CREATED")
        self.log("=" * 60)
        for key, value in self.test_data.items():
            self.log(f"{key}: {value}")
        
        return self.tests_passed == self.tests_run

def main():
    tester = RailwayAssetTester()
    
    # Run all tests in sequence
    if not tester.test_login():
        print("\n❌ Login failed - cannot continue")
        return 1
    
    tester.test_departments_crud()
    tester.test_stations_crud()
    tester.test_locations_crud()
    tester.test_asset_types_crud()
    tester.test_users_crud()
    tester.test_assets_crud_and_pagination()
    tester.test_inspections_and_pagination()
    tester.test_inspection_approval()
    tester.test_mark_defective_manual()
    tester.test_orange_red_list_and_pagination()
    tester.test_notifications_fanout()
    tester.test_role_scoping()
    
    # Print summary
    all_passed = tester.print_summary()
    
    return 0 if all_passed else 1

if __name__ == "__main__":
    sys.exit(main())
