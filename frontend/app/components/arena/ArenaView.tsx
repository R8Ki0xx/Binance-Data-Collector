import { useMemo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import TradingFloor, { type TraderData, type ExchangeMonitor } from './TradingFloor'
import type { CharacterState } from './pixelData/characters'
import type { Position } from '@/components/portfolio/HyperliquidMultiAccountSummary'
import type { HyperliquidEnvironment } from '@/lib/types/hyperliquid'

interface AccountData {
  account_id: number
  account_name: string
  exchange?: string
  avatar_preset_id?: number | null
  auto_trading_enabled?: boolean
}

interface AccountBalance {
  accountId: number
  accountName: string
  exchange: string
  balance: {
    totalEquity: number
    marginUsagePercent: number
  } | null
  error: string | null
}

interface ArenaViewProps {
  accounts: AccountData[]
  positions: Position[]
  accountBalances: AccountBalance[]
  environment: HyperliquidEnvironment
  activitySignals?: Record<number, {
    seq: number
    exchange: string
    state: 'program_running' | 'ai_thinking'
  }>
}

function deriveState(
  autoTrading: boolean | undefined,
  hasError: boolean,
  allPositions: Position[],
): CharacterState {
  if (autoTrading === false) return 'offline'
  if (hasError) return 'error'

  const totalPnl = allPositions.reduce((sum, p) => sum + p.unrealized_pnl, 0)
  if (allPositions.length > 0) {
    return totalPnl >= 0 ? 'holding_profit' : 'holding_loss'
  }

  return 'idle'
}

export default function ArenaView({
  accounts,
  positions,
  accountBalances,
  environment,
  activitySignals = {},
}: ArenaViewProps) {
  const { t } = useTranslation()

  // Fetch asset curve for mini equity charts (last 24h, 30 points)
  const [equityMap, setEquityMap] = useState<Map<string, number[]>>(new Map())
  useEffect(() => {
    const fetchCurves = async () => {
      try {
        const params = new URLSearchParams({
          timeframe: '5m',
          trading_mode: environment || 'testnet',
        })
        if (environment) params.set('environment', environment)
        const now = new Date()
        const start = new Date(now)
        start.setHours(now.getHours() - 24)
        params.set('start_date', start.toISOString())
        params.set('end_date', now.toISOString())
        const res = await fetch(`/api/account/asset-curve?${params}`)
        if (!res.ok) return
        const data: { account_id: number; exchange?: string; total_assets: number; timestamp: number }[] = await res.json()
        // Group by account_exchange, downsample to ~30 points
        const grouped = new Map<string, number[]>()
        for (const d of data) {
          const key = `${d.account_id}_${d.exchange || 'hyperliquid'}`
          if (!grouped.has(key)) grouped.set(key, [])
          grouped.get(key)!.push(d.total_assets)
        }
        const result = new Map<string, number[]>()
        for (const [key, vals] of grouped) {
          if (vals.length <= 30) { result.set(key, vals); continue }
          const step = vals.length / 30
          const sampled: number[] = []
          for (let i = 0; i < 30; i++) sampled.push(vals[Math.floor(i * step)])
          sampled.push(vals[vals.length - 1])
          result.set(key, sampled)
        }
        setEquityMap(result)
      } catch { /* ignore */ }
    }
    fetchCurves()
    const interval = setInterval(fetchCurves, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [environment])

  const traders: TraderData[] = useMemo(() => {
    // Group accounts by account_id to merge multiple exchanges
    const accountMap = new Map<number, {
      acc: AccountData
      exchangeNames: Set<string>
    }>()
    for (const acc of accounts) {
      if (!accountMap.has(acc.account_id)) {
        accountMap.set(acc.account_id, { acc, exchangeNames: new Set() })
      }
      if (acc.exchange) {
        accountMap.get(acc.account_id)!.exchangeNames.add(acc.exchange)
      }
    }

    return Array.from(accountMap.values()).map(({ acc, exchangeNames }) => {
      const allPositions = positions.filter(p => p.account_id === acc.account_id)
      const allBalances = accountBalances.filter(b => b.accountId === acc.account_id)
      const hasError = allBalances.some(b => b.error)

      // Build per-exchange monitors
      const exchanges: ExchangeMonitor[] = []
      const seenExchanges = new Set<string>()

      for (const bal of allBalances) {
        if (seenExchanges.has(bal.exchange)) continue
        seenExchanges.add(bal.exchange)
        const exPositions = allPositions.filter(
          (p: any) => (p.exchange || 'hyperliquid') === bal.exchange
        )
        const exPnl = exPositions.reduce((sum, p) => sum + p.unrealized_pnl, 0)
        const eqKey = `${acc.account_id}_${bal.exchange}`
        exchanges.push({
          exchange: bal.exchange,
          equity: bal.balance?.totalEquity ?? null,
          unrealizedPnl: exPnl || null,
          positionCount: exPositions.length,
          positions: exPositions.map(p => ({
            symbol: p.symbol,
            side: p.side,
            unrealizedPnl: p.unrealized_pnl,
          })),
          equityHistory: equityMap.get(eqKey) || [],
        })
      }

      // If no balances but we know exchange names, add empty monitors
      for (const exName of exchangeNames) {
        if (!seenExchanges.has(exName)) {
          exchanges.push({
            exchange: exName,
            equity: null,
            unrealizedPnl: null,
            positionCount: 0,
            positions: [],
            equityHistory: equityMap.get(`${acc.account_id}_${exName}`) || [],
          })
        }
      }

      const state = deriveState(acc.auto_trading_enabled, hasError, allPositions)

      return {
        accountId: acc.account_id,
        accountName: acc.account_name,
        avatarPresetId: acc.avatar_preset_id ?? null,
        exchanges,
        state,
        activitySignal: activitySignals[acc.account_id],
      }
    })
  }, [accounts, positions, accountBalances, equityMap, activitySignals])

  if (accounts.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[280px] rounded-lg bg-card border border-border">
        <div className="text-sm text-muted-foreground">
          {t('dashboard.noAccountConfigured', 'No account configured')}
        </div>
      </div>
    )
  }

  return <TradingFloor traders={traders} />
}
