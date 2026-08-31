import { v } from './lobes.js'

export function searchHits(inv, q, limit = 12) {
  const s = (q || '').trim().toLowerCase()
  if (s.length < 2) return []
  const out = []
  for (const site of inv.sites) {
    for (const c of inv.cells.filter((x) => x.site_id === site.site_id)) {
      const keys = [site.site_id, v(site.sarf_id), v(site.enb_name), v(c.ecgi), v(c.cell_name), c.cell_id, String(v(c.pci))]
      if (keys.some((k) => String(k).toLowerCase().includes(s))) {
        out.push({
          siteId: site.site_id,
          cellId: c.cell_id,
          title: `${site.site_id} · ${v(c.cell_name)}`,
          meta: `${v(c.ecgi)} · ${v(site.sarf_id)}`,
          lng: v(site.lng),
          lat: v(site.lat),
        })
        if (out.length >= limit) return out
        break
      }
    }
  }
  return out
}

export function measureDistance(a, b) {
  const from = turf.point(a)
  const to = turf.point(b)
  const m = turf.distance(from, to, { units: 'meters' })
  const brg = turf.bearing(from, to)
  return {
    kind: 'distance',
    meters: m,
    bearing: brg,
    label: `${m.toFixed(0)} m · bearing ${brg.toFixed(0)}°`,
    fc: { type: 'FeatureCollection', features: [turf.lineString([a, b])] },
  }
}

export function measureRadius(center, edge) {
  const m = turf.distance(turf.point(center), turf.point(edge), { units: 'meters' })
  const circle = turf.circle(center, m / 1000, { steps: 64, units: 'kilometers' })
  return {
    kind: 'radius',
    meters: m,
    label: `Radius ${m.toFixed(0)} m`,
    fc: { type: 'FeatureCollection', features: [circle] },
  }
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function layersToGeoJSON(layers) {
  const features = []
  for (const l of layers) {
    for (const f of l.fc.features) {
      features.push({ ...f, properties: { ...f.properties, layer: l.name } })
    }
  }
  return { type: 'FeatureCollection', features }
}

export function layersToKml(layers) {
  const marks = []
  for (const l of layers) {
    for (const f of l.fc.features) {
      const g = f.geometry
      const name = esc(f.properties.label || f.properties.id || l.name)
      if (g.type === 'Point') {
        const [lng, lat] = g.coordinates
        marks.push(`<Placemark><name>${name}</name><Point><coordinates>${lng},${lat},0</coordinates></Point></Placemark>`)
      } else if (g.type === 'LineString') {
        const coords = g.coordinates.map(([lng, lat]) => `${lng},${lat},0`).join(' ')
        marks.push(`<Placemark><name>${name}</name><LineString><coordinates>${coords}</coordinates></LineString></Placemark>`)
      } else if (g.type === 'Polygon') {
        const ring = g.coordinates[0].map(([lng, lat]) => `${lng},${lat},0`).join(' ')
        marks.push(`<Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`)
      }
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>${marks.join('')}</Document></kml>`
}

export function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function parseImport(text, name) {
  const lower = (name || '').toLowerCase()
  if (lower.endsWith('.kml') || text.includes('<kml')) return kmlToFc(text)
  return JSON.parse(text)
}

function kmlToFc(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const features = []
  doc.querySelectorAll('Placemark').forEach((pm) => {
    const name = pm.querySelector('name')?.textContent || 'user'
    const coord = (el) => (el?.textContent || '').trim().split(/\s+/).map((p) => {
      const [lng, lat] = p.split(',').map(Number)
      return [lng, lat]
    }).filter((p) => Number.isFinite(p[0]))
    const pt = pm.querySelector('Point coordinates') || pm.querySelector('Point > coordinates')
    const ls = pm.querySelector('LineString coordinates')
    const pg = pm.querySelector('LinearRing coordinates') || pm.querySelector('Polygon coordinates')
    let geometry = null
    if (pt) geometry = { type: 'Point', coordinates: coord(pt)[0] }
    else if (ls) geometry = { type: 'LineString', coordinates: coord(ls) }
    else if (pg) geometry = { type: 'Polygon', coordinates: [coord(pg)] }
    if (geometry) features.push({ type: 'Feature', properties: { id: name, source: 'user' }, geometry })
  })
  return { type: 'FeatureCollection', features }
}

export function snapshotCanvas(map) {
  return map.getCanvas().toDataURL('image/png')
}

export function downloadPng(dataUrl, filename) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}
