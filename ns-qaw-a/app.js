import { v, buildGeo, buildPlanned } from './lobes.js'
import { defaultRecipe, applyRecipe, counts, chipList, dismissChip, renderFacets } from './filters.js'
import { createMap, dressAndPaint, setMeasureData, setUserData, setProbeData, queryHit, setBasemap, visibleLayers, applyView, setSelectedState } from './map.js'
import { searchHits, measureDistance, measureRadius, layersToGeoJSON, layersToKml, download, parseImport, snapshotCanvas, downloadPng } from './tools.js'
import { interpret, contextChips, getKey, setKey } from './chat.js'
import { loadPacked, pickPoint, describePick } from './heavy.js'
import { buildHoles } from './holes.js'

const $ = (id) => document.getElementById(id)

const state = {
  inv: null,
  recipe: defaultRecipe(),
  selected: null,
  section: null,
  tool: 'pan',
  measurePts: [],
  userFc: { type: 'FeatureCollection', features: [] },
  geo: null,
  map: null,
  voiceOut: false,
}

function recipeHash() {
  const payload = { recipe: state.recipe, selected: state.selected, camera: camera() }
  history.replaceState(null, '', `#r=${encodeURIComponent(JSON.stringify(payload))}`)
}

function camera() {
  const c = state.map?.getCenter()
  return c ? { center: [c.lng, c.lat], zoom: state.map.getZoom(), pitch: state.map.getPitch(), bearing: state.map.getBearing() } : null
}

function loadHash() {
  const h = location.hash
  if (!h.startsWith('#r=')) return
  try {
    const p = JSON.parse(decodeURIComponent(h.slice(3)))
    if (p.recipe) state.recipe = { ...defaultRecipe(), ...p.recipe }
    if (p.selected) state.selected = p.selected
    return p.camera
  } catch { return null }
}

function filtered() {
  return applyRecipe(state.inv, state.recipe)
}

function paint() {
  const { sites, cells } = filtered()
  const bandPin = state.recipe.band.length === 1 ? state.recipe.band[0] : null
  const zoom = state.map?.getZoom?.() ?? 13
  const bounds = state.map?.getBounds?.() ?? null
  state.geo = buildGeo(sites, cells, { bandPin, selectedId: state.selected, bounds, zoom })
  state.geo.plannedFc = buildPlanned(state.inv.sites)
  if (state.map) {
    dressAndPaint(state.map, state.geo, state.recipe, {
      gh: state.heavy?.gh,
      dt: state.heavy?.dt,
      selectedId: state.selected,
      holes: state.holesFc,
    })
  }
  const c = counts(state.inv, state.recipe)
  const gpu = (state.heavy?.gh?.n || c.gh) + (state.heavy?.dt?.n || c.dt)
  $('counts').textContent = `${c.sites} sites · ${c.cells} cells · ${c.alarm} in alarm · GPU ${gpu.toLocaleString()}`
  renderFacets($('facets'), state.inv, state.recipe, (next) => {
    state.recipe = next
    paint()
    recipeHash()
  })
  renderChips()
  renderCard()
  recipeHash()
}

function renderChips() {
  const chips = chipList(state.recipe)
  $('chips').innerHTML = chips.map((ch, i) =>
    `<span class="chip">${ch.label}<button type="button" data-i="${i}" aria-label="Remove">×</button></span>`
  ).join('')
  $('chips').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', () => {
      state.recipe = dismissChip(state.recipe, chips[Number(b.dataset.i)])
      paint()
    })
  })
}

function renderStarters() {
  const chips = contextChips({ section: state.section, selected: state.selected, inv: state.inv })
  $('starters').innerHTML = chips.map((s) => `<button type="button" class="starter">${s}</button>`).join('')
  $('starters').querySelectorAll('button').forEach((b) => {
    b.onclick = () => ask(b.textContent)
  })
}

function siteOf(id) {
  return state.inv.sites.find((s) => s.site_id === id)
}

