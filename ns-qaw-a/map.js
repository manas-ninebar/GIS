import { paintHeavy, detachDeck } from './heavy.js'

const TERRAIN = {
  type: 'raster-dem',
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium',
  tileSize: 256,
  maxzoom: 15,
}

const ESRI = {
  tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  tileSize: 256,
  attribution: 'Esri',
  maxzoom: 19,
}

const DARK = 'https://tiles.openfreemap.org/styles/dark'

export function planStyle() {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      esri: { type: 'raster', tiles: ESRI.tiles, tileSize: 256, attribution: ESRI.attribution, maxzoom: 19 },
    },
    layers: [
      {
        id: 'sat', type: 'raster', source: 'esri',
        paint: { 'raster-saturation': -0.82, 'raster-brightness-min': 0.02, 'raster-brightness-max': 0.52, 'raster-contrast': -0.08 },
      },
    ],
  }
}

export function cinematicStyle() {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      esri: { type: 'raster', tiles: ESRI.tiles, tileSize: 256, attribution: ESRI.attribution, maxzoom: 19 },
      terrain: TERRAIN,
    },
    layers: [
      { id: 'sat', type: 'raster', source: 'esri', paint: { 'raster-saturation': -0.12, 'raster-contrast': 0.08 } },
      {
        id: 'hillshade', type: 'hillshade', source: 'terrain',
        paint: {
          'hillshade-exaggeration': 0.42,
          'hillshade-shadow-color': '#05080c',
          'hillshade-highlight-color': '#fff3d6',
          'hillshade-illumination-direction': 226,
        },
      },
    ],
  }
}

export function createMap(container, { view = '2d', onLoad } = {}) {
  const three = view === '3d'
  const map = new maplibregl.Map({
    container,
    style: three ? cinematicStyle() : planStyle(),
    center: [139.7034, 35.661],
    zoom: three ? 14.05 : 13.4,
    pitch: three ? 64 : 0,
    bearing: three ? -28 : 0,
    maxPitch: 85,
    attributionControl: false,
    preserveDrawingBuffer: true,
    hash: false,
  })
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false, showCompass: true }), 'top-right')
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left')
  map.__view = view
  bindHover(map)
  const fire = () => onLoad?.(map)
  map.once('load', fire)
  map.once('idle', fire)
  map.on('style.load', () => {
    if (map.__view === '3d') enhance3d(map)
  })
  return map
}

export function enhance3d(map) {
  try {
    if (!map.getSource('terrain')) map.addSource('terrain', TERRAIN)
    map.setTerrain({ source: 'terrain', exaggeration: 1.55 })
  } catch { /* */ }
  try {
    map.setSky({
      'sky-color': '#071018',
      'horizon-color': '#3a2416',
      'fog-color': '#0b1218',
      'sky-horizon-blend': 0.55,
      'horizon-fog-blend': 0.72,
      'fog-ground-blend': 0.35,
    })
  } catch { /* */ }
  try {
    map.setLight({ anchor: 'viewport', color: '#fff6e8', intensity: 0.55, position: [1.2, 210, 28] })
  } catch { /* */ }
  addCity(map)
}

function addCity(map) {
  try {
    if (!map.getSource('openmaptiles')) {
      map.addSource('openmaptiles', { type: 'vector', url: 'https://tiles.openfreemap.org/planet' })
    }
  } catch { return }
  if (map.getLayer('city-3d')) return
  try {
    map.addLayer({
      id: 'city-3d',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'fill-extrusion-color': '#1a222c',
        'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 16],
        'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
        'fill-extrusion-opacity': 0.72,
        'fill-extrusion-vertical-gradient': true,
      },
    })
  } catch { /* style already has buildings */ }
}

function emptyFc() {
  return { type: 'FeatureCollection', features: [] }
}

function ensureSources(map) {
  if (!map.getSource('sites')) {
    map.addSource('sites', {
      type: 'geojson',
      data: emptyFc(),
      promoteId: 'id',
      cluster: true,
      clusterMaxZoom: 9,
      clusterRadius: 52,
    })
  }
  for (const id of ['sectors', 'spider', 'labels', 'holes', 'measure', 'user']) {
    if (!map.getSource(id)) {
      map.addSource(id, { type: 'geojson', data: emptyFc(), promoteId: 'id' })
    }
  }
}

function addLayer(map, spec) {
  try {
    if (!map.getLayer(spec.id)) map.addLayer(spec)
  } catch { /* */ }
}

function vis(on) {
  return on ? 'visible' : 'none'
}

