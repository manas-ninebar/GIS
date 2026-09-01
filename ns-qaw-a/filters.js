import { v } from './lobes.js'

export const EMPTY_REASON = {
  '5G Sub-6': '0 in this ingest — TOK cluster is 4G macro B3',
  mmWave: '0 in this ingest — TOK cluster is 4G macro B3',
  RIUD: '0 rooftops — ingest is MACRO only',
  dash: '0 rooftops — ingest is MACRO only',
  IDSC: '0 rooftops — ingest is MACRO only',
  ODSC: '0 rooftops — ingest is MACRO only',
  DAS: '0 rooftops — ingest is MACRO only',
  VOC: '0 geocoded complaints in current ingest',
}

export function defaultRecipe() {
  return {
    tech: [],
    band: [],
    siteType: [],
    status: [],
    morphology: [],
    carrier: [],
    inAlarm: null,
    serviceAffecting: null,
    view: '2d',
    sectorsLayer: true,
    spiderLayer: true,
    ghLayer: false,
    dtLayer: false,
    holesLayer: false,
    ghContourLayer: false,
    vocLayer: false,
    plannedLayer: true,
    pci: '',
    onAirFrom: '',
    onAirTo: '',
    height: [null, null],
    mechTilt: [null, null],
    hasCmAzimuth: true,
    azimuthRange: null,
    identity: '',
  }
}

export function cellMatch(c, site, r) {
  if (r.hasCmAzimuth === true && c.has_cm_azimuth === false) return false
  if (r.tech.length && !r.tech.includes(v(c.tech))) return false
  if (r.band.length && !r.band.includes(v(c.band))) return false
  if (r.siteType.length && !r.siteType.includes(v(c.site_type))) return false
  if (r.carrier?.length && !r.carrier.includes(String(v(c.carrier)))) return false
  if (r.status.length && !r.status.includes(v(c.status))) return false
  if (r.morphology.length && !r.morphology.includes(v(site.morphology))) return false
  if (r.inAlarm === true && !c.in_alarm && !site.in_alarm) return false
  if (r.inAlarm === false && (c.in_alarm || site.in_alarm)) return false
  if (r.serviceAffecting === true && !site.alarm_summary?.service_affecting) return false
  if (r.pci !== '' && Number(r.pci) !== Number(v(c.pci))) return false
  const h = v(c.height_m)
  if (r.height[0] != null && h != null && h < r.height[0]) return false
  if (r.height[1] != null && h != null && h > r.height[1]) return false
  const t = v(c.mech_tilt)
  if (r.mechTilt[0] != null && t != null && t < r.mechTilt[0]) return false
  if (r.mechTilt[1] != null && t != null && t > r.mechTilt[1]) return false
  if (r.azimuthRange) {
    const [a, b] = r.azimuthRange
    const az = ((v(c.azimuth) % 360) + 360) % 360
    if (a <= b) {
      if (az < a || az > b) return false
    } else if (!(az >= a || az <= b)) return false
  }
  if (r.identity) {
    const q = r.identity.toLowerCase()
    const blob = [c.cell_id, v(c.ecgi), v(c.sarf_id), v(c.cell_name), site.site_id, v(site.enb_name), v(site.ems_server)]
      .join(' ').toLowerCase()
    if (!blob.includes(q)) return false
  }
  if (r.onAirFrom || r.onAirTo) {
    const d = v(site.on_air_date)
    if (!d) return false
    if (r.onAirFrom && d < r.onAirFrom) return false
    if (r.onAirTo && d > r.onAirTo) return false
  }
  return true
}

export function applyRecipe(inv, r) {
  const siteBy = Object.fromEntries(inv.sites.map((s) => [s.site_id, s]))
  const cells = inv.cells.filter((c) => cellMatch(c, siteBy[c.site_id], r))
  const ids = new Set(cells.map((c) => c.site_id))
  const sites = inv.sites.filter((s) => ids.has(s.site_id))
  return { sites, cells }
}

export function nPts(layer) {
  if (!layer) return 0
  if (typeof layer.n === 'number') return layer.n
  if (Array.isArray(layer)) return layer.length
  return 0
}

