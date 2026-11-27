/**
 * HyperliquidView - Hyperliquid Trading Mode Main View
 *
 * ARCHITECTURE:
 * - This component is the ACTIVE container for Hyperliquid mode (testnet/mainnet)
 * - Uses HyperliquidAssetChart for asset curve visualization with multi-account support
 * - Uses HyperliquidMultiAccountSummary for multi-account summary display
 * - Uses AlphaArenaFeed for real-time trading feed
 *
 * DO NOT CONFUSE WITH:
 * - ComprehensiveView: Legacy paper trading component (deprecated, kept for reference)
 * - AssetCurveWithData: Paper mode chart component (NOT used here)
 *
 * CURRENT STATUS: Active production component for multi-wallet Hyperliquid architecture
 */
import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useTradingMode } from '@/contexts/TradingModeContext'
import { getArenaPositions, getArenaTrades, getAccounts, ArenaTrade, TradingAccount } from '@/lib/api'
import AlphaArenaFeed from '@/components/portfolio/AlphaArenaFeed'
import HyperliquidMultiAccountSummary from '@/components/portfolio/HyperliquidMultiAccountSummary'
import HyperliquidAssetChart, { TradeMarker } from './HyperliquidAssetChart'
import ArenaView from '@/components/arena/ArenaView'
import ViewToggle, { type ViewMode, getStoredViewMode } from '@/components/arena/ViewToggle'
import DashboardInsightView from './DashboardInsightView'

interface HyperliquidViewProps {
  wsRef?: React.MutableRefObject<WebSocket | null>
  refreshKey?: number
  onPageChange?: (page: string) => void
}

interface ArenaActivitySignal {
  seq: number
  exchange: string
  state: 'program_running' | 'ai_thinking'
}