function renderCard() {
  const el = $('card')
  const site = siteOf(state.selected)
  if (!site) { el.hidden = true; return }
  const cells = state.inv.cells.filter((c) => c.site_id === site.site_id)
  const alarms = (site.alarms || []).map((a) =>
    `<div class="alarm ${a.severity}">${a.severity} · ${a.problem}${a.root_cause ? ' · root' : ''}<div class="prov">${a.text || ''} ← ${a.source}</div></div>`
  ).join('')
  el.hidden = false
  placeCard()
  el.innerHTML = `
    <header class="card-head">
      <div>
        <div class="u-mono kicker">Site · ${v(site.status)}</div>
        <h2>${site.site_id}</h2>
        <div class="prov">${v(site.sarf_id)} · ${v(site.enb_name)} · ${v(site.site_type_plan)}</div>
      </div>
      <button type="button" class="icon-btn" id="card-x" aria-label="Close">×</button>
    </header>
    <div class="card-body">
    <table>
      <tr><th>EMS</th><td>${v(site.ems_server)}</td></tr>
      <tr><th>Type</th><td>${v(site.site_type)} · ${v(site.morphology)}</td></tr>
      <tr><th>Height</th><td>${v(site.height_m)} m</td></tr>
      <tr><th>On-air</th><td>${v(site.on_air_date) || '—'} <span class="prov">${v(site.on_air_date) ? '' : 'no daily on-air file in this ingest'}</span></td></tr>
      <tr><th>Alarms</th><td>${site.alarm_summary?.count || 0} · ${site.alarm_summary?.highest || '—'}</td></tr>
    </table>
    <table>
      <tr><th>Cell</th><th>ECGI</th><th>PCI</th><th>Az</th><th>HPBW</th><th>Tilt</th></tr>
      ${cells.map((c) => {
        const mech = v(c.mech_tilt)
        const elec = v(c.elec_tilt)
        const tilt = `${mech ?? '—'}°/${elec ?? '—'}°`
        return `<tr class="row-hit" data-cell="${c.cell_id}"><td>${v(c.cell_name)}</td><td>${v(c.ecgi)}</td><td>${v(c.pci)}</td><td>${v(c.azimuth)}°</td><td>${v(c.hpbw) || 65}°</td><td>${tilt}</td></tr>`
      }).join('')}
    </table>
    ${alarms || ''}
    ${site.note ? `<div class="prov">${site.note}</div>` : ''}
    <div class="prov">${Number(v(site.lat)).toFixed(5)} N · ${Number(v(site.lng)).toFixed(5)} E · WGS84 ← cell-plan</div>
    <div class="prov">Observed ${state.inv.clock?.t || '—'} ← ${state.inv.clock?.source || 'clock'} · ${cells.length} cells · EPSG:4326</div>
    <div class="prov">Lobe is HPBW −3 dB contour × azimuth × mech+elec tilt. No MSI/.pattern in this ingest.</div>
    <div class="prov">ECGI above is built as 440-11 + enbId + cellId from the cell plan ← ecgi-envelope, not read from a real ECGI master file in this ingest.</div>
    </div>
  `
  $('card-x').onclick = () => { state.selected = null; paint(); renderStarters() }
  el.querySelectorAll('[data-cell]').forEach((row) => {
    row.onclick = () => {
      const cid = row.dataset.cell
      if (state.map) {
        try { state.map.setFeatureState({ source: 'sectors', id: cid }, { selected: true }) } catch { /* */ }
      }
    }
  })
}

function cinematic() {
  const three = state.recipe.view === '3d'
  state.map.flyTo({
    center: [139.7034, 35.661],
    zoom: three ? 14.05 : 13.4,
    pitch: three ? 64 : 0,
    bearing: three ? -28 : 0,
    duration: 900,
  })
}

function flyToSite(id) {
  const s = siteOf(id)
  if (!s || !state.map) return
  const three = state.recipe.view === '3d'
  state.map.flyTo({
    center: [v(s.lng), v(s.lat)],
    zoom: Math.max(state.map.getZoom(), three ? 15.2 : 14.6),
    pitch: three ? 68 : 0,
    duration: 900,
  })
}

