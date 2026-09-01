/** GPU measurement layers — deck.gl typed arrays. Mapsheet Zero: hex / heatmap / instant hover. */

const COLOR_STOPS = [
  [-120, [169, 67, 58]],
  [-105, [210, 118, 29]],
  [-95, [238, 154, 59]],
  [-85, [79, 189, 182]],
  [-70, [196, 177, 138]],
]

// Same bands the coverage-hole threshold uses (≤ −105 = hole). Isoband contour, not a heatmap blur.
const CONTOUR_BANDS = [
  { threshold: [-999, -105], color: [169, 67, 58, 150] },
  { threshold: [-105, -95], color: [210, 118, 29, 140] },
  { threshold: [-95, -85], color: [238, 154, 59, 120] },
  { threshold: [-85, 999], color: [196, 177, 138, 100] },
]

function lerpColor(rsrp) {
  if (rsrp <= COLOR_STOPS[0][0]) return [...COLOR_STOPS[0][1], 200]
  if (rsrp >= COLOR_STOPS[COLOR_STOPS.length - 1][0]) return [...COLOR_STOPS[COLOR_STOPS.length - 1][1], 210]
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    const [aV, aC] = COLOR_STOPS[i - 1]
    const [bV, bC] = COLOR_STOPS[i]
    if (rsrp <= bV) {
      const t = (rsrp - aV) / (bV - aV)
      return [
        aC[0] + (bC[0] - aC[0]) * t,
        aC[1] + (bC[1] - aC[1]) * t,
        aC[2] + (bC[2] - aC[2]) * t,
        205,
      ].map((n) => n | 0)
    }
  }
  return [238, 154, 59, 200]
}

export async function loadPacked(url) {
  const res = await fetch(url)
  if (!res.ok) return { n: 0, positions: new Float32Array(0), colors: new Uint8Array(0), weights: new Float32Array(0), rsrp: new Float32Array(0), bbox: null }
  const buf = await res.arrayBuffer()
  const src = new Float32Array(buf)
  const n = (src.length / 3) | 0
  const positions = new Float32Array(n * 3)
  const colors = new Uint8Array(n * 4)
  const weights = new Float32Array(n)
  const rsrps = new Float32Array(n)
  let west = 180, south = 90, east = -180, north = -90
  for (let i = 0; i < n; i++) {
    const lng = src[i * 3]
    const lat = src[i * 3 + 1]
    const rsrp = src[i * 3 + 2]
    positions[i * 3] = lng
    positions[i * 3 + 1] = lat
    positions[i * 3 + 2] = 0
    rsrps[i] = rsrp
    const c = lerpColor(rsrp)
    colors[i * 4] = c[0]
    colors[i * 4 + 1] = c[1]
    colors[i * 4 + 2] = c[2]
    colors[i * 4 + 3] = c[3]
    weights[i] = Math.max(0.05, Math.min(1, (rsrp + 120) / 50))
    if (lng < west) west = lng
    if (lng > east) east = lng
    if (lat < south) south = lat
    if (lat > north) north = lat
  }
  return { n, positions, colors, weights, rsrp: rsrps, bbox: n ? [west, south, east, north] : null }
}

function deckApi() {
  const g = globalThis.deck
  if (!g?.MapboxOverlay || !g?.ScatterplotLayer) {
    throw new Error('deck.gl UMD missing')
  }
  return g
}

function waitIdle(map) {
  return new Promise((resolve) => {
    if (map.isStyleLoaded()) return resolve()
    const done = () => resolve()
    map.once('load', done)
    setTimeout(done, 800)
  })
}

export async function attachDeck(map) {
  if (map.__deck) return map.__deck
  if (map.__deckLock) return map.__deckLock
  map.__deckLock = (async () => {
    await waitIdle(map)
    const { MapboxOverlay } = deckApi()
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] })
    map.addControl(overlay)
    map.__deck = overlay
    map.on('zoomend', () => {
      if (map.__heavy) paintHeavy(map, map.__heavy)
    })
    requestAnimationFrame(() => {
      document.querySelectorAll('#map canvas').forEach((el) => {
        if (!el.classList.contains('maplibregl-canvas')) el.style.pointerEvents = 'none'
      })
    })
    return overlay
  })()
  try {
    return await map.__deckLock
  } finally {
    map.__deckLock = null
  }
}

export function detachDeck(map) {
  if (!map?.__deck) return
  try { map.removeControl(map.__deck) } catch { /* */ }
  map.__deck = null
}

function binaryLayer(n, positions, colors) {
  return {
    length: n,
    attributes: {
      getPosition: { value: positions, size: 3 },
      getFillColor: { value: colors, size: 4 },
    },
  }
}

