import { useEffect, useRef, useState } from 'react'
import { createChart, CandlestickSeries, CandlestickData, Time, IChartApi, ISeriesApi, createSeriesMarkers, LineSeries, HistogramSeries } from 'lightweight-charts'
import { formatChartTime } from '../../lib/dateTime'

interface KlineData {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
}

// Full trigger data from backend
interface TriggerData {
  timestamp: number
  value?: number
  threshold?: number
  metric?: string
  triggered_signals?: Array<{
    signal_id: number
    signal_name: string
    value: number
    threshold: number
  }>
  trigger_type?: string
  // taker_volume composite signal fields
  direction?: string
  ratio?: number
  log_ratio?: number
  volume?: number
  ratio_threshold?: number
  volume_threshold?: number
  // MACD event-based signal fields
  triggered_event?: string
  event_types?: string[]
  values?: {
    macd: number
    signal: number
    histogram: number
    prev_histogram?: number
  }
  cross_strength?: number
  // Market Regime classification
  market_regime?: {
    regime: string
    direction: string
    confidence: number
    reason?: string
  }
}

// MACD indicator data from backend
interface MacdData {
  macd: number[]
  signal: number[]
  histogram: number[]
}

interface SignalPreviewChartProps {
  klines: KlineData[]
  triggers: TriggerData[]
  timeWindow: string
  signalMetric?: string // For single signal display
  macd?: MacdData // MACD indicator data
}

// Format metric name for display
function formatMetricName(metric: string): string {
  const names: Record<string, string> = {
    cvd_change: 'CVD Change',
    oi_delta: 'OI Delta',
    oi_delta_percent: 'OI Delta %',
    buy_sell_imbalance: 'Buy/Sell Imbalance',
    depth_ratio: 'Depth Ratio',
    taker_buy_ratio: 'Taker Buy Ratio',
    taker_direction: 'Taker Direction',
  }
  return names[metric] || metric
}

// Format value based on metric type
function formatValue(metric: string, value: number): string {
  if (metric.includes('ratio') || metric.includes('imbalance')) {
    return value.toFixed(3)
  }
  if (metric.includes('percent') || metric === 'cvd_change' || metric === 'oi_delta') {
    return `${value.toFixed(2)}%`
  }
  return value.toFixed(4)
}

// Get regime display color
function getRegimeColor(regime: string): string {
  const colors: Record<string, string> = {
    stop_hunt: 'text-red-500',
    absorption: 'text-purple-500',
    breakout: 'text-green-500',
    continuation: 'text-blue-500',
    exhaustion: 'text-orange-500',
    trap: 'text-yellow-500',
    noise: 'text-gray-500',
  }
  return colors[regime] || 'text-gray-500'
}

// Format regime name for display
function formatRegimeName(regime: string): string {
  const names: Record<string, string> = {
    stop_hunt: 'Stop Hunt',
    absorption: 'Absorption',
    breakout: 'Breakout',
    continuation: 'Continuation',
    exhaustion: 'Exhaustion',
    trap: 'Trap',
    noise: 'Noise',
  }
  return names[regime] || regime
}

