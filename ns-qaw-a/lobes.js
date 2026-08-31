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

/** Offset origin a few metres so co-sited cells are honest (P3 radial). */
export function offsetOrigin(lng, lat, azimuthDeg, index, meters = 7) {
  const az = ((azimuthDeg + 18 * index) * Math.PI) / 180
  const mLat = meters / 110540
  const mLng = meters / (111320 * Math.cos((lat * Math.PI) / 180))
  return [lng + Math.sin(az) * mLng, lat + Math.cos(az) * mLat]
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
  if (status === 'locked') return '#7B8C96'
  return '#0F4661'
}

export function buildGeo(sites, cells, { bandPin = null, selectedId = null } = {}) {
  const bySite = Object.fromEntries(sites.map((s) => [s.site_id, s]))
  const siteFc = { type: 'FeatureCollection', features: [] }
  const sectorFc = { type: 'FeatureCollection', features: [] }
  const spiderFc = { type: 'FeatureCollection', features: [] }
  const labelFc = { type: 'FeatureCollection', features: [] }

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

  const idxBySite = {}
  for (const c of cells) {
    if (bandPin && v(c.band) !== bandPin) continue
    const site = bySite[c.site_id]
    if (!site) continue
    const lng0 = v(c.lng)
    const lat0 = v(c.lat)
    const az = v(c.azimuth)
    const hpbw = v(c.hpbw) || 65
    const i = (idxBySite[c.site_id] = (idxBySite[c.site_id] || 0) + 1)
    const [lng, lat] = offsetOrigin(lng0, lat0, az, i)
    const reach = 0.0038 + (v(c.height_m) || 30) * 0.00002
    const color = statusColor(v(c.status), c.in_alarm)
    const selected = selectedId === c.site_id || selectedId === c.cell_id
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
        beam_height_m: Math.max(88, (v(c.height_m) || 28) * 3.4),
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
