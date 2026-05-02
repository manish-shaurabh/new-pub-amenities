"""
Phase 1 POC Test Script - Railway Asset Inspection Management System
Tests the core workflow:
1. Create entities (department, station, location, asset type, asset, users)
2. Submit inspection with defective asset
3. Verify Orange List entry created
4. Verify notification sent to RO
5. Mark working by supervisor
6. Approve by approving supervisor
7. Verify asset back to working status
8. Test file upload
"""

import requests
import os
import json
import tempfile

BASE_URL = "http://localhost:8001/api"


def print_result(test_name, success, details=""):
    status = "PASS" if success else "FAIL"
    print(f"  [{status}] {test_name}")
    if details and not success:
        print(f"         Details: {details}")


def test_health():
    """Test health endpoint"""
    print("\n=== TEST: Health Check ===")
    resp = requests.get(f"{BASE_URL}/health")
    print_result("Health endpoint", resp.status_code == 200, resp.text)
    return resp.status_code == 200


def test_create_entities():
    """Create base entities: department, station, location, asset type"""
    print("\n=== TEST: Create Base Entities ===")
    results = {}
    
    # Create Department
    resp = requests.post(f"{BASE_URL}/departments", json={
        "name": "Electrical",
        "code": "ELEC",
        "description": "Electrical maintenance department"
    })
    results["department"] = resp.json() if resp.status_code == 200 else None
    print_result("Create Department", resp.status_code == 200, resp.text)
    
    # Create Station
    resp = requests.post(f"{BASE_URL}/stations", json={
        "name": "Mumbai Central",
        "code": "MMCT",
        "zone": "Western",
        "division": "Mumbai"
    })
    results["station"] = resp.json() if resp.status_code == 200 else None
    print_result("Create Station", resp.status_code == 200, resp.text)
    
    # Create Location
    if results["station"]:
        resp = requests.post(f"{BASE_URL}/locations", json={
            "name": "Platform 1",
            "station_id": results["station"]["_id"],
            "description": "Main platform"
        })
        results["location"] = resp.json() if resp.status_code == 200 else None
        print_result("Create Location", resp.status_code == 200, resp.text)
    
    # Create Asset Type with checklist
    if results["department"]:
        resp = requests.post(f"{BASE_URL}/asset-types", json={
            "name": "Fan",
            "department_id": results["department"]["_id"],
            "checklist": [
                {"name": "Blade condition", "description": "Check if blades are intact"},
                {"name": "Motor sound", "description": "Check for unusual sounds"},
                {"name": "Speed regulation", "description": "Check speed levels work"}
            ],
            "description": "Ceiling fan for passenger waiting areas"
        })
        results["asset_type"] = resp.json() if resp.status_code == 200 else None
        print_result("Create Asset Type with Checklist", resp.status_code == 200, resp.text)
    
    # Create Asset
    if all(results.get(k) for k in ["asset_type", "station", "location"]):
        resp = requests.post(f"{BASE_URL}/assets", json={
            "asset_type_id": results["asset_type"]["_id"],
            "station_id": results["station"]["_id"],
            "location_id": results["location"]["_id"],
            "asset_number": "FAN-P1-001",
            "description": "Ceiling fan at Platform 1 waiting area",
            "schedule_frequency": "weekly"
        })
        results["asset"] = resp.json() if resp.status_code == 200 else None
        print_result("Create Asset", resp.status_code == 200, resp.text)
    
    return results


