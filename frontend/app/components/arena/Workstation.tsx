import { useEffect, useState, useMemo, useRef } from 'react'
import PixelCharacter from './PixelCharacter'
import type { CharacterState } from './pixelData/characters'
import type { ExchangeMonitor, MonitorPosition } from './TradingFloor'

interface WorkstationProps {
  traderName: string
  exchanges: ExchangeMonitor[]
  avatarPresetId: number | null
  state: CharacterState
  animationMap?: Record<string, string>
  activitySignal?: {
    seq: number
    exchange: string
    state: 'program_running' | 'ai_thinking'
  }
}

const EXCHANGE_LABEL: Record<string, { short: string; color: string }> = {
  hyperliquid: { short: 'HL', color: '#6ee7b7' },
  binance: { short: 'BN', color: '#f0b90b' },
}

const MOVE_DURATION_MS = 1100
const ACTIVITY_DWELL_MS = 7000

function getScreenBg(pnl: number | null): string {
  if (pnl && pnl > 0) return '#071208'
  if (pnl && pnl < 0) return '#120708'
  return '#070a12'
}

function MiniEquityLine({ data, color, width, height }: {
  data: number[]; color: string; width: number; height: number
}) {
  if (data.length < 2) return null
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pad = 1
  const w = width - pad * 2
  const h = height - pad * 2
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * w
    const y = pad + h - ((v - min) / range) * h
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.2} opacity={0.7} />
    </svg>
  )
}

function PositionTicker({ positions }: { positions: MonitorPosition[] }) {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (positions.length <= 1) return
    const t = setInterval(() => setIdx(i => (i + 1) % positions.length), 2000)
    return () => clearInterval(t)
  }, [positions.length])
  if (positions.length === 0) return null
  const p = positions[idx % positions.length]
  const sideColor = p.side === 'LONG' ? '#4ade80' : '#f87171'
  const pnlColor = p.unrealizedPnl >= 0 ? '#4ade80' : '#f87171'
  return (
    <div className="flex items-center gap-1 font-mono" style={{ fontSize: 8, lineHeight: 1 }}>
      <span style={{ color: 'rgba(255,255,255,0.6)' }}>{p.symbol.replace('-USD', '').replace('USDT', '')}</span>
      <span style={{ color: sideColor, fontWeight: 'bold' }}>{p.side === 'LONG' ? 'L' : 'S'}</span>
      <span style={{ color: pnlColor }}>
        {p.unrealizedPnl >= 0 ? '+' : ''}{p.unrealizedPnl.toFixed(1)}
      </span>
    </div>
  )
}

