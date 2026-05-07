"""One-time backfill: sync `assets.defective_since` with the open
orange_list entry's `defective_since` for every asset where the two diverge.

Run this manually once after deploying the read-side fix:

    cd /app/backend && python -m scripts.backfill_defective_since

Idempotent — safe to run multiple times. Reports how many rows were updated.
"""
import asyncio
import sys
from datetime import datetime
from pathlib import Path

# Allow running as a script
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bson import ObjectId  # noqa: E402

from database import (  # noqa: E402
    assets_collection,
    orange_list_collection,
)


async def main():
    print(f"[{datetime.utcnow().isoformat()}] Starting defective_since backfill…")

    # Pre-fetch all open OL entries (one per asset, newest if duplicates)
    open_ol = await orange_list_collection.find(
        {"status": {"$ne": "resolved"}}
    ).to_list(50000)

    by_asset: dict = {}
    for rec in open_ol:
        existing = by_asset.get(rec["asset_id"])
        if not existing:
            by_asset[rec["asset_id"]] = rec
            continue
        # Prefer the most recently created
        prev_t = existing.get("created_at") or existing.get("defective_since") or datetime.min
        cur_t = rec.get("created_at") or rec.get("defective_since") or datetime.min
        if cur_t > prev_t:
            by_asset[rec["asset_id"]] = rec

    print(f"  found {len(by_asset)} assets with open OL entries")

    # Walk all non-working assets and reconcile
    assets = await assets_collection.find(
        {"status": {"$ne": "working"}}
    ).to_list(50000)
    print(f"  found {len(assets)} non-working assets")

    updated = 0
    cleared = 0
    skipped = 0
    for a in assets:
        aid = str(a["_id"])
        ol = by_asset.get(aid)
        target_ds = ol.get("defective_since") if ol else None
        current_ds = a.get("defective_since")
        if target_ds is None and current_ds is None:
            skipped += 1
            continue
        if target_ds is None and current_ds is not None:
            # Asset says defective but no open OL — this is an orphan asset
            # (status was never reset). Leave it alone unless explicitly broken.
            skipped += 1
            continue
        if current_ds == target_ds:
            skipped += 1
            continue
        # Update
        await assets_collection.update_one(
            {"_id": a["_id"]},
            {"$set": {"defective_since": target_ds}}
        )
        if current_ds is None:
            print(f"    +SET  {a.get('asset_number'):<24} status={a.get('status'):<18} → {target_ds}")
        else:
            print(f"    ~SYNC {a.get('asset_number'):<24} status={a.get('status'):<18} {current_ds} → {target_ds}")
        updated += 1

    # Also: assets that are status=working but still have defective_since set
    stale_working = await assets_collection.find(
        {"status": "working", "defective_since": {"$ne": None}}
    ).to_list(50000)
    for a in stale_working:
        await assets_collection.update_one(
            {"_id": a["_id"]},
            {"$set": {"defective_since": None}}
        )
        print(f"    -CLR  {a.get('asset_number'):<24} status=working (had stale defective_since)")
        cleared += 1

    print()
    print(f"[done] updated={updated}  cleared_stale={cleared}  unchanged={skipped}")


if __name__ == "__main__":
    asyncio.run(main())