def test_create_users(entities):
    """Create users with different roles"""
    print("\n=== TEST: Create Users ===")
    results = {}
    
    station_id = entities.get("station", {}).get("_id", "")
    dept_id = entities.get("department", {}).get("_id", "")
    
    # Supervisor
    resp = requests.post(f"{BASE_URL}/users", json={
        "employee_id": "SUP001",
        "name": "Rajesh Kumar",
        "role": "supervisor",
        "department_id": dept_id,
        "assigned_stations": [station_id],
        "password": "pass123",
        "email": "rajesh@railway.gov.in",
        "phone": "9876543210"
    })
    results["supervisor"] = resp.json() if resp.status_code == 200 else None
    print_result("Create Supervisor", resp.status_code == 200, resp.text)
    
    # Reporting Officer
    resp = requests.post(f"{BASE_URL}/users", json={
        "employee_id": "RO001",
        "name": "Sunil Sharma",
        "role": "reporting_officer",
        "department_id": dept_id,
        "assigned_stations": [station_id],
        "password": "pass123",
        "email": "sunil@railway.gov.in",
        "phone": "9876543211"
    })
    results["ro"] = resp.json() if resp.status_code == 200 else None
    print_result("Create Reporting Officer", resp.status_code == 200, resp.text)
    
    # Approving Supervisor
    resp = requests.post(f"{BASE_URL}/users", json={
        "employee_id": "AS001",
        "name": "Vikram Singh",
        "role": "approving_supervisor",
        "department_id": dept_id,
        "assigned_stations": [station_id],
        "password": "pass123",
        "email": "vikram@railway.gov.in",
        "phone": "9876543212"
    })
    results["approving_supervisor"] = resp.json() if resp.status_code == 200 else None
    print_result("Create Approving Supervisor", resp.status_code == 200, resp.text)
    
    # Admin
    resp = requests.post(f"{BASE_URL}/users", json={
        "employee_id": "ADM001",
        "name": "Admin User",
        "role": "admin",
        "department_id": dept_id,
        "assigned_stations": [station_id],
        "password": "admin123",
        "email": "admin@railway.gov.in"
    })
    results["admin"] = resp.json() if resp.status_code == 200 else None
    print_result("Create Admin", resp.status_code == 200, resp.text)
    
    # Superadmin
    resp = requests.post(f"{BASE_URL}/users", json={
        "employee_id": "SA001",
        "name": "Super Admin",
        "role": "superadmin",
        "department_id": dept_id,
        "assigned_stations": [station_id],
        "password": "superadmin123"
    })
    results["superadmin"] = resp.json() if resp.status_code == 200 else None
    print_result("Create Superadmin", resp.status_code == 200, resp.text)
    
    return results


def test_auth(users):
    """Test login functionality"""
    print("\n=== TEST: Authentication ===")
    
    resp = requests.post(f"{BASE_URL}/auth/login", json={
        "employee_id": "SUP001",
        "password": "pass123"
    })
    print_result("Login with valid credentials", resp.status_code == 200, resp.text[:200] if resp.status_code != 200 else "")
    
    if resp.status_code == 200:
        data = resp.json()
        token = data.get("token")
        print_result("Token received", token is not None)
        
        # Test /me endpoint
        me_resp = requests.get(f"{BASE_URL}/auth/me?token={token}")
        print_result("Get current user", me_resp.status_code == 200)
    
    # Test invalid login
    resp = requests.post(f"{BASE_URL}/auth/login", json={
        "employee_id": "SUP001",
        "password": "wrongpass"
    })
    print_result("Reject invalid password", resp.status_code == 401)
    
    return True


def test_inspection_with_defect(entities, users):
    """Submit inspection marking asset as defective"""
    print("\n=== TEST: Inspection with Defect ===")
    
    asset_id = entities["asset"]["_id"]
    supervisor_id = users["supervisor"]["_id"]
    station_id = entities["station"]["_id"]
    
    resp = requests.post(f"{BASE_URL}/inspections", json={
        "inspection_type": "individual",
        "station_id": station_id,
        "inspector_id": supervisor_id,
        "items": [
            {
                "asset_id": asset_id,
                "status": "not_ok",
                "checklist_responses": [
                    {"name": "Blade condition", "value": "damaged", "status": "fail"},
                    {"name": "Motor sound", "value": "normal", "status": "pass"},
                    {"name": "Speed regulation", "value": "not working", "status": "fail"}
                ],
                "remarks": "Fan blade is broken, speed regulator not responding",
                "photo_urls": []
            }
        ],
        "overall_remarks": "Platform 1 fan needs urgent repair"
    })
    
    inspection = resp.json() if resp.status_code == 200 else None
    print_result("Submit inspection", resp.status_code == 200, resp.text[:300] if resp.status_code != 200 else "")
    
    if inspection:
        # Verify asset status changed to defective
        asset_resp = requests.get(f"{BASE_URL}/assets/{asset_id}")
        asset_data = asset_resp.json()
        print_result("Asset marked defective", asset_data.get("status") == "defective", 
                    f"Status: {asset_data.get('status')}")
    
    return inspection


