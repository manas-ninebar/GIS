/** Coverage-hole polygons from Groundhog RSRP — real tiles, not invented shapes. */

function emptyFc() {
  return { type: 'FeatureCollection', features: [] }
}

export function buildHoles(gh, { thresh = -105, step = 0.0038, minN = 3 } = {}) {
  if (!gh?.n || !gh.rsrp) return emptyFc()
  const buckets = new Map()
  for (let i = 0; i < gh.n; i++) {
    const rsrp = gh.rsrp[i]
    if (rsrp > thresh) continue
    const lng = gh.positions[i * 3]
    const lat = gh.positions[i * 3 + 1]
    const ix = Math.floor(lng / step)
    const iy = Math.floor(lat / step)
    const key = `${ix}:${iy}`
    let b = buckets.get(key)
    if (!b) {
      b = { ix, iy, n: 0, min: rsrp, sum: 0 }
      buckets.set(key, b)
    }
    b.n += 1
    b.sum += rsrp
    if (rsrp < b.min) b.min = rsrp
  }
  const features = []
  for (const b of buckets.values()) {
    if (b.n < minN) continue
    const west = b.ix * step
    const south = b.iy * step
    const east = west + step
    const north = south + step
    features.push({
      type: 'Feature',
      id: `hole-${b.ix}-${b.iy}`,
      properties: {
        id: `hole-${b.ix}-${b.iy}`,
        n: b.n,
        min_rsrp: Math.round(b.min * 10) / 10,
        mean_rsrp: Math.round((b.sum / b.n) * 10) / 10,
        source: 'gh.bin',
        threshold: thresh,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
      },
    })
  }
  return { type: 'FeatureCollection', features }
}
