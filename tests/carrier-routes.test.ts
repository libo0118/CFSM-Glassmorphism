import { describe, expect, it } from 'vitest'
import { parseCarrierRoutesConfig, resolveServerTopMeta } from '@/domain/carrier-routes'
import type { GlassServer } from '@/types/glassmorphism'

function makeServer(overrides: Partial<GlassServer> = {}): GlassServer {
  return {
    key: 'example:node-1',
    id: 'node-1',
    sourceBase: 'https://example.invalid',
    sourceLabel: 'Example',
    name: 'HK BGP 01',
    group: '',
    tags: [],
    providerTags: { asn: null, org: null },
    region: 'HK',
    price: null,
    billingCycle: null,
    currency: null,
    expireDate: null,
    trafficLimit: null,
    trafficCalculationType: null,
    showPrice: true,
    showExpire: true,
    showTraffic: true,
    online: true,
    sortOrder: null,
    cpu: 10,
    load: { one: 0.1, five: 0.1, fifteen: 0.1 },
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
    ...overrides,
  }
}

describe('三网回程线路配置解析', () => {
  it('支持多种键值格式、注释与空行过滤', () => {
    const raw = [
      '',
      '# 注释行应当忽略',
      '  // 双斜杠注释也忽略',
      'node-1 = CU:AS4837, ct:CN2 GIA, cm:CMI',
      'JP-01: 联通=9929 电信=163 移动=CMIN2',
      'SG-01 = unicom:4837; telecom:CN2 | mobile:CMI',
      'invalid-line-without-separator',
    ].join('\n')

    const map = parseCarrierRoutesConfig(raw)
    expect(map.get('node-1')).toEqual({
      unicom: 'AS4837',
      telecom: 'CN2 GIA',
      mobile: 'CMI',
    })
    expect(map.get('JP-01')).toEqual({
      unicom: '9929',
      telecom: '163',
      mobile: 'CMIN2',
    })
    expect(map.get('SG-01')).toEqual({
      unicom: '4837',
      telecom: 'CN2',
      mobile: 'CMI',
    })
    expect(map.has('invalid-line-without-separator')).toBe(false)
  })

  it('支持二段/三段简写与短横占位跳过', () => {
    const map = parseCarrierRoutesConfig([
      'n1 = AS4837 / 163 / CMI',
      'n2 : 9929 / - / CMIN2',
      'n3 = AS4837, CN2',
      'n4 = cu:AS4837, ct:-, cm:',
      'n5 = A / B / C / D',
    ].join('\n'))

    expect(map.get('n1')).toEqual({ unicom: 'AS4837', telecom: '163', mobile: 'CMI' })
    expect(map.get('n2')).toEqual({ unicom: '9929', mobile: 'CMIN2' })
    expect(map.get('n3')).toEqual({ unicom: 'AS4837', telecom: 'CN2' })
    expect(map.get('n4')).toEqual({ unicom: 'AS4837' })
    expect(map.has('n5')).toBe(false)
  })
})

describe('节点顶部标签与线路合并规则', () => {
  it('抽取内联运营商标签并保留普通标签，固定按联通->电信->移动排序', () => {
    const server = makeServer({
      tags: ['香港', 'CM-CMI', 'ct:CN2 GIA', '联通 9929', 'custom', 'BGP'],
    })

    const meta = resolveServerTopMeta(server, new Map(), true)
    expect(meta.plainTags).toEqual(['香港', 'custom', 'BGP'])
    expect(meta.routes).toEqual([
      { carrier: 'unicom', label: '9929', source: 'tag' },
      { carrier: 'telecom', label: 'CN2 GIA', source: 'tag' },
      { carrier: 'mobile', label: 'CMI', source: 'tag' },
    ])
  })

  it('配置优先级高于内联 tag，且按 id 优先于 name.trim() 匹配', () => {
    const config = parseCarrierRoutesConfig([
      'node-1 = ct:163',
      'HK BGP 01 = cu:AS4837, ct:CN2, cm:CMI',
    ].join('\n'))
    const server = makeServer({
      id: 'node-1',
      name: '  HK BGP 01  ',
      tags: ['香港', 'cu:9929', 'ct:CN2 GIA'],
    })

    const meta = resolveServerTopMeta(server, config, true)
    expect(meta.plainTags).toEqual(['香港'])
    expect(meta.routes).toEqual([
      { carrier: 'unicom', label: '9929', source: 'tag' },
      { carrier: 'telecom', label: '163', source: 'config' },
    ])

    const byName = resolveServerTopMeta(
      makeServer({ id: 'other-id', name: '  HK BGP 01  ', tags: ['移动=旧移动'] }),
      config,
      true,
    )
    expect(byName.routes).toEqual([
      { carrier: 'unicom', label: 'AS4837', source: 'config' },
      { carrier: 'telecom', label: 'CN2', source: 'config' },
      { carrier: 'mobile', label: 'CMI', source: 'config' },
    ])
  })

  it('关闭线路开关时不返回 routes，但仍清理内联线路标签', () => {
    const config = parseCarrierRoutesConfig('node-1 = AS4837 / 163 / CMI')
    const server = makeServer({
      tags: ['香港', 'cu:9929', 'telecom-CN2', 'mobile CMI', '解锁'],
    })

    const meta = resolveServerTopMeta(server, config, false)
    expect(meta.routes).toEqual([])
    expect(meta.plainTags).toEqual(['香港', '解锁'])
  })
})
