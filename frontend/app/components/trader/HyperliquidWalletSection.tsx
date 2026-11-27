/**
 * Hyperliquid Wallet Section - One-click wallet setup via browser wallet signing
 *
 * Replaces manual API Wallet input with EIP-1193 browser wallet connection.
 * Handles builder fee authorization (mainnet) and agent key creation automatically.
 */

import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Wallet, CheckCircle, RefreshCw, Trash2, Shield, Loader2,
} from 'lucide-react'
import {
  getAccountWallet,
  configureAgentWallet,
  testWalletConnection,
  deleteAccountWallet,
} from '@/lib/hyperliquidApi'
import {
  oneClickWalletSetup,
  WALLET_ERROR,
  type SetupProgress,
} from '@/lib/hyperliquidWalletSetup'
import { copyToClipboard } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

interface HyperliquidWalletSectionProps {
  accountId: number
  accountName: string
  onStatusChange?: (env: 'testnet' | 'mainnet', configured: boolean) => void
  onWalletConfigured?: () => void
}

interface WalletData {
  id?: number
  walletAddress?: string
  maxLeverage: number
  defaultLeverage: number
  keyType?: 'private_key' | 'agent_key'
  masterWalletAddress?: string
  agentValidUntil?: string | null
  balance?: {
    totalEquity: number
    availableBalance: number
    marginUsagePercent: number
  }
}

