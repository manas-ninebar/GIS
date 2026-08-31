/** Tier-1 neighbour selection — geographic by definition (B1). A sector "faces" the
 *  target site if the bearing to that site falls inside its own HPBW cone. No handover-
 *  count data needed: this is pure geometry over the cell plan already in inventory.json. */
import { v } from './lobes.js'

const EARTH_R = 6371000
const DEFAULT_RADIUS_M = 1200

function toRad(d) { return (d * Math.PI) / 180 }
function toDeg(r) { return (r * 180) / Math.PI }

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

/** Auto-proposed Tier-1 set: other sites' sectors, within radiusM, whose HPBW cone
 *  actually points back at the target site — "facing sectors only", not a top-N list. */
export function tier1Candidates(inv, siteId, { radiusM = DEFAULT_RADIUS_M } = {}) {
  const target = inv.sites.find((s) => s.site_id === siteId)
  if (!target) return []
  const tLat = v(target.lat)
  const tLng = v(target.lng)
  const out = []
  for (const c of inv.cells) {
    if (c.site_id === siteId) continue
    const lat = v(c.lat)
    const lng = v(c.lng)
    if (lat == null || lng == null) continue
    const dist = distanceM(tLat, tLng, lat, lng)
    if (dist > radiusM) continue
    const brg = bearingDeg(lat, lng, tLat, tLng)
    const az = v(c.azimuth)
    const hpbw = v(c.hpbw) || 65
    if (angDiff(brg, az) > hpbw / 2) continue
    out.push({ cellId: c.cell_id, siteId: c.site_id, distanceM: dist, bearingDeg: brg })
  }
  out.sort((a, b) => a.distanceM - b.distanceM)
  return out
}

/** Final monitored set = auto-proposed, plus manual adds, minus manual removes. */
export function monitoredIds(n) {
  if (!n) return new Set()
  const out = new Set(n.auto)
  for (const id of n.added) out.add(id)
  for (const id of n.removed) out.delete(id)
  return out
}

export function neighborLines(inv, targetId, ids) {
  const target = inv.sites.find((s) => s.site_id === targetId)
  if (!target) return { type: 'FeatureCollection', features: [] }
  const tLng = v(target.lng)
  const tLat = v(target.lat)
  const features = []
  for (const id of ids) {
    const c = inv.cells.find((x) => x.cell_id === id)
    if (!c) continue
    features.push({
      type: 'Feature',
      properties: { id },
      geometry: { type: 'LineString', coordinates: [[v(c.lng), v(c.lat)], [tLng, tLat]] },
    })
  }
  return { type: 'FeatureCollection', features }
}
