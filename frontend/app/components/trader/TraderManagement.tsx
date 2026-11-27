import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SettingsDialog } from '@/components/layout/SettingsDialog'
import StrategyPanel from '@/components/portfolio/StrategyPanel'
import { getAccounts, TradingAccount } from '@/lib/api'

export default function TraderManagement() {
  const { t } = useTranslation()
  const [accounts, setAccounts] = useState<TradingAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  /**
   * Initial view ID from URL parameter: #trader-management?view=ID
   * Parsed once at component mount to handle deep linking from Hyper AI.
   */
  const initialViewIdRef = useRef<number | null>((() => {
    const hash = window.location.hash
    const hashParamIndex = hash.indexOf('?')
    if (hashParamIndex !== -1) {
      const hashParams = new URLSearchParams(hash.slice(hashParamIndex))
      const viewId = hashParams.get('view')
      if (viewId) {
        const numId = Number(viewId)
        if (!isNaN(numId)) {
          // Clean up URL after reading
          window.history.replaceState({}, '', window.location.pathname + hash.slice(0, hashParamIndex))
          return numId
        }
      }
    }
    return null
  })())

  const loadAccounts = async () => {
    try {
      const accountList = await getAccounts()
      setAccounts(accountList)

      // Check for initial view ID from URL (deep link from Hyper AI)
      const initialViewId = initialViewIdRef.current
      const effectiveSelectedId = initialViewId ?? selectedAccountId

      if (accountList.length > 0 && !effectiveSelectedId) {
        setSelectedAccountId(accountList[0].id)
      } else if (effectiveSelectedId) {
        // Ensure the URL-specified account exists
        const target = accountList.find(acc => acc.id === effectiveSelectedId)
        if (target) {
          setSelectedAccountId(effectiveSelectedId)
        } else if (accountList.length > 0) {
          setSelectedAccountId(accountList[0].id)
        }
      }

      // Clear the ref after first use
      initialViewIdRef.current = null
    } catch (error) {
      console.error('Failed to load accounts:', error)
    }
  }

  useEffect(() => {
    loadAccounts()
  }, [refreshKey])

  const handleAccountUpdated = () => {
    setRefreshKey(prev => prev + 1)
  }

  const handleStrategyAccountChange = (accountId: number) => {
    setSelectedAccountId(accountId)
  }

  const selectedAccount = accounts.find(acc => acc.id === selectedAccountId)

  // Check if user only has default account
  const hasOnlyDefaultAccount = accounts.length === 1 &&
    accounts[0]?.name === "Default AI Trader" &&
    accounts[0]?.api_key === "default-key-please-update-in-settings"

  // Show welcome guide for new users
  if (hasOnlyDefaultAccount) {
    return (
      <div className="h-full w-full overflow-hidden flex flex-col gap-4 p-6">
        <div className="flex-shrink-0">
          <h1 className="text-2xl font-bold">{t('trader.welcomeTitle', 'Welcome to Hyper Alpha Arena!')}</h1>
          <p className="text-muted-foreground">{t('trader.welcomeSubtitle', "Let's set up your first AI trader")}</p>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <Card className="max-w-md w-full">
            <CardHeader>
              <CardTitle>🤖 {t('trader.setupTitle', 'Setup Your AI Trader')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t('trader.setupDesc', "We've created a default AI trader for you. To start trading, you need to:")}
              </p>
              <ol className="text-sm space-y-2 list-decimal list-inside">
                <li>{t('trader.step1', 'Configure your AI model and API key')}</li>
                <li>{t('trader.step2', 'Set up your trading strategy')}</li>
                <li>{t('trader.step3', 'Start automated trading')}</li>
              </ol>
              <div className="pt-4">
                <SettingsDialog
                  open={false}
                  onOpenChange={() => {}}
                  onAccountUpdated={handleAccountUpdated}
                  embedded={false}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full w-full overflow-hidden flex flex-col gap-4 p-6">
      <div className="flex-shrink-0">
        <h1 className="text-2xl font-bold">{t('trader.title', 'AI Trader Management')}</h1>
        <p className="text-muted-foreground">{t('trader.subtitle', 'Manage your AI traders and configure trading strategies')}</p>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-6 overflow-hidden">
        {/* Left Side - Trader Management */}
        <Card className="flex flex-col overflow-hidden">
          <CardHeader>
            <CardTitle>{t('trader.aiTraders', 'AI Traders')}</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden">
            <SettingsDialog
              open={true}
              onOpenChange={() => {}}
              onAccountUpdated={handleAccountUpdated}
              embedded={true}
            />
          </CardContent>
        </Card>

        {/* Right Side - Strategy Settings */}
        <Card className="flex flex-col overflow-hidden">
          <CardHeader>
            <CardTitle>{t('trader.strategyConfig', 'Strategy Configuration')}</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden">
            {selectedAccount ? (
              <StrategyPanel
                accountId={selectedAccount.id}
                accountName={selectedAccount.name}
                refreshKey={refreshKey}
                accounts={accounts}
                onAccountChange={handleStrategyAccountChange}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                {t('trader.createTraderHint', 'Create an AI trader to configure strategies')}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}