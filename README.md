# NineOne · Geo

Standalone GIS prototype for RF engineers on Japan’s RAN. This folder is **not** the NineOne console app. The product lives in `ns-qaw-a/`. The briefing that defines it is `mapsheetzero.html`.

**Instrument, not catalogue.** The map should explain a site — azimuth, alarms, measurements, time — not be a checkbox list of twenty-one layers.

## What’s in this repo

| Path | Role |
|------|------|
| `mapsheetzero.html` | Ideation brief. Libraries are *ideas to steal*, not engines to adopt. |
| `STACK.md` | Locked stack for later product work (MapLibre, not Cesium globe). |
| `ns-qaw-a/` | Runnable prototype: MapLibre + deck.gl, TOK cluster ingest. |
| `data/` | Raw RMI / demo dumps. **Gitignored.** Needed only to re-run ingest. |

Open `mapsheetzero.html` in a browser to read the brief (tokens, provocations P1–P10, reference shelf, four foundations).

**How the pieces connect**

```mermaid
flowchart LR
  MZ["mapsheetzero.html<br/>ideation brief"] -->|steal the idea<br/>not the engine| APP["ns-qaw-a/<br/>the instrument"]
  ST["STACK.md<br/>locked stack"] --> APP
  DATA["data/<br/>gitignored RMI dumps"] -->|"python ingest.py"| PUB["inventory.json<br/>gh.bin · dt.bin"]
  PUB --> APP
```

## What we built

A full-bleed Tokyo RAN map that opens on **2D plan view**. 3D is a switch, not the default (P9).

### Data (last ingest)

- **25 sites / 75 cells** — TOK cluster B3 4G macro from the cell plan.
- Status: 16 on-air, 3 planned, 2 partial, 4 locked (decommissioned: TOK_003, 004, 009, 017).
- **2 in alarm** (TOK_NEW_02 VSWR/critical, TOK_NEW_05).
- **8,503 Groundhog** + **5,235 drive-test** Tokyo-bbox points in packed binaries (`gh.bin`, `dt.bin`), not GeoJSON.
- Clock snapshot `2026-07-18T11:40:00+09:00` ← tok-fm.
- ECGI `440-11-{enbId}-{cellId}`. Honest empty facets: mmWave, 5G Sub-6, RIUD, DAS are **0** with a reason — nothing invented.
- Sukayat alarms: chat index only (no coordinates → no pins).

**Ingest — raw dumps become a published inventory**

```mermaid
flowchart TB
  subgraph raw ["Raw sources"]
    CP["TOK cell plan CSV"]
    ANN["sites_annotated.json"]
    ALM["alarms_active.json"]
    GH["Groundhog RSRP CSVs"]
    DT["Drive-test CSVs"]
    FM["tok-fm timestamp"]
  end

  subgraph py ["ingest.py"]
    JOIN["sites + cells + alarms<br/>WGS84 · ECGI · provenance"]
    BOX["Tokyo bbox only<br/>cap 2e6 points"]
    PACK["pack f32le<br/>lng, lat, rsrp"]
  end

  CP --> JOIN
  ANN --> JOIN
  ALM --> JOIN
  FM --> JOIN
  GH --> BOX --> PACK
  DT --> BOX

  JOIN --> JSON["inventory.json"]
  PACK --> BINS["gh.bin / dt.bin"]
  JSON --> MAP["MapLibre sites + HPBW lobes"]
  BINS --> GPU["deck.gl hex / heatmap / scatter"]
```

### Mapsheet Zero — what we took (not the product)

| Source | Took this | In the prototype |
|--------|-----------|------------------|
| **CesiumJS** | Clock widget (play / pause / speed / range). **Not the globe.** | Shared clock bar. Disabled play until more than one timestamp exists. |
| **deck.gl** | GPU hex bins, heatmaps, instant hover. Million-point path. | `gh.bin` / `dt.bin` as typed arrays. HexagonLayer (zoom below 11), HeatmapLayer, ScatterplotLayer. |
| **Mapbox GL JS** | Feature-state hover/select on the GPU. | MapLibre `feature-state` on sites and sectors. |
| **Esri VFRS** | 2D · 3D switch so 3D earns its place. | Segment control. Terrain + buildings + beams only in 3D. |
| **QGIS** | Verbs, layer tree. | Filters drawer: toggles with sample counts, facets, table on the site card. |
| **Dynamic beams** | Real HPBW `gain()` lobes, not pie slices. | Gaussian −3 dB + back lobe in `lobes.js` (same math as the mapsheetzero hero canvas). |
| **xMap.ai** | Frozen recipe / snapshot. | URL hash `#r=…` (layers + filters + camera + selection). Snapshot copies that link. |
| Terrain / buildings | Japan elevation + city model. | AWS Terrarium DEM + OpenFreeMap building extrusions as stand-in for GSI / PLATEAU. |

