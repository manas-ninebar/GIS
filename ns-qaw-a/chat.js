import { v } from './lobes.js'
import { defaultRecipe, nPts } from './filters.js'

const STARTERS = [
  'show planned sites',
  'macros in alarm',
  'sectors facing east on TOK_001',
  'show drive test',
  'what alarms?',
]

export function starters() {
  return STARTERS
}

function findSite(inv, text) {
  const u = text.toUpperCase()
  return inv.sites.find((s) => u.includes(s.site_id)) || null
}

export function parseAsk(text, inv, selectedId) {
  const raw = (text || '').trim()
  const t = raw.toLowerCase()
  if (!t) return { type: 'empty' }

  const siteFromText = findSite(inv, raw)
  const site = siteFromText || inv.sites.find((s) => s.site_id === selectedId)

  if (/^(clear|reset)\b/.test(t) || /on-air b3|clear to on-air/.test(t)) {
    const recipe = defaultRecipe()
    recipe.status = ['on-air']
    recipe.band = ['B3']
    return { type: 'recipe', recipe, narrate: 'Reset to on-air B3 macros.', fly: 'cluster' }
  }

  if (/planned/.test(t) && !/is this/.test(t)) {
    const recipe = defaultRecipe()
    recipe.status = ['planned']
    return { type: 'recipe', recipe, narrate: 'New-Capacity / New-Coverage from the cell plan.', fly: 'planned' }
  }

  if (/drive test|show drive/.test(t)) {
    const recipe = defaultRecipe()
    recipe.dtLayer = true
    return { type: 'recipe', recipe, narrate: `Drive-test GPU layer — ${nPts(inv.drive_test).toLocaleString()} samples.`, fly: 'dt' }
  }

  if (/groundhog|heatmap|rsrp layer/.test(t)) {
    const recipe = defaultRecipe()
    recipe.ghLayer = true
    return { type: 'recipe', recipe, narrate: `Groundhog GPU heatmap — ${nPts(inv.groundhog).toLocaleString()} tiles.`, fly: 'gh' }
  }

  if (/\bin alarm\b|macros in alarm|sites in alarm/.test(t) && !/what/.test(t)) {
    const recipe = defaultRecipe()
    recipe.inAlarm = true
    return { type: 'recipe', recipe, narrate: 'TOK_NEW_02 VSWR cascade · TOK_NEW_05 fronthaul.', fly: 'alarms' }
  }

  if (/facing east/.test(t)) {
    const recipe = defaultRecipe()
    recipe.azimuthRange = [45, 135]
    const sid = site?.site_id || 'TOK_001'
    return { type: 'recipe', recipe, select: sid, narrate: `Azimuth 45–135° (east). ${sid}.`, fly: 'select' }
  }

  if (/what alarm|alarms\??$|root cause/.test(t)) {
    return { type: 'qa', q: 'alarms', site, narrate: answerAlarms(site) }
  }
  if (/\bems\b|which ems|ems\?/.test(t)) {
    return { type: 'qa', q: 'ems', site, narrate: site ? `EMS ${v(site.ems_server)} ← cell-plan.` : 'Select a site first.' }
  }
  if (/pci/.test(t)) {
    return { type: 'qa', q: 'pci', site, narrate: answerPci(inv, site, t) }
  }
  if (/azimuth/.test(t)) {
    return { type: 'qa', q: 'az', site, narrate: answerAz(inv, site) }
  }
  if (/is this planned|planned\?/.test(t)) {
    return { type: 'qa', q: 'planned', site, narrate: site ? `${site.site_id} is ${v(site.status)} (${v(site.site_type_plan)} ← cell-plan).` : 'Select a site first.' }
  }
  if (/how many|sukayat|kanto|open 5g/.test(t)) {
    const sx = inv.sukayat_index || {}
    return { type: 'qa', q: 'index', narrate: `Sukayat Open+Kanto: ${sx.open_kanto ?? 0} (no coords). ${JSON.stringify(sx.by_tech || {})}.` }
  }

  if (siteFromText) {
    return { type: 'select', select: siteFromText.site_id, narrate: `Flew to ${siteFromText.site_id}.`, fly: 'select' }
  }

  return { type: 'help', narrate: 'I author filters or answer the selected site. Try a starter.' }
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
