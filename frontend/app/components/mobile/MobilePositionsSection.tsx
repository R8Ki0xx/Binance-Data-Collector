import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { ArenaPositionsAccount } from '@/lib/api'
import { getModelLogo } from '@/components/portfolio/logoAssets'

interface PositionsSectionProps {
  positions: ArenaPositionsAccount[]
  selectedAccount: number | 'all'
  loading: boolean
}

export default function PositionsSection({ positions, selectedAccount, loading }: PositionsSectionProps) {
  const { t } = useTranslation()

  const allPositions = positions.flatMap(account =>
    account.positions.map(pos => ({ ...pos, account_name: account.account_name, account_id: account.account_id }))
  )

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase text-muted-foreground">
          {t('feed.positions', 'Positions')} ({allPositions.length})
        </span>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : allPositions.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-4">
          {t('feed.noPositions', 'No open positions')}
        </div>
      ) : (
        <div className="space-y-2">
          {allPositions.map((pos, idx) => {
            const logo = selectedAccount === 'all' ? getModelLogo(pos.account_name) : null
            const isLong = pos.side?.toLowerCase() === 'long'
            const pnlValue = pos.unrealized_pnl || 0
            const roePercent = pos.return_on_equity ? pos.return_on_equity * 100 : 0
            return (
              <div key={`${pos.account_id}-${pos.symbol}-${idx}`} className="border rounded bg-muted/30 p-2.5">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {logo && <img src={logo.src} alt={logo.alt} className="h-4 w-4 rounded-full" />}
                    {selectedAccount === 'all' && (
                      <span className="text-xs text-muted-foreground">{pos.account_name}</span>
                    )}
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      isLong ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {isLong ? 'LONG' : 'SHORT'}
                    </span>
                  </div>
                  <span className="text-xs font-medium">{pos.leverage?.toFixed(1)}x</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold">{pos.symbol}</span>
                    <span className="text-muted-foreground ml-2">
                      {pos.quantity?.toFixed(4)} @ ${pos.avg_cost?.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs mt-1">
                  <span className="text-muted-foreground">
                    {t('feed.current', 'Current')}: ${pos.current_price?.toFixed(2)}
                  </span>
                  <span className={`font-semibold ${pnlValue >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    ${pnlValue.toFixed(2)} ({roePercent >= 0 ? '+' : ''}{roePercent.toFixed(2)}%)
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
