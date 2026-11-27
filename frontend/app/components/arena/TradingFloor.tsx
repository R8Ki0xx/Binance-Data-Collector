import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Workstation from './Workstation'
import NewsZone from './NewsZone'
import type { CharacterState } from './pixelData/characters'
import type { PlacedAsset, SceneConfig } from './SceneEditor'
import { STORAGE_KEY, CANVAS_W, CANVAS_H, getWsArea, getNewsArea, normalizeSceneConfig, shouldUseOfficialConfig } from './SceneEditor'
import { OFFICIAL_SCENE_CONFIG } from './officialSceneConfig'

export interface MonitorPosition {
  symbol: string
  side: string
  unrealizedPnl: number
}

export interface ExchangeMonitor {
  exchange: string
  equity: number | null
  unrealizedPnl: number | null
  positionCount: number
  positions: MonitorPosition[]
  equityHistory: number[]
}

export interface TraderData {
  accountId: number
  accountName: string
  avatarPresetId: number | null
  exchanges: ExchangeMonitor[]
  state: CharacterState
  activitySignal?: {
    seq: number
    exchange: string
    state: 'program_running' | 'ai_thinking'
  }
}

interface TradingFloorProps {
  traders: TraderData[]
}

function LiveClock({ scale }: { scale: number }) {
  const [time, setTime] = useState('')
  useEffect(() => {
    const tick = () => {
      const d = new Date()
      setTime(d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <div style={{
      fontFamily: 'monospace', fontSize: 11 * scale, fontWeight: 'bold',
      color: '#8b9cf7', textShadow: '0 0 6px rgba(139,156,247,0.4)',
      background: 'linear-gradient(180deg, #1a1a2e, #16162a)',
      border: '2px solid #2a2a4a', borderRadius: 3,
      padding: `${2 * scale}px ${8 * scale}px`,
      whiteSpace: 'nowrap', lineHeight: 1.2,
    }}>
      {time}
    </div>
  )
}

function SceneAssets({ assets }: { assets: PlacedAsset[] }) {
  return (<>
    {assets.map(a => (
      <div key={a.id} className="absolute" style={{ left: a.x, top: a.y, zIndex: 1 }}>
        {a.src === '__widget_clock__' ? (
          <LiveClock scale={a.scale} />
        ) : (
          <div style={{
            width: a.cropW * a.scale, height: a.cropH * a.scale, overflow: 'hidden',
          }}>
            <div style={{
              width: a.cropW, height: a.cropH,
              backgroundImage: `url(${a.src})`,
              backgroundSize: 'auto',
              backgroundPosition: `-${a.cropX}px -${a.cropY}px`,
              backgroundRepeat: 'no-repeat',
              imageRendering: 'pixelated',
              transform: `scale(${a.scale})`,
              transformOrigin: 'top left',
            }} />
          </div>
        )}
      </div>
    ))}
  </>)
}

const WALL_H = 80
const WS_ITEM_H = 260
const WS_GAP = 16

// Calculate workstation rows and visual height after scale
function calcWsVisualH(traders: TraderData[], ws: { w: number; scale: number }): number {
  const effectiveW = ws.w / ws.scale
  let x = 4, rows = traders.length > 0 ? 1 : 0
  for (const t of traders) {
    const monCount = Math.min(Math.max(t.exchanges.length, 1), 3)
    const ww = monCount * 170 + Math.max(0, monCount - 1) * 20 + 80
    if (x > 4 && x + ww > effectiveW) { rows++; x = 4 }
    x += ww + WS_GAP
  }
  if (rows === 0) return 0
  const unscaledH = rows * (WS_ITEM_H + WS_GAP) - WS_GAP + 8
  return unscaledH * ws.scale
}

function VirtualCanvas({ traders, sceneConfig, canvasW, canvasH, wsVisualH }: {
  traders: TraderData[]; sceneConfig: SceneConfig | null
  canvasW: number; canvasH: number; wsVisualH: number
}) {
  const ws = getWsArea(sceneConfig)
  const na = getNewsArea(sceneConfig)
  const animMap = sceneConfig?.animationMap

  // Collect preset IDs already bound to traders
  const boundPresetIds = useMemo(() => {
    const ids = new Set<number>()
    for (const t of traders) {
      if (t.avatarPresetId) ids.add(t.avatarPresetId)
    }
    return ids
  }, [traders])
  return (
    <div className="relative" style={{ width: canvasW, height: canvasH }}>
      {/* Office wall */}
      <div className="absolute top-0" style={{ left: 0, right: 0, height: WALL_H }}>
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(180deg, #d4cfc8 0%, #c8c2b8 60%, #b8b0a4 100%)',
        }} />
        <div className="absolute inset-0 opacity-[0.06]" style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.1) 3px, rgba(0,0,0,0.1) 4px)',
        }} />
        <div className="absolute bottom-0 left-0 right-0" style={{
          height: 7,
          background: 'linear-gradient(180deg, #8a7e6e 0%, #6e6456 100%)',
          borderTop: '1px solid #9e9282',
        }} />
      </div>

      {/* Wood floor */}
      <div className="absolute inset-x-0 bottom-0" style={{ top: WALL_H }}>
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(180deg, #c4a87a 0%, #b89a6e 30%, #a88e64 100%)',
        }} />
        <div className="absolute inset-0 opacity-[0.08]" style={{
          backgroundImage: `
            repeating-linear-gradient(90deg, transparent, transparent 79px, rgba(0,0,0,0.15) 79px, rgba(0,0,0,0.15) 80px),
            repeating-linear-gradient(0deg, transparent, transparent 15px, rgba(0,0,0,0.05) 15px, rgba(0,0,0,0.05) 16px)
          `,
        }} />
        <div className="absolute top-0 left-0 right-0" style={{
          height: 12,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.08), transparent)',
        }} />
      </div>

      {/* Scene assets from editor */}
      {sceneConfig && sceneConfig.assets.length > 0 && (
        <SceneAssets assets={sceneConfig.assets} />
      )}

      {/* Workstations — height auto-calculated, overflow clipped */}
      <div className="absolute z-10" style={{
        left: ws.x, top: ws.y, width: ws.w,
        height: wsVisualH, overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-start',
          alignItems: 'flex-start', gap: WS_GAP,
          padding: 4,
          transform: `scale(${ws.scale})`, transformOrigin: 'top left',
          width: ws.w / ws.scale,
        }}>
          {traders.map((trader) => (
            <Workstation
              key={trader.accountId}
              traderName={trader.accountName}
              exchanges={trader.exchanges}
              avatarPresetId={trader.avatarPresetId}
              state={trader.state}
              animationMap={animMap}
              activitySignal={trader.activitySignal}
            />
          ))}
        </div>
      </div>

      {/* News Zone — idle characters watching screens */}
      <div className="absolute z-10" style={{
        left: na.x, top: na.y, width: na.w, height: na.h,
        overflow: 'hidden',
      }}>
        <div style={{
          transform: `scale(${na.scale})`, transformOrigin: 'top left',
          width: na.w / na.scale, height: na.h / na.scale,
        }}>
          <NewsZone
            areaW={na.w}
            areaH={na.h}
            scale={na.scale}
            boundTraderPresetIds={boundPresetIds}
            animationMap={animMap}
          />
        </div>
      </div>
    </div>
  )
}

