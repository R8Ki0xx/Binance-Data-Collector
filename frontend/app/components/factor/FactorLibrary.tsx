import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { apiRequest, getHyperliquidWatchlist, getBinanceWatchlist } from '@/lib/api'
import { RefreshCw, Info, CheckCircle2, ArrowUpDown, FlaskConical, Plus, Trash2, Pencil, BarChart3 } from 'lucide-react'
import FactorAnalysisDialog from './FactorAnalysisDialog'
import ExchangeIcon from '@/components/exchange/ExchangeIcon'
import PacmanLoader from '@/components/ui/pacman-loader'
import type { ExchangeId } from '@/lib/types/exchange'

const EXCHANGES: ExchangeId[] = ['hyperliquid', 'binance']
const FORWARD_PERIODS = ['1h', '4h', '12h', '24h']

// Function categories for the picker in Custom Factor dialog
const FUNC_CATEGORIES: { key: string; en: string; zh: string; fns: string[] }[] = [
  { key: 'ma', en: 'Moving Avg', zh: '均线', fns: ['SMA', 'EMA', 'WMA'] },
  { key: 'mom', en: 'Momentum', zh: '动量', fns: ['RSI', 'ROC', 'MOM', 'MACD', 'MACD_SIGNAL', 'MACD_HIST', 'STOCH_K', 'STOCH_D', 'CCI', 'WILLR'] },
  { key: 'vol', en: 'Volatility', zh: '波动率', fns: ['ATR', 'STDDEV', 'BBANDS_UPPER', 'BBANDS_MID', 'BBANDS_LOWER'] },
  { key: 'volume', en: 'Volume', zh: '成交量', fns: ['OBV', 'VWAP'] },
  { key: 'ts', en: 'Time Series', zh: '时间序列', fns: ['DELAY', 'DELTA', 'TS_MAX', 'TS_MIN', 'TS_RANK'] },
  { key: 'math', en: 'Math', zh: '数学', fns: ['ABS', 'LOG', 'SIGN', 'MAX', 'MIN', 'RANK', 'ZSCORE'] },
]

// Default expressions inserted when user clicks a function chip
const FUNC_TEMPLATES: Record<string, string> = {
  SMA: 'SMA(close, 20)', EMA: 'EMA(close, 20)', WMA: 'WMA(close, 20)',
  RSI: 'RSI(close, 14)', ROC: 'ROC(close, 10)', MOM: 'MOM(close, 10)',
  MACD: 'MACD(close, 12, 26, 9)', MACD_SIGNAL: 'MACD_SIGNAL(close, 12, 26, 9)',
  MACD_HIST: 'MACD_HIST(close, 12, 26, 9)',
  STOCH_K: 'STOCH_K(high, low, close, 14)', STOCH_D: 'STOCH_D(high, low, close, 14)',
  CCI: 'CCI(high, low, close, 20)', WILLR: 'WILLR(high, low, close, 14)',
  ATR: 'ATR(high, low, close, 14)', STDDEV: 'STDDEV(close, 20)',
  BBANDS_UPPER: 'BBANDS_UPPER(close, 20)', BBANDS_MID: 'BBANDS_MID(close, 20)',
  BBANDS_LOWER: 'BBANDS_LOWER(close, 20)',
  OBV: 'OBV(close, volume)', VWAP: 'VWAP(high, low, close, volume)',
  DELAY: 'DELAY(close, 1)', DELTA: 'DELTA(close, 1)',
  TS_MAX: 'TS_MAX(close, 20)', TS_MIN: 'TS_MIN(close, 20)', TS_RANK: 'TS_RANK(close, 20)',
  ABS: 'ABS()', LOG: 'LOG()', SIGN: 'SIGN()',
  MAX: 'MAX(, )', MIN: 'MIN(, )', RANK: 'RANK(close)', ZSCORE: 'ZSCORE(close)',
}

