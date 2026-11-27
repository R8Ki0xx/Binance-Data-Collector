import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Loader2, Calculator, List, ChevronDown, ChevronRight, History, X, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { toast } from 'react-hot-toast'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Brush,
} from 'recharts'
import { useCollectionDays } from '@/lib/useCollectionDays'

interface WalletInfo {
  environment: string
  address: string
}

interface Binding {
  id: number
  account_id: number
  account_name: string
  program_id: number
  program_name: string
  signal_pool_ids: number[]
  signal_pool_names: string[]
  trigger_interval: number
  scheduled_trigger_enabled: boolean
  is_active: boolean
  wallets: WalletInfo[]
  exchange?: string
}

interface BacktestModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  binding: Binding
}

type BacktestStatus = 'idle' | 'calculating' | 'running' | 'complete' | 'error'

interface EquityPoint {
  timestamp: number
  equity: number
  trigger_type?: string  // "signal", "scheduled", "tp", "sl"
}

interface BacktestResult {
  backtest_id?: number
  success: boolean
  total_pnl: number
  total_pnl_percent: number
  max_drawdown: number
  max_drawdown_percent: number
  sharpe_ratio: number
  total_trades: number
  winning_trades: number
  losing_trades: number
  win_rate: number
  profit_factor: number
  execution_time_ms: number
  equity_curve: EquityPoint[]
  trades: Array<any>
}

interface TriggerLog {
  id: number
  trigger_index: number
  trigger_type: string
  trigger_time: string
  symbol: string
  decision_action: string
  decision_symbol: string
  decision_side: string | null
  decision_size: number | null
  decision_reason: string
  entry_price: number
  exit_price: number | null
  pnl: number
  fee: number | null
  unrealized_pnl: number | null
  realized_pnl: number | null
  equity_before: number
  equity_after: number
  execution_error: string | null
}

interface TriggerDetail extends TriggerLog {
  decision_input: any
  decision_output: any
  data_queries: Array<string | { method: string; args: any; result: any }> | null
  execution_logs: string[] | null
}

interface BacktestHistoryItem {
  id: number
  config: any
  start_time: string
  end_time: string
  initial_balance: number
  final_equity: number
  total_pnl: number
  total_pnl_percent: number
  max_drawdown_percent: number
  total_triggers: number
  total_trades: number
  win_rate: number
  status: string
  created_at: string
  exchange?: string  // "hyperliquid" or "binance", null for historical data
}

