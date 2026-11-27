import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, TrendingUp, AlertTriangle, Info } from 'lucide-react'
import { getWalletRateLimit, getTradingStats, getBinanceTradingStats, TradingStats, getBinanceRateLimit } from '@/lib/hyperliquidApi'
import { setCachedData, getCachedData, getCacheTimestamp, getApiUsageCacheKey, getTradingStatsCacheKey } from '@/lib/cacheUtils'
import { formatDateTime } from '@/lib/dateTime'
import type { HyperliquidBalance } from '@/lib/types/hyperliquid'
import type { HyperliquidEnvironment } from '@/lib/types/hyperliquid'
import type { Position } from './HyperliquidMultiAccountSummary'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

interface RateLimitData {
  cumVlm: number
  nRequestsUsed: number
  nRequestsCap: number
  remaining: number
  usagePercent: number
  isOverLimit: boolean
}

interface AccountData {
  accountId: number
  accountName: string
  exchange: string
  balance: HyperliquidBalance | null
  rateLimit: RateLimitData | null
  rateLimitUpdated: number | null
  tradingStats: TradingStats | null
  tradingStatsUpdated: number | null
}

interface TraderDetailModalProps {
  isOpen: boolean
  onClose: () => void
  account: AccountData
  positions: Position[]
  environment: HyperliquidEnvironment
}