// Translate backend error messages to Chinese
function translateError(err: string, lang: string): string {
  if (lang !== 'zh') return err
  if (err.startsWith('Syntax error')) return err.replace('Syntax error', '语法错误')
  if (err.startsWith('Parse error')) return err.replace('Parse error', '解析错误')
  if (err.startsWith('Execution error')) return err.replace('Execution error', '执行错误')
  if (err.startsWith('Evaluation error')) return err.replace('Evaluation error', '求值错误')
  if (err === 'Expression is empty') return '表达式为空'
  if (err === 'Expression too long (max 500 chars)') return '表达式过长（最多500字符）'
  if (err === 'Expression returned None') return '表达式返回空值'
  if (err.startsWith('Insufficient K-line data')) return 'K线数据不足'
  if (err.startsWith('Not enough aligned data')) return '对齐数据不足，无法计算IC'
  if (err.includes("already exists")) return `因子名称 '${err.match(/'([^']+)'/)?.[1] || ''}' 已存在`
  return err
}

function icBadge(ic: number | null | undefined) {
  if (ic == null) return <span className="text-muted-foreground">—</span>
  const abs = Math.abs(ic)
  const text = ic.toFixed(4)
  if (abs >= 0.05) return <Badge variant="default" className="bg-green-600 text-xs">{text}</Badge>
  if (abs >= 0.02) return <Badge variant="outline" className="text-yellow-500 text-xs">{text}</Badge>
  return <span className="text-muted-foreground text-xs">{text}</span>
}

function wrBadge(wr: number | null | undefined) {
  if (wr == null) return <span className="text-muted-foreground">—</span>
  const pct = (wr * 100).toFixed(1) + '%'
  if (wr >= 0.55) return <span className="text-green-500 text-sm">{pct}</span>
  if (wr >= 0.45) return <span className="text-yellow-500 text-sm">{pct}</span>
  return <span className="text-red-500 text-sm">{pct}</span>
}

interface FactorDef {
  name: string; category: string; display_name: string; display_name_zh?: string
  description: string; description_zh?: string; value_range?: string; unit?: string
}