### Four foundations

1. **Clock** — one control for every layer. Current ingest is a single frozen moment.
2. **Selection** — pick a site on the map or from search; the card, highlight, and recipe update together.
3. **Recipe** — layers + filters + view + camera as one object. Copilot authors it. Links carry it.
4. **Provenance** — shapes say where they came from (`← cell-plan`, `← tok-fm`, `← gh.bin` / `dt.bin`).

**Clock, selection, recipe, provenance**

```mermaid
flowchart TB
  subgraph found ["Four foundations"]
    CLK["Clock<br/>one time for every layer"]
    SEL["Selection<br/>one site, every surface"]
    REC["Recipe<br/>layers + filters + view + camera"]
    PROV["Provenance<br/>source on every shape"]
  end

  COP["Copilot"] -->|authors| REC
  REC -->|URL hash| LINK["sendable link"]
  CLK --> MAP["the map"]
  SEL --> MAP
  REC --> MAP
  PROV --> MAP
  UI["search · filters · site card"] <--> SEL
```

### Map behaviour

- **LOD (P3 / STACK):** dots below zoom 10 · HPBW wedges zoom 10–15 · 3D beams only above zoom 15 and only in 3D.
- **Co-site:** radial metre-offset so three sectors on one rooftop are honest; spider lines at z ≥ 14.
- **Colour is scarce (P4):** Groundhog heatmap intensity drops when sector lobes are on.
- **Copilot (P7):** natural language → recipe or site Q&A (`show planned sites`, `macros in alarm`, `what alarms?`).
- **Search:** SARF, ECGI, cell, eNB. `/` focuses find.
- **Measure:** ruler and radius via Turf (not Terra Draw yet).
- **Export:** GeoJSON, KML, PNG snapshot + recipe URL on the clipboard.

**Sector LOD**

```mermaid
flowchart LR
  subgraph lod ["Sector LOD"]
    A["zoom below 10"] --> DOTS["site dots"]
    B["zoom 10–15"] --> WEDGES["2D HPBW lobes"]
    C["zoom above 15<br/>and 3D on"] --> BEAMS["3D extrusion beams"]
  end
```

**3D has to earn its place**

```mermaid
stateDiagram-v2
  [*] --> Plan2D
  Plan2D: 2D plan · pitch 0 · muted imagery · lobes
  Cinematic3D: 3D · pitch 64 · terrain · buildings · beams
  Plan2D --> Cinematic3D: 3D switch
  Cinematic3D --> Plan2D: 2D switch
```

### Stack actually running in `ns-qaw-a`

| Piece | Choice |
|-------|--------|
| Map core | **MapLibre GL JS 5.6.2** (CDN) |
| GPU measurements | **deck.gl 9.1.12** `MapboxOverlay` |
| Geometry helpers | **Turf 7** |
| 2D basemap | Inline muted Esri imagery (`planStyle`) — reliable load |
| 3D | Terrain + hillshade + OpenFreeMap buildings |
| Datum | WGS84 / EPSG:4326 |

**Not used:** Cesium engine, Leaflet, kepler.gl, ArcGIS runtime. Fake rooftops are forbidden.

**What runs in the browser**