export function counts(inv, r) {
  const { sites, cells } = applyRecipe(inv, r)
  return {
    sites: sites.length,
    cells: cells.length,
    alarm: sites.filter((s) => s.in_alarm).length,
    planned: sites.filter((s) => v(s.status) === 'planned').length,
    gh: nPts(inv.groundhog),
    dt: nPts(inv.drive_test),
  }
}

export function chipList(r) {
  const chips = []
  for (const t of r.tech) chips.push({ key: 'tech', value: t, label: t })
  for (const t of r.band) chips.push({ key: 'band', value: t, label: t })
  for (const t of r.siteType) chips.push({ key: 'siteType', value: t, label: t })
  for (const t of r.carrier || []) chips.push({ key: 'carrier', value: t, label: `EARFCN ${t}` })
  for (const t of r.status) chips.push({ key: 'status', value: t, label: t })
  for (const t of r.morphology) chips.push({ key: 'morphology', value: t, label: t })
  if (r.inAlarm === true) chips.push({ key: 'inAlarm', value: true, label: 'in alarm' })
  if (r.serviceAffecting === true) chips.push({ key: 'sa', value: true, label: 'service affecting' })
  if (r.pci) chips.push({ key: 'pci', value: r.pci, label: `PCI ${r.pci}` })
  if (r.azimuthRange) chips.push({ key: 'az', value: r.azimuthRange, label: `az ${r.azimuthRange[0]}–${r.azimuthRange[1]}` })
  if (r.identity) chips.push({ key: 'identity', value: r.identity, label: r.identity })
  if (r.onAirFrom) chips.push({ key: 'onAirFrom', value: r.onAirFrom, label: `on-air ≥ ${r.onAirFrom}` })
  if (r.onAirTo) chips.push({ key: 'onAirTo', value: r.onAirTo, label: `on-air ≤ ${r.onAirTo}` })
  if (r.plannedLayer === false) chips.push({ key: 'plannedLayer', value: false, label: 'planned rings off' })
  return chips
}

export function dismissChip(r, chip) {
  const next = { ...r }
  if (['tech', 'band', 'siteType', 'status', 'morphology', 'carrier'].includes(chip.key)) {
    next[chip.key] = r[chip.key].filter((x) => x !== chip.value)
  } else if (chip.key === 'inAlarm') next.inAlarm = null
  else if (chip.key === 'sa') next.serviceAffecting = null
  else if (chip.key === 'pci') next.pci = ''
  else if (chip.key === 'az') next.azimuthRange = null
  else if (chip.key === 'identity') next.identity = ''
  else if (chip.key === 'onAirFrom') next.onAirFrom = ''
  else if (chip.key === 'onAirTo') next.onAirTo = ''
  else if (chip.key === 'plannedLayer') next.plannedLayer = true
  return next
}

function pillBtn(recipe, key, val, n) {
  const on = Array.isArray(recipe[key]) ? recipe[key].includes(val) : recipe[key] === val
  const zero = n === 0
  const reason = EMPTY_REASON[val]
  return `<button type="button" class="pill${on ? ' on' : ''}${zero ? ' zero' : ''}" data-key="${key}" data-val="${val}" title="${reason && zero ? reason : val}">${val}<small> ${n}</small></button>`
}