function flySet(pred) {
  const pts = state.inv.sites.filter(pred).map((s) => [v(s.lng), v(s.lat)])
  if (!pts.length) return
  const b = pts.reduce((acc, p) => acc.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]))
  state.map.fitBounds(b, { padding: 90, duration: 900, maxZoom: 15, pitch: state.recipe.view === '3d' ? 58 : 0 })
}

function flyBbox(b) {
  if (!b || b.length < 4) return cinematic()
  const bounds = new maplibregl.LngLatBounds([b[0], b[1]], [b[2], b[3]])
  state.map.fitBounds(bounds, { padding: 80, duration: 1100, maxZoom: 14.2, pitch: state.recipe.view === '3d' ? 52 : 0 })
}

function select(id) {
  state.selected = id
  if (state.map) setSelectedState(state.map, id)
  renderCard()
  recipeHash()
  renderStarters()
  if (id) flyToSite(id)
}

function logMsg(text, who = 'bot') {
  const div = document.createElement('div')
  div.className = `msg ${who}`
  div.innerHTML = text
  $('log').appendChild(div)
  $('log').scrollTop = $('log').scrollHeight
}

function speak(text) {
  if (!state.voiceOut || !window.speechSynthesis) return
  const clean = String(text || '').replace(/<[^>]+>/g, '')
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(clean)
  u.rate = 1.02
  window.speechSynthesis.speak(u)
}

function applyIntent(intent) {
  if (!intent || intent.type === 'empty') return
  $('copilot').hidden = false
  if (intent.type === 'recipe' && intent.recipe) {
    const prevView = state.recipe.view
    const view = intent.recipe.view || prevView
    state.recipe = { ...defaultRecipe(), ...intent.recipe, view }
    state.section = intent.section ?? null
    if (intent.select) state.selected = intent.select
    paint()
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === state.recipe.view))
    if (state.map && view !== prevView) applyView(state.map, view)
    if (intent.fly === 'planned') flySet((s) => v(s.status) === 'planned')
    else if (intent.fly === 'alarms') flySet((s) => s.in_alarm)
    else if (intent.fly === 'select') flyToSite(state.selected)
    else if (intent.fly === 'dt') flyBbox(state.heavy?.dt?.bbox || state.inv.drive_test?.bbox)
    else if (intent.fly === 'gh') flyBbox(state.heavy?.gh?.bbox || state.inv.groundhog?.bbox)
    else if (intent.fly === 'cluster') cinematic()
  } else if (intent.type === 'select') {
    select(intent.select ?? null)
  } else if (intent.type === 'qa') {
    if (intent.select) state.selected = intent.select
    else if (intent.site?.site_id) state.selected = intent.site.site_id
    if (state.selected) paint()
    if (intent.fly === 'select' && state.selected) flyToSite(state.selected)
  }
  if (intent.narrate) {
    logMsg(intent.narrate)
    speak(intent.narrate)
  }
  renderStarters()
  placeCard()
}

async function ask(q) {
  const text = (q || '').trim()
  if (!text) return
  $('copilot').hidden = false
  logMsg(text, 'user')
  const intent = await interpret(text, state.inv, state.selected)
  applyIntent(intent)
}

function placeCard() {
  const card = $('card')
  if (!card || card.hidden) return
  card.classList.toggle('beside-rail', !$('rail').hidden)
}

function toggle(id, show) {
  const el = $(id)
  if (show === undefined) el.hidden = !el.hidden
  else el.hidden = !show
  if (window.innerWidth < 960) {
    if (id === 'copilot' && !el.hidden) $('rail').hidden = true
    if (id === 'rail' && !el.hidden) $('copilot').hidden = true
  }
  placeCard()
}

