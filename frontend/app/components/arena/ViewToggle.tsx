import { useTranslation } from 'react-i18next'

export type ViewMode = 'arena' | 'chart' | 'insight'

const STORAGE_KEY = 'arena_view_mode'

interface ViewToggleProps {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}

export function getStoredViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'arena'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'arena' || stored === 'chart' || stored === 'insight') return stored
  return 'chart'
}

export function storeViewMode(mode: ViewMode) {
  localStorage.setItem(STORAGE_KEY, mode)
}

export default function ViewToggle({ mode, onChange }: ViewToggleProps) {
  const { t } = useTranslation()

  const handleToggle = (newMode: ViewMode) => {
    if (newMode === mode) return
    storeViewMode(newMode)
    onChange(newMode)
  }

  return (
    <div className="inline-flex rounded-lg border border-border bg-muted p-0.5 text-xs">
      <button
        onClick={() => handleToggle('arena')}
        className={`px-3 py-1 rounded-md transition-colors ${
          mode === 'arena'
            ? 'bg-background text-foreground shadow-sm font-medium'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {t('arena.viewToggle.arena', 'Arena')}
      </button>
      <button
        onClick={() => handleToggle('chart')}
        className={`px-3 py-1 rounded-md transition-colors ${
          mode === 'chart'
            ? 'bg-background text-foreground shadow-sm font-medium'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {t('arena.viewToggle.chart', 'Chart')}
      </button>
      <button
        onClick={() => handleToggle('insight')}
        className={`px-3 py-1 rounded-md transition-colors ${
          mode === 'insight'
            ? 'bg-background text-foreground shadow-sm font-medium'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {t('arena.viewToggle.insight', 'Insight')}
      </button>
    </div>
  )
}