def test_orange_list(entities, users):
    """Verify Orange List entry was created"""
    print("\n=== TEST: Orange List ===")
    
    resp = requests.get(f"{BASE_URL}/orange-list")
    items = resp.json() if resp.status_code == 200 else []
    print_result("Orange List has items", len(items) > 0, f"Count: {len(items)}")
    
    if items:
        item = items[0]
        print_result("Orange item has asset info", item.get("asset_info") is not None)
        print_result("Orange item status is 'defective'", item.get("status") == "defective",
                    f"Status: {item.get('status')}")
        return item
    return None


def test_notification_to_ro(users):
    """Verify RO received notification about defective asset"""
    print("\n=== TEST: Notification to RO ===")
    
    ro_id = users["ro"]["_id"]
    resp = requests.get(f"{BASE_URL}/notifications?user_id={ro_id}")
    notifications = resp.json() if resp.status_code == 200 else []
    print_result("RO has notifications", len(notifications) > 0, f"Count: {len(notifications)}")
    
    if notifications:
        notif = notifications[0]
        print_result("Notification type is 'alert'", notif.get("notification_type") == "alert")
        print_result("Notification about defective asset", "defective" in notif.get("title", "").lower() or "defective" in notif.get("message", "").lower())
    
    # Check unread count
    count_resp = requests.get(f"{BASE_URL}/notifications/unread-count?user_id={ro_id}")
    if count_resp.status_code == 200:
        print_result("Unread count > 0", count_resp.json().get("count", 0) > 0)
    
    return True


def test_mark_working(orange_item, users):
    """Supervisor marks defective asset as working"""
    print("\n=== TEST: Mark Working (by Supervisor) ===")
    
    item_id = orange_item["_id"]
    supervisor_id = users["supervisor"]["_id"]
    
    resp = requests.post(f"{BASE_URL}/orange-list/{item_id}/mark-working", json={
        "marked_by": supervisor_id,
        "remarks": "Fan blade replaced and tested"
    })
    
    print_result("Mark working successful", resp.status_code == 200, resp.text[:200] if resp.status_code != 200 else "")
    
    if resp.status_code == 200:
        data = resp.json()
        print_result("Status changed to pending_approval", data.get("status") == "pending_approval",
                    f"Status: {data.get('status')}")
    
    return resp.status_code == 200


def test_approve_working(orange_item, users):
    """Approving Supervisor approves the working status"""
    print("\n=== TEST: Approve Working (by Approving Supervisor) ===")
    
    item_id = orange_item["_id"]
    approver_id = users["approving_supervisor"]["_id"]
    
    resp = requests.post(f"{BASE_URL}/orange-list/{item_id}/approve", json={
        "approved_by": approver_id,
        "remarks": "Verified in field - fan working properly"
    })
    
    print_result("Approve working successful", resp.status_code == 200, resp.text[:200] if resp.status_code != 200 else "")
    
    if resp.status_code == 200:
        data = resp.json()
        print_result("Status changed to resolved", data.get("status") == "resolved",
                    f"Status: {data.get('status')}")
    
    return resp.status_code == 200