function bindVoice() {
  const btn = $('btn-mic')
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!Speech) {
    btn.disabled = true
    btn.title = 'Voice needs Chrome or Edge'
    return
  }
  const rec = new Speech()
  rec.lang = 'en-US'
  rec.interimResults = false
  rec.onresult = (e) => {
    const text = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim()
    if (!text) return
    $('ask').value = text
    state.voiceOut = true
    ask(text)
  }
  rec.onerror = (e) => {
    btn.classList.remove('on')
    if (e.error !== 'aborted' && e.error !== 'no-speech') logMsg(`Mic: ${e.error}`)
  }
  rec.onend = () => btn.classList.remove('on')
  btn.onclick = () => {
    $('copilot').hidden = false
    if (btn.classList.contains('on')) {
      rec.stop()
      return
    }
    state.voiceOut = true
    btn.classList.add('on')
    try { rec.start() } catch { rec.stop(); rec.start() }
  }
}

function bindSearch() {
  const input = $('search')
  const box = $('typeahead')
  const render = () => {
    const hits = searchHits(state.inv, input.value)
    if (!hits.length) { box.hidden = true; return }
    box.hidden = false
    box.innerHTML = hits.map((h) => `<button type="button" data-id="${h.siteId}"><b>${h.title}</b><div class="meta">${h.meta}</div></button>`).join('')
    box.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { select(b.dataset.id); box.hidden = true; input.value = '' }
    })
  }
  input.addEventListener('input', render)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const hits = searchHits(state.inv, input.value, 1)
      if (hits[0]) { select(hits[0].siteId); box.hidden = true }
    }
    if (e.key === 'Escape') box.hidden = true
  })
}

function bindTools() {
  document.querySelectorAll('.tool[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tool = btn.dataset.tool
      state.measurePts = []
      document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('on', b === btn))
      $('measure').hidden = true
      setMeasureData(state.map, null)
      setProbeData(state.map, null)
    })
  })
  $('basemap').addEventListener('change', () => {
    setBasemap(state.map, $('basemap').value, () => paint())
  })
  document.querySelectorAll('[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.recipe.view = btn.dataset.view
      document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === state.recipe.view))
      applyView(state.map, state.recipe.view)
      paint()
      recipeHash()
    })
  })
  $('btn-import').onclick = () => $('file-import').click()
  $('file-import').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      state.userFc = parseImport(await file.text(), file.name)
      setUserData(state.map, state.userFc)
      logMsg(`Imported ${state.userFc.features.length} features.`)
    } catch (err) {
      logMsg(`Import failed: ${err.message}`)
    }
  })
  $('btn-geojson').onclick = () => {
    download('ns-qaw-a.geojson', JSON.stringify(layersToGeoJSON(visibleLayers(state.geo, state.recipe, state.userFc)), null, 2), 'application/geo+json')
  }
  $('btn-kml').onclick = () => {
    download('ns-qaw-a.kml', layersToKml(visibleLayers(state.geo, state.recipe, state.userFc)), 'application/vnd.google-earth.kml+xml')
  }
  $('btn-shot').onclick = () => {
    recipeHash()
    downloadPng(snapshotCanvas(state.map), 'ns-qaw-a.png')
    navigator.clipboard?.writeText(location.href)
    logMsg('Snapshot saved. Recipe URL copied.')
  }
}

function onMapClick(e) {
  if (state.tool === 'ruler' || state.tool === 'radius') {
    const p = [e.lngLat.lng, e.lngLat.lat]
    state.measurePts.push(p)
    if (state.measurePts.length === 1) {
      $('measure').hidden = false
      $('measure').textContent = 'Second point'
      return
    }
    const res = state.tool === 'ruler'
      ? measureDistance(state.measurePts[0], state.measurePts[1])
      : measureRadius(state.measurePts[0], state.measurePts[1])
    setMeasureData(state.map, res.fc)
    $('measure').hidden = false
    $('measure').textContent = res.label
    state.measurePts = []
    return
  }
  const hit = queryHit(state.map, e)
  if (hit?.cluster) {
    const src = state.map.getSource('sites')
    src.getClusterExpansionZoom(hit.clusterId, (err, zoom) => {
      if (err) return
      state.map.easeTo({ center: hit.lngLat, zoom })
    })
    return
  }
  if (hit?.siteId) {
    setProbeData(state.map, null)
    select(hit.siteId)
    return
  }
  const desc = describePick(pickPoint(state.map, e.point), state.heavy)
  if (desc) {
    setProbeData(state.map, { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [desc.lng, desc.lat] } }] })
    $('measure').hidden = false
    $('measure').textContent = `${desc.kind} · ${desc.rsrp.toFixed(1)} dBm · ${desc.lat.toFixed(5)} N ${desc.lng.toFixed(5)} E ← ${desc.source}`
    return
  }
  setProbeData(state.map, null)
  select(null)
}

