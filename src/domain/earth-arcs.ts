import type { RegionCluster } from '@/composables/useServerGeoClusters'

export type EarthArcMode = 'auto' | 'persistent' | 'off'

export interface EarthArcData {
  id: string
  from: [number, number]
  to: [number, number]
}

function isValidCoord(coord: readonly [number, number]): boolean {
  const [lat, lng] = coord
  return (
    typeof lat === 'number'
    && typeof lng === 'number'
    && Number.isFinite(lat)
    && Number.isFinite(lng)
    && lat >= -90
    && lat <= 90
    && lng >= -180
    && lng <= 180
  )
}

function coordKey(coord: readonly [number, number]): string {
  return `${coord[0].toFixed(3)},${coord[1].toFixed(3)}`
}

function compareClustersForHub(left: RegionCluster, right: RegionCluster): number {
  if (right.servers !== left.servers) return right.servers - left.servers
  if (right.onlineServers !== left.onlineServers) return right.onlineServers - left.onlineServers

  const leftCn = left.code.toUpperCase() === 'CN' ? 1 : 0
  const rightCn = right.code.toUpperCase() === 'CN' ? 1 : 0
  if (leftCn !== rightCn) return rightCn - leftCn

  return left.id.localeCompare(right.id)
}

export function buildAutomaticEarthArcs(
  clusters: readonly RegionCluster[],
  limit = 24,
): EarthArcData[] {
  const maxNodes = Number.isNaN(limit) ? 1 : Math.max(0, Math.floor(limit)) + 1
  if (maxNodes < 2) return []

  const sorted = clusters
    .filter((cluster) => isValidCoord(cluster.coord))
    .sort(compareClustersForHub)

  const unique: RegionCluster[] = []
  const seen = new Set<string>()

  for (const cluster of sorted) {
    const key = coordKey(cluster.coord)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(cluster)
    if (unique.length >= maxNodes) break
  }

  const hub = unique[0]
  if (!hub || unique.length < 2) return []

  return unique.slice(1).map((cluster) => ({
    id: `auto:${cluster.id}->${hub.id}`,
    from: [cluster.coord[0], cluster.coord[1]],
    to: [hub.coord[0], hub.coord[1]],
  }))
}

export function buildEarthArcs(
  mode: EarthArcMode,
  clusters: readonly RegionCluster[],
): EarthArcData[] {
  if (mode === 'off') return []
  return buildAutomaticEarthArcs(clusters)
}
