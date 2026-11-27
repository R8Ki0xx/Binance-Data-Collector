import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import TradingViewChart from '@/components/klines/TradingViewChart'
import { pollAiStream } from '@/lib/pollAiStream'
import { formatDateTime, formatRelativeTime } from '@/lib/dateTime'
import {
  type LargeOrderZoneItem,
  type MarketFlowSummaryItem,
  type NewsArticle,
  startHyperAiInsightAnalysis,
} from '@/lib/api'

type InsightExchange = 'hyperliquid' | 'binance'
type InsightPeriod = '5m' | '15m' | '1h'
type InsightWindow = '4h'
type InsightAiState = 'idle' | 'monitoring' | 'thinking' | 'ready' | 'error'
type InsightSentiment = 'bullish' | 'bearish' | 'mixed'
type InsightDriverImpact = 'high' | 'medium' | 'low'

interface InsightDriver {
  text: string
  impact: InsightDriverImpact
  tone?: InsightSentiment
}

interface InsightSentimentBreakdown {
  technical: number
  flow: number
  news: number
}

interface InsightTechnicalLevel {
  price: number
  type: 'support' | 'resistance'
  label?: string
}

interface InsightChartPoint {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface InsightEvent {
  id: string
  kind: 'news' | 'flow'
  iconVariant: 'news' | 'flow-up' | 'flow-down'
  time: number
  title: string
  summary: string
  tone: 'bullish' | 'bearish' | 'mixed'
  sourceUrl?: string
  imageUrl?: string | null
  evidence: string[]
}

interface StructuredAiInsight {
  sentiment: InsightSentiment
  probability: number
  market_emotion: string
  headline: string
  summary: string
  sentiment_breakdown?: InsightSentimentBreakdown | null
  next_cycle_period: string
  next_cycle_target_price?: number | null
  next_cycle_range_low?: number | null
  next_cycle_range_high?: number | null
  technical_levels: InsightTechnicalLevel[]
  key_drivers: InsightDriver[]
  risks: string[]
  confidence_basis?: string
  similar_pattern?: string
  explanation_markdown?: string
}

function AnimatedMetricValue({
  value,
  className,
}: {
  value: string
  className?: string
}) {
  return (
    <span key={value} className={`inline-block animate-[metric-flip-in_320ms_ease-out] ${className || ''}`}>
      {value}
    </span>
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function formatCompactUsd(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(2)}K`
  return `$${value.toFixed(0)}`
}

function formatPercent(value?: number | null, digits: number = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`
}

function formatAbsoluteUsd(value?: number | null) {
  return formatCompactUsd(Math.abs(value || 0))
}

function formatPrice(value?: number | null, digits: number = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`
}

function getSentimentTheme(sentiment: InsightSentiment) {
  if (sentiment === 'bullish') {
    return {
      text: 'text-emerald-600',
      softText: 'text-emerald-700',
      softBg: 'bg-emerald-50',
      border: 'border-emerald-200/80',
      glow: 'shadow-[0_0_32px_rgba(16,185,129,0.18)]',
    }
  }

  if (sentiment === 'bearish') {
    return {
      text: 'text-red-600',
      softText: 'text-red-700',
      softBg: 'bg-red-50',
      border: 'border-red-200/80',
      glow: 'shadow-[0_0_32px_rgba(239,68,68,0.18)]',
    }
  }

  return {
    text: 'text-cyan-600',
    softText: 'text-cyan-700',
    softBg: 'bg-cyan-50',
    border: 'border-cyan-200/80',
    glow: 'shadow-[0_0_32px_rgba(8,145,178,0.18)]',
  }
}

function getImpactBadgeClass(impact: InsightDriverImpact) {
  if (impact === 'high') return 'border-transparent bg-foreground text-background'
  if (impact === 'medium') return 'border-border bg-muted/80 text-foreground'
  return 'border-border/80 bg-background text-muted-foreground'
}

function getBreakdownBarClass(value: number) {
  if (value >= 60) return 'from-emerald-400 via-emerald-500 to-emerald-600'
  if (value >= 40) return 'from-amber-300 via-amber-400 to-amber-500'
  return 'from-rose-300 via-rose-400 to-rose-500'
}

function renderSemanticText(text: string) {
  if (!text) return null

  const pattern = /([+-]?\d+(?:\.\d+)?%|bullish|bearish|mixed|support|resistance|breakout|breakdown|accumulation|distribution|inflow|outflow|buying|selling|买盘|卖盘|看多|看空|中性|支撑|阻力|突破|跌破|吸筹|派发|流入|流出)/gi
  const parts = text.split(pattern)

  return parts.map((part, index) => {
    if (!part) return null

    const normalized = part.toLowerCase()
    let className = ''

    if (/^[+-]?\d+(?:\.\d+)?%$/.test(part)) {
      className = part.startsWith('-') ? 'text-red-700' : 'text-emerald-700'
    } else if ([
      'bullish', 'support', 'breakout', 'accumulation', 'inflow', 'buying',
      '买盘', '看多', '支撑', '突破', '吸筹', '流入',
    ].includes(normalized) || ['买盘', '看多', '支撑', '突破', '吸筹', '流入'].includes(part)) {
      className = 'text-emerald-700'
    } else if ([
      'bearish', 'resistance', 'breakdown', 'distribution', 'outflow', 'selling',
      '卖盘', '看空', '阻力', '跌破', '派发', '流出',
    ].includes(normalized) || ['卖盘', '看空', '阻力', '跌破', '派发', '流出'].includes(part)) {
      className = 'text-red-700'
    } else if (normalized === 'mixed' || part === '中性') {
      className = 'text-cyan-700'
    }

    if (!className) return <span key={index}>{part}</span>
    return <span key={index} className={`${className} font-medium`}>{part}</span>
  })
}

function formatInsightTarget(
  t: (key: string, fallback?: string, options?: Record<string, unknown>) => string,
  insight: StructuredAiInsight | null,
) {
  if (!insight) return '-'
  const exact = insight.next_cycle_target_price
  const low = insight.next_cycle_range_low
  const high = insight.next_cycle_range_high

  if (typeof low === 'number' && typeof high === 'number') {
    return t(
      'dashboard.insight.targetRangeValue',
      `$${low.toFixed(0)} - $${high.toFixed(0)}`,
      { low: low.toFixed(0), high: high.toFixed(0) }
    )
  }

  if (typeof exact === 'number') {
    return t(
      'dashboard.insight.targetPriceValue',
      `$${exact.toFixed(0)}`,
      { price: exact.toFixed(0) }
    )
  }

  return '-'
}

function getNetFlowPresentation(
  t: (key: string, fallback?: string, options?: Record<string, unknown>) => string,
  value?: number | null,
  inflowKey?: string,
  inflowFallback?: string,
  outflowKey?: string,
  outflowFallback?: string,
) {
  const numeric = value || 0
  const positive = numeric >= 0
  return {
    label: positive
      ? t(inflowKey || 'dashboard.insight.netInflow', inflowFallback || 'Net Inflow')
      : t(outflowKey || 'dashboard.insight.netOutflow', outflowFallback || 'Net Outflow'),
    value: formatAbsoluteUsd(numeric),
    className: positive ? 'text-emerald-600' : 'text-red-600',
  }
}

function normalizeRatio(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return 0.5
  if (value > 1) return clamp(value / 100, 0, 1)
  return clamp(value, 0, 1)
}

function domainLabel(domain: string) {
  return domain.replace(/^www\./, '')
}

function formatSymbolLabel(
  t: (key: string, fallback?: string, options?: Record<string, unknown>) => string,
  symbols: string[]
) {
  const normalized = symbols
    .map(symbol => symbol === '_MACRO' ? t('dashboard.insight.macroLabel', 'Macro') : symbol)
    .filter(Boolean)
  return normalized.join(', ')
}

function getPeriodWindowMs(period: InsightPeriod) {
  if (period === '5m') return 5 * 60 * 1000
  if (period === '15m') return 15 * 60 * 1000
  return 60 * 60 * 1000
}

function getBucketStart(time: number, bucketMs: number) {
  return Math.floor(time / bucketMs) * bucketMs
}

function formatBucketLabel(start: number, end: number) {
  const startDate = new Date(start)
  const endDate = new Date(end)
  const sameDay = startDate.toDateString() === endDate.toDateString()

  const startLabel = startDate.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const endLabel = endDate.toLocaleString(undefined, sameDay ? {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  } : {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  return `${startLabel} - ${endLabel}`
}

function ReactionChip({
  label,
  value,
  compact = false,
}: {
  label: string
  value: number | null
  compact?: boolean
}) {
  if (value === null) {
    return <span className={`rounded-full bg-muted ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5'}`}>{label}: -</span>
  }

  const positive = value >= 0
  return (
    <span
      className={`inline-flex items-center rounded-full ${compact ? 'gap-0.5 px-1.5 py-0.5 text-[10px]' : 'gap-1 px-2 py-0.5'} ${
        positive
          ? 'bg-emerald-50 text-emerald-700'
          : 'bg-red-50 text-red-700'
      }`}
    >
      <span className="text-[10px]">{positive ? '↑' : '↓'}</span>
      <span>{label}: {positive ? '+' : ''}{value.toFixed(2)}%</span>
    </span>
  )
}

function formatReactionPercent(chart: InsightChartPoint[], eventTime: number) {
  if (!chart.length) return null
  const targetSec = Math.floor(eventTime / 1000)
  const nearestIndex = chart.reduce((best, item, index) => {
    const diff = Math.abs(item.time - targetSec)
    return diff < best.diff ? { index, diff } : best
  }, { index: 0, diff: Math.abs(chart[0].time - targetSec) }).index

  const start = chart[nearestIndex]?.close
  const end = chart[Math.min(nearestIndex + 3, chart.length - 1)]?.close
  if (!start || !end) return null
  return ((end - start) / start) * 100
}

function formatReactionAtOffset(chart: InsightChartPoint[], eventTime: number, offsetMs: number) {
  if (!chart.length) return null
  const eventTimeSec = Math.floor(eventTime / 1000)
  const targetTimeSec = Math.floor((eventTime + offsetMs) / 1000)

  const startIndex = chart.reduce((best, item, index) => {
    const diff = Math.abs(item.time - eventTimeSec)
    return diff < best.diff ? { index, diff } : best
  }, { index: 0, diff: Math.abs(chart[0].time - eventTimeSec) }).index

  const targetIndex = chart.reduce((best, item, index) => {
    const diff = Math.abs(item.time - targetTimeSec)
    return diff < best.diff ? { index, diff } : best
  }, { index: 0, diff: Math.abs(chart[0].time - targetTimeSec) }).index

  const start = chart[startIndex]?.close
  const end = chart[targetIndex]?.close
  const latestTimeSec = chart[chart.length - 1]?.time || 0
  if (!start || !end || latestTimeSec < targetTimeSec) return null
  return ((end - start) / start) * 100
}

function NewsEventIcon() {
  return (
    <svg viewBox="0 0 1024 1024" className="h-4 w-4" aria-hidden="true">
      <path d="M891.61 99.61H134.8c-38.61 0-69.91 31.3-69.91 69.91v686.63c0 38.61 31.3 69.91 69.91 69.91h755.86c38.46-0.21 69.53-31.45 69.53-69.91V169.52c0.31-38.22-30.36-69.49-68.58-69.91zM801.65 353.8a6.843 6.843 0 0 0-2.81-4.54l-0.57 0.19a28.429 28.429 0 0 0-11.81-7.24l-25.91-7.43a92.073 92.073 0 0 1-36.57-16.19 42.275 42.275 0 0 1-15.24-32.19c0.13-8.37 2.71-16.52 7.43-23.43a42.253 42.253 0 0 1 19.05-16.19c10-3.67 20.59-5.48 31.24-5.33a66.48 66.48 0 0 1 45.52 13.14 49.519 49.519 0 0 1 16.19 34.67l-31.81 1.33a35.03 35.03 0 0 0-8.76-18.09 34.261 34.261 0 0 0-20.57-5.33c-7.85-0.4-15.64 1.45-22.48 5.33a11.211 11.211 0 0 0-5.33 9.71c0.23 3.66 1.78 7.12 4.38 9.71a83.424 83.424 0 0 0 29.34 10.67 112.25 112.25 0 0 1 34.86 12.57 51.901 51.901 0 0 1 18.09 16.19 47.466 47.466 0 0 1 6.29 25.9c0.06 9.22-2.67 18.25-7.81 25.91a51.607 51.607 0 0 1-21.53 18.1 95.52 95.52 0 0 1-34.67 6.29 66.086 66.086 0 0 1-46.48-14.1 62.856 62.856 0 0 1-19.05-41.14l31.24-2.48a38.133 38.133 0 0 0 11.81 23.43 31.633 31.633 0 0 0 23.43 7.24c8.31 0.73 16.61-1.5 23.43-6.29a19.05 19.05 0 0 0 7.81-15.24 6.808 6.808 0 0 0 1.29-5.17zM188.71 245.83h31.24l65.53 106.68V245.83h30.29v160.39h-32.39l-66.1-105.15v105.15h-28.76l0.19-160.39z m283.06 538.61H182.23V532.61h289.54v251.83zM350.62 406.03v-160.2h119.82v26.86h-87.82v35.62h80.77v26.86h-80.77v44h89.91l0.19 26.86h-122.1z m133.34-160.2h33.33l24.95 110.1L571 245.83h38.1l28.38 112.01 25.33-112.01H695l-39.6 160.39h-34.29l-31.05-120.39-31.81 120.39h-36.19l-38.1-160.39z m357.36 538.23H542.06V733.2h299.26v50.86z m0-100.2H542.06V633h299.26v50.86z m0-100.2H542.06V532.8h299.26v50.86z" fill="currentColor" />
    </svg>
  )
}

function FlowEventIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg viewBox="0 0 1024 1024" className={`h-4 w-4 ${direction === 'down' ? 'rotate-180' : ''}`} aria-hidden="true">
      <path d="M325.792041 413.847539c13.659091 4.070712 34.55091 7.463995 53.009308-4.894473 19.48068-13.042037 9.767458-26.707268 5.070482-34.014698l-58.07979 38.909171z m89.650833-113.035426c-18.202571 12.195763-7.722892 26.163893-2.725065 32.915668l54.853306-36.736693c-9.339716-2.904143-32.30987-9.442046-52.128241 3.821025zM175.48985 502.548744c77.924767 41.337477 179.201381 56.837496 274.321786 47.628764l-22.681582-26.953886c-77.151148 5.025457-157.599388-8.572236-220.324988-41.85527-117.284193-62.213947-128.185474-168.897711-24.537859-238.310617 103.712083-69.470211 282.680151-75.320453 399.964344-13.109576 5.457292 2.888793 10.595312 5.910617 15.592117 8.981559v-8.425904c0-9.451256 3.096525-18.122753 8.179286-25.206078-62.179155-31.125905-137.997957-46.635133-213.523071-46.635133-5.904477 0-11.796674 0.350994-17.690918 0.537236l-0.98749 0.028652c-10.208503 0.350994-20.364817 0.977257-30.470989 1.862417-0.437975 0.037862-0.865717 0.079818-1.284249 0.127914-10.080589 0.926092-20.055778 2.105964-29.963429 3.590781-0.396019 0.054235-0.805342 0.124843-1.213641 0.191358-9.969049 1.511423-19.789719 3.26844-29.487592 5.335519-0.258896 0.048095-0.49528 0.10847-0.734734 0.168845-49.862641 10.6782-96.139617 28.480658-133.824914 53.695947l-0.096191 0.057305c-52.958142 35.497469-80.253812 79.323627-82.685187 123.482359-3.25923 56.715723 34.471093 113.980961 111.449301 154.807808z m282.056957-51.312666h140.266627V255.193123c-8.40646-6.019087-17.620309-11.745509-27.720341-17.10968-109.817128-58.06751-276.93224-52.587706-374.119723 12.249999-96.762811 65.054645-86.423325 164.581406 22.969131 222.920092 57.507762 30.350239 130.617873 43.165102 201.212698 39.36045-5.320169-11.294231-5.693676-24.668843-0.466628-36.401048 6.751774-15.171538 21.612227-24.976858 37.858236-24.976858z m-165.54536-11.623735l-15.116279 10.125615c-5.738701 3.840468-7.818059 3.849678-14.601556 0.261966l-2.109034-1.121544-5.53097-2.935865c-6.846942-3.629667-7.067976-4.876054-1.335415-8.713452l15.122419-10.125615c-12.853749-6.815219-58.310034-40.264029-48.223305-47.015803 1.019213-0.689708 1.019213-0.689708 3.763721-1.597381l39.289841-13.099343c0.977257-0.303922 4.569062-0.859577 6.128581-0.041956 2.309602 1.230014 14.566764 23.528879 35.446303 37.379329l65.8825-44.1178c-14.137998-18.368346-46.01808-49.433876-1.671059-79.138408 49.462528-33.126468 112.933095-16.368806 131.116223-7.549953l16.483416-11.042497c5.699816-3.834328 7.894807-3.900843 14.697747-0.28448l7.732102 4.090155c6.715959 3.565199 6.846942 4.876054 1.127683 8.70015l-16.489556 11.042497c10.428513 6.351662 51.670823 37.055964 40.223097 44.724621-1.357927 0.927115-2.76702 1.406023-4.920056 1.901302l-34.606169 9.032724c-2.37714 0.779759-4.565992 0.859577-6.118348 0.028653-2.309602-1.226944-13.44522-23.339568-29.880541-32.05302l-62.204737 41.660842c13.981433 20.330024 41.36306 52.197826-1.699712 81.033571-46.715975 31.30089-103.627149 19.660782-132.506896 8.855692z m104.58394 157.11434c-88.205924 0-173.72874-19.6045-240.83102-55.187926-37.925774-20.125363-68.693522-44.922119-91.317799-72.675206 4.981455 50.529837 42.389436 100.025111 111.047142 136.435368 63.495126 33.704636 142.535297 50.27401 221.092467 50.274011 44.041052 0 87.912236-5.255701 128.831181-15.585977l-41.788755-49.650817c-28.074406 4.185322-57.20384 6.390547-87.033216 6.390547zM64.448848 571.871599c4.974291 50.526767 42.388413 100.021018 111.041002 136.445602 63.502289 33.682124 142.541437 50.2648 221.095537 50.2648 69.473281 0 138.51882-13.013385 196.183148-38.5899l-36.033681-42.800805c-49.075719 14.729469-103.395882 22.531156-160.149467 22.531156-88.205924 0-173.72874-19.6045-240.824881-55.187926-37.925774-20.126386-68.693522-44.920072-91.311658-72.662927z m332.136539 230.849692c-88.205924 0-173.72874-19.60757-240.83102-55.19202-37.925774-20.122293-68.693522-44.909839-91.317799-72.672136 4.981455 50.529837 42.389436 100.025111 111.047142 136.445602 63.495126 33.682124 142.535297 50.27401 221.092467 50.27401 90.685395 0 180.709735-22.094204 245.534136-65.479317l0.134053-0.079818a270.50383 270.50383 0 0 0 9.127892-6.390547l-29.237905-34.743292c-63.859423 31.057343-142.100392 47.837518-225.548966 47.837518z m380.007827-303.217906V236.025575H655.468552v263.47781H473.554386l242.479567 288.047392 242.444774-288.047392H776.593214z" fill="currentColor" />
    </svg>
  )
}

