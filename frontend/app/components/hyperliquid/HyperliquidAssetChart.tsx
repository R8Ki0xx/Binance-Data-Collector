/**
 * HyperliquidAssetChart - Multi-Account Asset Curve Chart for Hyperliquid Mode
 *
 * Used by: HyperliquidView (line 6 import, line 56 usage)
 *
 * Features:
 * - 5-minute bucketed asset snapshots
 * - Multi-account display with individual curves
 * - Baseline reference line for profit/loss visualization
 * - Terminal dots with account logos and current values
 *
 * Data source: /api/account/asset-curve with environment parameter (testnet/mainnet)
 * Backend field: total_assets (NOT total_equity - field name fixed in v0.5.1)
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  LineChart,
  Line,
  Area,
  AreaChart,
  ComposedChart,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Customized,
  Brush
} from 'recharts'
import { Card } from '@/components/ui/card'
import { getModelChartLogo, getModelColor } from '../portfolio/logoAssets'
import FlipNumber from '../portfolio/FlipNumber'
import type { HyperliquidEnvironment } from '@/lib/types/hyperliquid'
import { formatDateTime } from '@/lib/dateTime'

interface HyperliquidAssetData {
  timestamp: number
  datetime_str: string
  account_id: number
  total_assets: number
  username: string
  wallet_address?: string | null
  exchange?: string  // 'hyperliquid' | 'binance'
}

export interface TradeMarker {
  trade_id: number
  trade_time: string
  side: string // 'BUY' | 'SELL' | 'CLOSE'
  symbol: string
  account_id: number
  price?: number
  exchange?: string // 'hyperliquid' | 'binance'
}

interface HyperliquidAssetChartProps {
  accountId: number
  refreshTrigger?: number
  environment?: HyperliquidEnvironment
  selectedAccount?: number | 'all'
  trades?: TradeMarker[]
  selectedSymbol?: string | null
  selectedExchange?: 'all' | 'hyperliquid' | 'binance'
}

const SMALL_GAP_FILL_THRESHOLD_SECONDS = 15 * 60

export default function HyperliquidAssetChart({
  accountId,
  refreshTrigger,
  environment,
  selectedAccount,
  trades,
  selectedSymbol,
  selectedExchange,
}: HyperliquidAssetChartProps) {
  const [data, setData] = useState<HyperliquidAssetData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logoPulseMap, setLogoPulseMap] = useState<Map<number, number>>(new Map())
  const [timeRange, setTimeRange] = useState<'7d' | '15d' | '1m' | '3m' | 'all'>('7d')
  const fetchingRef = useRef(false)

  // Brush state - preserve zoom level across data refreshes
  const [brushRange, setBrushRange] = useState<{ startIndex?: number; endIndex?: number }>({})
  const handleBrushChange = useCallback((range: { startIndex?: number; endIndex?: number }) => {
    setBrushRange(range)
  }, [])

  // Fetch Hyperliquid asset curve data (5-minute bucketed)
  const fetchData = useCallback(async () => {
    // Prevent duplicate requests
    if (fetchingRef.current) {
      return
    }
    fetchingRef.current = true
    try {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams({
        timeframe: '5m',
        trading_mode: environment || 'testnet',
      })
      if (environment) {
        params.set('environment', environment)
      }
      if (selectedAccount && selectedAccount !== 'all') {
        params.set('account_id', String(selectedAccount))
      }

      // Calculate time range based on selected option
      const now = new Date()
      if (timeRange !== 'all') {
        const startDate = new Date(now)
        switch (timeRange) {
          case '7d':
            startDate.setDate(now.getDate() - 7)
            break
          case '15d':
            startDate.setDate(now.getDate() - 15)
            break
          case '1m':
            startDate.setMonth(now.getMonth() - 1)
            break
          case '3m':
            startDate.setMonth(now.getMonth() - 3)
            break
        }
        params.set('start_date', startDate.toISOString())
      }
      params.set('end_date', now.toISOString())

      const response = await fetch(`/api/account/asset-curve?${params.toString()}`)
      if (!response.ok) {
        throw new Error('Failed to fetch asset curve data')
      }

      const assetData = await response.json()
      setData(assetData || [])
    } catch (err) {
      console.error('Error fetching Hyperliquid asset curve:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
      fetchingRef.current = false
    }
  }, [environment, selectedAccount, timeRange])

  useEffect(() => {
    // Debounce: wait 300ms before fetching to avoid rapid successive calls
    const timeoutId = setTimeout(() => {
      fetchData()
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [fetchData, refreshTrigger])

  // Process chart data - group by account+exchange combination
  const { chartData, accountsData, yAxisDomain, baseline } = useMemo(() => {
    if (!data.length) return { chartData: [], accountsData: [], yAxisDomain: [0, 1000], baseline: 1000 }

    // Filter data by selected exchange
    const filteredData = selectedExchange && selectedExchange !== 'all'
      ? data.filter(item => (item.exchange || 'hyperliquid') === selectedExchange)
      : data

    if (!filteredData.length) return { chartData: [], accountsData: [], yAxisDomain: [0, 1000], baseline: 1000 }

    // Group by timestamp and create chart points
    const timeGroups = new Map<number, any>()
    // Key: "accountId_exchange" to support same account on multiple exchanges
    const accounts = new Map<string, {
      account_id: number
      username: string
      exchange: string
      curveKey: string  // unique key for chart dataKey
      logo: { src: string; alt: string; color?: string }
    }>()

    filteredData.forEach(item => {
      if (!timeGroups.has(item.timestamp)) {
        timeGroups.set(item.timestamp, {
          timestamp: item.timestamp,
          datetime_str: item.datetime_str
        })
      }

      const exchange = item.exchange || 'hyperliquid'
      // Create unique curve key: "username (Exchange Name)" for multi-exchange accounts
      const exchangeName = exchange === 'hyperliquid' ? 'Hyperliquid' : 'Binance'
      const curveKey = `${item.username} (${exchangeName})`
      const accountKey = `${item.account_id}_${exchange}`

      const point = timeGroups.get(item.timestamp)!
      point[curveKey] = item.total_assets

      if (!accounts.has(accountKey)) {
        const baseLogo = getModelChartLogo(item.username)
        // Adjust color for Binance to differentiate from Hyperliquid
        const color = exchange === 'binance'
          ? '#F0B90B'  // Binance yellow
          : baseLogo.color || getModelColor(item.username)

        accounts.set(accountKey, {
          account_id: item.account_id,
          username: item.username,
          exchange,
          curveKey,
          logo: { ...baseLogo, color }
        })
      }
    })

    const rawChartData = Array.from(timeGroups.values()).sort((a, b) => a.timestamp - b.timestamp)
    const accountsData = Array.from(accounts.entries()).map(([key, info]) => ({
      key,  // "accountId_exchange"
      ...info
    }))

    // Smooth over short snapshot gaps caused by transient network hiccups.
    // Long gaps remain disconnected to avoid implying continuous data where none exists.
    const chartData = rawChartData.map(point => ({ ...point }))
    for (const account of accountsData) {
      let previousKnownIndex: number | null = null

      for (let i = 0; i < chartData.length; i++) {
        const value = chartData[i][account.curveKey]
        if (typeof value !== 'number') continue

        if (previousKnownIndex !== null) {
          const previousPoint = chartData[previousKnownIndex]
          const gapSeconds = chartData[i].timestamp - previousPoint.timestamp
          if (gapSeconds > 0 && gapSeconds <= SMALL_GAP_FILL_THRESHOLD_SECONDS) {
            for (let j = previousKnownIndex + 1; j < i; j++) {
              if (chartData[j][account.curveKey] == null) {
                chartData[j][account.curveKey] = previousPoint[account.curveKey]
              }
            }
          }
        }

        previousKnownIndex = i
      }
    }

    // Calculate baseline (initial capital) - only meaningful for single account view
    let baseline: number | null = null
    if (chartData.length > 0 && accountsData.length === 1) {
      // Single account: use first non-null data point as starting capital
      for (const point of chartData) {
        const val = point[accountsData[0].curveKey]
        if (typeof val === 'number') {
          baseline = val
          break
        }
      }
    }

    // Calculate Y-axis domain with smart padding
    const allValues = filteredData.map(item => item.total_assets).filter(val => typeof val === 'number')

    if (allValues.length === 0) return { chartData, accountsData, yAxisDomain: [0, 1000], baseline }

    const minValue = Math.min(...allValues)
    const maxValue = Math.max(...allValues)
    const range = maxValue - minValue

    const hasMultipleAccounts = accountsData.length > 1
    const paddingPercent = hasMultipleAccounts ? 0.05 : 0.15

    // When all values are the same (range = 0), use fixed padding based on baseline
    const padding = range > 0 ? range * paddingPercent : baseline * 0.1

    return {
      chartData,
      accountsData,
      yAxisDomain: [Math.max(0, minValue - padding), maxValue + padding],
      baseline
    }
  }, [data, selectedExchange])

  // Process trade markers - snap to nearest 5-minute bucket
  const tradeMarkers = useMemo(() => {
    if (!trades?.length || !chartData.length) return []

    const timestamps = chartData.map(d => d.timestamp)
    const markers: Array<{
      trade_id: number
      timestamp: number
      datetime_str: string
      side: string
      symbol: string
      price?: number
      chartIndex: number
      account_id: number
      exchange?: string
    }> = []

    trades.forEach(trade => {
      if (!trade.trade_time) return
      // Filter by selected account
      if (selectedAccount && selectedAccount !== 'all' && trade.account_id !== selectedAccount) return
      // Filter by selected symbol
      if (selectedSymbol && trade.symbol !== selectedSymbol) return
      // Filter by selected exchange
      const tradeExchange = trade.exchange || 'hyperliquid'
      if (selectedExchange && selectedExchange !== 'all' && tradeExchange !== selectedExchange) return

      // Convert trade_time ISO string to Unix timestamp
      const tradeTs = Math.floor(new Date(trade.trade_time + (trade.trade_time.includes('Z') ? '' : 'Z')).getTime() / 1000)

      // Find nearest 5-minute bucket
      let nearestIdx = 0
      let minDiff = Math.abs(timestamps[0] - tradeTs)
      for (let i = 1; i < timestamps.length; i++) {
        const diff = Math.abs(timestamps[i] - tradeTs)
        if (diff < minDiff) {
          minDiff = diff
          nearestIdx = i
        }
      }

      // Only include if within 5 minutes (300 seconds) of a data point
      if (minDiff <= 300) {
        markers.push({
          trade_id: trade.trade_id,
          timestamp: timestamps[nearestIdx],
          datetime_str: chartData[nearestIdx].datetime_str,
          side: trade.side,
          symbol: trade.symbol,
          price: trade.price,
          chartIndex: nearestIdx,
          account_id: trade.account_id,
          exchange: trade.exchange
        })
      }
    })

    return markers
  }, [trades, chartData, selectedAccount, selectedSymbol, selectedExchange])

  // Trade marker colors matching Modelchat
  const getTradeMarkerStyle = (side: string) => {
    switch (side.toUpperCase()) {
      case 'BUY':
        return { bg: '#10B981', letter: 'B' } // emerald-500 (green)
      case 'SELL':
        return { bg: '#EF4444', letter: 'S' } // red-500 (red)
      case 'CLOSE':
        return { bg: '#3B82F6', letter: 'C' } // blue-500 (blue)
      case 'HOLD':
        return { bg: '#6B7280', letter: 'H' } // gray-500 (gray)
      default:
        return { bg: '#F97316', letter: '?' } // orange-500
    }
  }

  // Hover tooltip state for trade markers
  const [hoveredTrade, setHoveredTrade] = useState<{
    x: number
    y: number
    side: string
    symbol: string
    price?: number
  } | null>(null)

  // Render trade markers on chart
  const renderTradeMarkers = useCallback((props: any) => {
    const { xAxisMap, yAxisMap } = props
    if (!xAxisMap || !yAxisMap || !tradeMarkers.length) return null

    const xAxis = Object.values(xAxisMap)[0] as any
    const yAxis = Object.values(yAxisMap)[0] as any
    if (!xAxis?.scale || !yAxis?.scale) return null

    return (
      <g className="trade-markers">
        {tradeMarkers.map((marker, idx) => {
          const dataPoint = chartData[marker.chartIndex]
          if (!dataPoint) return null

          const x = xAxis.scale(dataPoint.datetime_str)
          // Find the account this trade belongs to and get y value from that account's curve
          // Match by account_id and exchange (supports both Hyperliquid and Binance)
          const markerExchange = marker.exchange || 'hyperliquid'
          const account = accountsData.find(a => a.account_id === marker.account_id && a.exchange === markerExchange)
          if (!account) return null  // Skip if account not found (filtered out)
          const yValue = dataPoint[account.curveKey]
          if (yValue == null || x == null) return null

          const y = yAxis.scale(yValue)
          const { bg, letter } = getTradeMarkerStyle(marker.side)
          const size = 18

          return (
            <g
              key={`trade-${marker.trade_id}-${idx}`}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredTrade({
                x,
                y,
                side: marker.side,
                symbol: marker.symbol,
                price: marker.price
              })}
              onMouseLeave={() => setHoveredTrade(null)}
            >
              <circle
                cx={x}
                cy={y}
                r={size / 2}
                fill={bg}
                stroke="#fff"
                strokeWidth={2}
                style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' }}
              />
              <text
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fff"
                fontSize={10}
                fontWeight="bold"
                style={{ pointerEvents: 'none' }}
              >
                {letter}
              </text>
            </g>
          )
        })}
      </g>
    )
  }, [tradeMarkers, chartData, accountsData])

  // Terminal dot renderer with logo and value
  const renderTerminalDot = useCallback(
    (account: {
      key: string
      account_id: number
      username: string
      exchange: string
      curveKey: string
      logo: { src: string; alt: string; color?: string }
    }) =>
      (props: { cx?: number; cy?: number; index?: number; value?: number; payload?: any }) => {
        const { cx, cy, index, payload } = props
        if (cx == null || cy == null || index == null || !payload) return null
        if (chartData.length === 0) return null

        // Determine visible range from brush, or use full data range
        const visibleStart = brushRange.startIndex ?? 0
        const visibleEnd = brushRange.endIndex ?? chartData.length - 1

        // Find the last data point within visible range where this account has a value
        let lastVisibleIndex = -1
        for (let i = visibleEnd; i >= visibleStart; i--) {
          if (typeof chartData[i]?.[account.curveKey] === 'number') {
            lastVisibleIndex = i
            break
          }
        }

        if (lastVisibleIndex === -1 || index !== lastVisibleIndex) return null

        const value = payload[account.curveKey]
        if (typeof value !== 'number') return null

        const color = account.logo?.color || getModelColor(account.username)
        const pulseIteration = logoPulseMap.get(account.account_id) ?? 0
        const size = 32
        const logoX = cx - size / 2
        const logoY = cy - size / 2
        const labelX = cx + size / 2 + 2
        const labelY = cy - 18

        // Exchange badge position
        const badgeSize = 14
        const badgeX = cx + size / 2 - badgeSize / 2
        const badgeY = cy + size / 2 - badgeSize / 2

        return (
          <g>
            {pulseIteration > 0 && (
              <circle
                cx={cx}
                cy={cy}
                r={size / 2}
                fill={color}
                className="pointer-events-none animate-ping-logo"
              />
            )}
            <foreignObject
              x={logoX}
              y={logoY}
              width={size}
              height={size}
              style={{ overflow: 'visible', pointerEvents: 'none' }}
            >
              <div
                style={{
                  width: size,
                  height: size,
                  borderRadius: '50%',
                  backgroundColor: color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.16)',
                }}
              >
                <img
                  src={account.logo?.src}
                  alt={account.logo?.alt}
                  style={{
                    width: size - 6,
                    height: size - 6,
                    borderRadius: '50%',
                    objectFit: 'contain',
                  }}
                />
              </div>
            </foreignObject>

            {/* Exchange badge (small icon at bottom-right of logo) */}
            <foreignObject
              x={badgeX}
              y={badgeY}
              width={badgeSize}
              height={badgeSize}
              style={{ overflow: 'visible', pointerEvents: 'none' }}
            >
              <div
                style={{
                  width: badgeSize,
                  height: badgeSize,
                  borderRadius: '50%',
                  backgroundColor: 'white',
                  border: `2px solid ${account.exchange === 'binance' ? '#F0B90B' : '#00D395'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 2,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              >
                <img
                  src={`/static/${account.exchange}_logo.svg`}
                  alt={account.exchange}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                  }}
                />
              </div>
            </foreignObject>

            <foreignObject
              x={labelX}
              y={labelY}
              width={120}
              height={24}
              style={{ overflow: 'visible', pointerEvents: 'none' }}
            >
              <div
                className="px-3 py-1 text-xs font-semibold text-white"
                style={{
                  borderRadius: '12px',
                  backgroundColor: color,
                  display: 'inline-block',
                  boxShadow: '0 4px 10px rgba(0,0,0,0.18)',
                }}
              >
                <FlipNumber value={value} prefix="$" decimals={2} className="text-white" />
              </div>
            </foreignObject>
          </g>
        )
      },
    [chartData, logoPulseMap, brushRange]
  )

  if (loading && data.length === 0) {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="text-muted-foreground">Loading Hyperliquid data...</div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="text-destructive">{error}</div>
      </Card>
    )
  }

  if (chartData.length === 0) {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="text-muted-foreground">
          No Hyperliquid snapshot data yet.
        </div>
      </Card>
    )
  }

  return (
    <Card className="h-full">
      <div className="h-full relative">
        {/* Time Range Selector */}
        <div className="absolute top-3 right-3 z-10 flex gap-1 bg-white/90 backdrop-blur-sm rounded-lg p-1 shadow-sm border border-gray-200">
          {[
            { value: '7d' as const, label: '7D' },
            { value: '15d' as const, label: '15D' },
            { value: '1m' as const, label: '1M' },
            { value: '3m' as const, label: '3M' },
            { value: 'all' as const, label: 'ALL' },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => setTimeRange(option.value)}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                timeRange === option.value
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 20, right: 160, left: 20, bottom: 40 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis
              dataKey="datetime_str"
              stroke="#888"
              fontSize={11}
              interval={Math.ceil(chartData.length / 6)}
              tickFormatter={(value) => {
                if (!value) return ''
                // Convert UTC datetime_str to local time
                // datetime_str format: "2025-11-22 05:51:00" (UTC, no timezone suffix)
                const isoString = value.replace(' ', 'T') + 'Z'  // Convert to ISO with UTC marker
                return formatDateTime(isoString, { style: 'short' })
              }}
            />
            <YAxis
              stroke="#888"
              fontSize={11}
              domain={yAxisDomain}
              tickFormatter={(value) => `$${Number(value).toLocaleString()}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(255,255,255,0.95)',
                border: '1px solid #e0e0e0',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
              }}
              labelFormatter={(label) => {
                if (!label) return ''
                // Convert UTC datetime_str to local time
                const isoString = label.replace(' ', 'T') + 'Z'
                return formatDateTime(isoString, { style: 'medium' })
              }}
              formatter={(value: number, name: string) => [
                `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                name
              ]}
            />

            {baseline != null && accountsData.length === 1 && (
              <ReferenceLine y={baseline} stroke="#9CA3AF" strokeDasharray="4 4" />
            )}

            {baseline != null && accountsData.length === 1 && (
              <Area
                type="monotone"
                dataKey={accountsData[0].curveKey}
                stroke="none"
                fill="rgba(34,197,94,0.08)"
                baseValue={baseline}
                isAnimationActive={false}
              />
            )}

            {accountsData.map(account => {
              const color = account.logo?.color || getModelColor(account.username)
              return (
                <Line
                  key={account.key}
                  type="monotone"
                  dataKey={account.curveKey}
                  stroke={color}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 6, fill: color }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              )
            })}

            {/* Terminal dots with logos */}
            {accountsData.map(account => (
              <Line
                key={`terminal-${account.key}`}
                type="monotone"
                dataKey={account.curveKey}
                stroke="transparent"
                strokeWidth={0}
                dot={renderTerminalDot(account)}
                activeDot={false}
                isAnimationActive={false}
              />
            ))}

            {/* Trade markers (B/S/C circles) */}
            {tradeMarkers.length > 0 && (
              <Customized component={renderTradeMarkers} />
            )}

            {/* Brush for zooming/panning */}
            <Brush
              dataKey="datetime_str"
              height={30}
              stroke="#8884d8"
              fill="#f5f5f5"
              onChange={handleBrushChange}
              startIndex={brushRange.startIndex !== undefined ? Math.min(brushRange.startIndex, chartData.length - 1) : undefined}
              endIndex={brushRange.endIndex !== undefined ? Math.min(brushRange.endIndex, chartData.length - 1) : undefined}
              tickFormatter={(value) => {
                if (!value) return ''
                const isoString = value.replace(' ', 'T') + 'Z'
                return formatDateTime(isoString, { style: 'short' })
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>

        {/* Trade marker tooltip */}
        {hoveredTrade && (
          <div
            className="absolute pointer-events-none bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs z-20"
            style={{
              left: hoveredTrade.x + 15,
              top: hoveredTrade.y - 40,
              transform: 'translateX(-50%)'
            }}
          >
            <div className="font-bold text-gray-800">
              {hoveredTrade.side} {hoveredTrade.symbol}
            </div>
            {hoveredTrade.price != null && (
              <div className="text-gray-600">
                ${hoveredTrade.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