export default function HyperliquidView({ wsRef, refreshKey = 0, onPageChange }: HyperliquidViewProps) {
  const { t } = useTranslation()
  const { tradingMode } = useTradingMode()
  const [loading, setLoading] = useState(true)
  const [positionsData, setPositionsData] = useState<any>(null)
  const [chartRefreshKey, setChartRefreshKey] = useState(0)
  const [selectedAccount, setSelectedAccount] = useState<number | 'all'>('all')
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [selectedExchange, setSelectedExchange] = useState<'all' | 'hyperliquid' | 'binance'>('all')
  const [tradeMarkers, setTradeMarkers] = useState<TradeMarker[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>(getStoredViewMode)
  const [fullAccounts, setFullAccounts] = useState<TradingAccount[]>([])
  const [activitySignals, setActivitySignals] = useState<Record<number, ArenaActivitySignal>>({})
  const activitySeqRef = useRef(0)
  const environment = tradingMode === 'testnet' || tradingMode === 'mainnet' ? tradingMode : undefined

  // Load data from APIs
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        const [positions, tradesRes, accountsList] = await Promise.all([
          getArenaPositions({ trading_mode: tradingMode }),
          getArenaTrades({ trading_mode: tradingMode, limit: 200 }),
          getAccounts()
        ])
        setPositionsData(positions)
        setFullAccounts(accountsList)
        // Convert trades to TradeMarker format
        const markers: TradeMarker[] = (tradesRes.trades || []).map((t: ArenaTrade) => ({
          trade_id: t.trade_id,
          trade_time: t.trade_time || '',
          side: t.side,
          symbol: t.symbol,
          account_id: t.account_id,
          price: t.price,
          exchange: t.exchange || 'hyperliquid'
        }))
        setTradeMarkers(markers)
      } catch (error) {
        console.error('Failed to load Hyperliquid data:', error)
      } finally {
        setChartRefreshKey(prev => prev + 1)
        setLoading(false)
      }
    }

    loadData()
  }, [tradingMode, refreshKey])

  const handleArenaActivity = (activity: {
    accountId: number
    exchange: string
    state: 'program_running' | 'ai_thinking'
  }) => {
    activitySeqRef.current += 1
    setActivitySignals(prev => ({
      ...prev,
      [activity.accountId]: {
        seq: activitySeqRef.current,
        exchange: activity.exchange || 'hyperliquid',
        state: activity.state,
      },
    }))
  }

  // Extract account list for multi-account summary
  const accounts = positionsData?.accounts?.map((acc: any) => ({
    account_id: acc.account_id,
    account_name: acc.account_name,
    exchange: acc.exchange || 'hyperliquid',
  })) || []

  // Extract all positions with account_id and exchange for the summary component
  const allPositions = positionsData?.accounts?.flatMap((acc: any) =>
    (acc.positions || []).map((pos: any) => ({
      symbol: pos.symbol,
      side: pos.side,
      size: pos.quantity,
      entry_price: pos.avg_cost,
      mark_price: pos.current_price,
      unrealized_pnl: pos.unrealized_pnl,
      leverage: pos.leverage || 1,
      account_id: acc.account_id,
      exchange: acc.exchange || 'hyperliquid',
    }))
  ) || []

  const firstAccountId = accounts[0]?.account_id

  if (loading && !positionsData) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground">{t('dashboard.loadingData', 'Loading Hyperliquid data...')}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col md:grid md:gap-6 md:grid-cols-[minmax(0,1fr)_minmax(320px,600px)] h-full min-h-0 gap-4 pb-16 md:pb-0 overflow-y-auto md:overflow-hidden">
      {/* Left Panel - Arena or Chart & Account Summary */}
      <div className="min-w-0 flex flex-col gap-4 min-h-0">
        {/* View mode toggle */}
        <div className="flex items-center justify-between">
          <ViewToggle mode={viewMode} onChange={setViewMode} />
        </div>

        {viewMode === 'arena' ? (
          /* Arena Mode — pixel trading floor */
          <div className="flex-1 min-h-[280px]">
            <ArenaView
              accounts={accounts.map(acc => {
                const full = fullAccounts.find(f => f.id === acc.account_id)
                return {
                  account_id: acc.account_id,
                  account_name: acc.account_name,
                  exchange: acc.exchange,
                  auto_trading_enabled: full?.auto_trading_enabled,
                  avatar_preset_id: full?.avatar_preset_id,
                }
              })}
              positions={allPositions}
              accountBalances={accounts.map(acc => {
                const posAcc = positionsData?.accounts?.find(
                  (a: any) => a.account_id === acc.account_id &&
                    (a.exchange || 'hyperliquid') === (acc.exchange || 'hyperliquid')
                )
                return {
                  accountId: acc.account_id,
                  accountName: acc.account_name,
                  exchange: acc.exchange || 'hyperliquid',
                  balance: posAcc ? {
                    totalEquity: posAcc.total_assets || 0,
                    marginUsagePercent: posAcc.margin_usage_percent || 0,
                  } : null,
                  error: null,
                }
              })}
              environment={environment || 'testnet'}
              activitySignals={activitySignals}
            />
          </div>
        ) : viewMode === 'chart' ? (
          /* Chart Mode — existing chart + account summary */
          <>
            <div className="flex-1 min-h-[250px] md:min-h-[320px]">
              {positionsData?.accounts?.length > 0 ? (
                <HyperliquidAssetChart
                  accountId={firstAccountId}
                  refreshTrigger={chartRefreshKey}
                  environment={environment}
                  selectedAccount={selectedAccount}
                  trades={tradeMarkers}
                  selectedSymbol={selectedSymbol}
                  selectedExchange={selectedExchange}
                />
              ) : (
                <div className="bg-card border border-border rounded-lg h-full flex items-center justify-center">
                  <div className="text-muted-foreground">{t('dashboard.noAccountConfigured', 'No Hyperliquid account configured')}</div>
                </div>
              )}
            </div>
            <div className="rounded-xl border text-card-foreground shadow p-4 md:p-6 space-y-4 md:space-y-6">
              <HyperliquidMultiAccountSummary
                accounts={accounts}
                refreshKey={refreshKey + chartRefreshKey}
                selectedAccount={selectedAccount}
                positions={allPositions}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 min-h-[320px]">
            <DashboardInsightView />
          </div>
        )}
      </div>

      {/* Right Panel - Feed (hidden on mobile) */}
      <div className="hidden md:flex flex-col min-h-0 w-full max-w-[600px] justify-self-end">
        <div className="flex-1 min-h-0 w-full border border-border rounded-lg bg-card shadow-sm px-4 py-3 flex flex-col">
          <AlphaArenaFeed
            wsRef={wsRef}
            selectedAccount={selectedAccount}
            onSelectedAccountChange={setSelectedAccount}
            onSelectedSymbolChange={setSelectedSymbol}
            onSelectedExchangeChange={setSelectedExchange}
            onPageChange={onPageChange}
            onArenaActivity={handleArenaActivity}
          />
        </div>
      </div>
    </div>
  )
}