async function boot() {
  const inv = await fetch('./inventory.json').then((r) => r.json())
  state.inv = inv
  const [gh, dt] = await Promise.all([
    loadPacked(inv.groundhog?.file ? `./${inv.groundhog.file}` : './gh.bin'),
    loadPacked(inv.drive_test?.file ? `./${inv.drive_test.file}` : './dt.bin'),
  ])
  state.heavy = { gh, dt }
  state.holesFc = buildHoles(gh)
  const cam = loadHash()
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === state.recipe.view))
  let booted = false
  const finish = () => {
    if (booted) { paint(); return }
    booted = true
    paint()
    state.map.resize()
    if (cam?.center) {
      state.map.jumpTo({ center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing })
    }
    const c = counts(inv, state.recipe)
    const clk = inv.clock
    if ($('clock-label')) {
      $('clock-label').textContent = clk?.t
        ? `${clk.t} ← ${clk.source}`
        : 'cell-plan snapshot'
    }
    $('hud').textContent = `${inv.crs || 'EPSG:4326'} · WGS84`
    logMsg(`<b>Instrument, not catalogue.</b> MapLibre · deck.gl GPU · one clock. ${c.sites} rooftops · ${c.gh.toLocaleString()} GH samples · ${c.dt.toLocaleString()} DT samples. Datum WGS84. 2D until 3D earns its place.`)
    renderStarters()
  }
  state.map = createMap($('map'), { view: state.recipe.view, onLoad: finish })
  window.__map = state.map
  setTimeout(() => { if (!booted) finish() }, 1200)
  state.map.on('mousemove', (e) => {
    $('hud').textContent = `${e.lngLat.lat.toFixed(5)} N  ${e.lngLat.lng.toFixed(5)} E · WGS84`
  })
  state.map.on('click', onMapClick)
  state.map.on('moveend', () => recipeHash())
  state.map.on('zoomend', () => {
    const z = state.map.getZoom()
    const crossed = (state.__z < 10) !== (z < 10)
    state.__z = z
    if (crossed) paint()
  })
  new ResizeObserver(() => state.map?.resize()).observe($('stage'))

  bindSearch()
  bindTools()
  bindVoice()
  $('openai-key').value = getKey()
  $('openai-key').addEventListener('change', () => setKey($('openai-key').value))
  $('composer').addEventListener('submit', (e) => {
    e.preventDefault()
    const q = $('ask').value.trim()
    $('ask').value = ''
    ask(q)
  })
  $('btn-rail').onclick = () => toggle('rail')
  $('btn-copilot').onclick = () => toggle('copilot')
  $('rail-x').onclick = () => { $('rail').hidden = true; placeCard() }
  $('copilot-x').onclick = () => { $('copilot').hidden = true; placeCard() }

  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) {
      if (e.key === 'Escape') e.target.blur()
      return
    }
    if (e.key === '/') { e.preventDefault(); $('search').focus() }
    if (e.key === 'f' || e.key === 'F') toggle('rail')
    if (e.key === 'c' || e.key === 'C') toggle('copilot')
    if (e.key === 'Escape') { state.selected = null; state.section = null; $('rail').hidden = true; $('copilot').hidden = true; $('measure').hidden = true; setProbeData(state.map, null); paint(); renderStarters() }
  })
}

boot().catch((err) => {
  document.body.innerHTML = `<p style="padding:24px;color:#eee">Failed to load inventory.json. Run ingest.py. ${err}</p>`
})
