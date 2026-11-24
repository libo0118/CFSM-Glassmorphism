import type { GlassServer } from '@/types/glassmorphism'

export type CarrierKey = 'unicom' | 'telecom' | 'mobile'

export interface CarrierRouteEntry {
  carrier: CarrierKey
  label: string
  source: 'config' | 'tag'
}

export interface ServerTopMeta {
  routes: CarrierRouteEntry[]
  plainTags: string[]
}

const CARRIER_ORDER: readonly CarrierKey[] = ['unicom', 'telecom', 'mobile']

const CARRIER_TAG_PATTERNS: readonly { carrier: CarrierKey; pattern: RegExp }[] = [
  { carrier: 'unicom', pattern: /^(?:cu|unicom|联通)[:=\-\s]+(.+)$/i },
  { carrier: 'telecom', pattern: /^(?:ct|telecom|电信)[:=\-\s]+(.+)$/i },
  { carrier: 'mobile', pattern: /^(?:cm|mobile|移动)[:=\-\s]+(.+)$/i },
]

const KEY_VALUE_PAIR_PATTERN = /(?:^|\s)(cu|unicom|联通|ct|telecom|电信|cm|mobile|移动)\s*[:=]/gi

function normalizeCarrierKey(token: string): CarrierKey | null {
  switch (token.trim().toLowerCase()) {
    case 'cu':
    case 'unicom':
    case '联通':
      return 'unicom'
    case 'ct':
    case 'telecom':
    case '电信':
      return 'telecom'
    case 'cm':
    case 'mobile':
    case '移动':
      return 'mobile'
    default:
      return null
  }
}

function normalizeRouteLabel(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '-') return null
  return trimmed
}

function parseKeyValuePairs(right: string): Partial<Record<CarrierKey, string>> | null {
  const parsed: Partial<Record<CarrierKey, string>> = {}
  let matchedAnyKey = false

  for (const segment of right.split(/[,;|]+/)) {
    const trimmedSegment = segment.trim()
    if (!trimmedSegment) continue

    KEY_VALUE_PAIR_PATTERN.lastIndex = 0
    const matches: { carrier: CarrierKey; valueStart: number; matchStart: number }[] = []
    let match: RegExpExecArray | null
    while ((match = KEY_VALUE_PAIR_PATTERN.exec(trimmedSegment)) !== null) {
      const carrier = normalizeCarrierKey(match[1] ?? '')
      if (!carrier) continue
      matches.push({
        carrier,
        matchStart: match.index,
        valueStart: KEY_VALUE_PAIR_PATTERN.lastIndex,
      })
    }

    if (matches.length === 0) continue
    matchedAnyKey = true

    for (let index = 0; index < matches.length; index++) {
      const current = matches[index]
      if (!current) continue
      const next = matches[index + 1]
      const rawValue = trimmedSegment.slice(current.valueStart, next ? next.matchStart : trimmedSegment.length)
      const label = normalizeRouteLabel(rawValue)
      if (label) parsed[current.carrier] = label
    }
  }

  return matchedAnyKey ? parsed : null
}

function parseShorthandSegments(right: string): Partial<Record<CarrierKey, string>> {
  const commaParts = right.includes(',') ? right.split(',') : []
  const slashParts = right.includes('/') ? right.split('/') : []

  let parts: string[] = []
  if (slashParts.length === 3 && commaParts.length !== 3) {
    parts = slashParts
  } else if (commaParts.length >= 2 && commaParts.length <= 3) {
    parts = commaParts
  } else if (slashParts.length >= 2 && slashParts.length <= 3) {
    parts = slashParts
  }
  if (parts.length < 2 || parts.length > 3) return {}

  const parsed: Partial<Record<CarrierKey, string>> = {}
  for (let index = 0; index < parts.length; index++) {
    const carrier = CARRIER_ORDER[index]
    const label = normalizeRouteLabel(parts[index] ?? '')
    if (carrier && label) parsed[carrier] = label
  }
  return parsed
}

function splitConfigLine(line: string): [string, string] | null {
  const eqIndex = line.indexOf('=')
  const colonIndex = line.indexOf(':')
  const sepIndex =
    eqIndex === -1
      ? colonIndex
      : colonIndex === -1
        ? eqIndex
        : Math.min(eqIndex, colonIndex)

  if (sepIndex <= 0) return null
  const left = line.slice(0, sepIndex).trim()
  const right = line.slice(sepIndex + 1).trim()
  if (!left || !right) return null
  return [left, right]
}

export function parseCarrierRoutesConfig(raw: string): Map<string, Partial<Record<CarrierKey, string>>> {
  const map = new Map<string, Partial<Record<CarrierKey, string>>>()
  if (!raw) return map

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue

    const split = splitConfigLine(line)
    if (!split) continue
    const [nodeMatcher, right] = split

    const parsed = parseKeyValuePairs(right) ?? parseShorthandSegments(right)
    if (Object.keys(parsed).length === 0) continue

    const existing = map.get(nodeMatcher)
    map.set(nodeMatcher, existing ? { ...existing, ...parsed } : parsed)
  }

  return map
}

export function resolveServerTopMeta(
  server: GlassServer,
  configMap: ReadonlyMap<string, Partial<Record<CarrierKey, string>>>,
  routesEnabled: boolean,
): ServerTopMeta {
  const tagRoutes = new Map<CarrierKey, string>()
  const plainTags: string[] = []

  for (const tag of server.tags) {
    const trimmed = tag.trim()
    if (!trimmed) continue

    let matchedCarrier: CarrierKey | null = null
    let matchedLabel: string | null = null
    for (const rule of CARRIER_TAG_PATTERNS) {
      const match = rule.pattern.exec(trimmed)
      if (!match) continue
      matchedCarrier = rule.carrier
      matchedLabel = normalizeRouteLabel(match[1] ?? '')
      break
    }

    if (matchedCarrier !== null) {
      if (matchedLabel !== null && !tagRoutes.has(matchedCarrier)) {
        tagRoutes.set(matchedCarrier, matchedLabel)
      }
      continue
    }

    plainTags.push(tag)
  }

  if (!routesEnabled) {
    return { routes: [], plainTags }
  }

  const configRoutes = configMap.get(server.id) ?? configMap.get(server.name.trim())
  const routes: CarrierRouteEntry[] = []

  for (const carrier of CARRIER_ORDER) {
    const configLabel = configRoutes?.[carrier]
    if (configLabel) {
      routes.push({ carrier, label: configLabel, source: 'config' })
      continue
    }
    const tagLabel = tagRoutes.get(carrier)
    if (tagLabel) {
      routes.push({ carrier, label: tagLabel, source: 'tag' })
    }
  }

  return { routes, plainTags }
}