function MonitorScreen({ ex, isOff }: {
  ex: ExchangeMonitor; isOff: boolean
}) {
  const [cursorOn, setCursorOn] = useState(true)
  const label = EXCHANGE_LABEL[ex.exchange] || {
    short: ex.exchange.slice(0, 2).toUpperCase(), color: '#9ca3af',
  }

  useEffect(() => {
    if (isOff) return
    const t = setInterval(() => setCursorOn(v => !v), 600)
    return () => clearInterval(t)
  }, [isOff])

  const chartColor = ex.unrealizedPnl && ex.unrealizedPnl > 0
    ? '#16a34a' : ex.unrealizedPnl && ex.unrealizedPnl < 0
    ? '#dc2626' : '#3b82f6'

  return (
    <div className="flex flex-col w-full h-full p-1.5" style={{ gap: 1 }}>
      {/* Header: exchange label + equity */}
      <div className="flex items-center justify-between">
        <span className="font-mono font-bold" style={{
          fontSize: 10, color: label.color,
        }}>
          {label.short}
        </span>
        {isOff && (
          <span className="font-mono" style={{
            fontSize: 8, color: 'rgba(255,255,255,0.35)',
          }}>SLEEP</span>
        )}
        {!isOff && ex.equity !== null && (
          <span className="font-mono" style={{
            fontSize: 9, color: 'rgba(255,255,255,0.6)',
          }}>
            ${ex.equity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </span>
        )}
      </div>
      {/* PnL line */}
      {!isOff && (
        <div className="flex items-center justify-between">
          {ex.unrealizedPnl !== null && ex.unrealizedPnl !== 0 ? (
            <span className="font-mono font-bold" style={{
              fontSize: 10,
              color: ex.unrealizedPnl > 0 ? '#4ade80' : '#f87171',
            }}>
              {ex.unrealizedPnl > 0 ? '+' : ''}
              ${Math.abs(ex.unrealizedPnl).toFixed(1)}
            </span>
          ) : (
            <span className="font-mono" style={{
              fontSize: 9,
              color: cursorOn ? '#4ade80' : 'transparent',
            }}>_</span>
          )}
          {ex.positionCount > 0 && (
            <span className="font-mono" style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)' }}>
              {ex.positionCount} pos
            </span>
          )}
        </div>
      )}
      {/* Position ticker */}
      {!isOff && ex.positions.length > 0 && (
        <PositionTicker positions={ex.positions} />
      )}
      {/* Mini equity chart */}
      {!isOff && (
        <div className="mt-auto" style={{ height: 20 }}>
          {ex.equityHistory.length >= 2 ? (
            <MiniEquityLine data={ex.equityHistory} color={chartColor} width={155} height={20} />
          ) : (
            <div className="flex items-end gap-px" style={{ height: 12 }}>
              {[3, 5, 4, 7, 5, 8, 6, 4, 7, 5, 6, 8].map((h, i) => (
                <div key={i} style={{
                  width: 2, height: h, borderRadius: 1, opacity: 0.3,
                  background: chartColor,
                }} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Monitor({ ex, isOff, width, height }: {
  ex: ExchangeMonitor; isOff: boolean; width: number; height: number
}) {
  const bg = isOff ? '#0a0a0a' : getScreenBg(ex.unrealizedPnl)
  const ledColor = isOff ? '#6b7280'
    : ex.unrealizedPnl && ex.unrealizedPnl > 0 ? '#22c55e'
    : ex.unrealizedPnl && ex.unrealizedPnl < 0 ? '#ef4444' : '#3b82f6'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <div style={{
        width, height,
        background: '#1a1c28', borderRadius: 5,
        border: '2px solid #2a2d3a', padding: 3, position: 'relative',
      }}>
        <div style={{
          width: '100%', height: '100%', background: bg,
          borderRadius: 3, overflow: 'hidden',
        }}>
          <MonitorScreen ex={ex} isOff={isOff} />
        </div>
        <div className="absolute top-1 left-2 rounded-full bg-white/5"
          style={{ width: 6, height: 2 }} />
        <div className="absolute" style={{
          bottom: 2, right: 4, width: 4, height: 4, borderRadius: '50%',
          background: ledColor, boxShadow: `0 0 4px ${ledColor}`,
        }} />
      </div>
      <div style={{ width: 8, height: 4, background: '#1a1d28' }} />
      <div style={{
        width: Math.min(width * 0.5, 30), height: 3,
        background: '#1a1d28', borderRadius: 2,
      }} />
    </div>
  )
}

const EMOJI_PATH = '/static/arena-sprites/assets/emoji'

type MoodOption = {
  bg: string
  img?: string
  emoji?: string
}

const STATE_MOODS: Partial<Record<CharacterState, MoodOption[]>> = {
  offline: [{ img: `${EMOJI_PATH}/sleeping.png`, bg: '#1e293b' }],
  idle: [
    { emoji: '☕', bg: '#3b2f1e' },
    { img: `${EMOJI_PATH}/lightbulb.png`, bg: '#1e3a5f' },
  ],
  holding_profit: [{ img: `${EMOJI_PATH}/grinning.png`, bg: '#14532d' }],
  holding_loss: [{ img: `${EMOJI_PATH}/sad.png`, bg: '#78350f' }],
  just_traded: [{ img: `${EMOJI_PATH}/zap.png`, bg: '#4a1d96' }],
  ai_thinking: [{ img: `${EMOJI_PATH}/robot.png`, bg: '#1e3a5f' }],
  error: [{ img: `${EMOJI_PATH}/angry.png`, bg: '#7f1d1d' }],
}

function MoodBubble({ state }: { state: CharacterState }) {
  const [moodIndex, setMoodIndex] = useState(0)

  useEffect(() => {
    const moods = STATE_MOODS[state] || []
    if (moods.length === 0) {
      setMoodIndex(0)
      return
    }

    const pickMoodIndex = () => {
      if (state === 'idle') {
        return Math.random() < 0.7 ? 0 : 1
      }
      return 0
    }

    setMoodIndex(pickMoodIndex())

    if (state !== 'idle') {
      return
    }

    const timer = setInterval(() => {
      setMoodIndex(pickMoodIndex())
    }, 6000)

    return () => clearInterval(timer)
  }, [state])

  const mood = (STATE_MOODS[state] || [])[moodIndex]
  if (!mood) return null

  return (
    <div className="absolute" style={{
      top: 6, right: -8, zIndex: 15,
    }}>
      <div style={{
        position: 'relative',
        background: mood.bg, border: '2px solid rgba(255,255,255,0.2)',
        borderRadius: 10, padding: 3,
        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
      }}>
        {mood.img ? (
          <img src={mood.img} alt="" style={{ width: 20, height: 20, display: 'block' }} />
        ) : (
          <span style={{ display: 'block', fontSize: 18, lineHeight: 1 }}>{mood.emoji}</span>
        )}
        <div style={{
          position: 'absolute', bottom: -6, left: 3,
          width: 0, height: 0,
          borderTop: `6px solid ${mood.bg}`,
          borderRight: '6px solid transparent',
        }} />
      </div>
    </div>
  )
}

export default function Workstation({
  traderName, exchanges, avatarPresetId, state, animationMap, activitySignal,
}: WorkstationProps) {
  const isDual = exchanges.length >= 2
  const isOff = state === 'offline'

  // Data-driven: character stands at the exchange with more activity
  const targetIdx = useMemo(() => {
    if (!isDual || isOff) return 0
    const [a, b] = exchanges
    // Prefer exchange with open positions
    if (b.positionCount > 0 && a.positionCount === 0) return 1
    if (a.positionCount > 0 && b.positionCount === 0) return 0
    // Both have positions: prefer higher abs PnL
    if (a.positionCount > 0 && b.positionCount > 0) {
      return Math.abs(b.unrealizedPnl || 0) > Math.abs(a.unrealizedPnl || 0) ? 1 : 0
    }
    return 0
  }, [isDual, isOff, exchanges])

  const [displayIdx, setDisplayIdx] = useState(targetIdx)
  const [travelIdx, setTravelIdx] = useState<number | null>(null)
  const [isMoving, setIsMoving] = useState(false)
  const [dwellState, setDwellState] = useState<CharacterState | null>(null)
  const [charDir, setCharDir] = useState<'up' | 'down' | 'left' | 'right'>(isOff ? 'down' : 'up')
  const timeoutRef = useRef<{ arrival: ReturnType<typeof setTimeout> | null; settle: ReturnType<typeof setTimeout> | null }>({
    arrival: null,
    settle: null,
  })
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const currentIdxRef = useRef(targetIdx)
  const lastDirectionRef = useRef<'up' | 'down' | 'left' | 'right'>('up')

  const clearPulseTimeouts = () => {
    if (timeoutRef.current.arrival) {
      clearTimeout(timeoutRef.current.arrival)
      timeoutRef.current.arrival = null
    }
    if (timeoutRef.current.settle) {
      clearTimeout(timeoutRef.current.settle)
      timeoutRef.current.settle = null
    }
  }

  const clearPulseTimers = () => {
    clearPulseTimeouts()
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  useEffect(() => {
    if (!isDual || isOff) {
      setDisplayIdx(targetIdx)
      setTravelIdx(null)
      currentIdxRef.current = targetIdx
      setIsMoving(false)
      setDwellState(null)
      setCharDir(isOff ? 'down' : 'up')
      return
    }
    if (!isMoving && dwellState === null && displayIdx !== targetIdx) {
      const nextDir = targetIdx > displayIdx ? 'right' : 'left'
      lastDirectionRef.current = nextDir
      setCharDir(nextDir)
      setIsMoving(true)
      setTravelIdx(targetIdx)
      clearPulseTimeouts()
      timeoutRef.current.arrival = setTimeout(() => {
        setDisplayIdx(targetIdx)
        setTravelIdx(null)
        currentIdxRef.current = targetIdx
        setIsMoving(false)
        setCharDir('up')
      }, MOVE_DURATION_MS)
    }
  }, [isDual, isOff, targetIdx, displayIdx, isMoving, dwellState])

  const triggerPulse = (nextState: CharacterState, preferredIdx?: number) => {
    if (!isDual || isOff) return
    clearPulseTimeouts()

    const currentIdx = currentIdxRef.current
    const fallbackIdx = currentIdx === 0 ? 1 : 0
    const destinationIdx = preferredIdx === undefined
      ? fallbackIdx
      : preferredIdx === currentIdx
        ? fallbackIdx
        : preferredIdx
    const arrivalState = nextState === 'program_running' ? 'idle' : nextState

    setDwellState(null)

    if (destinationIdx === currentIdx) {
      setDisplayIdx(destinationIdx)
      setTravelIdx(null)
      setIsMoving(false)
      setCharDir('up')
      setDwellState(arrivalState)
      timeoutRef.current.settle = setTimeout(() => {
        setDwellState(null)
      }, ACTIVITY_DWELL_MS)
      return
    }

    const nextDir = destinationIdx > currentIdx ? 'right' : 'left'
    lastDirectionRef.current = nextDir
    setCharDir(nextDir)
    setIsMoving(true)
    setTravelIdx(destinationIdx)

    timeoutRef.current.arrival = setTimeout(() => {
      setDisplayIdx(destinationIdx)
      setTravelIdx(null)
      currentIdxRef.current = destinationIdx
      setIsMoving(false)
      setCharDir('up')
      setDwellState(arrivalState)
      timeoutRef.current.settle = setTimeout(() => {
        setDwellState(null)
      }, ACTIVITY_DWELL_MS)
    }, MOVE_DURATION_MS)
  }

  useEffect(() => {
    if (!activitySignal || !isDual || isOff) return
    const exchangeIdx = exchanges.findIndex(ex => ex.exchange === activitySignal.exchange)
    triggerPulse(activitySignal.state, exchangeIdx >= 0 ? exchangeIdx : undefined)
  }, [activitySignal?.seq])

  useEffect(() => {
    if (!isDual || isOff) return

    const startPulseLoop = () => {
      triggerPulse('idle')
    }

    const initialDelay = 20_000 + Math.random() * 20_000
    const initialTimer = setTimeout(() => {
      startPulseLoop()
      intervalRef.current = setInterval(() => {
        triggerPulse('idle')
      }, 60_000)
    }, initialDelay)

    return () => {
      clearTimeout(initialTimer)
      clearPulseTimers()
    }
  }, [isDual, isOff, targetIdx])

  useEffect(() => () => {
    clearPulseTimers()
  }, [])

  const charState = (() => {
    if (isOff) return 'offline' as const
    if (isMoving) return 'just_traded' as const
    if (dwellState) return dwellState
    if (!isDual) return state
    const ex = exchanges[displayIdx]
    if (ex?.unrealizedPnl && ex.unrealizedPnl > 0) return 'holding_profit' as const
    if (ex?.unrealizedPnl && ex.unrealizedPnl < 0) return 'holding_loss' as const
    return state
  })()

  // Layout: fixed monitor size, workstation width scales with monitor count
  const MON_W = 170
  const MON_H = 110
  const MON_GAP = 20
  const DESK_PAD = 40  // padding each side
  const monCount = Math.min(exchanges.length, 3)
  const monAreaW = monCount * MON_W + Math.max(0, monCount - 1) * MON_GAP
  const wWidth = monAreaW + DESK_PAD * 2

  const spread = monCount > 1 ? (MON_W + MON_GAP) / 2 : 0
  const visualIdx = travelIdx ?? displayIdx
  const charX = isDual && !isOff ? (visualIdx === 0 ? -spread : spread) : 0

  const monTop = 6
  const deskTop = monTop + MON_H + 7

  return (
    <div className="relative" style={{ width: wWidth, height: 260 }}>
      <div className="absolute left-0 right-0 rounded-lg" style={{
        top: 0, bottom: 0,
        background: 'rgba(18,20,26,0.55)',
        border: '1px solid rgba(42,45,56,0.4)',
      }}>
        {/* Monitors */}
        <div className="absolute" style={{
          top: monTop, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: monCount > 1 ? MON_GAP : 0, justifyContent: 'center',
        }}>
          {exchanges.slice(0, monCount).map((ex, i) => (
            <Monitor key={i} ex={ex} isOff={isOff}
              width={MON_W} height={MON_H} />
          ))}
          {exchanges.length === 0 && (
            <Monitor
              ex={{ exchange: 'hyperliquid', equity: null, unrealizedPnl: null, positionCount: 0, positions: [], equityHistory: [] }}
              isOff={isOff} width={MON_W} height={MON_H}
            />
          )}
        </div>

        {/* Desk — flush under monitors */}
        <div className="absolute" style={{
          top: deskTop, left: 8, right: 8, height: 12,
          background: 'linear-gradient(180deg, #5a4a38 0%, #4a3c2c 100%)',
          borderRadius: 3,
          borderTop: '1px solid #6a5a48',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        }} />

        {/* Nameplate */}
        <div className="absolute" style={{
          top: deskTop + 2, left: '50%', transform: 'translateX(-50%)',
          background: '#2a2420', border: '1px solid #4a3828',
          borderRadius: 2, padding: '1px 8px',
          fontSize: 9, fontFamily: 'monospace', color: '#c8a882',
          whiteSpace: 'nowrap', lineHeight: '13px', zIndex: 3,
          maxWidth: wWidth - 30,
          overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center',
        }}>
          {traderName}
        </div>

        {/* Character */}
        <div className="absolute" style={{
          bottom: 10, left: '50%',
          transform: `translateX(calc(-50% + ${charX}px))`,
          transition: 'transform 1.1s ease-in-out',
          zIndex: 2,
        }}>
          <PixelCharacter
            presetId={avatarPresetId}
            state={charState}
            direction={charDir}
            scale={1.6}
            animationMap={animationMap}
          />
          {!isMoving && <MoodBubble state={charState} />}
        </div>
      </div>
    </div>
  )
}