function DataPulse() {
  return (
    <div className="relative flex h-full min-h-[220px] w-full items-center justify-center overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-background to-muted/60">
      <div className="absolute h-40 w-40 rounded-full bg-sky-100/30 blur-3xl" />
      <div className="absolute h-28 w-28 rounded-full border border-sky-200/70 animate-ping" />
      <div className="absolute h-18 w-18 rounded-full border border-sky-300/80" />
      <div className="absolute h-9 w-9 rounded-full bg-sky-500/80 shadow-[0_0_28px_rgba(14,165,233,0.34)]" />
    </div>
  )
}

function InsightEmptyState() {
  return (
    <div className="h-full min-h-[220px]">
      <DataPulse />
    </div>
  )
}

function InsightRefreshBadge({
  active,
}: {
  active: boolean
}) {
  if (!active) return null

  return (
    <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-70" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-500" />
    </span>
  )
}

function SentimentGauge({
  t,
  sentiment,
  probability,
  marketEmotion,
  headline,
}: {
  t: (key: string, fallback?: string, options?: Record<string, unknown>) => string
  sentiment: InsightSentiment
  probability: number
  marketEmotion: string
  headline: string
}) {
  const angle = -90 + clamp(probability, 0, 100) * 1.8
  const theme = getSentimentTheme(sentiment)
  const sentimentLabel = sentiment === 'bullish'
    ? t('dashboard.insight.bullish', 'Bullish')
    : sentiment === 'bearish'
      ? t('dashboard.insight.bearish', 'Bearish')
      : t('dashboard.insight.mixed', 'Mixed')

  return (
    <div className={`rounded-[1.4rem] border bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.94),_rgba(248,250,252,0.86)_58%,_rgba(241,245,249,0.84))] p-4 ${theme.border} ${theme.glow}`}>
      <div className="flex items-start gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {t('dashboard.insight.liveInsight', 'Live Insight')}
          </div>
          <div className={`mt-2 text-2xl font-semibold uppercase ${theme.text}`}>
            {sentimentLabel}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="w-40 shrink-0">
          <div className="relative h-28 w-40">
          <svg viewBox="0 0 200 120" className="h-full w-full overflow-visible">
            <defs>
              <linearGradient id="sentimentGaugeArc" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f87171" />
                <stop offset="50%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
            </defs>
            <path
              d="M 20 100 A 80 80 0 0 1 180 100"
              fill="none"
              stroke="rgba(148,163,184,0.18)"
              strokeWidth="16"
              strokeLinecap="round"
            />
            <path
              d="M 20 100 A 80 80 0 0 1 180 100"
              fill="none"
              stroke="url(#sentimentGaugeArc)"
              strokeWidth="16"
              strokeLinecap="round"
            />
            <g transform={`rotate(${angle} 100 100)`}>
              <line x1="100" y1="100" x2="100" y2="42" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className={theme.text} />
              <circle cx="100" cy="100" r="9" fill="white" stroke="currentColor" strokeWidth="4" className={theme.text} />
            </g>
          </svg>
          </div>
          <div className="mt-1 flex items-center justify-between px-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            <span>{t('dashboard.insight.bearish', 'Bearish')}</span>
            <span>{t('dashboard.insight.bullish', 'Bullish')}</span>
          </div>
          <div className="mt-3 text-center">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('dashboard.insight.probability', 'Probability')}
            </div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-foreground">
              {probability}%
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className={`text-lg font-semibold leading-6 ${theme.softText}`}>
            {headline}
          </div>
          <div className="mt-3 text-xs uppercase tracking-[0.16em] text-muted-foreground">
            {t('dashboard.insight.marketEmotion', 'Market Emotion')}
          </div>
          <div className="mt-1 inline-flex max-w-full rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-xs text-foreground/90">
            <span className="truncate">{marketEmotion}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function BreakdownBars({
  t,
  breakdown,
}: {
  t: (key: string, fallback?: string, options?: Record<string, unknown>) => string
  breakdown: InsightSentimentBreakdown
}) {
  const items = [
    { key: 'technical', label: t('dashboard.insight.technicalScore', 'Technical'), value: breakdown.technical },
    { key: 'flow', label: t('dashboard.insight.flowScore', 'Flow'), value: breakdown.flow },
    { key: 'news', label: t('dashboard.insight.newsScore', 'News'), value: breakdown.news },
  ].sort((a, b) => b.value - a.value)

  const strongest = items[0]?.key

  return (
    <div className="rounded-[1.35rem] border border-border/80 bg-background/80 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('dashboard.insight.sentimentBreakdown', 'Signal Breakdown')}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {t('dashboard.insight.strongestSignal', 'Strongest')}: {items[0]?.label || '-'}
        </div>
      </div>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div key={item.key} className={`rounded-xl border px-3 py-2 ${item.key === strongest ? 'border-sky-300 bg-background shadow-[0_0_0_1px_rgba(125,211,252,0.32)]' : 'border-border/70 bg-background/70'}`}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
              <div className="font-medium text-foreground">{item.label}</div>
              <div className="tabular-nums text-muted-foreground">
                {item.value}/100{item.key === strongest ? ` · ${t('dashboard.insight.dominantSignal', 'Dominant')}` : ''}
              </div>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-200/70">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${getBreakdownBarClass(item.value)} ${item.key === strongest ? 'shadow-[0_0_18px_rgba(14,165,233,0.24)]' : ''}`}
                style={{ width: `${clamp(item.value, 0, 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PriceRangeBar({
  t,
  insight,
  currentPrice,
}: {
  t: (key: string, fallback?: string, options?: Record<string, unknown>) => string
  insight: StructuredAiInsight
  currentPrice?: number | null
}) {
  const supports = insight.technical_levels.filter(level => level.type === 'support').sort((a, b) => a.price - b.price)
  const resistances = insight.technical_levels.filter(level => level.type === 'resistance').sort((a, b) => a.price - b.price)
  const levelPrices = insight.technical_levels.map(level => level.price)
  const targetCandidates = [
    ...levelPrices,
    insight.next_cycle_target_price,
    insight.next_cycle_range_low,
    insight.next_cycle_range_high,
    currentPrice,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value))

  if (!targetCandidates.length) return null

  const minPrice = Math.min(...targetCandidates)
  const maxPrice = Math.max(...targetCandidates)
  const span = Math.max(maxPrice - minPrice, Math.max(maxPrice * 0.002, 1))
  const start = minPrice - span * 0.08
  const end = maxPrice + span * 0.08
  const positionOf = (value?: number | null) => `${clamp(((value || 0) - start) / Math.max(end - start, 1) * 100, 0, 100)}%`
  const compactSupports = supports.slice(0, 2)
  const compactResistances = resistances.slice(0, 2)

  return (
    <div className="rounded-[1.35rem] border border-border/80 bg-background/80 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {t('dashboard.insight.nextCycleTarget', 'Next Cycle Target')}
        </div>
        <div className="text-sm font-medium text-foreground">
          {formatInsightTarget(t, insight)}
        </div>
      </div>

      <div className="relative mt-5 h-12 rounded-full bg-gradient-to-r from-emerald-100 via-slate-100 to-rose-100">
        {typeof insight.next_cycle_range_low === 'number' && typeof insight.next_cycle_range_high === 'number' && (
          <div
            className="absolute inset-y-2 rounded-full bg-sky-500/18"
            style={{
              left: positionOf(insight.next_cycle_range_low),
              width: `calc(${positionOf(insight.next_cycle_range_high)} - ${positionOf(insight.next_cycle_range_low)})`,
            }}
          />
        )}

        {compactSupports.map((level, index) => (
          <div key={`support-${index}`} className="absolute inset-y-0" style={{ left: positionOf(level.price) }}>
            <div className="absolute inset-y-1 -translate-x-1/2 border-l border-emerald-500/70" />
            <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.32)]" />
          </div>
        ))}

        {compactResistances.map((level, index) => (
          <div key={`resistance-${index}`} className="absolute inset-y-0" style={{ left: positionOf(level.price) }}>
            <div className="absolute inset-y-1 -translate-x-1/2 border-l border-rose-500/70" />
            <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.28)]" />
          </div>
        ))}

        {typeof currentPrice === 'number' && (
          <div className="absolute inset-y-0" style={{ left: positionOf(currentPrice) }}>
            <div className="absolute inset-y-0 -translate-x-1/2 border-l-2 border-slate-700" />
          </div>
        )}

        {typeof insight.next_cycle_target_price === 'number' && (
          <div className="absolute inset-y-0" style={{ left: positionOf(insight.next_cycle_target_price) }}>
            <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-sky-500 bg-white shadow-sm" />
          </div>
        )}
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {compactSupports.map((level, index) => (
          <div key={`support-chip-${index}`} className="flex items-center justify-between rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3 py-2 text-xs">
            <span className="font-medium text-emerald-800">{level.label || t('dashboard.insight.support', 'Support')}</span>
            <span className="tabular-nums text-emerald-700">{formatPrice(level.price)}</span>
          </div>
        ))}
        {compactResistances.map((level, index) => (
          <div key={`resistance-chip-${index}`} className="flex items-center justify-between rounded-xl border border-rose-200/80 bg-rose-50/70 px-3 py-2 text-xs">
            <span className="font-medium text-rose-800">{level.label || t('dashboard.insight.resistance', 'Resistance')}</span>
            <span className="tabular-nums text-rose-700">{formatPrice(level.price)}</span>
          </div>
        ))}
        {typeof currentPrice === 'number' && (
          <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-xs">
            <span className="font-medium text-slate-800">{t('dashboard.insight.currentPrice', 'Current')}</span>
            <span className="tabular-nums text-slate-700">{formatPrice(currentPrice)}</span>
          </div>
        )}
        {typeof insight.next_cycle_target_price === 'number' && (
          <div className="flex items-center justify-between rounded-xl border border-sky-200/80 bg-sky-50/80 px-3 py-2 text-xs">
            <span className="font-medium text-sky-800">{t('dashboard.insight.targetMarker', 'Target')}</span>
            <span className="tabular-nums text-sky-700">{formatPrice(insight.next_cycle_target_price)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function DriverCard({
  driver,
}: {
  driver: InsightDriver
}) {
  return (
    <div className={`rounded-2xl border p-3 ${driver.impact === 'high' ? 'border-border bg-muted/50' : 'border-border/80 bg-background/80'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${driver.tone === 'bullish' ? 'bg-emerald-500' : driver.tone === 'bearish' ? 'bg-red-500' : 'bg-cyan-500'}`} />
          <div className="text-sm leading-6 text-foreground">{renderSemanticText(driver.text)}</div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${getImpactBadgeClass(driver.impact)}`}>
          {driver.impact}
        </span>
      </div>
    </div>
  )
}

function parseStructuredInsight(raw: string): StructuredAiInsight | null {
  const normalized = raw.trim()
  if (!normalized) return null

  const fencedMatch = normalized.match(/```json\s*([\s\S]*?)```/i)
  const candidate = fencedMatch?.[1]?.trim() || normalized
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1))
    const sentiment = parsed?.sentiment
    const probability = Number(parsed?.probability)
    if (!['bullish', 'bearish', 'mixed'].includes(sentiment)) return null
    if (!Number.isFinite(probability)) return null

    const rawBreakdown = parsed?.sentiment_breakdown
    const sentiment_breakdown = rawBreakdown && typeof rawBreakdown === 'object'
      ? {
          technical: clamp(Math.round(Number(rawBreakdown.technical) || 0), 0, 100),
          flow: clamp(Math.round(Number(rawBreakdown.flow) || 0), 0, 100),
          news: clamp(Math.round(Number(rawBreakdown.news) || 0), 0, 100),
        }
      : null

    const technical_levels = Array.isArray(parsed?.technical_levels)
      ? parsed.technical_levels
        .map((item: any) => {
          const price = Number(item?.price)
          if (!Number.isFinite(price)) return null
          const type = item?.type === 'support' ? 'support' : item?.type === 'resistance' ? 'resistance' : null
          if (!type) return null
          return {
            price,
            type,
            label: typeof item?.label === 'string' ? item.label.trim() : '',
          } as InsightTechnicalLevel
        })
        .filter((item): item is InsightTechnicalLevel => Boolean(item))
      : []

    const key_drivers = Array.isArray(parsed?.key_drivers)
      ? parsed.key_drivers
        .map((item: any) => {
          if (typeof item === 'string') {
            return {
              text: item.trim(),
              impact: 'medium' as InsightDriverImpact,
              tone: sentiment,
            }
          }

          const text = typeof item?.text === 'string' ? item.text.trim() : ''
          if (!text) return null
          const impact = item?.impact === 'high' || item?.impact === 'medium' || item?.impact === 'low'
            ? item.impact
            : 'medium'
          const tone = item?.tone === 'bullish' || item?.tone === 'bearish' || item?.tone === 'mixed'
            ? item.tone
            : sentiment
          return { text, impact, tone } as InsightDriver
        })
        .filter((item): item is InsightDriver => Boolean(item?.text))
      : []

    return {
      sentiment,
      probability: clamp(Math.round(probability), 0, 100),
      market_emotion: String(parsed?.market_emotion || '').trim(),
      headline: String(parsed?.headline || '').trim(),
      summary: String(parsed?.summary || '').trim(),
      sentiment_breakdown,
      next_cycle_period: String(parsed?.next_cycle_period || '').trim(),
      next_cycle_target_price: typeof parsed?.next_cycle_target_price === 'number' ? parsed.next_cycle_target_price : null,
      next_cycle_range_low: typeof parsed?.next_cycle_range_low === 'number' ? parsed.next_cycle_range_low : null,
      next_cycle_range_high: typeof parsed?.next_cycle_range_high === 'number' ? parsed.next_cycle_range_high : null,
      technical_levels,
      key_drivers,
      risks: Array.isArray(parsed?.risks) ? parsed.risks.map(String).filter(Boolean) : [],
      confidence_basis: typeof parsed?.confidence_basis === 'string' ? parsed.confidence_basis.trim() : '',
      similar_pattern: typeof parsed?.similar_pattern === 'string' ? parsed.similar_pattern.trim() : '',
      explanation_markdown: typeof parsed?.explanation_markdown === 'string' ? parsed.explanation_markdown.trim() : '',
    }
  } catch {
    return null
  }
}

