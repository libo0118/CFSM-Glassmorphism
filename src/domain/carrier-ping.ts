import type { ProbeTarget, ProbeValue } from '@/types/cfsm'
import type { GlassLatencyMetric, GlassServer } from '@/types/glassmorphism'
import { probeSeriesFor, windowAverage, type ProbeSeriesMap } from '@/domain/probe-window'
import { formatLatency, formatProbePercent, MISSING_TEXT } from '@/utils/format'

export type ThreeNetworkTarget = Extract<ProbeTarget, 'cu' | 'ct' | 'cm'>
export type ThreeNetworkKey = 'unicom' | 'telecom' | 'mobile'

export interface ThreeNetworkCarrierSpec {
  readonly target: ThreeNetworkTarget
  readonly key: ThreeNetworkKey
  readonly label: string
  readonly dotClass: string
}

export const THREE_NETWORK_CARRIERS: readonly ThreeNetworkCarrierSpec[] = [
  { target: 'cu', key: 'unicom', label: '联通', dotClass: 'node-probe__carrier-dot--cu' },
  { target: 'ct', key: 'telecom', label: '电信', dotClass: 'node-probe__carrier-dot--ct' },
  { target: 'cm', key: 'mobile', label: '移动', dotClass: 'node-probe__carrier-dot--cm' },
] as const

export interface ThreeNetworkPingBar {
  key: string
  className: string
}

export interface ThreeNetworkMetricDisplay {
  text: string
  title: string
  samples: number
  bars: ThreeNetworkPingBar[]
}

export interface ThreeNetworkCarrierRow {
  target: ThreeNetworkTarget
  key: ThreeNetworkKey
  label: string
  dotClass: string
  latency: ThreeNetworkMetricDisplay
  loss: ThreeNetworkMetricDisplay
}

function isValidProbeValue(value: ProbeValue): boolean {
  if (value === null) return true
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function hasThreeNetworkProbes(server: GlassServer): boolean {
  for (const carrier of THREE_NETWORK_CARRIERS) {
    const metric = server.latency.find((item) => item.target === carrier.target)
    if (metric && (isValidProbeValue(metric.latency) || isValidProbeValue(metric.packetLoss))) {
      return true
    }
    if (
      probeSeriesFor(server.history.latencySeries, carrier.target).length > 0
      || probeSeriesFor(server.history.packetLossSeries, carrier.target).length > 0
    ) {
      return true
    }
  }
  return false
}

function buildCarrierBars(
  metricName: 'latency' | 'loss',
  series: ProbeSeriesMap,
  target: ThreeNetworkTarget,
  tone: (value: number) => string,
  emptyBarCount: number,
): ThreeNetworkPingBar[] {
  const points = probeSeriesFor(series, target)
  if (points.length === 0) {
    const count = Math.max(0, Math.floor(emptyBarCount))
    return Array.from({ length: count }, (_, index) => ({
      key: `${metricName}-${target}-empty-${index}`,
      className: 'is-empty',
    }))
  }
  return points.map((point, index) => ({
    key: `${metricName}-${target}-${point.timestamp}-${index}`,
    className:
      typeof point.value === 'number' && Number.isFinite(point.value)
        ? tone(point.value)
        : 'is-gap',
  }))
}

function buildCarrierMetric(
  carrier: ThreeNetworkCarrierSpec,
  metricName: 'latency' | 'loss',
  averageLabel: string,
  series: ProbeSeriesMap,
  latestMetric: GlassLatencyMetric | undefined,
  formatter: (value: ProbeValue) => string,
  tone: (value: number) => string,
  emptyBarCount: number,
): ThreeNetworkMetricDisplay {
  const avg = windowAverage(series, carrier.target)
  const latestValue: ProbeValue =
    latestMetric === undefined
      ? false
      : metricName === 'latency'
        ? latestMetric.latency
        : latestMetric.packetLoss

  let text = MISSING_TEXT
  let title = `${carrier.label} 暂无探测数据`

  if (avg.value !== null && avg.samples > 0) {
    text = formatter(avg.value)
    title = `${carrier.label} ${averageLabel}：基于 ${avg.samples} 个采样计算`
  } else if (isValidProbeValue(latestValue)) {
    text = formatter(latestValue)
    title = `${carrier.label} 最近一次上报`
  }

  return {
    text,
    title,
    samples: avg.samples,
    bars: buildCarrierBars(metricName, series, carrier.target, tone, emptyBarCount),
  }
}

export function buildThreeNetworkRows(
  server: GlassServer,
  latencyTone: (v: number) => string,
  lossTone: (v: number) => string,
  emptyBarCount = 20,
): ThreeNetworkCarrierRow[] {
  return THREE_NETWORK_CARRIERS.map((carrier) => {
    const latest = server.latency.find((item) => item.target === carrier.target)
    return {
      target: carrier.target,
      key: carrier.key,
      label: carrier.label,
      dotClass: carrier.dotClass,
      latency: buildCarrierMetric(
        carrier,
        'latency',
        '平均延迟',
        server.history.latencySeries,
        latest,
        formatLatency,
        latencyTone,
        emptyBarCount,
      ),
      loss: buildCarrierMetric(
        carrier,
        'loss',
        '平均丢包',
        server.history.packetLossSeries,
        latest,
        formatProbePercent,
        lossTone,
        emptyBarCount,
      ),
    }
  })
}
