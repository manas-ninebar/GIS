# -*- coding: utf-8 -*-
"""Ingest RMI/TOK + GH + drive-test feeds into canonical inventory.json."""
from __future__ import annotations

import csv
import json
import struct
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
GIS = HERE.parent
ROOT = GIS.parent
RMI = GIS / "data" / "RMI Datasets-20260831T060855Z-1-002" / "RMI Datasets"
DEMO = RMI / "Demo Data"
SESS = DEMO / "Session MD Files"

CELL_PLAN = DEMO / "TOK_Cluster_CellPlan_flat.csv"
ANNOTATED = SESS / "sites_annotated.json"
ALARMS = SESS / "alarms_active.json"
FLAGS = SESS / "site_fault_flags.json"
ECGI_SAMPLE = ROOT / "data-layer" / "samples" / "geo" / "ecgi_master.csv"
CM_SAMPLE = ROOT / "data-layer" / "samples" / "geo" / "cm_export.csv"
SUKAYAT = DEMO / "Sukayat_s Demo Data" / "alarm-monitoring.csv"
GH_DIR = DEMO / "Sukayat_s Demo Data" / "GH Exports" / "Site Level"
GH_POLY = DEMO / "Sukayat_s Demo Data" / "GH Exports" / "Polygon Level"
GH_ONAIR = RMI / "4G onair flow" / "data" / "05.02.gh-rsrp-tiles.csv"
GH_SAMPLE = ROOT / "data-layer" / "samples" / "geo" / "groundhog_tiles.csv"
DT_SAMPLE = ROOT / "data-layer" / "samples" / "geo" / "drive_test.csv"
DT_RAW = RMI / "4G onair flow" / "data" / "09.05.dt-post-processing-raw-data.csv"

MCC_MNC = "440-11"
SITE_TYPE_ENUM = ["macro", "RIUD", "dash", "IDSC", "ODSC", "DAS"]
TECH_ENUM = ["4G", "5G Sub-6", "mmWave"]
STATUS_ENUM = ["on-air", "planned", "partial", "locked"]


def field(value, source: str, measured_at: str | None = None) -> dict:
    return {"value": value, "source": source, "measuredAt": measured_at}


def num(v):
    if v is None or v == "":
        return None
    try:
        if isinstance(v, (int, float)):
            return v
        s = str(v).strip().strip("'")
        return float(s) if "." in s else int(s)
    except ValueError:
        return None


def earfcn_to_band(earfcn) -> str:
    e = num(earfcn)
    if e is None:
        return "unknown"
    if 1200 <= e <= 1949:
        return "B3"
    if 0 <= e <= 599:
        return "B1"
    return f"EARFCN-{int(e)}"


def map_status(site_type: str, oos: bool, locked: bool = False) -> str:
    if locked:
        return "locked"
    st = (site_type or "").strip()
    if oos:
        return "partial"
    if st.lower().startswith("new"):
        return "planned"
    return "on-air"


