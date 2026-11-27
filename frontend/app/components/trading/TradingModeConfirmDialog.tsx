/**
 * Confirmation dialog for switching between Testnet and Mainnet.
 * Explains the differences and risks before allowing the switch.
 */

import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ShieldCheck, AlertTriangle } from 'lucide-react'
import type { TradingMode } from '@/contexts/TradingModeContext'

interface TradingModeConfirmDialogProps {
  isOpen: boolean
  targetMode: TradingMode | null
  onConfirm: () => void
  onCancel: () => void
}

export default function TradingModeConfirmDialog({
  isOpen,
  targetMode,
  onConfirm,
  onCancel,
}: TradingModeConfirmDialogProps) {
  const { t } = useTranslation()

  if (!targetMode) return null

  const isMainnet = targetMode === 'mainnet'

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isMainnet ? (
              <AlertTriangle className="h-5 w-5 text-red-500" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-blue-500" />
            )}
            {isMainnet
              ? t('tradingMode.switchToMainnet', 'Switch to Mainnet')
              : t('tradingMode.switchToTestnet', 'Switch to Testnet')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {isMainnet ? (
            <>
              <p className="text-sm font-medium text-red-600 dark:text-red-400">
                {t('tradingMode.mainnetWarning', 'You are about to switch to Mainnet. All trades will use real money.')}
              </p>
              <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-4">
                <li>{t('tradingMode.mainnetPoint1', 'Real funds at risk — losses are permanent')}</li>
                <li>{t('tradingMode.mainnetPoint2', 'Ensure your strategy has been tested before going live')}</li>
                <li>{t('tradingMode.mainnetPoint3', 'Signal and market flow data is collected from Mainnet')}</li>
              </ul>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                {t('tradingMode.testnetInfo', 'Testnet is for familiarizing with the trading process only.')}
              </p>
              <ul className="text-sm text-muted-foreground space-y-1.5 list-disc pl-4">
                <li>{t('tradingMode.testnetPoint1', 'Prices and volume differ from Mainnet — not synchronized')}</li>
                <li>{t('tradingMode.testnetPoint2', 'Signal and market flow data is only collected from Mainnet')}</li>
                <li>{t('tradingMode.testnetPoint3', 'Strategy results on Testnet do not represent Mainnet performance')}</li>
                <li>{t('tradingMode.testnetPoint4', 'Use Testnet to learn the platform, then switch to Mainnet with small capital')}</li>
              </ul>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant={isMainnet ? 'destructive' : 'default'}
            onClick={onConfirm}
          >
            {isMainnet
              ? t('tradingMode.confirmMainnet', 'Switch to Mainnet')
              : t('tradingMode.confirmTestnet', 'Switch to Testnet')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
