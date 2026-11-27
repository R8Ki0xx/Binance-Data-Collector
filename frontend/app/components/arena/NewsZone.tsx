import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import PixelCharacter from './PixelCharacter'
import type { CharacterDirection } from './PixelCharacter'
import type { CharacterState } from './pixelData/characters'
import { AVATAR_PRESETS } from './pixelData/palettes'

// --- Types ---

interface SSENewsItem {
  id: number
  title: string
  ai_summary?: string | null
  published_at?: string | null
  symbols?: string[]
  sentiment?: string | null
}

interface SSEFlowSummary {
  symbol: string
  net_inflow: number
  buy_ratio: number
  large_order_net: number
  large_buy_count: number
  large_sell_count: number
  open_interest_change_pct?: number | null
  funding_rate_pct?: number | null
  latest_trade_timestamp?: number | null
}

interface IdleCharacter {
  presetId: number
  x: number
  y: number
  targetX: number
  targetY: number
  direction: CharacterDirection
  state: CharacterState
  mood: MoodOption | null
  moodTimer: number
  behavior: 'idle' | 'walking' | 'watching'
}

interface NewsZoneProps {
  areaW: number
  areaH: number
  scale: number
  boundTraderPresetIds: Set<number>
  animationMap?: Record<string, string>
}

// --- Constants ---

const CHAR_SCALE = 1.6
const CHAR_RENDER_SIZE = 64 * CHAR_SCALE
const SCREEN_H = 260
const SCREEN_GAP = 20
const SCREEN_Y = 8
const SCREEN_BORDER = 6
const MOVE_SPEED = 0.4
const ZONE_PAD = 4
const CHAR_ZONE_DEPTH = 180
const REPEL_DIST = 70
const REPEL_FORCE = 2.0

const EMOJI_PATH = '/static/arena-sprites/assets/emoji'
type MoodOption = { bg: string; img?: string; emoji?: string }
const NEWS_MOOD: MoodOption = { img: `${EMOJI_PATH}/zap.png`, bg: '#4a1d96' }
const FLOW_MOOD: MoodOption = { img: `${EMOJI_PATH}/star.png`, bg: '#1e3a5f' }
const IDLE_MOODS: MoodOption[] = [
  { emoji: '☕', bg: '#3b2f1e' },
  { img: `${EMOJI_PATH}/grinning.png`, bg: '#14532d' },
]

const SSE_BASE = '/api/market-intelligence/stream'
const WATCHLIST_API = '/api/hyperliquid/symbols/watchlist'