export default function TradingFloor({ traders }: TradingFloorProps) {
  const [sceneConfig, setSceneConfig] = useState<SceneConfig | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 })
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (!shouldUseOfficialConfig(parsed)) {
          setSceneConfig(normalizeSceneConfig(parsed))
          return
        }
      }
    } catch { /* ignore */ }
    const officialConfig = normalizeSceneConfig(OFFICIAL_SCENE_CONFIG)
    setSceneConfig(officialConfig)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(officialConfig))
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setContainerSize({ w: width, h: height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scale = containerSize.h > 0 ? containerSize.h / CANVAS_H : 1
  const ws = getWsArea(sceneConfig)

  // Calculate workstation visual height and derive canvas height
  const wsVisualH = useMemo(() => calcWsVisualH(traders, ws), [traders, ws])
  const canvasH = Math.max(CANVAS_H, ws.y + wsVisualH + 20)

  // Canvas width fills container, at least CANVAS_W
  const canvasW = Math.max(CANVAS_W, containerSize.w > 0 ? containerSize.w / scale : CANVAS_W)

  const scaledW = canvasW * scale
  const scaledH = canvasH * scale

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = containerRef.current
    if (!el) return
    if (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight) return
    setDragging(true)
    dragRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }
    el.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !dragRef.current || !containerRef.current) return
    containerRef.current.scrollLeft = dragRef.current.scrollLeft - (e.clientX - dragRef.current.startX)
    containerRef.current.scrollTop = dragRef.current.scrollTop - (e.clientY - dragRef.current.startY)
  }, [dragging])

  const onPointerUp = useCallback(() => {
    setDragging(false)
    dragRef.current = null
  }, [])

  return (
    <div ref={containerRef}
      className="w-full h-full rounded-lg border border-border/30"
      style={{
        minHeight: 360,
        overflow: 'auto',
        cursor: dragging ? 'grabbing' : 'grab',
        scrollbarWidth: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div style={{ width: scaledW, height: scaledH }}>
        <div style={{
          width: canvasW,
          height: canvasH,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}>
          <VirtualCanvas traders={traders} sceneConfig={sceneConfig}
            canvasW={canvasW} canvasH={canvasH} wsVisualH={wsVisualH} />
        </div>
      </div>
    </div>
  )
}