export default function TraderDetailModal({
  isOpen,
  onClose,
  account,
  positions,
  environment,
}: TraderDetailModalProps) {
  const { t } = useTranslation()
  // Initialize state from props (which already contain cached data)
  const [rateLimit, setRateLimit] = useState<RateLimitData | null>(account.rateLimit)
  const [rateLimitUpdated, setRateLimitUpdated] = useState<number | null>(account.rateLimitUpdated)
  const [tradingStats, setTradingStats] = useState<TradingStats | null>(account.tradingStats)
  const [tradingStatsUpdated, setTradingStatsUpdated] = useState<number | null>(account.tradingStatsUpdated)
  const [refreshingRateLimit, setRefreshingRateLimit] = useState(false)
  const [refreshingStats, setRefreshingStats] = useState(false)

  const isBinance = (account.exchange || 'hyperliquid') === 'binance'
  const accountExchange = account.exchange || 'hyperliquid'

  // When modal opens, read latest data from cache (fixes stale data after refresh)
  useEffect(() => {
    if (isOpen) {
      // Read from cache first (may have been updated by previous refresh)
      const cachedRateLimit = getCachedData<RateLimitData>(getApiUsageCacheKey(account.accountId, environment, accountExchange))
      const cachedStats = getCachedData<TradingStats>(getTradingStatsCacheKey(account.accountId, environment, accountExchange))

      setRateLimit(cachedRateLimit || account.rateLimit)
      setRateLimitUpdated(cachedRateLimit ? getCacheTimestamp(getApiUsageCacheKey(account.accountId, environment, accountExchange)) : account.rateLimitUpdated)
      setTradingStats(cachedStats || account.tradingStats)
      setTradingStatsUpdated(cachedStats ? getCacheTimestamp(getTradingStatsCacheKey(account.accountId, environment, accountExchange)) : account.tradingStatsUpdated)
    }
  }, [isOpen, account.accountId, environment, accountExchange])

  // Refresh API Usage
  const handleRefreshRateLimit = async () => {
    setRefreshingRateLimit(true)
    try {
      if (isBinance) {
        const res = await getBinanceRateLimit(account.accountId)
        if (res.success && res.rate_limit) {
          const rl: RateLimitData = {
            cumVlm: 0,
            nRequestsUsed: res.rate_limit.used_weight,
            nRequestsCap: res.rate_limit.weight_cap,
            remaining: res.rate_limit.remaining,
            usagePercent: res.rate_limit.usage_percent,
            isOverLimit: res.rate_limit.usage_percent >= 100,
          }
          setRateLimit(rl)
          setRateLimitUpdated(Date.now())
          setCachedData(getApiUsageCacheKey(account.accountId, environment, accountExchange), rl)
          toast.success('API weight updated')
        }
      } else {
        const res = await getWalletRateLimit(account.accountId, environment)
        if (res.success && res.rateLimit) {
          setRateLimit(res.rateLimit)
          setRateLimitUpdated(Date.now())
          setCachedData(getApiUsageCacheKey(account.accountId, environment, accountExchange), res.rateLimit)
          toast.success('API usage updated')
        }
      }
    } catch (e) {
      toast.error('Failed to refresh API usage')
    } finally {
      setRefreshingRateLimit(false)
    }
  }

  // Refresh Trading Stats
  const handleRefreshStats = async () => {
    setRefreshingStats(true)
    try {
      const res = isBinance
        ? await getBinanceTradingStats(account.accountId, environment)
        : await getTradingStats(account.accountId, environment)
      if (res.success && res.stats) {
        setTradingStats(res.stats)
        setTradingStatsUpdated(Date.now())
        setCachedData(getTradingStatsCacheKey(account.accountId, environment, accountExchange), res.stats)
        toast.success('Trading stats updated')
      }
    } catch (e) {
      toast.error('Failed to refresh trading stats')
    } finally {
      setRefreshingStats(false)
    }
  }

  const getUsageColor = (percent: number) => {
    if (percent >= 90) return 'text-red-600'
    if (percent >= 70) return 'text-yellow-600'
    return 'text-green-600'
  }

  const getUsageBarColor = (percent: number) => {
    if (percent >= 90) return 'bg-red-500'
    if (percent >= 70) return 'bg-yellow-500'
    return 'bg-green-500'
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{account.accountName} - {t('accountDetail.details', 'Details')}</span>
            <img
              src={isBinance ? '/static/binance_logo.svg' : '/static/hyperliquid_logo.svg'}
              alt={isBinance ? 'Binance' : 'Hyperliquid'}
              className="h-4 w-4"
            />
            <Badge variant={environment === 'testnet' ? 'default' : 'destructive'} className="uppercase text-xs">
              {environment}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Account Status Section */}
          {account.balance && (
            <AccountStatusSection balance={account.balance} isBinance={isBinance} t={t} />
          )}

          {/* API Usage Section */}
          <ApiUsageSection
            rateLimit={rateLimit}
            rateLimitUpdated={rateLimitUpdated}
            refreshing={refreshingRateLimit}
            onRefresh={handleRefreshRateLimit}
            getUsageColor={getUsageColor}
            getUsageBarColor={getUsageBarColor}
            isBinance={isBinance}
            t={t}
          />

          {/* Trading Stats Section */}
          <TradingStatsSection
            stats={tradingStats}
            statsUpdated={tradingStatsUpdated}
            refreshing={refreshingStats}
            onRefresh={handleRefreshStats}
            t={t}
          />

          {/* Positions Section */}
          <PositionsSection positions={positions} t={t} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Account Status Section
function AccountStatusSection({ balance, isBinance, t }: { balance: HyperliquidBalance; isBinance: boolean; t: any }) {
  return (
    <div className="border rounded-lg p-4">
      <h3 className="text-sm font-semibold mb-3">{t('accountDetail.accountStatus', 'Account Status')}</h3>
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <div className="text-muted-foreground text-xs">{t('accountDetail.totalEquity', 'Total Equity')}</div>
          <div className="font-bold">${balance.totalEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">{t('accountDetail.available', 'Available')}</div>
          <div className="font-medium text-green-600">${balance.availableBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">{t('accountDetail.usedMargin', 'Used Margin')}</div>
          <div className="font-medium">${balance.usedMargin.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
        </div>
      </div>
      {!isBinance && balance.walletAddress && (
        <div className="mt-3 pt-3 border-t">
          <div className="text-muted-foreground text-xs">{t('accountDetail.wallet', 'Wallet')}</div>
          <div className="font-mono text-xs">{balance.walletAddress}</div>
        </div>
      )}
    </div>
  )
}

// API Usage Section
function ApiUsageSection({
  rateLimit,
  rateLimitUpdated,
  refreshing,
  onRefresh,
  getUsageColor,
  getUsageBarColor,
  isBinance,
  t,
}: {
  rateLimit: RateLimitData | null
  rateLimitUpdated: number | null
  refreshing: boolean
  onRefresh: () => void
  getUsageColor: (p: number) => string
  getUsageBarColor: (p: number) => string
  isBinance: boolean
  t: any
}) {
  return (
    <div className="border rounded-lg p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">
          {isBinance ? t('accountDetail.apiWeight', 'API Weight (per minute)') : t('accountDetail.apiUsage', 'API Usage')}
        </h3>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={`w-3 h-3 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
          {t('common.refresh', 'Refresh')}
        </Button>
      </div>

      {rateLimit ? (
        <div className="space-y-3">
          {isBinance ? (
            <BinanceApiUsageContent
              rateLimit={rateLimit}
              getUsageColor={getUsageColor}
              getUsageBarColor={getUsageBarColor}
              t={t}
            />
          ) : (
            <HyperliquidApiUsageContent
              rateLimit={rateLimit}
              getUsageColor={getUsageColor}
              getUsageBarColor={getUsageBarColor}
              t={t}
            />
          )}

          {rateLimitUpdated && (
            <div className="text-xs text-muted-foreground text-right">
              {t('accountDetail.lastUpdated', 'Last updated')}: {formatDateTime(new Date(rateLimitUpdated))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">{t('accountDetail.clickRefreshApi', 'Click Refresh to load API usage data')}</div>
      )}
    </div>
  )
}

// Binance API Weight content
function BinanceApiUsageContent({
  rateLimit, getUsageColor, getUsageBarColor, t,
}: {
  rateLimit: RateLimitData
  getUsageColor: (p: number) => string
  getUsageBarColor: (p: number) => string
  t: any
}) {
  return (
    <>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-muted-foreground text-xs">{t('accountDetail.weightUsed', 'Weight Used')}</div>
          <div className="font-bold">{rateLimit.nRequestsUsed.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">{t('accountDetail.weightCap', 'Weight Cap')}</div>
          <div className="font-medium">{rateLimit.nRequestsCap.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">{t('accountDetail.remaining', 'Remaining')}</div>
          <div className={`font-bold ${getUsageColor(rateLimit.usagePercent)}`}>
            {rateLimit.remaining.toLocaleString()}
          </div>
        </div>
      </div>
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">{t('accountDetail.usage', 'Usage')}</span>
          <span className={getUsageColor(rateLimit.usagePercent)}>{rateLimit.usagePercent.toFixed(1)}%</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            className={`h-full rounded-full ${getUsageBarColor(rateLimit.usagePercent)}`}
            style={{ width: `${Math.min(rateLimit.usagePercent, 100)}%` }}
          />
        </div>
      </div>
      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded p-3">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-blue-700 dark:text-blue-400">
            {t('accountDetail.binanceWeightInfo', 'Binance API weight resets every minute. Each API call consumes different weight.')}
          </div>
        </div>
      </div>
    </>
  )
}

// Hyperliquid API Usage content
function HyperliquidApiUsageContent({
  rateLimit, getUsageColor, getUsageBarColor, t,
}: {
  rateLimit: RateLimitData
  getUsageColor: (p: number) => string
  getUsageBarColor: (p: number) => string
  t: any
}) {
  return (
    <>
      <div className="grid grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-muted-foreground text-xs">{t('accountDetail.cumulativeVolume', 'Cumulative Volume')}</div>
          <div className="font-bold">${rateLimit.cumVlm.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">{t('accountDetail.requestsUsed', 'Requests Used')}</div>
          <div className="font-medium">{rateLimit.nRequestsUsed.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">{t('accountDetail.requestsCap', 'Requests Cap')}</div>
          <div className="font-medium">{rateLimit.nRequestsCap.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs">{t('accountDetail.remaining', 'Remaining')}</div>
          <div className={`font-bold ${getUsageColor(rateLimit.usagePercent)}`}>
            {rateLimit.remaining.toLocaleString()}
          </div>
        </div>
      </div>
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-muted-foreground">{t('accountDetail.usage', 'Usage')}</span>
          <span className={getUsageColor(rateLimit.usagePercent)}>{rateLimit.usagePercent.toFixed(1)}%</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
          <div
            className={`h-full rounded-full ${getUsageBarColor(rateLimit.usagePercent)}`}
            style={{ width: `${Math.min(rateLimit.usagePercent, 100)}%` }}
          />
        </div>
      </div>
      {rateLimit.isOverLimit && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-red-700 dark:text-red-400">
            <strong>{t('accountDetail.quotaExceeded', 'API Quota Exceeded!')}</strong> {t('accountDetail.quotaExceededDesc', 'Order placement will fail. Trade more to increase quota.')}
          </div>
        </div>
      )}
      <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded p-3">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-blue-700 dark:text-blue-400">
            <strong>{t('accountDetail.increaseQuota', 'To increase quota:')}</strong> {t('accountDetail.increaseQuotaDesc', 'Complete more trades. Every $1 USDC traded adds 1 request to your cap.')}
          </div>
        </div>
      </div>
    </>
  )
}

// Trading Stats Section
function TradingStatsSection({
  stats,
  statsUpdated,
  refreshing,
  onRefresh,
  t,
}: {
  stats: TradingStats | null
  statsUpdated: number | null
  refreshing: boolean
  onRefresh: () => void
  t: any
}) {
  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">{t('accountDetail.tradingStats', 'Trading Statistics')}</h3>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={`w-3 h-3 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
          {t('common.refresh', 'Refresh')}
        </Button>
      </div>

      {stats && stats.total_trades > 0 ? (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">{t('accountDetail.winRate', 'Win Rate')}</div>
              <div className="font-bold text-lg">{stats.win_rate.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">{t('accountDetail.totalTrades', 'Total Trades')}</div>
              <div className="font-medium">{stats.total_trades}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">{t('accountDetail.winsLosses', 'Wins / Losses')}</div>
              <div className="font-medium">
                <span className="text-green-600">{stats.wins}W</span>
                {' / '}
                <span className="text-red-600">{stats.losses}L</span>
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">{t('accountDetail.profitFactor', 'Profit Factor')}</div>
              <div className={`font-bold ${stats.profit_factor >= 1 ? 'text-green-600' : 'text-red-600'}`}>
                {stats.profit_factor.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3 text-sm pt-2 border-t">
            <div>
              <div className="text-muted-foreground text-xs">{t('accountDetail.totalPnl', 'Total PnL')}</div>
              <div className={`font-bold ${stats.total_pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                ${stats.total_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">{t('accountDetail.avgWin', 'Avg Win')}</div>
              <div className="font-medium text-green-600">
                +${stats.avg_win.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">{t('accountDetail.avgLoss', 'Avg Loss')}</div>
              <div className="font-medium text-red-600">
                ${stats.avg_loss.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">{t('accountDetail.grossProfit', 'Gross Profit')}</div>
              <div className="font-medium text-green-600">
                +${stats.gross_profit.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          {statsUpdated && (
            <div className="text-xs text-muted-foreground text-right">
              {t('accountDetail.lastUpdated', 'Last updated')}: {formatDateTime(new Date(statsUpdated))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          {stats ? t('accountDetail.noClosedTrades', 'No closed trades yet') : t('accountDetail.clickRefreshStats', 'Click Refresh to load trading statistics')}
        </div>
      )}
    </div>
  )
}

// Positions Section
function PositionsSection({ positions, t }: { positions: Position[]; t: any }) {
  if (positions.length === 0) {
    return (
      <div className="border rounded-lg p-4">
        <h3 className="text-sm font-semibold mb-3">{t('accountDetail.openPositions', 'Open Positions')}</h3>
        <div className="text-sm text-muted-foreground">{t('accountDetail.noOpenPositions', 'No open positions')}</div>
      </div>
    )
  }

  return (
    <div className="border rounded-lg p-4">
      <h3 className="text-sm font-semibold mb-3">{t('accountDetail.openPositions', 'Open Positions')} ({positions.length})</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="text-left py-2 pr-2">{t('accountDetail.symbol', 'Symbol')}</th>
              <th className="text-left py-2 pr-2">{t('accountDetail.side', 'Side')}</th>
              <th className="text-right py-2 pr-2">{t('accountDetail.size', 'Size')}</th>
              <th className="text-right py-2 pr-2">{t('accountDetail.entry', 'Entry')}</th>
              <th className="text-right py-2 pr-2">{t('accountDetail.mark', 'Mark')}</th>
              <th className="text-right py-2 pr-2">{t('accountDetail.pnl', 'PnL')}</th>
              <th className="text-right py-2">{t('accountDetail.lev', 'Lev')}</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos, idx) => {
              const pnlColor = pos.unrealized_pnl >= 0 ? 'text-green-600' : 'text-red-600'
              const sideColor = pos.side.toLowerCase() === 'long' ? 'text-green-600' : 'text-red-600'
              return (
                <tr key={idx} className="border-b last:border-0">
                  <td className="py-2 pr-2 font-medium">{pos.symbol}</td>
                  <td className={`py-2 pr-2 ${sideColor}`}>{pos.side}</td>
                  <td className="py-2 pr-2 text-right">{pos.size.toFixed(4)}</td>
                  <td className="py-2 pr-2 text-right">${pos.entry_price.toLocaleString()}</td>
                  <td className="py-2 pr-2 text-right">${pos.mark_price.toLocaleString()}</td>
                  <td className={`py-2 pr-2 text-right font-medium ${pnlColor}`}>
                    {pos.unrealized_pnl >= 0 ? '+' : ''}${pos.unrealized_pnl.toFixed(2)}
                  </td>
                  <td className="py-2 text-right">{pos.leverage}x</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