def test_asset_back_to_working(entities):
    """Verify asset status is back to working after approval"""
    print("\n=== TEST: Asset Status After Approval ===")
    
    asset_id = entities["asset"]["_id"]
    resp = requests.get(f"{BASE_URL}/assets/{asset_id}")
    
    if resp.status_code == 200:
        data = resp.json()
        print_result("Asset back to working", data.get("status") == "working",
                    f"Status: {data.get('status')}")
    else:
        print_result("Get asset", False, resp.text)
    
    return resp.status_code == 200


def test_file_upload():
    """Test photo upload functionality"""
    print("\n=== TEST: File Upload ===")
    
    # Create a temp file to upload
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False, mode='wb') as f:
        f.write(b'\xff\xd8\xff\xe0' + b'\x00' * 100)  # Minimal JPEG header
        temp_path = f.name
    
    try:
        with open(temp_path, 'rb') as f:
            resp = requests.post(f"{BASE_URL}/upload", files={"file": ("test_photo.jpg", f, "image/jpeg")})
        
        print_result("Single file upload", resp.status_code == 200, resp.text[:200] if resp.status_code != 200 else "")
        
        if resp.status_code == 200:
            data = resp.json()
            print_result("URL returned", data.get("url") is not None, f"URL: {data.get('url')}")
            
            # Verify file is accessible
            file_url = f"http://localhost:8001{data['url']}"
            file_resp = requests.get(file_url)
            print_result("File accessible", file_resp.status_code == 200)
    finally:
        os.unlink(temp_path)
    
    return True


def test_sig_inspection(entities, users):
    """Test SIG (Station Inspection Group) inspection"""
    print("\n=== TEST: SIG Inspection ===")
    
    station_id = entities["station"]["_id"]
    asset_id = entities["asset"]["_id"]
    approver_id = users["approving_supervisor"]["_id"]
    
    resp = requests.post(f"{BASE_URL}/inspections", json={
        "inspection_type": "sig",
        "station_id": station_id,
        "inspector_id": approver_id,
        "items": [
            {
                "asset_id": asset_id,
                "status": "ok",
                "checklist_responses": [
                    {"name": "Blade condition", "value": "good", "status": "pass"},
                    {"name": "Motor sound", "value": "normal", "status": "pass"},
                    {"name": "Speed regulation", "value": "working", "status": "pass"}
                ],
                "remarks": "All good after repair",
                "photo_urls": []
            }
        ],
        "participants": ["SUP001", "RO001"],
        "overall_remarks": "Station inspection group - all assets working well"
    })
    
    print_result("SIG inspection submitted", resp.status_code == 200, resp.text[:300] if resp.status_code != 200 else "")
    
    if resp.status_code == 200:
        data = resp.json()
        print_result("Participants recorded", len(data.get("participants", [])) > 0,
                    f"Participants: {data.get('participants')}")
        print_result("Inspection type is SIG", data.get("inspection_type") == "sig")
    
    return resp.status_code == 200


def test_schedule(entities, users):
    """Test scheduling functionality"""
    print("\n=== TEST: Scheduling ===")
    
    asset_id = entities["asset"]["_id"]
    admin_id = users["admin"]["_id"]
    
    resp = requests.post(f"{BASE_URL}/schedules", json={
        "asset_id": asset_id,
        "frequency": "weekly",
        "set_by": admin_id
    })
    print_result("Create schedule", resp.status_code == 200, resp.text[:200] if resp.status_code != 200 else "")
    
    # List schedules
    resp = requests.get(f"{BASE_URL}/schedules")
    print_result("List schedules", resp.status_code == 200 and len(resp.json()) > 0)
    
    return True