export function renderFacets(el, inv, recipe, onChange) {
  const enums = inv.enums
  const html = []
  const pushGroup = (title, body) => {
    html.push(`<section class="facet-group"><h2>${title}</h2>${body.join('')}</section>`)
  }
  const loudPills = (title, key, values, getN) => {
    const live = values.filter((val) => getN(val) > 0 || !EMPTY_REASON[val])
    if (!live.length) return
    const rows = live.map((val) => pillBtn(recipe, key, val, getN(val))).join('')
    return `<div class="facet"><h3>${title}</h3><div class="facet-row">${rows}</div></div>`
  }

  const layerStack = []
  layerStack.push(`<div class="facet"><h3>Layer stack</h3>
    <label class="toggle"><input type="checkbox" data-layer="plannedLayer" ${recipe.plannedLayer ? 'checked' : ''}/> Planned sites</label>
    <label class="toggle"><input type="checkbox" data-layer="sectorsLayer" ${recipe.sectorsLayer ? 'checked' : ''}/> Sector lobes</label>
    <label class="toggle"><input type="checkbox" data-layer="ghLayer" ${recipe.ghLayer ? 'checked' : ''}/> Groundhog (${nPts(inv.groundhog).toLocaleString()})</label>
    <label class="toggle"><input type="checkbox" data-layer="dtLayer" ${recipe.dtLayer ? 'checked' : ''}/> Drive test routes (${Number(inv.drive_test_paths?.n_routes || 0).toLocaleString()})</label>
  </div>`)
  pushGroup('Layer Stack', layerStack)

  const filtersCore = []
  const statusRow = loudPills('Status', 'status', enums.status, (val) => inv.sites.filter((s) => v(s.status) === val).length)
  if (statusRow) filtersCore.push(statusRow)
  const bandRow = loudPills('Band', 'band', enums.band.length ? enums.band : ['B3'], (val) => new Set(inv.cells.filter((c) => v(c.band) === val).map((c) => c.site_id)).size)
  if (bandRow) filtersCore.push(bandRow)
  const carriers = [...new Set(inv.cells.map((c) => String(v(c.carrier) || '')).filter(Boolean))].sort()
  if (carriers.length) {
    const carrierRow = loudPills('Carrier', 'carrier', carriers, (val) => new Set(inv.cells.filter((c) => String(v(c.carrier)) === val).map((c) => c.site_id)).size)
    if (carrierRow) filtersCore.push(carrierRow)
  }

  filtersCore.push(`<div class="facet"><h3>Fault</h3><div class="facet-row">
    <button type="button" class="pill${recipe.inAlarm === true ? ' on' : ''}" data-key="inAlarm" data-val="true">in alarm<small> ${inv.sites.filter((s) => s.in_alarm).length}</small></button>
    <button type="button" class="pill${recipe.serviceAffecting === true ? ' on' : ''}" data-key="sa" data-val="true">service affecting</button>
  </div></div>`)
  pushGroup('Layer Filters', filtersCore)

  const vocN = nPts(inv.voc)
  const dated = inv.sites.filter((s) => v(s.on_air_date)).length
  const sourceSummary = []
  sourceSummary.push(`<div class="facet"><h3>Data sources</h3><p class="hint">Sites ${inv.sites.length} · Cells ${inv.cells.length} · VOC ${vocN.toLocaleString()}</p></div>`)
  sourceSummary.push(`<div class="facet"><h3>On-air date</h3>
    <div class="range">
      <label>from <input type="date" data-air="from" value="${recipe.onAirFrom || ''}" /></label>
      <label>to <input type="date" data-air="to" value="${recipe.onAirTo || ''}" /></label>
    </div>
    <p class="hint">${dated} / ${inv.sites.length} sites with dates in current ingest.</p>
  </div>`)
  pushGroup('Data Sources', sourceSummary)

  const techN = (val) => new Set(inv.cells.filter((c) => v(c.tech) === val).map((c) => c.site_id)).size
  const typeN = (val) => inv.sites.filter((s) => v(s.site_type) === val).length
  const morphN = (val) => inv.sites.filter((s) => v(s.morphology) === val).length
  const emptyTech = (enums.tech || []).filter((val) => techN(val) === 0)
  const emptyType = (enums.site_type || []).filter((val) => typeN(val) === 0)
  const liveTech = (enums.tech || []).filter((val) => techN(val) > 0)
  const liveType = (enums.site_type || []).filter((val) => typeN(val) > 0)
  const emptyBits = []
  if (emptyTech.length) emptyBits.push(emptyTech.join(', ') + ' — 4G only')
  if (emptyType.length) emptyBits.push(emptyType.join(', ') + ' — MACRO only')
  if (vocN === 0) emptyBits.push(EMPTY_REASON.VOC)

  const saved = []
  saved.push(`<details class="more-filters"><summary>Advanced filters</summary>`)
  if (liveTech.length) {
    saved.push(`<div class="facet"><h3>Technology</h3><div class="facet-row">${liveTech.map((val) => pillBtn(recipe, 'tech', val, techN(val))).join('')}</div></div>`)
  }
  if (liveType.length) {
    saved.push(`<div class="facet"><h3>Site type</h3><div class="facet-row">${liveType.map((val) => pillBtn(recipe, 'siteType', val, typeN(val))).join('')}</div></div>`)
  }
  const morphRow = loudPills('Morphology', 'morphology', enums.morphology, morphN)
  if (morphRow) saved.push(morphRow)
  saved.push(`<div class="facet"><h3>More layers</h3>
    <label class="toggle"><input type="checkbox" data-layer="spiderLayer" ${recipe.spiderLayer ? 'checked' : ''}/> Co-site spider · z≥14</label>
    <label class="toggle"><input type="checkbox" data-layer="holesLayer" ${recipe.holesLayer ? 'checked' : ''}/> Coverage holes · GH RSRP ≤ −105</label>
    <label class="toggle"><input type="checkbox" data-layer="ghContourLayer" ${recipe.ghContourLayer ? 'checked' : ''}/> Groundhog contour</label>
    <label class="toggle"><input type="checkbox" data-layer="vocLayer" ${recipe.vocLayer ? 'checked' : ''}/> VOC · ${vocN} geocoded</label>
  </div>`)
  saved.push(`<div class="facet"><h3>PCI</h3><input class="pci-in" data-pci value="${recipe.pci || ''}" /></div>`)
  saved.push(`<div class="facet"><h3>Height / tilt</h3><div class="range">
    <label>h min <input type="number" data-h="0" value="${recipe.height[0] ?? ''}" /></label>
    <label>h max <input type="number" data-h="1" value="${recipe.height[1] ?? ''}" /></label>
    <label>tilt min <input type="number" data-t="0" value="${recipe.mechTilt[0] ?? ''}" /></label>
    <label>tilt max <input type="number" data-t="1" value="${recipe.mechTilt[1] ?? ''}" /></label>
  </div></div>`)
  if (emptyBits.length) saved.push(`<p class="hint">${emptyBits.join(' · ')}</p>`)
  saved.push(`</details>`)
  pushGroup('Advanced', saved)

  const wasOpen = el.querySelector('.more-filters')?.open
  el.innerHTML = html.join('')
  if (wasOpen) {
    const d = el.querySelector('.more-filters')
    if (d) d.open = true
  }
  el.querySelectorAll('.pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key
      const val = btn.dataset.val
      const next = { ...recipe }
      if (key === 'inAlarm') next.inAlarm = recipe.inAlarm === true ? null : true
      else if (key === 'sa') next.serviceAffecting = recipe.serviceAffecting === true ? null : true
      else {
        const arr = [...(recipe[key] || [])]
        const i = arr.indexOf(val)
        if (i >= 0) arr.splice(i, 1)
        else arr.push(val)
        next[key] = arr
      }
      onChange(next)
    })
  })
  el.querySelectorAll('[data-layer]').forEach((inp) => {
    inp.addEventListener('change', () => onChange({ ...recipe, [inp.dataset.layer]: inp.checked }))
  })
  const pci = el.querySelector('[data-pci]')
  pci?.addEventListener('change', () => onChange({ ...recipe, pci: pci.value.trim() }))
  el.querySelectorAll('[data-h]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const h = [...recipe.height]
      h[Number(inp.dataset.h)] = inp.value === '' ? null : Number(inp.value)
      onChange({ ...recipe, height: h })
    })
  })
  el.querySelectorAll('[data-t]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const t = [...recipe.mechTilt]
      t[Number(inp.dataset.t)] = inp.value === '' ? null : Number(inp.value)
      onChange({ ...recipe, mechTilt: t })
    })
  })
  el.querySelectorAll('[data-air]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const next = { ...recipe }
      if (inp.dataset.air === 'from') next.onAirFrom = inp.value
      else next.onAirTo = inp.value
      onChange(next)
    })
  })
}
