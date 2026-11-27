/**
 * Binance Wallet Section - Testnet/Mainnet API key configuration
 *
 * Full wallet configuration UI for Binance Futures.
 * Uses API Key + Secret instead of private key (CEX vs DEX).
 */

import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Wallet, Eye, EyeOff, CheckCircle, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import RebateIneligibleModal from '@/components/binance/RebateIneligibleModal'

interface BinanceWalletSectionProps {
  accountId: number
  accountName: string
  onStatusChange?: (env: 'testnet' | 'mainnet', configured: boolean) => void
  onWalletConfigured?: () => void
}

interface BinanceWalletData {
  configured: boolean
  apiKeyMasked?: string
  maxLeverage: number
  defaultLeverage: number
  balance?: {
    total_equity: number
    available_balance: number
    unrealized_pnl: number
  }
}

const API_BASE = '/api/binance'

export default function BinanceWalletSection({
  accountId,
  accountName,
  onStatusChange,
  onWalletConfigured
}: BinanceWalletSectionProps) {
  const { t } = useTranslation()

  // Wallet data states
  const [testnetWallet, setTestnetWallet] = useState<BinanceWalletData | null>(null)
  const [mainnetWallet, setMainnetWallet] = useState<BinanceWalletData | null>(null)

  // Independent loading states
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [savingTestnet, setSavingTestnet] = useState(false)
  const [savingMainnet, setSavingMainnet] = useState(false)
  const [testingTestnet, setTestingTestnet] = useState(false)
  const [testingMainnet, setTestingMainnet] = useState(false)

  // Editing states
  const [editingTestnet, setEditingTestnet] = useState(false)
  const [editingMainnet, setEditingMainnet] = useState(false)
  const [showTestnetKey, setShowTestnetKey] = useState(false)
  const [showMainnetKey, setShowMainnetKey] = useState(false)

  // Form states for testnet
  const [testnetApiKey, setTestnetApiKey] = useState('')
  const [testnetSecretKey, setTestnetSecretKey] = useState('')
  const [testnetMaxLeverage, setTestnetMaxLeverage] = useState(20)
  const [testnetDefaultLeverage, setTestnetDefaultLeverage] = useState(1)

  // Form states for mainnet
  const [mainnetApiKey, setMainnetApiKey] = useState('')
  const [mainnetSecretKey, setMainnetSecretKey] = useState('')
  const [mainnetMaxLeverage, setMainnetMaxLeverage] = useState(20)
  const [mainnetDefaultLeverage, setMainnetDefaultLeverage] = useState(1)

  // Rebate ineligible modal state
  const [showRebateModal, setShowRebateModal] = useState(false)
  const [rebateInfo, setRebateInfo] = useState<{ rebate_working: boolean; is_new_user: boolean } | undefined>()
  // Store pending mainnet binding params for confirm-limited-binding
  const [pendingMainnetBinding, setPendingMainnetBinding] = useState<{
    api_key: string
    secret_key: string
    max_leverage: number
    default_leverage: number
  } | null>(null)
  // Daily quota for mainnet non-rebate accounts
  const [mainnetQuota, setMainnetQuota] = useState<{ limited: boolean; used: number; limit: number; remaining: number } | null>(null)

  useEffect(() => {
    loadWalletInfo()
  }, [accountId])

  const loadWalletInfo = async () => {
    try {
      setLoadingConfig(true)
      const res = await fetch(`${API_BASE}/accounts/${accountId}/config`)
      if (!res.ok) return

      const data = await res.json()
      const testnetConfigured = data.testnet_configured
      const mainnetConfigured = data.mainnet_configured

      onStatusChange?.('testnet', testnetConfigured)
      onStatusChange?.('mainnet', mainnetConfigured)

      if (testnetConfigured) {
        setTestnetWallet({
          configured: true,
          apiKeyMasked: data.testnet?.api_key_masked,
          maxLeverage: data.testnet?.max_leverage || 20,
          defaultLeverage: data.testnet?.default_leverage || 1,
          balance: undefined
        })
        setTestnetMaxLeverage(data.testnet?.max_leverage || 20)
        setTestnetDefaultLeverage(data.testnet?.default_leverage || 1)
        // Load balance
        try {
          const balanceRes = await fetch(`${API_BASE}/accounts/${accountId}/balance?environment=testnet`)
          if (balanceRes.ok) {
            const balance = await balanceRes.json()
            setTestnetWallet(prev => prev ? { ...prev, balance } : null)
          }
        } catch (e) {
          console.error('Failed to load testnet balance:', e)
        }
      } else {
        setTestnetWallet(null)
      }

      if (mainnetConfigured) {
        setMainnetWallet({
          configured: true,
          apiKeyMasked: data.mainnet?.api_key_masked,
          maxLeverage: data.mainnet?.max_leverage || 20,
          defaultLeverage: data.mainnet?.default_leverage || 1,
          balance: undefined
        })
        setMainnetMaxLeverage(data.mainnet?.max_leverage || 20)
        setMainnetDefaultLeverage(data.mainnet?.default_leverage || 1)
        // Load balance
        try {
          const balanceRes = await fetch(`${API_BASE}/accounts/${accountId}/balance?environment=mainnet`)
          if (balanceRes.ok) {
            const balance = await balanceRes.json()
            setMainnetWallet(prev => prev ? { ...prev, balance } : null)
          }
        } catch (e) {
          console.error('Failed to load mainnet balance:', e)
        }
        // Load daily quota for mainnet
        try {
          const quotaRes = await fetch(`${API_BASE}/accounts/${accountId}/daily-quota`)
          if (quotaRes.ok) {
            const quota = await quotaRes.json()
            if (quota.limited) {
              setMainnetQuota(quota)
            } else {
              setMainnetQuota(null)
            }
          }
        } catch (e) {
          console.error('Failed to load mainnet quota:', e)
        }
      } else {
        setMainnetWallet(null)
        setMainnetQuota(null)
      }
    } catch (error) {
      console.error('Failed to load Binance config:', error)
    } finally {
      setLoadingConfig(false)
    }
  }

  const handleSaveWallet = async (environment: 'testnet' | 'mainnet') => {
    const setSaving = environment === 'testnet' ? setSavingTestnet : setSavingMainnet
    const apiKey = environment === 'testnet' ? testnetApiKey : mainnetApiKey
    const secretKey = environment === 'testnet' ? testnetSecretKey : mainnetSecretKey
    const maxLev = environment === 'testnet' ? testnetMaxLeverage : mainnetMaxLeverage
    const defaultLev = environment === 'testnet' ? testnetDefaultLeverage : mainnetDefaultLeverage

    // Clean input: remove whitespace, newlines, invisible characters
    const cleanApiKey = apiKey.trim().replace(/[\s\r\n\t\u200B-\u200D\uFEFF]/g, '')
    const cleanSecretKey = secretKey.trim().replace(/[\s\r\n\t\u200B-\u200D\uFEFF]/g, '')

    if (!cleanApiKey || !cleanSecretKey) {
      toast.error('Please enter both API Key and Secret Key')
      return
    }

    // Validate format: API Key and Secret should be alphanumeric
    if (!/^[A-Za-z0-9]+$/.test(cleanApiKey)) {
      toast.error('API Key contains invalid characters. Please check for spaces or special characters.')
      return
    }
    if (!/^[A-Za-z0-9]+$/.test(cleanSecretKey)) {
      toast.error('Secret Key contains invalid characters. Please check for spaces or special characters.')
      return
    }

    try {
      setSaving(true)
      const res = await fetch(`${API_BASE}/accounts/${accountId}/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          environment,
          api_key: cleanApiKey,
          secret_key: cleanSecretKey,
          max_leverage: maxLev,
          default_leverage: defaultLev
        })
      })

      const data = await res.json()

      // Check for rebate ineligible response (mainnet only)
      if (data.error_code === 'REBATE_INELIGIBLE') {
        setRebateInfo(data.rebate_info)
        // Store binding params for confirm-limited-binding
        setPendingMainnetBinding({
          api_key: cleanApiKey,
          secret_key: cleanSecretKey,
          max_leverage: maxLev,
          default_leverage: defaultLev
        })
        setShowRebateModal(true)
        return
      }

      if (res.ok && data.success !== false) {
        toast.success(`Binance ${environment} configured`)
        if (environment === 'testnet') {
          setTestnetApiKey('')
          setTestnetSecretKey('')
          setEditingTestnet(false)
        } else {
          setMainnetApiKey('')
          setMainnetSecretKey('')
          setEditingMainnet(false)
        }
        await loadWalletInfo()
        onWalletConfigured?.()
      } else {
        let errorMsg = data.detail || data.message || 'Failed to configure'
        toast.error(errorMsg)
      }
    } catch (error) {
      toast.error('Network error. Please check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleTestConnection = async (environment: 'testnet' | 'mainnet') => {
    const setTesting = environment === 'testnet' ? setTestingTestnet : setTestingMainnet
    try {
      setTesting(true)
      const res = await fetch(`${API_BASE}/accounts/${accountId}/balance?environment=${environment}`)
      if (res.ok) {
        const data = await res.json()
        toast.success(`✅ Connected! Balance: $${data.total_equity?.toFixed(2) || '0.00'}`)
        // Update wallet balance
        if (environment === 'testnet' && testnetWallet) {
          setTestnetWallet({ ...testnetWallet, balance: data })
        } else if (environment === 'mainnet' && mainnetWallet) {
          setMainnetWallet({ ...mainnetWallet, balance: data })
        }
      } else {
        const err = await res.json()
        toast.error(`❌ ${err.detail || 'Connection failed'}`)
      }
    } catch (error) {
      toast.error('Connection test failed')
    } finally {
      setTesting(false)
    }
  }

  const handleConfirmLimitedBinding = async () => {
    if (!pendingMainnetBinding) return
    try {
      setSavingMainnet(true)
      const res = await fetch(`${API_BASE}/accounts/${accountId}/confirm-limited-binding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: pendingMainnetBinding.api_key,
          secret_key: pendingMainnetBinding.secret_key,
          max_leverage: pendingMainnetBinding.max_leverage,
          default_leverage: pendingMainnetBinding.default_leverage
        })
      })
      const data = await res.json()
      if (res.ok && data.success !== false) {
        toast.success('Binance mainnet configured (daily quota: 20)')
        setMainnetApiKey('')
        setMainnetSecretKey('')
        setEditingMainnet(false)
        setPendingMainnetBinding(null)
        await loadWalletInfo()
        onWalletConfigured?.()
      } else {
        toast.error(data.detail || data.message || 'Failed to configure')
      }
    } catch (error) {
      toast.error('Network error')
    } finally {
      setSavingMainnet(false)
    }
  }

  const handleDeleteWallet = async (environment: 'testnet' | 'mainnet') => {
    if (!confirm(`Delete Binance ${environment} wallet?`)) return
    const setSaving = environment === 'testnet' ? setSavingTestnet : setSavingMainnet
    try {
      setSaving(true)
      const res = await fetch(`${API_BASE}/accounts/${accountId}/wallet?environment=${environment}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        toast.success(`Binance ${environment} wallet deleted`)
        await loadWalletInfo()
        onWalletConfigured?.()
      }
    } catch (error) {
      toast.error('Failed to delete wallet')
    } finally {
      setSaving(false)
    }
  }

  const renderWalletBlock = (
    environment: 'testnet' | 'mainnet',
    wallet: BinanceWalletData | null,
    editing: boolean,
    setEditing: (v: boolean) => void,
    apiKey: string,
    setApiKey: (v: string) => void,
    secretKey: string,
    setSecretKey: (v: string) => void,
    maxLev: number,
    setMaxLev: (v: number) => void,
    defaultLev: number,
    setDefaultLev: (v: number) => void,
    showKey: boolean,
    setShowKey: (v: boolean) => void,
    saving: boolean,
    testing: boolean,
    quota?: { limited: boolean; used: number; limit: number; remaining: number } | null
  ) => {
    const envName = environment === 'testnet' ? 'Testnet' : 'Mainnet'
    const badgeVariant = environment === 'testnet' ? 'default' : 'destructive'

    return (
      <div className="p-4 border rounded-lg space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <Badge variant={badgeVariant} className="text-xs">
              {environment === 'testnet' ? 'TESTNET' : 'MAINNET'}
            </Badge>
            {environment === 'mainnet' && quota && (
              <span className="text-xs px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full" title={t('binance.continueLimitedDescription')}>
                {t('quota.executionQuota', 'Quota')}: {quota.remaining}/{quota.limit}
              </span>
            )}
          </div>
          {wallet && !editing && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                {t('common.edit', 'Edit')}
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleDeleteWallet(environment)} disabled={saving}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        {wallet && !editing ? (
          <div className="space-y-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">API Key</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-2 py-1 bg-muted rounded text-xs overflow-hidden">
                  {wallet.apiKeyMasked || '****'}
                </code>
                <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
              </div>
            </div>

            {wallet.balance && (
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground">{t('wallet.balance', 'Balance')}</div>
                  <div className="font-medium">${wallet.balance.total_equity?.toFixed(2) || '0.00'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t('wallet.available', 'Available')}</div>
                  <div className="font-medium">${wallet.balance.available_balance?.toFixed(2) || '0.00'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">PnL</div>
                  <div className={`font-medium ${(wallet.balance.unrealized_pnl || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    ${wallet.balance.unrealized_pnl?.toFixed(2) || '0.00'}
                  </div>
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
            {!wallet && (
              <div className="p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs">
                <p className="text-yellow-800 dark:text-yellow-200">⚠️ No {envName.toLowerCase()} API configured.</p>
              </div>
            )}

            <div className="p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs">
              <p className="text-blue-800 dark:text-blue-200">
                {t('binance.positionModeHint', 'Requires One-way Position Mode. Go to Binance App → Futures → Settings → Position Mode → One-way Mode')}
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">API Key</label>
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your Binance API Key"
                className="font-mono text-xs h-8"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Secret Key</label>
              <div className="flex gap-2">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  placeholder="Enter your Binance Secret Key"
                  className="font-mono text-xs h-8"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => setShowKey(!showKey)} className="h-8 px-2">
                  {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                CEX uses API credentials for authentication. Enable Futures trading permission in Binance.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('wallet.maxLeverage', 'Max Leverage')}</label>
                <Input type="number" value={maxLev} onChange={(e) => setMaxLev(Number(e.target.value))} min={1} max={125} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('wallet.defaultLeverage', 'Default Leverage')}</label>
                <Input type="number" value={defaultLev} onChange={(e) => setDefaultLev(Number(e.target.value))} min={1} max={maxLev} className="h-8 text-xs" />
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={() => handleSaveWallet(environment)} disabled={saving} size="sm" className="flex-1 h-8 text-xs">
                {saving ? <><RefreshCw className="mr-2 h-3 w-3 animate-spin" />{t('wallet.saving', 'Saving...')}</> : t('wallet.saveWallet', 'Save Wallet')}
              </Button>
              {editing && (
                <Button variant="outline" onClick={() => { setEditing(false); setApiKey(''); setSecretKey('') }} size="sm" className="h-8 text-xs">
                  {t('common.cancel', 'Cancel')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (loadingConfig && !testnetWallet && !mainnetWallet) {
    return (
      <div className="flex items-center justify-center py-4">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
      {renderWalletBlock(
        'testnet', testnetWallet, editingTestnet, setEditingTestnet,
        testnetApiKey, setTestnetApiKey, testnetSecretKey, setTestnetSecretKey,
        testnetMaxLeverage, setTestnetMaxLeverage,
        testnetDefaultLeverage, setTestnetDefaultLeverage,
        showTestnetKey, setShowTestnetKey, savingTestnet, testingTestnet,
        null
      )}
      {renderWalletBlock(
        'mainnet', mainnetWallet, editingMainnet, setEditingMainnet,
        mainnetApiKey, setMainnetApiKey, mainnetSecretKey, setMainnetSecretKey,
        mainnetMaxLeverage, setMainnetMaxLeverage,
        mainnetDefaultLeverage, setMainnetDefaultLeverage,
        showMainnetKey, setShowMainnetKey, savingMainnet, testingMainnet,
        mainnetQuota
      )}

      {/* Rebate Ineligible Modal */}
      <RebateIneligibleModal
        isOpen={showRebateModal}
        onClose={() => setShowRebateModal(false)}
        onConfirmLimited={handleConfirmLimitedBinding}
        rebateInfo={rebateInfo}
      />
    </div>
  )
}