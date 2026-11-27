/**
 * Market Flow Indicators Component
 *
 * Displays market flow indicators in a separate pane below the main chart:
 * - CVD (Cumulative Volume Delta)
 * - Taker Buy/Sell Volume
 * - OI (Open Interest)
 * - OI Delta
 * - Funding Rate
 * - Depth Ratio
 * - Order Imbalance
 */

import { useEffect, useRef, useState } from 'react'
import { createChart, LineSeries, HistogramSeries } from 'lightweight-charts'

interface MarketFlowIndicatorsProps {
  symbol: string
  timeframe: string
  selectedIndicator: string
  height?: number
}

interface IndicatorData {
  time: number
  value?: number
  buy?: number
  sell?: number
}

const INDICATOR_LABELS: Record<string, string> = {
  cvd: 'CVD (Cumulative Volume Delta)',
  taker_volume: 'Taker Buy/Sell Volume',
  oi: 'Open Interest',
  oi_delta: 'OI Change',
  funding: 'Funding Rate (%)',
  depth_ratio: 'Depth Ratio (Bid/Ask)',
  order_imbalance: 'Order Imbalance'
}

const INDICATOR_COLORS: Record<string, { up: string; down: string; line: string }> = {
  cvd: { up: '#22c55e', down: '#ef4444', line: '#3b82f6' },
  taker_volume: { up: '#22c55e', down: '#ef4444', line: '#3b82f6' },
  oi: { up: '#22c55e', down: '#ef4444', line: '#8b5cf6' },
  oi_delta: { up: '#22c55e', down: '#ef4444', line: '#8b5cf6' },
  funding: { up: '#22c55e', down: '#ef4444', line: '#f59e0b' },
  depth_ratio: { up: '#22c55e', down: '#ef4444', line: '#06b6d4' },
  order_imbalance: { up: '#22c55e', down: '#ef4444', line: '#ec4899' }
}

export default function MarketFlowIndicators({
  symbol,
  timeframe,
  selectedIndicator,
  height = 150
}: MarketFlowIndicatorsProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)
  const seriesRef = useRef<any>(null)
  const buySeriesRef = useRef<any>(null)
  const sellSeriesRef = useRef<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dataAvailableFrom, setDataAvailableFrom] = useState<number | null>(null)

  // Fetch indicator data
  const fetchIndicatorData = async () => {
    if (!symbol || !selectedIndicator) return

    setLoading(true)
    setError(null)

    try {
      const endTime = Date.now()
      const startTime = endTime - 7 * 24 * 60 * 60 * 1000 // 7 days

      const response = await fetch(
        `/api/market-flow/indicators?symbol=${symbol}&timeframe=${timeframe}&start_time=${startTime}&end_time=${endTime}&indicators=${selectedIndicator}`
      )

      if (!response.ok) {
        throw new Error('Failed to fetch market flow data')
      }

      const data = await response.json()
      setDataAvailableFrom(data.data_available_from)

      // Update chart with data
      updateChart(data.indicators[selectedIndicator] || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  // Update chart with new data
  const updateChart = (data: IndicatorData[]) => {
    if (!chartRef.current) return

    if (selectedIndicator === 'taker_volume') {
      // Dual histogram for buy/sell
      if (buySeriesRef.current && data.length > 0) {
        const buyData = data.map(d => ({
          time: d.time,
          value: d.buy || 0,
          color: '#22c55e'
        }))
        buySeriesRef.current.setData(buyData)
      }
      if (sellSeriesRef.current && data.length > 0) {
        const sellData = data.map(d => ({
          time: d.time,
          value: -(d.sell || 0),
          color: '#ef4444'
        }))
        sellSeriesRef.current.setData(sellData)
      }
    } else {
      // Single line or histogram
      if (seriesRef.current && data.length > 0) {
        const colors = INDICATOR_COLORS[selectedIndicator]

        if (['oi_delta', 'order_imbalance'].includes(selectedIndicator)) {
          // Histogram with colors based on value
          const histData = data.map(d => ({
            time: d.time,
            value: d.value || 0,
            color: (d.value || 0) >= 0 ? colors.up : colors.down
          }))
          seriesRef.current.setData(histData)
        } else {
          // Line chart
          seriesRef.current.setData(data)
        }
      }
    }

    chartRef.current.timeScale().fitContent()
  }

  // Create series based on indicator type
  const createSeries = (chart: any) => {
    // Remove existing series
    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current)
      seriesRef.current = null
    }
    if (buySeriesRef.current) {
      chart.removeSeries(buySeriesRef.current)
      buySeriesRef.current = null
    }
    if (sellSeriesRef.current) {
      chart.removeSeries(sellSeriesRef.current)
      sellSeriesRef.current = null
    }

    const colors = INDICATOR_COLORS[selectedIndicator]

    if (selectedIndicator === 'taker_volume') {
      // Dual histogram for buy/sell
      buySeriesRef.current = chart.addSeries(HistogramSeries, {
        color: colors.up,
        priceFormat: { type: 'volume' },
        priceScaleId: 'right'
      })
      sellSeriesRef.current = chart.addSeries(HistogramSeries, {
        color: colors.down,
        priceFormat: { type: 'volume' },
        priceScaleId: 'right'
      })
    } else if (['oi_delta', 'order_imbalance'].includes(selectedIndicator)) {
      // Histogram
      seriesRef.current = chart.addSeries(HistogramSeries, {
        color: colors.line,
        priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
        priceScaleId: 'right'
      })
    } else {
      // Line chart
      seriesRef.current = chart.addSeries(LineSeries, {
        color: colors.line,
        lineWidth: 2,
        priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
        priceScaleId: 'right'
      })
    }
  }

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: '#9ca3af'
      },
      grid: {
        vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
        horzLines: { color: 'rgba(42, 46, 57, 0.5)' }
      },
      rightPriceScale: {
        borderColor: 'rgba(42, 46, 57, 0.5)',
        scaleMargins: { top: 0.1, bottom: 0.1 }
      },
      timeScale: {
        borderColor: 'rgba(42, 46, 57, 0.5)',
        timeVisible: true,
        secondsVisible: false
      },
      crosshair: {
        mode: 1,
        vertLine: { color: 'rgba(255, 255, 255, 0.4)', width: 1, style: 2 },
        horzLine: { color: 'rgba(255, 255, 255, 0.4)', width: 1, style: 2 }
      }
    })

    chartRef.current = chart
    createSeries(chart)

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      buySeriesRef.current = null
      sellSeriesRef.current = null
    }
  }, [height])

  // Recreate series when indicator changes
  useEffect(() => {
    if (chartRef.current) {
      createSeries(chartRef.current)
      fetchIndicatorData()
    }
  }, [selectedIndicator])

  // Fetch data when symbol or timeframe changes
  useEffect(() => {
    fetchIndicatorData()
  }, [symbol, timeframe])

  if (!selectedIndicator) return null

  return (
    <div className="relative border-t border-gray-700">
      <div className="absolute top-2 left-2 z-10 flex items-center gap-2">
        <span className="text-xs text-gray-400">
          {INDICATOR_LABELS[selectedIndicator] || selectedIndicator}
        </span>
        {loading && (
          <span className="text-xs text-yellow-500">Loading...</span>
        )}
        {dataAvailableFrom && (
          <span className="text-xs text-gray-500">
            Data from: {new Date(dataAvailableFrom).toLocaleDateString()}
          </span>
        )}
      </div>
      {error && (
        <div className="absolute top-2 right-2 z-10 text-xs text-red-500">
          {error}
        </div>
      )}
      <div ref={chartContainerRef} style={{ height }} />
    </div>
  )
}
