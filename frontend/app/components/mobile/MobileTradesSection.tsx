import { useTranslation } from 'react-i18next'
import { RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ArenaTrade } from '@/lib/api'
import { getModelLogo } from '@/components/portfolio/logoAssets'
import { formatDateTime } from '@/lib/dateTime'
import ExchangeIcon from '@/components/exchange/ExchangeIcon'
import { ExchangeId, EXCHANGE_DISPLAY_NAMES } from '@/lib/types/exchange'

const formatDate = (value?: string | null) => formatDateTime(value, { style: 'short' })

interface TradesSectionProps {
  trades: ArenaTrade[]
  selectedAccount: number | 'all'
  loading: boolean
  needsSync: boolean
  unsyncCount: number
  updatingPnl: boolean
  showPnlConfirm: boolean
  setShowPnlConfirm: (show: boolean) => void
  handleUpdatePnl: () => void
  pnlResult: string | null
}

export default function TradesSection({
  trades, selectedAccount, loading, needsSync, unsyncCount, updatingPnl, showPnlConfirm,
  setShowPnlConfirm, handleUpdatePnl, pnlResult
}: TradesSectionProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase text-muted-foreground">
          {t('feed.trades', 'Trades')}
        </span>
        <div className="flex items-center gap-2">
          {pnlResult && <span className="text-[10px] text-muted-foreground">{pnlResult}</span>}
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => setShowPnlConfirm(true)} disabled={updatingPnl}>
            {updatingPnl ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            {t('feed.syncPnl', 'Sync PnL')}
          </Button>
        </div>
      </div>

      <Dialog open={showPnlConfirm} onOpenChange={setShowPnlConfirm}>
        <DialogContent className="max-w-[90vw] rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">{t('feed.confirmUpdatePnl', 'Confirm Update PnL')}</DialogTitle>
            <DialogDescription className="text-xs">
              {t('feed.confirmUpdatePnlDesc', 'This will fetch the latest fee and PnL data from Hyperliquid API. Continue?')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowPnlConfirm(false)}>{t('common.cancel', 'Cancel')}</Button>
            <Button size="sm" onClick={() => { setShowPnlConfirm(false); handleUpdatePnl(); }}>{t('common.confirm', 'Confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {needsSync && (
        <div className="flex items-center gap-2 rounded-lg border border-orange-500/60 bg-orange-500/15 p-2.5">
          <RefreshCw className="h-3.5 w-3.5 flex-shrink-0 text-orange-600 dark:text-orange-400" />
          <p className="text-xs text-orange-700 dark:text-orange-300">
            {t('attribution.syncWarning', { count: unsyncCount })}
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : trades.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-4">{t('feed.noTrades', 'No recent trades')}</div>
      ) : (
        <div className="space-y-2">
          {trades.slice(0, 20).map((trade) => (
            <TradeCard key={`${trade.trade_id}-${trade.trade_time}`} trade={trade} selectedAccount={selectedAccount} />
          ))}
        </div>
      )}
    </div>
  )
}

