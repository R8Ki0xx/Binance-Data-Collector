import { useTranslation } from 'react-i18next'
import type { CharacterState } from './pixelData/characters'

interface TraderHUDProps {
  name: string
  equity: number | null
  unrealizedPnl: number | null
  positionCount: number
  state: CharacterState
}

const STATE_LABELS: Record<CharacterState, { key: string; fallback: string; dotColor: string }> = {
  offline:        { key: 'arena.status.offline',  fallback: 'Offline',  dotColor: 'bg-gray-500' },
  error:          { key: 'arena.status.error',    fallback: 'Error',    dotColor: 'bg-red-500' },
  program_running:{ key: 'arena.status.program',  fallback: 'Program',  dotColor: 'bg-violet-500' },
  just_traded:    { key: 'arena.status.traded',   fallback: 'Traded',   dotColor: 'bg-yellow-500' },
  ai_thinking:    { key: 'arena.status.thinking', fallback: 'Thinking', dotColor: 'bg-blue-500' },
  holding_profit: { key: 'arena.status.profit',   fallback: 'Profit',   dotColor: 'bg-green-500' },
  holding_loss:   { key: 'arena.status.loss',     fallback: 'Loss',     dotColor: 'bg-red-500' },
  idle:           { key: 'arena.status.idle',      fallback: 'Idle',     dotColor: 'bg-gray-400' },
}

export default function TraderHUD({
  name,
  equity,
  unrealizedPnl,
  positionCount,
  state,
}: TraderHUDProps) {
  const { t } = useTranslation()
  const label = STATE_LABELS[state]

  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 z-20 pointer-events-none group-hover:pointer-events-auto">
      {/* Default: compact badge */}
      <div className="px-2 py-1 rounded-md bg-black/70 backdrop-blur-sm border border-white/10 text-center whitespace-nowrap">
        <div className="text-[10px] font-semibold text-white/90 truncate max-w-[120px]">
          {name}
        </div>
        {equity !== null && (
          <div className="text-[9px] text-white/60 font-mono">
            ${equity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </div>
        )}
        <div className="flex items-center justify-center gap-1 mt-0.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${label.dotColor}`} />
          <span className="text-[8px] text-white/50">
            {t(label.key, label.fallback)}
          </span>
        </div>
      </div>

      {/* Hover: expanded detail */}
      <div className="hidden group-hover:block mt-1 px-2 py-1.5 rounded-md bg-black/80 backdrop-blur-sm border border-white/10 text-center whitespace-nowrap">
        {unrealizedPnl !== null && unrealizedPnl !== 0 && (
          <div className={`text-[9px] font-mono font-bold ${unrealizedPnl > 0 ? 'text-green-400' : 'text-red-400'}`}>
            PnL: {unrealizedPnl > 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
          </div>
        )}
        <div className="text-[8px] text-white/40">
          {positionCount > 0
            ? `${positionCount} ${t('arena.hud.positions', 'pos')}`
            : t('arena.hud.noPositions', 'No positions')}
        </div>
      </div>
    </div>
  )
}
