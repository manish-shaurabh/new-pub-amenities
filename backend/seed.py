"""
Seed script - Creates initial Superadmin user and basic data for the Railway Asset Inspection System
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

from pymongo import MongoClient
import bcrypt
from datetime import datetime

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "railway_asset_inspection")

client = MongoClient(MONGO_URL)
db = client[DB_NAME]

def seed():
    # Check if superadmin already exists
    existing = db.users.find_one({"employee_id": "SA001"})
    if existing:
        print("Seed data already exists. Skipping...")
        return

    print("Seeding initial data...")

    # Create Superadmin
    hashed = bcrypt.hashpw("admin123".encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    db.users.insert_one({
        "employee_id": "SA001",
        "name": "Super Admin",
        "role": "superadmin",
        "department_id": None,
        "assigned_stations": [],
        "password": hashed,
        "email": "superadmin@railway.gov.in",
        "phone": "",
        "is_active": True,
        "created_at": datetime.utcnow()
    })
    print("  Created Superadmin (ID: SA001, Password: admin123)")

    # Create sample department
    dept_result = db.departments.insert_one({
        "name": "Electrical",
        "code": "ELEC",
        "description": "Electrical maintenance department",
        "created_at": datetime.utcnow()
    })
    dept_id = str(dept_result.inserted_id)
    print(f"  Created Department: Electrical ({dept_id})")

    # Seed core departments (idempotent — only insert if not present)
    for d in [
        {"name": "S&T", "code": "S&T", "description": "Signal & Telecommunications"},
        {"name": "Civil", "code": "CIVIL", "description": "Civil engineering & infrastructure"},
        {"name": "Mechanical", "code": "MECH", "description": "Mechanical maintenance"},
        {"name": "Commercial", "code": "COMM", "description": "Commercial operations (umbrella)"},
    ]:
        if not db.departments.find_one({"name": {"$regex": f"^{d['name']}$", "$options": "i"}}):
            db.departments.insert_one({**d, "created_at": datetime.utcnow()})
            print(f"  Seeded department: {d['name']}")

    # Create sample station
    station_result = db.stations.insert_one({
        "name": "Mumbai Central",
        "code": "MMCT",
        "zone": "Western",
        "division": "Mumbai",
        "created_at": datetime.utcnow()
    })
    station_id = str(station_result.inserted_id)
    print(f"  Created Station: Mumbai Central ({station_id})")

    # Create sample locations
    loc_ids = []
    for loc_name in ["Platform 1", "Platform 2 & 3", "Waiting Hall", "Booking Office", "Foot Over Bridge"]:
        loc_result = db.locations.insert_one({
            "name": loc_name,
            "station_id": station_id,
            "description": f"{loc_name} at Mumbai Central",
            "created_at": datetime.utcnow()
        })
        loc_ids.append(str(loc_result.inserted_id))
    print(f"  Created {len(loc_ids)} Locations")

    # Create asset type with checklist
    at_result = db.asset_types.insert_one({
        "name": "Ceiling Fan",
        "department_id": dept_id,
        "checklist": [
            {"name": "Blade Condition", "description": "Check if blades are intact and clean"},
            {"name": "Motor Sound", "description": "Listen for unusual sounds"},
            {"name": "Speed Regulation", "description": "Verify all speed settings work"},
            {"name": "Mounting", "description": "Check mounting is secure"}
        ],
        "description": "Ceiling fans in passenger areas",
        "created_at": datetime.utcnow()
    })
    at_id = str(at_result.inserted_id)
    print(f"  Created Asset Type: Ceiling Fan ({at_id})")

    # Create sample assets
    for i, loc_id in enumerate(loc_ids[:3]):
        db.assets.insert_one({
            "asset_type_id": at_id,
            "station_id": station_id,
            "location_id": loc_id,
            "asset_number": f"FAN-{i+1:03d}",
            "status": "working",
            "description": f"Ceiling fan #{i+1}",
            "schedule_frequency": "weekly",
            "last_inspected": None,
            "next_due": None,
            "created_at": datetime.utcnow()
        })
    print("  Created 3 sample assets")

    print("\n✓ Seed complete!")
    print("\n  Login credentials:")
    print("  Employee ID: SA001")
    print("  Password: admin123")


if __name__ == "__main__":
    seed()
