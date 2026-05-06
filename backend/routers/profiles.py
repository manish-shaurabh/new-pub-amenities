"""Profile endpoint — returns scoped station/location/asset view for a user."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from bson import ObjectId

from database import (
    serialize_doc,
    departments_collection, stations_collection, locations_collection,
    asset_types_collection, assets_collection, users_collection,
)
from models import UserRole
from helpers import _classify_health

router = APIRouter()


@router.get("/api/profiles/{user_id}")
async def get_user_profile(
    user_id: str,
    dept_id: Optional[str] = None,
    station_id: Optional[str] = None,
):
    """Profile for SUP / ASUP / RO: their assigned stations with scoped location+asset breakdown."""
    try:
        user = await users_collection.find_one({"_id": ObjectId(user_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user_id")
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    role = user.get("role")
    user_dept_id = user.get("department_id")
    assigned_stations = list(user.get("assigned_stations") or [])

    # Department name
    dept_name = None
    if user_dept_id:
        dept_doc = await departments_collection.find_one({"_id": ObjectId(user_dept_id)})
        dept_name = dept_doc["name"] if dept_doc else None

    # Reports-to
    reports_to = None
    if user.get("reports_to_id"):
        try:
            mgr = await users_collection.find_one({"_id": ObjectId(user["reports_to_id"])})
        except Exception:
            mgr = None
        if mgr:
            role_labels = {
                "superadmin": "Super Admin", "admin": "Admin",
                "reporting_officer": "Reporting Officer",
                "approving_supervisor": "Approving Supervisor",
                "supervisor": "Supervisor",
            }
            reports_to = {
                "name": mgr.get("name"),
                "role": role_labels.get(mgr.get("role"), mgr.get("role")),
                "employee_id": mgr.get("employee_id"),
            }

    # Determine asset-type filter
    # SUP / RO → fixed to their department
    # ASUP → optional dept_id param
    if role in (UserRole.SUPERVISOR.value, UserRole.REPORTING_OFFICER.value):
        effective_dept_id = user_dept_id
    else:
        effective_dept_id = dept_id  # ASUP optional filter

    type_ids_filter = None
    if effective_dept_id:
        type_docs = await asset_types_collection.find(
            {"department_id": effective_dept_id}, {"_id": 1}
        ).to_list(2000)
        type_ids_filter = [str(t["_id"]) for t in type_docs]

    # Station filter
    station_filter = assigned_stations
    if station_id and station_id in assigned_stations:
        station_filter = [station_id]

    stations_docs = []
    if station_filter:
        stations_docs = await stations_collection.find(
            {"_id": {"$in": [ObjectId(s) for s in station_filter]}}
        ).to_list(100)

    now = datetime.utcnow()
    total_assets = 0
    total_working = 0
    total_orange = 0
    total_red = 0

    # ASUP: collect all dept IDs across their stations for the filter dropdown
    available_departments = []
    if role == UserRole.APPROVING_SUPERVISOR.value:
        all_assets_q = await assets_collection.find(
            {"station_id": {"$in": assigned_stations}}, {"asset_type_id": 1}
        ).to_list(20000)
        all_tids = list({a.get("asset_type_id") for a in all_assets_q if a.get("asset_type_id")})
        if all_tids:
            all_tdocs = await asset_types_collection.find(
                {"_id": {"$in": [ObjectId(t) for t in all_tids]}}, {"department_id": 1}
            ).to_list(1000)
            all_dids = list({t.get("department_id") for t in all_tdocs if t.get("department_id")})
            if all_dids:
                ddocs = await departments_collection.find(
                    {"_id": {"$in": [ObjectId(d) for d in all_dids]}}
                ).to_list(100)
                available_departments = [
                    {"dept_id": str(d["_id"]), "dept_name": d["name"]} for d in ddocs
                ]
                available_departments.sort(key=lambda x: x["dept_name"])

    stations_out = []
    for st in stations_docs:
        st_id = str(st["_id"])

        locations = await locations_collection.find({"station_id": st_id}).to_list(100)

        asset_query: dict = {"station_id": st_id}
        if type_ids_filter is not None:
            asset_query["asset_type_id"] = {"$in": type_ids_filter}
        assets_in_st = await assets_collection.find(asset_query).to_list(5000)

        if not assets_in_st:
            stations_out.append({
                "station_id": st_id,
                "station_name": st.get("name"),
                "code": st.get("code"),
                "asset_count": 0,
                "working": 0, "orange": 0, "red": 0,
                "pct_functional": 100.0,
                "locations": [],
                "departments": [],
            })
            continue

        # Batch type lookups
        a_type_ids = list({a.get("asset_type_id") for a in assets_in_st if a.get("asset_type_id")})
        types_map: dict = {}
        types_dept_map: dict = {}
        if a_type_ids:
            td = await asset_types_collection.find(
                {"_id": {"$in": [ObjectId(t) for t in a_type_ids]}}
            ).to_list(1000)
            types_map = {str(t["_id"]): t["name"] for t in td}
            types_dept_map = {str(t["_id"]): t.get("department_id") for t in td}

        # Dept names
        dept_ids_in_st = list({v for v in types_dept_map.values() if v})
        dept_names_map: dict = {}
        if dept_ids_in_st:
            ddocs = await departments_collection.find(
                {"_id": {"$in": [ObjectId(d) for d in dept_ids_in_st]}}
            ).to_list(100)
            dept_names_map = {str(d["_id"]): d["name"] for d in ddocs}

        # Supervisor lookup per dept at this station (for ASUP/RO context)
        supervisor_by_dept: dict = {}
        if role in (UserRole.APPROVING_SUPERVISOR.value, UserRole.REPORTING_OFFICER.value):
            for d_id in dept_ids_in_st:
                sup = await users_collection.find_one({
                    "role": UserRole.SUPERVISOR.value,
                    "department_id": d_id,
                    "assigned_stations": st_id,
                    "is_active": True,
                }, {"name": 1})
                if sup:
                    supervisor_by_dept[d_id] = sup.get("name")

        st_working = 0
        st_orange = 0
        st_red = 0

        # Group by dept (ASUP) or location (SUP/RO)
        by_dept: dict = {}
        by_loc: dict = {}

        for asset in assets_in_st:
            cls = _classify_health(asset, now)
            if cls == "working":
                st_working += 1
                total_working += 1
            elif cls == "orange":
                st_orange += 1
                total_orange += 1
            else:
                st_red += 1
                total_red += 1

            loc_id = asset.get("location_id") or "unknown"
            type_id = asset.get("asset_type_id")
            a_dept_id = types_dept_map.get(type_id)
            ds = asset.get("defective_since")
            if isinstance(ds, datetime):
                ds = ds.isoformat()

            asset_item = {
                "asset_id": str(asset["_id"]),
                "asset_number": asset.get("asset_number"),
                "type_name": types_map.get(type_id, "Unknown"),
                "type_id": type_id,
                "dept_id": a_dept_id,
                "dept_name": dept_names_map.get(a_dept_id) if a_dept_id else None,
                "status": asset.get("status", "working"),
                "health_class": cls,
                "defective_since": ds,
                "supervisor_name": supervisor_by_dept.get(a_dept_id) if a_dept_id else None,
            }

            if role == UserRole.APPROVING_SUPERVISOR.value:
                by_dept.setdefault(a_dept_id or "unknown", {}).setdefault(loc_id, []).append(asset_item)
            else:
                by_loc.setdefault(loc_id, []).append(asset_item)

        total_assets += len(assets_in_st)

        loc_lookup = {str(loc["_id"]): loc.get("name") for loc in locations}

        if role == UserRole.APPROVING_SUPERVISOR.value:
            depts_out = []
            for d_id, loc_dict in by_dept.items():
                locs_list = []
                for l_id, a_list in loc_dict.items():
                    locs_list.append({
                        "location_id": l_id,
                        "location_name": loc_lookup.get(l_id, "Unknown Location"),
                        "asset_count": len(a_list),
                        "assets": sorted(a_list, key=lambda x: x["asset_number"] or ""),
                    })
                locs_list.sort(key=lambda x: x["location_name"])
                d_count = sum(len(v) for v in loc_dict.values())
                depts_out.append({
                    "dept_id": d_id,
                    "dept_name": dept_names_map.get(d_id, "Unknown Dept"),
                    "supervisor_name": supervisor_by_dept.get(d_id),
                    "asset_count": d_count,
                    "locations": locs_list,
                })
            depts_out.sort(key=lambda x: x["dept_name"])
            stations_out.append({
                "station_id": st_id,
                "station_name": st.get("name"),
                "code": st.get("code"),
                "asset_count": len(assets_in_st),
                "working": st_working, "orange": st_orange, "red": st_red,
                "pct_functional": round(st_working / len(assets_in_st) * 100, 1) if assets_in_st else 100.0,
                "departments": depts_out,
                "locations": [],
            })
        else:
            locs_out = []
            for l_id, a_list in by_loc.items():
                locs_out.append({
                    "location_id": l_id,
                    "location_name": loc_lookup.get(l_id, "Unknown Location"),
                    "asset_count": len(a_list),
                    "assets": sorted(a_list, key=lambda x: x["asset_number"] or ""),
                })
            locs_out.sort(key=lambda x: x["location_name"])
            stations_out.append({
                "station_id": st_id,
                "station_name": st.get("name"),
                "code": st.get("code"),
                "asset_count": len(assets_in_st),
                "working": st_working, "orange": st_orange, "red": st_red,
                "pct_functional": round(st_working / len(assets_in_st) * 100, 1) if assets_in_st else 100.0,
                "locations": locs_out,
                "departments": [],
            })

    stations_out.sort(key=lambda s: s["station_name"])

    # RO: fetch supervisors reporting to them
    my_supervisors = []
    if role == UserRole.REPORTING_OFFICER.value:
        sups = await users_collection.find(
            {"role": UserRole.SUPERVISOR.value, "reports_to_id": user_id, "is_active": True}
        ).to_list(100)
        for sup in sups:
            sup_stations = list(sup.get("assigned_stations") or [])
            sup_dept = sup.get("department_id")
            sup_asset_count = 0
            sup_defective = 0
            if sup_stations and sup_dept:
                _std = await asset_types_collection.find({"department_id": sup_dept}, {"_id": 1}).to_list(1000)
                _stids = [str(t["_id"]) for t in _std]
                if _stids:
                    sup_assets = await assets_collection.find(
                        {"station_id": {"$in": sup_stations}, "asset_type_id": {"$in": _stids}},
                        {"status": 1}
                    ).to_list(5000)
                    sup_asset_count = len(sup_assets)
                    sup_defective = sum(1 for a in sup_assets if a.get("status") != "working")
            sup_snames = []
            if sup_stations:
                s_docs = await stations_collection.find(
                    {"_id": {"$in": [ObjectId(s) for s in sup_stations]}}, {"name": 1}
                ).to_list(50)
                sup_snames = [s.get("name") for s in s_docs]
            my_supervisors.append({
                "user_id": str(sup["_id"]),
                "name": sup.get("name"),
                "employee_id": sup.get("employee_id"),
                "asset_count": sup_asset_count,
                "defective_count": sup_defective,
                "station_names": sup_snames,
            })

    return {
        "user": {
            "_id": user_id,
            "name": user.get("name"),
            "employee_id": user.get("employee_id"),
            "role": role,
            "department_id": user_dept_id,
            "department_name": dept_name,
            "email": user.get("email"),
            "phone": user.get("phone"),
            "reports_to": reports_to,
            "assigned_stations": assigned_stations,
        },
        "stats": {
            "total_assets": total_assets,
            "working": total_working,
            "orange": total_orange,
            "red": total_red,
            "total_stations": len(stations_out),
        },
        "stations": stations_out,
        "my_supervisors": my_supervisors,
        "available_departments": available_departments,
    }
