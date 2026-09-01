import { v } from './lobes.js'
import { defaultRecipe, nPts } from './filters.js'

const KEY = 'n1_openai_key'

/** Verbs for the Copilot rail — labels are what the engineer sees; ask is what parseAsk matches. */
export function contextChips({ section, selected, inv } = {}) {
  const chips = []
  if (section === 'gh') {
    chips.push({ label: 'Coverage holes', ask: 'coverage holes', hint: 'Enable hole polygons' })
    chips.push({ label: 'Drive routes', ask: 'show drive test', hint: 'Show DT path + points' })
    chips.push({ label: 'Overview', ask: 'back to overview', hint: 'Return to base map' })
  } else if (section === 'dt') {
    chips.push({ label: 'Groundhog', ask: 'show groundhog', hint: 'Switch to GH heatmap' })
    chips.push({ label: 'Overview', ask: 'back to overview', hint: 'Return to base map' })
  } else if (section === 'holes') {
    chips.push({ label: 'Groundhog', ask: 'show groundhog', hint: 'Keep GH, hide holes' })
    chips.push({ label: 'Overview', ask: 'back to overview', hint: 'Return to base map' })
  } else if (section === 'neighbors') {
    chips.push({ label: 'Export JSON', ask: 'export neighbour audit json', hint: 'Download audit trail' })
    chips.push({ label: 'Export CSV', ask: 'export neighbour audit csv', hint: 'Download tabular audit' })
    chips.push({ label: 'Drop site', ask: 'drop a new site', hint: 'Create candidate pin' })
    chips.push({ label: 'Overview', ask: 'back to overview', hint: 'Return to base map' })
  } else {
    chips.push({ label: 'Planned sites', ask: 'show planned sites', hint: 'Planned layer and filter' })
    chips.push({ label: 'Sites in alarm', ask: 'macros in alarm', hint: 'Fault-focused shortlist' })
    chips.push({ label: 'Drive routes', ask: 'show drive test', hint: 'Enable DT path + points' })
    chips.push({ label: 'Groundhog', ask: 'show groundhog', hint: 'Enable GH signal layer' })
    chips.push({ label: 'Drop site', ask: 'drop a new site', hint: 'Start Tier-1 workflow' })
  }
  if (selected && inv?.sites?.some((s) => s.site_id === selected)) {
    if (section !== 'neighbors') chips.push({ label: `Tier-1 for ${selected}`, ask: `tier-1 neighbours for ${selected}`, hint: 'Facing sectors within 1.2 km' })
    chips.push({ label: `Alarms on ${selected}`, ask: `what alarms on ${selected}`, hint: 'Root cause and severity' })
    chips.push({ label: `Azimuth on ${selected}`, ask: `azimuth for ${selected}`, hint: 'Sector direction check' })
  }
  return chips
}

export function getKey() {
  return (localStorage.getItem(KEY) || '').trim()
}

export function setKey(value) {
  const v = (value || '').trim()
  if (v) localStorage.setItem(KEY, v)
  else localStorage.removeItem(KEY)
}

function findSite(inv, text) {
  const u = (text || '').toUpperCase()
  const hit = inv.sites.find((s) => u.includes(s.site_id))
  if (hit) return hit
  return inv.sites.find((s) => {
    const sarf = String(v(s.sarf_id) || '').toUpperCase()
    return sarf && u.includes(sarf)
  }) || null
}

function digest(inv, selectedId) {
  return {
    clock: inv.clock,
    selected: selectedId,
    counts: { sites: inv.sites.length, cells: inv.cells.length },
    sites: inv.sites.map((s) => ({
      id: s.site_id,
      status: v(s.status),
      type: v(s.site_type),
      alarm: !!s.in_alarm,
      sarf: v(s.sarf_id),
    })),
    alarms: inv.sites.filter((s) => s.in_alarm).map((s) => ({
      id: s.site_id,
      problems: (s.alarms || []).map((a) => a.problem),
    })),
    layers: {
      gh: nPts(inv.groundhog),
      dt: nPts(inv.drive_test),
      voc: nPts(inv.voc),
    },
  }
}