export function BacktestModal({ open, onOpenChange, binding }: BacktestModalProps) {
  const { t } = useTranslation()
  const collectionDays = useCollectionDays()

  const getLocalDateString = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const getLocalTimeString = (date: Date) => {
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${hours}:${minutes}`
  }

  const getClampedEndDateTime = (dateValue: string, timeValue: string) => {
    const candidate = new Date(`${dateValue}T${timeValue}:59`)
    const now = new Date()
    const clamped = candidate.getTime() > now.getTime() ? now : candidate

    return {
      date: getLocalDateString(clamped),
      time: getLocalTimeString(clamped),
      wasClamped: clamped.getTime() !== candidate.getTime(),
      timeMs: clamped.getTime(),
    }
  }

  // History state
  const [historyList, setHistoryList] = useState<BacktestHistoryItem[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Config state
  const [startDate, setStartDate] = useState('')
  const [startTime, setStartTime] = useState('00:00')
  const [endDate, setEndDate] = useState('')
  const [endTime, setEndTime] = useState('')
  const [initialBalance, setInitialBalance] = useState('10000')
  const todayDate = getLocalDateString(new Date())

  // Execution state
  const [status, setStatus] = useState<BacktestStatus>('idle')
  const [progress, setProgress] = useState(0)
  const [totalTriggers, setTotalTriggers] = useState(0)
  const [currentTrigger, setCurrentTrigger] = useState(0)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [backtestId, setBacktestId] = useState<number | null>(null)

  // Real-time equity curve data
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([])

  // Chart markers (loaded separately from triggers for complete display)
  const [chartMarkers, setChartMarkers] = useState<Array<{ index: number; action: string; trigger_type: string }>>([])

  // Trigger details state
  const [showDetails, setShowDetails] = useState(false)
  const [triggerLogs, setTriggerLogs] = useState<TriggerLog[]>([])
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [detailsOffset, setDetailsOffset] = useState(0)
  const [detailsTotal, setDetailsTotal] = useState(0)

  // Selected trigger for side panel
  const [selectedTrigger, setSelectedTrigger] = useState<TriggerDetail | null>(null)
  const [loadingTriggerDetail, setLoadingTriggerDetail] = useState(false)

  // Loading historical backtest
  const [loadingHistorical, setLoadingHistorical] = useState(false)

  // Current backtest exchange (for display)
  const [currentExchange, setCurrentExchange] = useState<string>('hyperliquid')

  // SSE ref
  const eventSourceRef = useRef<EventSource | null>(null)

  // Initialize dates (default: last 30 days)
  useEffect(() => {
    if (open) {
      const end = new Date()
      const start = new Date()
      start.setDate(start.getDate() - 30)
      setStartDate(getLocalDateString(start))
      setStartTime('00:00')
      setEndDate(getLocalDateString(end))
      setEndTime(getLocalTimeString(end))
      setStatus('idle')
      setProgress(0)
      setResult(null)
      setErrorMessage('')
      setBacktestId(null)
      setEquityCurve([])
      setChartMarkers([])
      setShowDetails(false)
      setTriggerLogs([])
      setSelectedTrigger(null)
      // Load history when modal opens
      loadHistory()
    }
  }, [open])

  // Load backtest history
  const loadHistory = async () => {
    setLoadingHistory(true)
    try {
      const res = await fetch(`/api/programs/backtest/history?binding_id=${binding.id}&limit=30`)
      if (res.ok) {
        const data = await res.json()
        setHistoryList(data.results)
      }
    } catch (e) {
      console.error('Failed to load history:', e)
    } finally {
      setLoadingHistory(false)
    }
  }

  // Helper: Convert UTC ISO string to local date and time
  const utcToLocalDateTime = (utcIsoString: string): { date: string; time: string } => {
    // Append 'Z' if not present to ensure UTC parsing
    const utcStr = utcIsoString.endsWith('Z') ? utcIsoString : utcIsoString + 'Z'
    const localDate = new Date(utcStr)
    const year = localDate.getFullYear()
    const month = String(localDate.getMonth() + 1).padStart(2, '0')
    const day = String(localDate.getDate()).padStart(2, '0')
    const hours = String(localDate.getHours()).padStart(2, '0')
    const minutes = String(localDate.getMinutes()).padStart(2, '0')
    return {
      date: `${year}-${month}-${day}`,
      time: `${hours}:${minutes}`
    }
  }

  // Load a specific historical backtest
  const loadHistoricalBacktest = async (historyItem: BacktestHistoryItem) => {
    setLoadingHistorical(true)
    setBacktestId(historyItem.id)
    setShowDetails(false)
    setTriggerLogs([])
    setSelectedTrigger(null)
    setCurrentExchange(historyItem.exchange || 'hyperliquid')

    // Fill date/time selectors from history (convert UTC to local)
    if (historyItem.start_time) {
      const { date, time } = utcToLocalDateTime(historyItem.start_time)
      setStartDate(date)
      setStartTime(time)
    }
    if (historyItem.end_time) {
      const { date, time } = utcToLocalDateTime(historyItem.end_time)
      setEndDate(date)
      setEndTime(time)
    }

    try {
      const res = await fetch(`/api/programs/backtest/${historyItem.id}`)
      if (res.ok) {
        const data = await res.json()
        setResult({
          backtest_id: data.id,
          success: data.status === 'completed',
          total_pnl: data.total_pnl,
          total_pnl_percent: data.total_pnl_percent,
          max_drawdown: data.max_drawdown,
          max_drawdown_percent: data.max_drawdown_percent,
          sharpe_ratio: data.sharpe_ratio,
          total_trades: data.total_trades,
          winning_trades: data.winning_trades,
          losing_trades: data.losing_trades,
          win_rate: data.win_rate,
          profit_factor: data.profit_factor,
          execution_time_ms: data.execution_time_ms,
          equity_curve: data.equity_curve || [],
          trades: [],
        })
        setEquityCurve(data.equity_curve || [])
        setInitialBalance(String(data.initial_balance || 10000))
        setStatus('complete')

        // Load chart markers (all non-HOLD triggers for complete chart display)
        const markersRes = await fetch(`/api/programs/backtest/${historyItem.id}/markers`)
        if (markersRes.ok) {
          const markersData = await markersRes.json()
          setChartMarkers(markersData.markers || [])
        }

        // Auto load trigger details
        await loadTriggerDetailsForBacktest(historyItem.id)
      }
    } catch (e) {
      console.error('Failed to load historical backtest:', e)
    } finally {
      setLoadingHistorical(false)
    }
  }

  // Load trigger details for a specific backtest ID
  const loadTriggerDetailsForBacktest = async (btId: number) => {
    setLoadingDetails(true)
    try {
      const res = await fetch(`/api/programs/backtest/${btId}/triggers?offset=0&limit=100`)
      if (res.ok) {
        const data = await res.json()
        setTriggerLogs(data.triggers)
        setDetailsTotal(data.total)
        setDetailsOffset(0)
        setShowDetails(true)
      }
    } catch (e) {
      console.error('Failed to load trigger details:', e)
    } finally {
      setLoadingDetails(false)
    }
  }

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  const handleClose = () => {
    if (status === 'running') {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
    onOpenChange(false)
  }

  const startBacktest = async () => {
    if (!startDate || !endDate) {
      toast.error(t('programTrader.backtestDateRequired', 'Please select date range'))
      return
    }

    setStatus('calculating')
    setProgress(0)
    setResult(null)
    setErrorMessage('')
    setBacktestId(null)
    setEquityCurve([])
    setShowDetails(false)
    setTriggerLogs([])
    setCurrentExchange(binding.exchange || 'hyperliquid')

    try {
      // Convert user's local date+time selection to UTC milliseconds
      const startLocal = new Date(`${startDate}T${startTime}:00`)
      const startTimeMs = startLocal.getTime()

      // Clamp end time to now (no future backtesting)
      const { date: clampedDate, time: clampedTime, wasClamped, timeMs: endTimeMs } = getClampedEndDateTime(endDate, endTime)
      if (wasClamped) {
        setEndDate(clampedDate)
        setEndTime(clampedTime)
        toast(t('programTrader.endTimeClamped', 'End time clamped to current time (future backtesting not supported)'), { icon: '⏱️' })
      }

      const response = await fetch('/api/programs/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          binding_id: binding.id,
          start_time_ms: startTimeMs,
          end_time_ms: endTimeMs,
          initial_balance: parseFloat(initialBalance) || 10000,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to start backtest')
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) {
        throw new Error('No response body')
      }

      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              handleSSEMessage(data)
            } catch (e) {
              console.error('Failed to parse SSE data:', e)
            }
          }
        }
      }
    } catch (error) {
      console.error('Backtest error:', error)
      setStatus('error')
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error')
    }
  }

  const handleSSEMessage = (data: any) => {
    switch (data.type) {
      case 'calculating':
        setStatus('calculating')
        break

      case 'init':
        setTotalTriggers(data.total_triggers)
        if (data.backtest_id) {
          setBacktestId(data.backtest_id)
        }
        // Initialize with starting point
        setEquityCurve([{ timestamp: Date.now(), equity: parseFloat(initialBalance) || 10000 }])
        setStatus('running')
        break

      case 'progress':
        setCurrentTrigger(data.current)
        setProgress((data.current / data.total) * 100)
        // Accumulate equity points for real-time curve
        setEquityCurve(prev => [...prev, { timestamp: Date.now(), equity: data.equity }])
        break

      case 'complete':
        setStatus('complete')
        setProgress(100)
        setResult(data)
        if (data.backtest_id) {
          setBacktestId(data.backtest_id)
          // Load chart markers for complete display
          fetch(`/api/programs/backtest/${data.backtest_id}/markers`)
            .then(res => res.ok ? res.json() : null)
            .then(markersData => {
              if (markersData?.markers) setChartMarkers(markersData.markers)
            })
          // Auto load trigger details after completion
          loadTriggerDetailsForBacktest(data.backtest_id)
        }
        // Use final equity curve from result
        if (data.equity_curve) {
          setEquityCurve(data.equity_curve)
        }
        break

      case 'error':
        setStatus('error')
        setErrorMessage(data.message)
        break
    }
  }

  const loadTriggerDetails = async () => {
    if (!backtestId) return

    setLoadingDetails(true)
    try {
      const res = await fetch(`/api/programs/backtest/${backtestId}/triggers?offset=0&limit=100`)
      if (res.ok) {
        const data = await res.json()
        setTriggerLogs(data.triggers)
        setDetailsTotal(data.total)
        setDetailsOffset(0)
        setShowDetails(true)
      }
    } catch (e) {
      console.error('Failed to load trigger details:', e)
    } finally {
      setLoadingDetails(false)
    }
  }

  const loadMoreDetails = async () => {
    if (!backtestId) return

    const newOffset = detailsOffset + 100
    setLoadingMore(true)
    try {
      const res = await fetch(`/api/programs/backtest/${backtestId}/triggers?offset=${newOffset}&limit=100`)
      if (res.ok) {
        const data = await res.json()
        setTriggerLogs(prev => [...prev, ...data.triggers])
        setDetailsOffset(newOffset)
      }
    } catch (e) {
      console.error('Failed to load more details:', e)
    } finally {
      setLoadingMore(false)
    }
  }

  // Load single trigger detail for side panel
  const selectTrigger = async (triggerId: number) => {
    // If already selected, deselect
    if (selectedTrigger?.id === triggerId) {
      setSelectedTrigger(null)
      return
    }

    // Load from API
    setLoadingTriggerDetail(true)
    try {
      const res = await fetch(`/api/programs/backtest/trigger/${triggerId}`)
      if (res.ok) {
        const data = await res.json()
        setSelectedTrigger(data)
      }
    } catch (e) {
      console.error('Failed to load trigger detail:', e)
    } finally {
      setLoadingTriggerDetail(false)
    }
  }

  const formatNumber = (num: number | null | undefined, decimals = 2) => {
    if (num === null || num === undefined) return '-'
    return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  }

  const balance = parseFloat(initialBalance) || 10000

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-[1700px] h-[90vh] overflow-hidden flex flex-col"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center gap-3">
            <DialogTitle>
              {t('programTrader.backtestTitle', 'Backtest')}: {binding.program_name}
            </DialogTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={loadingHistory}>
                  {loadingHistory ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <History className="h-4 w-4 mr-1" />
                  )}
                  {t('programTrader.history', 'History')}
                  {historyList.length > 0 && ` (${historyList.length})`}
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72 max-h-80 overflow-y-auto">
                {historyList.length === 0 ? (
                  <div className="p-3 text-center text-sm text-muted-foreground">
                    {t('programTrader.noHistory', 'No backtest history')}
                  </div>
                ) : (
                  <>
                  {historyList.map((item) => {
                    // Convert UTC to local for display
                    const startLocal = item.start_time ? utcToLocalDateTime(item.start_time) : null
                    const endLocal = item.end_time ? utcToLocalDateTime(item.end_time) : null
                    const itemExchange = item.exchange || 'hyperliquid'
                    return (
                    <DropdownMenuItem
                      key={item.id}
                      onClick={() => loadHistoricalBacktest(item)}
                      className="flex justify-between items-center cursor-pointer"
                    >
                      <div className="flex-1">
                        <div className="text-xs flex items-center gap-1.5">
                          {new Date(item.created_at).toLocaleString()}
                          <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${
                            itemExchange === 'hyperliquid' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-yellow-500/15 text-yellow-500'
                          }`}>
                            {itemExchange === 'hyperliquid' ? 'HL' : 'BN'}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {startLocal?.date} {startLocal?.time} ~ {endLocal?.date} {endLocal?.time}
                        </div>
                      </div>
                      <div className="text-right ml-2">
                        <div className={`text-xs font-medium ${item.total_pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                          {item.total_pnl >= 0 ? '+' : ''}{item.total_pnl_percent?.toFixed(2)}%
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {item.total_trades} trades
                        </div>
                      </div>
                    </DropdownMenuItem>
                    )
                  })}
                  {historyList.length >= 30 && (
                    <div className="p-2 text-center text-xs text-muted-foreground border-t">
                      {t('programTrader.historyLimit', 'Showing latest 30 records')}
                    </div>
                  )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {collectionDays !== null && collectionDays > 0 && (
              <span className="text-xs text-muted-foreground">
                {t('programTrader.collectionDaysHint', 'Backtest signal triggers rely on market flow data, collected for {{days}} days', { days: collectionDays })}
              </span>
            )}
          </div>
          <DialogDescription className="sr-only">
            {t('programTrader.backtestTitle', 'Backtest')}
          </DialogDescription>
        </DialogHeader>

        {/* Config Area - Two Rows */}
        <div className="flex flex-col gap-2 p-3 bg-muted/30 rounded-lg flex-shrink-0">
          {/* Row 1: Trigger Config */}
          <div className="flex items-center gap-4 text-sm">
            <div className="text-muted-foreground whitespace-nowrap flex items-center gap-1.5">
              <span className="font-medium">{t('programTrader.signalPools', 'Signal Pools')}:</span>
              <span className="text-foreground bg-blue-500/15 px-2 py-0.5 rounded">{binding.signal_pool_names?.join(', ') || '-'}</span>
            </div>
            {binding.scheduled_trigger_enabled && binding.trigger_interval && (
              <div className="text-muted-foreground whitespace-nowrap flex items-center gap-1.5">
                <span className="font-medium">{t('programTrader.scheduledTrigger', 'Scheduled')}:</span>
                <span className="text-foreground bg-orange-500/15 px-2 py-0.5 rounded">{binding.trigger_interval}s</span>
              </div>
            )}
            {/* Reserved space for exchange tag */}
          </div>

          {/* Row 2: Backtest Parameters */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Input
                type="date"
                value={startDate}
                max={todayDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={status === 'calculating' || status === 'running'}
                className="w-32 h-8"
              />
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={status === 'calculating' || status === 'running'}
                className="w-24 h-8"
              />
            </div>
            <span className="text-muted-foreground">~</span>
            <div className="flex items-center gap-1">
              <Input
                type="date"
                value={endDate}
                max={todayDate}
                onChange={(e) => {
                  const nextDate = e.target.value
                  const { date, time, wasClamped } = getClampedEndDateTime(nextDate, endTime || '00:00')
                  setEndDate(date)
                  if (wasClamped) setEndTime(time)
                }}
                disabled={status === 'calculating' || status === 'running'}
                className="w-32 h-8"
              />
              <Input
                type="time"
                value={endTime}
                onChange={(e) => {
                  const nextTime = e.target.value
                  const { date, time } = getClampedEndDateTime(endDate || todayDate, nextTime)
                  setEndDate(date)
                  setEndTime(time)
                }}
                disabled={status === 'calculating' || status === 'running'}
                className="w-24 h-8"
              />
            </div>
            <div className="flex items-center gap-2 ml-2">
              <Label className="text-xs whitespace-nowrap">{t('programTrader.initialBalance', 'Balance')}</Label>
              <Input
                type="number"
                value={initialBalance}
                onChange={(e) => setInitialBalance(e.target.value)}
                disabled={status === 'calculating' || status === 'running'}
                className="w-28 h-8"
              />
            </div>
            <Button
              onClick={startBacktest}
              disabled={status === 'calculating' || status === 'running'}
              size="sm"
              className="ml-auto"
            >
              {status === 'calculating' ? (
              <>
                <Calculator className="h-4 w-4 mr-1 animate-pulse" />
                {t('programTrader.calculating', 'Calculating...')}
              </>
            ) : status === 'running' ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                {t('programTrader.running', 'Running...')}
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-1" />
                {t('programTrader.startBacktest', 'Start')}
              </>
            )}
          </Button>
          </div>
        </div>

        {/* Progress bar - shown when running */}
        {(status === 'calculating' || status === 'running') && (
          <div className="space-y-1 flex-shrink-0 px-1">
            <div className="flex justify-between text-sm">
              <span>
                {status === 'calculating'
                  ? t('programTrader.calculatingTriggers', 'Calculating trigger points...')
                  : t('programTrader.progress', 'Progress')}
              </span>
              {status === 'running' && <span>{currentTrigger} / {totalTriggers}</span>}
            </div>
            <Progress value={status === 'calculating' ? undefined : progress} className="h-2" />
          </div>
        )}

        {/* Main Body - Left Right Split */}
        <div className="flex-1 flex gap-4 overflow-hidden min-h-0">
          {/* Left Side: Stats + Chart */}
          <div className="w-1/2 flex flex-col gap-3 overflow-hidden border rounded-lg p-3">
            {/* Exchange Badge */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-muted-foreground">{t('programTrader.dataSource', 'Data Source')}:</span>
              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                currentExchange === 'hyperliquid' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-yellow-500/15 text-yellow-500'
              }`}>
                {currentExchange === 'hyperliquid' ? 'Hyperliquid' : 'Binance'}
              </span>
            </div>
            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-2 flex-shrink-0">
              <div className="p-2 bg-muted/30 rounded-lg text-center">
                <div className="text-xs text-muted-foreground">{t('programTrader.totalPnl', 'Total PnL')}</div>
                <div className={`text-base font-bold ${(result?.total_pnl ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {result ? `${result.total_pnl >= 0 ? '+' : ''}${formatNumber(result.total_pnl_percent)}%` : '-'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {result ? `$${formatNumber(result.total_pnl)}` : '-'}
                </div>
              </div>
              <div className="p-2 bg-muted/30 rounded-lg text-center">
                <div className="text-xs text-muted-foreground">{t('programTrader.maxDrawdown', 'Max DD')}</div>
                <div className="text-base font-bold text-red-500">
                  {result ? `-${formatNumber(result.max_drawdown_percent)}%` : '-'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {result ? `$${formatNumber(result.max_drawdown)}` : '-'}
                </div>
              </div>
              <div className="p-2 bg-muted/30 rounded-lg text-center">
                <div className="text-xs text-muted-foreground">{t('programTrader.winRate', 'Win Rate')}</div>
                <div className="text-base font-bold">
                  {result ? `${formatNumber(result.win_rate)}%` : '-'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {result ? `${result.winning_trades}W/${result.losing_trades}L` : '-'}
                </div>
              </div>
              <div className="p-2 bg-muted/30 rounded-lg text-center">
                <div className="text-xs text-muted-foreground">{t('programTrader.profitFactor', 'PF')}</div>
                <div className="text-base font-bold">
                  {result ? (result.profit_factor === Infinity ? '∞' : formatNumber(result.profit_factor)) : '-'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {result ? `${chartMarkers.length} actions / ${result.total_trades} closed` : '-'}
                </div>
              </div>
            </div>

            {/* Equity Curve - flex-1 to fill remaining height */}
            <div className="flex-1 bg-muted/20 rounded-lg p-3 min-h-0">
              {loadingHistorical ? (
                <div className="h-full flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : status === 'idle' ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  {t('programTrader.clickToStart', 'Click "Start Backtest" to begin')}
                </div>
              ) : status === 'error' ? (
                <div className="h-full flex items-center justify-center">
                  <div className="p-4 bg-destructive/10 text-destructive rounded-lg max-w-md">
                    {errorMessage}
                  </div>
                </div>
              ) : (
                <EquityCurve data={equityCurve} initialBalance={balance} trades={chartMarkers} />
              )}
            </div>

            {/* Execution Info */}
            {status === 'complete' && backtestId && (
              <div className="text-xs text-muted-foreground flex-shrink-0">
                {t('programTrader.executionTime', 'Execution time')}: {formatNumber(result?.execution_time_ms ? result.execution_time_ms / 1000 : 0, 1)}s
                <span className="ml-2">ID: {backtestId}</span>
              </div>
            )}
          </div>

          {/* Right Side: Trigger Details */}
          <div className="w-1/2 flex flex-col gap-3 overflow-hidden border rounded-lg p-3">
            <div className="text-sm font-medium flex-shrink-0">
              {t('programTrader.triggerDetails', 'Trigger Details')}
              {detailsTotal > 0 && ` (${triggerLogs.length}/${detailsTotal})`}
            </div>

            {loadingHistorical || loadingDetails ? (
              <div className="flex-1 flex items-center justify-center border rounded-lg">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : triggerLogs.length === 0 ? (
              <div className="flex-1 flex items-center justify-center border rounded-lg text-muted-foreground">
                {status === 'idle' ? t('programTrader.runBacktestFirst', 'Run backtest to see trigger details') : t('programTrader.noTriggers', 'No triggers')}
              </div>
            ) : (
              <div className="flex-1 flex gap-3 min-h-0">
                {/* Trigger Table */}
                <div className={`${selectedTrigger ? 'w-1/2' : 'w-full'} flex flex-col transition-all min-h-0`}>
                  <div className="flex-1 overflow-y-auto border rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-background sticky top-0 z-10 border-b">
                        <tr>
                          <th className="p-2 text-left">#</th>
                          <th className="p-2 text-left">{t('programTrader.time', 'Time')}</th>
                          <th className="p-2 text-left">{t('programTrader.triggerType', 'Trigger')}</th>
                          <th className="p-2 text-left">{t('programTrader.action', 'Action')}</th>
                          <th className="p-2 text-right">Unrealized</th>
                          <th className="p-2 text-right">Realized</th>
                          <th className="p-2 text-right">Fee</th>
                          <th className="p-2 text-right">Equity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {triggerLogs.map((log) => {
                          const isSelected = selectedTrigger?.id === log.id
                          const isTpSl = log.trigger_type === 'tp' || log.trigger_type === 'sl'
                          const unrealizedPnl = log.unrealized_pnl ?? 0
                          const realizedPnl = log.realized_pnl ?? 0
                          return (
                            <tr
                              key={log.id}
                              className={`border-t cursor-pointer transition-colors ${
                                isSelected ? 'bg-primary/10' : 'hover:bg-muted/30'
                              }`}
                              onClick={() => selectTrigger(log.id)}
                            >
                              <td className="p-2 text-muted-foreground">
                                {loadingTriggerDetail && isSelected ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  log.trigger_index
                                )}
                              </td>
                              <td className="p-2 whitespace-nowrap text-xs">
                                {new Date(log.trigger_time).toLocaleString()}
                              </td>
                              <td className="p-2">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  log.trigger_type === 'signal' ? 'bg-blue-500/15 text-blue-500' :
                                  log.trigger_type === 'scheduled' ? 'bg-orange-500/15 text-orange-500' :
                                  log.trigger_type === 'tp' ? 'bg-green-500/15 text-green-500' :
                                  log.trigger_type === 'sl' ? 'bg-red-500/15 text-red-500' :
                                  'bg-muted text-muted-foreground'
                                }`}>
                                  {log.trigger_type === 'signal' ? 'SIG' :
                                   log.trigger_type === 'scheduled' ? 'SCH' :
                                   log.trigger_type?.toUpperCase() || '-'}
                                </span>
                              </td>
                              <td className={`p-2 font-medium ${
                                isTpSl ? 'text-purple-500' :
                                log.decision_action === 'buy' || log.decision_action === 'add_position' ? 'text-green-500' :
                                log.decision_action === 'sell' ? 'text-red-500' :
                                log.decision_action === 'close' ? 'text-yellow-500' :
                                'text-muted-foreground'
                              }`}>
                                {isTpSl
                                  ? `${log.trigger_type.toUpperCase()} ${log.decision_symbol || ''}`.trim()
                                  : `${log.decision_action?.toUpperCase() || '-'} ${log.decision_symbol || ''}`.trim()}
                              </td>
                              <td className={`p-2 text-right ${
                                unrealizedPnl > 0 ? 'text-green-500' : unrealizedPnl < 0 ? 'text-red-500' : 'text-muted-foreground'
                              }`}>
                                {unrealizedPnl !== 0 ? (unrealizedPnl > 0 ? '+' : '') + formatNumber(unrealizedPnl) : '-'}
                              </td>
                              <td className={`p-2 text-right font-medium ${
                                realizedPnl > 0 ? 'text-green-500' : realizedPnl < 0 ? 'text-red-500' : 'text-muted-foreground'
                              }`}>
                                {realizedPnl !== 0 ? (realizedPnl > 0 ? '+' : '') + formatNumber(realizedPnl) : '-'}
                              </td>
                              <td className="p-2 text-right text-muted-foreground">
                                {log.fee ? `-${formatNumber(log.fee)}` : '-'}
                              </td>
                              <td className="p-2 text-right">${formatNumber(log.equity_after)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {triggerLogs.length < detailsTotal && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={loadMoreDetails}
                      disabled={loadingMore}
                      className="w-full mt-2 flex-shrink-0"
                    >
                      {loadingMore && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      {t('programTrader.loadMore', 'Load More')}
                    </Button>
                  )}
                </div>

                {/* Detail Panel */}
                {selectedTrigger && (
                  <div className="w-1/2 border rounded-lg p-3 bg-muted/20 flex flex-col overflow-hidden">
                    <div className="flex justify-between items-center mb-3 flex-shrink-0">
                      <span className="text-sm font-medium">
                        #{selectedTrigger.trigger_index} Detail
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => setSelectedTrigger(null)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto">
                      <TriggerDetailView detail={selectedTrigger} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Custom tooltip component (defined outside to avoid recreation)
const EquityCurveTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const d = payload[0].payload
    return (
      <div className="bg-background border rounded-lg p-2 shadow-lg text-xs">
        <div className="text-muted-foreground">#{d.index}</div>
        <div className="font-medium">${d.equity.toFixed(2)}</div>
        <div className={d.pnl >= 0 ? 'text-green-500' : 'text-red-500'}>
          {d.pnl >= 0 ? '+' : ''}{d.pnl.toFixed(2)} ({d.pnlPercent}%)
        </div>
      </div>
    )
  }
  return null
}

// Recharts-based equity curve component with Brush for zooming
// Memoized to prevent re-render when selecting triggers
const EquityCurve = React.memo(function EquityCurve({
  data,
  initialBalance,
  trades = []
}: {
  data: Array<{ timestamp: number; equity: number }>
  initialBalance: number
  trades?: Array<{ index: number; action: string; trigger_type: string }>
}) {
  if (!data || data.length === 0) {
    return <div className="h-full flex items-center justify-center text-muted-foreground">No data</div>
  }

  // Get trade marker style
  const getTradeMarkerStyle = (action: string, triggerType: string) => {
    if (triggerType === 'tp') return { bg: '#A855F7', letter: 'T' } // purple for TP
    if (triggerType === 'sl') return { bg: '#A855F7', letter: 'S' } // purple for SL
    switch (action?.toUpperCase()) {
      case 'BUY':
      case 'ADD_POSITION':
        return { bg: '#10B981', letter: 'B' } // green
      case 'SELL':
        return { bg: '#EF4444', letter: 'S' } // red
      case 'CLOSE':
        return { bg: '#3B82F6', letter: 'C' } // blue
      default:
        return null // no marker for HOLD
    }
  }

  // Prepare data with index for display
  const chartData = React.useMemo(() => data.map((d, i) => ({
    index: i,
    equity: d.equity,
    pnl: d.equity - initialBalance,
    pnlPercent: ((d.equity - initialBalance) / initialBalance * 100).toFixed(2),
  })), [data, initialBalance])

  // Build trade markers map (chartData index -> marker style)
  const tradeMarkersMap = React.useMemo(() => {
    const map = new Map<number, { bg: string; letter: string }>()
    trades.forEach(t => {
      const style = getTradeMarkerStyle(t.action, t.trigger_type)
      if (style) map.set(t.index, style)
    })
    return map
  }, [trades])

  const currentEquity = data[data.length - 1]?.equity ?? initialBalance
  const pnlPercent = ((currentEquity - initialBalance) / initialBalance * 100).toFixed(2)

  // Custom dot renderer for trade markers
  // Note: props.index is 0-based array index, props.payload.index is our 1-based chartData index
  const renderDot = (props: any) => {
    const { cx, cy, payload } = props
    if (cx == null || cy == null || !payload) return null
    const chartIndex = payload.index // 1-based index from chartData
    const marker = tradeMarkersMap.get(chartIndex)
    if (!marker) return null
    return (
      <g key={`marker-${chartIndex}`}>
        <circle cx={cx} cy={cy} r={8} fill={marker.bg} stroke="#fff" strokeWidth={1.5} />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={9} fontWeight="bold">
          {marker.letter}
        </text>
      </g>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Current status */}
      <div className="flex justify-between text-xs mb-1 px-1">
        <span className="text-muted-foreground">
          Initial: ${initialBalance.toFixed(0)}
        </span>
        <span className={currentEquity >= initialBalance ? 'text-green-500' : 'text-red-500'}>
          Current: ${currentEquity.toFixed(2)} ({pnlPercent}%)
        </span>
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
          <XAxis
            dataKey="index"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            domain={['dataMin', 'dataMax']}
          />
          <YAxis
            domain={['auto', 'auto']}
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `$${v.toFixed(0)}`}
            width={50}
          />
          <Tooltip content={<EquityCurveTooltip />} />
          <ReferenceLine
            y={initialBalance}
            stroke="currentColor"
            strokeDasharray="4 4"
            strokeOpacity={0.3}
          />
          <Line
            type="monotone"
            dataKey="equity"
            stroke="hsl(var(--primary))"
            strokeWidth={1.5}
            dot={trades.length > 0 ? renderDot : false}
            activeDot={{ r: 4, fill: 'hsl(var(--primary))' }}
            isAnimationActive={false}
          />
          {/* Brush for zooming - only show when data is large */}
          {chartData.length > 50 && (
            <Brush
              dataKey="index"
              height={20}
              stroke="hsl(var(--muted-foreground))"
              fill="hsl(var(--muted))"
              tickFormatter={() => ''}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
})

// Component to display expanded trigger detail
function TriggerDetailView({ detail }: { detail: TriggerDetail }) {
  const { t } = useTranslation()

  const formatJson = (obj: any) => {
    if (!obj) return '-'
    try {
      return JSON.stringify(obj, null, 2)
    } catch {
      return String(obj)
    }
  }

  // Format size with reasonable precision (max 6 significant digits)
  const formatSize = (size: number | null | undefined) => {
    if (size == null) return '-'
    if (size === 0) return '0'
    // Use toPrecision for significant digits, then parseFloat to remove trailing zeros
    return parseFloat(size.toPrecision(6)).toString()
  }

  const hasInputOutput = detail.decision_input || detail.decision_output
  const isTpSl = detail.trigger_type === 'tp' || detail.trigger_type === 'sl'

  const unrealizedPnl = detail.unrealized_pnl ?? 0
  const realizedPnl = detail.realized_pnl ?? 0

  return (
    <div className="flex flex-col text-xs">
      {/* Info Grid - Dashboard style (fixed height) */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 flex-shrink-0">
        <div>
          <span className="text-muted-foreground">{t('programTrader.time', 'Time')}:</span>{' '}
          <span className="font-medium">{new Date(detail.trigger_time).toLocaleString()}</span>
        </div>
        <div>
          <span className="text-muted-foreground">{t('programTrader.symbol', 'Symbol')}:</span>{' '}
          <span className="font-medium">{detail.symbol || '-'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">{t('programTrader.action', 'Action')}:</span>{' '}
          <span className={`font-medium ${
            isTpSl ? 'text-purple-500' :
            detail.decision_action === 'buy' || detail.decision_action === 'add_position' ? 'text-green-500' :
            detail.decision_action === 'sell' ? 'text-red-500' :
            detail.decision_action === 'close' ? 'text-yellow-500' : ''
          }`}>{isTpSl ? detail.trigger_type.toUpperCase() : (detail.decision_action?.toUpperCase() || '-')}</span>
        </div>
        <div>
          <span className="text-muted-foreground">{t('programTrader.side', 'Side')}:</span>{' '}
          <span className="font-medium">{detail.decision_side?.toUpperCase() || '-'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Equity:</span>{' '}
          <span className="font-medium">${detail.equity_before?.toFixed(2)} → ${detail.equity_after?.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Unrealized:</span>{' '}
          <span className={`font-medium ${
            unrealizedPnl > 0 ? 'text-green-500' : unrealizedPnl < 0 ? 'text-red-500' : ''
          }`}>
            {unrealizedPnl !== 0 ? (unrealizedPnl > 0 ? '+' : '') + unrealizedPnl.toFixed(2) : '-'}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Realized:</span>{' '}
          <span className={`font-medium ${
            realizedPnl > 0 ? 'text-green-500' : realizedPnl < 0 ? 'text-red-500' : ''
          }`}>
            {realizedPnl !== 0 ? (realizedPnl > 0 ? '+' : '') + realizedPnl.toFixed(2) : '-'}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Size:</span>{' '}
          <span className="font-medium">{formatSize(detail.decision_size)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Fee:</span>{' '}
          <span className="font-medium text-muted-foreground">{detail.fee ? `-$${detail.fee.toFixed(2)}` : '-'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Entry Price:</span>{' '}
          <span className="font-medium">{detail.entry_price ? `$${detail.entry_price.toFixed(2)}` : '-'}</span>
        </div>
        {detail.exit_price && (
          <div>
            <span className="text-muted-foreground">Exit Price:</span>{' '}
            <span className="font-medium">${detail.exit_price.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Reason (fixed height) */}
      {detail.decision_reason && (
        <div className="border-t pt-2 mt-2 flex-shrink-0">
          <div className="text-muted-foreground mb-1">{t('programTrader.reason', 'Reason')}</div>
          <div className="bg-muted/30 p-2 rounded text-xs">{detail.decision_reason}</div>
        </div>
      )}

      {/* Decision Input & Output - Collapsible sections */}
      {hasInputOutput && (
        <div className="flex flex-col gap-1 mt-2 min-h-0">
          {detail.decision_input && (
            <CollapsibleSection title="Decision Input" copyContent={formatJson(detail.decision_input)} defaultOpen={false}>
              <pre className="bg-muted/30 p-2 rounded overflow-auto text-[10px] max-h-40">
                {formatJson(detail.decision_input)}
              </pre>
            </CollapsibleSection>
          )}
          {detail.decision_output && (
            <CollapsibleSection title="Decision Output" copyContent={formatJson(detail.decision_output)} defaultOpen={false}>
              <pre className="bg-muted/30 p-2 rounded overflow-auto text-[10px] max-h-40">
                {formatJson(detail.decision_output)}
              </pre>
            </CollapsibleSection>
          )}
        </div>
      )}

      {/* Data Queries - Collapsible */}
      {detail.data_queries && detail.data_queries.length > 0 && (
        <CollapsibleSection
          title={`Data Queries (${detail.data_queries.length})`}
          copyContent={detail.data_queries.map(q => typeof q === 'string' ? q : JSON.stringify(q)).join('\n')}
          defaultOpen={false}
        >
          <div className="bg-muted/30 p-2 rounded text-[10px] max-h-32 overflow-auto">
            {detail.data_queries.map((q, i) => (
              <div key={i} className="text-blue-500">
                {typeof q === 'string' ? q : `${q.method}(${JSON.stringify(q.args)}) → ${JSON.stringify(q.result)}`}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Execution Logs - Collapsible */}
      {detail.execution_logs && detail.execution_logs.length > 0 && (
        <CollapsibleSection title={`Execution Logs (${detail.execution_logs.length})`} copyContent={detail.execution_logs.join('\n')} defaultOpen={false}>
          <div className="bg-muted/30 p-2 rounded text-[10px] max-h-32 overflow-auto">
            {detail.execution_logs.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Execution error (fixed height) */}
      {detail.execution_error && (
        <div className="border-t pt-2 mt-2 flex-shrink-0">
          <div className="text-destructive mb-1">Error</div>
          <div className="bg-destructive/10 text-destructive p-2 rounded text-xs">
            {detail.execution_error}
          </div>
        </div>
      )}
    </div>
  )
}

// Collapsible section component for detail view with copy support
function CollapsibleSection({
  title,
  children,
  copyContent,
  defaultOpen = false
}: {
  title: string
  children: React.ReactNode
  copyContent?: string
  defaultOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const [copied, setCopied] = useState(false)

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!copyContent) return
    try {
      await navigator.clipboard.writeText(copyContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border-t pt-2 mt-1 flex-shrink-0">
      <div className="flex items-center justify-between">
        <CollapsibleTrigger className="flex items-center gap-1 text-muted-foreground hover:text-foreground cursor-pointer text-left">
          {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <span className="text-xs">{title}</span>
        </CollapsibleTrigger>
        {isOpen && copyContent && (
          <button
            onClick={handleCopy}
            className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
            title="Copy to clipboard"
          >
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          </button>
        )}
      </div>
      <CollapsibleContent className="mt-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
