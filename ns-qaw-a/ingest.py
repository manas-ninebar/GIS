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
DATA = GIS / "data"

MCC_MNC = "440-11"
SITE_TYPE_ENUM = ["macro", "RIUD", "dash", "IDSC", "ODSC", "DAS"]
TECH_ENUM = ["4G", "5G Sub-6", "mmWave"]
STATUS_ENUM = ["on-air", "planned", "partial", "locked"]

# Greater Tokyo — keep GH/DT/VOC that is RAN-relevant, drop out-of-scope geography.
TOKYO = (35.20, 36.00, 138.90, 140.10)
MAX_HEAVY = 2_000_000
MAX_VOC_POINTS = 300_000
MAX_REL_ROWS = 500_000


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


def in_tokyo(lat, lng) -> bool:
    return TOKYO[0] <= lat <= TOKYO[1] and TOKYO[2] <= lng <= TOKYO[3]


def rel(path: Path | None) -> str | None:
    if not path:
        return None
    try:
        return str(path.relative_to(GIS))
    except ValueError:
        return str(path)


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


def iter_csv_rows(path: Path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f)


def find_rmi_root() -> Path:
    preferred = DATA / "RMI Datasets-20260831T060855Z-1-002" / "RMI Datasets"
    if preferred.exists():
        return preferred
    candidates = [p / "RMI Datasets" for p in DATA.glob("RMI Datasets*") if (p / "RMI Datasets").exists()]
    if not candidates:
        raise FileNotFoundError("No RMI Datasets root found under GIS/data")
    return sorted(candidates, key=lambda p: str(p), reverse=True)[0]


def first_existing(candidates: list[Path]) -> Path | None:
    for p in candidates:
        if p.exists():
            return p
    return None


def walk_csv(root: Path) -> list[Path]:
    return [p for p in root.rglob("*.csv") if p.is_file()]


def ingest_points_from_csv(path: Path, lat_k: str, lng_k: str, val_k: str, cap=MAX_HEAVY):
    """Stream Tokyo points. No downsample — deck.gl GPU + .bin is the scale path."""
    if not path.exists():
        return []
    out = []
    for row in iter_csv_rows(path):
        lat, lng, val = num(row.get(lat_k)), num(row.get(lng_k)), num(row.get(val_k))
        if lat is None or lng is None or not in_tokyo(lat, lng):
            continue
        out.append((float(lng), float(lat), float(val if val is not None else -110.0)))
        if len(out) >= cap:
            break
    return out


def build_dt_paths(paths: list[Path], max_paths: int = 300, max_points_per_path: int = 5000) -> dict:
    """Build GeoJSON line routes from DT CSV traces."""
    features = []
    total_points = 0
    for path in paths[:max_paths]:
        coords = []
        rsrp_sum = 0.0
        rsrp_n = 0
        for row in iter_csv_rows(path):
            lat = num(row.get("lat(Layer3)"))
            lng = num(row.get("lng(Layer3)"))
            if lat is None or lng is None or not in_tokyo(float(lat), float(lng)):
                continue
            coords.append([float(lng), float(lat)])
            v = num(row.get("RSRP(Layer3)"))
            if v is not None:
                rsrp_sum += float(v)
                rsrp_n += 1
            if len(coords) >= max_points_per_path:
                break
        if len(coords) < 2:
            continue
        # Trim GPS jitter by skipping repeated consecutive points.
        compact = [coords[0]]
        for p in coords[1:]:
            if p != compact[-1]:
                compact.append(p)
        if len(compact) > 2000:
            step = max(1, len(compact) // 2000)
            compact = compact[::step]
            if compact[-1] != coords[-1]:
                compact.append(coords[-1])
        total_points += len(compact)
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "route_id": path.stem,
                    "source_file": rel(path),
                    "points": len(compact),
                    "avg_rsrp": round(rsrp_sum / rsrp_n, 2) if rsrp_n else None,
                },
                "geometry": {"type": "LineString", "coordinates": compact},
            }
        )
    return {"type": "FeatureCollection", "features": features, "_meta": {"n_routes": len(features), "n_points": total_points}}


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
        "file": rel(path) if path.exists() else None,
        "read": False,
        "rows_scanned": 0,
        "open_kanto": 0,
        "by_tech": {},
        "by_equipment": {},
        "by_prefecture": {},
        "note": "No coordinates — chat index only, not map pins.",
    }
    if not path.exists():
        out["note"] = "file missing"
        return out
    tech_c, eq_c, pref_c = Counter(), Counter(), Counter()
    open_kanto = scanned = 0
    try:
        for row in iter_csv_rows(path):
            scanned += 1
            if (row.get("Status") or "").strip().lower() != "open":
                continue
            if "KANTO" not in (row.get("Region/Product") or "").upper():
                continue
            open_kanto += 1
            tech_c[(row.get("Technology") or "unknown").strip()] += 1
            eq_c[(row.get("Equipment Type") or "unknown").strip()] += 1
            pref_c[(row.get("Prefecture/Cluster") or "unknown").strip()] += 1
        out.update(
            {
                "read": True,
                "rows_scanned": scanned,
                "open_kanto": open_kanto,
                "by_tech": dict(tech_c.most_common(12)),
                "by_equipment": dict(eq_c.most_common(12)),
                "by_prefecture": dict(pref_c.most_common(12)),
            }
        )
    except Exception as exc:
        out["note"] = f"parse failed: {exc}"
        out["rows_scanned"] = scanned
    return out