function buildEvents(
  t: (key: string, fallback?: string, options?: Record<string, unknown>) => string,
  news: NewsArticle[],
  zones: LargeOrderZoneItem[],
  chartContext: InsightChartPoint[],
  exchange: InsightExchange,
  symbol: string,
  period: InsightPeriod,
): InsightEvent[] {
  const events: InsightEvent[] = []

  for (const article of news) {
    const publishedAt = article.published_at ? new Date(`${article.published_at}Z`).getTime() : Date.now()
    const reaction = formatReactionPercent(chartContext, publishedAt)
    const reactionText = reaction === null
      ? t('dashboard.insight.events.priceReactionPending', 'Price reaction pending')
      : t('dashboard.insight.events.priceReaction', `Price after event: ${reaction >= 0 ? '+' : ''}${reaction.toFixed(2)}%`, {
          value: `${reaction >= 0 ? '+' : ''}${reaction.toFixed(2)}%`,
        })

    events.push({
      id: `news-${article.id}`,
      kind: 'news',
      iconVariant: 'news',
      time: publishedAt,
      title: article.title,
      summary: article.ai_summary || article.summary || reactionText,
      tone: article.sentiment === 'bullish' || article.sentiment === 'bearish' ? article.sentiment : 'mixed',
      sourceUrl: article.source_url,
      imageUrl: article.image_url,
      evidence: [
        `${domainLabel(article.source_domain)} · ${formatRelativeTime(article.published_at)}`,
        formatSymbolLabel(t, article.symbols.slice(0, 3)) || t('dashboard.insight.watchlist', 'watchlist'),
        reactionText,
      ],
    })
  }

  const strongestZones = [...zones]
    .sort((a, b) => Math.abs(b.large_order_net) - Math.abs(a.large_order_net))

  for (const zone of strongestZones) {
    const tone = zone.large_order_net > 0 ? 'bullish' : 'bearish'
    const reaction = formatReactionPercent(chartContext, zone.time)
    const reactionText = reaction === null
      ? t('dashboard.insight.events.priceReactionPending', 'Price reaction pending')
      : t('dashboard.insight.events.priceReaction', `Price after event: ${reaction >= 0 ? '+' : ''}${reaction.toFixed(2)}%`, {
          value: `${reaction >= 0 ? '+' : ''}${reaction.toFixed(2)}%`,
        })

    events.push({
      id: `flow-${zone.time}-${zone.large_order_net >= 0 ? 'up' : 'down'}`,
      kind: 'flow',
      iconVariant: zone.large_order_net >= 0 ? 'flow-up' : 'flow-down',
      time: zone.time,
      title: zone.large_order_net >= 0
        ? t('dashboard.insight.events.largeBuyTitle', 'Large buy flow expanded')
        : t('dashboard.insight.events.largeSellTitle', 'Large sell flow expanded'),
      summary: t(
        'dashboard.insight.events.flowSummary',
        `${exchange} ${symbol} ${period} large net ${formatCompactUsd(zone.large_order_net)}, buy/sell count ${zone.large_buy_count}/${zone.large_sell_count}.`,
        {
          exchange,
          symbol,
          period,
          value: formatCompactUsd(zone.large_order_net),
          buy_count: zone.large_buy_count,
          sell_count: zone.large_sell_count,
        }
      ),
      tone,
      evidence: [
        t('dashboard.insight.events.largeNet', `Large net: ${formatCompactUsd(zone.large_order_net)}`, {
          value: formatCompactUsd(zone.large_order_net),
        }),
        t('dashboard.insight.events.buySellCount', `Buy/Sell count: ${zone.large_buy_count}/${zone.large_sell_count}`, {
          buy_count: zone.large_buy_count,
          sell_count: zone.large_sell_count,
        }),
        reactionText,
      ],
    })
  }

  return events.sort((a, b) => b.time - a.time)
}

