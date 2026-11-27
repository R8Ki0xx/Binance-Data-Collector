import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { createChart, CandlestickSeries, createSeriesMarkers, Time } from 'lightweight-charts'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { X, Send, ChevronDown, ChevronRight, Pause, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatChartTime } from '@/lib/dateTime'
import { TradingAccount, getAccounts } from '@/lib/api'

const API_BASE = '/api/analytics'

// Decision Card Component
function DecisionCard({
  decision,
  isFirst,
  isLast
}: {
  decision: DecisionChainItem
  isFirst: boolean
  isLast: boolean
}) {
  const { t } = useTranslation()

  const getOperationColor = (op: string) => {
    switch (op) {
      case 'buy': return 'bg-green-500'
      case 'sell': return 'bg-red-500'
      case 'close': return 'bg-blue-500'
      case 'hold': return 'bg-gray-400'
      default: return 'bg-gray-400'
    }
  }

  const getOperationLabel = (op: string) => {
    switch (op) {
      case 'buy': return t('attribution.replay.opBuy', 'BUY')
      case 'sell': return t('attribution.replay.opSell', 'SELL')
      case 'close': return t('attribution.replay.opClose', 'CLOSE')
      case 'hold': return t('attribution.replay.opHold', 'HOLD')
      default: return op.toUpperCase()
    }
  }

  return (
    <div className="relative">
      {!isLast && (
        <div className="absolute left-4 top-10 w-0.5 h-full bg-border" />
      )}
      <Card className={`relative ${isFirst || isLast ? 'border-primary' : ''}`}>
        <CardContent className="p-3">
          <div className="flex items-start gap-3">
            <div className={`w-8 h-8 rounded-full ${getOperationColor(decision.operation)} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
              {decision.operation.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-medium">{getOperationLabel(decision.operation)}</span>
                {decision.realized_pnl !== null && (
                  <span className={`text-sm font-medium ${decision.realized_pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    ${decision.realized_pnl.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {decision.decision_time ? new Date(decision.decision_time + 'Z').toLocaleString() : '-'}
              </div>
              {decision.reason && (
                <div className="text-xs text-muted-foreground mt-2 line-clamp-3">
                  {decision.reason}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Hold Group Card Component - displays collapsed HOLD decisions
function HoldGroupCard({
  holds,
  isLast
}: {
  holds: DecisionChainItem[]
  isLast: boolean
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  if (holds.length === 0) return null

  const firstTime = holds[0].decision_time
  const lastTime = holds[holds.length - 1].decision_time
  const formatTime = (time: string | null) => {
    if (!time) return '-'
    return new Date(time + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="relative">
      {!isLast && (
        <div className="absolute left-4 top-10 w-0.5 h-full bg-border" />
      )}
      <Card className="relative cursor-pointer hover:bg-muted/50" onClick={() => setExpanded(!expanded)}>
        <CardContent className="p-3">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-gray-400 flex items-center justify-center text-white flex-shrink-0">
              <Pause className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-muted-foreground">
                    HOLD x{holds.length}
                  </span>
                  {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </div>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {formatTime(firstTime)} - {formatTime(lastTime)}
              </div>
            </div>
          </div>
          {expanded && (
            <div className="mt-3 pl-11 space-y-2 border-t pt-3">
              {holds.map((hold) => (
                <div key={hold.id} className="text-xs">
                  <div className="text-muted-foreground">
                    {hold.decision_time ? new Date(hold.decision_time + 'Z').toLocaleString() : '-'}
                  </div>
                  {hold.reason && (
                    <div className="text-muted-foreground/80 mt-1 line-clamp-2">
                      {hold.reason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

interface DecisionChainItem {
  id: number
  operation: string
  decision_time: string | null
  reason: string
  target_portion: number
  realized_pnl: number | null
}

interface TradeReplayData {
  trade: {
    id: number
    symbol: string
    operation: string
    decision_time: string | null
    wallet_address: string
    hyperliquid_environment: string
    account_id: number
  }
  entry_decision: {
    id: number
    operation: string
    decision_time: string | null
    reason: string
  } | null
  exit_decision: {
    id: number
    operation: string
    decision_time: string | null
    reason: string
    exit_type: string
  } | null
  decisions_chain: DecisionChainItem[]
  summary: {
    entry_time: string | null
    exit_time: string | null
    hold_duration: string | null
    pnl: number
  }
  kline_params: {
    symbol: string
    start_time: string | null
    end_time: string | null
  } | null
}

// Marker data from API
interface KlineMarker {
  type: 'entry' | 'exit' | 'hold'
  time: string | null
  timestamp: number | null
  operation: string
  reason: string
  target_portion?: number | null
  exit_type?: string
  realized_pnl?: number | null
  symbol: string
  entry_price?: number | null
  tp_price?: number | null
  sl_price?: number | null
  exit_price?: number | null
}

// Format price for display (e.g., 89656 -> "89656" or "89.6K" for large numbers)
function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined) return '-'
  if (price >= 10000) return price.toFixed(0)
  if (price >= 100) return price.toFixed(1)
  return price.toFixed(2)
}

// Replay K-line Chart Component
function ReplayKlineChart({ tradeId, period }: { tradeId: number; period: string }) {
  const { t } = useTranslation()
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)
  const markerMapRef = useRef<Map<number, KlineMarker>>(new Map())

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ visible: boolean; x: number; y: number; marker: KlineMarker | null }>({
    visible: false, x: 0, y: 0, marker: null
  })

  useEffect(() => {
    if (!tradeId) return

    const timeoutId = setTimeout(() => {
      if (!chartContainerRef.current) {
        setError('Chart container not ready')
        setLoading(false)
        return
      }
      loadChart()
    }, 100)

    async function loadChart() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/analytics/trades/${tradeId}/kline?period=${period}`)
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}))
          throw new Error(errData.detail || 'Failed to fetch kline data')
        }
        const result = await response.json()

        if (!result.klines || result.klines.length === 0) {
          setError('No K-line data available for this time range')
          setLoading(false)
          return
        }

        // Build marker map for tooltip lookup (use formatChartTime for consistency)
        markerMapRef.current.clear()
        const periodMs: Record<string, number> = { '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 }
        const bucketSize = periodMs[period] || 300

        for (const marker of result.markers || []) {
          if (marker.timestamp) {
            // Align to bucket, then convert to local time (same as kline data)
            const bucketTime = Math.floor(marker.timestamp / bucketSize) * bucketSize
            const localBucketTime = formatChartTime(bucketTime)
            markerMapRef.current.set(localBucketTime, marker)
          }
        }

        // Create chart
        if (chartRef.current) {
          chartRef.current.remove()
        }

        if (!chartContainerRef.current) return

        const chart = createChart(chartContainerRef.current, {
          layout: { background: { color: 'transparent' }, textColor: '#9ca3af' },
          grid: {
            vertLines: { color: 'rgba(156, 163, 175, 0.1)' },
            horzLines: { color: 'rgba(156, 163, 175, 0.1)' },
          },
          crosshair: { mode: 1 },
          rightPriceScale: { borderColor: 'rgba(156, 163, 175, 0.2)' },
          timeScale: { borderColor: 'rgba(156, 163, 175, 0.2)', timeVisible: true, secondsVisible: false },
        })
        chartRef.current = chart

        const candlestickSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#22c55e', downColor: '#ef4444',
          borderUpColor: '#22c55e', borderDownColor: '#ef4444',
          wickUpColor: '#22c55e', wickDownColor: '#ef4444',
        })

        const chartData = result.klines.map((item: { timestamp: number; open: number; high: number; low: number; close: number }) => ({
          time: formatChartTime(item.timestamp) as Time,
          open: item.open, high: item.high, low: item.low, close: item.close,
        }))
        candlestickSeries.setData(chartData)

        // Add markers (use formatChartTime for consistency with kline data)
        const chartMarkers: { time: Time; position: 'aboveBar' | 'belowBar'; color: string; shape: 'arrowUp' | 'arrowDown' | 'circle'; text: string; size: number }[] = []
        for (const marker of result.markers || []) {
          if (marker.timestamp) {
            const bucketTime = Math.floor(marker.timestamp / bucketSize) * bucketSize
            const localBucketTime = formatChartTime(bucketTime)
            // Build marker text with price
            let markerText = ''
            let markerColor = '#9ca3af'
            let markerShape: 'arrowUp' | 'arrowDown' | 'circle' = 'circle'
            let markerPosition: 'aboveBar' | 'belowBar' = 'aboveBar'
            let markerSize = 2

            if (marker.type === 'entry') {
              const opText = marker.operation === 'buy' ? 'BUY' : 'SELL'
              const priceText = marker.entry_price ? `@${formatPrice(marker.entry_price)}` : ''
              markerText = `${opText}${priceText}`
              markerColor = marker.operation === 'buy' ? '#22c55e' : '#ef4444'
              markerShape = marker.operation === 'buy' ? 'arrowUp' : 'arrowDown'
              markerPosition = marker.operation === 'buy' ? 'belowBar' : 'aboveBar'
            } else if (marker.type === 'exit') {
              const priceText = marker.exit_price ? `@${formatPrice(marker.exit_price)}` : ''
              markerText = `CLOSE${priceText}`
              markerColor = '#3b82f6'
              markerShape = 'arrowDown'
              markerPosition = 'aboveBar'
            } else if (marker.type === 'hold') {
              // HOLD markers: small gray circle, no text to avoid clutter
              markerText = ''
              markerColor = '#9ca3af'
              markerShape = 'circle'
              markerPosition = 'aboveBar'
              markerSize = 1
            }

            chartMarkers.push({
              time: localBucketTime as Time,
              position: markerPosition,
              color: markerColor,
              shape: markerShape,
              text: markerText,
              size: markerSize,
            })
          }
        }
        if (chartMarkers.length > 0) {
          createSeriesMarkers(candlestickSeries, chartMarkers)
        }

        // Subscribe to crosshair for tooltip
        chart.subscribeCrosshairMove(param => {
          if (!param.time || !param.point) {
            setTooltip(prev => ({ ...prev, visible: false }))
            return
          }
          const chartTime = param.time as number
          const matchedMarker = markerMapRef.current.get(chartTime) || null
          if (matchedMarker) {
            setTooltip({ visible: true, x: param.point.x, y: param.point.y, marker: matchedMarker })
          } else {
            setTooltip(prev => ({ ...prev, visible: false }))
          }
        })

        chart.timeScale().fitContent()

        const handleResize = () => {
          if (chartContainerRef.current && chartRef.current) {
            chartRef.current.applyOptions({
              width: chartContainerRef.current.clientWidth,
              height: chartContainerRef.current.clientHeight,
            })
          }
        }
        window.addEventListener('resize', handleResize)
        handleResize()

        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load chart')
        setLoading(false)
      }
    }

    return () => {
      clearTimeout(timeoutId)
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }
    }
  }, [tradeId, period])

  const renderTooltip = () => {
    if (!tooltip.marker) return null
    const m = tooltip.marker
    const isEntry = m.type === 'entry'
    const isHold = m.type === 'hold'

    // Get title based on type
    const getTitle = () => {
      if (isEntry) return t('attribution.replay.tooltipEntry', 'Entry Decision')
      if (isHold) return t('attribution.replay.tooltipHold', 'Hold Decision')
      return t('attribution.replay.tooltipExit', 'Exit Decision')
    }

    return (
      <div className="text-xs space-y-1">
        <div className="font-medium text-white border-b border-gray-600 pb-1 mb-1">
          {getTitle()}
        </div>
        <div><span className="text-gray-400">{t('attribution.replay.tooltipTime', 'Time')}:</span> <span className="text-white">{m.time ? new Date(m.time + 'Z').toLocaleString() : '-'}</span></div>
        <div><span className="text-gray-400">{t('attribution.replay.tooltipOp', 'Operation')}:</span> <span className={`font-medium ${m.operation === 'buy' ? 'text-green-400' : m.operation === 'sell' ? 'text-red-400' : m.operation === 'hold' ? 'text-gray-400' : 'text-blue-400'}`}>{m.operation.toUpperCase()}</span></div>
        {isEntry && m.entry_price && (
          <div><span className="text-gray-400">{t('attribution.replay.tooltipPrice', 'Price')}:</span> <span className="text-white">{formatPrice(m.entry_price)}</span></div>
        )}
        {isEntry && m.tp_price && (
          <div><span className="text-gray-400">TP:</span> <span className="text-green-400">{formatPrice(m.tp_price)}</span></div>
        )}
        {isEntry && m.sl_price && (
          <div><span className="text-gray-400">SL:</span> <span className="text-red-400">{formatPrice(m.sl_price)}</span></div>
        )}
        {isEntry && m.target_portion !== null && m.target_portion !== undefined && (
          <div><span className="text-gray-400">{t('attribution.replay.tooltipPortion', 'Target')}:</span> <span className="text-white">{(m.target_portion * 100).toFixed(0)}%</span></div>
        )}
        {m.type === 'exit' && m.exit_price && (
          <div><span className="text-gray-400">{t('attribution.replay.tooltipPrice', 'Price')}:</span> <span className="text-white">{formatPrice(m.exit_price)}</span></div>
        )}
        {m.type === 'exit' && m.exit_type && (
          <div><span className="text-gray-400">{t('attribution.replay.tooltipExitType', 'Exit Type')}:</span> <span className="text-white">{m.exit_type}</span></div>
        )}
        {m.type === 'exit' && m.realized_pnl !== null && m.realized_pnl !== undefined && (
          <div><span className="text-gray-400">{t('attribution.replay.tooltipPnl', 'PnL')}:</span> <span className={m.realized_pnl >= 0 ? 'text-green-400' : 'text-red-400'}>${m.realized_pnl.toFixed(2)}</span></div>
        )}
        {m.reason && (
          <div className="pt-1 border-t border-gray-600 mt-1">
            <div className="text-gray-400 mb-0.5">{t('attribution.replay.tooltipReason', 'Reason')}:</div>
            <div className="text-white text-[10px] leading-tight max-w-[200px] line-clamp-4">{m.reason}</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-full w-full flex flex-col">
      {/* Chart container */}
      <div className="flex-1 relative [&_.tv-lightweight-charts]:!overflow-hidden [&_a[href*='tradingview']]:!hidden">
        <div ref={chartContainerRef} className="h-full w-full" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80">
            <span className="text-muted-foreground">Loading chart...</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80">
            <span className="text-red-500">{error}</span>
          </div>
        )}
        {tooltip.visible && tooltip.marker && (
          <div
            className="absolute z-50 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 shadow-lg pointer-events-none"
            style={{
              left: Math.min(tooltip.x + 15, (chartContainerRef.current?.clientWidth || 400) - 220),
              top: Math.max(tooltip.y - 80, 10),
            }}
          >
            {renderTooltip()}
          </div>
        )}
      </div>
    </div>
  )
}

// Replay AI Chat Component
interface AnalysisEntry {
  type: 'reasoning' | 'tool_call' | 'tool_result'
  content?: string
  name?: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
  statusText?: string
  analysisLog?: AnalysisEntry[]
}

interface ReplayAiChatProps {
  tradeData: TradeReplayData
  selectedAccountId: number | null
}

function ReplayAiChat({ tradeData, selectedAccountId }: ReplayAiChatProps) {
  const { t } = useTranslation()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || loading || !selectedAccountId) return

    const userMessage = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])
    setLoading(true)

    try {
      // Build context about the trade with explicit account and environment info
      const tradeContext = `[IMPORTANT: This is a specific trade analysis. DO NOT ask for environment or account - they are already known.]
[OUTPUT FORMAT: Please provide analysis in plain text only. Do NOT output JSON formatted diagnosis results or suggestions. Keep the response concise and readable.]

Trade #${tradeData.trade.id} ${tradeData.trade.symbol}:
- Account ID: ${tradeData.trade.account_id}
- Environment: ${tradeData.trade.hyperliquid_environment || 'mainnet'}
- Wallet: ${tradeData.trade.wallet_address}
- Entry: ${tradeData.entry_decision?.operation.toUpperCase()} at ${tradeData.summary.entry_time ? new Date(tradeData.summary.entry_time + 'Z').toLocaleString() : 'N/A'}
- Exit: ${tradeData.exit_decision?.exit_type || 'N/A'} at ${tradeData.summary.exit_time ? new Date(tradeData.summary.exit_time + 'Z').toLocaleString() : 'N/A'}
- Duration: ${tradeData.summary.hold_duration || 'N/A'}
- PnL: $${tradeData.summary.pnl.toFixed(2)}
- Entry Reason: ${tradeData.entry_decision?.reason || 'N/A'}
- Exit Reason: ${tradeData.exit_decision?.reason || 'N/A'}`

      const response = await fetch('/api/analytics/ai-attribution/chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccountId,
          userMessage: `[Trade Context]\n${tradeContext}\n\n[User Question]\n${userMessage}`,
          conversationId: null,
        }),
      })

      if (!response.ok) throw new Error('Failed to send message')

      // Add streaming assistant message
      setMessages(prev => [...prev, { role: 'assistant', content: '', isStreaming: true, analysisLog: [] }])

      let finalContent = ''

      // Check if response is JSON (background task mode) or SSE stream
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        // Background task mode: poll for results
        const taskData = await response.json()
        const taskId = taskData.task_id

        const { pollAiStream } = await import('@/lib/pollAiStream')
        await pollAiStream(taskId, {
          onChunk: (chunk) => {
            const eventType = chunk.event_type
            const data = chunk.data

            if (eventType === 'reasoning') {
              const entry: AnalysisEntry = { type: 'reasoning', content: data.content }
              setMessages(prev => prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, statusText: 'Thinking...', analysisLog: [...(m.analysisLog || []), entry] } : m
              ))
            } else if (eventType === 'tool_call') {
              const entry: AnalysisEntry = { type: 'tool_call', name: data.name }
              setMessages(prev => prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, statusText: `Calling ${data.name}...`, analysisLog: [...(m.analysisLog || []), entry] } : m
              ))
            } else if (eventType === 'tool_result') {
              const entry: AnalysisEntry = { type: 'tool_result', name: data.name }
              setMessages(prev => prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, statusText: `Got result from ${data.name}`, analysisLog: [...(m.analysisLog || []), entry] } : m
              ))
            } else if (eventType === 'content' || eventType === 'done') {
              finalContent = data.content || ''
              setMessages(prev => prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, content: finalContent, statusText: undefined } : m
              ))
            }
          },
          onTaskLost: () => {
            setMessages(prev => prev.map((m, i) =>
              i === prev.length - 1 ? { ...m, content: 'Connection lost. Please try again.', isStreaming: false } : m
            ))
          },
        })

        // Mark streaming complete
        setMessages(prev => prev.map((m, i) =>
          i === prev.length - 1 ? { ...m, content: finalContent, isStreaming: false, statusText: undefined } : m
        ))
      } else {
        // SSE stream mode (legacy fallback)
        if (!response.body) throw new Error('No response body')

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let currentEventType = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEventType = line.slice(7).trim()
              continue
            }
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))

                if (currentEventType === 'reasoning') {
                  const entry: AnalysisEntry = { type: 'reasoning', content: data.content }
                  setMessages(prev => prev.map((m, i) =>
                    i === prev.length - 1 ? { ...m, statusText: 'Thinking...', analysisLog: [...(m.analysisLog || []), entry] } : m
                  ))
                } else if (currentEventType === 'tool_call') {
                  const entry: AnalysisEntry = { type: 'tool_call', name: data.name }
                  setMessages(prev => prev.map((m, i) =>
                    i === prev.length - 1 ? { ...m, statusText: `Calling ${data.name}...`, analysisLog: [...(m.analysisLog || []), entry] } : m
                  ))
                } else if (currentEventType === 'tool_result') {
                  const entry: AnalysisEntry = { type: 'tool_result', name: data.name }
                  setMessages(prev => prev.map((m, i) =>
                    i === prev.length - 1 ? { ...m, statusText: `Got result from ${data.name}`, analysisLog: [...(m.analysisLog || []), entry] } : m
                  ))
                } else if (currentEventType === 'content' || data.content) {
                  setMessages(prev => prev.map((m, i) =>
                    i === prev.length - 1 ? { ...m, content: data.content, statusText: undefined } : m
                  ))
                }

                currentEventType = ''
              } catch {
                // Ignore parse errors
              }
            }
          }
        }

        // Mark streaming complete
        setMessages(prev => prev.map((m, i) =>
          i === prev.length - 1 ? { ...m, isStreaming: false, statusText: undefined } : m
        ))
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}` }])
    } finally {
      setLoading(false)
    }
  }

  const suggestedQuestions = [
    t('attribution.replay.suggestWhy', 'Why did this trade lose/win?'),
    t('attribution.replay.suggestImprove', 'How could I improve?'),
  ]

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground mb-3">
                {t('attribution.replay.askAboutTrade', 'Ask questions about this trade:')}
              </p>
              {suggestedQuestions.map((q, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-left h-auto py-2 px-3"
                  onClick={() => setInput(q)}
                >
                  {q}
                </Button>
              ))}
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg p-3 ${
                  msg.role === 'user' ? 'bg-primary text-white' : 'bg-muted'
                }`}>
                  <div className={`text-xs font-semibold mb-1 ${msg.role === 'user' ? 'text-white/70' : 'opacity-70'}`}>
                    {msg.role === 'user' ? t('attribution.aiAnalysis.you', 'You') : t('attribution.aiAnalysis.aiAssistant', 'AI Assistant')}
                    {msg.isStreaming && msg.statusText && (
                      <span className="ml-2 text-primary animate-pulse">({msg.statusText})</span>
                    )}
                  </div>
                  {msg.analysisLog && msg.analysisLog.length > 0 && (
                    <details className="mb-2" open={msg.isStreaming}>
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                        {t('attribution.aiAnalysis.analysisProcess', 'Analysis Process')} ({msg.analysisLog.length} {t('attribution.aiAnalysis.steps', 'steps')})
                      </summary>
                      <div className="mt-1 text-xs bg-background/50 rounded p-2 max-h-32 overflow-y-auto">
                        {(msg.isStreaming ? msg.analysisLog.slice(-5) : msg.analysisLog).map((entry, idx) => (
                          <div key={idx} className="mb-1 last:mb-0">
                            {entry.type === 'tool_call' && <span className="text-blue-500">→ {entry.name}</span>}
                            {entry.type === 'tool_result' && <span className="text-green-500">← {entry.name}: done</span>}
                            {entry.type === 'reasoning' && <span className="text-gray-500 italic">{(entry.content || '').slice(0, 100)}...</span>}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  <div className={`text-sm prose prose-sm max-w-none ${
                    msg.role === 'user' ? 'prose-invert text-white' : 'dark:prose-invert'
                  } [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:bg-muted [&_td]:border [&_td]:border-border [&_td]:p-2`}>
                    {msg.content ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{msg.content}</ReactMarkdown>
                    ) : msg.isStreaming ? (
                      <span className="text-muted-foreground italic">{t('attribution.aiAnalysis.analyzing', 'Analyzing...')}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>
      <div className="px-3 pb-3 pt-2 flex-shrink-0">
        <div className="flex gap-2 items-center">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && sendMessage()}
            placeholder={t('attribution.replay.typeQuestion', 'Type a question...')}
            disabled={loading || !selectedAccountId}
            className="text-sm rounded-xl"
          />
          <Button size="icon" onClick={sendMessage} disabled={loading || !input.trim() || !selectedAccountId} className="rounded-full h-8 w-8 shrink-0">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface TradeReplayModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tradeId: number | null
}

export default function TradeReplayModal({
  open,
  onOpenChange,
  tradeId,
}: TradeReplayModalProps) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<TradeReplayData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<string>('5m')
  const [accounts, setAccounts] = useState<TradingAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)

  const periods = ['5m', '15m', '1h', '4h']

  // Load AI accounts
  useEffect(() => {
    if (open) {
      getAccounts().then(accs => {
        const aiAccounts = accs.filter(a => a.account_type === 'AI')
        setAccounts(aiAccounts)
        if (aiAccounts.length > 0 && !selectedAccountId) {
          setSelectedAccountId(aiAccounts[0].id)
        }
      }).catch(console.error)
    }
  }, [open])

  useEffect(() => {
    if (open && tradeId) {
      loadReplayData(tradeId)
    }
  }, [open, tradeId])

  const loadReplayData = async (id: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/trades/${id}/replay`)
      if (!res.ok) throw new Error('Failed to load replay data')
      const result = await res.json()
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[1600px] w-[95vw] h-[90vh] flex flex-col p-0 [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl">
              {t('attribution.replay.title', 'Trade Replay')} #{tradeId} {data?.trade.symbol}
            </DialogTitle>
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-muted-foreground">Loading...</div>
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-red-500">{error}</div>
          </div>
        ) : data ? (
          <>
            <div className="flex-1 flex overflow-hidden">
              {/* Left Column - Decision Chain */}
              <div className="w-72 border-r flex flex-col">
                <div className="px-4 py-3 border-b font-medium bg-muted/30">
                  {t('attribution.replay.decisionChain', 'Decision Chain')}
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-3">
                    {(() => {
                      // Group consecutive HOLD decisions
                      const groups: Array<{ type: 'single' | 'hold_group'; items: DecisionChainItem[] }> = []
                      let currentHolds: DecisionChainItem[] = []

                      data.decisions_chain.forEach((decision) => {
                        if (decision.operation === 'hold') {
                          currentHolds.push(decision)
                        } else {
                          if (currentHolds.length > 0) {
                            groups.push({ type: 'hold_group', items: currentHolds })
                            currentHolds = []
                          }
                          groups.push({ type: 'single', items: [decision] })
                        }
                      })
                      if (currentHolds.length > 0) {
                        groups.push({ type: 'hold_group', items: currentHolds })
                      }

                      return groups.map((group, groupIndex) => {
                        const isLastGroup = groupIndex === groups.length - 1
                        if (group.type === 'hold_group') {
                          return (
                            <HoldGroupCard
                              key={`hold-group-${group.items[0].id}`}
                              holds={group.items}
                              isLast={isLastGroup}
                            />
                          )
                        } else {
                          const decision = group.items[0]
                          const isFirst = groupIndex === 0
                          return (
                            <DecisionCard
                              key={decision.id}
                              decision={decision}
                              isFirst={isFirst}
                              isLast={isLastGroup}
                            />
                          )
                        }
                      })
                    })()}
                  </div>
                </ScrollArea>
              </div>

              {/* Center Column - K-line Chart */}
              <div className="flex-1 flex flex-col">
                <div className="px-4 py-2 border-b font-medium bg-muted/30 flex items-center justify-between">
                  <span>{t('attribution.replay.priceChart', 'Price Chart')}</span>
                  <div className="flex gap-1">
                    {periods.map(p => (
                      <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        className={`px-2 py-1 text-xs rounded ${period === p ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1">
                  <ReplayKlineChart tradeId={data.trade.id} period={period} />
                </div>
              </div>

              {/* Right Column - AI Chat */}
              <div className="flex-1 border-l flex flex-col min-w-0 overflow-hidden">
                <div className="px-4 py-2 border-b font-medium bg-muted/30 flex items-center justify-between flex-shrink-0">
                  <span>{t('attribution.replay.aiAnalysis', 'AI Analysis')}</span>
                  <Select
                    value={selectedAccountId?.toString() || ''}
                    onValueChange={(v) => setSelectedAccountId(Number(v))}
                  >
                    <SelectTrigger className="w-48 h-7 text-xs">
                      <SelectValue placeholder={t('attribution.aiAnalysis.selectAiTrader', 'Select AI')} />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((acc) => (
                        <SelectItem key={acc.id} value={acc.id.toString()}>
                          {acc.name} ({acc.model})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 overflow-hidden">
                  <ReplayAiChat tradeData={data} selectedAccountId={selectedAccountId} />
                </div>
              </div>
            </div>

            {/* Bottom Summary */}
            <div className="border-t px-6 py-4 flex-shrink-0 bg-muted/30">
              <div className="flex items-center justify-between text-sm">
                <div className="flex gap-6">
                  <div>
                    <span className="text-muted-foreground">{t('attribution.replay.entryTime', 'Entry')}:</span>{' '}
                    <span className="font-medium">{data.summary.entry_time ? new Date(data.summary.entry_time + 'Z').toLocaleString() : '-'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('attribution.replay.exitTime', 'Exit')}:</span>{' '}
                    <span className="font-medium">{data.summary.exit_time ? new Date(data.summary.exit_time + 'Z').toLocaleString() : '-'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{t('attribution.replay.holdDuration', 'Duration')}:</span>{' '}
                    <span className="font-medium">{data.summary.hold_duration || '-'}</span>
                  </div>
                </div>
                <div className="flex gap-6">
                  <div>
                    <span className="text-muted-foreground">{t('attribution.pnl', 'PnL')}:</span>{' '}
                    <span className={`font-bold ${data.summary.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      ${data.summary.pnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