export default function HyperliquidWalletSection({
  accountId,
  accountName,
  onStatusChange,
  onWalletConfigured
}: HyperliquidWalletSectionProps) {
  const { t } = useTranslation()
  const [testnetWallet, setTestnetWallet] = useState<WalletData | null>(null)
  const [mainnetWallet, setMainnetWallet] = useState<WalletData | null>(null)
  const [loading, setLoading] = useState(false)
  const [testingTestnet, setTestingTestnet] = useState(false)
  const [testingMainnet, setTestingMainnet] = useState(false)

  // One-click setup state
  const [setupProgress, setSetupProgress] = useState<Record<string, SetupProgress | null>>({
    testnet: null,
    mainnet: null,
  })

  // Leverage settings for new wallet setup
  const [testnetMaxLev, setTestnetMaxLev] = useState(3)
  const [testnetDefaultLev, setTestnetDefaultLev] = useState(1)
  const [mainnetMaxLev, setMainnetMaxLev] = useState(3)
  const [mainnetDefaultLev, setMainnetDefaultLev] = useState(1)

  useEffect(() => {
    loadWalletInfo()
  }, [accountId])

  const loadWalletInfo = async () => {
    try {
      setLoading(true)
      const info = await getAccountWallet(accountId)
      const hasTestnet = !!info.testnetWallet
      const hasMainnet = !!info.mainnetWallet

      if (info.testnetWallet) {
        setTestnetWallet(info.testnetWallet)
        setTestnetMaxLev(info.testnetWallet.maxLeverage)
        setTestnetDefaultLev(info.testnetWallet.defaultLeverage)
      } else {
        setTestnetWallet(null)
      }

      if (info.mainnetWallet) {
        setMainnetWallet(info.mainnetWallet)
        setMainnetMaxLev(info.mainnetWallet.maxLeverage)
        setMainnetDefaultLev(info.mainnetWallet.defaultLeverage)
      } else {
        setMainnetWallet(null)
      }

      onStatusChange?.('testnet', hasTestnet)
      onStatusChange?.('mainnet', hasMainnet)
    } catch (error) {
      console.error('Failed to load wallet info:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleOneClickSetup = async (environment: 'testnet' | 'mainnet') => {
    const maxLeverage = environment === 'testnet' ? testnetMaxLev : mainnetMaxLev
    const defaultLeverage = environment === 'testnet' ? testnetDefaultLev : mainnetDefaultLev

    try {
      await oneClickWalletSetup(
        environment,
        accountId,
        async (agentKey: string, masterAddr: string) => {
          await configureAgentWallet(accountId, {
            agentPrivateKey: agentKey,
            masterWalletAddress: masterAddr,
            environment,
            maxLeverage,
            defaultLeverage,
          })
        },
        (progress) => {
          setSetupProgress(prev => ({ ...prev, [environment]: progress }))
        }
      )

      toast.success(t('wallet.agent.configured', 'Wallet configured successfully!'))
      setSetupProgress(prev => ({ ...prev, [environment]: null }))
      await loadWalletInfo()
      onWalletConfigured?.()
    } catch (err: any) {
      const errorCode = err?.errorCode
      const errorMap: Record<string, string> = {
        [WALLET_ERROR.NO_WALLET]: t('wallet.error.noWallet', 'No browser wallet detected. Please install MetaMask, Rabby, or another wallet extension.'),
        [WALLET_ERROR.NO_ACCOUNT]: t('wallet.error.noAccount', 'No account selected in wallet. Please unlock your wallet and try again.'),
        [WALLET_ERROR.NOT_DEPOSITED]: err?.env === 'testnet'
          ? t('wallet.error.notDepositedTestnet', 'This wallet has not deposited on Hyperliquid Testnet. Please visit app.hyperliquid-testnet.xyz and deposit test USDC first.')
          : t('wallet.error.notDepositedMainnet', 'This wallet has not deposited on Hyperliquid. Please visit app.hyperliquid.xyz and deposit USDC first.'),
        [WALLET_ERROR.USER_REJECTED]: t('wallet.setup.rejected', 'Signing rejected by user'),
      }
      toast.error(errorMap[errorCode] || err?.message || t('wallet.error.setupFailed', 'Wallet setup failed. Please try again.'))
      // Keep error state visible briefly, then clear
      setTimeout(() => {
        setSetupProgress(prev => ({ ...prev, [environment]: null }))
      }, 3000)
    }
  }

  const handleTestConnection = async (environment: 'testnet' | 'mainnet') => {
    const setTesting = environment === 'testnet' ? setTestingTestnet : setTestingMainnet
    try {
      setTesting(true)
      const result = await testWalletConnection(accountId, environment)
      if (result.success && result.connection === 'successful') {
        toast.success(t('wallet.test.success', 'Connection successful! Balance: ${{balance}}', { balance: result.accountState?.totalEquity.toFixed(2) }))
        await loadWalletInfo()
      } else {
        toast.error(t('wallet.test.failed', 'Connection failed: {{error}}', { error: result.error || 'Unknown error' }))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('wallet.test.error', 'Connection test failed'))
    } finally {
      setTesting(false)
    }
  }

  const handleDeleteWallet = async (environment: 'testnet' | 'mainnet') => {
    if (!confirm(t('wallet.delete.confirm', 'Delete {{env}} wallet?', { env: environment }))) return
    try {
      setLoading(true)
      const result = await deleteAccountWallet(accountId, environment)
      if (result.success) {
        toast.success(t('wallet.delete.success', '{{env}} wallet deleted', { env: environment }))
        await loadWalletInfo()
        onWalletConfigured?.()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('wallet.delete.failed', 'Failed to delete wallet'))
    } finally {
      setLoading(false)
    }
  }

  const renderSetupProgress = (env: 'testnet' | 'mainnet') => {
    const progress = setupProgress[env]
    if (!progress || progress.step === 'idle') return null

    const stepMessages: Record<string, string> = {
      connecting: t('wallet.setup.connecting', 'Connecting browser wallet...'),
      checking_auth: t('wallet.setup.checkingAuth', 'Checking trading authorization...'),
      signing_auth: t('wallet.setup.signingAuth', 'Please approve Hyper Alpha Arena trading authorization in your wallet...'),
      signing_agent: t('wallet.setup.signingAgent', 'Please approve API Wallet creation in your wallet...'),
      saving: t('wallet.setup.saving', 'Saving wallet configuration...'),
      done: t('wallet.setup.done', 'Wallet setup complete!'),
      error: progress.message,
    }

    const isError = progress.step === 'error'
    const isDone = progress.step === 'done'

    return (
      <div className={`flex items-center gap-2 text-xs p-2 rounded ${
        isError ? 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300' :
        isDone ? 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-300' :
        'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300'
      }`}>
        {!isError && !isDone && <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" />}
        {isDone && <CheckCircle className="h-3 w-3 flex-shrink-0" />}
        <span>{stepMessages[progress.step] || progress.message}</span>
      </div>
    )
  }

  const renderWalletBlock = (
    environment: 'testnet' | 'mainnet',
    wallet: WalletData | null,
    testing: boolean,
  ) => {
    const badgeVariant = environment === 'testnet' ? 'default' : 'destructive'
    const progress = setupProgress[environment]
    const isSettingUp = progress && !['idle', 'done', 'error'].includes(progress.step)
    const maxLev = environment === 'testnet' ? testnetMaxLev : mainnetMaxLev
    const setMaxLev = environment === 'testnet' ? setTestnetMaxLev : setMainnetMaxLev
    const defaultLev = environment === 'testnet' ? testnetDefaultLev : mainnetDefaultLev
    const setDefaultLev = environment === 'testnet' ? setTestnetDefaultLev : setMainnetDefaultLev

    return (
      <div className="p-4 border rounded-lg space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <Badge variant={badgeVariant} className="text-xs">
              {environment === 'testnet' ? 'TESTNET' : 'MAINNET'}
            </Badge>
          </div>
          {wallet && (
            <Button variant="destructive" size="sm" onClick={() => handleDeleteWallet(environment)} disabled={loading}>
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>

        {wallet ? (
          <div className="space-y-2">
            {wallet.keyType === 'agent_key' && (
              <div className="flex items-center gap-1.5 mb-1">
                <Shield className="h-3 w-3 text-green-500" />
                <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                  {t('wallet.agent.secureMode', 'API Wallet (Secure)')}
                </span>
                {wallet.agentValidUntil && (
                  <span className="text-xs text-muted-foreground ml-auto">
                    {t('wallet.agent.expires', 'Expires')}: {new Date(wallet.agentValidUntil).toLocaleDateString()}
                  </span>
                )}
              </div>
            )}
            {wallet.keyType === 'agent_key' ? (
              <>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    {t('wallet.agent.agentAddress', 'API Wallet Address')}
                    <span className="ml-1 text-green-600 dark:text-green-400">— {t('wallet.agent.agentAddressHint', 'Trading only, cannot withdraw')}</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1 bg-muted rounded text-xs overflow-hidden">{wallet.walletAddress}</code>
                    <button onClick={async () => { const ok = await copyToClipboard(wallet.walletAddress || ''); if (ok) toast.success(t('wallet.addressCopied', 'Address copied')) }} className="cursor-pointer">
                      <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                    </button>
                  </div>
                </div>
                {wallet.masterWalletAddress && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">
                      {t('wallet.agent.masterAddress', 'Master Wallet')}
                      <span className="ml-1">— {t('wallet.agent.masterAddressHint', 'Query balance & positions')}</span>
                    </label>
                    <code className="block px-2 py-1 bg-muted rounded text-xs overflow-hidden">{wallet.masterWalletAddress}</code>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('wallet.walletAddress', 'Wallet Address')}</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-2 py-1 bg-muted rounded text-xs overflow-hidden">{wallet.walletAddress}</code>
                  <button onClick={async () => { const ok = await copyToClipboard(wallet.walletAddress || ''); if (ok) toast.success(t('wallet.addressCopied', 'Address copied')) }} className="cursor-pointer">
                    <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                  </button>
                </div>
              </div>
            )}

            {wallet.balance && (
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground">{t('wallet.balance', 'Balance')}</div>
                  <div className="font-medium">${wallet.balance.totalEquity.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t('wallet.available', 'Available')}</div>
                  <div className="font-medium">${wallet.balance.availableBalance.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t('wallet.margin', 'Margin')}</div>
                  <div className="font-medium">{wallet.balance.marginUsagePercent.toFixed(1)}%</div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">{t('wallet.maxLeverage', 'Max Leverage')}</div>
                <div className="font-medium">{wallet.maxLeverage}x</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('wallet.defaultLeverage', 'Default Leverage')}</div>
                <div className="font-medium">{wallet.defaultLeverage}x</div>
              </div>
            </div>

            <Button variant="outline" size="sm" onClick={() => handleTestConnection(environment)} disabled={testing} className="w-full">
              {testing ? <><RefreshCw className="mr-2 h-3 w-3 animate-spin" />{t('wallet.testing', 'Testing...')}</> : t('wallet.testConnection', 'Test Connection')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="p-2 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs">
              <p className="text-yellow-800 dark:text-yellow-200">
                {t('wallet.noWalletConfigured', 'No {{env}} wallet configured.', { env: environment })}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('wallet.maxLeverage', 'Max Leverage')}</label>
                <Input type="number" value={maxLev} onChange={(e) => setMaxLev(Number(e.target.value))} min={1} max={50} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('wallet.defaultLeverage', 'Default Leverage')}</label>
                <Input type="number" value={defaultLev} onChange={(e) => setDefaultLev(Number(e.target.value))} min={1} max={maxLev} className="h-8 text-xs" />
              </div>
            </div>

            {renderSetupProgress(environment)}

            <Button
              onClick={() => handleOneClickSetup(environment)}
              disabled={!!isSettingUp || loading}
              size="sm"
              className="w-full h-9 text-xs"
            >
              {isSettingUp ? (
                <><Loader2 className="mr-2 h-3 w-3 animate-spin" />{t('wallet.setup.inProgress', 'Setting up...')}</>
              ) : (
                <><Wallet className="mr-1 h-3 w-3" />{t('wallet.setup.oneClick', 'Connect Wallet & Setup')}</>
              )}
            </Button>

            <p className="text-[10px] text-muted-foreground text-center">
              {environment === 'mainnet'
                ? t('wallet.setup.mainnetHint', 'Connects your browser wallet, authorizes Hyper Alpha Arena trading tools, and creates a secure API Wallet.')
                : t('wallet.setup.testnetHint', 'Connects your browser wallet and creates a secure API Wallet for testnet trading.')}
            </p>
          </div>
        )}
      </div>
    )
  }

  if (loading && !testnetWallet && !mainnetWallet) {
    return (
      <div className="flex items-center justify-center py-4">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
      {renderWalletBlock('testnet', testnetWallet, testingTestnet)}
      {renderWalletBlock('mainnet', mainnetWallet, testingMainnet)}
    </div>
  )
}