export async function paintHeavy(map, { gh, dt, recipe } = {}) {
  map.__heavy = { gh, dt, recipe }
  if (!map.isStyleLoaded()) {
    // 'load' fires once per map lifetime and has already fired by the time we get
    // here (setData() on the GeoJSON sources just above makes isStyleLoaded() go
    // momentarily false while they reprocess) — 'idle' re-fires every time the map
    // settles, so it's the one that actually retries.
    map.once('idle', () => paintHeavy(map, { gh, dt, recipe }))
    return
  }
  let overlay
  try {
    overlay = await attachDeck(map)
  } catch (err) {
    console.warn('deck.gl overlay failed', err)
    return
  }
  const { ScatterplotLayer, HeatmapLayer, HexagonLayer, ContourLayer } = deckApi()
  const z = map.getZoom()
  const layers = []
  const loud = !recipe?.sectorsLayer
  const intensity = loud ? 1.05 : 0.55

  if (recipe?.ghLayer && gh?.n) {
    if (z < 11 && HexagonLayer) {
      layers.push(new HexagonLayer({
        id: 'gh-hex',
        data: { length: gh.n },
        getPosition: (_, { index }) => [gh.positions[index * 3], gh.positions[index * 3 + 1]],
        gpuAggregation: true,
        radius: 140,
        elevationScale: recipe.view === '3d' ? 8 : 0,
        extruded: recipe.view === '3d',
        coverage: 0.84,
        colorRange: [[15, 70, 97], [210, 118, 29], [243, 213, 160]],
        pickable: false,
      }))
    } else if (HeatmapLayer) {
      layers.push(new HeatmapLayer({
        id: 'gh-heat',
        data: {
          length: gh.n,
          attributes: {
            getPosition: { value: gh.positions, size: 3 },
            getWeight: { value: gh.weights, size: 1 },
          },
        },
        radiusPixels: z < 12 ? 22 : 34,
        intensity,
        threshold: 0.04,
        colorRange: [[15, 70, 97, 0], [15, 70, 97, 150], [210, 118, 29, 190], [243, 213, 160, 220]],
        pickable: false,
      }))
    }
    if (z >= 13 && ScatterplotLayer) {
      layers.push(new ScatterplotLayer({
        id: 'gh-pts',
        data: binaryLayer(gh.n, gh.positions, gh.colors),
        radiusUnits: 'pixels',
        getRadius: 3,
        radiusMinPixels: 1.4,
        pickable: true,
        parameters: { depthTest: false },
      }))
    }
  }

  if (recipe?.ghContourLayer && gh?.n && ContourLayer) {
    layers.push(new ContourLayer({
      id: 'gh-contour',
      data: {
        length: gh.n,
        attributes: {
          getPosition: { value: gh.positions, size: 3 },
          getWeight: { value: gh.rsrp, size: 1 },
        },
      },
      cellSize: 110,
      aggregation: 'MEAN',
      contours: CONTOUR_BANDS,
      zOffset: 0.005,
    }))
  }

  if (recipe?.dtLayer && dt?.n && ScatterplotLayer) {
    layers.push(new ScatterplotLayer({
      id: 'dt-pts',
      data: binaryLayer(dt.n, dt.positions, dt.colors),
      radiusUnits: 'pixels',
      getRadius: z < 12 ? 2 : 3.2,
      radiusMinPixels: 1.2,
      pickable: true,
      parameters: { depthTest: false },
    }))
  }

  overlay.setProps({ layers })
}

/** Manual hit-test into the deck.gl layers. The overlay's own canvas has
 *  pointer-events:none (MapLibre needs the drag/pan gestures), so picking
 *  is driven from MapLibre's click handler instead of DOM events. */
export function pickPoint(map, point) {
  const overlay = map.__deck
  if (!overlay?.pickObject) return null
  try {
    return overlay.pickObject({ x: point.x, y: point.y, radius: 6 })
  } catch {
    return null
  }
}

/** Resolve a deck.gl pick result back to the RSRP sample it hit. */
export function describePick(info, heavy) {
  const idx = info?.index
  if (idx == null || idx < 0) return null
  if (info.layer?.id === 'gh-pts' && heavy?.gh?.n) {
    return { kind: 'Groundhog', rsrp: heavy.gh.rsrp[idx], lng: heavy.gh.positions[idx * 3], lat: heavy.gh.positions[idx * 3 + 1], source: 'gh.bin' }
  }
  if (info.layer?.id === 'dt-pts' && heavy?.dt?.n) {
    return { kind: 'Drive test', rsrp: heavy.dt.rsrp[idx], lng: heavy.dt.positions[idx * 3], lat: heavy.dt.positions[idx * 3 + 1], source: 'dt.bin' }
  }
  return null
}
