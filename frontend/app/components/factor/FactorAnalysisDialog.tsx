import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { apiRequest } from '@/lib/api'
import PacmanLoader from '@/components/ui/pacman-loader'
import { Sparkles } from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'

const FORWARD_PERIODS = ['1h', '4h', '12h', '24h']
const DAY_OPTIONS = [30, 60, 90, 0]  // 0 = All

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  factorName: string
  displayName: string
  symbol: string
  period: string
  exchange: string
  forwardPeriod: string
}

type Verdict = 'strong' | 'moderate' | 'weak' | 'ineffective'

function computeVerdict(history: any[], cumData: any[]): { verdict: Verdict; details: string[] } {
  if (history.length < 3) return { verdict: 'ineffective', details: ['insufficient_data'] }

  const recent = history.slice(-7)
  const avgIc = recent.reduce((s: number, h: any) => s + Math.abs(h.ic_mean || 0), 0) / recent.length
  const avgWr = recent.reduce((s: number, h: any) => s + (h.win_rate || 0), 0) / recent.length
  const cumEnd = cumData.length > 0 ? cumData[cumData.length - 1].cumIc : 0
  const cumMid = cumData.length > 5 ? cumData[Math.floor(cumData.length / 2)].cumIc : 0
  const cumRising = cumEnd > cumMid

  const details: string[] = []
  if (avgIc >= 0.05) details.push('strong_ic')
  else if (avgIc >= 0.02) details.push('moderate_ic')
  else details.push('weak_ic')

  if (avgWr >= 0.55) details.push('high_winrate')
  else if (avgWr >= 0.45) details.push('neutral_winrate')
  else details.push('low_winrate')

  if (cumRising) details.push('cum_rising')
  else details.push('cum_declining')

  let verdict: Verdict = 'ineffective'
  if (avgIc >= 0.05 && cumRising) verdict = 'strong'
  else if (avgIc >= 0.03 || (avgIc >= 0.02 && cumRising)) verdict = 'moderate'
  else if (avgIc >= 0.02) verdict = 'weak'

  return { verdict, details }
}

