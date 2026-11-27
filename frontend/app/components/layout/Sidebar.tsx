import { useState } from 'react'
import {
  CandlestickChart,
  LayoutDashboard,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  SquareCode,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { NAV_GROUPS } from '@/lib/navigation'
import { cn } from '@/lib/utils'

const COLLAPSED_KEY = 'quantpilot-sidebar-collapsed'

const MOBILE_TABS = [
  { page: 'comprehensive', label: ['sidebar.dashboard', 'Dashboard'], icon: LayoutDashboard },
  { page: 'klines', label: ['sidebar.klines', 'K-Lines'], icon: CandlestickChart },
  { page: 'model-chat', label: ['nav.modelChat', 'Model Chat'], icon: MessageSquare },
  { page: 'program-trader', label: ['sidebar.programTrader', 'Programs'], icon: SquareCode },
] as const

interface SidebarProps {
  currentPage?: string
  onPageChange?: (page: string) => void
}

export default function Sidebar({ currentPage = 'comprehensive', onPageChange }: SidebarProps) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })

  const toggleCollapsed = () => {
    const next = !collapsed
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      // Storage unavailable: keep the choice for this visit only
    }
    setCollapsed(next)
  }

  const toggleLabel = collapsed
    ? t('nav.expand', 'Expand sidebar')
    : t('nav.collapse', 'Collapse sidebar')

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden md:flex h-full shrink-0 flex-col border-r bg-card transition-[width] duration-200',
          collapsed ? 'w-[68px]' : 'w-60',
        )}
      >
        <div className={cn('flex h-14 shrink-0 items-center gap-2.5 border-b', collapsed ? 'justify-center' : 'px-4')}>
          <img src="/static/logo.svg" alt="QuantPilot" className="h-8 w-8 shrink-0" />
          {!collapsed && <span className="text-[15px] font-semibold tracking-tight">QuantPilot</span>}
        </div>

        <TooltipProvider delayDuration={200}>
          <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label={t('nav.main', 'Main navigation')}>
            {NAV_GROUPS.map((group, index) => (
              <div key={group.label[0]} className={cn(index > 0 && 'mt-4')}>
                {collapsed ? (
                  index > 0 && <div className="mx-2 mb-3 border-t" />
                ) : (
                  <p className="mb-1 px-3 text-[11px] font-medium text-muted-foreground/80">
                    {t(...group.label)}
                  </p>
                )}
                <ul className="space-y-0.5">
                  {group.items.map(item => {
                    const Icon = item.icon
                    const active = currentPage === item.page
                    const label = t(...item.label)
                    const button = (
                      <button
                        type="button"
                        onClick={() => onPageChange?.(item.page)}
                        aria-current={active ? 'page' : undefined}
                        aria-label={collapsed ? label : undefined}
                        className={cn(
                          'relative flex h-9 w-full items-center gap-3 rounded-md text-sm transition-colors',
                          collapsed ? 'justify-center' : 'px-3',
                          active
                            ? 'bg-primary/10 font-medium text-primary'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />}
                        <Icon className="h-[18px] w-[18px] shrink-0" />
                        {!collapsed && <span className="truncate">{label}</span>}
                      </button>
                    )
                    return (
                      <li key={item.page}>
                        {collapsed ? (
                          <Tooltip>
                            <TooltipTrigger asChild>{button}</TooltipTrigger>
                            <TooltipContent side="right">{label}</TooltipContent>
                          </Tooltip>
                        ) : (
                          button
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </TooltipProvider>

        <div className={cn('flex items-center border-t p-3', collapsed ? 'justify-center' : 'justify-between')}>
          {!collapsed && (
            <span className="px-1 text-[11px] text-muted-foreground">v{__APP_VERSION__}</span>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={toggleLabel}
            title={toggleLabel}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
      </aside>

      {/* Mobile bottom tabs */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t bg-card px-2 md:hidden">
        {MOBILE_TABS.map(tab => {
          const Icon = tab.icon
          const active = currentPage === tab.page
          return (
            <button
              key={tab.page}
              type="button"
              onClick={() => onPageChange?.(tab.page)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-12 flex-1 flex-col items-center justify-center rounded-lg transition-colors',
                active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="mt-1 text-xs">{t(tab.label[0], tab.label[1])}</span>
            </button>
          )
        })}
      </nav>
    </>
  )
}