```mermaid
flowchart TB
  subgraph page ["index.html"]
    CDN["MapLibre 5.6.2 · deck.gl 9.1 · Turf 7"]
    CSS["styles.css · Mapsheet Zero tokens"]
  end

  subgraph js ["ES modules"]
    APP["app.js"]
    MAP["map.js"]
    HEAVY["heavy.js"]
    LOBES["lobes.js"]
    FILT["filters.js"]
    CHAT["chat.js"]
    TOOLS["tools.js"]
  end

  CDN --> APP
  APP --> MAP
  APP --> HEAVY
  APP --> LOBES
  APP --> FILT
  APP --> CHAT
  APP --> TOOLS

  MAP --> ML["MapLibre<br/>sites · lobes · feature-state"]
  HEAVY --> DK["deck.gl overlay<br/>hex · heatmap · scatter"]
  INV["inventory.json"] --> APP
  BIN["gh.bin / dt.bin"] --> HEAVY
  APP <--> HASH["recipe in the URL hash"]
```

## How to run

No npm install. The app is static files plus a JSON inventory.

### 1. Serve the instrument

From this repo:

```bash
cd ns-qaw-a
python serve.py
```

Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/).

`serve.py` serves the static files **and** proxies Copilot's OpenAI fallback at `/api/chat`. Plain `python -m http.server 8765` also works for browsing the map, but the Copilot key field will fail with a 404 on that server — use `serve.py` if you want the OpenAI fallback to work.

Do **not** open `index.html` as a `file://` URL — ES modules and `fetch('./inventory.json')` need a local server.

Needs: Python 3, a browser with WebGL. First load pulls MapLibre / deck.gl / Turf from CDNs (needs network).

`inventory.json`, `gh.bin`, and `dt.bin` are already in `ns-qaw-a/` so the map runs **without** the raw `data/` folder.

**Boot**

```mermaid
sequenceDiagram
  participant You
  participant Server as HTTP server
  participant Browser

  You->>Server: cd ns-qaw-a && python serve.py
  You->>Browser: open http://127.0.0.1:8765/
  Browser->>Server: GET index.html, app.js, inventory.json, gh.bin, dt.bin
  Browser->>Browser: MapLibre paints 25 sites and HPBW lobes
  Browser->>Browser: deck.gl paints Groundhog and drive-test
  Note over Browser: 2D until you click 3D
```

### 2. Re-ingest (optional)

Only if you have the RMI dump at `data/RMI Datasets-…` and want to rebuild inventory:

```bash
cd ns-qaw-a
python ingest.py
```

Writes `inventory.json`, `ingest-report.json`, `gh.bin`, `dt.bin`. Then refresh the browser.

Cap on packed points is 2e6. Tokyo bbox only. TKY-* sample rows from the parent `data-layer` are ignored, not plotted.

### Keyboard

| Key | Action |
|-----|--------|
| `/` | Focus search |
| `f` | Filters |
| `c` | Copilot |
| `Esc` | Clear selection and close drawers |

## Layout of the instrument

```
ns-qaw-a/
  index.html          shell, CDNs, 2D/3D, clock, copilot
  styles.css          Mapsheet Zero dark tokens
  app.js              boot, recipe hash, search, copilot wiring
  map.js              MapLibre style, LOD layers, feature-state, 2D/3D
  heavy.js            deck.gl overlay + packed .bin reader
  lobes.js            gain() HPBW polygons, co-site offset
  filters.js          recipe, facets, empty-count reasons
  chat.js             NL → recipe / site answers
  tools.js            search, measure, import, GeoJSON/KML/PNG
  ingest.py           cell plan + annotated + tok-fm + GH/DT
  inventory.json      published sites/cells + clock + provenance
  gh.bin / dt.bin     f32le triplets: lng, lat, rsrp
  ingest-report.json  last ingest counts
```

## What we did not build yet

These are in the brief or `STACK.md` and are **not** in this prototype:

- Playable Cesium-style clock (range / speed) — needs more than one timestamp in the ingest.
- Before/after (P2), viewshed, Split view.
- Official GSI elevation and PLATEAU 3D city tiles.
- Terra Draw (ruler/radius is Turf only).
- PMTiles / country-scale vector tiles.
- QGIS-style reorderable opacity tree and map↔attribute table for the full inventory.

## Constraints we kept

- Read-only. The map never writes the live network.
- No fake precision: no invented mmWave / RIUD / DAS rooftops, no guessed pins.
- TOK_001 azimuths come from the CSV (234 / 324 / 108), not a generic 0/120/240 pie.
- Speed: GPU layers for measurements; GeoJSON only for ~25 sites and their lobes.