def ingest_voc(path: Path) -> tuple[dict, list[tuple[float, float, float]]]:
    meta = {
        "file": rel(path) if path.exists() else None,
        "n": 0,
        "tokyo_n": 0,
        "bbox": None,
        "sample_limit": MAX_VOC_POINTS,
    }
    if not path.exists():
        return meta, []

    out = []
    west = south = 1e9
    east = north = -1e9
    total = tokyo_n = 0

    for row in iter_csv_rows(path):
        total += 1
        lat = num(row.get("緯度"))
        lng = num(row.get("経度"))
        if lat is None or lng is None:
            continue
        if in_tokyo(float(lat), float(lng)):
            tokyo_n += 1
        if len(out) >= MAX_VOC_POINTS:
            continue
        out.append((float(lng), float(lat), -100.0))
        west = min(west, float(lng))
        east = max(east, float(lng))
        south = min(south, float(lat))
        north = max(north, float(lat))

    meta["n"] = total
    meta["tokyo_n"] = tokyo_n
    meta["bbox"] = None if not out else [west, south, east, north]
    return meta, out


def ingest_relations(paths: list[Path]) -> dict:
    by_file = []
    totals = Counter()
    rows_seen = 0
    for path in paths:
        if not path.exists():
            continue
        file_rows = 0
        attempts = 0
        failures = 0
        for row in iter_csv_rows(path):
            file_rows += 1
            rows_seen += 1
            attempts += int(num(row.get("Intra Frequency Attempt")) or num(row.get("Inter Frequency Attempt")) or 0)
            failures += int(
                num(row.get("Intra Frequency Failure Count")) or num(row.get("Inter Frequency Failure Count")) or 0
            )
            if rows_seen >= MAX_REL_ROWS:
                break
        totals["attempts"] += attempts
        totals["failures"] += failures
        by_file.append({"file": rel(path), "rows": file_rows, "attempts": attempts, "failures": failures})
        if rows_seen >= MAX_REL_ROWS:
            break
    return {
        "rows_scanned": rows_seen,
        "attempts": totals["attempts"],
        "failures": totals["failures"],
        "files": by_file,
        "truncated": rows_seen >= MAX_REL_ROWS,
    }


def ingest_alarm_feed(path: Path) -> dict:
    out = {"file": rel(path) if path.exists() else None, "rows_scanned": 0, "open": 0, "service_affected": 0, "by_tech": {}}
    if not path.exists():
        return out
    tech = Counter()
    for row in iter_csv_rows(path):
        out["rows_scanned"] += 1
        status = (row.get("Status") or "").strip().lower()
        if status == "open":
            out["open"] += 1
        if (row.get("Service Affected") or "").strip().lower() == "yes":
            out["service_affected"] += 1
        tech[(row.get("Technology") or "unknown").strip()] += 1
    out["by_tech"] = dict(tech.most_common(8))
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
        site_alarms.append(
            {
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
            }
        )
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
        "on_air_date": field(None, "absent"),
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
        cells.append(
            {
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
            }
        )
    return site, cells