export function parseAsk(text, inv, selectedId) {
  const raw = (text || '').trim()
  const t = raw.toLowerCase()
  if (!t) return { type: 'empty' }

  const siteFromText = findSite(inv, raw)
  const site = siteFromText || inv.sites.find((s) => s.site_id === selectedId)

  if (/\b3d\b|three.?d|terrain view/.test(t)) {
    const recipe = defaultRecipe()
    recipe.view = '3d'
    return { type: 'recipe', recipe, narrate: '3D on — terrain, buildings, beams at street zoom.', fly: 'cluster' }
  }
  if (/\b2d\b|plan view|flat map/.test(t)) {
    const recipe = defaultRecipe()
    recipe.view = '2d'
    return { type: 'recipe', recipe, narrate: 'Plan view. 3D off.', fly: 'cluster' }
  }

  if (/back to overview|exit section|clear section/.test(t)) {
    const recipe = defaultRecipe()
    return { type: 'recipe', recipe, section: null, narrate: 'Back to overview.', fly: 'cluster' }
  }

  if (/clear selection|deselect/.test(t)) {
    return { type: 'select', select: null, narrate: 'Selection cleared.' }
  }

  if (/^(clear|reset)\b/.test(t) || /on-air b3|clear to on-air/.test(t)) {
    const recipe = defaultRecipe()
    recipe.status = ['on-air']
    recipe.band = ['B3']
    return { type: 'recipe', recipe, narrate: 'Reset to on-air B3 macros.', fly: 'cluster' }
  }

  if (/\bplanned\b|coming soon/.test(t) && !/is this/.test(t)) {
    const recipe = defaultRecipe()
    recipe.status = ['planned']
    recipe.plannedLayer = true
    const n = inv.sites.filter((s) => v(s.status) === 'planned').length
    return { type: 'recipe', recipe, section: null, narrate: `${n} planned rooftops from the cell plan (siteType New) — gold rings. Not an ECGI-master coming-soon file.`, fly: 'planned' }
  }

  if (/drive test|show drive|drive route|drive path/.test(t)) {
    const recipe = defaultRecipe()
    recipe.dtLayer = true
    recipe.ghLayer = false
    const routes = Number(inv.drive_test_paths?.n_routes || 0)
    return { type: 'recipe', recipe, section: 'dt', narrate: `Drive test on: ${routes.toLocaleString()} routes, ${nPts(inv.drive_test).toLocaleString()} points.`, fly: 'dt' }
  }

  if (/groundhog|heatmap|rsrp layer/.test(t)) {
    const recipe = defaultRecipe()
    recipe.ghLayer = true
    recipe.dtLayer = false
    return { type: 'recipe', recipe, section: 'gh', narrate: `Groundhog heatmap — ${nPts(inv.groundhog).toLocaleString()} samples.`, fly: 'gh' }
  }

  if (/\bholes?\b|coverage hole/.test(t)) {
    const recipe = defaultRecipe()
    recipe.holesLayer = true
    recipe.ghLayer = true
    recipe.dtLayer = false
    return { type: 'recipe', recipe, section: 'holes', narrate: 'Coverage holes from Groundhog RSRP ≤ −105 dBm.', fly: 'gh' }
  }

  if (/tier.?1|tier 1|show neighbou?rs?|neighbou?rs? for/.test(t)) {
    const sid = site?.site_id
    if (!sid) return { type: 'help', narrate: 'Name a site or select one first (e.g. "tier-1 neighbours for TOK_001"), or say "drop a new site" to pin a candidate rooftop.' }
    return { type: 'neighbors', siteId: sid, narrate: `Tier-1 facing neighbours for ${sid} — auto-proposed within 1.2 km, click a sector on the map to add or remove it.` }
  }

  if (/drop (a )?new site|place (a )?(candidate|new site)|pin (a )?(site|candidate)|new site here/.test(t)) {
    return { type: 'drop', narrate: 'Drop tool on — click the map to place a candidate rooftop. Facing sectors auto-propose. This is not an inventory site.' }
  }

  if (/export neighbou?r/.test(t)) {
    return { type: 'audit', format: /csv/.test(t) ? 'csv' : 'json', narrate: 'Exporting the monitored neighbour set and the add/remove trail.' }
  }

  if (/\bin alarm\b|macros in alarm|sites in alarm/.test(t) && !/what/.test(t)) {
    const recipe = defaultRecipe()
    recipe.inAlarm = true
    return { type: 'recipe', recipe, narrate: 'Sites in alarm — TOK_NEW_02 VSWR, TOK_NEW_05 fronthaul.', fly: 'alarms' }
  }

  if (/facing east|point(?:ing)? east/.test(t)) {
    const recipe = defaultRecipe()
    recipe.azimuthRange = [45, 135]
    const sid = site?.site_id || 'TOK_001'
    return { type: 'recipe', recipe, select: sid, narrate: `Sectors facing east (45–135°). ${sid}.`, fly: 'select' }
  }
  if (/facing west/.test(t)) {
    const recipe = defaultRecipe()
    recipe.azimuthRange = [225, 315]
    const sid = site?.site_id || 'TOK_001'
    return { type: 'recipe', recipe, select: sid, narrate: `Sectors facing west. ${sid}.`, fly: 'select' }
  }
  if (/facing north/.test(t)) {
    const recipe = defaultRecipe()
    recipe.azimuthRange = [315, 45]
    const sid = site?.site_id || 'TOK_001'
    return { type: 'recipe', recipe, select: sid, narrate: `Sectors facing north. ${sid}.`, fly: 'select' }
  }
  if (/facing south/.test(t)) {
    const recipe = defaultRecipe()
    recipe.azimuthRange = [135, 225]
    const sid = site?.site_id || 'TOK_001'
    return { type: 'recipe', recipe, select: sid, narrate: `Sectors facing south. ${sid}.`, fly: 'select' }
  }

  if (/what alarm|alarms\??$|root cause/.test(t)) {
    return { type: 'qa', q: 'alarms', site, narrate: answerAlarms(site), select: site?.site_id, fly: site ? 'select' : null }
  }
  if (/\bems\b|which ems|ems\?/.test(t)) {
    return { type: 'qa', q: 'ems', site, narrate: site ? `EMS ${v(site.ems_server)} ← cell-plan.` : 'Select a site first, or name one (TOK_001).' }
  }
  if (/\bpci\b/.test(t) && (site || /sec\s*[123]/.test(t))) {
    return { type: 'qa', q: 'pci', site, narrate: answerPci(inv, site, t) }
  }
  if (/azimuth/.test(t) && site) {
    return { type: 'qa', q: 'az', site, narrate: answerAz(inv, site) }
  }
  if (/is this planned|planned\?/.test(t)) {
    return { type: 'qa', q: 'planned', site, narrate: site ? `${site.site_id} is ${v(site.status)} (${v(site.site_type_plan)} ← cell-plan).` : 'Select a site first.' }
  }
  if (/mmwave|5g sub-?6|\briud\b|\bdas\b|\bidsc\b|\bodsc\b/.test(t) && !/how many|sukayat/.test(t)) {
    return { type: 'qa', q: 'empty-enum', narrate: 'This TOK ingest is 4G B3 macro only. Those filters exist and show 0 — no rooftops invented for 5G, mmWave, RIUD, DAS, IDSC or ODSC.' }
  }
  if (/voc|complaint/.test(t)) {
    const total = nPts(inv.voc)
    const tokyo = Number(inv.voc?.tokyo_n || 0)
    if (!total) {
      return { type: 'qa', q: 'voc', narrate: 'No geocoded VOC loaded in this ingest.' }
    }
    return { type: 'qa', q: 'voc', narrate: `VOC loaded: ${total.toLocaleString()} geocoded rows (${tokyo.toLocaleString()} in Tokyo bounds).` }
  }
  if (/how many|sukayat|kanto|open 5g/.test(t)) {
    const sx = inv.sukayat_index || {}
    return { type: 'qa', q: 'index', narrate: `Sukayat Open+Kanto: ${sx.open_kanto ?? 0} (no coords). ${JSON.stringify(sx.by_tech || {})}.` }
  }

  if (siteFromText) {
    return { type: 'select', select: siteFromText.site_id, narrate: `Flew to ${siteFromText.site_id}.`, fly: 'select' }
  }

  return { type: 'help', narrate: 'Try: planned sites, sites in alarm, show drive test, show groundhog, or tier-1 neighbours for TOK_001.' }
}