export default function DashboardInsightView() {
  const { t, i18n } = useTranslation()
  const [selectedExchange, setSelectedExchange] = useState<InsightExchange>('hyperliquid')
  const [selectedSymbol, setSelectedSymbol] = useState('BTC')
  const [selectedPeriod, setSelectedPeriod] = useState<InsightPeriod>('1h')
  const analysisWindow: InsightWindow = '4h'
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([])
  const [summary, setSummary] = useState<MarketFlowSummaryItem | null>(null)
  const [newsItems, setNewsItems] = useState<NewsArticle[]>([])
  const [zoneItems, setZoneItems] = useState<LargeOrderZoneItem[]>([])
  const [chartContext, setChartContext] = useState<InsightChartPoint[]>([])
  const [klineRefreshToken, setKlineRefreshToken] = useState(0)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [recentEventIds, setRecentEventIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const [aiInsightEnabled, setAiInsightEnabled] = useState(false)
  const [aiState, setAiState] = useState<InsightAiState>('idle')
  const [aiResult, setAiResult] = useState('')
  const [aiInsight, setAiInsight] = useState<StructuredAiInsight | null>(null)
  const [aiGeneratedAt, setAiGeneratedAt] = useState<number | null>(null)
  const [aiStatusText, setAiStatusText] = useState('')
  const [aiError, setAiError] = useState('')
  const [completedSignature, setCompletedSignature] = useState('')

  const activeTaskRef = useRef(false)
  const analysisSeqRef = useRef(0)
  const previousEventIdsRef = useRef<string[]>([])
  const latestEventSignatureRef = useRef('')

  useEffect(() => {
    const loadWatchlist = async () => {
      const endpoint = selectedExchange === 'binance'
        ? '/api/binance/symbols/watchlist'
        : '/api/hyperliquid/symbols/watchlist'
      const response = await fetch(endpoint)
      const data = await response.json()
      const symbols = data.symbols || []
      setWatchlistSymbols(symbols)
      if (symbols.length > 0 && !symbols.includes(selectedSymbol)) {
        setSelectedSymbol(symbols[0])
      }
    }

    loadWatchlist().catch(() => {
      setWatchlistSymbols([])
    })
  }, [selectedExchange, selectedSymbol])

  useEffect(() => {
    return () => {
      setAiInsightEnabled(false)
      setAiState('idle')
    }
  }, [])

  useEffect(() => {
    if (!selectedSymbol) return

    setLoading(true)
    const params = new URLSearchParams({
      symbol: selectedSymbol,
      exchange: selectedExchange,
      timeframe: selectedPeriod,
      window: analysisWindow,
    })
    const source = new EventSource(`/api/market-intelligence/stream?${params.toString()}`)

    const applyPayload = (payload: any) => {
      setSummary(payload?.summary || null)
      setNewsItems(Array.isArray(payload?.news_items) ? payload.news_items : [])
      setZoneItems(Array.isArray(payload?.zone_items) ? payload.zone_items : [])
      setLoading(false)
    }

    source.addEventListener('snapshot', (event) => {
      try {
        applyPayload(JSON.parse((event as MessageEvent).data))
      } catch (error) {
        console.error('Failed to parse market intelligence snapshot:', error)
      }
    })

    source.addEventListener('update', (event) => {
      try {
        applyPayload(JSON.parse((event as MessageEvent).data))
        setKlineRefreshToken(value => value + 1)
      } catch (error) {
        console.error('Failed to parse market intelligence update:', error)
      }
    })

    source.addEventListener('error', () => {
      setLoading(false)
    })

    return () => {
      source.close()
    }
  }, [analysisWindow, selectedExchange, selectedPeriod, selectedSymbol])

  const events = useMemo(
    () => buildEvents(t, newsItems, zoneItems, chartContext, selectedExchange, selectedSymbol, selectedPeriod),
    [chartContext, newsItems, selectedExchange, selectedPeriod, selectedSymbol, t, zoneItems]
  )

  useEffect(() => {
    const nextIds = events.map(event => event.id)
    const previousIds = previousEventIdsRef.current
    if (previousIds.length > 0) {
      const newlyInserted = nextIds.filter(id => !previousIds.includes(id))
      if (newlyInserted.length > 0) {
        setRecentEventIds(newlyInserted)
        const timer = window.setTimeout(() => setRecentEventIds([]), 1400)
        return () => window.clearTimeout(timer)
      }
    }
    previousEventIdsRef.current = nextIds
  }, [events])

  useEffect(() => {
    previousEventIdsRef.current = events.map(event => event.id)
    if (!selectedEventId && events.length > 0) {
      setSelectedEventId(events[0].id)
    }
  }, [events, selectedEventId])

  const selectedEvent = events.find(item => item.id === selectedEventId) || events[0] || null
  const eventBucketMs = getPeriodWindowMs(selectedPeriod)
  const fallbackFocusTime = chartContext.length > 0
    ? chartContext[chartContext.length - 1].time * 1000
    : Date.now()
  const focusedBucketStart = getBucketStart(selectedEvent?.time || fallbackFocusTime, eventBucketMs)
  const focusedEvents = useMemo(
    () => events.filter(event => getBucketStart(event.time, eventBucketMs) === focusedBucketStart),
    [eventBucketMs, events, focusedBucketStart]
  )
  const focusedFlowEvents = useMemo(
    () => focusedEvents.filter(event => event.kind === 'flow'),
    [focusedEvents]
  )
  const focusedNewsEvents = useMemo(
    () => focusedEvents.filter(event => event.kind === 'news'),
    [focusedEvents]
  )
  const focusedBucketLabel = useMemo(() => {
    const start = focusedBucketStart
    const end = focusedBucketStart + eventBucketMs
    return formatBucketLabel(start, end)
  }, [eventBucketMs, focusedBucketStart])

  const chartMarkers = useMemo(() => {
    const newsMarkers = newsItems.map(item => ({
      id: `news-${item.id}`,
      kind: 'news' as const,
      iconVariant: 'news' as const,
      time: item.published_at ? new Date(`${item.published_at}Z`).getTime() : Date.now(),
      position: 'aboveBar' as const,
      color: item.sentiment === 'bearish' ? '#f97316' : item.sentiment === 'bullish' ? '#0ea5e9' : '#94a3b8',
      shape: 'circle' as const,
      title: item.title,
      summary: item.ai_summary || item.summary || '',
      tone: item.sentiment === 'bullish' || item.sentiment === 'bearish' ? item.sentiment : 'mixed',
      metadata: [
        domainLabel(item.source_domain),
        item.symbols.slice(0, 3).join(', ') || t('dashboard.insight.watchlist', 'watchlist'),
      ],
    }))

    const zoneMarkers = zoneItems
      .filter(item => Math.abs(item.large_order_net) >= 100_000)
      .map(item => ({
        id: `flow-${item.time}-${item.large_order_net >= 0 ? 'up' : 'down'}`,
        kind: 'flow' as const,
        iconVariant: item.large_order_net >= 0 ? 'flow-up' as const : 'flow-down' as const,
        time: item.time,
        position: item.large_order_net >= 0 ? 'belowBar' as const : 'aboveBar' as const,
        color: item.large_order_net >= 0 ? '#16a34a' : '#dc2626',
        shape: item.large_order_net >= 0 ? 'arrowUp' as const : 'arrowDown' as const,
        title: item.large_order_net >= 0
          ? t('dashboard.insight.events.largeBuyTitle', 'Large buy flow expanded')
          : t('dashboard.insight.events.largeSellTitle', 'Large sell flow expanded'),
        summary: t(
          'dashboard.insight.events.flowSummary',
          `${selectedExchange} ${selectedSymbol} ${selectedPeriod} large net ${formatCompactUsd(item.large_order_net)}, buy/sell count ${item.large_buy_count}/${item.large_sell_count}.`,
          {
            exchange: selectedExchange,
            symbol: selectedSymbol,
            period: selectedPeriod,
            value: formatCompactUsd(item.large_order_net),
            buy_count: item.large_buy_count,
            sell_count: item.large_sell_count,
          }
        ),
        tone: item.large_order_net >= 0 ? 'bullish' as const : 'bearish' as const,
        metadata: [
          t('dashboard.insight.events.largeNet', `Large net: ${formatCompactUsd(item.large_order_net)}`, {
            value: formatCompactUsd(item.large_order_net),
          }),
          t('dashboard.insight.events.buySellCount', `Buy/Sell count: ${item.large_buy_count}/${item.large_sell_count}`, {
            buy_count: item.large_buy_count,
            sell_count: item.large_sell_count,
          }),
        ],
      }))

    return [...newsMarkers, ...zoneMarkers]
  }, [newsItems, selectedExchange, selectedPeriod, selectedSymbol, t, zoneItems])

  const latestEventSignature = useMemo(() => {
    const latestEvent = events[0]
    return `${selectedExchange}:${selectedSymbol}:${selectedPeriod}:${latestEvent?.id || 'none'}`
  }, [events, selectedExchange, selectedPeriod, selectedSymbol])

  useEffect(() => {
    latestEventSignatureRef.current = latestEventSignature
  }, [latestEventSignature])

  const aiContext = useMemo(() => {
    const cutoff = Date.now() - 4 * 3600_000
    return {
      exchange: selectedExchange,
      symbol: selectedSymbol,
      analysis_window: analysisWindow,
      chart_interval: selectedPeriod,
      chart: chartContext.filter(item => item.time * 1000 >= cutoff),
      summary,
      news: newsItems.filter(item => {
        if (!item.published_at) return false
        return new Date(`${item.published_at}Z`).getTime() >= cutoff
      }),
      large_order_zones: zoneItems.filter(item => item.time >= cutoff),
    }
  }, [analysisWindow, chartContext, newsItems, selectedExchange, selectedPeriod, selectedSymbol, summary, zoneItems])

  const runInsightAnalysis = async (signature: string) => {
    analysisSeqRef.current += 1
    const seq = analysisSeqRef.current
    activeTaskRef.current = true
    setAiState('thinking')
    setAiStatusText('')
    setAiError('')

    try {
      const data = await startHyperAiInsightAnalysis({
        context: aiContext,
        selected_event: selectedEvent ? {
          id: selectedEvent.id,
          kind: selectedEvent.kind,
          time: selectedEvent.time,
          title: selectedEvent.title,
          summary: selectedEvent.summary,
          tone: selectedEvent.tone,
          evidence: selectedEvent.evidence,
        } : null,
        lang: i18n.language?.startsWith('zh') ? 'zh' : 'en',
      })

      if (!data.task_id) {
        throw new Error('Failed to start Hyper AI insight analysis')
      }

      let content = ''
      const pollResult = await pollAiStream(data.task_id, {
        interval: 300,
        onChunk: (chunk) => {
          if (seq !== analysisSeqRef.current) return
          const eventType = chunk.event_type
          const eventData = chunk.data || {}

          if (eventType === 'content') {
            const delta = typeof eventData.text === 'string' ? eventData.text : typeof eventData.content === 'string' ? eventData.content : ''
            if (delta) {
              content += delta
              setAiResult(content)
            }
          } else if (eventType === 'reasoning' && eventData.content) {
            setAiStatusText(String(eventData.content).slice(0, 120))
          } else if (eventType === 'tool_call' && eventData.name) {
            setAiStatusText(`${String(eventData.name)}...`)
          } else if (eventType === 'error' && eventData.message) {
            setAiError(String(eventData.message))
          }
        },
      })

      if (seq !== analysisSeqRef.current) return

      if (pollResult.status === 'completed') {
        const finalContent = content || String(pollResult.result?.content || '')
        const parsedInsight = parseStructuredInsight(finalContent)
        if (!finalContent.trim()) {
          setAiState('error')
          setAiError(t('dashboard.insight.aiEmpty', 'Hyper AI returned no readable content.'))
        } else if (!parsedInsight) {
          setAiState('error')
          setAiError(t('dashboard.insight.aiInvalidFormat', 'Hyper AI returned an invalid insight format.'))
        } else {
          setAiResult(finalContent.trim())
          setAiInsight(parsedInsight)
          setAiGeneratedAt(Date.now())
          setAiState('ready')
          setCompletedSignature(latestEventSignatureRef.current || signature)
        }
      } else {
        setAiState('error')
        setAiError(pollResult.error || t('dashboard.insight.aiFailed', 'Hyper AI analysis failed.'))
        setCompletedSignature(latestEventSignatureRef.current || signature)
      }
    } catch (error) {
      if (seq !== analysisSeqRef.current) return
      setAiState('error')
      setAiError(error instanceof Error ? error.message : String(error))
      setCompletedSignature(latestEventSignatureRef.current || signature)
    } finally {
      if (seq === analysisSeqRef.current) {
        activeTaskRef.current = false
      }
    }
  }

  useEffect(() => {
    if (!aiInsightEnabled) {
      setAiState('idle')
      setAiError('')
      setAiStatusText('')
      return
    }

    if (activeTaskRef.current) return

    if (!latestEventSignature || latestEventSignature === completedSignature) {
      setAiState(aiInsight ? 'ready' : 'monitoring')
      return
    }

    runInsightAnalysis(latestEventSignature)
  }, [aiContext, aiInsight, aiInsightEnabled, completedSignature, i18n.language, latestEventSignature])

  const aiTheme = getSentimentTheme(aiInsight?.sentiment || 'mixed')
  const latestChartPrice = chartContext[chartContext.length - 1]?.close ?? null
  const showRefreshBadge = aiInsightEnabled && aiState === 'thinking' && !!aiInsight
  const showInlineError = aiState === 'error' && !aiInsight
  const netFlowDisplay = getNetFlowPresentation(
    t,
    summary?.net_inflow,
    'dashboard.insight.netInflow',
    'Net Inflow',
    'dashboard.insight.netOutflow',
    'Net Outflow'
  )
  const largeFlowDisplay = getNetFlowPresentation(
    t,
    summary?.large_order_net,
    'dashboard.insight.largeOrderInflow',
    'Large Order Inflow',
    'dashboard.insight.largeOrderOutflow',
    'Large Order Outflow'
  )
  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-3">
      <style>{`
        @keyframes insight-card-in {
          0% { opacity: 0; transform: translateY(-14px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        @keyframes metric-flip-in {
          0% { opacity: 0; transform: translateY(10px) scale(0.98); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      <div className="lg:col-span-2 flex min-h-0 flex-col gap-4">
        <Card className="flex-1 min-h-[420px] overflow-hidden">
          <CardHeader className="space-y-3 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {t('dashboard.insight.exchange', 'Exchange')}
                  </div>
                  <Select value={selectedExchange} onValueChange={(value) => setSelectedExchange(value as InsightExchange)}>
                    <SelectTrigger className="w-[150px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hyperliquid">Hyperliquid</SelectItem>
                      <SelectItem value="binance">Binance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {t('dashboard.insight.symbol', 'Symbol')}
                  </div>
                  <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {watchlistSymbols.map(symbol => (
                        <SelectItem key={symbol} value={symbol}>{symbol}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    {t('dashboard.insight.chartInterval', 'Chart Interval')}
                  </div>
                  <Select value={selectedPeriod} onValueChange={(value) => setSelectedPeriod(value as InsightPeriod)}>
                    <SelectTrigger className="w-[132px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5m">5m</SelectItem>
                      <SelectItem value="15m">15m</SelectItem>
                      <SelectItem value="1h">1h</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
              <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{netFlowDisplay.label}</div>
                <div className={`mt-1 text-base font-semibold ${netFlowDisplay.className}`}>
                  <AnimatedMetricValue value={netFlowDisplay.value} />
                </div>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{largeFlowDisplay.label}</div>
                <div className={`mt-1 text-base font-semibold ${largeFlowDisplay.className}`}>
                  <AnimatedMetricValue value={largeFlowDisplay.value} />
                </div>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t('dashboard.insight.totalInflow', 'Total Inflow')}
                </div>
                <div className="mt-1 text-base font-semibold text-emerald-600">
                  <AnimatedMetricValue value={formatCompactUsd(summary?.total_buy_notional)} />
                </div>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {t('dashboard.insight.totalOutflow', 'Total Outflow')}
                </div>
                <div className="mt-1 text-base font-semibold text-red-600">
                  <AnimatedMetricValue value={formatCompactUsd(summary?.total_sell_notional)} />
                </div>
              </div>
              <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t('dashboard.insight.oiFunding', 'OI / Funding')}</div>
                <div className="mt-1 text-sm font-semibold text-foreground">
                  <AnimatedMetricValue value={`${formatPercent(summary?.open_interest_change_pct)} / ${formatPercent(summary?.funding_rate_pct, 4)}`} />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="h-[calc(100%-8.25rem)] pb-4">
            <TradingViewChart
              symbol={selectedSymbol}
              period={selectedPeriod}
              exchange={selectedExchange}
              chartType="candlestick"
              selectedIndicators={[]}
              selectedFlowIndicators={[]}
              onLoadingChange={() => {}}
              onIndicatorLoadingChange={() => {}}
              onDataUpdate={(klines) => {
                setChartContext(Array.isArray(klines) ? klines : [])
              }}
              showVolumePane={false}
              eventMarkers={chartMarkers}
              activeEventMarkerId={selectedEventId || undefined}
              onEventMarkerClick={(eventId) => setSelectedEventId(eventId)}
              incrementalRefreshToken={klineRefreshToken}
            />
          </CardContent>
        </Card>

        <Card className="h-[324px] overflow-hidden">
          <CardHeader className="py-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm">{t('dashboard.insight.newsTitle', 'News and Whale Flow')}</CardTitle>
              <div className="text-[11px] text-muted-foreground">{focusedBucketLabel}</div>
            </div>
          </CardHeader>
          <CardContent className="h-full overflow-hidden">
            <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
              <div className="flex min-h-0 flex-col">
                <div className="pb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {t('dashboard.insight.whaleFlowTitle', 'Whale Flow')}
                </div>
                <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
                  {focusedFlowEvents.map(event => {
                    const reaction15m = formatReactionAtOffset(chartContext, event.time, 15 * 60 * 1000)
                    const reaction1h = formatReactionAtOffset(chartContext, event.time, 60 * 60 * 1000)

                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => setSelectedEventId(event.id)}
                        className={`w-full rounded-xl border p-3 text-left transition-all duration-300 ${selectedEventId === event.id ? 'border-sky-300 bg-sky-50 shadow-sm' : 'border-border bg-background hover:bg-muted/50'} ${recentEventIds.includes(event.id) ? 'ring-2 ring-sky-200' : ''}`}
                        style={recentEventIds.includes(event.id) ? { animation: 'insight-card-in 360ms ease-out' } : undefined}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                              event.iconVariant === 'flow-down'
                                ? 'bg-red-50 text-red-600'
                                : 'bg-emerald-50 text-emerald-600'
                            }`}>
                              <FlowEventIcon direction={event.iconVariant === 'flow-down' ? 'down' : 'up'} />
                            </div>
                            <div className="line-clamp-2 text-sm font-medium text-foreground">{event.title}</div>
                          </div>
                          <div className="shrink-0 text-[11px] text-muted-foreground">
                            {formatDateTime(event.time, { style: 'short' })}
                          </div>
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{event.summary}</div>
                        <div className="mt-2 space-y-1.5 text-[10px] text-muted-foreground">
                          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
                            {event.evidence.slice(0, 2).map((item, index) => (
                              <span
                                key={`${event.id}-${index}`}
                                className="max-w-[140px] truncate rounded-full bg-muted px-1.5 py-0.5"
                              >
                                {item}
                              </span>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <ReactionChip label={t('dashboard.insight.after15m', '15m later')} value={reaction15m} compact />
                            <ReactionChip label={t('dashboard.insight.after1h', '1h later')} value={reaction1h} compact />
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex min-h-0 flex-col">
                <div className="pb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {t('dashboard.insight.newsFeedTitle', 'News')}
                </div>
                <div className="min-h-0 overflow-y-auto pr-1">
                  <div className="grid gap-3 md:grid-cols-2">
                    {focusedNewsEvents.map(event => {
                      const reaction15m = formatReactionAtOffset(chartContext, event.time, 15 * 60 * 1000)
                      const reaction1h = formatReactionAtOffset(chartContext, event.time, 60 * 60 * 1000)

                      return (
                        <button
                          key={event.id}
                          type="button"
                          onClick={() => setSelectedEventId(event.id)}
                          className={`rounded-xl border p-3 text-left transition-all duration-300 ${selectedEventId === event.id ? 'border-sky-300 bg-sky-50 shadow-sm' : 'border-border bg-background hover:bg-muted/50'} ${recentEventIds.includes(event.id) ? 'ring-2 ring-sky-200' : ''}`}
                          style={recentEventIds.includes(event.id) ? { animation: 'insight-card-in 360ms ease-out' } : undefined}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <div className="line-clamp-2 text-sm font-medium text-foreground">{event.title}</div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              <div className="text-[11px] text-muted-foreground">
                                {formatDateTime(event.time, { style: 'short' })}
                              </div>
                              {event.sourceUrl && (
                                <a
                                  href={event.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-muted-foreground transition-colors hover:text-foreground"
                                  onClick={(e) => e.stopPropagation()}
                                  aria-label={t('dashboard.insight.openSource', 'Open source')}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
                                    <path d="M15 3h6v6"></path>
                                    <path d="M10 14 21 3"></path>
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                  </svg>
                                </a>
                              )}
                            </div>
                          </div>

                          {event.imageUrl && (
                            <div className="mt-1.5 overflow-hidden rounded-md">
                              <img
                                src={event.imageUrl}
                                alt=""
                                className="h-[72px] w-full object-cover"
                                loading="lazy"
                                onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none' }}
                              />
                            </div>
                          )}

                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{event.summary}</div>
                          <div className="mt-2 space-y-1.5 text-[10px] text-muted-foreground">
                            <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
                              {event.evidence.slice(0, 2).map((item, index) => (
                                <span
                                  key={`${event.id}-${index}`}
                                  className="max-w-[140px] truncate rounded-full bg-muted px-1.5 py-0.5"
                                >
                                  {item}
                                </span>
                              ))}
                            </div>
                            <div className="flex items-center gap-1.5 whitespace-nowrap">
                              <ReactionChip label={t('dashboard.insight.after15m', '15m later')} value={reaction15m} compact />
                              <ReactionChip label={t('dashboard.insight.after1h', '1h later')} value={reaction1h} compact />
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex min-h-0 flex-col">
        <Card className="flex h-full min-h-0 flex-col overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between gap-3 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <CardTitle className="text-sm">{t('dashboard.insight.biasTitle', 'Hyper AI Auto Insight')}</CardTitle>
              <InsightRefreshBadge active={showRefreshBadge} />
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <Switch
                checked={aiInsightEnabled}
                onCheckedChange={(checked) => {
                  setAiInsightEnabled(checked)
                  setAiState(checked ? (aiInsight ? 'ready' : 'monitoring') : 'idle')
                  setAiError('')
                  setAiStatusText('')
                  if (!checked) {
                    analysisSeqRef.current += 1
                    activeTaskRef.current = false
                    setCompletedSignature('')
                  }
                }}
              />
              <span>{t('dashboard.insight.aiToggle', 'Hyper AI Auto Insight')}</span>
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-y-auto space-y-4">
            {loading ? (
              <InsightEmptyState />
            ) : !aiInsightEnabled && !aiInsight ? (
              <InsightEmptyState />
            ) : showInlineError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
                <div className="text-sm font-medium text-foreground">
                  {t('dashboard.insight.aiFailed', 'Hyper AI analysis failed.')}
                </div>
                <div className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
                  {aiError || t('dashboard.insight.aiEmpty', 'Hyper AI returned no readable content.')}
                </div>
              </div>
            ) : aiInsight ? (
              <div className="rounded-2xl border border-border bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(241,245,249,0.74))] p-4">
                <SentimentGauge
                  t={t}
                  sentiment={aiInsight.sentiment}
                  probability={aiInsight.probability}
                  marketEmotion={aiInsight.market_emotion}
                  headline={aiInsight.headline}
                />

                <div className="mt-4 rounded-[1.35rem] border border-border/80 bg-background/85 p-4">
                  <div className="text-sm font-medium leading-7 text-foreground">{aiInsight.summary}</div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className={`rounded-full border px-2.5 py-1 ${aiTheme.border} ${aiTheme.softBg} ${aiTheme.softText}`}>
                      {t('dashboard.insight.nextCycleLabel', 'Window')}: {aiInsight.next_cycle_period}
                    </span>
                    {!!aiInsight.similar_pattern && (
                      <span className="rounded-full border border-border/80 bg-muted/45 px-2.5 py-1 text-foreground/80">
                        {t('dashboard.insight.similarPattern', 'Similar pattern')}: {aiInsight.similar_pattern}
                      </span>
                    )}
                  </div>
                  {!!aiInsight.confidence_basis && (
                    <div className="mt-3 rounded-xl border border-border/70 bg-muted/35 px-3 py-2 text-xs italic text-muted-foreground">
                      {t('dashboard.insight.confidenceBasis', 'Confidence basis')}: {aiInsight.confidence_basis}
                    </div>
                  )}
                  {aiGeneratedAt && (
                    <div className="mt-3 text-xs text-muted-foreground">
                      {t('dashboard.insight.aiGeneratedAt', 'Generated at {{time}}', {
                        time: formatDateTime(aiGeneratedAt, { style: 'short' }),
                      })}
                    </div>
                  )}
                </div>

                {aiInsight.sentiment_breakdown && (
                  <div className="mt-4">
                    <BreakdownBars t={t} breakdown={aiInsight.sentiment_breakdown} />
                  </div>
                )}

                {(aiInsight.technical_levels.length > 0 || typeof aiInsight.next_cycle_target_price === 'number' || typeof aiInsight.next_cycle_range_low === 'number' || typeof aiInsight.next_cycle_range_high === 'number') && (
                  <div className="mt-4">
                    <PriceRangeBar t={t} insight={aiInsight} currentPrice={latestChartPrice} />
                  </div>
                )}

                {!!aiInsight.key_drivers.length && (
                  <div className="mt-4 rounded-[1.35rem] border border-border/80 bg-background/85 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                        {t('dashboard.insight.keyDrivers', 'Key Drivers')}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {t('dashboard.insight.priorityDrivers', 'Ranked by impact')}
                      </div>
                    </div>
                    <div className="mt-3 space-y-2.5">
                      {aiInsight.key_drivers.map((item, index) => (
                        <DriverCard key={`driver-${index}`} driver={item} />
                      ))}
                    </div>
                  </div>
                )}

                {!!aiInsight.risks.length && (
                  <div className="mt-4 rounded-[1.35rem] border border-border/80 bg-background/85 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      {t('dashboard.insight.risks', 'Risks')}
                    </div>
                    <div className="mt-3 grid gap-2">
                      {aiInsight.risks.map((item, index) => (
                        <div key={`risk-${index}`} className="rounded-xl border border-rose-200/80 bg-rose-50/60 px-3 py-2 text-sm text-rose-900">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!!aiInsight.explanation_markdown && (
                  <div className="mt-4 max-h-64 overflow-y-auto rounded-[1.35rem] border border-border/80 bg-background/85 p-4">
                    <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      {t('dashboard.insight.explanation', 'Explanation')}
                    </div>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      className="prose prose-sm max-w-none text-foreground dark:prose-invert"
                    >
                      {aiInsight.explanation_markdown}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            ) : (
              <InsightEmptyState />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