export default function SignalPreviewChart({ klines, triggers, timeWindow, signalMetric, macd }: SignalPreviewChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const [tooltip, setTooltip] = useState<{ visible: boolean; x: number; y: number; content: TriggerData | TriggerData[] | null }>({
    visible: false, x: 0, y: 0, content: null
  })

  // Build time-to-trigger map for quick lookup (may have multiple triggers per bucket)
  const triggerMap = useRef<Map<number, TriggerData | TriggerData[]>>(new Map())

  // Get bucket size in seconds from timeWindow
  const getBucketSize = (tw: string): number => {
    const match = tw.match(/^(\d+)([mhd])$/)
    if (!match) return 300 // default 5min
    const [, num, unit] = match
    const n = parseInt(num)
    if (unit === 'm') return n * 60
    if (unit === 'h') return n * 3600
    if (unit === 'd') return n * 86400
    return 300
  }

  // Calculate bucket time for a trigger (used by both marker and triggerMap)
  const getTriggerBucketTime = (timestamp: number, bucketSize: number): number => {
    const triggerSec = Math.floor(timestamp / 1000)
    const bucketSec = Math.floor(triggerSec / bucketSize) * bucketSize
    return formatChartTime(bucketSec)
  }

  useEffect(() => {
    // Build trigger map using floored bucket time as key (to match K-line time)
    triggerMap.current.clear()
    const bucketSize = getBucketSize(timeWindow)

    triggers.forEach(t => {
      const chartTime = getTriggerBucketTime(t.timestamp, bucketSize)

      // Store all triggers for this bucket (may have multiple)
      const existing = triggerMap.current.get(chartTime)
      if (existing) {
        // Merge triggered_signals if both have them
        if (Array.isArray(existing)) {
          existing.push(t)
        } else {
          triggerMap.current.set(chartTime, [existing, t])
        }
      } else {
        triggerMap.current.set(chartTime, t)
      }
    })
  }, [triggers, timeWindow])

  useEffect(() => {
    if (!chartContainerRef.current || klines.length === 0) return

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 500,
      layout: {
        background: { color: '#1a1a2e' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: '#2d2d44' },
        horzLines: { color: '#2d2d44' },
      },
      crosshair: {
        mode: 1,
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#2d2d44',
        barSpacing: 9,
        rightBarStaysOnScroll: false,
      },
      rightPriceScale: {
        borderColor: '#2d2d44',
      },
    })

    chartRef.current = chart

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })

    seriesRef.current = candlestickSeries

    // Convert klines to chart format
    const chartData: CandlestickData<Time>[] = klines.map(k => ({
      time: formatChartTime(k.timestamp / 1000) as Time,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }))

    candlestickSeries.setData(chartData)

    // Add MACD overlay if available
    if (macd && macd.macd && macd.signal && macd.histogram) {
      // Calculate price range for scaling MACD
      const prices = klines.flatMap(k => [k.high, k.low])
      const priceMin = Math.min(...prices)
      const priceMax = Math.max(...prices)
      const priceRange = priceMax - priceMin

      // MACD will occupy bottom 25% of the chart
      const macdDisplayMin = priceMin - priceRange * 0.05
      const macdDisplayMax = priceMin + priceRange * 0.20

      // Find MACD value range
      const allMacdValues = [...macd.macd, ...macd.signal, ...macd.histogram].filter(v => v !== 0)
      if (allMacdValues.length > 0) {
        const macdMin = Math.min(...allMacdValues)
        const macdMax = Math.max(...allMacdValues)
        const macdRange = macdMax - macdMin || 1

        // Scale function: map MACD value to price range
        const scaleToPrice = (v: number) => {
          const normalized = (v - macdMin) / macdRange
          return macdDisplayMin + normalized * (macdDisplayMax - macdDisplayMin)
        }

        // Add histogram as area/bars at bottom
        const histogramSeries = chart.addSeries(HistogramSeries, {
          priceScaleId: 'right',
          priceFormat: { type: 'price' },
          base: scaleToPrice(0),
        })

        const histogramData = klines.map((k, i) => ({
          time: formatChartTime(k.timestamp / 1000) as Time,
          value: scaleToPrice(macd.histogram[i] || 0),
          color: (macd.histogram[i] || 0) >= 0 ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)',
        }))
        histogramSeries.setData(histogramData)

        // Add MACD line
        const macdLineSeries = chart.addSeries(LineSeries, {
          color: '#2962FF',
          lineWidth: 1,
          priceScaleId: 'right',
          priceFormat: { type: 'price' },
        })

        const macdLineData = klines.map((k, i) => ({
          time: formatChartTime(k.timestamp / 1000) as Time,
          value: scaleToPrice(macd.macd[i] || 0),
        }))
        macdLineSeries.setData(macdLineData)

        // Add Signal line
        const signalLineSeries = chart.addSeries(LineSeries, {
          color: '#FF6D00',
          lineWidth: 1,
          priceScaleId: 'right',
          priceFormat: { type: 'price' },
        })

        const signalLineData = klines.map((k, i) => ({
          time: formatChartTime(k.timestamp / 1000) as Time,
          value: scaleToPrice(macd.signal[i] || 0),
        }))
        signalLineSeries.setData(signalLineData)
      }
    }

    // Add trigger markers - use same bucket time as triggerMap
    if (triggers.length > 0) {
      const bucketSize = getBucketSize(timeWindow)
      const markers = triggers.map(t => ({
        time: getTriggerBucketTime(t.timestamp, bucketSize) as Time,
        position: 'aboveBar' as const,
        color: '#F8CD74',
        shape: 'arrowDown' as const,
        text: '⚡',
        size: 2,
      }))
      createSeriesMarkers(candlestickSeries, markers)
    }

    // Subscribe to crosshair move for tooltip
    chart.subscribeCrosshairMove(param => {
      if (!param.time || !param.point) {
        setTooltip(prev => ({ ...prev, visible: false }))
        return
      }

      // param.time is the local chart time (same format as triggerMap keys)
      const chartTime = param.time as number

      // Direct lookup - triggerMap uses same time format as chart
      const matchedTrigger = triggerMap.current.get(chartTime) || null

      if (matchedTrigger) {
        setTooltip({
          visible: true,
          x: param.point.x,
          y: param.point.y,
          content: matchedTrigger,
        })
      } else {
        setTooltip(prev => ({ ...prev, visible: false }))
      }
    })

    chart.timeScale().scrollToRealTime()

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [klines, triggers, macd])

  // Render a single trigger's content
  const renderSingleTrigger = (t: TriggerData, idx?: number) => {
    // Pool trigger with multiple signals (AND logic)
    if (t.triggered_signals && t.triggered_signals.length > 0) {
      return (
        <div key={idx} className="space-y-2">
          {t.triggered_signals.map((sig: any, i: number) => {
            // Check if this is a taker_volume signal
            if (sig.metric === 'taker_volume' && sig.direction !== undefined) {
              const dirColor = sig.direction === 'buy' ? 'text-green-400' : 'text-red-400'
              const dirLabel = sig.direction === 'buy' ? 'BUY' : 'SELL'
              const dominantMultiplier = sig.direction === 'sell' && sig.ratio && sig.ratio > 0
                ? (1 / sig.ratio).toFixed(2)
                : sig.ratio?.toFixed(2)
              const dominantLabel = sig.direction === 'buy' ? 'Buyers' : 'Sellers'
              return (
                <div key={i} className="text-xs border-l-2 border-gray-600 pl-2">
                  <div className="text-gray-400 mb-0.5">{sig.signal_name || 'Taker Volume'}</div>
                  <div>
                    <span className="text-gray-500">Dir:</span>{' '}
                    <span className={`font-mono font-medium ${dirColor}`}>{dirLabel}</span>
                    <span className="text-gray-500 ml-2">{dominantLabel}:</span>{' '}
                    <span className="text-white font-mono">{dominantMultiplier}x</span>
                    <span className="text-gray-500 ml-1">(≥{sig.ratio_threshold?.toFixed(1)}x)</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Vol:</span>{' '}
                    <span className="text-white font-mono">${((sig.volume || 0) / 1e6).toFixed(1)}M</span>
                    <span className="text-gray-500 ml-1">(≥${((sig.volume_threshold || 0) / 1e6).toFixed(1)}M)</span>
                  </div>
                </div>
              )
            }
            // Standard signal
            return (
              <div key={i} className="text-xs border-l-2 border-gray-600 pl-2">
                <div className="text-gray-400 mb-0.5">{sig.signal_name || 'Signal'}</div>
                <div>
                  <span className="text-white font-mono">{sig.value?.toFixed(4) ?? 'N/A'}</span>
                  <span className="text-gray-500 ml-1">(≥{sig.threshold?.toFixed(4) ?? 'N/A'})</span>
                </div>
              </div>
            )
          })}
        </div>
      )
    }

    // taker_volume composite signal trigger
    if (t.ratio !== undefined && t.direction !== undefined) {
      const dirColor = t.direction === 'buy' ? 'text-green-400' : 'text-red-400'
      const dirLabel = t.direction === 'buy' ? 'BUY' : 'SELL'
      // Calculate dominant side multiplier for intuitive display
      // BUY: ratio = buy/sell, so multiplier = ratio (e.g., 2.0x means buyers 2x sellers)
      // SELL: ratio = buy/sell < 1, so multiplier = 1/ratio (e.g., 0.5 -> 2.0x means sellers 2x buyers)
      const dominantMultiplier = t.direction === 'sell' && t.ratio && t.ratio > 0
        ? (1 / t.ratio).toFixed(2)
        : t.ratio?.toFixed(2)
      const dominantLabel = t.direction === 'buy' ? 'Buyers' : 'Sellers'
      return (
        <div key={idx} className="text-xs space-y-0.5">
          <div>
            <span className="text-gray-400">Direction:</span>{' '}
            <span className={`font-mono font-medium ${dirColor}`}>{dirLabel}</span>
          </div>
          <div>
            <span className="text-gray-400">{dominantLabel}:</span>{' '}
            <span className="text-white font-mono">{dominantMultiplier}x</span>
            <span className="text-gray-500 ml-1">(≥{t.ratio_threshold?.toFixed(2)}x)</span>
          </div>
          <div>
            <span className="text-gray-400">Volume:</span>{' '}
            <span className="text-white font-mono">${((t.volume || 0) / 1000).toFixed(0)}K</span>
            {t.volume_threshold !== undefined && t.volume_threshold > 0 && (
              <span className="text-gray-500 ml-1">(≥${(t.volume_threshold / 1000).toFixed(0)}K)</span>
            )}
          </div>
        </div>
      )
    }

    // MACD event-based signal trigger
    if (t.triggered_event && t.values) {
      const eventLabels: Record<string, string> = {
        golden_cross: '🟢 Golden Cross',
        death_cross: '🔴 Death Cross',
        histogram_positive: '🟢 Histogram +',
        histogram_negative: '🔴 Histogram -',
        macd_above_zero: '🟢 MACD > 0',
        macd_below_zero: '🔴 MACD < 0',
      }
      const eventColor = t.triggered_event.includes('golden') || t.triggered_event.includes('positive') || t.triggered_event.includes('above')
        ? 'text-green-400' : 'text-red-400'
      return (
        <div key={idx} className="text-xs space-y-0.5">
          <div>
            <span className="text-gray-400">Event:</span>{' '}
            <span className={`font-mono font-medium ${eventColor}`}>
              {eventLabels[t.triggered_event] || t.triggered_event}
            </span>
          </div>
          <div>
            <span className="text-gray-400">MACD:</span>{' '}
            <span className="text-white font-mono">{t.values.macd?.toFixed(4)}</span>
          </div>
          <div>
            <span className="text-gray-400">Signal:</span>{' '}
            <span className="text-white font-mono">{t.values.signal?.toFixed(4)}</span>
          </div>
          <div>
            <span className="text-gray-400">Histogram:</span>{' '}
            <span className="text-white font-mono">{t.values.histogram?.toFixed(4)}</span>
            {t.values.prev_histogram !== undefined && (
              <span className="text-gray-500 ml-1">(prev: {t.values.prev_histogram?.toFixed(4)})</span>
            )}
          </div>
          {t.cross_strength !== undefined && (
            <div>
              <span className="text-gray-400">Strength:</span>{' '}
              <span className="text-white font-mono">{t.cross_strength?.toFixed(4)}</span>
            </div>
          )}
        </div>
      )
    }

    // Single signal trigger
    if (t.value !== undefined) {
      const metric = t.metric || signalMetric || 'value'
      return (
        <div key={idx} className="text-xs">
          <span className="text-gray-400">{formatMetricName(metric)}:</span>{' '}
          <span className="text-white font-mono">{formatValue(metric, t.value)}</span>
          {t.threshold !== undefined && (
            <span className="text-gray-500 ml-1">(≥{formatValue(metric, t.threshold)})</span>
          )}
        </div>
      )
    }
    return null
  }

  // Render tooltip content (may have multiple triggers in same bucket)
  const renderTooltipContent = () => {
    if (!tooltip.content) return null

    const content = tooltip.content
    const triggers = Array.isArray(content) ? content : [content]
    // Get regime from first trigger (all triggers in same bucket share same regime)
    const regime = triggers[0]?.market_regime

    return (
      <div className="space-y-2">
        <div className="text-xs text-yellow-400 font-medium border-b border-gray-600 pb-1">
          Trigger Values {triggers.length > 1 && `(${triggers.length})`}
        </div>
        {triggers.map((t, idx) => renderSingleTrigger(t, idx))}
        {regime && (
          <div className="text-xs border-t border-gray-600 pt-1 mt-1">
            <span className="text-gray-400">Regime:</span>{' '}
            <span className={`font-medium ${getRegimeColor(regime.regime)}`}>
              {formatRegimeName(regime.regime)}
            </span>
            <span className="text-gray-500 ml-1">
              ({regime.direction === 'long' ? '↑' : regime.direction === 'short' ? '↓' : '−'})
            </span>
            <span className="text-gray-500 ml-1">
              {(regime.confidence * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="relative w-full h-[500px]">
      <div ref={chartContainerRef} className="w-full h-full" />
      {macd && (
        <div className="absolute top-2 left-2 text-xs text-gray-400 bg-gray-900/70 px-2 py-1 rounded">
          MACD (12, 26, 9)
        </div>
      )}
      {tooltip.visible && tooltip.content && (
        <div
          className="absolute z-50 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 shadow-lg pointer-events-none"
          style={{
            left: Math.min(tooltip.x + 15, (chartContainerRef.current?.clientWidth || 400) - 250),
            top: Math.max(tooltip.y - 60, 10),
          }}
        >
          {renderTooltipContent()}
        </div>
      )}
    </div>
  )
}
