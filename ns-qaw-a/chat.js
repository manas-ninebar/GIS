import { v } from './lobes.js'
import { defaultRecipe, nPts } from './filters.js'

const KEY = 'n1_openai_key'

/** Recommended chips for the current context — not a fixed list. A section (gh/dt/holes)
 *  surfaces next-actions for that section; a selection adds site actions. */
export function contextChips({ section, selected, inv } = {}) {
  const chips = []
  if (section === 'gh') chips.push('coverage holes', 'show drive test', 'back to overview')
  else if (section === 'dt') chips.push('show groundhog', 'back to overview')
  else if (section === 'holes') chips.push('show groundhog', 'back to overview')
  else chips.push('show planned sites', 'macros in alarm', 'show drive test', 'show groundhog')
  if (selected && inv?.sites?.some((s) => s.site_id === selected)) {
    chips.push(`what alarms on ${selected}`, 'clear selection')
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

  if (/drive test|show drive/.test(t)) {
    const recipe = defaultRecipe()
    recipe.dtLayer = true
    recipe.ghLayer = false
    return { type: 'recipe', recipe, section: 'dt', narrate: `Drive-test layer — ${nPts(inv.drive_test).toLocaleString()} samples.`, fly: 'dt' }
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
  if (/voc|complaint/.test(t)) {
    return { type: 'qa', q: 'voc', narrate: 'No geocoded VOC in this TOK ingest — WISE/Sukayat rows have no lat/lng, so nothing is drawn.' }
  }
  if (/how many|sukayat|kanto|open 5g/.test(t)) {
    const sx = inv.sukayat_index || {}
    return { type: 'qa', q: 'index', narrate: `Sukayat Open+Kanto: ${sx.open_kanto ?? 0} (no coords). ${JSON.stringify(sx.by_tech || {})}.` }
  }

  if (siteFromText) {
    return { type: 'select', select: siteFromText.site_id, narrate: `Flew to ${siteFromText.site_id}.`, fly: 'select' }
  }

  return { type: 'help', narrate: 'I can show planned sites, alarms, drive test, Groundhog, 2D/3D, or fly to a TOK_ id. Ask in those terms — or paste an OpenAI key to author any recipe.' }
}

export async function interpret(text, inv, selectedId) {
  const local = parseAsk(text, inv, selectedId)
  if (local.type !== 'help') return local
  const key = getKey()
  if (!key) return local
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-OpenAI-Key': key },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You author a Tokyo RAN map. Reply JSON only:
{"type":"recipe"|"select"|"qa"|"help","recipe":{},"select":null,"fly":null,"narrate":""}
recipe keys (omit to leave default): tech[], band[], siteType[], status[], inAlarm bool|null, view "2d"|"3d", sectorsLayer, spiderLayer, ghLayer, dtLayer, holesLayer, plannedLayer, azimuthRange [lo,hi], pci string, onAirFrom, onAirTo.
fly: planned|alarms|select|dt|gh|cluster|null.
Use only site ids from the digest. Never invent rooftops. If VOC has 0 geocoded points, say so. narrate one short sentence.`,
          },
          { role: 'user', content: JSON.stringify({ ask: text, digest: digest(inv, selectedId) }) },
        ],
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      const err = data.error?.message || data.error || res.statusText
      return { type: 'help', narrate: `OpenAI: ${err}` }
    }
    const raw = data.choices?.[0]?.message?.content
    const intent = JSON.parse(raw)
    if (intent.recipe) intent.recipe = { ...defaultRecipe(), ...intent.recipe }
    if (!intent.narrate) intent.narrate = 'Done.'
    return intent
  } catch (err) {
    return { type: 'help', narrate: `Copilot could not reach OpenAI. Run python serve.py (not http.server). ${err.message || err}` }
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
