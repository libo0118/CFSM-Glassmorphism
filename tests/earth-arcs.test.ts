import { readFileSync } from 'node:fs'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import NodeEarthTiledMap from '@/components/dashboard/NodeEarthTiledMap.vue'
import type { RegionCluster } from '@/composables/useServerGeoClusters'
import { buildAutomaticEarthArcs, buildEarthArcs } from '@/domain/earth-arcs'
import type { GlassServer } from '@/types/glassmorphism'

function cluster(
  id: string,
  code: string,
  coord: [number, number],
  servers = 1,
  onlineServers = 1,
): RegionCluster {
  return {
    id,
    code,
    coord,
    label: id.toUpperCase(),
    servers,
    onlineServers,
    members: [],
  }
}

function makeServer(id: string, region: string, online = true): GlassServer {
  return {
    key: `source:${id}`,
    id,
    sourceBase: 'https://status.example',
    sourceLabel: 'status.example',
    name: `Node ${id}`,
    group: '',
    tags: [],
    providerTags: { asn: null, org: null },
    region,
    price: null,
    billingCycle: null,
    currency: null,
    expireDate: null,
    trafficLimit: null,
    trafficCalculationType: null,
    showPrice: true,
    showExpire: true,
    showTraffic: true,
    online,
    sortOrder: null,
    cpu: null,
    load: { one: null, five: null, fifteen: null },
    memory: { used: null, total: null, percentage: null },
    swap: { used: null, total: null, percentage: null },
    disk: { used: null, total: null, percentage: null },
    network: {
      inSpeed: null,
      outSpeed: null,
      received: null,
      transmitted: null,
      monthlyReceived: null,
      monthlyTransmitted: null,
    },
    processes: null,
    tcpConnections: null,
    udpConnections: null,
    latency: [],
    history: { latencySeries: {}, packetLossSeries: {} },
    gpus: [],
    connectivity: { ipv4: null, ipv6: null },
    operatingSystem: null,
    architecture: null,
    cpuInfo: null,
    cpuCores: null,
    kernelVersion: null,
    agentVersion: null,
    bootTime: null,
    lastUpdated: null,
  }
}

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

describe('buildAutomaticEarthArcs and buildEarthArcs', () => {
  it('returns empty array when fewer than two valid clusters exist or mode is off', () => {
    const single = [cluster('hk', 'HK', [22.3, 114.2], 3, 2)]
    expect(buildAutomaticEarthArcs([])).toEqual([])
    expect(buildAutomaticEarthArcs(single)).toEqual([])

    const two = [
      cluster('hk', 'HK', [22.3, 114.2], 3, 2),
      cluster('jp', 'JP', [35.6, 139.7], 2, 2),
    ]
    expect(buildEarthArcs('off', two)).toEqual([])
    expect(buildEarthArcs('auto', two)).toEqual(buildEarthArcs('persistent', two))
  })

  it('filters invalid coordinates and deduplicates by 3-decimal coordinate key', () => {
    const arcs = buildAutomaticEarthArcs([
      cluster('bad-nan', 'XX', [Number.NaN, 10], 99, 99),
      cluster('bad-lat', 'YY', [95, 10], 88, 88),
      cluster('bad-lng', 'ZZ', [10, -181], 77, 77),
      cluster('sg-dup-low', 'SG', [1.3521, 103.8198], 2, 1),
      cluster('sg-dup-high', 'SG', [1.3524, 103.8199], 5, 5),
      cluster('us', 'US', [37.09, -95.71], 3, 3),
    ])

    expect(arcs).toEqual([
      {
        id: 'auto:us->sg-dup-high',
        from: [37.09, -95.71],
        to: [1.3524, 103.8199],
      },
    ])
  })

  it('prefers CN as hub on server and online tie before id order, and respects limit', () => {
    const arcs = buildAutomaticEarthArcs([
      cluster('aa', 'AA', [10, 10], 4, 4),
      cluster('us', 'US', [37.09, -95.71], 4, 4),
      cluster('cn', 'cn', [35.86, 104.2], 4, 4),
      cluster('jp', 'JP', [35.68, 139.69], 4, 2),
    ], 2)

    expect(arcs).toEqual([
      { id: 'auto:aa->cn', from: [10, 10], to: [35.86, 104.2] },
      { id: 'auto:us->cn', from: [37.09, -95.71], to: [35.86, 104.2] },
    ])
  })

  it('picks higher onlineServers as hub when total servers tie', () => {
    const arcs = buildAutomaticEarthArcs([
      cluster('cn', 'CN', [35.86, 104.2], 5, 2),
      cluster('hk', 'HK', [22.3, 114.2], 5, 5),
    ])

    expect(arcs).toEqual([
      { id: 'auto:cn->hk', from: [35.86, 104.2], to: [22.3, 114.2] },
    ])
  })
})

