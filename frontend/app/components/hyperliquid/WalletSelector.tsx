/**
 * WalletSelector - Multi-exchange wallet selector component
 *
 * Supports both Hyperliquid and Binance wallets for manual trading.
 * Displays wallet info with appropriate format based on exchange type.
 */
import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useTranslation } from 'react-i18next'

export type ExchangeType = 'hyperliquid' | 'binance'

export interface WalletOption {
  wallet_id: number
  account_id: number
  account_name: string
  model: string | null
  wallet_address?: string      // Hyperliquid
  api_key_masked?: string      // Binance
  environment: 'testnet' | 'mainnet'
  is_active: boolean
  max_leverage: number
  default_leverage: number
  exchange: ExchangeType
}

interface WalletSelectorProps {
  exchange: ExchangeType
  selectedWalletId: number | null
  onSelect: (wallet: WalletOption) => void
  showLabel?: boolean
  compact?: boolean  // Compact mode: label and info on same line
}

export default function WalletSelector({
  exchange,
  selectedWalletId,
  onSelect,
  showLabel = true,
  compact = false
}: WalletSelectorProps) {
  const { t } = useTranslation()
  const [wallets, setWallets] = useState<WalletOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadWallets()
  }, [exchange])

  const loadWallets = async () => {
    try {
      setLoading(true)
      const endpoint = exchange === 'hyperliquid'
        ? '/api/hyperliquid/wallets/all'
        : '/api/binance/wallets/all'

      const response = await fetch(endpoint)
      if (!response.ok) {
        throw new Error('Failed to load wallets')
      }
      const data = await response.json()

      // Add exchange type to each wallet
      const walletsWithExchange = data.map((w: any) => ({
        ...w,
        exchange
      }))
      setWallets(walletsWithExchange)

      // Auto-select first active wallet
      if (walletsWithExchange.length > 0 && !selectedWalletId) {
        const firstActive = walletsWithExchange.find((w: WalletOption) => w.is_active)
        if (firstActive) {
          onSelect(firstActive)
        }
      }
    } catch (error) {
      console.error('Failed to load wallets:', error)
      setWallets([])
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 38 38" stroke="currentColor" className="w-5 h-5 text-primary animate-spin">
          <g fill="none" fillRule="evenodd">
            <g transform="translate(1 1)" strokeWidth="2">
              <circle strokeOpacity=".3" cx="18" cy="18" r="18" />
              <path d="M36 18c0-9.94-8.06-18-18-18" />
            </g>
          </g>
        </svg>
        <span>{t('trade.loadingWallets', 'Loading wallets...')}</span>
      </div>
    )
  }

  if (wallets.length === 0) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-yellow-900 text-sm">
              {t('trade.noWalletsAvailable', 'No Wallets Available')}
            </h3>
            <p className="text-xs text-yellow-800 mt-1">
              {t('trade.noWalletsHint', 'Please configure wallets for your AI Traders first.')}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const selectedWallet = wallets.find(w => w.wallet_id === selectedWalletId)

  // Format wallet identifier based on exchange
  const formatWalletId = (wallet: WalletOption): string => {
    if (wallet.exchange === 'hyperliquid' && wallet.wallet_address) {
      return `${wallet.wallet_address.slice(0, 6)}...${wallet.wallet_address.slice(-4)}`
    } else if (wallet.exchange === 'binance' && wallet.api_key_masked) {
      return wallet.api_key_masked
    }
    return ''
  }

  return (
    <div className="space-y-2">
      {showLabel && (
        <label className="text-xs font-medium text-muted-foreground">
          {t('trade.selectWallet', 'Select Trading Wallet')}
        </label>
      )}

      <div className={compact ? 'flex items-center gap-3' : ''}>
        <select
          value={selectedWalletId || ''}
          onChange={(e) => {
            const wallet = wallets.find(w => w.wallet_id === Number(e.target.value))
            if (wallet) onSelect(wallet)
          }}
          className="flex-1 border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 h-10"
        >
          {wallets.map(w => {
            const statusIcon = w.is_active ? '🟢' : '🔴'
            const envLabel = w.environment === 'testnet' ? 'Testnet' : 'Mainnet'
            const walletId = formatWalletId(w)

            return (
              <option key={w.wallet_id} value={w.wallet_id}>
                {statusIcon} {w.account_name} ({envLabel}) - {walletId}
              </option>
            )
          })}
        </select>

        {compact && selectedWallet && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
            <Badge
              variant={selectedWallet.environment === 'testnet' ? 'default' : 'destructive'}
              className="uppercase text-[10px]"
            >
              {selectedWallet.environment}
            </Badge>
            <span>Max: <strong className="text-foreground">{selectedWallet.max_leverage}x</strong></span>
          </div>
        )}
      </div>

      {!compact && selectedWallet && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pt-1">
          <span>
            AI Trader: <strong className="text-foreground">{selectedWallet.account_name}</strong>
          </span>
          <Badge
            variant={selectedWallet.environment === 'testnet' ? 'default' : 'destructive'}
            className="uppercase text-[10px]"
          >
            {selectedWallet.environment}
          </Badge>
          <span>
            Max: <strong className="text-foreground">{selectedWallet.max_leverage}x</strong>
          </span>
        </div>
      )}
    </div>
  )
}