function ensureLayers(map, recipe = {}) {
  const three = recipe.view === '3d'
  addLayer(map, {
    id: 'sites-cluster', type: 'circle', source: 'sites',
    filter: ['has', 'point_count'],
    maxzoom: 10,
    paint: {
      'circle-color': '#0F4661',
      'circle-radius': ['step', ['get', 'point_count'], 10, 20, 14, 100, 18, 1000, 24],
      'circle-stroke-width': 1.4,
      'circle-stroke-color': '#E3EAED',
      'circle-opacity': 0.92,
    },
  })
  addLayer(map, {
    id: 'sites-cluster-count', type: 'symbol', source: 'sites',
    filter: ['has', 'point_count'],
    maxzoom: 10,
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
    },
    paint: { 'text-color': '#E3EAED' },
  })
  addLayer(map, {
    id: 'sites-glow', type: 'circle', source: 'sites',
    filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'in_alarm'], 1]],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 8, 15, 18],
      'circle-color': '#A9433A',
      'circle-opacity': 0.28,
      'circle-blur': 0.75,
      'circle-pitch-alignment': 'map',
    },
  })
  addLayer(map, {
    id: 'sites', type: 'circle', source: 'sites',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        5, 2.6, 10, 5.5, 15, 7.2,
      ],
      'circle-color': ['get', 'color'],
      'circle-pitch-alignment': 'map',
      'circle-stroke-width': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], 3.4,
        ['boolean', ['feature-state', 'hover'], false], 2.6,
        ['==', ['get', 'in_alarm'], 1], 2.2,
        1,
      ],
      'circle-stroke-color': '#E3EAED',
      'circle-opacity': 0.95,
    },
  })
  addLayer(map, {
    id: 'holes', type: 'fill', source: 'holes',
    minzoom: 11,
    paint: {
      'fill-color': '#A9433A',
      'fill-opacity': 0.18,
      'fill-outline-color': '#7a2e28',
    },
  })
  // Dots z<10. Wedge fill z10–15 (and z>15 in 2D). Outline same range.
  addLayer(map, {
    id: 'sectors', type: 'fill', source: 'sectors',
    minzoom: 10,
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], 0.55,
        ['boolean', ['feature-state', 'hover'], false], 0.38,
        0.2,
      ],
    },
  })
  addLayer(map, {
    id: 'sectors-line', type: 'line', source: 'sectors',
    minzoom: 10,
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 1.15,
      'line-opacity': 0.72,
    },
  })
  // 3D beam z>15 only when 3D view has earned its place.
  addLayer(map, {
    id: 'sectors-3d', type: 'fill-extrusion', source: 'sectors',
    minzoom: 15,
    layout: { visibility: vis(three) },
    paint: {
      'fill-extrusion-color': ['get', 'color'],
      'fill-extrusion-height': ['coalesce', ['get', 'beam_height_m'], 48],
      'fill-extrusion-base': 0,
      'fill-extrusion-opacity': 0.46,
      'fill-extrusion-vertical-gradient': true,
    },
  })
  addLayer(map, {
    id: 'spider', type: 'line', source: 'spider', minzoom: 14,
    paint: { 'line-color': ['get', 'color'], 'line-width': 1.15, 'line-dasharray': [1.1, 1.3], 'line-opacity': 0.75 },
  })
  addLayer(map, {
    id: 'labels', type: 'symbol', source: 'labels', minzoom: 14.4,
    layout: {
      'text-field': ['get', 'label'],
      'text-size': 11,
      'text-font': ['Noto Sans Regular'],
      'text-pitch-alignment': 'viewport',
      'text-optional': true,
      'text-padding': 4,
      'text-allow-overlap': false,
    },
    paint: { 'text-color': '#E3EAED', 'text-halo-color': '#101D26', 'text-halo-width': 1.15 },
  })
  addLayer(map, {
    id: 'measure-line', type: 'line', source: 'measure',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#EE9A3B', 'line-width': 2.6 },
  })
  addLayer(map, {
    id: 'measure-fill', type: 'fill', source: 'measure',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': '#EE9A3B', 'fill-opacity': 0.14 },
  })
  addLayer(map, {
    id: 'user-fill', type: 'fill', source: 'user',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': '#4FBDB6', 'fill-opacity': 0.2 },
  })
  addLayer(map, {
    id: 'user-line', type: 'line', source: 'user',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#4FBDB6', 'line-width': 2 },
  })
  addLayer(map, {
    id: 'user-pt', type: 'circle', source: 'user',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-color': '#4FBDB6', 'circle-radius': 5 },
  })
  if (map.getLayer('sectors-3d')) {
    map.setLayoutProperty('sectors-3d', 'visibility', vis(three))
  }
  if (map.getLayer('sectors')) {
    map.setLayerZoomRange('sectors', 10, three ? 15 : 24)
  }
  if (map.getLayer('sectors-line')) {
    map.setLayerZoomRange('sectors-line', 10, three ? 15 : 24)
  }
  if (map.getLayer('city-3d')) {
    map.setLayoutProperty('city-3d', 'visibility', vis(three))
  }
}