export default function FactorAnalysisDialog({
  open, onOpenChange, factorName, displayName,
  symbol, period, exchange, forwardPeriod,
}: Props) {
  const { t } = useTranslation()
  const [fp, setFp] = useState(forwardPeriod)
  const [days, setDays] = useState(30)
  const [history, setHistory] = useState<any[]>([])
  const [windows, setWindows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => { setFp(forwardPeriod) }, [forwardPeriod])

  useEffect(() => {
    if (!open || !factorName || !symbol) return
    setLoading(true)
    Promise.all([
      apiRequest(`/factors/effectiveness/${factorName}/history?symbol=${symbol}&period=${period}&forward_period=${fp}&exchange=${exchange}&days=${days || 9999}`).then(r => r.json()).catch(() => ({ history: [] })),
      apiRequest(`/factors/effectiveness/${factorName}/by-window?symbol=${symbol}&period=${period}&exchange=${exchange}`).then(r => r.json()).catch(() => ({ windows: [] })),
    ]).then(([histData, winData]) => {
      setHistory(histData.history || [])
      setWindows(winData.windows || [])
    }).finally(() => setLoading(false))
  }, [open, factorName, symbol, period, exchange, fp, days])

  const cumData = useMemo(() => history.reduce((acc: any[], item: any, i: number) => {
    const prev = i > 0 ? acc[i - 1].cumIc : 0
    acc.push({ ...item, cumIc: prev + (item.ic_mean || 0) })
    return acc
  }, []), [history])

  const { verdict, details } = useMemo(() => computeVerdict(history, cumData), [history, cumData])

  const verdictColor = { strong: 'text-green-400', moderate: 'text-yellow-400', weak: 'text-orange-400', ineffective: 'text-red-400' }
  const verdictBg = { strong: 'bg-green-500/10 border-green-500/30', moderate: 'bg-yellow-500/10 border-yellow-500/30', weak: 'bg-orange-500/10 border-orange-500/30', ineffective: 'bg-red-500/10 border-red-500/30' }

  const barColor = (ic: number) => {
    const abs = Math.abs(ic)
    if (abs >= 0.05) return '#22c55e'
    if (abs >= 0.02) return '#eab308'
    return '#6b7280'
  }

  const handleAskAi = () => {
    const prompt = t('factors.analysis.aiPrompt', {
      factor: displayName, symbol, fp,
      interpolation: { escapeValue: false },
    })
    localStorage.setItem('hyper-ai-pending-prompt', prompt)
    window.open(`${window.location.origin}/#hyper-ai`, '_blank')
  }

  const noData = !loading && history.length === 0 && windows.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {displayName}
            <Badge variant="outline" className="text-xs">{symbol}</Badge>
          </DialogTitle>
          <DialogDescription className="sr-only">{t('factors.analysis.title')}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-12"><PacmanLoader /></div>
        ) : noData ? (
          <p className="text-sm text-muted-foreground text-center py-12">{t('factors.noData')}</p>
        ) : (
          <div className="space-y-5">
            {/* Verdict banner */}
            <div className={`flex items-center justify-between rounded-lg border px-4 py-2.5 ${verdictBg[verdict]}`}>
              <div>
                <span className={`text-sm font-semibold ${verdictColor[verdict]}`}>
                  {t(`factors.analysis.verdict_${verdict}`)}
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {details.map(d => t(`factors.analysis.detail_${d}`)).join(' · ')}
                </p>
              </div>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleAskAi}>
                <Sparkles className="h-3 w-3" />
                {t('factors.analysis.askAi')}
              </Button>
            </div>

            {/* Controls row */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{t('factors.forwardPeriodLabel')}:</span>
                <Select value={fp} onValueChange={setFp}>
                  <SelectTrigger className="w-20 h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FORWARD_PERIODS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1">
                {DAY_OPTIONS.map(d => (
                  <Button key={d} variant={days === d ? 'default' : 'ghost'} size="sm"
                    className="h-6 px-2 text-xs" onClick={() => setDays(d)}>
                    {d === 0 ? 'All' : `${d}d`}
                  </Button>
                ))}
              </div>
            </div>

            {/* Chart 1: IC Time Series */}
            <section>
              <h4 className="text-xs font-medium text-muted-foreground mb-1">{t('factors.analysis.icTimeSeries')}</h4>
              <ResponsiveContainer width="100%" height={170}>
                <LineChart data={history} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toFixed(3)} />
                  <RTooltip
                    contentStyle={{ background: '#1a1a2e', border: '1px solid #333', fontSize: 12 }}
                    labelStyle={{ color: '#9ca3af' }}
                    itemStyle={{ color: '#e5e7eb' }}
                    formatter={(v: number) => [v?.toFixed(4), 'IC']}
                  />
                  <ReferenceLine y={0.05} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.5} />
                  <ReferenceLine y={-0.05} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.5} />
                  <ReferenceLine y={0} stroke="#555" />
                  <Line type="monotone" dataKey="ic_mean" stroke="#60a5fa" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </section>

            {/* Chart 2: Cumulative IC */}
            <section>
              <h4 className="text-xs font-medium text-muted-foreground mb-1">{t('factors.analysis.cumulativeIc')}</h4>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={cumData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toFixed(2)} />
                  <RTooltip
                    contentStyle={{ background: '#1a1a2e', border: '1px solid #333', fontSize: 12 }}
                    labelStyle={{ color: '#9ca3af' }}
                    itemStyle={{ color: '#e5e7eb' }}
                    formatter={(v: number) => [v?.toFixed(4), 'Cumulative IC']}
                  />
                  <ReferenceLine y={0} stroke="#555" />
                  <Line type="monotone" dataKey="cumIc" stroke={cumData.length > 0 && cumData[cumData.length - 1].cumIc >= 0 ? '#22c55e' : '#ef4444'} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
              <p className="text-[10px] text-muted-foreground mt-1">{t('factors.analysis.cumulativeIcHint')}</p>
            </section>

            {/* Chart 3: IC by Forward Period */}
            <section>
              <h4 className="text-xs font-medium text-muted-foreground mb-1">{t('factors.analysis.icByWindow')}</h4>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart data={windows} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="forward_period" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v.toFixed(3)} />
                  <RTooltip
                    contentStyle={{ background: '#1a1a2e', border: '1px solid #333', fontSize: 12 }}
                    labelStyle={{ color: '#9ca3af' }}
                    itemStyle={{ color: '#e5e7eb' }}
                    formatter={(v: number, name: string) => {
                      if (name === 'ic_mean') return [v?.toFixed(4), 'IC']
                      return [v, name]
                    }}
                  />
                  <ReferenceLine y={0} stroke="#555" />
                  <Bar dataKey="ic_mean" radius={[4, 4, 0, 0]}>
                    {windows.map((w: any, i: number) => (
                      <Cell key={i} fill={barColor(w.ic_mean || 0)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="text-[10px] text-muted-foreground mt-1">{t('factors.analysis.icByWindowHint')}</p>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
