/** Mapsheet Zero lobe geometry — Gaussian −3 dB contour, not a pie. */

export function v(field) {
  if (field && typeof field === 'object' && 'value' in field) return field.value
  return field
}

export function gain(rel, hpbwRad) {
  const a = Math.exp(-2.773 * (rel / (hpbwRad / 2)) ** 2)
  const back = 0.085 * Math.exp(-2.0 * ((Math.abs(rel) - Math.PI) / 1.1) ** 2)
  return Math.max(a, back, 0.035)
}

function wrapPi(rel) {
  while (rel > Math.PI) rel -= Math.PI * 2
  while (rel < -Math.PI) rel += Math.PI * 2
  return rel
}

/** Radial band-offset stacking: same rooftop, different bands walk out along the beam. */
export function offsetOrigin(lng, lat, azimuthDeg, { index = 0, band = 'B3' } = {}) {
  const bandRank = { B1: 0, B3: 1, B7: 2, B8: 3, B28: 4, n78: 5 }
  const radialM = 8 + (bandRank[band] ?? 1) * 6
  const lateralM = index * 3.2
  const az = (azimuthDeg * Math.PI) / 180
  const mLat = 1 / 110540
  const mLng = 1 / (111320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.2))
  const dN = radialM * Math.cos(az) - lateralM * Math.sin(az)
  const dE = radialM * Math.sin(az) + lateralM * Math.cos(az)
  return [lng + dE * mLng, lat + dN * mLat]
}

/** Ground reach from height + mechanical + electrical tilt. HPBW is the −3 dB contour width. */
export function groundReachDeg(heightM, mechTilt, elecTilt) {
  const h = heightM || 30
  const tilt = Math.max(1.5, (mechTilt || 0) + (elecTilt || 0))
  const metres = h / Math.tan((tilt * Math.PI) / 180)
  return Math.min(0.011, Math.max(0.0015, metres / 111320))
}

export function lobePolygon(lng, lat, azimuthDeg, hpbwDeg, reachDeg) {
  const az = (azimuthDeg * Math.PI) / 180
  const hpbw = (hpbwDeg * Math.PI) / 180
  const ring = []
  const n = 72
  for (let i = 0; i <= n; i++) {
    const th = az - Math.PI + (i / n) * Math.PI * 2
    const rel = wrapPi(th - az)
    const r = reachDeg * gain(rel, hpbw)
    const coslat = Math.cos((lat * Math.PI) / 180)
    ring.push([lng + Math.sin(th) * r / Math.max(coslat, 0.2), lat + Math.cos(th) * r])
  }
  ring.push(ring[0])
  return ring
}

function statusColor(status, inAlarm) {
  if (inAlarm || status === 'partial') return '#A9433A'
  if (status === 'planned') return '#9A7614'
  if (status === 'locked') return '#8A8378'
  return '#1A1612'
}

function inBounds(lng, lat, b, pad = 0.04) {
  if (!b) return true
  const west = b.getWest?.() ?? b[0]
  const south = b.getSouth?.() ?? b[1]
  const east = b.getEast?.() ?? b[2]
  const north = b.getNorth?.() ?? b[3]
  return lng >= west - pad && lng <= east + pad && lat >= south - pad && lat <= north + pad
}

export function buildGeo(sites, cells, { bandPin = null, selectedId = null, bounds = null, zoom = 13, keepIds = null } = {}) {
  const bySite = Object.fromEntries(sites.map((s) => [s.site_id, s]))
  const siteFc = { type: 'FeatureCollection', features: [] }
  const sectorFc = { type: 'FeatureCollection', features: [] }
  const spiderFc = { type: 'FeatureCollection', features: [] }
  const labelFc = { type: 'FeatureCollection', features: [] }
  const skipSectors = zoom < 10
  const cullSectors = !skipSectors && cells.length > 2500
  const idxBySite = {}

  for (const s of sites) {
    const lng = v(s.lng)
    const lat = v(s.lat)
    const status = v(s.status)
    siteFc.features.push({
      type: 'Feature',
      id: s.site_id,
      properties: {
        id: s.site_id,
        status,
        in_alarm: s.in_alarm ? 1 : 0,
        color: statusColor(status, s.in_alarm),
        selected: selectedId === s.site_id ? 1 : 0,
      },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    })
  }

  if (!skipSectors) for (const c of cells) {
    // Explicitly monitored cells (Tier-1 neighbours) bypass the band pin and the
    // viewport cull — a filter must not hide a sector we are drawing a connector to.
    const pinned = keepIds?.has(c.cell_id)
    if (!pinned && bandPin && v(c.band) !== bandPin) continue
    const site = bySite[c.site_id]
    if (!site) continue
    const lng0 = v(c.lng)
    const lat0 = v(c.lat)
    if (!pinned && cullSectors && !inBounds(lng0, lat0, bounds)) continue
    const az = v(c.azimuth)
    const hpbw = v(c.hpbw) || 65
    const i = idxBySite[c.site_id] || 0
    idxBySite[c.site_id] = i + 1
    const [lng, lat] = offsetOrigin(lng0, lat0, az, { index: i, band: v(c.band) })
    const reach = groundReachDeg(v(c.height_m) || v(site.height_m), v(c.mech_tilt), v(c.elec_tilt))
    const color = statusColor(v(c.status), c.in_alarm)
    const selected = selectedId === c.site_id || selectedId === c.cell_id
    const tilt = (v(c.mech_tilt) || 0) + (v(c.elec_tilt) || 0)
    sectorFc.features.push({
      type: 'Feature',
      id: c.cell_id,
      properties: {
        id: c.cell_id,
        site_id: c.site_id,
        cell_name: v(c.cell_name),
        pci: v(c.pci),
        band: v(c.band),
        azimuth: az,
        color,
        selected: selected ? 1 : 0,
        in_alarm: c.in_alarm ? 1 : 0,
        beam_height_m: Math.max(40, (v(c.height_m) || 28) * Math.max(1.2, 4.2 - tilt * 0.12)),
      },
      geometry: { type: 'Polygon', coordinates: [lobePolygon(lng, lat, az, hpbw, reach)] },
    })
    spiderFc.features.push({
      type: 'Feature',
      properties: { id: c.cell_id, site_id: c.site_id, color },
      geometry: { type: 'LineString', coordinates: [[lng0, lat0], [lng, lat]] },
    })
    const labelR = reach * 0.62
    const azr = (az * Math.PI) / 180
    const coslat = Math.cos((lat * Math.PI) / 180)
    labelFc.features.push({
      type: 'Feature',
      properties: {
        id: c.cell_id,
        site_id: c.site_id,
        label: `${v(c.cell_name)}  PCI ${v(c.pci)}  ${v(c.band)}`,
        selected,
      },
      geometry: {
        type: 'Point',
        coordinates: [lng + Math.sin(azr) * labelR / Math.max(coslat, 0.2), lat + Math.cos(azr) * labelR],
      },
    })
  }

  return { siteFc, sectorFc, spiderFc, labelFc }
}

/** Planned / coming-soon rings from cell-plan status — not a second invented network. */
export function buildPlanned(sites) {
  const features = []
  for (const s of sites) {
    if (v(s.status) !== 'planned') continue
    const lng = v(s.lng)
    const lat = v(s.lat)
    if (lng == null || lat == null) continue
    features.push({
      type: 'Feature',
      id: `planned-${s.site_id}`,
      properties: { id: s.site_id, site_id: s.site_id, status: 'planned' },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    })
  }
  return { type: 'FeatureCollection', features }
}
