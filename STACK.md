# Stack — locked

This is the stack `ns-qaw-a` is built on, and the stack later product work should keep building on. Nothing here needs re-litigating per feature — if you want to replace a piece, replace it with something that does the same job (see `mapsheetzero.html` → Foundations).

## Locked

| Piece | Choice | Why |
|-------|--------|-----|
| Map core | MapLibre GL JS 5.6.2 | Open source, no token. `feature-state` hover/select on the GPU — the Mapbox GL JS idea, on the MapLibre engine. |
| GPU measurement layers | deck.gl 9.1.12 `MapboxOverlay` | Hex bins / heatmap / scatter / contour over packed typed arrays — the only path that survives millions of points. |
| Geometry helpers | Turf 7 | Ruler, radius, distance/bearing. |
| Datum | WGS84 / EPSG:4326 | Every source in this ingest already ships WGS84; no conversion layer exists yet — a source in JGD2000 or old Tokyo Datum would need one added before it's trusted. |
| 2D basemap | Muted Esri World Imagery | Reliable to load, doesn't fight the sector wedges for attention (Colour is a scarce resource — P4). |
| 3D | MapLibre terrain (raster-dem) + OpenFreeMap building extrusion | Stand-ins for GSI elevation / PLATEAU city tiles, not yet wired to the official Japanese sources. |

## Explicitly not used

Cesium engine, Leaflet, kepler.gl, Esri ArcGIS runtime. `mapsheetzero.html`'s reference shelf is ideas to steal (Cesium's clock widget, Esri VFRS's 2D/3D switch), not engines to adopt. Fake rooftops are forbidden regardless of engine.

## Known gaps against this stack

- No PMTiles / vector-tile path yet. Country scale (millions of sites) needs one — `ns-qaw-a` today is GeoJSON for ~25 sites plus packed binaries for GH/DT, and `inventory.json` loads as one blocking fetch.
- No GSI elevation or PLATEAU city model — currently AWS Terrarium DEM + OpenFreeMap buildings.
- No datum-conversion layer — harmless today because every feed in this ingest is already WGS84.
- No real antenna pattern (MSI/`.pattern`) — sector lobes are a Gaussian −3 dB approximation from HPBW + azimuth + mech/elec tilt, not the surveyed radiation pattern.
