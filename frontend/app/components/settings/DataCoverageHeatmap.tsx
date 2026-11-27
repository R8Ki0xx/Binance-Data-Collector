import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface CoverageItem {
  date: string
  pct: number
}

interface SymbolCoverage {
  symbol: string
  days: number
  coverage: CoverageItem[]
  exchange: string
  data_type: string
}

interface DataCoverageHeatmapProps {
  exchange?: string
  dataType?: 'market_flow' | 'klines'
  title?: string
}

export default function DataCoverageHeatmap({
  exchange = 'hyperliquid',
  dataType = 'market_flow',
  title,
}: DataCoverageHeatmapProps) {
  const { t } = useTranslation()
  const [symbols, setSymbols] = useState<string[]>([])
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [coverage, setCoverage] = useState<CoverageItem[]>([])
  const [symbolsLoading, setSymbolsLoading] = useState(true)
  const [coverageLoading, setCoverageLoading] = useState(false)
  const [days, setDays] = useState(365)

  // Fetch available symbols when exchange or dataType changes
  useEffect(() => {
    const fetchSymbols = async () => {
      setSymbolsLoading(true)
      setSelectedSymbol(null)
      setCoverage([])
      try {
        const res = await fetch(
          `/api/system/data-coverage?days=365&exchange=${exchange}&data_type=${dataType}`
        )
        if (res.ok) {
          const data = await res.json()
          setSymbols(data.symbols || [])
          if (data.symbols?.length > 0) {
            setSelectedSymbol(data.symbols[0])
          }
        }
      } catch (err) {
        console.error('Failed to fetch symbols:', err)
      } finally {
        setSymbolsLoading(false)
      }
    }
    fetchSymbols()
  }, [exchange, dataType])

  // Fetch coverage when symbol changes
  useEffect(() => {
    if (!selectedSymbol) return
    const fetchCoverage = async () => {
      setCoverageLoading(true)
      try {
        const tzOffset = new Date().getTimezoneOffset()
        const res = await fetch(
          `/api/system/data-coverage?days=${days}&symbol=${selectedSymbol}&tz_offset=${tzOffset}&exchange=${exchange}&data_type=${dataType}`
        )
        if (res.ok) {
          const data: SymbolCoverage = await res.json()
          setCoverage(data.coverage || [])
        }
      } catch (err) {
        console.error('Failed to fetch coverage:', err)
      } finally {
        setCoverageLoading(false)
      }
    }
    fetchCoverage()
  }, [selectedSymbol, days, exchange, dataType])

  const getCellColor = (pct: number) => {
    if (pct === 0) return 'bg-[#dbdbdb]'
    if (pct < 50) return 'bg-red-500/70'
    if (pct < 80) return 'bg-yellow-500/70'
    if (pct < 95) return 'bg-emerald-500/70'
    return 'bg-emerald-600'
  }

  if (symbolsLoading) {
    return <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</div>
  }

  if (symbols.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        {t('settings.noDataCollected', 'No data collected yet')}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {title && <div className="text-sm font-medium">{title}</div>}
      {/* Symbol tabs + Days selector + Legend */}
      <div className="flex items-center gap-2 flex-wrap justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          {symbols.map((sym) => (
            <button
              key={sym}
              onClick={() => setSelectedSymbol(sym)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                selectedSymbol === sym
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/80 text-muted-foreground'
              }`}
            >
              {sym}
            </button>
          ))}
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="border rounded px-2 py-1 text-sm bg-background ml-2"
          >
            <option value={30}>30 {t('settings.days', 'days')}</option>
            <option value={60}>60 {t('settings.days', 'days')}</option>
            <option value={90}>90 {t('settings.days', 'days')}</option>
            <option value={180}>180 {t('settings.days', 'days')}</option>
            <option value={365}>365 {t('settings.days', 'days')}</option>
          </select>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-[#dbdbdb]" />
            <span>0%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-red-500/70" />
            <span>&lt;50%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-yellow-500/70" />
            <span>50-80%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-emerald-500/70" />
            <span>80-95%</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-emerald-600" />
            <span>&gt;95%</span>
          </div>
        </div>
      </div>

      {/* Heatmap grid */}
      {coverageLoading ? (
        <div className="text-sm text-muted-foreground">{t('common.loading', 'Loading...')}</div>
      ) : (
        <div className="flex flex-wrap gap-[2px]">
          {coverage.map((item) => (
            <div
              key={item.date}
              className={`w-7 h-7 rounded-sm ${getCellColor(item.pct)} cursor-default
                hover:scale-125 hover:ring-2 hover:ring-foreground hover:z-10
                transition-transform relative group`}
            >
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1
                bg-popover text-popover-foreground text-xs rounded shadow-lg border
                opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-20">
                {item.date}: {item.pct}%
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}