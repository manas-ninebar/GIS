/** Tier-1 neighbour selection — geographic by definition (B1). A sector "faces" the
 *  target if the bearing to that point falls inside its own HPBW cone. No handover-
 *  count data needed: this is pure geometry over the cell plan already in inventory.json. */
import { v } from './lobes.js'

const EARTH_R = 6371000
const DEFAULT_RADIUS_M = 1200
const STORE = 'n1_nb_audit_v1'
export const PIN_ID = 'PIN'

function toRad(d) { return (d * Math.PI) / 180 }
function toDeg(r) { return (r * 180) / Math.PI }
function nowIso() { return new Date().toISOString() }

export function distanceM(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.sqrt(a))
}

export function bearingDeg(lat1, lng1, lat2, lng2) {
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2))
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

function angDiff(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Auto-proposed Tier-1 set from a coordinate (inventory site or dropped pin). */
export function tier1CandidatesAt(inv, lat, lng, { radiusM = DEFAULT_RADIUS_M, excludeSiteId = null } = {}) {
  const out = []
  for (const c of inv.cells) {
    if (excludeSiteId && c.site_id === excludeSiteId) continue
    const cLat = v(c.lat)
    const cLng = v(c.lng)
    if (cLat == null || cLng == null) continue
    const dist = distanceM(lat, lng, cLat, cLng)
    if (dist > radiusM) continue
    const brg = bearingDeg(cLat, cLng, lat, lng)
    const az = v(c.azimuth)
    const hpbw = v(c.hpbw) || 65
    if (angDiff(brg, az) > hpbw / 2) continue
    out.push({ cellId: c.cell_id, siteId: c.site_id, distanceM: dist, bearingDeg: brg })
  }
  out.sort((a, b) => a.distanceM - b.distanceM)
  return out
}

export function tier1Candidates(inv, siteId, opts) {
  const target = inv.sites.find((s) => s.site_id === siteId)
  if (!target) return []
  return tier1CandidatesAt(inv, v(target.lat), v(target.lng), { ...opts, excludeSiteId: siteId })
}

export function targetCoords(inv, n) {
  if (!n) return null
  if (n.kind === 'pin') return { lat: n.lat, lng: n.lng }
  const s = inv.sites.find((x) => x.site_id === n.targetId)
  if (!s) return null
  return { lat: v(s.lat), lng: v(s.lng) }
}

/** Final monitored set = auto-proposed, plus manual adds, minus manual removes. */
export function monitoredIds(n) {
  if (!n) return new Set()
  const out = new Set(n.auto)
  for (const id of n.added) out.add(id)
  for (const id of n.removed) out.delete(id)
  return out
}

export function neighborLines(inv, n, ids) {
  const pt = targetCoords(inv, n)
  if (!pt) return { type: 'FeatureCollection', features: [] }
  const features = []
  for (const id of ids) {
    const c = inv.cells.find((x) => x.cell_id === id)
    if (!c) continue
    features.push({
      type: 'Feature',
      properties: { id },
      geometry: { type: 'LineString', coordinates: [[v(c.lng), v(c.lat)], [pt.lng, pt.lat]] },
    })
  }
  return { type: 'FeatureCollection', features }
}

export function candidateFc(n) {
  if (n?.kind !== 'pin') return { type: 'FeatureCollection', features: [] }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      id: PIN_ID,
      properties: { id: PIN_ID, site_id: PIN_ID, status: 'planned' },
      geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
    }],
  }
}

export function sessionKey(n) {
  if (!n) return null
  if (n.kind === 'pin') return `pin:${Number(n.lat).toFixed(5)},${Number(n.lng).toFixed(5)}`
  return `site:${n.targetId}`
}

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}') } catch { return {} }
}

export function persistNeighbors(n) {
  if (!n) return
  const all = readStore()
  all[sessionKey(n)] = {
    key: sessionKey(n),
    kind: n.kind,
    targetId: n.targetId,
    lat: n.lat,
    lng: n.lng,
    auto: [...n.auto],
    added: [...n.added],
    removed: [...n.removed],
    events: n.events || [],
    updatedAt: nowIso(),
  }
  localStorage.setItem(STORE, JSON.stringify(all))
}

export function recallNeighbors(key) {
  if (!key) return null
  return readStore()[key] || null
}

export function applyRecall(autoIds, recalled) {
  const auto = new Set(autoIds)
  const added = new Set((recalled?.added || []).filter((id) => !auto.has(id)))
  const removed = new Set((recalled?.removed || []).filter((id) => auto.has(id)))
  const events = [...(recalled?.events || [])]
  return { auto, added, removed, events }
}

export function appendEvent(n, action, cellId) {
  n.events = n.events || []
  n.events.push({ t: nowIso(), action, cellId: cellId || null })
}

function cellRow(inv, id, n) {
  const c = inv.cells.find((x) => x.cell_id === id)
  if (!c) return { cellId: id, missing: true }
  const origin = n.auto.has(id) && !n.removed.has(id) ? 'auto' : (n.added.has(id) ? 'added' : 'auto')
  return {
    cellId: id,
    siteId: c.site_id,
    cellName: v(c.cell_name),
    pci: v(c.pci),
    azimuth: v(c.azimuth),
    origin: n.removed.has(id) ? 'removed' : origin,
  }
}

export function auditPayload(inv, n) {
  const ids = [...monitoredIds(n)]
  return {
    clock: inv.clock,
    key: sessionKey(n),
    target: n.kind === 'pin'
      ? { kind: 'pin', lat: n.lat, lng: n.lng }
      : { kind: 'site', siteId: n.targetId, lat: n.lat, lng: n.lng },
    rule: 'facing HPBW cone, radius 1.2 km — not a handover top-N list',
    monitored: ids.map((id) => cellRow(inv, id, n)),
    auto: [...n.auto],
    added: [...n.added],
    removed: [...n.removed],
    events: n.events || [],
    updatedAt: (n.events || []).at(-1)?.t || null,
  }
}

export function auditCsv(inv, n) {
  const rows = [['origin', 'site_id', 'cell_id', 'cell_name', 'pci', 'azimuth']]
  for (const row of auditPayload(inv, n).monitored) {
    rows.push([row.origin, row.siteId || '', row.cellId, row.cellName || '', row.pci ?? '', row.azimuth ?? ''])
  }
  rows.push([])
  rows.push(['event_time', 'action', 'cell_id'])
  for (const e of n.events || []) rows.push([e.t, e.action, e.cellId || ''])
  return rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n')
}
