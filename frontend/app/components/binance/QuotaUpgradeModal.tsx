/**
 * Quota Modal
 *
 * Shows the remaining daily quota of a Binance mainnet account. The quota only
 * exists in deployments that configure a Binance broker ID.
 */

import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

interface QuotaUpgradeModalProps {
  isOpen: boolean
  onClose: () => void
  quota?: {
    used: number
    limit: number
    remaining: number
    reset_at?: number
  }
}

const BinanceLogo = () => (
  <svg width="24" height="24" viewBox="0 0 126.61 126.61" fill="none" xmlns="http://www.w3.org/2000/svg" className="inline-block mx-1">
    <g fill="#F3BA2F">
      <path d="M38.73,53.2l24.59-24.58,24.6,24.6,14.3-14.31L63.32,0,24.42,38.9Z"/>
      <path d="M0,63.31l14.3-14.31,14.31,14.31L14.3,77.61Z"/>
      <path d="M38.73,73.41l24.59,24.59,24.6-24.6,14.31,14.29h0L63.32,126.61,24.41,87.7l-.01-.01Z"/>
      <path d="M97.99,63.31l14.3-14.31,14.32,14.31-14.31,14.3Z"/>
      <path d="M77.83,63.3l-14.51-14.52-10.73,10.73-1.24,1.23-2.54,2.54,14.51,14.53,14.51-14.51h0Z"/>
    </g>
  </svg>
)

export default function QuotaUpgradeModal({
  isOpen,
  onClose,
  quota
}: QuotaUpgradeModalProps) {
  const { t } = useTranslation()

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-background border rounded-lg shadow-lg w-[480px] max-w-[95vw] mx-4 overflow-hidden">
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-1">
              <BinanceLogo />
              <span>{t('quota.title', 'Daily trade quota')}</span>
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0 flex-shrink-0 ml-2"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="p-6 space-y-4">
          {quota && (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                {t('quota.remainingQuota', 'Remaining')}: {quota.remaining}/{quota.limit} {t('quota.perDay', 'per day')}
                {quota.reset_at && (
                  <span className="ml-2 text-xs opacity-75">
                    ({t('quota.resetAt', 'Resets at')} {new Date(quota.reset_at * 1000).toLocaleString()})
                  </span>
                )}
              </p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {t('quota.explanation', 'This account is not eligible for the configured broker rebate, so automated trades are limited per day.')}
          </p>
        </div>
      </div>
    </div>,
    document.body
  )
}