def test_role_management(users):
    """Test granting/revoking admin powers"""
    print("\n=== TEST: Role Management (Superadmin Powers) ===")
    
    superadmin_id = users["superadmin"]["_id"]
    supervisor_id = users["supervisor"]["_id"]
    
    # Grant admin to supervisor
    resp = requests.post(f"{BASE_URL}/users/{supervisor_id}/grant-admin?granted_by={superadmin_id}")
    print_result("Grant admin to supervisor", resp.status_code == 200, resp.text[:200] if resp.status_code != 200 else "")
    
    # Verify role changed
    user_resp = requests.get(f"{BASE_URL}/users/{supervisor_id}")
    if user_resp.status_code == 200:
        print_result("Role changed to admin", user_resp.json().get("role") == "admin")
    
    # Revoke admin (change back to supervisor)
    resp = requests.post(f"{BASE_URL}/users/{supervisor_id}/revoke-admin?revoked_by={superadmin_id}&new_role=supervisor")
    print_result("Revoke admin from supervisor", resp.status_code == 200)
    
    # Try granting with non-superadmin (should fail)
    admin_id = users["admin"]["_id"]
    resp = requests.post(f"{BASE_URL}/users/{supervisor_id}/grant-admin?granted_by={admin_id}")
    print_result("Non-superadmin cannot grant admin", resp.status_code == 403)
    
    return True


def test_dashboard():
    """Test dashboard stats"""
    print("\n=== TEST: Dashboard ===")
    
    resp = requests.get(f"{BASE_URL}/dashboard/stats")
    print_result("Dashboard stats", resp.status_code == 200, resp.text[:200] if resp.status_code != 200 else "")
    
    if resp.status_code == 200:
        data = resp.json()
        print_result("Has total_assets", "total_assets" in data)
        print_result("Has orange_list_count", "orange_list_count" in data)
        print_result("Has total_inspections", "total_inspections" in data)
        print(f"         Stats: {json.dumps(data, indent=2)}")
    
    resp = requests.get(f"{BASE_URL}/dashboard/recent-inspections")
    print_result("Recent inspections", resp.status_code == 200)
    
    return True


def run_all_tests():
    """Run complete POC test suite"""
    print("=" * 60)
    print(" RAILWAY ASSET INSPECTION SYSTEM - POC TEST SUITE")
    print("=" * 60)
    
    # 1. Health check
    if not test_health():
        print("\n*** FATAL: Backend not running! ***")
        return False
    
    # 2. Create base entities
    entities = test_create_entities()
    if not all(entities.get(k) for k in ["department", "station", "location", "asset_type", "asset"]):
        print("\n*** FATAL: Failed to create base entities ***")
        return False
    
    # 3. Create users
    users = test_create_users(entities)
    if not all(users.get(k) for k in ["supervisor", "ro", "approving_supervisor", "admin", "superadmin"]):
        print("\n*** FATAL: Failed to create users ***")
        return False
    
    # 4. Test auth
    test_auth(users)
    
    # 5. Submit inspection with defect
    inspection = test_inspection_with_defect(entities, users)
    if not inspection:
        print("\n*** FATAL: Inspection submission failed ***")
        return False
    
    # 6. Verify Orange List
    orange_item = test_orange_list(entities, users)
    if not orange_item:
        print("\n*** FATAL: Orange List not populated ***")
        return False
    
    # 7. Verify notification to RO
    test_notification_to_ro(users)
    
    # 8. Mark working
    if not test_mark_working(orange_item, users):
        print("\n*** FATAL: Mark working failed ***")
        return False
    
    # 9. Approve working
    if not test_approve_working(orange_item, users):
        print("\n*** FATAL: Approve working failed ***")
        return False
    
    # 10. Verify asset back to working
    test_asset_back_to_working(entities)
    
    # 11. Test file upload
    test_file_upload()
    
    # 12. Test SIG inspection
    test_sig_inspection(entities, users)
    
    # 13. Test scheduling
    test_schedule(entities, users)
    
    # 14. Test role management
    test_role_management(users)
    
    # 15. Dashboard
    test_dashboard()
    
    print("\n" + "=" * 60)
    print(" POC TEST SUITE COMPLETE")
    print("=" * 60)
    return True


if __name__ == "__main__":
    run_all_tests()