def main() -> None:
    rmi = find_rmi_root()
    demo = rmi / "Demo Data"
    sess = demo / "Session MD Files"
    all_csv = walk_csv(rmi)

    cell_plan = first_existing([demo / "TOK_Cluster_CellPlan_flat.csv"])
    annotated_f = first_existing([sess / "sites_annotated.json"])
    alarms_f = first_existing([sess / "alarms_active.json"])
    flags_f = first_existing([sess / "site_fault_flags.json"])
    ecgi_sample = ROOT / "data-layer" / "samples" / "geo" / "ecgi_master.csv"
    cm_sample = ROOT / "data-layer" / "samples" / "geo" / "cm_export.csv"
    dt_sample = ROOT / "data-layer" / "samples" / "geo" / "drive_test.csv"
    gh_sample = ROOT / "data-layer" / "samples" / "geo" / "groundhog_tiles.csv"

    if not all([cell_plan, annotated_f, alarms_f, flags_f]):
        missing = [name for name, p in {"cell_plan": cell_plan, "annotated": annotated_f, "alarms": alarms_f, "flags": flags_f}.items() if p is None]
        raise FileNotFoundError(f"Missing required TOK base files: {', '.join(missing)}")

    plan_rows = load_csv(cell_plan)
    annotated = json.loads(annotated_f.read_text(encoding="utf-8"))
    alarms_pack = json.loads(alarms_f.read_text(encoding="utf-8"))
    flags_pack = json.loads(flags_f.read_text(encoding="utf-8"))
    ecgi_rows = load_csv(ecgi_sample) if ecgi_sample.exists() else []
    cm_rows = load_csv(cm_sample) if cm_sample.exists() else []

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

    gh_files = [
        p
        for p in all_csv
        if ("gh" in p.name.lower() and "tiles" in p.name.lower())
        or ("gh exports" in str(p).lower() and p.suffix.lower() == ".csv")
        or p.name.lower() in {"05.02.gh-rsrp-tiles.csv", "05.02.gh-rsrp-rsrq-tiles.csv", "gh_5g_coverage_tiles.csv"}
    ]
    gh_files = sorted({p.resolve() for p in gh_files})

    gh = ingest_points_from_csv(gh_sample, "lat", "lng", "rsrp") if gh_sample.exists() else []
    for p in gh_files:
        gh += ingest_points_from_csv(p, "Latitude", "Longitude", "Serving Cell Average RSRP (dBm)")
    gh = gh[:MAX_HEAVY]

    dt_files = [
        p
        for p in all_csv
        if p.name.lower().endswith(".csv")
        and (
            "dt-post-processing-raw-data" in p.name.lower()
            or "_site_drive_ftp_dl_" in p.name.lower()
            or ("dt_" in p.name.lower() and "csv_files" in str(p).lower())
        )
    ]
    dt_files = sorted({p.resolve() for p in dt_files})

    dt = ingest_points_from_csv(dt_sample, "lat", "lng", "rsrp") if dt_sample.exists() else []
    for p in dt_files:
        dt += ingest_points_from_csv(p, "lat(Layer3)", "lng(Layer3)", "RSRP(Layer3)")
    dt = dt[:MAX_HEAVY]
    dt_paths_fc = build_dt_paths(dt_files)
    dt_paths_file = HERE / "dt_paths.geojson"
    dt_paths_file.write_text(json.dumps({"type": "FeatureCollection", "features": dt_paths_fc["features"]}), encoding="utf-8")

    voc_file = first_existing([p for p in all_csv if p.name.lower().startswith("voc_") and p.name.lower().endswith(".csv")])
    voc_meta, _voc_points = ingest_voc(voc_file) if voc_file else ({"file": None, "n": 0, "tokyo_n": 0, "bbox": None, "sample_limit": MAX_VOC_POINTS}, [])

    relation_files = [p for p in all_csv if p.name.lower() in {"05.04.gh-intra-freq-ho-source-target.csv", "05.05.gh-inter-freq-ho-source-target.csv"}]
    relations = ingest_relations(sorted(relation_files))

    alarm_file = first_existing(
        [
            p
            for p in all_csv
            if p.name.lower() in {"alarm-monitoring.csv", "alarm-monitoring_open_closed.csv", "01.alarm-monitoring.csv"}
        ]
    )
    alarm_index = ingest_alarm_feed(alarm_file) if alarm_file else {"file": None, "rows_scanned": 0, "open": 0, "service_affected": 0, "by_tech": {}}

    sukayat_file = first_existing([p for p in all_csv if p.name.lower() == "alarm-monitoring.csv"])
    sukayat = ingest_sukayat(sukayat_file) if sukayat_file else ingest_sukayat(Path("__missing__.csv"))

    gh_meta = write_packed(HERE / "gh.bin", gh)
    dt_meta = write_packed(HERE / "dt.bin", dt)

    inventory = {
        "generated_from": {
            "rmi_root": rel(rmi),
            "cell_plan": rel(cell_plan),
            "annotated": rel(annotated_f),
            "alarms": rel(alarms_f),
            "gh_points": gh_meta["n"],
            "dt_points": dt_meta["n"],
            "gh_sources": [rel(p) for p in gh_files],
            "dt_sources": [rel(p) for p in dt_files],
            "dt_paths_file": dt_paths_file.name,
            "voc_source": voc_meta.get("file"),
            "relations_sources": [rel(p) for p in relation_files],
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
            "ecgi_source": "envelope — sample ecgi_master.csv IDs (TKY-*) do not match TOK cluster",
            "sample_rows_ignored": len(ecgi_rows),
            "cm_sample_rows_ignored": len(cm_rows),
            "on_air_dates": 0,
            "on_air_date_source": "absent — cell-plan has no on-air column in current ingest files",
        },
        "enums": {
            "tech": TECH_ENUM,
            "site_type": SITE_TYPE_ENUM,
            "status": STATUS_ENUM,
            "morphology": sorted({s["morphology"]["value"] for s in sites_out if s["morphology"]["value"]}),
            "band": sorted({c["band"]["value"] for c in cells_out}),
        },
        "notes": [
            "TOK cluster is 4G macro B3. Locked = decommissioned in the >=500 m plan (still in cell-plan).",
            "Groundhog + drive-test are GPU layers (deck.gl) from gh.bin / dt.bin.",
            "VOC, relations, and alarm indexes are ingested as inventory metadata for v2+ workflows.",
        ],
        "sites": sites_out,
        "cells": cells_out,
        "groundhog": gh_meta,
        "drive_test": dt_meta,
        "drive_test_paths": {
            "file": dt_paths_file.name,
            "n_routes": dt_paths_fc["_meta"]["n_routes"],
            "n_points": dt_paths_fc["_meta"]["n_points"],
        },
        "voc": voc_meta,
        "relations": relations,
        "alarm_index": alarm_index,
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
        "gh_sources": len(gh_files),
        "dt_points": dt_meta["n"],
        "dt_bytes": dt_meta["bytes"],
        "dt_sources": len(dt_files),
        "dt_routes": dt_paths_fc["_meta"]["n_routes"],
        "dt_route_points": dt_paths_fc["_meta"]["n_points"],
        "voc_rows": voc_meta.get("n", 0),
        "voc_tokyo": voc_meta.get("tokyo_n", 0),
        "relation_rows": relations.get("rows_scanned", 0),
        "alarm_rows": alarm_index.get("rows_scanned", 0),
        "sukayat": {k: sukayat[k] for k in ("read", "rows_scanned", "open_kanto", "note")},
    }
    (HERE / "inventory.json").write_text(json.dumps(inventory), encoding="utf-8")
    (HERE / "ingest-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
