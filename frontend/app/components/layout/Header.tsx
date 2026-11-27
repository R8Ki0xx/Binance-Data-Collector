// Modified by QuantPilot contributors (2026). See NOTICE.
import { useState } from 'react'
import { AlertTriangle, Languages, Moon, ShieldCheck, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ExchangeIcon from '@/components/exchange/ExchangeIcon'
import ExchangeModal from '@/components/exchange/ExchangeModal'
import TradingModeConfirmDialog from '@/components/trading/TradingModeConfirmDialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useTheme } from '@/contexts/ThemeContext'
import { useTradingMode, type TradingMode } from '@/contexts/TradingModeContext'
import { setUiLanguage } from '@/lib/language'
import { findPage } from '@/lib/navigation'
import { cn } from '@/lib/utils'

const ICON_BUTTON =
  'inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-md border px-2 text-xs font-medium ' +
  'text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'

export default function Header({ currentPage }: { currentPage: string }) {
  const { t, i18n } = useTranslation()
  const { theme, toggleTheme } = useTheme()
  const { tradingMode, setTradingMode } = useTradingMode()
  const [exchangeOpen, setExchangeOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState<TradingMode | null>(null)

  const { title, group } = findPage(currentPage)
  const isChinese = i18n.language.startsWith('zh')
  const themeLabel = theme === 'dark'
    ? t('header.useLightTheme', 'Switch to light theme')
    : t('header.useDarkTheme', 'Switch to dark theme')
  const languageLabel = isChinese ? 'Switch to English' : '切换到中文'

  const modes = [
    {
      id: 'testnet' as const,
      name: 'Testnet',
      icon: ShieldCheck,
      activeClass: 'bg-primary text-primary-foreground',
      description: t('tradingMode.testnetDesc', 'Practice with test funds. Prices and volume differ from Mainnet. No real money at risk.'),
    },
    {
      id: 'mainnet' as const,
      name: 'Mainnet',
      icon: AlertTriangle,
      activeClass: 'bg-down text-white',
      description: t('tradingMode.mainnetDesc', 'Real money trading. Signal and market flow data is collected here. Losses are permanent.'),
    },
  ]

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-card px-3 md:px-5">
      <div className="min-w-0">
        {group && <p className="text-[11px] leading-tight text-muted-foreground">{t(...group)}</p>}
        <h1 className="truncate text-base font-semibold leading-tight">{t(...title)}</h1>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setExchangeOpen(true)}
          className={cn(ICON_BUTTON, 'hidden md:inline-flex')}
          title={t('header.supportedExchanges', 'Supported Exchanges')}
        >
          <ExchangeIcon exchangeId="hyperliquid" size={16} />
          <ExchangeIcon exchangeId="binance" size={16} />
          <span>{t('header.exchanges', 'Exchanges')}</span>
        </button>

        <TooltipProvider delayDuration={300}>
          <div
            className="hidden h-9 items-center gap-0.5 rounded-md border p-0.5 md:flex"
            role="group"
            aria-label={t('sidebar.tradingMode', 'Trading Mode')}
          >
            {modes.map(mode => {
              const Icon = mode.icon
              const active = tradingMode === mode.id
              return (
                <Tooltip key={mode.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => !active && setConfirmTarget(mode.id)}
                      aria-pressed={active}
                      className={cn(
                        'flex h-full items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors',
                        active ? mode.activeClass : 'text-muted-foreground hover:bg-muted',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {mode.name}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[240px]">
                    <p className="text-xs">{mode.description}</p>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </TooltipProvider>

        <button
          type="button"
          onClick={() => setUiLanguage(i18n, isChinese ? 'en' : 'zh')}
          className={ICON_BUTTON}
          aria-label={languageLabel}
          title={languageLabel}
        >
          <Languages className="h-4 w-4" />
          <span>{isChinese ? 'EN' : '中'}</span>
        </button>

        <button type="button" onClick={toggleTheme} className={ICON_BUTTON} aria-label={themeLabel} title={themeLabel}>
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>

      <ExchangeModal isOpen={exchangeOpen} onClose={() => setExchangeOpen(false)} />
      <TradingModeConfirmDialog
        isOpen={confirmTarget !== null}
        targetMode={confirmTarget}
        onConfirm={() => {
          if (confirmTarget) setTradingMode(confirmTarget)
          setConfirmTarget(null)
        }}
        onCancel={() => setConfirmTarget(null)}
      />
    </header>
  )
}
