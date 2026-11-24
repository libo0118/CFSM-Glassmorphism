import { readFileSync } from 'node:fs'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import ServerCard from '@/components/dashboard/ServerCard.vue'
import { buildThreeNetworkRows, hasThreeNetworkProbes } from '@/domain/carrier-ping'
import type { GlassServer } from '@/types/glassmorphism'
import { MISSING_TEXT } from '@/utils/format'

const stylesheet = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
const serverCardSource = readFileSync(new URL('../src/components/dashboard/ServerCard.vue', import.meta.url), 'utf8')

function makeServer(overrides: Partial<GlassServer> = {}): GlassServer {
  return {
    key: 'example:node-1',
    id: 'node-1',
    sourceBase: 'https://example.invalid',
    sourceLabel: 'Example',
    name: 'HK Node',
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
    cpu: 22,
    load: { one: 0.45, five: 0.35, fifteen: 0.25 },
    memory: { used: 1024, total: 4096, percentage: 25 },
    swap: { used: 0, total: 0, percentage: null },
    disk: { used: 10240, total: 40960, percentage: 25 },
    network: {
      inSpeed: 1024,
      outSpeed: 2048,
      received: 10240,
      transmitted: 20480,
      monthlyReceived: 10240,
      monthlyTransmitted: 20480,
    },
    processes: null,
    tcpConnections: null,
    udpConnections: null,
    latency: [],
    history: { latencySeries: {}, packetLossSeries: {} },
    gpus: [],
    connectivity: { ipv4: null, ipv6: null },
    operatingSystem: 'Debian 12',
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

const latencyTone = (v: number) => (v <= 60 ? 'is-signal-1' : 'is-signal-5')
const lossTone = (v: number) => (v <= 1 ? 'is-signal-1' : 'is-signal-5')

describe('三网探测判断与行数据构造', () => {
  it('识别 cu/ct/cm 有效上报与非空历史序列，忽略纯 node_1 或全 false', () => {
    expect(hasThreeNetworkProbes(makeServer())).toBe(false)
    expect(hasThreeNetworkProbes(makeServer({
      latency: [{ target: 'node_1', label: 'Node 1', latency: 35, packetLoss: 0 }],
    }))).toBe(false)
    expect(hasThreeNetworkProbes(makeServer({
      latency: [{ target: 'cu', label: '联通', latency: false, packetLoss: false }],
    }))).toBe(false)
    expect(hasThreeNetworkProbes(makeServer({
      latency: [{ target: 'ct', label: '电信', latency: null, packetLoss: false }],
    }))).toBe(true)
    expect(hasThreeNetworkProbes(makeServer({
      history: {
        latencySeries: { cm: [{ timestamp: 1000, value: 42 }] },
        packetLossSeries: {},
      },
    }))).toBe(true)
  })

  it('按联通->电信->移动返回 3 行，支持窗口均值、最新值回退、20 桶空洞与缺项占位', () => {
    const series20 = Array.from({ length: 20 }, (_, index) => ({
      timestamp: (index + 1) * 1000,
      value: index === 3 ? null : index === 7 ? (false as const) : 30,
    }))

    const server = makeServer({
      latency: [
        { target: 'ct', label: '电信', latency: 52.4, packetLoss: 1.5 },
        { target: 'cu', label: '联通', latency: 99, packetLoss: 0 },
      ],
      history: {
        latencySeries: { cu: series20 },
        packetLossSeries: { ct: [{ timestamp: 1000, value: null }] },
      },
    })

    const rows = buildThreeNetworkRows(server, latencyTone, lossTone)
    expect(rows.map((row) => `${row.target}:${row.key}:${row.label}:${row.dotClass}`)).toEqual([
      'cu:unicom:联通:node-probe__carrier-dot--cu',
      'ct:telecom:电信:node-probe__carrier-dot--ct',
      'cm:mobile:移动:node-probe__carrier-dot--cm',
    ])

    const [unicom, telecom, mobile] = rows
    // 联通：有 18 个有效样本（20 个点含 1 个 null 与 1 个 false）
    expect(unicom?.latency.text).toBe('30.0 ms')
    expect(unicom?.latency.title).toBe('联通 平均延迟：基于 18 个采样计算')
    expect(unicom?.latency.bars).toHaveLength(20)
    expect(unicom?.latency.bars[3]?.className).toBe('is-gap')
    expect(unicom?.latency.bars[7]?.className).toBe('is-gap')
    expect(unicom?.latency.bars[0]?.className).toBe('is-signal-1')

    // 电信：延迟无窗口，回退最近一次上报；丢包窗口仅 null，回退最近一次上报
    expect(telecom?.latency.text).toBe('52.4 ms')
    expect(telecom?.latency.title).toBe('电信 最近一次上报')
    expect(telecom?.latency.bars).toHaveLength(20)
    expect(telecom?.latency.bars.every((bar) => bar.className === 'is-empty')).toBe(true)
    expect(telecom?.loss.text).toBe('1.5%')
    expect(telecom?.loss.bars.map((bar) => bar.className)).toEqual(['is-gap'])

    // 移动：完全无数据时保留 `-` 与 20 根 is-empty 占位柱
    expect(mobile?.latency.text).toBe(MISSING_TEXT)
    expect(mobile?.latency.title).toBe('移动 暂无探测数据')
    expect(mobile?.latency.bars).toHaveLength(20)
    expect(mobile?.latency.bars.every((bar) => bar.className === 'is-empty')).toBe(true)
    expect(mobile?.loss.text).toBe(MISSING_TEXT)
  })
})

describe('ServerCard 三网渲染、顶部标签与线路摘要', () => {
  it('默认开启三网、顶部标签与线路摘要时正确渲染且不传新 props 也兼容', async () => {
    const server = makeServer({
      tags: ['香港', 'BGP', 'cu:AS4837', 'cm:CMI'],
      latency: [
        { target: 'cu', label: '联通', latency: 25, packetLoss: 0 },
        { target: 'ct', label: '电信', latency: 48, packetLoss: 0.5 },
      ],
    })

    const html = await renderToString(createSSRApp(ServerCard, {
      server,
      showSource: false,
      density: 'comfortable',
      favorite: false,
      priceVisible: true,
      carrierRoutesConfig: 'node-1 = ct:CN2 GIA',
    }))

    expect(html).toContain('class="node-card__meta-row"')
    expect(html).toContain('class="node-header-tags"')
    expect(html).toContain('class="node-header-tag"')
    expect(html).toContain('class="node-route-summary"')
    expect(html).toContain('data-carrier-route="unicom"')
    expect(html).toContain('data-carrier-route="telecom"')
    expect(html).toContain('data-carrier-route="mobile"')
    expect(html).toContain('CN2 GIA')
    expect(html).toContain('node-probe--three-net')
    expect(html).toContain('node-probe__carrier-value')
    expect(html).toContain('node-probe__carrier-bars')
    expect(html).not.toContain('class="node-tags"')
  })

  it('关闭三网/顶部标签/线路摘要时回退到单行面板与底部标签', async () => {
    const server = makeServer({
      tags: ['香港', 'cu:AS4837'],
      latency: [{ target: 'cu', label: '联通', latency: 25, packetLoss: 0 }],
    })

    const html = await renderToString(createSSRApp(ServerCard, {
      server,
      showSource: false,
      density: 'mini',
      favorite: false,
      priceVisible: true,
      threeNetworkPing: false,
      topTagsEnabled: false,
      carrierRoutesEnabled: false,
    }))

    expect(html).not.toContain('node-probe--three-net')
    expect(html).not.toContain('node-header-tags')
    expect(html).not.toContain('node-route-summary')
    expect(html).toContain('class="node-probe"')
    expect(html).toContain('class="node-tags"')
    expect(html).toContain('>香港<')
    expect(html).not.toContain('AS4837')
  })

  it('仅配置 node_1 时自动回退到单行面板', async () => {
    const server = makeServer({
      latency: [{ target: 'node_1', label: 'Tokyo', latency: 32, packetLoss: 0 }],
    })

    const html = await renderToString(createSSRApp(ServerCard, {
      server,
      showSource: false,
      density: 'compact',
      favorite: false,
      priceVisible: true,
    }))

    expect(html).not.toContain('node-probe--three-net')
    expect(html).toContain('class="node-probe"')
    expect(html).toContain('32.0 ms')
  })

  it('保留主样式契约并定义三网面板增量样式', () => {
    expect(stylesheet).toContain('.node-probe__carrier-value')
    expect(stylesheet).toContain('.node-probe__carrier-bars')
    expect(stylesheet).toContain('.node-route-summary__item--unicom')
    expect(stylesheet).toContain('.node-route-summary__item--telecom')
    expect(stylesheet).toContain('.node-route-summary__item--mobile')
    expect(serverCardSource).toContain('v-if="!topTagsEnabled && plainTags.length > 0" class="node-tags"')
  })
})
