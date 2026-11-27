import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Shield, CheckCircle, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { upgradeToAgentWallet, type WalletUpgradeCheckResponse } from '@/lib/hyperliquidApi'
import { useTranslation } from 'react-i18next'

interface AgentWalletUpgradeModalProps {
  isOpen: boolean
  onClose: () => void
  walletsToUpgrade: WalletUpgradeCheckResponse['needsUpgrade']
  onUpgradeComplete: () => void
}

interface WalletUpgradeState {
  upgrading: boolean
  upgraded: boolean
  agentAddress?: string
  validUntil?: string | null
  error?: string
}

export default function AgentWalletUpgradeModal({
  isOpen,
  onClose,
  walletsToUpgrade,
  onUpgradeComplete
}: AgentWalletUpgradeModalProps) {
  const { t } = useTranslation()
  const [states, setStates] = useState<Record<string, WalletUpgradeState>>({})

  if (!isOpen || walletsToUpgrade.length === 0) return null

  const getKey = (w: typeof walletsToUpgrade[0]) => `${w.accountId}-${w.environment}`
  const getState = (w: typeof walletsToUpgrade[0]): WalletUpgradeState =>
    states[getKey(w)] || { upgrading: false, upgraded: false }

  const updateState = (w: typeof walletsToUpgrade[0], updates: Partial<WalletUpgradeState>) => {
    setStates(prev => ({ ...prev, [getKey(w)]: { ...getState(w), ...updates } }))
  }

  const handleUpgrade = async (w: typeof walletsToUpgrade[0]) => {
    updateState(w, { upgrading: true, error: undefined })
    try {
      const result = await upgradeToAgentWallet(
        w.accountId,
        w.environment as 'testnet' | 'mainnet',
        `HyperArena-${w.accountId}`
      )
      if (result.success) {
        updateState(w, {
          upgrading: false, upgraded: true,
          agentAddress: result.agentAddress, validUntil: result.validUntil
        })
        const allDone = walletsToUpgrade.every(
          ww => getKey(ww) === getKey(w) || getState(ww).upgraded
        )
        if (allDone) setTimeout(onUpgradeComplete, 800)
      } else {
        updateState(w, { upgrading: false, error: result.message || 'Upgrade failed' })
      }
    } catch (error) {
      updateState(w, {
        upgrading: false,
        error: error instanceof Error ? error.message : 'Upgrade failed'
      })
    }
  }

  const handleRemindLater = () => {
    onClose()
  }

  const formatDate = (iso: string | null | undefined) => {
    if (!iso) return 'N/A'
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleRemindLater} />
      <div className="relative bg-background border rounded-lg shadow-lg w-[600px] max-w-[95vw] mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Shield className="h-5 w-5 text-green-500" />
              {t('wallet.agent.upgradeTitle', 'Upgrade to Secure API Wallet')}
            </h2>
            <Button variant="ghost" size="sm" onClick={handleRemindLater} className="h-8 w-8 p-0">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded">
            <div className="flex gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                {t('wallet.agent.securityWarning', 'Your wallet currently stores the master private key, which has full access to transfer funds. Upgrading to an API Wallet (Agent Key) restricts access to trading only — even if compromised, funds cannot be withdrawn.')}
              </p>
            </div>
          </div>
        </div>

        {/* Wallet list */}
        <div className="p-6 space-y-3 overflow-y-auto flex-1">
          {walletsToUpgrade.map(w => {
            const state = getState(w)
            return (
              <div key={getKey(w)} className={`p-4 rounded-lg border ${state.upgraded ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800' : 'bg-muted/50'}`}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-medium">{w.accountName}</p>
                    <p className="text-xs text-muted-foreground">
                      {w.environment.toUpperCase()} · {w.walletAddress.slice(0, 10)}...{w.walletAddress.slice(-6)}
                    </p>
                  </div>
                  {state.upgraded && <CheckCircle className="h-5 w-5 text-green-500" />}
                </div>

                {state.upgraded && state.agentAddress && (
                  <div className="text-xs space-y-1 mb-2">
                    <p><span className="text-muted-foreground">{t('wallet.agent.agentAddress', 'Agent Address')}:</span> <code>{state.agentAddress.slice(0, 10)}...{state.agentAddress.slice(-6)}</code></p>
                    <p><span className="text-muted-foreground">{t('wallet.agent.validUntil', 'Valid Until')}:</span> {formatDate(state.validUntil)}</p>
                  </div>
                )}

                {state.error && (
                  <div className="text-xs text-red-600 dark:text-red-400 mb-2 p-2 bg-red-50 dark:bg-red-950/20 rounded">
                    {state.error}
                  </div>
                )}

                {!state.upgraded && (
                  <Button size="sm" onClick={() => handleUpgrade(w)} disabled={state.upgrading} className="w-full">
                    {state.upgrading
                      ? <><Loader2 className="mr-2 h-3 w-3 animate-spin" />{t('wallet.agent.upgrading', 'Upgrading...')}</>
                      : <><Shield className="mr-2 h-3 w-3" />{t('wallet.agent.upgrade', 'Upgrade to API Wallet')}</>}
                  </Button>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="p-4 border-t">
          <Button variant="ghost" onClick={handleRemindLater} className="w-full text-sm">
            {t('wallet.agent.remindLater', 'Remind Me Later')}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
