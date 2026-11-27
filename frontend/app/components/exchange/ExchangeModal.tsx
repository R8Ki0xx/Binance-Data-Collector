import React from 'react'
import { createPortal } from 'react-dom'
import { X, ExternalLink, Zap, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useExchange } from '@/contexts/ExchangeContext'
import ExchangeIcon from './ExchangeIcon'
import { useTranslation } from 'react-i18next'

interface ExchangeModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function ExchangeModal({ isOpen, onClose }: ExchangeModalProps) {
  const { t } = useTranslation()
  const { exchanges } = useExchange()

  if (!isOpen) return null

  const handleExchangeClick = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  // Translated exchange info
  const exchangeTranslations: Record<string, {
    description: string
    features: string[]
    buttonText: string
  }> = {
    hyperliquid: {
      description: t('exchange.hyperliquid.description', '#1 Decentralized Perpetual DEX'),
      features: [
        t('exchange.hyperliquid.feature1', 'No KYC Required'),
        t('exchange.hyperliquid.feature2', 'On-chain Settlement'),
        t('exchange.hyperliquid.feature3', 'Testnet Available'),
      ],
      buttonText: t('exchange.hyperliquid.button', 'Open Futures'),
    },
    binance: {
      description: t('exchange.binance.description', '#1 Global CEX by Volume'),
      features: [
        t('exchange.binance.feature1', 'KYC Required'),
        t('exchange.binance.feature2', 'High Liquidity'),
        t('exchange.binance.feature3', 'Testnet Available'),
      ],
      buttonText: t('exchange.binance.button', 'Register First'),
    },
  }

  // Data collection info for each exchange
  const dataInfo = {
    hyperliquid: {
      method: 'WebSocket',
      icon: Zap,
      color: 'text-green-500',
      items: [
        { label: t('exchange.data.kline', 'K-line'), value: t('exchange.data.realtime', 'Real-time') },
        { label: t('exchange.data.takerVolume', 'Taker Volume'), value: '15s' },
        { label: t('exchange.data.oi', 'Open Interest'), value: '15s' },
        { label: t('exchange.data.funding', 'Funding Rate'), value: '15s' },
        { label: t('exchange.data.orderbook', 'Orderbook'), value: '15s' },
      ]
    },
    binance: {
      method: 'WebSocket + REST',
      icon: Zap,
      color: 'text-yellow-500',
      items: [
        { label: t('exchange.data.kline', 'K-line'), value: 'REST 60s' },
        { label: t('exchange.data.takerVolume', 'Taker Volume'), value: 'WS 15s' },
        { label: t('exchange.data.oi', 'Open Interest'), value: 'REST 60s' },
        { label: t('exchange.data.funding', 'Funding Rate'), value: t('exchange.data.realtime', 'Real-time') },
        { label: t('exchange.data.orderbook', 'Orderbook'), value: 'REST 15s' },
      ]
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-background border rounded-lg shadow-lg max-w-5xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-2xl font-bold">{t('exchange.supportedExchanges', 'Supported Exchanges')}</h2>
            <p className="text-muted-foreground mt-1">{t('exchange.compareDesc', 'Compare features and data collection methods')}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Exchange Cards - Only show Hyperliquid and Binance */}
        <div className="p-6">
          <div className="grid gap-6 md:grid-cols-2">
            {exchanges.filter(ex => ex.id === 'hyperliquid' || ex.id === 'binance').map((exchange) => {
              const info = dataInfo[exchange.id as 'hyperliquid' | 'binance']
              const DataIcon = info?.icon || Clock

              return (
                <div key={exchange.id} className="border rounded-lg p-6 space-y-4">
                  {/* Logo & Name */}
                  <div className="flex items-center gap-3">
                    <ExchangeIcon exchangeId={exchange.id} size={48} />
                    <div>
                      <h3 className="text-lg font-semibold">{exchange.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {exchangeTranslations[exchange.id]?.description || exchange.description}
                      </p>
                    </div>
                  </div>

                  {/* Features */}
                  <div className="space-y-1">
                    {(exchangeTranslations[exchange.id]?.features || exchange.features).map((feature, index) => (
                      <div key={index} className="text-sm flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                        {feature}
                      </div>
                    ))}
                  </div>

                  {/* Data Collection */}
                  {info && (
                    <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <DataIcon className={`h-4 w-4 ${info.color}`} />
                        {t('exchange.dataCollection', 'Data Collection')}: {info.method}
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                        {info.items.map((item, idx) => (
                          <div key={idx}>{item.label}: {item.value}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Binance Note */}
                  {exchange.id === 'binance' && (
                    <div className="bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                      <p className="text-xs text-yellow-700 dark:text-yellow-300">
                        ⚠️ {t('exchange.binanceNote', 'One identity = One account. Register with referral link to get fee discount.')}
                      </p>
                    </div>
                  )}

                  {/* Register Button */}
                  <Button
                    variant={exchange.id === 'hyperliquid' ? 'default' : 'outline'}
                    className="w-full"
                    onClick={() => handleExchangeClick(exchange.referralLink)}
                  >
                    {exchangeTranslations[exchange.id]?.buttonText || exchange.buttonText}
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              )
            })}
          </div>

          {/* Footer */}
          <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <p className="text-sm text-blue-700 dark:text-blue-300 text-center">
              💡 {t('exchange.referralTip', 'Register through our referral links to enjoy fee discounts and support the platform development.')}
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