describe('EarthMap and renderer arc wiring', () => {
  it('forwards arcMode and disableAnimation through EarthMap to all three renderers', () => {
    const earthMap = source('../src/components/dashboard/EarthMap.vue')
    expect(earthMap).toContain('arcMode?: EarthArcMode')
    expect(earthMap).toContain('disableAnimation?: boolean')
    expect(earthMap).toContain(':arc-mode="props.arcMode ?? \'auto\'"')
    expect(earthMap).toContain(':disable-animation="props.disableAnimation"')

    const realistic = source('../src/components/dashboard/NodeEarthRealisticGlobe.vue')
    expect(realistic).toContain('buildEarthArcs')
    expect(realistic).toContain('.arcsData(arcsData.value)')
    expect(realistic).toContain('.arcDashLength(')
    expect(realistic).toContain('.arcDashGap(')
    expect(realistic).toContain('.arcDashAnimateTime(')
    expect(realistic).toContain(':data-earth-arc-count="earthArcs.length"')
    expect(realistic).toContain(':data-earth-arc-motion=')

    const cobe = source('../src/components/dashboard/NodeEarthCobeGlobe.vue')
    expect(cobe).toContain('buildEarthArcs')
    expect(cobe).toContain('arcs: arcs.value')
    expect(cobe).toContain('arcColor:')
    expect(cobe).toContain('arcWidth: 0.8')
    expect(cobe).toContain('arcHeight: 0.4')
    expect(cobe).toContain('globe.update({ markers: markers.value, arcs: arcs.value })')
    expect(cobe).toContain(':data-earth-arc-count="earthArcs.length"')
  })

  it('renders quadratic Bezier arcs on NodeEarthTiledMap according to arcMode and disableAnimation', async () => {
    const servers = [
      makeServer('cn-1', 'CN'),
      makeServer('hk-1', 'HK'),
      makeServer('us-1', 'US'),
    ]

    const autoHtml = await renderToString(createSSRApp(NodeEarthTiledMap, {
      servers,
      arcMode: 'auto',
      disableAnimation: false,
    }))
    expect(autoHtml).toContain('data-earth-arc-count="2"')
    expect(autoHtml).toContain('data-earth-arc-motion="dynamic"')
    expect(autoHtml).toContain('class="earth-arcs"')
    expect(autoHtml).toMatch(/<path(?=[^>]*class="earth-arc")(?=[^>]*d="M [^"]* Q [^"]*")[^>]*>/)
    expect(autoHtml).not.toContain('earth-continents')
    expect(autoHtml).not.toContain('earth-silhouette')

    const persistentHtml = await renderToString(createSSRApp(NodeEarthTiledMap, {
      servers,
      arcMode: 'persistent',
      disableAnimation: true,
    }))
    expect(persistentHtml).toContain('data-earth-arc-count="2"')
    expect(persistentHtml).toContain('data-earth-arc-motion="persistent"')
    expect(persistentHtml).toContain('is-persistent')
    expect(persistentHtml).toContain('is-static')

    const offHtml = await renderToString(createSSRApp(NodeEarthTiledMap, {
      servers,
      arcMode: 'off',
    }))
    expect(offHtml).toContain('data-earth-arc-count="0"')
    expect(offHtml).not.toContain('class="earth-arcs')
  })
})
