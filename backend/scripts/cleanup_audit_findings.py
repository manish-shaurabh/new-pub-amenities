"""
=============================================================================
ONE-OFF CLEANUP — fix the 4 dirty records surfaced by audit_list_consistency
=============================================================================

Findings being cleaned up:
  1. Asset `TEST_ASSET_*` with status='needs_repair' (legacy/unknown status):
     → if it has an open OL[defective] → set asset.status='defective' (canonical)
     → otherwise set asset.status='working'
  2. 3 resolved OL entries pointing to deleted assets → delete them
     (they're already invisible to dashboards; just removes clutter)

Run idempotently. Safe to re-run.
=============================================================================
"""

import os
from pymongo import MongoClient
from bson import ObjectId

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "railway_asset_inspection")

client = MongoClient(MONGO_URL)
db = client[DB_NAME]

print(f"Cleanup against {DB_NAME}\n")

# ── 1. Fix assets with non-canonical status ────────────────────────────────
VALID_STATUSES = {"working", "defective", "pending_approval"}

bad_assets = list(db.assets.find({"status": {"$nin": list(VALID_STATUSES)}}))
print(f"[1] Assets with non-canonical status: {len(bad_assets)}")
fixed_status = 0
for a in bad_assets:
    aid = str(a["_id"])
    open_def_ol = db.orange_list.find_one({
        "asset_id": aid, "status": "defective"
    })
    open_pending_ol = db.orange_list.find_one({
        "asset_id": aid, "status": "pending_approval"
    })
    if open_pending_ol:
        new_status = "pending_approval"
    elif open_def_ol:
        new_status = "defective"
    else:
        new_status = "working"
    db.assets.update_one(
        {"_id": a["_id"]},
        {"$set": {"status": new_status}}
    )
    print(f"  → asset {a.get('asset_number')} (id={aid[:12]}) "
          f"status='{a.get('status')}' → '{new_status}'")
    fixed_status += 1

# ── 2. Delete OL entries pointing to non-existent assets ───────────────────
all_asset_ids = {str(a["_id"]) for a in db.assets.find({}, {"_id": 1})}
all_ol = list(db.orange_list.find({}, {"_id": 1, "asset_id": 1, "status": 1}))
orphan_ol = [o for o in all_ol if o.get("asset_id") not in all_asset_ids]
print(f"\n[2] Orphan OL entries (asset deleted): {len(orphan_ol)}")
for ol in orphan_ol:
    db.orange_list.delete_one({"_id": ol["_id"]})
    # Also delete any remarks referencing this OL entry
    rm_del = db.remarks.delete_many({"orange_list_id": str(ol["_id"])})
    print(f"  → deleted OL._id={str(ol['_id'])[:12]} status={ol.get('status')} "
          f"(also {rm_del.deleted_count} remarks)")

print(f"\nDone. Fixed {fixed_status} asset statuses, removed {len(orphan_ol)} orphan OL entries.")