export default function FactorLibrary() {
  const { t, i18n } = useTranslation()
  const isZh = i18n.language?.startsWith('zh')

  const [exchange, setExchange] = useState<ExchangeId>('hyperliquid')
  const [symbol, setSymbol] = useState('')
  const [symbols, setSymbols] = useState<string[]>([])
  const [period] = useState('1h')
  const [forwardPeriod, setForwardPeriod] = useState('4h')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [library, setLibrary] = useState<{ factors: FactorDef[]; categories: string[]; category_labels: any }>()
  const [values, setValues] = useState<any[]>([])
  const [effectiveness, setEffectiveness] = useState<any[]>([])
  const [lastComputeTime, setLastComputeTime] = useState<number | null>(null)
  const [computing, setComputing] = useState(false)
  const [computeDialogOpen, setComputeDialogOpen] = useState(false)
  const [computeResult, setComputeResult] = useState<any>(null)
  const [computeEstimate, setComputeEstimate] = useState<any>(null)
  const [computeProgress, setComputeProgress] = useState<any>(null)
  const [dialogStep, setDialogStep] = useState<'confirm' | 'progress' | 'done'>('confirm')
  const [countdown, setCountdown] = useState('')
  const [loading, setLoading] = useState(true)
  const [sortCol, setSortCol] = useState<string>('icir')
  const [sortDesc, setSortDesc] = useState(true)

  // Custom Factor Lab state
  const [labDialogOpen, setLabDialogOpen] = useState(false)
  const [editingFactorId, setEditingFactorId] = useState<number | null>(null)
  const [expression, setExpression] = useState('')
  const [evalResult, setEvalResult] = useState<any>(null)
  const [evalError, setEvalError] = useState('')
  const [evaluating, setEvaluating] = useState(false)
  const [funcCatTab, setFuncCatTab] = useState(FUNC_CATEGORIES[0].key)
  const [saveName, setSaveName] = useState('')
  const [saveDesc, setSaveDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [customFactors, setCustomFactors] = useState<any[]>([])

  // Factor Analysis Dialog state
  const [analysisOpen, setAnalysisOpen] = useState(false)
  const [analysisFactor, setAnalysisFactor] = useState<{ name: string; displayName: string }>({ name: '', displayName: '' })

  useEffect(() => {
    apiRequest('/factors/library').then(r => r.json()).then(setLibrary).catch(() => {})
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const data = exchange === 'binance'
          ? await getBinanceWatchlist()
          : await getHyperliquidWatchlist()
        const syms = data.symbols || []
        setSymbols(syms)
        if (syms.length > 0 && !syms.includes(symbol)) setSymbol(syms[0])
      } catch { setSymbols([]) }
    }
    load()
  }, [exchange])

  const loadData = useCallback(async () => {
    if (!symbol) return
    setLoading(true)
    try {
      const [valRes, effRes, statusRes] = await Promise.all([
        apiRequest(`/factors/values?symbol=${symbol}&period=${period}&exchange=${exchange}`).then(r => r.json()).catch(() => ({ values: [] })),
        apiRequest(`/factors/effectiveness?symbol=${symbol}&period=${period}&forward_period=${forwardPeriod}&exchange=${exchange}`).then(r => r.json()).catch(() => ({ items: [] })),
        apiRequest('/factors/status').then(r => r.json()).catch(() => null),
      ])
      setValues(valRes.values || [])
      setEffectiveness(effRes.items || [])
      if (statusRes?.last_compute_time) {
        setLastComputeTime(statusRes.last_compute_time[exchange] || null)
      }
    } finally { setLoading(false) }
  }, [symbol, period, exchange, forwardPeriod])

  useEffect(() => { loadData() }, [loadData])

  const loadCustomFactors = useCallback(async () => {
    try {
      const res = await apiRequest('/factors/custom').then(r => r.json())
      setCustomFactors(res.items || [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { loadCustomFactors() }, [loadCustomFactors])

  // Custom Factor Lab handlers
  const openLabDialog = (factorId?: number) => {
    if (factorId) {
      const cf = customFactors.find(f => f.id === factorId)
      if (cf) {
        setEditingFactorId(factorId)
        setExpression(cf.expression)
        setSaveName(cf.name)
        setSaveDesc(cf.description || '')
      }
    } else {
      setEditingFactorId(null)
      setExpression('')
      setSaveName('')
      setSaveDesc('')
    }
    setEvalResult(null)
    setEvalError('')
    setLabDialogOpen(true)
  }

  const handleEvaluate = async () => {
    if (!expression.trim() || !symbol) return
    setEvaluating(true)
    setEvalResult(null)
    setEvalError('')
    try {
      const res = await apiRequest('/factors/evaluate', {
        method: 'POST',
        body: JSON.stringify({ expression: expression.trim(), symbol, exchange, period: '1h' }),
      }).then(r => r.json())
      if (res.status === 'error') setEvalError(translateError(res.error, isZh ? 'zh' : 'en'))
      else setEvalResult(res)
    } catch (e: any) {
      setEvalError(e.message || 'Unknown error')
    } finally {
      setEvaluating(false)
    }
  }

  const handleSaveCustom = async () => {
    if (!saveName.trim() || !expression.trim()) return
    setSaving(true)
    setEvalError('')
    try {
      if (editingFactorId) {
        await apiRequest(`/factors/custom/${editingFactorId}`, { method: 'DELETE' })
      }
      const res = await apiRequest('/factors/custom', {
        method: 'POST',
        body: JSON.stringify({
          name: saveName.trim(), expression: expression.trim(),
          description: saveDesc.trim(), category: 'custom', source: 'manual',
        }),
      }).then(r => r.json())
      if (res.status === 'ok') {
        setLabDialogOpen(false)
        await loadCustomFactors()
      } else {
        setEvalError(translateError(res.error || 'Save failed', isZh ? 'zh' : 'en'))
      }
    } catch (e: any) {
      setEvalError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteCustom = async (id: number) => {
    if (!confirm(t('factors.deleteConfirm'))) return
    try {
      await apiRequest(`/factors/custom/${id}`, { method: 'DELETE' })
      await loadCustomFactors()
    } catch { /* ignore */ }
  }

  const insertFunction = (funcName: string) => {
    const template = FUNC_TEMPLATES[funcName] || funcName + '('
    setExpression(prev => {
      if (!prev.trim()) return template
      return prev + ' ' + template
    })
  }

  // Compute handlers (unchanged)
  useEffect(() => {
    if (!lastComputeTime) { setCountdown(''); return }
    const update = () => {
      const nextTs = lastComputeTime + 3600
      const remaining = nextTs - Date.now() / 1000
      if (remaining <= 0) { setCountdown(''); return }
      const m = Math.floor(remaining / 60)
      const s = Math.floor(remaining % 60)
      setCountdown(`${m}:${s.toString().padStart(2, '0')}`)
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [lastComputeTime])

  const handleComputeClick = async () => {
    setComputeDialogOpen(true)
    setDialogStep('confirm')
    setComputeResult(null)
    setComputeProgress(null)
    setComputeEstimate(null)
    try {
      const est = await apiRequest(`/factors/compute/estimate?exchange=${exchange}`).then(r => r.json())
      setComputeEstimate(est)
    } catch { /* ignore */ }
  }

  const handleComputeConfirm = async () => {
    setDialogStep('progress')
    setComputing(true)
    setComputeProgress(null)
    try {
      const startRes = await apiRequest('/factors/compute', {
        method: 'POST', body: JSON.stringify({ exchange, period }),
      }).then(r => r.json())
      if (startRes.status === 'already_running') {
        setComputeResult({ error: t('factors.alreadyRunning') })
        setDialogStep('done'); setComputing(false); return
      }
      const poll = setInterval(async () => {
        try {
          const prog = await apiRequest('/factors/compute/progress').then(r => r.json())
          setComputeProgress(prog)
          if (prog.status === 'done' || prog.status === 'error' || prog.status === 'idle') {
            clearInterval(poll); setComputeResult(prog)
            setDialogStep('done'); setComputing(false); await loadData()
          }
        } catch { /* ignore */ }
      }, 1500)
    } catch (e: any) {
      setComputeResult({ error: e.message || 'Unknown error' })
      setDialogStep('done'); setComputing(false)
    }
  }

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDesc(!sortDesc)
    else { setSortCol(col); setSortDesc(true) }
  }

  // Merge library (builtin + custom) with values and effectiveness data
  const mergedRows = useMemo(() => {
    if (!library) return []
    const valMap = new Map(values.map(v => [v.factor_name, v]))
    const effMap = new Map(effectiveness.map(e => [e.factor_name, e]))

    const rows = library.factors
      .filter((f: any) => categoryFilter === 'all' || f.category === categoryFilter)
      .map((f: any) => {
        const v = valMap.get(f.name)
        const e = effMap.get(f.name)
        const isCustom = f.source !== 'builtin' && f.source !== 'builtin_expression'
        return {
          ...f, value: v?.value ?? null, timestamp: v?.timestamp, ...e,
          _isCustom: isCustom, _customId: f.custom_id ?? null, _expression: f.expression ?? null,
        }
      })

    if (['ic_mean', 'icir', 'win_rate'].includes(sortCol)) {
      rows.sort((a: any, b: any) => {
        const av = Math.abs(a[sortCol] ?? 0)
        const bv = Math.abs(b[sortCol] ?? 0)
        return sortDesc ? bv - av : av - bv
      })
    }
    return rows
  }, [library, values, effectiveness, categoryFilter, sortCol, sortDesc])

  const categories = library?.categories || []
  const catLabels = library?.category_labels || {}
  const getCatLabel = (cat: string) => {
    if (cat === 'custom') return t('factors.customTag')
    const l = catLabels[cat]
    return l ? (isZh ? l.zh : l.en) : cat
  }
  const getFactorDesc = (f: any) => isZh ? (f.description_zh || f.description) : f.description
  const formatLastUpdate = () => {
    if (!lastComputeTime) return '--'
    return new Date(lastComputeTime * 1000).toLocaleString()
  }

  if (loading && !library) {
    return <div className="flex items-center justify-center h-40 text-muted-foreground">{t('factors.loading')}</div>
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col flex-1 min-h-0 space-y-3">
        {/* Controls row */}
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('factors.exchange')}</label>
            <Select value={exchange} onValueChange={(v) => setExchange(v as ExchangeId)}>
              <SelectTrigger className="w-36">
                <div className="flex items-center gap-2">
                  <ExchangeIcon exchangeId={exchange} size={16} />
                  <span className="capitalize">{exchange}</span>
                </div>
              </SelectTrigger>
              <SelectContent>
                {EXCHANGES.map(e => (
                  <SelectItem key={e} value={e}>
                    <div className="flex items-center gap-2">
                      <ExchangeIcon exchangeId={e} size={16} />
                      <span className="capitalize">{e}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {symbols.length > 0 ? (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Symbol</label>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {symbols.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground pb-1">{t('factors.noSymbols')}</span>
          )}

          <div className="flex flex-col gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="text-xs text-muted-foreground flex items-center gap-1 cursor-help">
                  {t('factors.forwardPeriodLabel')}
                  <Info className="h-3 w-3" />
                </label>
              </TooltipTrigger>
              <TooltipContent><p className="text-xs max-w-[200px]">{t('factors.forwardPeriodHint')}</p></TooltipContent>
            </Tooltip>
            <Select value={forwardPeriod} onValueChange={setForwardPeriod}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FORWARD_PERIODS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <Button variant="outline" size="sm" className="self-end" disabled={computing || !symbol}
            onClick={handleComputeClick}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${computing ? 'animate-spin' : ''}`} />
            {computing ? t('factors.computing') : t('factors.manualCompute')}
          </Button>

          <Button size="sm" className="self-end gap-1" onClick={() => openLabDialog()}>
            <Plus className="h-3.5 w-3.5" />
            <FlaskConical className="h-3.5 w-3.5" />
            {t('factors.customLab')}
          </Button>

          <span className="text-xs text-muted-foreground ml-auto self-end pb-1">
            {t('factors.lastUpdate')}: {formatLastUpdate()}
            {countdown && ` | ${t('factors.nextCompute')}: ${countdown}`}
          </span>
        </div>

        {/* Compute dialog */}
        <Dialog open={computeDialogOpen} onOpenChange={(open) => {
          if (!open && computing) return
          setComputeDialogOpen(open)
        }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t('factors.computeConfirmTitle')}</DialogTitle>
              <DialogDescription>{exchange} / {period} K-line</DialogDescription>
            </DialogHeader>
            {dialogStep === 'confirm' && (
              <>
                <div className="py-4 space-y-3">
                  <p className="text-sm">{t('factors.confirmCompute')}</p>
                  {computeEstimate && (
                    <div className="rounded-md bg-muted p-3 space-y-2 text-xs">
                      <div>
                        <span className="text-muted-foreground">{t('factors.estimateSymbols')} ({computeEstimate.symbol_count}):</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {computeEstimate.symbols?.map((s: string) => (
                            <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                          ))}
                        </div>
                      </div>
                      <p>{t('factors.estimateFactors')}: <span className="font-medium">{computeEstimate.factor_count}</span></p>
                      <p>{t('factors.estimateWindows')}: <span className="font-medium">{computeEstimate.forward_periods?.join(', ')}</span></p>
                      <p>{t('factors.estimateTime')}: <span className="font-medium">~{Math.max(1, Math.ceil((computeEstimate.estimated_seconds || 0) / 60))} min</span></p>
                    </div>
                  )}
                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                  <DialogClose asChild><Button variant="outline" size="sm">{t('common.cancel')}</Button></DialogClose>
                  <Button size="sm" onClick={handleComputeConfirm}
                    disabled={!computeEstimate || computeEstimate.symbol_count === 0}>
                    {t('factors.startCompute')}
                  </Button>
                </DialogFooter>
              </>
            )}
            {dialogStep === 'progress' && (
              <div className="py-6">
                <div className="flex flex-col items-center gap-3">
                  <PacmanLoader className="w-16 h-8 text-primary" />
                  <p className="text-sm font-medium">{t('factors.computing')}</p>
                  {computeProgress?.status === 'running' && (
                    <div className="w-full space-y-2">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{computeProgress.phase === 'values' ? t('factors.phaseValues') : t('factors.phaseEffectiveness')}</span>
                        <span>{computeProgress.current_symbol} ({computeProgress.completed}/{computeProgress.total})</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div className="bg-primary h-2 rounded-full transition-all duration-500"
                          style={{ width: `${computeProgress.total > 0 ? (computeProgress.completed / computeProgress.total) * 100 : 0}%` }} />
                      </div>
                      {computeProgress.phase === 'effectiveness' && computeProgress.current_factor && (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span className="font-mono">{computeProgress.current_factor}</span>
                            <span>{computeProgress.factor_completed}/{computeProgress.factor_total}</span>
                          </div>
                          <div className="w-full bg-muted rounded-full h-1.5">
                            <div className="bg-primary/60 h-1.5 rounded-full transition-all duration-300"
                              style={{ width: `${computeProgress.factor_total > 0 ? (computeProgress.factor_completed / computeProgress.factor_total) * 100 : 0}%` }} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            {dialogStep === 'done' && (
              <>
                <div className="py-4">
                  {computeResult?.error ? (
                    <div className="text-center text-red-500 text-sm">{computeResult.error}</div>
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <CheckCircle2 className="h-8 w-8 text-green-500" />
                      <p className="text-sm font-medium">{t('factors.computeSuccess')}</p>
                      <div className="text-xs text-muted-foreground space-y-1">
                        <p>{t('factors.resultSymbols')}: {computeResult?.values_computed ?? 0}</p>
                        <p>{t('factors.resultEffectiveness')}: {computeResult?.effectiveness_computed ?? 0}</p>
                      </div>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <DialogClose asChild><Button variant="outline" size="sm">{t('common.close')}</Button></DialogClose>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Custom Factor Lab Dialog */}
        <Dialog open={labDialogOpen} onOpenChange={setLabDialogOpen}>
          <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FlaskConical className="h-5 w-5" />
                {t('factors.customLab')}
              </DialogTitle>
              <DialogDescription>{t('factors.customLabDesc')}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Target: exchange + symbol */}
              <div className="flex gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">{t('factors.exchange')}</label>
                  <Select value={exchange} onValueChange={(v) => setExchange(v as ExchangeId)}>
                    <SelectTrigger className="w-36">
                      <div className="flex items-center gap-2">
                        <ExchangeIcon exchangeId={exchange} size={16} />
                        <span className="capitalize">{exchange}</span>
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {EXCHANGES.map(e => (
                        <SelectItem key={e} value={e}>
                          <div className="flex items-center gap-2">
                            <ExchangeIcon exchangeId={e} size={16} />
                            <span className="capitalize">{e}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Symbol</label>
                  <Select value={symbol} onValueChange={setSymbol}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {symbols.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Expression input */}
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('factors.expression')}</label>
                <div className="flex gap-2">
                  <Input
                    className="font-mono text-sm flex-1"
                    placeholder={t('factors.expressionPlaceholder')}
                    value={expression}
                    onChange={(e) => setExpression(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleEvaluate()}
                  />
                  <Button disabled={evaluating || !expression.trim() || !symbol} onClick={handleEvaluate}>
                    {evaluating
                      ? <><PacmanLoader className="w-5 h-4 mr-1.5" />{t('factors.evaluating')}</>
                      : t('factors.evaluate')}
                  </Button>
                </div>
                {/* Error display */}
                {evalError && (
                  <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
                    {evalError}
                  </div>
                )}
              </div>

              {/* Function picker - tabbed panel */}
              <div className="rounded-md border overflow-hidden">
                <div className="flex border-b bg-muted/30">
                  {FUNC_CATEGORIES.map(cat => (
                    <button key={cat.key}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
                        funcCatTab === cat.key
                          ? 'border-primary text-foreground bg-background'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => setFuncCatTab(cat.key)}>
                      {isZh ? cat.zh : cat.en}
                    </button>
                  ))}
                </div>
                <div className="p-2 flex gap-1.5 flex-wrap">
                  {(FUNC_CATEGORIES.find(c => c.key === funcCatTab)?.fns || []).map(fn => (
                    <Tooltip key={fn}>
                      <TooltipTrigger asChild>
                        <button
                          className="px-2.5 py-1 rounded bg-muted hover:bg-primary/10 text-xs font-mono border border-transparent hover:border-primary/30 transition-colors"
                          onClick={() => insertFunction(fn)}
                        >{fn}</button>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-xs font-mono">{FUNC_TEMPLATES[fn]}</p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </div>

              {/* Evaluation results */}
              {evalResult && (
                <div className="space-y-3 border-t pt-3">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    <span className="text-sm font-medium">{evalResult.symbol}</span>
                    <span className="text-xs text-muted-foreground">
                      {t('factors.latestValue')}: <span className="font-mono text-foreground">{evalResult.latest_value?.toFixed(6) ?? '—'}</span>
                    </span>
                    {evalResult.decay_half_life_hours != null && (
                      <span className="text-xs text-muted-foreground">
                        {t('factors.decay')}: {evalResult.decay_half_life_hours === -1
                          ? <span className="text-blue-400">{t('factors.persistent')}</span>
                          : <span className={`font-mono ${evalResult.decay_half_life_hours <= 4 ? 'text-red-400' : evalResult.decay_half_life_hours <= 12 ? 'text-yellow-500' : 'text-green-500'}`}>{evalResult.decay_half_life_hours}h</span>}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    {Object.entries(evalResult.effectiveness as Record<string, any>).map(([fp, m]: [string, any]) => (
                      <div key={fp} className="rounded-lg border p-3 space-y-1.5">
                        <div className="font-medium text-sm text-center">{fp}</div>
                        <div className="flex justify-between text-xs"><span className="text-muted-foreground">IC</span>{icBadge(m.ic_mean)}</div>
                        <div className="flex justify-between text-xs"><span className="text-muted-foreground">ICIR</span><span className="font-mono">{m.icir?.toFixed(2)}</span></div>
                        <div className="flex justify-between text-xs"><span className="text-muted-foreground">{t('factors.winRate')}</span>{wrBadge(m.win_rate)}</div>
                        <div className="flex justify-between text-xs"><span className="text-muted-foreground">N</span><span>{m.sample_count}</span></div>
                      </div>
                    ))}
                  </div>

                  {/* Save form */}
                  <div className="border-t pt-3 space-y-3">
                    <label className="text-sm font-medium">{t('factors.saveToLibrary')}</label>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">{t('factors.factorName')}</label>
                        <Input className="text-sm" placeholder={t('factors.factorNamePlaceholder')}
                          value={saveName} onChange={e => setSaveName(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">{t('factors.description')}</label>
                        <Input className="text-sm" placeholder={t('factors.descriptionPlaceholder')}
                          value={saveDesc} onChange={e => setSaveDesc(e.target.value)} />
                      </div>
                    </div>
                    <Button disabled={saving || !saveName.trim()} onClick={handleSaveCustom} className="gap-1.5">
                      {saving ? t('factors.saving') : <><CheckCircle2 className="h-4 w-4" />{t('factors.saveToLibrary')}</>}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        {/* Category filter - includes Custom */}
        <div className="flex gap-1.5 flex-wrap">
          <Badge variant={categoryFilter === 'all' ? 'default' : 'outline'} className="cursor-pointer text-xs"
            onClick={() => setCategoryFilter('all')}>All</Badge>
          {categories.map(c => (
            <Badge key={c} variant={categoryFilter === c ? 'default' : 'outline'}
              className="cursor-pointer text-xs" onClick={() => setCategoryFilter(c)}>
              {getCatLabel(c)}
            </Badge>
          ))}
          {customFactors.length > 0 && (
            <Badge
              variant={categoryFilter === 'custom' ? 'default' : 'outline'}
              className={`cursor-pointer text-xs ${categoryFilter !== 'custom' ? 'bg-purple-500/10 text-purple-400 border-purple-500/30 hover:bg-purple-500/20' : 'bg-purple-600'}`}
              onClick={() => setCategoryFilter('custom')}>
              {t('factors.customTag')} ({customFactors.length})
            </Badge>
          )}
        </div>

        {/* Data table */}
        <div className="flex-1 min-h-0 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead>{t('factors.name')}</TableHead>
                <TableHead>{t('factors.category')}</TableHead>
                <TableHead className="text-right">{t('factors.value')} (1h K-line)</TableHead>
                <TableHead className="text-right">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('ic_mean')}>
                        IC {sortCol === 'ic_mean' && <ArrowUpDown className="h-3 w-3" />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[220px]"><p className="text-xs">{t('factors.icTooltip')}</p></TooltipContent>
                  </Tooltip>
                </TableHead>
                <TableHead className="text-right">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('icir')}>
                        ICIR {sortCol === 'icir' && <ArrowUpDown className="h-3 w-3" />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[220px]"><p className="text-xs">{t('factors.icirTooltip')}</p></TooltipContent>
                  </Tooltip>
                </TableHead>
                <TableHead className="text-right">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('win_rate')}>
                        {t('factors.winRate')} {sortCol === 'win_rate' && <ArrowUpDown className="h-3 w-3" />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[220px]"><p className="text-xs">{t('factors.winRateTooltip')}</p></TooltipContent>
                  </Tooltip>
                </TableHead>
                <TableHead className="text-right">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 cursor-help">
                        {t('factors.decay')} <Info className="h-3 w-3" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[240px]"><p className="text-xs">{t('factors.decayTooltip')}</p></TooltipContent>
                  </Tooltip>
                </TableHead>
                <TableHead className="text-right">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center gap-1 cursor-help">
                        {t('factors.icTrend')} <Info className="h-3 w-3" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[280px]"><p className="text-xs">{t('factors.icTrendTooltip')}</p></TooltipContent>
                  </Tooltip>
                </TableHead>
                <TableHead className="text-right">{t('factors.samples')}</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mergedRows.map((row: any) => (
                <TableRow key={row._isCustom ? `custom-${row._customId}` : row.name}>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="font-medium cursor-help flex items-center gap-1">
                          {row._isCustom ? row.name : row.display_name}
                          <Info className="h-3 w-3 text-muted-foreground" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        {row._isCustom ? (
                          <p className="text-xs font-mono">{row._expression}</p>
                        ) : (
                          <>
                            {isZh && row.display_name_zh && <p className="text-xs font-medium mb-1">{row.display_name_zh}</p>}
                            <p className="text-xs">{getFactorDesc(row)}</p>
                            {row.value_range && (
                              <p className="text-xs text-muted-foreground mt-1">{t('factors.range')}: {row.value_range} {row.unit || ''}</p>
                            )}
                          </>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    {row._isCustom ? (
                      <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400 border-purple-500/30">
                        {t('factors.customTag')}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">{getCatLabel(row.category)}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {row.value != null ? row.value.toFixed(4) : '—'}
                  </TableCell>
                  <TableCell className="text-right">{icBadge(row.ic_mean)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {row.icir != null ? row.icir.toFixed(2) : '—'}
                  </TableCell>
                  <TableCell className="text-right">{wrBadge(row.win_rate)}</TableCell>
                  <TableCell className="text-right text-sm">
                    {row.decay_half_life != null ? (
                      row.decay_half_life === -1
                        ? <span className="text-blue-400 text-xs">{t('factors.persistent')}</span>
                        : <span className={`font-mono ${row.decay_half_life <= 4 ? 'text-red-400' : row.decay_half_life <= 12 ? 'text-yellow-500' : 'text-green-500'}`}>{row.decay_half_life}h</span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {row.ic_trend != null ? (
                      <span className={`font-mono ${row.ic_trend >= 1.2 ? 'text-green-500' : row.ic_trend >= 0.8 ? 'text-yellow-500' : 'text-red-400'}`}>
                        {row.ic_trend.toFixed(2)}x
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right text-sm">{row.sample_count ?? '—'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-0.5 justify-end">
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title={t('factors.analysis.title')}
                        onClick={() => { setAnalysisFactor({ name: row._isCustom ? row.name : row.name, displayName: row._isCustom ? row.name : (isZh && row.display_name_zh ? row.display_name_zh : row.display_name) }); setAnalysisOpen(true) }}>
                        <BarChart3 className="h-3 w-3" />
                      </Button>
                      {row._isCustom && (
                        <>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0"
                            onClick={() => openLabDialog(row._customId)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-500"
                            onClick={() => handleDeleteCustom(row._customId)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
      <FactorAnalysisDialog
        open={analysisOpen}
        onOpenChange={setAnalysisOpen}
        factorName={analysisFactor.name}
        displayName={analysisFactor.displayName}
        symbol={symbol}
        period={period}
        exchange={exchange}
        forwardPeriod={forwardPeriod}
      />
    </TooltipProvider>
  )
}