export default function NewsZone({
  areaW, areaH, scale, boundTraderPresetIds, animationMap,
}: NewsZoneProps) {
  const [newsItems, setNewsItems] = useState<SSENewsItem[]>([])
  const [flowItems, setFlowItems] = useState<SSEFlowSummary[]>([])
  const [characters, setCharacters] = useState<IdleCharacter[]>([])
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([])
  const [newsScrollIdx, setNewsScrollIdx] = useState(0)
  const animFrameRef = useRef<number>(0)
  const lastTickRef = useRef(Date.now())
  const prevNewsIdRef = useRef<number | null>(null)
  const prevFlowSigRef = useRef<string>('')
  const sseRef = useRef<EventSource | null>(null)

  const availablePresets = useMemo(() =>
    AVATAR_PRESETS.filter(p => !boundTraderPresetIds.has(p.id)).map(p => p.id),
    [boundTraderPresetIds],
  )

  const innerW = areaW / scale
  const innerH = areaH / scale
  const screenW = Math.floor((innerW - SCREEN_GAP - SCREEN_BORDER * 4 - ZONE_PAD * 2) / 2)
  const screenBottom = SCREEN_Y + SCREEN_H + SCREEN_BORDER * 2
  const charZoneTop = screenBottom + 10
  const charZoneBottom = Math.min(charZoneTop + CHAR_ZONE_DEPTH, innerH - CHAR_RENDER_SIZE - ZONE_PAD)
  const screenTotalW = screenW * 2 + SCREEN_GAP + SCREEN_BORDER * 4
  const charZoneLeft = Math.max(ZONE_PAD, (innerW - screenTotalW) / 2 - 10)
  const charZoneRight = Math.min(innerW - CHAR_RENDER_SIZE - ZONE_PAD, (innerW + screenTotalW) / 2 + 10 - CHAR_RENDER_SIZE)

  // Fetch watchlist symbols
  useEffect(() => {
    fetch(WATCHLIST_API).then(r => r.json()).then(data => {
      const syms = (data?.symbols || data || []) as string[]
      setWatchlistSymbols(syms.length > 0 ? syms : ['BTC', 'ETH'])
    }).catch(() => setWatchlistSymbols(['BTC', 'ETH']))
  }, [])

  // SSE connection
  useEffect(() => {
    if (watchlistSymbols.length === 0) return
    const symbolsParam = watchlistSymbols.join(',')
    const url = `${SSE_BASE}?symbols=${encodeURIComponent(symbolsParam)}&exchange=hyperliquid&timeframe=15m&window=4h`
    const es = new EventSource(url)
    sseRef.current = es

    const handleData = (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data)
        const news: SSENewsItem[] = data.news_items || []
        const summaries: SSEFlowSummary[] = data.summaries || []
        if (news.length > 0) setNewsItems(news)
        if (summaries.length > 0) setFlowItems(summaries)
      } catch { /* ignore parse errors */ }
    }
    es.addEventListener('snapshot', handleData)
    es.addEventListener('update', handleData)
    es.onerror = () => {
      es.close()
      setTimeout(() => sseRef.current === es && setWatchlistSymbols(prev => [...prev]), 5000)
    }
    return () => { es.close(); sseRef.current = null }
  }, [watchlistSymbols])

  // Initialize characters — default sit/idle, face up
  useEffect(() => {
    const placed: { x: number; y: number }[] = []
    const chars: IdleCharacter[] = availablePresets.map((pid) => {
      let x = 0, y = 0
      for (let attempt = 0; attempt < 20; attempt++) {
        x = charZoneLeft + Math.random() * Math.max(0, charZoneRight - charZoneLeft)
        y = charZoneTop + Math.random() * Math.max(0, charZoneBottom - charZoneTop)
        if (!placed.some(p => Math.sqrt((p.x - x) ** 2 + (p.y - y) ** 2) < REPEL_DIST)) break
      }
      placed.push({ x, y })
      return {
        presetId: pid, x, y, targetX: x, targetY: y,
        direction: (Math.random() > 0.5 ? 'up' : 'up') as CharacterDirection,
        state: (Math.random() > 0.5 ? 'idle' : 'offline') as CharacterState,
        mood: null, moodTimer: 0, behavior: 'idle' as const,
      }
    })
    setCharacters(chars)
  }, [availablePresets.length, innerW, innerH])

  // React to new news — scroll to top and trigger characters
  useEffect(() => {
    if (newsItems.length === 0) return
    const topId = newsItems[0]?.id
    if (prevNewsIdRef.current !== null && topId !== prevNewsIdRef.current) {
      setNewsScrollIdx(0)
      triggerWatch('news')
    }
    prevNewsIdRef.current = topId
  }, [newsItems])

  // Auto-cycle news every 12s when no new push
  useEffect(() => {
    if (newsItems.length <= 1) return
    const maxIdx = Math.min(newsItems.length, 10) - 1
    const t = setInterval(() => {
      setNewsScrollIdx(prev => prev >= maxIdx ? 0 : prev + 1)
    }, 12000)
    return () => clearInterval(t)
  }, [newsItems.length])

  // React to flow changes
  useEffect(() => {
    const sig = flowItems.map(f => `${f.symbol}:${f.net_inflow}`).join('|')
    if (prevFlowSigRef.current && sig !== prevFlowSigRef.current) {
      triggerWatch('flow')
    }
    prevFlowSigRef.current = sig
  }, [flowItems])

  // Animation loop — only move walking/watching chars, idle stay frozen
  useEffect(() => {
    const tick = () => {
      const now = Date.now()
      const dt = now - lastTickRef.current
      lastTickRef.current = now
      setCharacters(prev => prev.map((c, idx) => {
        if (c.behavior === 'idle') {
          if (c.mood && c.moodTimer > 0) {
            const mt = c.moodTimer - dt
            if (mt <= 0) return { ...c, mood: null, moodTimer: 0 }
            return { ...c, moodTimer: mt }
          }
          return c
        }
        const u = { ...c }
        if (u.mood && u.moodTimer > 0) {
          u.moodTimer -= dt
          if (u.moodTimer <= 0) { u.mood = null; u.moodTimer = 0 }
        }
        const dx = u.targetX - u.x, dy = u.targetY - u.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist > 2) {
          // Check ahead: is another character blocking the path?
          const blocked = prev.some((o, j) => j !== idx &&
            Math.sqrt((o.x - u.x) ** 2 + (o.y - u.y) ** 2) < REPEL_DIST * 0.7 &&
            // Only block if the other char is roughly in our direction
            ((u.targetX - u.x) * (o.x - u.x) + (u.targetY - u.y) * (o.y - u.y)) > 0)
          if (blocked) {
            // Stop here, settle into idle with mood
            u.behavior = 'idle'
            u.state = Math.random() > 0.5 ? 'idle' : 'offline'
            u.direction = 'up'
            if (!u.mood) {
              u.mood = IDLE_MOODS[Math.floor(Math.random() * IDLE_MOODS.length)]
              u.moodTimer = 3000
            }
          } else {
            const step = MOVE_SPEED * (dt / 16)
            const ratio = Math.min(step / dist, 1)
            u.x += dx * ratio; u.y += dy * ratio
            u.state = 'just_traded'
            u.direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : 'up'
          }
        } else if (u.behavior === 'walking' || u.behavior === 'watching') {
          u.behavior = 'idle'
          u.state = Math.random() > 0.5 ? 'idle' : 'offline'
          u.direction = 'up'
        }
        u.x = Math.max(charZoneLeft, Math.min(u.x, charZoneRight))
        u.y = Math.max(charZoneTop, Math.min(u.y, charZoneBottom))
        return u
      }))
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [innerW, innerH, charZoneLeft, charZoneRight, charZoneTop, charZoneBottom])

  // Trigger characters on data update — walk to screen, spread out in front
  const triggerWatch = useCallback((type: 'news' | 'flow') => {
    setCharacters(prev => {
      const idle = prev.filter(c => c.behavior === 'idle')
      const count = Math.min(idle.length, 2 + Math.floor(Math.random() * 2))
      const chosenList = idle.sort(() => Math.random() - 0.5).slice(0, count)
      const chosenIds = new Set(chosenList.map(c => c.presetId))
      const screenCx = innerW / 2
      const isNews = type === 'news'
      const moodOpt = isNews ? NEWS_MOOD : FLOW_MOOD
      const baseCx = isNews ? screenCx - screenW / 2 : screenCx + screenW / 2
      const spacing = CHAR_RENDER_SIZE + 10
      // Collect all occupied positions (non-chosen characters + already assigned slots)
      const occupied: { x: number; y: number }[] = prev
        .filter(c => !chosenIds.has(c.presetId))
        .map(c => ({ x: c.x, y: c.y }))
      // Assign slots one by one, checking against all occupied
      const assigned: ({ x: number; y: number } | null)[] = []
      const totalSpread = (chosenList.length - 1) * spacing
      const startX = baseCx - totalSpread / 2
      for (let i = 0; i < chosenList.length; i++) {
        let sx = Math.max(charZoneLeft, Math.min(startX + i * spacing, charZoneRight))
        let sy = charZoneTop + (i % 2) * 20
        // Try to find a clear spot, nudge if needed
        let clear = false
        for (let attempt = 0; attempt < 8; attempt++) {
          const tooClose = occupied.some(o =>
            Math.sqrt((o.x - sx) ** 2 + (o.y - sy) ** 2) < REPEL_DIST * 0.7)
          if (!tooClose) { clear = true; break }
          sx += (attempt % 2 === 0 ? 1 : -1) * spacing * 0.5
          sy += 15
          sx = Math.max(charZoneLeft, Math.min(sx, charZoneRight))
          sy = Math.max(charZoneTop, Math.min(sy, charZoneBottom))
        }
        if (clear) {
          occupied.push({ x: sx, y: sy })
          assigned.push({ x: sx, y: sy })
        } else {
          assigned.push(null) // blocked, stay in place
        }
      }
      let slotIdx = 0
      return prev.map(c => {
        if (!chosenIds.has(c.presetId)) return c
        const slot = assigned[slotIdx++]
        if (!slot) {
          return { ...c, mood: moodOpt, moodTimer: 4000 + Math.random() * 2000 }
        }
        return {
          ...c, behavior: 'watching' as const,
          targetX: slot.x, targetY: slot.y,
          mood: moodOpt, moodTimer: 4000 + Math.random() * 2000,
        }
      })
    })
  }, [innerW, screenW, charZoneLeft, charZoneRight, charZoneTop, charZoneBottom])

  // --- Helpers ---

  function formatFlow(v: number) {
    const abs = Math.abs(v)
    if (abs >= 1e6) return `${v > 0 ? '+' : ''}${(v / 1e6).toFixed(1)}M`
    if (abs >= 1e3) return `${v > 0 ? '+' : ''}${(v / 1e3).toFixed(0)}K`
    return `${v > 0 ? '+' : ''}${v.toFixed(0)}`
  }

  function toLocalTime(val?: string | number | null): string {
    if (!val) return ''
    const d = typeof val === 'number' ? new Date(val) : new Date(val)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
  }

  // --- Render ---

  if (availablePresets.length === 0) return null

  const sTotal = screenW * 2 + SCREEN_GAP + SCREEN_BORDER * 4
  const sStartX = (innerW - sTotal) / 2

  return (
    <div style={{
      width: innerW, height: innerH, position: 'relative', overflow: 'hidden',
    }}>
      {/* News Screen — multiple articles, scroll on new */}
      <WallScreen x={sStartX} y={SCREEN_Y} w={screenW} label="NEWS">
        <div style={{ height: '100%', overflow: 'hidden', position: 'relative' }}>
          <div style={{
            transition: 'transform 0.6s ease-in-out',
            transform: `translateY(-${newsScrollIdx * SCREEN_H}px)`,
          }}>
            {newsItems.length > 0 ? newsItems.slice(0, 10).map((n, i) => (
              <div key={n.id} style={{ height: SCREEN_H, padding: '10px 12px', boxSizing: 'border-box', position: 'relative' }}>
                <div style={{ color: '#a3e635', fontSize: 13, fontWeight: 'bold', lineHeight: 1.3, marginBottom: 8 }}>
                  {n.title}
                </div>
                {n.ai_summary && (
                  <div style={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.5, marginBottom: 8,
                    display: '-webkit-box', WebkitLineClamp: 10, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>
                    {n.ai_summary}
                  </div>
                )}
                <div style={{ color: '#475569', fontSize: 9, fontFamily: 'monospace', position: 'absolute', bottom: 10, left: 12 }}>
                  {toLocalTime(n.published_at)}
                  {n.symbols && n.symbols.length > 0 && (
                    <span style={{ marginLeft: 8 }}>{n.symbols.slice(0, 3).join(' ')}</span>
                  )}
                </div>
              </div>
            )) : (
              <div style={{ height: SCREEN_H, padding: 12, color: '#475569', fontSize: 14, fontFamily: 'monospace' }}>NO SIGNAL</div>
            )}
          </div>
        </div>
      </WallScreen>

      {/* Flow Screen — whale flow with large order details */}
      <WallScreen x={sStartX + screenW + SCREEN_BORDER * 2 + SCREEN_GAP} y={SCREEN_Y} w={screenW} label="WHALE FLOW">
        <div style={{ padding: '6px 10px', overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly' }}>
          {flowItems.length > 0 ? flowItems.map(f => {
            const lbc = f.large_buy_count || 0
            const lsc = f.large_sell_count || 0
            const oiPct = f.open_interest_change_pct ?? 0
            const frPct = f.funding_rate_pct ?? 0
            return (
              <div key={f.symbol} style={{ paddingBottom: 4, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ color: '#38bdf8', fontSize: 15, fontWeight: 'bold' }}>🐋 {f.symbol}</span>
                  <span style={{
                    color: f.large_order_net >= 0 ? '#4ade80' : '#f87171',
                    fontSize: 20, fontWeight: 'bold',
                  }}>
                    {formatFlow(f.large_order_net)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', marginTop: 3 }}>
                  <span>
                    <span style={{ color: '#4ade80' }}>▲{lbc}</span>
                    {' / '}
                    <span style={{ color: '#f87171' }}>▼{lsc}</span>
                    {' trades'}
                  </span>
                  <span>
                    OI <span style={{ color: oiPct >= 0 ? '#4ade80' : '#f87171' }}>{oiPct >= 0 ? '+' : ''}{oiPct.toFixed(2)}%</span>
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#64748b', marginTop: 2 }}>
                  <span>FR: {(frPct * 100).toFixed(4)}%</span>
                  <span>{toLocalTime(f.latest_trade_timestamp)}</span>
                </div>
              </div>
            )
          }) : (
            <div style={{ color: '#475569', fontSize: 14, fontFamily: 'monospace' }}>NO DATA</div>
          )}
        </div>
      </WallScreen>

      {/* Floor area — visible tile pattern */}
      <div style={{
        position: 'absolute',
        left: ZONE_PAD, top: screenBottom + 4,
        width: innerW - ZONE_PAD * 2,
        height: innerH - screenBottom - 4 - ZONE_PAD,
        background: '#b89a6e',
        zIndex: 0,
      }}>
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.15,
          backgroundImage: `
            repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(0,0,0,0.3) 39px, rgba(0,0,0,0.3) 40px),
            repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(0,0,0,0.3) 39px, rgba(0,0,0,0.3) 40px)
          `,
        }} />
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 0, height: 16,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.15), transparent)',
        }} />
      </div>

      {/* Idle characters */}
      {characters.map(c => (
        <div key={c.presetId} style={{
          position: 'absolute', left: c.x, top: c.y, zIndex: 10,
        }}>
          {c.mood && <CharMoodBubble mood={c.mood} />}
          <PixelCharacter
            presetId={c.presetId}
            state={c.state}
            direction={c.direction}
            scale={CHAR_SCALE}
            animationMap={animationMap}
          />
        </div>
      ))}
    </div>
  )
}

