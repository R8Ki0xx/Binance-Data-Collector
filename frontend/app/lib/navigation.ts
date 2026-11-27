import {
  ArrowLeftRight,
  Bot,
  CandlestickChart,
  FileText,
  FlaskConical,
  LayoutDashboard,
  LucideIcon,
  NotebookPen,
  PieChart,
  Radio,
  Settings,
  Sparkles,
  SquareCode,
} from 'lucide-react'

export interface NavItem {
  page: string
  /** Translation key and English fallback */
  label: [string, string]
  icon: LucideIcon
}

export interface NavGroup {
  label: [string, string]
  items: NavItem[]
}

/** Single source for the sidebar entries and the header titles. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: ['nav.overview', 'Overview'],
    items: [
      { page: 'comprehensive', label: ['sidebar.dashboard', 'Dashboard'], icon: LayoutDashboard },
      { page: 'hyper-ai', label: ['hyperAi.title', 'Pilot AI'], icon: Sparkles },
    ],
  },
  {
    label: ['nav.strategy', 'Strategy'],
    items: [
      { page: 'trader-management', label: ['sidebar.aiTrader', 'AI Trader'], icon: Bot },
      { page: 'prompt-management', label: ['sidebar.prompts', 'Prompts'], icon: NotebookPen },
      { page: 'program-trader', label: ['sidebar.programTrader', 'Programs'], icon: SquareCode },
      { page: 'signal-management', label: ['sidebar.signals', 'Signals'], icon: Radio },
      { page: 'factor-library', label: ['sidebar.factorLibrary', 'Factors'], icon: FlaskConical },
    ],
  },
  {
    label: ['nav.markets', 'Markets & Trading'],
    items: [
      { page: 'klines', label: ['sidebar.klines', 'K-Lines'], icon: CandlestickChart },
      { page: 'hyperliquid', label: ['sidebar.manualTrading', 'Manual Trading'], icon: ArrowLeftRight },
    ],
  },
  {
    label: ['nav.system', 'Analysis & System'],
    items: [
      { page: 'attribution', label: ['sidebar.attribution', 'Attribution'], icon: PieChart },
      { page: 'system-logs', label: ['sidebar.systemLogs', 'System Logs'], icon: FileText },
      { page: 'settings', label: ['sidebar.settings', 'Settings'], icon: Settings },
    ],
  },
]

/** Pages reachable only on mobile or by link, so they have no sidebar entry. */
const OTHER_TITLES: Record<string, [string, string]> = {
  'model-chat': ['nav.modelChat', 'Model Chat'],
  'arena-assets': ['nav.arenaAssets', 'Arena Assets'],
}

export function findPage(page: string): { title: [string, string]; group?: [string, string] } {
  for (const group of NAV_GROUPS) {
    const item = group.items.find(entry => entry.page === page)
    if (item) return { title: item.label, group: group.label }
  }
  return { title: OTHER_TITLES[page] ?? ['sidebar.dashboard', 'Dashboard'] }
}

export function isKnownPage(page: string): boolean {
  return page in OTHER_TITLES || NAV_GROUPS.some(group => group.items.some(item => item.page === page))
}