export async function interpret(text, inv, selectedId) {
  const local = parseAsk(text, inv, selectedId)
  if (local.type !== 'help') return local
  const headers = { 'Content-Type': 'application/json' }
  const key = getKey()
  if (key) headers['X-OpenAI-Key'] = key
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You author a Tokyo RAN map. Reply JSON only:
{"type":"recipe"|"select"|"qa"|"neighbors"|"drop"|"audit"|"help","recipe":{},"select":null,"siteId":null,"fly":null,"narrate":""}
recipe keys (omit to leave default): tech[], band[], siteType[], status[], inAlarm bool|null, view "2d"|"3d", sectorsLayer, spiderLayer, ghLayer, dtLayer, holesLayer, plannedLayer, ghContourLayer, azimuthRange [lo,hi], pci string, onAirFrom, onAirTo.
fly: planned|alarms|select|dt|gh|cluster|null.
type "neighbors" shows Tier-1 facing neighbours for one inventory site — set siteId (required).
type "drop" arms the pin-drop tool for a candidate rooftop (not an inventory site).
type "audit" exports the current neighbour monitored set.
Use only site ids from the digest. Never invent rooftops, 5G, mmWave, RIUD or DAS cells. If VOC has 0 geocoded points, say so. narrate one short sentence.`,
          },
          { role: 'user', content: JSON.stringify({ ask: text, digest: digest(inv, selectedId) }) },
        ],
      }),
    })
    if (res.status === 401 || !res.ok) return local
    const data = await res.json()
    const raw = data.choices?.[0]?.message?.content
    const intent = JSON.parse(raw)
    if (intent.recipe) intent.recipe = { ...defaultRecipe(), ...intent.recipe }
    if (!intent.narrate) intent.narrate = 'Done.'
    return intent
  } catch {
    return local
  }
}

function answerAlarms(site) {
  if (!site) return 'Select a site — or say “macros in alarm”.'
  if (!site.alarms?.length) return `${site.site_id} has no active TOK FM alarms.`
  const root = site.alarms.find((a) => a.root_cause)
  const lines = site.alarms.map((a) => `${a.severity} ${a.problem}${a.root_cause ? ' ← root' : ''}`).join('; ')
  return `${site.site_id}: ${lines}. ${root ? `Root ${root.problem} ← tok-fm.` : ''}`
}

function answerPci(inv, site, t) {
  if (!site) return 'Select a site, or name one (TOK_001).'
  const m = t.match(/sec\s*([123])/)
  const cells = inv.cells.filter((c) => c.site_id === site.site_id)
  if (m) {
    const c = cells.find((x) => v(x.cell_name) === `Sec${m[1]}`)
    return c ? `PCI ${v(c.pci)} on ${c.cell_id} ← cell-plan.` : `No Sec${m[1]} on ${site.site_id}.`
  }
  return cells.map((c) => `${v(c.cell_name)} PCI ${v(c.pci)}`).join(' · ') + ' ← cell-plan.'
}

function answerAz(inv, site) {
  if (!site) return 'Select a site first.'
  return inv.cells.filter((c) => c.site_id === site.site_id)
    .map((c) => `${v(c.cell_name)} ${v(c.azimuth)}°`)
    .join(' · ') + ' ← antennaBearing cell-plan.'
}
