import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import {
  previewPrompt,
  getAccounts,
  getHyperliquidWatchlist,
  getBinanceWatchlist,
  TradingAccount,
  PromptPreviewItem,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { copyToClipboard } from '@/lib/utils'
import { useTranslation } from 'react-i18next'

interface PromptPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  templateKey: string
  templateName: string
  templateText: string
}

export default function PromptPreviewDialog({
  open,
  onOpenChange,
  templateKey,
  templateName,
  templateText,
}: PromptPreviewDialogProps) {
  const [accounts, setAccounts] = useState<TradingAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [selectedExchanges, setSelectedExchanges] = useState<string[]>(['hyperliquid'])
  const [previews, setPreviews] = useState<PromptPreviewItem[]>([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [hyperliquidWatchlist, setHyperliquidWatchlist] = useState<string[]>([])
  const [binanceWatchlist, setBinanceWatchlist] = useState<string[]>([])
  const [watchlistLoading, setWatchlistLoading] = useState(false)
  const { t } = useTranslation()

  useEffect(() => {
    if (open) {
      loadAccounts()
      loadWatchlists()
    }
  }, [open, templateKey])

  const loadAccounts = async () => {
    setLoading(true)
    try {
      const list = await getAccounts()
      const aiAccounts = list.filter((acc) => acc.account_type === 'AI')
      setAccounts(aiAccounts)
      if (aiAccounts.length > 0 && selectedAccountId === null) {
        setSelectedAccountId(aiAccounts[0].id)
      }
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'Failed to load AI traders')
    } finally {
      setLoading(false)
    }
  }

  const loadWatchlists = async () => {
    setWatchlistLoading(true)
    try {
      const [hlResponse, bnResponse] = await Promise.all([
        getHyperliquidWatchlist(),
        getBinanceWatchlist(),
      ])
      setHyperliquidWatchlist(hlResponse.symbols ?? [])
      setBinanceWatchlist(bnResponse.symbols ?? [])
    } catch (err) {
      console.error(err)
      toast.error('Failed to load watchlists')
    } finally {
      setWatchlistLoading(false)
    }
  }

  const handleAccountSelect = (accountId: number) => {
    setSelectedAccountId(accountId)
  }

  const handleExchangeToggle = (exchange: string) => {
    setSelectedExchanges((prev) => {
      if (prev.includes(exchange)) {
        if (prev.length === 1) return prev
        return prev.filter((e) => e !== exchange)
      }
      return [...prev, exchange]
    })
  }

  const handleGeneratePreview = async () => {
    if (selectedAccountId === null) {
      toast.error('Please select an AI trader')
      return
    }
    if (selectedExchanges.length === 0) {
      toast.error('Please select at least one exchange')
      return
    }

    setGenerating(true)
    try {
      const result = await previewPrompt({
        templateText: templateText,
        promptTemplateKey: templateKey,
        accountIds: [selectedAccountId],
        exchanges: selectedExchanges,
      })
      setPreviews(result.previews)
      toast.success(`Generated ${result.previews.length} preview(s)`)
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'Failed to generate preview')
    } finally {
      setGenerating(false)
    }
  }

  const handleCopyToClipboard = async (text: string) => {
    const success = await copyToClipboard(text)
    if (success) {
      toast.success('Copied to clipboard')
    } else {
      toast.error('Failed to copy to clipboard')
    }
  }

  const getTabKey = (preview: PromptPreviewItem) => {
    return `${preview.accountId}-${preview.exchange || 'default'}`
  }

  const getTabLabel = (preview: PromptPreviewItem) => {
    const exchangeLabel = preview.exchange
      ? preview.exchange === 'hyperliquid' ? 'HL' : 'BN'
      : ''
    return exchangeLabel ? `${preview.accountName} (${exchangeLabel})` : preview.accountName
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Prompt Preview: {templateName}</DialogTitle>
          <DialogDescription>
            Select AI traders and exchanges to preview the filled prompt with real-time data
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 grid grid-cols-[300px_1fr] gap-4 overflow-hidden">
          {/* Left Panel: Selection */}
          <div className="border rounded-lg p-4 flex flex-col gap-4 overflow-auto">
            <div>
              <h3 className="text-sm font-semibold mb-2">Select AI Traders</h3>
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No AI traders found</p>
              ) : (
                <div className="space-y-2">
                  {accounts.map((account) => (
                    <div key={account.id} className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name="ai-trader-select"
                        id={`account-${account.id}`}
                        checked={selectedAccountId === account.id}
                        onChange={() => handleAccountSelect(account.id)}
                        className="w-4 h-4 cursor-pointer"
                      />
                      <label
                        htmlFor={`account-${account.id}`}
                        className="text-sm cursor-pointer flex-1"
                      >
                        {account.name}
                        {account.model && (
                          <span className="text-xs text-muted-foreground ml-1">
                            ({account.model})
                          </span>
                        )}
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold mb-2">{t('strategy.exchange', 'Exchange')}</h3>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="exchange-hyperliquid"
                    checked={selectedExchanges.includes('hyperliquid')}
                    onChange={() => handleExchangeToggle('hyperliquid')}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <label htmlFor="exchange-hyperliquid" className="text-sm cursor-pointer">
                    {t('strategy.exchangeHyperliquid', 'Hyperliquid')}
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="exchange-binance"
                    checked={selectedExchanges.includes('binance')}
                    onChange={() => handleExchangeToggle('binance')}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <label htmlFor="exchange-binance" className="text-sm cursor-pointer">
                    {t('strategy.exchangeBinance', 'Binance')}
                  </label>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {t('strategy.exchangeHintMulti', 'Select exchanges to compare data sources')}
              </p>
            </div>

            {templateKey === 'hyperliquid' && (
              <div className="border-t pt-4">
                <h3 className="text-sm font-semibold mb-2">Configured Watchlists</h3>
                <p className="text-xs text-muted-foreground mb-2">
                  Prompt preview uses the watchlist symbols for the selected exchange
                </p>
                {watchlistLoading ? (
                  <p className="text-xs text-muted-foreground">Loading watchlist…</p>
                ) : (
                  <div className="space-y-3">
                    {selectedExchanges.includes('hyperliquid') && (
                      <div>
                        <p className="text-xs font-medium mb-1">Hyperliquid:</p>
                        {hyperliquidWatchlist.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No symbols configured</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {hyperliquidWatchlist.map((symbol) => (
                              <span key={symbol} className="px-2 py-1 text-xs border rounded-md bg-muted text-muted-foreground">
                                {symbol}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {selectedExchanges.includes('binance') && (
                      <div>
                        <p className="text-xs font-medium mb-1">Binance:</p>
                        {binanceWatchlist.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No symbols configured</p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {binanceWatchlist.map((symbol) => (
                              <span key={symbol} className="px-2 py-1 text-xs border rounded-md bg-muted text-muted-foreground">
                                {symbol}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <Button
              onClick={handleGeneratePreview}
              disabled={generating || selectedAccountId === null || selectedExchanges.length === 0}
              className="mt-4"
            >
              {generating ? 'Generating...' : 'Generate Preview'}
            </Button>
          </div>

          {/* Right Panel: Preview Results */}
          <div className="border rounded-lg flex flex-col overflow-hidden">
            {previews.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <div className="text-center">
                  <p className="text-sm">No previews generated yet</p>
                  <p className="text-xs mt-1">Select traders and click Generate Preview</p>
                </div>
              </div>
            ) : (
              <Tabs defaultValue={getTabKey(previews[0])} className="flex-1 flex flex-col">
                <TabsList className="w-full justify-start overflow-x-auto flex-shrink-0">
                  {previews.map((preview) => (
                    <TabsTrigger
                      key={getTabKey(preview)}
                      value={getTabKey(preview)}
                      className="text-xs"
                    >
                      {getTabLabel(preview)}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {previews.map((preview) => (
                  <TabsContent
                    key={getTabKey(preview)}
                    value={getTabKey(preview)}
                    className="flex-1 flex flex-col overflow-hidden mt-0"
                  >
                    <div className="flex items-center justify-between p-3 border-b">
                      <div>
                        <p className="text-sm font-semibold">{preview.accountName}</p>
                        <p className="text-xs text-muted-foreground">
                          {preview.exchange === 'binance' ? 'Binance' : 'Hyperliquid'}
                          {preview.symbols && preview.symbols.length > 0 && (
                            <span> | Symbols: {preview.symbols.join(', ')}</span>
                          )}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopyToClipboard(preview.filledPrompt)}
                      >
                        Copy to Clipboard
                      </Button>
                    </div>

                    <ScrollArea className="flex-1 p-4">
                      <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                        {preview.filledPrompt}
                      </pre>
                    </ScrollArea>
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