function TradeCard({ trade, selectedAccount }: { trade: ArenaTrade; selectedAccount: number | 'all' }) {
  const { t } = useTranslation()
  const logo = selectedAccount === 'all' ? getModelLogo(trade.account_name) : null
  const sideStyle = trade.side === 'BUY' ? 'bg-emerald-100 text-emerald-700'
    : trade.side === 'SELL' ? 'bg-red-100 text-red-700'
    : trade.side === 'CLOSE' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'

  return (
    <div className="border rounded bg-muted/30 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          {trade.decision_source_type === 'program' ? (
            <>
              <svg className="h-4 w-4 rounded-full" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
                <path d="M508.416 3.584c-260.096 0-243.712 112.64-243.712 112.64l0.512 116.736h248.32v34.816H166.4S0 248.832 0 510.976s145.408 252.928 145.408 252.928h86.528v-121.856S227.328 496.64 374.784 496.64h246.272s138.24 2.048 138.24-133.632V139.776c-0.512 0 20.48-136.192-250.88-136.192zM371.712 82.432c24.576 0 44.544 19.968 44.544 44.544 0 24.576-19.968 44.544-44.544 44.544-24.576 0-44.544-19.968-44.544-44.544-0.512-24.576 19.456-44.544 44.544-44.544z" fill="#3773A5"/>
                <path d="M515.584 1022.464c260.096 0 243.712-112.64 243.712-112.64l-0.512-116.736H510.976V757.76h346.624s166.4 18.944 166.4-243.2-145.408-252.928-145.408-252.928h-86.528v121.856s4.608 145.408-142.848 145.408h-245.76s-138.24-2.048-138.24 133.632v224.768c0-0.512-20.992 135.168 250.368 135.168z m136.704-78.336c-24.576 0-44.544-19.968-44.544-44.544 0-24.576 19.968-44.544 44.544-44.544 24.576 0 44.544 19.968 44.544 44.544 0.512 24.576-19.456 44.544-44.544 44.544z" fill="#FFD731"/>
              </svg>
              <span className="font-semibold text-foreground">{trade.prompt_template_name}</span>
              <span className="text-muted-foreground">→</span>
              <span className="text-muted-foreground">{trade.account_name}</span>
            </>
          ) : (
            <>
              {logo && <img src={logo.src} alt={logo.alt} className="h-4 w-4 rounded-full" />}
              {selectedAccount === 'all' && <span className="text-muted-foreground">{trade.account_name}</span>}
            </>
          )}
        </div>
        <span className="text-muted-foreground">{formatDate(trade.trade_time)}</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold">{trade.symbol}</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${sideStyle}`}>{trade.side}</span>
        <span>@ ${trade.price?.toFixed(2)}</span>
        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800/80">
          <ExchangeIcon exchangeId={(trade.exchange || 'hyperliquid') as ExchangeId} size={12} />
          <span className="text-[10px] font-medium text-slate-200">
            {EXCHANGE_DISPLAY_NAMES[(trade.exchange || 'hyperliquid') as ExchangeId]}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{t('feed.qty', 'Qty')}: {trade.quantity?.toFixed(4)}</span>
        <span>{t('feed.notional', 'Notional')}: ${trade.notional?.toFixed(2)}</span>
      </div>
      {(trade.signal_trigger_id || trade.prompt_template_name) && (
        <div className="flex items-center gap-2 text-[10px]">
          <span className={`px-1.5 py-0.5 rounded ${trade.signal_trigger_id ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>
            {trade.signal_trigger_id ? t('feed.signalPoolTrigger', 'Signal Pool') : t('feed.scheduledTrigger', 'Scheduled')}
          </span>
          {trade.prompt_template_name && <span className="px-1.5 py-0.5 rounded bg-muted">{trade.prompt_template_name}</span>}
        </div>
      )}
      {trade.related_orders && trade.related_orders.length > 0 && <RelatedOrders orders={trade.related_orders} />}
    </div>
  )
}

function RelatedOrders({ orders }: { orders: ArenaTrade['related_orders'] }) {
  const { t } = useTranslation()
  if (!orders || orders.length === 0) return null
  return (
    <div className="pt-1.5 border-t border-border/50 space-y-1">
      <span className="text-[10px] text-muted-foreground">{t('feed.relatedOrders', 'Related Orders')}</span>
      {orders.map((ro, idx) => (
        <div key={idx} className="flex items-center gap-2 text-[10px] bg-muted/50 rounded px-2 py-1">
          <span className={`px-1 py-0.5 rounded font-bold ${ro.type === 'sl' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
            {ro.type === 'sl' ? 'SL' : 'TP'}
          </span>
          <span>@ ${ro.price?.toFixed(2)}</span>
          <span className="text-muted-foreground">Qty: {ro.quantity?.toFixed(4)}</span>
        </div>
      ))}
    </div>
  )
}
