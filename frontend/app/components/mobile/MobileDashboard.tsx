import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Loader2 } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ArenaPositionsAccount,
  ArenaTrade,
  checkPnlSyncStatus,
  getArenaPositions,
  getArenaTrades,
  updateArenaPnl,
} from '@/lib/api'
import { useTradingMode } from '@/contexts/TradingModeContext'
import { getModelLogo } from '@/components/portfolio/logoAssets'
import PositionsSection from './MobilePositionsSection'
import TradesSection from './MobileTradesSection'
import ExchangeIcon from '@/components/exchange/ExchangeIcon'
import { ExchangeId, EXCHANGE_DISPLAY_NAMES } from '@/lib/types/exchange'

export default function MobileDashboard() {
  const { t } = useTranslation()
  const { tradingMode } = useTradingMode()
  // Use composite key: "account_id:exchange" or "all"
  const [selectedKey, setSelectedKey] = useState<string>('all')
  const [positions, setPositions] = useState<ArenaPositionsAccount[]>([])
  const [trades, setTrades] = useState<ArenaTrade[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingPnl, setUpdatingPnl] = useState(false)
  const [showPnlConfirm, setShowPnlConfirm] = useState(false)
  const [pnlResult, setPnlResult] = useState<string | null>(null)
  const [needsSync, setNeedsSync] = useState(false)
  const [unsyncCount, setUnsyncCount] = useState(0)

  const refreshPnlSyncStatus = async () => {
    if (tradingMode !== 'testnet' && tradingMode !== 'mainnet') {
      setNeedsSync(false)
      setUnsyncCount(0)
      return
    }

    try {
      const status = await checkPnlSyncStatus(tradingMode)
      setNeedsSync(status.needs_sync)
      setUnsyncCount(status.unsync_count)
    } catch (error) {
      console.error('Failed to check PnL sync status:', error)
    }
  }

  useEffect(() => {
    if (tradingMode === 'testnet' || tradingMode === 'mainnet') {
      loadData()
      refreshPnlSyncStatus()
    }
  }, [tradingMode])

  const loadData = async () => {
    setLoading(true)
    try {
      const [positionsRes, tradesRes] = await Promise.all([
        getArenaPositions({ trading_mode: tradingMode }),
        getArenaTrades({ trading_mode: tradingMode, limit: 50 }),
      ])
      setPositions(positionsRes.accounts || [])
      setTrades(tradesRes.trades || [])
    } catch (error) {
      console.error('Failed to load dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleUpdatePnl = async () => {
    setUpdatingPnl(true)
    setPnlResult(null)
    try {
      const result = await updateArenaPnl()
      if (result.success) {
        setPnlResult(t('feed.pnlUpdated', 'PnL data updated'))
        await refreshPnlSyncStatus()
        loadData()
      } else {
        setPnlResult(result.errors?.[0] || t('feed.pnlUpdateFailed', 'Failed to update PnL'))
      }
    } catch (error) {
      setPnlResult(t('feed.pnlUpdateFailed', 'Failed to update PnL'))
    } finally {
      setUpdatingPnl(false)
    }
  }

  // Build account options with composite key (account_id:exchange)
  const accountOptions = positions.map(p => ({
    key: `${p.account_id}:${p.exchange || 'hyperliquid'}`,
    id: p.account_id,
    name: p.account_name,
    exchange: (p.exchange || 'hyperliquid') as ExchangeId
  }))

  // Parse selected key to get account_id and exchange
  const parseKey = (key: string) => {
    if (key === 'all') return { accountId: null, exchange: null }
    const [accountId, exchange] = key.split(':')
    return { accountId: Number(accountId), exchange }
  }

  const { accountId: selectedAccountId, exchange: selectedExchange } = parseKey(selectedKey)

  const filteredPositions = selectedKey === 'all'
    ? positions
    : positions.filter(p => p.account_id === selectedAccountId && (p.exchange || 'hyperliquid') === selectedExchange)

  const filteredTrades = selectedKey === 'all'
    ? trades
    : trades.filter(t => t.account_id === selectedAccountId && (t.exchange || 'hyperliquid') === selectedExchange)

  const selectedOption = accountOptions.find(a => a.key === selectedKey)
  const selectedAccountName = selectedKey === 'all'
    ? t('feed.allTraders', 'All Traders')
    : selectedOption
      ? `${selectedOption.name} (${EXCHANGE_DISPLAY_NAMES[selectedOption.exchange]})`
      : 'Unknown'

  if (tradingMode !== 'testnet' && tradingMode !== 'mainnet') {
    return (
      <div className="flex items-center justify-center h-full pb-16 text-muted-foreground text-sm">
        {t('dashboard.hyperliquidOnly', 'Only available in Hyperliquid mode')}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full pb-16">
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-3">
          {/* Filter Dropdown */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              {t('feed.accountSummary', 'Account Summary')}
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  {selectedAccountName}
                  <ChevronDown className="ml-1 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSelectedKey('all')}>
                  {t('feed.allTraders', 'All Traders')}
                </DropdownMenuItem>
                {accountOptions.map(acc => (
                  <DropdownMenuItem key={acc.key} onClick={() => setSelectedKey(acc.key)}>
                    <div className="flex items-center gap-2">
                      <span>{acc.name}</span>
                      <ExchangeIcon exchangeId={acc.exchange} size={12} />
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Account Summary Cards - One per Trader */}
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filteredPositions.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">
              {t('feed.noAccounts', 'No accounts found')}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredPositions.map(account => (
                <AccountSummaryCard key={`${account.account_id}:${account.exchange || 'hyperliquid'}`} account={account} />
              ))}
            </div>
          )}

          {/* Positions Section */}
          <PositionsSection positions={filteredPositions} selectedAccount={selectedKey === 'all' ? 'all' : selectedAccountId!} loading={loading} />

          {/* Trades Section */}
          <TradesSection
            trades={filteredTrades}
            selectedAccount={selectedKey === 'all' ? 'all' : selectedAccountId!}
            loading={loading}
            needsSync={needsSync}
            unsyncCount={unsyncCount}
            updatingPnl={updatingPnl}
            showPnlConfirm={showPnlConfirm}
            setShowPnlConfirm={setShowPnlConfirm}
            handleUpdatePnl={handleUpdatePnl}
            pnlResult={pnlResult}
          />
        </div>
      </ScrollArea>
    </div>
  )
}

function AccountSummaryCard({ account }: { account: ArenaPositionsAccount }) {
  const { t } = useTranslation()
  const logo = getModelLogo(account.account_name)
  const marginUsage = account.margin_usage_percent || 0
  const exchange = (account.exchange || 'hyperliquid') as ExchangeId

  return (
    <div className="border rounded-lg bg-card p-3">
      <div className="flex items-center gap-2 mb-2">
        {logo && <img src={logo.src} alt={logo.alt} className="h-5 w-5 rounded-full" />}
        <span className="text-sm font-semibold">{account.account_name}</span>
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800/80">
          <ExchangeIcon exchangeId={exchange} size={12} />
          <span className="text-[10px] font-medium text-slate-200">
            {EXCHANGE_DISPLAY_NAMES[exchange]}
          </span>
        </div>
        {account.environment && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase">
            {account.environment}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-muted-foreground">{t('feed.totalEquity', 'Total Equity')}</span>
          <div className="font-semibold">${account.total_assets?.toFixed(2) || '0.00'}</div>
        </div>
        <div>
          <span className="text-muted-foreground">{t('feed.unrealizedPnl', 'Unrealized PnL')}</span>
          <div className={`font-semibold ${account.total_unrealized_pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            ${account.total_unrealized_pnl?.toFixed(2) || '0.00'}
          </div>
        </div>
        <div>
          <span className="text-muted-foreground">{t('feed.availableCash', 'Available Cash')}</span>
          <div className="font-semibold">${account.available_cash?.toFixed(2) || '0.00'}</div>
        </div>
        <div>
          <span className="text-muted-foreground">{t('feed.marginUsage', 'Margin Usage')}</span>
          <div className={`font-semibold ${marginUsage >= 75 ? 'text-red-600' : marginUsage >= 50 ? 'text-amber-600' : 'text-emerald-600'}`}>
            {marginUsage.toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  )
}