def load_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def downsample(rows, cap: int):
    if len(rows) <= cap:
        return rows
    step = max(1, len(rows) // cap)
    return rows[::step][:cap]


# Greater Tokyo — keep GH/DT that is RAN-relevant, drop other continents.
TOKYO = (35.20, 36.00, 138.90, 140.10)


def in_tokyo(lat, lng) -> bool:
    return TOKYO[0] <= lat <= TOKYO[1] and TOKYO[2] <= lng <= TOKYO[3]


MAX_HEAVY = 2_000_000


def ingest_points_from_csv(path: Path, lat_k, lng_k, val_k, source: str, cap=MAX_HEAVY):
    """Stream Tokyo points. No downsample — deck.gl GPU + .bin is the scale path."""
    if not path.exists():
        return []
    out = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            lat, lng, val = num(row.get(lat_k)), num(row.get(lng_k)), num(row.get(val_k))
            if lat is None or lng is None or not in_tokyo(lat, lng):
                continue
            out.append((float(lng), float(lat), float(val if val is not None else -110.0)))
            if len(out) >= cap:
                break
    return out


def write_packed(path: Path, rows: list) -> dict:
    buf = bytearray(len(rows) * 12)
    west = south = 1e9
    east = north = -1e9
    for i, (lng, lat, rsrp) in enumerate(rows):
        struct.pack_into("<fff", buf, i * 12, lng, lat, rsrp)
        if lng < west:
            west = lng
        if lng > east:
            east = lng
        if lat < south:
            south = lat
        if lat > north:
            north = lat
    path.write_bytes(buf)
    return {
        "file": path.name,
        "n": len(rows),
        "bytes": len(buf),
        "format": "f32le lng,lat,rsrp",
        "bbox": None if not rows else [west, south, east, north],
        "engine": "deck.gl GPU",
    }


def ingest_sukayat(path: Path) -> dict:
    out = {
        "file": str(path.relative_to(GIS)) if path.exists() else None,
        "read": False, "rows_scanned": 0, "open_kanto": 0,
        "by_tech": {}, "by_equipment": {}, "by_prefecture": {},
        "note": "No coordinates — chat index only, not map pins.",
    }
    if not path.exists():
        out["note"] = "file missing"
        return out
    tech_c, eq_c, pref_c = Counter(), Counter(), Counter()
    open_kanto = scanned = 0
    try:
        with path.open(encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                scanned += 1
                if (row.get("Status") or "").strip().lower() != "open":
                    continue
                if "KANTO" not in (row.get("Region/Product") or "").upper():
                    continue
                open_kanto += 1
                tech_c[(row.get("Technology") or "unknown").strip()] += 1
                eq_c[(row.get("Equipment Type") or "unknown").strip()] += 1
                pref_c[(row.get("Prefecture/Cluster") or "unknown").strip()] += 1
        out.update({
            "read": True, "rows_scanned": scanned, "open_kanto": open_kanto,
            "by_tech": dict(tech_c.most_common(12)),
            "by_equipment": dict(eq_c.most_common(12)),
            "by_prefecture": dict(pref_c.most_common(12)),
        })
    except Exception as exc:
        out["note"] = f"parse failed: {exc}"
        out["rows_scanned"] = scanned
    return out


def build_site(sid, rows, ann, flag, alarms_by_site, oos_cells, check_time, locked=False):
    head = rows[0]
    lat, lng = num(head.get("lat")), num(head.get("long"))
    if lat is None or lng is None:
        return None, []
    site_type_raw = ((ann or {}).get("type") or head.get("siteType") or "Existing").strip()
    in_alarm = (flag.get("inAlarm") or "").upper() == "YES"
    site_oos = any((sid, r["cellName"]) in oos_cells for r in rows)
    status = map_status(site_type_raw, site_oos, locked=locked)
    bw_by_sec = {}
    for sec in (ann or {}).get("sectors") or []:
        name = sec.get("sector")
        key = {"A": "Sec1", "B": "Sec2", "C": "Sec3"}.get(name, name)
        bw_by_sec[key] = num(sec.get("beamwidth")) or 65
    site_alarms = []
    for a in alarms_by_site.get(sid, []):
        site_alarms.append({
            "alarm_id": a.get("alarmId"),
            "severity": (a.get("perceivedSeverity") or "").lower(),
            "problem": a.get("specificProblem"),
            "cell_name": a.get("cellName"),
            "service_affecting": (a.get("serviceAffecting") or "").upper() == "YES",
            "root_cause": (a.get("isRootCause") or "").upper() == "YES",
            "text": a.get("additionalText"),
            "event_time": a.get("eventTime"),
            "correlation_id": a.get("correlationId"),
            "mo_path": a.get("moPath"),
            "source": "tok-fm",
            "measuredAt": check_time,
        })
    site = {
        "site_id": sid,
        "sarf_id": field(head.get("siteName"), "cell-plan"),
        "enb_name": field(head.get("enbName"), "cell-plan"),
        "enb_id": field(int(num(head.get("enbId")) or 0), "cell-plan"),
        "site_type": field("macro", "cell-plan"),
        "site_type_plan": field(site_type_raw, "cell-plan"),
        "status": field(status, "cell-plan+fm" if site_oos or locked else "cell-plan", check_time if site_oos else None),
        "in_alarm": in_alarm,
        "morphology": field((ann or {}).get("morphology") or ("decommissioned" if locked else "urban"), "sites-annotated"),
        "lat": field(lat, "cell-plan"),
        "lng": field(lng, "cell-plan"),
        "height_m": field(num(head.get("height_m")), "cell-plan"),
        "ems_server": field(head.get("enbName"), "cell-plan"),
        "alarm_summary": {
            "count": int(flag.get("activeAlarmCount") or len(site_alarms)),
            "highest": (flag.get("highestSeverity") or "-"),
            "service_affecting": (flag.get("serviceAffecting") or "NO") == "YES",
            "root_cause": flag.get("rootCauseAlarm"),
            "cells_affected": flag.get("cellsAffected"),
            "source": "tok-fm",
            "measuredAt": check_time,
        },
        "alarms": site_alarms,
        "note": (ann or {}).get("note") or ("Decommissioned in ≥500 m plan" if locked else None),
    }
    cells = []
    for row in rows:
        cell_name = row["cellName"]
        cell_oos = (sid, cell_name) in oos_cells
        azi = num(row.get("antennaBearing"))
        if azi is None:
            continue
        enb_id = int(num(row.get("enbId")) or 0)
        cell_id_ran = int(num(row.get("cellId")) or 0)
        earfcn = num(row.get("earfcnDl"))
        cells.append({
            "cell_id": f"{sid}-{cell_name}",
            "site_id": sid,
            "cell_name": field(cell_name, "cell-plan"),
            "cu_cell_id": field(num(row.get("cuCellId")), "cell-plan"),
            "ran_cell_id": field(cell_id_ran, "cell-plan"),
            "ecgi": field(f"{MCC_MNC}-{enb_id}-{cell_id_ran}", "ecgi-envelope"),
            "sarf_id": field(row.get("siteName"), "cell-plan"),
            "pci": field(num(row.get("pci")), "cell-plan"),
            "tech": field("4G", "cell-plan"),
            "band": field(earfcn_to_band(earfcn), "cell-plan"),
            "earfcn_dl": field(earfcn, "cell-plan"),
            "earfcn_ul": field(num(row.get("earfcnUl")), "cell-plan"),
            "bandwidth": field(row.get("bandwidth"), "cell-plan"),
            "carrier": field(str(int(earfcn)) if earfcn is not None else None, "cell-plan"),
            "azimuth": field(float(azi), "cell-plan"),
            "hpbw": field(float(bw_by_sec.get(cell_name, 65)), "sites-annotated"),
            "mech_tilt": field(num(row.get("mechTilt")), "cell-plan"),
            "elec_tilt": field(num(row.get("retTilt")), "cell-plan"),
            "height_m": field(num(row.get("height_m")), "cell-plan"),
            "tx_power": field(num(row.get("maxTxPower")), "cell-plan"),
            "hotspot": field(row.get("servesHotspot"), "cell-plan"),
            "status": field(map_status(site_type_raw, cell_oos, locked), "cell-plan+fm" if cell_oos or locked else "cell-plan"),
            "site_type": field("macro", "cell-plan"),
            "in_alarm": cell_oos or (in_alarm and cell_name in str(flag.get("cellsAffected") or "")),
            "lat": field(lat, "cell-plan"),
            "lng": field(lng, "cell-plan"),
            "has_cm_azimuth": True,
        })
    return site, cells


def main() -> None:
    plan_rows = load_csv(CELL_PLAN)
    annotated = json.loads(ANNOTATED.read_text(encoding="utf-8"))
    alarms_pack = json.loads(ALARMS.read_text(encoding="utf-8"))
    flags_pack = json.loads(FLAGS.read_text(encoding="utf-8"))
    ecgi_sample = load_csv(ECGI_SAMPLE) if ECGI_SAMPLE.exists() else []
    cm_sample = load_csv(CM_SAMPLE) if CM_SAMPLE.exists() else []

    ann_by_id = {s["siteId"]: s for s in annotated}
    check_time = alarms_pack.get("checkTime") or flags_pack.get("checkTime")
    active = [a for a in alarms_pack.get("activeAlarms", []) if a.get("alarmState") == "ACTIVE"]
    alarms_by_site: dict[str, list] = defaultdict(list)
    oos_cells: set[tuple[str, str]] = set()
    for a in active:
        alarms_by_site[a.get("planSiteId")].append(a)
        if a.get("specificProblem") == "CellOutOfService" and a.get("cellName") not in (None, "", "-"):
            oos_cells.add((a.get("planSiteId"), a["cellName"]))
    flags_by_site = {rec.get("planSiteId"): rec for rec in (flags_pack.get("flags") or {}).values()}

    grouped: dict[str, list] = defaultdict(list)
    for row in plan_rows:
        grouped[row["planSiteId"]].append(row)

    sites_out, cells_out, decommissioned = [], [], []
    dropped_no_coords = 0
    for sid, rows in grouped.items():
        ann = ann_by_id.get(sid)
        locked = ann is None
        if locked:
            decommissioned.append(sid)
        site, cells = build_site(sid, rows, ann, flags_by_site.get(sid) or {}, alarms_by_site, oos_cells, check_time, locked=locked)
        if not site:
            dropped_no_coords += 1
            continue
        sites_out.append(site)
        cells_out.extend(cells)

    gh = []
    gh += ingest_points_from_csv(GH_SAMPLE, "lat", "lng", "rsrp", "gh-sample")
    gh += ingest_points_from_csv(GH_ONAIR, "Latitude", "Longitude", "Serving Cell Average RSRP (dBm)", "gh-onair")
    if GH_DIR.exists():
        for p in GH_DIR.glob("*_site.csv"):
            gh += ingest_points_from_csv(p, "Latitude", "Longitude", "Serving Cell Average RSRP (dBm)", f"gh:{p.stem}")
    if GH_POLY.exists():
        for p in GH_POLY.glob("*.csv"):
            gh += ingest_points_from_csv(p, "Latitude", "Longitude", "Serving Cell Average RSRP (dBm)", f"gh-poly:{p.stem}")
    gh = gh[:MAX_HEAVY]

    dt = ingest_points_from_csv(DT_SAMPLE, "lat", "lng", "rsrp", "dt-sample")
    dt += ingest_points_from_csv(DT_RAW, "lat(Layer3)", "lng(Layer3)", "RSRP(Layer3)", "dt-4g-onair")
    dt = dt[:MAX_HEAVY]

    gh_meta = write_packed(HERE / "gh.bin", gh)
    dt_meta = write_packed(HERE / "dt.bin", dt)

    sukayat = ingest_sukayat(SUKAYAT)

    inventory = {
        "generated_from": {
            "cell_plan": str(CELL_PLAN.relative_to(GIS)),
            "annotated": str(ANNOTATED.relative_to(GIS)),
            "alarms": str(ALARMS.relative_to(GIS)),
            "gh_points": gh_meta["n"],
            "dt_points": dt_meta["n"],
            "heavy": "deck.gl GPU + f32le .bin (not GeoJSON)",
        },
        "clock": {
            "t": check_time,
            "kind": "snapshot",
            "source": "tok-fm",
        },
        "crs": "EPSG:4326",
        "envelope": {
            "mcc_mnc": MCC_MNC,
            "ecgi_pattern": "440-11-{enbId}-{cellId}",
            "sample_rows_ignored": len(ecgi_sample),
            "cm_sample_rows_ignored": len(cm_sample),
        },
        "enums": {
            "tech": TECH_ENUM,
            "site_type": SITE_TYPE_ENUM,
            "status": STATUS_ENUM,
            "morphology": sorted({s["morphology"]["value"] for s in sites_out if s["morphology"]["value"]}),
            "band": sorted({c["band"]["value"] for c in cells_out}),
        },
        "notes": [
            "TOK cluster is 4G macro B3. Locked = decommissioned in the ≥500 m plan (still in cell-plan).",
            "Groundhog + drive-test are GPU layers (deck.gl) from gh.bin / dt.bin — not GeoJSON. Scale ceiling ~2e6 in this prototype; country scale uses PMTiles next.",
        ],
        "sites": sites_out,
        "cells": cells_out,
        "groundhog": gh_meta,
        "drive_test": dt_meta,
        "sukayat_index": sukayat,
    }
    report = {
        "plan_rows": len(plan_rows),
        "sites_out": len(sites_out),
        "cells_out": len(cells_out),
        "decommissioned_locked": decommissioned,
        "dropped_no_coords": dropped_no_coords,
        "planned": sum(1 for s in sites_out if s["status"]["value"] == "planned"),
        "partial": sum(1 for s in sites_out if s["status"]["value"] == "partial"),
        "locked": sum(1 for s in sites_out if s["status"]["value"] == "locked"),
        "sites_in_alarm": sum(1 for s in sites_out if s["in_alarm"]),
        "gh_points": gh_meta["n"],
        "gh_bytes": gh_meta["bytes"],
        "dt_points": dt_meta["n"],
        "dt_bytes": dt_meta["bytes"],
        "sukayat": {k: sukayat[k] for k in ("read", "rows_scanned", "open_kanto", "note")},
    }
    (HERE / "inventory.json").write_text(json.dumps(inventory), encoding="utf-8")
    (HERE / "ingest-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
