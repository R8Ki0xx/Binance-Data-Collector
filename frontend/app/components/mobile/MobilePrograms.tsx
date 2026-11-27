import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { getProgramExecutions, ProgramExecutionLog } from '@/lib/api'
import { useTradingMode } from '@/contexts/TradingModeContext'
import { formatDateTime } from '@/lib/dateTime'
import ExchangeIcon from '@/components/exchange/ExchangeIcon'
import { ExchangeId, EXCHANGE_DISPLAY_NAMES } from '@/lib/types/exchange'

const formatDate = (value?: string | null) => formatDateTime(value, { style: 'short' })

export default function MobilePrograms() {
  const { t } = useTranslation()
  const { tradingMode } = useTradingMode()
  const [entries, setEntries] = useState<ProgramExecutionLog[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
  const [detailView, setDetailView] = useState<{ entry: ProgramExecutionLog; section: string } | null>(null)

  useEffect(() => {
    if (tradingMode === 'testnet' || tradingMode === 'mainnet') {
      loadEntries()
    }
  }, [tradingMode])

  const loadEntries = async () => {
    setLoading(true)
    try {
      const data = await getProgramExecutions({ environment: tradingMode as 'testnet' | 'mainnet', limit: 50 })
      setEntries(data || [])
    } catch (error) {
      console.error('Failed to load program executions:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleSection = (entryId: number, section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [`${entryId}-${section}`]: !prev[`${entryId}-${section}`]
    }))
  }

  const isSectionExpanded = (entryId: number, section: string) => {
    return !!expandedSections[`${entryId}-${section}`]
  }

  const getActionStyle = (action?: string | null) => {
    const a = (action || '').toUpperCase()
    if (a === 'BUY' || a === 'LONG') return 'bg-emerald-100 text-emerald-800'
    if (a === 'SELL' || a === 'SHORT') return 'bg-red-100 text-red-800'
    if (a === 'CLOSE') return 'bg-blue-100 text-blue-800'
    if (a === 'HOLD') return 'bg-gray-200 text-gray-800'
    return 'bg-orange-100 text-orange-800'
  }

  // Detail view for full content
  if (detailView) {
    const { entry, section } = detailView
    const mc = entry.market_context || {}
    let content = ''
    let title = ''

    if (section === 'inputData') {
      title = t('feed.inputData', 'Input Data')
      content = JSON.stringify(mc.input_data || {}, null, 2)
    } else if (section === 'dataQueries') {
      title = t('feed.dataQueries', 'Data Queries')
      content = JSON.stringify(mc.data_queries || [], null, 2)
    } else if (section === 'decision') {
      title = t('feed.decisionDetails', 'Decision Details')
      content = JSON.stringify(entry.decision_json || {}, null, 2)
    } else if (section === 'logs') {
      title = t('feed.executionLogs', 'Execution Logs')
      content = (mc.execution_logs || []).join('\n')
    }

    return (
      <div className="flex flex-col h-full pb-16">
        <div className="flex items-center gap-2 p-3 border-b">
          <Button variant="ghost" size="sm" onClick={() => setDetailView(null)} className="h-8 w-8 p-0">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <span className="font-medium text-sm">{title}</span>
        </div>
        <ScrollArea className="flex-1 p-3">
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
            {content || t('feed.noContent', 'No content available')}
          </pre>
        </ScrollArea>
      </div>
    )
  }

  // List view
  return (
    <div className="flex flex-col h-full pb-16">
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : tradingMode !== 'testnet' && tradingMode !== 'mainnet' ? (
        <div className="text-center text-muted-foreground py-8 px-4 text-sm">
          {t('dashboard.hyperliquidOnly', 'Only available in Hyperliquid mode')}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center text-muted-foreground py-8 px-4 text-sm">
          {t('programTrader.noExecutions', 'No program executions yet')}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {entries.map((entry) => (
              <ProgramCard
                key={entry.id}
                entry={entry}
                isExpanded={expandedId === entry.id}
                onToggle={() => {
                  if (expandedId === entry.id) {
                    setExpandedId(null)
                    setExpandedSections(prev => {
                      const next = { ...prev }
                      Object.keys(next).forEach(k => { if (k.startsWith(`${entry.id}-`)) delete next[k] })
                      return next
                    })
                  } else {
                    setExpandedId(entry.id)
                  }
                }}
                isSectionExpanded={isSectionExpanded}
                toggleSection={toggleSection}
                onViewDetail={(section) => setDetailView({ entry, section })}
                getActionStyle={getActionStyle}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

interface ProgramCardProps {
  entry: ProgramExecutionLog
  isExpanded: boolean
  onToggle: () => void
  isSectionExpanded: (entryId: number, section: string) => boolean
  toggleSection: (entryId: number, section: string) => void
  onViewDetail: (section: string) => void
  getActionStyle: (action?: string | null) => string
}

function ProgramCard({
  entry,
  isExpanded,
  onToggle,
  isSectionExpanded,
  toggleSection,
  onViewDetail,
  getActionStyle
}: ProgramCardProps) {
  const { t } = useTranslation()
  const mc = entry.market_context || {}

  return (
    <button
      type="button"
      className="w-full text-left border rounded bg-muted/30 p-3 space-y-2"
      onClick={onToggle}
    >
      {/* Header row - Python logo + Program name → AI Trader name */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5 rounded-full" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
            <path d="M508.416 3.584c-260.096 0-243.712 112.64-243.712 112.64l0.512 116.736h248.32v34.816H166.4S0 248.832 0 510.976s145.408 252.928 145.408 252.928h86.528v-121.856S227.328 496.64 374.784 496.64h246.272s138.24 2.048 138.24-133.632V139.776c-0.512 0 20.48-136.192-250.88-136.192zM371.712 82.432c24.576 0 44.544 19.968 44.544 44.544 0 24.576-19.968 44.544-44.544 44.544-24.576 0-44.544-19.968-44.544-44.544-0.512-24.576 19.456-44.544 44.544-44.544z" fill="#3773A5"/>
            <path d="M515.584 1022.464c260.096 0 243.712-112.64 243.712-112.64l-0.512-116.736H510.976V757.76h346.624s166.4 18.944 166.4-243.2-145.408-252.928-145.408-252.928h-86.528v121.856s4.608 145.408-142.848 145.408h-245.76s-138.24-2.048-138.24 133.632v224.768c0-0.512-20.992 135.168 250.368 135.168z m136.704-78.336c-24.576 0-44.544-19.968-44.544-44.544 0-24.576 19.968-44.544 44.544-44.544 24.576 0 44.544 19.968 44.544 44.544 0.512 24.576-19.456 44.544-44.544 44.544z" fill="#FFD731"/>
          </svg>
          <span className="font-semibold text-foreground">{entry.program_name}</span>
          <span className="text-muted-foreground">→</span>
          <span className="text-foreground">{entry.account_name}</span>
        </div>
        <span>{formatDate(entry.created_at)}</span>
      </div>

      {/* Action row */}
      <div className="flex items-center gap-2 text-sm flex-wrap">
        {entry.decision_action && (
          <span className={`px-2 py-0.5 rounded text-xs font-bold ${getActionStyle(entry.decision_action)}`}>
            {entry.decision_action.toUpperCase()}
          </span>
        )}
        {entry.decision_symbol && <span className="font-semibold text-xs">{entry.decision_symbol}</span>}
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800/80">
          <ExchangeIcon exchangeId={(entry.exchange || 'hyperliquid') as ExchangeId} size={12} />
          <span className="text-[10px] font-medium text-slate-200">
            {EXCHANGE_DISPLAY_NAMES[(entry.exchange || 'hyperliquid') as ExchangeId]}
          </span>
        </div>
        <span className={`px-2 py-0.5 rounded text-[10px] ${
          entry.trigger_type === 'signal' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'
        }`}>
          {entry.trigger_type === 'signal' ? t('feed.signalPoolTrigger', 'Signal Pool') : t('feed.scheduledTrigger', 'Scheduled')}
        </span>
        <span className={`px-2 py-0.5 rounded text-[10px] ${
          entry.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
        }`}>
          {entry.success ? t('common.success', 'Success') : t('common.failed', 'Failed')}
        </span>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span>{t('feed.equity', 'Equity')}: <span className="font-semibold text-foreground">
          ${(mc.input_data?.total_equity || 0).toFixed(2)}
        </span></span>
        <span>{t('feed.marginUsed', 'Margin')}: <span className="font-semibold text-foreground">
          {(mc.input_data?.margin_usage_percent || 0).toFixed(1)}%
        </span></span>
        <span>{t('feed.executed', 'Executed')}: <span className={`font-semibold ${entry.success ? 'text-emerald-600' : 'text-red-600'}`}>
          {entry.success ? 'YES' : 'NO'}
        </span></span>
      </div>

      {/* Reason preview */}
      {entry.decision_reason && (
        <div className="text-xs text-muted-foreground">
          {isExpanded ? entry.decision_reason : `${entry.decision_reason.slice(0, 100)}${entry.decision_reason.length > 100 ? '…' : ''}`}
        </div>
      )}

      {/* Click to expand hint */}
      {!isExpanded && (
        <div className="text-[11px] text-primary underline">
          {t('feed.clickExpand', 'Click to expand')}
        </div>
      )}

      {/* Expanded sections */}
      {isExpanded && (
        <ExpandedSections
          entry={entry}
          isSectionExpanded={isSectionExpanded}
          toggleSection={toggleSection}
          onViewDetail={onViewDetail}
        />
      )}
    </button>
  )
}

interface ExpandedSectionsProps {
  entry: ProgramExecutionLog
  isSectionExpanded: (entryId: number, section: string) => boolean
  toggleSection: (entryId: number, section: string) => void
  onViewDetail: (section: string) => void
}

function ExpandedSections({ entry, isSectionExpanded, toggleSection, onViewDetail }: ExpandedSectionsProps) {
  const { t } = useTranslation()
  const mc = entry.market_context || {}

  const sections = [
    { key: 'inputData', label: t('feed.inputData', 'Input Data'), content: mc.input_data },
    { key: 'dataQueries', label: t('feed.dataQueries', 'Data Queries'), content: mc.data_queries },
    { key: 'decision', label: t('feed.decisionDetails', 'Decision Details'), content: entry.decision_json },
    { key: 'logs', label: t('feed.executionLogs', 'Execution Logs'), content: mc.execution_logs },
  ]

  return (
    <div className="space-y-2 pt-2" onClick={e => e.stopPropagation()}>
      {/* Error message if failed */}
      {!entry.success && entry.error_message && (
        <div className="text-xs text-red-600 bg-red-50 rounded p-2">
          <span className="font-medium">{t('common.error', 'Error')}:</span> {entry.error_message}
        </div>
      )}

      {sections.map(({ key, label, content }) => {
        const open = isSectionExpanded(entry.id, key)
        const hasContent = content && (Array.isArray(content) ? content.length > 0 : Object.keys(content).length > 0)

        return (
          <div key={key} className="border rounded bg-background/60">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase text-muted-foreground"
              onClick={() => toggleSection(entry.id, key)}
            >
              <span className="flex items-center gap-2">
                <span>{open ? '▼' : '▶'}</span>
                {label}
              </span>
              <span className="text-[10px]">{open ? t('feed.hideDetails', 'Hide') : t('feed.showDetails', 'Show')}</span>
            </button>
            {open && (
              <div className="border-t bg-muted/40 px-3 py-2 text-xs">
                {hasContent ? (
                  <>
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] line-clamp-6">
                      {key === 'logs'
                        ? (content as string[]).slice(0, 5).join('\n')
                        : JSON.stringify(content, null, 2).slice(0, 500)
                      }
                    </pre>
                    <button
                      type="button"
                      className="mt-2 text-[10px] text-primary underline"
                      onClick={() => onViewDetail(key)}
                    >
                      {t('feed.viewFull', 'View full content')}
                    </button>
                  </>
                ) : (
                  <span className="text-muted-foreground">{t('feed.noContent', 'No content')}</span>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Click to collapse at bottom */}
      <div className="text-[11px] text-primary underline text-center pt-1">
        {t('feed.clickCollapse', 'Click to collapse')}
      </div>
    </div>
  )
}