export function applyView(map, view) {
  map.__view = view
  map.stop()
  if (view === '3d') {
    enhance3d(map)
    map.easeTo({ pitch: 64, bearing: -28, duration: 700 })
  } else {
    try { map.setTerrain(null) } catch { /* */ }
    map.easeTo({ pitch: 0, bearing: 0, duration: 500 })
  }
  const three = view === '3d'
  if (map.getLayer('sectors-3d')) map.setLayoutProperty('sectors-3d', 'visibility', vis(three))
  if (map.getLayer('sectors')) map.setLayerZoomRange('sectors', 10, three ? 15 : 24)
  if (map.getLayer('sectors-line')) map.setLayerZoomRange('sectors-line', 10, three ? 15 : 24)
  if (map.getLayer('city-3d')) map.setLayoutProperty('city-3d', 'visibility', vis(three))
}

export function dressAndPaint(map, geo, recipe, extras = {}) {
  if (!map.isStyleLoaded()) {
    map.once('load', () => dressAndPaint(map, geo, recipe, extras))
    map.once('idle', () => {
      if (!map.getSource('sites')) dressAndPaint(map, geo, recipe, extras)
    })
    return
  }
  try {
    if (recipe.view === '3d') enhance3d(map)
    ensureSources(map)
    ensureLayers(map, recipe)
    map.getSource('sites').setData(geo.siteFc)
    map.getSource('sectors').setData(recipe.sectorsLayer ? geo.sectorFc : emptyFc())
    map.getSource('spider').setData(recipe.spiderLayer ? geo.spiderFc : emptyFc())
    map.getSource('labels').setData(recipe.sectorsLayer ? geo.labelFc : emptyFc())
    map.getSource('holes')?.setData(recipe.holesLayer && extras.holes ? extras.holes : emptyFc())
    setSelectedState(map, extras.selectedId || null)
    paintHeavy(map, { gh: extras.gh, dt: extras.dt, recipe }).catch((err) => {
      console.warn('deck.gl GPU layer failed', err)
    })
  } catch (err) {
    console.error('dressAndPaint', err)
    window.__paintErr = String(err?.message || err) + '\n' + (err?.stack || '')
  }
}

export function setSelectedState(map, id) {
  if (map.__sel && map.getSource('sites')) {
    try { map.setFeatureState({ source: 'sites', id: map.__sel }, { selected: false }) } catch { /* */ }
  }
  map.__sel = id
  if (id && map.getSource('sites')) {
    try { map.setFeatureState({ source: 'sites', id }, { selected: true }) } catch { /* */ }
  }
}

function bindHover(map) {
  map.on('mousemove', (e) => {
    const hit = queryHit(map, e)
    const next = hit ? { source: hit.source, id: hit.featureId } : null
    const prev = map.__hov
    if (prev && (!next || prev.id !== next.id || prev.source !== next.source)) {
      try { map.setFeatureState({ source: prev.source, id: prev.id }, { hover: false }) } catch { /* */ }
      map.__hov = null
    }
    if (next) {
      try { map.setFeatureState({ source: next.source, id: next.id }, { hover: true }) } catch { /* */ }
      map.__hov = next
      map.getCanvas().style.cursor = 'pointer'
    } else {
      map.getCanvas().style.cursor = ''
    }
  })
}

export function setMeasureData(map, fc) {
  ensureSources(map)
  map.getSource('measure')?.setData(fc || emptyFc())
}

export function setUserData(map, fc) {
  ensureSources(map)
  map.getSource('user')?.setData(fc || emptyFc())
}

export function queryHit(map, e) {
  const layers = ['sectors-3d', 'sectors', 'sites', 'sites-cluster'].filter((id) => map.getLayer(id))
  const hits = map.queryRenderedFeatures(e.point, { layers })
  const f = hits[0]
  if (!f) return null
  if (f.properties.cluster) {
    return {
      cluster: true,
      clusterId: f.properties.cluster_id,
      lngLat: f.geometry.coordinates,
      source: f.source,
    }
  }
  const featureId = f.id ?? f.properties.id
  return {
    siteId: f.properties.site_id || f.properties.id,
    cellId: f.properties.id,
    source: f.source,
    featureId,
  }
}

export async function setBasemap(map, name, after) {
  detachDeck(map)
  const view = map.__view || '2d'
  if (name === 'satellite') map.setStyle(cinematicStyle())
  else if (name === 'dark') map.setStyle(planStyle())
  else if (name === 'liberty') map.setStyle('https://tiles.openfreemap.org/styles/liberty')
  else map.setStyle('https://tiles.openfreemap.org/styles/positron')
  map.once('style.load', () => {
    if (view === '3d') enhance3d(map)
    after()
  })
}

export function visibleLayers(geo, recipe, userFc) {
  const layers = [{ name: 'sites', fc: geo.siteFc }]
  if (recipe.sectorsLayer) layers.push({ name: 'sectors', fc: geo.sectorFc })
  if (userFc?.features?.length) layers.push({ name: 'user', fc: userFc })
  return layers
}