// --- Mood bubble matching Workstation style ---

function CharMoodBubble({ mood }: { mood: MoodOption }) {
  return (
    <div style={{
      position: 'absolute', top: 6, right: -8, zIndex: 15,
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

// --- Wall-mounted screen (CSS-drawn frame) ---

function WallScreen({ x, y, w, label, children }: {
  x: number; y: number; w: number; label: string
  children: React.ReactNode
}) {
  return (
    <div style={{
      position: 'absolute', left: x, top: y,
      width: w + SCREEN_BORDER * 2,
      height: SCREEN_H + SCREEN_BORDER * 2,
    }}>
      {/* Outer frame — dark metallic border */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'linear-gradient(180deg, #4a4a5a 0%, #2a2a3a 50%, #1a1a2a 100%)',
        borderRadius: 6,
        boxShadow: '0 4px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)',
      }}>
        {/* Inner bezel */}
        <div style={{
          position: 'absolute',
          left: SCREEN_BORDER, top: SCREEN_BORDER,
          width: w, height: SCREEN_H,
          background: '#0a0e1a',
          borderRadius: 3,
          overflow: 'hidden',
          border: '1px solid #000',
        }}>
          {/* Scanline overlay */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none',
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 4px)',
          }} />
          {/* Screen glow */}
          <div style={{
            position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none',
            boxShadow: 'inset 0 0 20px rgba(56,189,248,0.1)',
          }} />
          {/* Label */}
          <div style={{
            position: 'absolute', top: 2, right: 6, fontSize: 9,
            color: '#334155', fontWeight: 'bold', zIndex: 4, letterSpacing: 1,
            fontFamily: 'monospace',
          }}>
            {label}
          </div>
          {/* Content */}
          <div style={{ position: 'relative', zIndex: 1, height: '100%', fontFamily: 'monospace' }}>
            {children}
          </div>
        </div>
      </div>
      {/* Wall mount bracket */}
      <div style={{
        position: 'absolute',
        top: -4, left: '50%', transform: 'translateX(-50%)',
        width: 40, height: 6,
        background: 'linear-gradient(180deg, #5a5a6a, #3a3a4a)',
        borderRadius: '3px 3px 0 0',
        boxShadow: '0 -1px 3px rgba(0,0,0,0.3)',
      }} />
      {/* Power LED */}
      <div style={{
        position: 'absolute',
        bottom: 2, right: SCREEN_BORDER + 6,
        width: 4, height: 4, borderRadius: '50%',
        background: '#22c55e',
        boxShadow: '0 0 4px #22c55e',
      }} />
    </div>
  )
}
