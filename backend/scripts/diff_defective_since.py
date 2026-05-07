"""
Read-only drift detector — finds assets where asset.defective_since differs from
the canonical OL.defective_since. Outputs a JSON report and prints summary.
Does NOT modify anything.

Usage:
    python /app/backend/scripts/diff_defective_since.py
"""
import os, json
from pymongo import MongoClient
from datetime import datetime

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "railway_asset_inspection")
REPORT_PATH = "/app/test_reports/defective_since_drift.json"


def _norm(dt):
    if dt is None:
        return None
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "").replace("+00:00", ""))
        except Exception:
            return str(dt)
    if hasattr(dt, "tzinfo") and dt.tzinfo is not None:
        dt = dt.replace(tzinfo=None)
    return dt


def main():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]

    drifts = []
    for a in db.assets.find({"status": {"$in": ["defective", "pending_approval"]}}):
        aid = str(a["_id"])
        ol = db.orange_list.find_one({"asset_id": aid, "status": {"$ne": "resolved"}})
        if not ol:
            drifts.append({
                "asset_id": aid, "asset_number": a.get("asset_number"),
                "issue": "asset has defective/pending status but no open OL",
                "asset_status": a.get("status"),
                "asset_defective_since": str(a.get("defective_since")),
            })
            continue
        a_ds = _norm(a.get("defective_since"))
        o_ds = _norm(ol.get("defective_since"))
        if a_ds != o_ds:
            drifts.append({
                "asset_id": aid, "asset_number": a.get("asset_number"),
                "issue": "asset.defective_since != OL.defective_since",
                "asset_defective_since": str(a_ds),
                "ol_defective_since": str(o_ds),
                "ol_id": str(ol["_id"]),
            })

    print(f"Drift cases found: {len(drifts)}")
    for d in drifts[:20]:
        print(f"  - {d['asset_number']:15s} | {d['issue']}")
        if d.get("asset_defective_since"):
            print(f"     asset = {d['asset_defective_since']}  vs  OL = {d.get('ol_defective_since','-')}")
    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    with open(REPORT_PATH, "w") as f:
        json.dump({"drift_count": len(drifts), "drifts": drifts}, f, indent=2)
    print(f"\nReport: {REPORT_PATH}")
    return 0 if not drifts else 1


if __name__ == "__main__":
    raise SystemExit(main())
