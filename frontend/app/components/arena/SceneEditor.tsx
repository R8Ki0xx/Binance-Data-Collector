import { useState, useRef, useCallback, useEffect } from 'react'
import { OFFICIAL_SCENE_CONFIG, OFFICIAL_SCENE_VERSION } from './officialSceneConfig'

// --- Types ---
export interface PlacedAsset {
  id: string
  src: string
  label: string
  x: number
  y: number
  scale: number
  cropX: number
  cropY: number
  cropW: number
  cropH: number
}

export interface WorkstationArea {
  x: number; y: number; w: number; h: number; scale: number
}

export interface NewsArea {
  x: number; y: number; w: number; h: number; scale: number
}

export interface SceneConfig {
  sceneVersion?: number
  assets: PlacedAsset[]
  animationMap: Record<string, string>
  workstationArea?: WorkstationArea
  newsArea?: NewsArea
}

export const DEFAULT_WS_AREA: WorkstationArea = { x: 16, y: 86, w: 868, h: 460, scale: 1 }
export const DEFAULT_NEWS_AREA: NewsArea = { x: 540, y: 100, w: 340, h: 420, scale: 0.5 }

export function getWsArea(config: SceneConfig | null): WorkstationArea {
  const ws = config?.workstationArea
  if (!ws) return DEFAULT_WS_AREA
  return {
    x: ws.x ?? DEFAULT_WS_AREA.x,
    y: ws.y ?? DEFAULT_WS_AREA.y,
    w: ws.w ?? DEFAULT_WS_AREA.w,
    h: ws.h ?? DEFAULT_WS_AREA.h,
    scale: ws.scale && !isNaN(ws.scale) ? ws.scale : DEFAULT_WS_AREA.scale,
  }
}

export function getNewsArea(config: SceneConfig | null): NewsArea {
  const na = config?.newsArea
  if (!na) return DEFAULT_NEWS_AREA
  return {
    x: na.x ?? DEFAULT_NEWS_AREA.x,
    y: na.y ?? DEFAULT_NEWS_AREA.y,
    w: na.w ?? DEFAULT_NEWS_AREA.w,
    h: na.h ?? DEFAULT_NEWS_AREA.h,
    scale: na.scale && !isNaN(na.scale) ? na.scale : DEFAULT_NEWS_AREA.scale,
  }
}

export const STORAGE_KEY = 'arena_scene_config'
export const CANVAS_W = 900
export const CANVAS_H = 560
const WALL_H = 80

const ANIM_OPTIONS = [
  { value: 'spellcast', label: 'Spellcast (7f)', baseRow: 0, frames: 7, dirs: 4 },
  { value: 'thrust', label: 'Thrust (8f)', baseRow: 4, frames: 8, dirs: 4 },
  { value: 'walk', label: 'Walk (9f)', baseRow: 8, frames: 9, dirs: 4 },
  { value: 'slash', label: 'Slash (6f)', baseRow: 12, frames: 6, dirs: 4 },
  { value: 'shoot', label: 'Shoot (13f)', baseRow: 16, frames: 13, dirs: 4 },
  { value: 'hurt', label: 'Hurt (6f, south only)', baseRow: 20, frames: 6, dirs: 1 },
  { value: 'climb', label: 'Climb (6f, north only)', baseRow: 21, frames: 6, dirs: 1 },
  { value: 'idle', label: 'Idle (2f)', baseRow: 22, frames: 2, dirs: 4 },
  { value: 'jump', label: 'Jump (5f)', baseRow: 26, frames: 5, dirs: 4 },
  { value: 'sit', label: 'Sit (3f)', baseRow: 30, frames: 3, dirs: 4 },
  { value: 'emote', label: 'Emote (3f)', baseRow: 34, frames: 3, dirs: 4 },
  { value: 'run', label: 'Run (8f)', baseRow: 38, frames: 8, dirs: 4 },
  { value: 'combat_idle', label: 'Combat Idle (2f)', baseRow: 42, frames: 2, dirs: 4 },
  { value: 'backslash', label: 'Backslash (13f)', baseRow: 46, frames: 13, dirs: 4 },
  { value: 'halfslash', label: 'Halfslash (6f)', baseRow: 50, frames: 6, dirs: 4 },
]

const ANIM_LOOKUP = Object.fromEntries(ANIM_OPTIONS.map(a => [a.value, a]))

const DEFAULT_ANIM_MAP: Record<string, string> = {
  idle: 'idle',
  holding_profit: 'slash',
  holding_loss: 'combat_idle',
  just_traded: 'jump',
  program_running: 'spellcast',
  ai_thinking: 'combat_idle',
  error: 'emote',
  offline: 'sit',
}

export function normalizeSceneConfig(config: Partial<SceneConfig> | null | undefined): SceneConfig {
  const officialConfig = OFFICIAL_SCENE_CONFIG
  const input = config || {}
  const sceneVersion = typeof input.sceneVersion === 'number'
    ? input.sceneVersion
    : typeof officialConfig.sceneVersion === 'number'
      ? officialConfig.sceneVersion
      : OFFICIAL_SCENE_VERSION

  return {
    sceneVersion,
    assets: Array.isArray(input.assets) ? input.assets : officialConfig.assets,
    animationMap: {
      ...officialConfig.animationMap,
      ...(input.animationMap || {}),
    },
    workstationArea: getWsArea(input as SceneConfig),
    newsArea: getNewsArea(input as SceneConfig),
  }
}

export function shouldUseOfficialConfig(config: Partial<SceneConfig> | null | undefined): boolean {
  if (!config) return true
  const localVersion = typeof config.sceneVersion === 'number' ? config.sceneVersion : 0
  const officialVersion = typeof OFFICIAL_SCENE_CONFIG.sceneVersion === 'number'
    ? OFFICIAL_SCENE_CONFIG.sceneVersion
    : OFFICIAL_SCENE_VERSION
  return localVersion < officialVersion
}

// Pre-extracted individual item PNGs (auto-cropped by PIL)
interface AssetItem {
  id: string
  label: string
  file: string  // filename in /static/arena-sprites/assets/items/
  w: number
  h: number
}

const ITEMS_PATH = '/static/arena-sprites/assets/items'

// Catalog grouped by category for the palette
const ITEM_CATALOG: Record<string, AssetItem[]> = {
  doors: [
    { id: 'door-wood-plain', label: 'Wood Plain Door', file: 'door-wood-plain.png', w: 64, h: 68 },
    { id: 'door-wood-panels', label: 'Wood Panels Door', file: 'door-wood-panels.png', w: 64, h: 68 },
    { id: 'door-iron-grid', label: 'Iron Grid Door', file: 'door-iron-grid.png', w: 64, h: 68 },
    { id: 'door-dark-wood', label: 'Dark Wood Door', file: 'door-dark-wood.png', w: 64, h: 68 },
    { id: 'door-brown-rustic', label: 'Brown Rustic Door', file: 'door-brown-rustic.png', w: 64, h: 68 },
    { id: 'door-iron-dark', label: 'Iron Dark Door', file: 'door-iron-dark.png', w: 64, h: 68 },
    { id: 'door-double', label: 'Double Door', file: 'door-double.png', w: 64, h: 96 },
    { id: 'door-double-win', label: 'Double Door Window', file: 'door-double-win.png', w: 64, h: 96 },
  ],
  office: [
    { id: 'laptop-0-0', label: 'Laptop Dark Open', file: 'laptop-0-0.png', w: 32, h: 32 },
    { id: 'laptop-0-2', label: 'Laptop Light Open', file: 'laptop-0-2.png', w: 32, h: 32 },
    { id: 'laptop-1-0', label: 'Laptop Blue Open', file: 'laptop-1-0.png', w: 32, h: 32 },
    { id: 'tv-off', label: 'TV Off', file: 'tv-off.png', w: 96, h: 64 },
    { id: 'tv-color', label: 'TV Color Bars', file: 'tv-color.png', w: 96, h: 64 },
    { id: 'tv-static-1', label: 'TV Static', file: 'tv-static-1.png', w: 96, h: 64 },
    { id: 'coffee-cup', label: 'Coffee Cup', file: 'coffee-cup.png', w: 32, h: 32 },
    { id: 'coffee-maker-1', label: 'Coffee Maker', file: 'coffee-maker-1.png', w: 32, h: 32 },
    { id: 'copier', label: 'Copy Machine', file: 'copier.png', w: 64, h: 64 },
    { id: 'water-cooler-1', label: 'Water Cooler', file: 'water-cooler-1.png', w: 32, h: 64 },
    { id: 'water-cooler-3', label: 'Water Cooler 2', file: 'water-cooler-3.png', w: 32, h: 64 },
    { id: 'shopping-cart', label: 'Shopping Cart', file: 'shopping-cart.png', w: 32, h: 64 },
    { id: 'desk-top', label: 'Desk Top View', file: 'desk-top.png', w: 160, h: 64 },
    { id: 'desk-front', label: 'Desk Front View', file: 'desk-front.png', w: 160, h: 64 },
    { id: 'bin-0-0', label: 'Bin Green', file: 'bin-0-0.png', w: 32, h: 32 },
    { id: 'bin-0-1', label: 'Bin Dark', file: 'bin-0-1.png', w: 32, h: 32 },
    { id: 'bin-2-0', label: 'Bin Blue', file: 'bin-2-0.png', w: 32, h: 32 },
    { id: 'portrait-1', label: 'Portrait Gold', file: 'portrait-1.png', w: 32, h: 32 },
    { id: 'portrait-2', label: 'Portrait Brown', file: 'portrait-2.png', w: 32, h: 32 },
    { id: 'chair-black', label: 'Chair Black', file: 'chair-black.png', w: 18, h: 42 },
    { id: 'chair-red', label: 'Chair Red', file: 'chair-red.png', w: 18, h: 42 },
    { id: 'filing-cabinet-1', label: 'Filing Cabinet', file: 'filing-cabinet-1.png', w: 32, h: 64 },
    { id: 'cabinet-dark', label: 'Dark Cabinet', file: 'cabinet-dark.png', w: 64, h: 64 },
    { id: 'office-plant', label: 'Office Plant', file: 'office-plant.png', w: 32, h: 32 },
    { id: 'book-stack', label: 'Book Stack', file: 'book-stack.png', w: 32, h: 32 },
    { id: 'desk-lamp', label: 'Desk Lamp', file: 'desk-lamp.png', w: 32, h: 64 },
    { id: 'work-desk', label: 'Work Desk', file: 'work-desk.png', w: 64, h: 32 },
  ],
  furniture: [
    { id: 'bookshelf-brown-1', label: 'Bookshelf Brown', file: 'bookshelf-brown-1.png', w: 64, h: 96 },
    { id: 'bookshelf-green-1', label: 'Bookshelf Green', file: 'bookshelf-green-1.png', w: 64, h: 96 },
    { id: 'wardrobe-1', label: 'Wardrobe', file: 'wardrobe-1.png', w: 64, h: 80 },
    { id: 'display-case', label: 'Display Case', file: 'display-case.png', w: 64, h: 96 },
    { id: 'china-cabinet', label: 'China Cabinet', file: 'china-cabinet.png', w: 48, h: 96 },
    { id: 'curtain-gold', label: 'Gold Curtain', file: 'curtain-gold.png', w: 64, h: 80 },
    { id: 'lamp-table', label: 'Table Lamp', file: 'lamp-table.png', w: 32, h: 48 },
    { id: 'bed-single', label: 'Single Bed', file: 'bed-single.png', w: 64, h: 80 },
    { id: 'fireplace', label: 'Fireplace', file: 'fireplace.png', w: 64, h: 48 },
    { id: 'chair-wood-1', label: 'Wood Chair', file: 'chair-wood-1.png', w: 32, h: 32 },
    { id: 'chair-gold-1', label: 'Gold Chair', file: 'chair-gold-1.png', w: 32, h: 32 },
    { id: 'floor-lamp-1', label: 'Floor Lamp', file: 'floor-lamp-1.png', w: 32, h: 64 },
    { id: 'armchair-1', label: 'Armchair', file: 'armchair-1.png', w: 32, h: 32 },
    { id: 'sofa-front-1', label: 'Sofa Front', file: 'sofa-front-1.png', w: 64, h: 32 },
    { id: 'pillar-1', label: 'Pillar', file: 'pillar-1.png', w: 32, h: 64 },
  ],
  plants: [
    { id: 'tree-round', label: 'Round Tree', file: 'tree-round.png', w: 16, h: 32 },
    { id: 'tree-tall', label: 'Tall Tree', file: 'tree-tall.png', w: 16, h: 32 },
    { id: 'tulips', label: 'Tulips', file: 'tulips.png', w: 16, h: 16 },
    { id: 'fern-pot', label: 'Fern Pot', file: 'fern-pot.png', w: 16, h: 16 },
    { id: 'cactus', label: 'Cactus', file: 'cactus.png', w: 16, h: 16 },
    { id: 'flower-pot', label: 'Flower Pot', file: 'flower-pot.png', w: 16, h: 16 },
    { id: 'indoor-plant-1', label: 'Indoor Plant', file: 'indoor-plant-1.png', w: 16, h: 32 },
    { id: 'rug-red', label: 'Red Rug', file: 'rug-red.png', w: 48, h: 32 },
    { id: 'rug-blue', label: 'Blue Rug', file: 'rug-blue.png', w: 48, h: 32 },
    { id: 'barrel', label: 'Barrel', file: 'barrel.png', w: 32, h: 32 },
  ],
  screens: [
    { id: 'tv-modern-white', label: 'Modern TV', file: 'tv-modern-white.png', w: 180, h: 180 },
    { id: 'tv-modern-empty', label: 'TV Frame', file: 'tv-modern-empty.png', w: 180, h: 180 },
    { id: 'scifi-panel-tall', label: 'Sci-fi Panel', file: 'scifi-panel-tall.png', w: 32, h: 64 },
    { id: 'scifi-screen-1', label: 'Sci-fi Screen', file: 'scifi-screen-1.png', w: 32, h: 32 },
    { id: 'scifi-console-1', label: 'Sci-fi Console', file: 'scifi-console-1.png', w: 32, h: 32 },
  ],
  signs: [
    { id: 'sign-hyper-arena', label: 'Hyper Alpha Arena', file: 'sign-hyper-arena.png', w: 124, h: 30 },
  ],
  widgets: [
    { id: 'widget-clock', label: 'Live Clock', file: '__widget_clock__', w: 80, h: 14 },
  ],
}

function AssetPalette({ onPlace, onCustomCrop }: {
  onPlace: (item: AssetItem) => void
  onCustomCrop: () => void
}) {
  const [openCat, setOpenCat] = useState<string | null>('office')
  return (
    <div className="w-52 shrink-0 overflow-y-auto border border-border/30 rounded-lg bg-black/20"
      style={{ maxHeight: CANVAS_H + 68 }}>
      <div className="p-2 text-xs font-semibold border-b border-border/30 flex justify-between">
        <span>Assets</span>
        <button onClick={onCustomCrop}
          className="text-[10px] text-blue-400 hover:text-blue-300">Custom Crop</button>
      </div>
      {Object.entries(ITEM_CATALOG).map(([cat, items]) => (
        <div key={cat}>
          <button onClick={() => setOpenCat(openCat === cat ? null : cat)}
            className="w-full text-left px-2 py-1.5 text-xs font-medium capitalize hover:bg-white/5 flex justify-between">
            {cat} <span className="text-muted-foreground text-[10px]">{items.length}</span>
          </button>
          {openCat === cat && (
            <div className="px-1 pb-2 flex flex-wrap gap-1">
              {items.map(item => (
                <button key={item.id} onClick={() => onPlace(item)}
                  className="relative group rounded border border-transparent hover:border-blue-500/50 bg-black/30 hover:bg-black/50 p-1"
                  title={item.label}>
                  {item.file.startsWith('__widget_') ? (
                    <div className="flex items-center justify-center" style={{ width: 48, height: 32 }}>
                      <span className="text-[9px] font-mono text-blue-400">{item.label}</span>
                    </div>
                  ) : (
                    <img src={`${ITEMS_PATH}/${item.file}`} alt={item.label}
                      draggable={false}
                      style={{
                        maxWidth: 48, maxHeight: 48,
                        imageRendering: 'pixelated',
                      }} />
                  )}
                  <div className="absolute inset-x-0 bottom-0 text-[8px] text-white/70 bg-black/60 text-center leading-tight opacity-0 group-hover:opacity-100 truncate px-0.5">
                    {item.label}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

type DragMode =
  | { type: 'move'; id: string; startX: number; startY: number; ox: number; oy: number }
  | { type: 'resize'; id: string; startX: number; startY: number; oScale: number; baseW: number; baseH: number }
  | { type: 'ws-move'; startX: number; startY: number; ox: number; oy: number }
  | { type: 'ws-resize'; startX: number; startY: number; ow: number; oh: number }
  | { type: 'news-move'; startX: number; startY: number; ox: number; oy: number }
  | { type: 'news-resize'; startX: number; startY: number; ow: number; oh: number }

function EditorCanvas({ config, selectedId, onSelect, onUpdate, onRemove, onUpdateWsArea, onUpdateNewsArea }: {
  config: SceneConfig; selectedId: string | null
  onSelect: (id: string | null) => void
  onUpdate: (id: string, patch: Partial<PlacedAsset>) => void
  onRemove: () => void
  onUpdateWsArea: (patch: Partial<WorkstationArea>) => void
  onUpdateNewsArea: (patch: Partial<NewsArea>) => void
}) {
  const dragRef = useRef<DragMode | null>(null)
  const selectedAsset = config.assets.find(a => a.id === selectedId)

  const onAssetDown = useCallback((e: React.MouseEvent, asset: PlacedAsset) => {
    e.stopPropagation()
    onSelect(asset.id)
    dragRef.current = {
      type: 'move', id: asset.id,
      startX: e.clientX, startY: e.clientY,
      ox: asset.x, oy: asset.y,
    }
  }, [onSelect])

  const onResizeDown = useCallback((e: React.MouseEvent, asset: PlacedAsset) => {
    e.stopPropagation()
    dragRef.current = {
      type: 'resize', id: asset.id,
      startX: e.clientX, startY: e.clientY,
      oScale: asset.scale,
      baseW: asset.cropW, baseH: asset.cropH,
    }
  }, [])

  const ws = getWsArea(config)
  const na = getNewsArea(config)

  const onWsDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect(null)
    dragRef.current = { type: 'ws-move', startX: e.clientX, startY: e.clientY, ox: ws.x, oy: ws.y }
  }, [ws, onSelect])

  const onWsResizeDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    dragRef.current = { type: 'ws-resize', startX: e.clientX, startY: e.clientY, ow: ws.w, oh: ws.h }
  }, [ws])

  const onNewsDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onSelect(null)
    dragRef.current = { type: 'news-move', startX: e.clientX, startY: e.clientY, ox: na.x, oy: na.y }
  }, [na, onSelect])

  const onNewsResizeDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    dragRef.current = { type: 'news-resize', startX: e.clientX, startY: e.clientY, ow: na.w, oh: na.h }
  }, [na])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current
    if (!d) return
    if (d.type === 'move') {
      onUpdate(d.id, {
        x: Math.max(0, Math.min(CANVAS_W - 20, d.ox + e.clientX - d.startX)),
        y: Math.max(0, Math.min(CANVAS_H - 20, d.oy + e.clientY - d.startY)),
      })
    } else if (d.type === 'resize') {
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      const diagonal = (dx + dy) / 2
      const origSize = Math.max(d.baseW, d.baseH) * d.oScale
      const newScale = Math.max(0.5, Math.min(8, d.oScale * (1 + diagonal / origSize)))
      onUpdate(d.id, { scale: Math.round(newScale * 10) / 10 })
    } else if (d.type === 'ws-move') {
      onUpdateWsArea({
        x: Math.max(0, Math.min(CANVAS_W - 100, d.ox + e.clientX - d.startX)),
        y: Math.max(0, Math.min(CANVAS_H - 100, d.oy + e.clientY - d.startY)),
      })
    } else if (d.type === 'ws-resize') {
      onUpdateWsArea({
        w: Math.max(200, Math.min(CANVAS_W, d.ow + e.clientX - d.startX)),
        h: Math.max(150, Math.min(CANVAS_H, d.oh + e.clientY - d.startY)),
      })
    } else if (d.type === 'news-move') {
      onUpdateNewsArea({
        x: Math.max(0, Math.min(CANVAS_W - 100, d.ox + e.clientX - d.startX)),
        y: Math.max(0, Math.min(CANVAS_H - 100, d.oy + e.clientY - d.startY)),
      })
    } else if (d.type === 'news-resize') {
      onUpdateNewsArea({
        w: Math.max(150, Math.min(CANVAS_W, d.ow + e.clientX - d.startX)),
        h: Math.max(120, Math.min(CANVAS_H, d.oh + e.clientY - d.startY)),
      })
    }
  }, [onUpdate, onUpdateWsArea])

  const onMouseUp = useCallback(() => { dragRef.current = null }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) onRemove()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedId, onRemove])

  return (
    <div style={{ flexShrink: 0 }}>
      {/* Toolbar above canvas */}
      <div className="flex items-center gap-2 mb-1 h-7">
        {selectedAsset ? (<>
          <span className="text-[11px] text-white/70 font-mono">{selectedAsset.label}</span>
          <span className="text-[11px] text-muted-foreground">
            {selectedAsset.cropW}×{selectedAsset.cropH}px
          </span>
          <div className="flex items-center gap-1 ml-2">
            <button onClick={() => onUpdate(selectedAsset.id, { scale: Math.max(0.5, selectedAsset.scale - 0.5) })}
              className="px-2 py-0.5 text-xs bg-black/60 rounded text-white hover:bg-black/80 border border-border/30">−</button>
            <span className="px-2 py-0.5 text-xs text-white/70 bg-black/40 rounded min-w-[32px] text-center">
              {selectedAsset.scale}x
            </span>
            <button onClick={() => onUpdate(selectedAsset.id, { scale: Math.min(8, selectedAsset.scale + 0.5) })}
              className="px-2 py-0.5 text-xs bg-black/60 rounded text-white hover:bg-black/80 border border-border/30">+</button>
          </div>
          <button onClick={onRemove}
            className="px-2 py-0.5 text-xs bg-red-900/60 rounded text-red-300 hover:bg-red-900/80 border border-red-800/30 ml-2">
            Delete
          </button>
          <span className="text-[10px] text-muted-foreground/50 ml-2">
            pos: ({Math.round(selectedAsset.x)}, {Math.round(selectedAsset.y)})
          </span>
        </>) : (
          <span className="text-[11px] text-muted-foreground">Click asset to select, drag to move, corner handle to resize</span>
        )}
      </div>
      {/* Canvas */}
      <div className="relative border border-border/30 rounded-lg cursor-crosshair"
        style={{ width: CANVAS_W, height: CANVAS_H, overflow: 'hidden' }}
        onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        onClick={() => onSelect(null)}>
        {/* Wall */}
        <div className="absolute inset-x-0 top-0" style={{ height: WALL_H }}>
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(180deg, #d4cfc8 0%, #c8c2b8 60%, #b8b0a4 100%)',
          }} />
          <div className="absolute inset-0" style={{
            opacity: 0.06,
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.1) 3px, rgba(0,0,0,0.1) 4px)',
          }} />
          <div className="absolute bottom-0 left-0 right-0" style={{
            height: 7,
            background: 'linear-gradient(180deg, #8a7e6e 0%, #6e6456 100%)',
            borderTop: '1px solid #9e9282',
          }} />
        </div>
        {/* Floor */}
        <div className="absolute inset-x-0 bottom-0" style={{ top: WALL_H }}>
          <div className="absolute inset-0" style={{
            background: 'linear-gradient(180deg, #c4a87a 0%, #b89a6e 30%, #a88e64 100%)',
          }} />
          <div className="absolute inset-0" style={{
            opacity: 0.08,
            backgroundImage: `repeating-linear-gradient(90deg, transparent, transparent 79px, rgba(0,0,0,0.15) 79px, rgba(0,0,0,0.15) 80px),
              repeating-linear-gradient(0deg, transparent, transparent 15px, rgba(0,0,0,0.05) 15px, rgba(0,0,0,0.05) 16px)`,
          }} />
          <div className="absolute top-0 left-0 right-0" style={{
            height: 12,
            background: 'linear-gradient(180deg, rgba(0,0,0,0.08), transparent)',
          }} />
        </div>
        {/* Placed assets */}
        {config.assets.map(a => {
          const isSelected = selectedId === a.id
          const dispW = a.cropW * a.scale
          const dispH = a.cropH * a.scale
          return (
            <div key={a.id} className="absolute" style={{
              left: a.x, top: a.y, zIndex: isSelected ? 50 : 10,
            }}
              onMouseDown={e => onAssetDown(e, a)}
              onClick={e => e.stopPropagation()}>
              {a.src === '__widget_clock__' ? (
                <div style={{
                  outline: isSelected ? '2px solid #3b82f6' : 'none',
                  outlineOffset: 1, cursor: 'move',
                }}>
                  <div style={{
                    fontFamily: 'monospace', fontSize: 11 * a.scale, fontWeight: 'bold',
                    color: '#8b9cf7', textShadow: '0 0 6px rgba(139,156,247,0.4)',
                    background: 'linear-gradient(180deg, #1a1a2e, #16162a)',
                    border: '2px solid #2a2a4a', borderRadius: 3,
                    padding: `${2 * a.scale}px ${8 * a.scale}px`,
                    whiteSpace: 'nowrap', lineHeight: 1.2,
                  }}>00:00:00</div>
                </div>
              ) : (
                <div style={{
                  width: dispW, height: dispH,
                  overflow: 'hidden',
                  outline: isSelected ? '2px solid #3b82f6' : 'none',
                  outlineOffset: 1,
                  cursor: 'move',
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
              {/* Resize handle (bottom-right corner) */}
              {isSelected && (
                <div
                  onMouseDown={e => onResizeDown(e, a)}
                  style={{
                    position: 'absolute',
                    right: -4, bottom: -4,
                    width: 10, height: 10,
                    background: '#3b82f6',
                    border: '1px solid #fff',
                    borderRadius: 2,
                    cursor: 'nwse-resize',
                    zIndex: 60,
                  }}
                />
              )}
            </div>
          )
        })}
        {/* Workstation area placeholder */}
        {(() => {
          const refW1 = Math.round(250 * ws.scale)
          const refW2 = Math.round(440 * ws.scale)
          const refH = Math.round(260 * ws.scale)
          return (
            <div className="absolute" style={{
              left: ws.x, top: ws.y, width: ws.w, height: ws.h,
              border: '2px dashed rgba(139,156,247,0.5)',
              borderRadius: 6,
              background: 'rgba(139,156,247,0.05)',
              cursor: 'move',
              zIndex: 5,
              overflow: 'hidden',
            }}
              onMouseDown={onWsDown}
              onClick={e => e.stopPropagation()}>
              {/* Header info */}
              <div className="absolute top-1 left-2 right-20 text-[10px] font-mono"
                style={{ color: 'rgba(139,156,247,0.7)', zIndex: 2 }}>
                Workstation Zone · {ws.scale}x · 1-mon: {refW1}×{refH} · 2-mon: {refW2}×{refH}
              </div>
              {/* Reference grid: repeating workstation-sized cells */}
              <div className="absolute inset-0 pointer-events-none" style={{
                top: 16,
                backgroundImage: `
                  repeating-linear-gradient(90deg,
                    rgba(139,156,247,0.15) 0px, rgba(139,156,247,0.15) 1px,
                    transparent 1px, transparent ${refW1}px),
                  repeating-linear-gradient(0deg,
                    rgba(139,156,247,0.15) 0px, rgba(139,156,247,0.15) 1px,
                    transparent 1px, transparent ${refH}px)
                `,
                backgroundSize: `${refW1}px ${refH}px`,
              }} />
              {/* Scale controls */}
              <div className="absolute bottom-1 left-2 flex items-center gap-1" style={{ zIndex: 2 }}
                onClick={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}>
                <button onClick={() => onUpdateWsArea({ scale: Math.max(0.3, Math.round((ws.scale - 0.05) * 100) / 100) })}
                  className="px-1.5 py-0 text-[10px] rounded" style={{ background: 'rgba(139,156,247,0.3)', color: '#c8d0ff' }}>−</button>
                <span className="text-[10px] font-mono" style={{ color: 'rgba(139,156,247,0.7)' }}>{ws.scale}x</span>
                <button onClick={() => onUpdateWsArea({ scale: Math.min(2, Math.round((ws.scale + 0.05) * 100) / 100) })}
                  className="px-1.5 py-0 text-[10px] rounded" style={{ background: 'rgba(139,156,247,0.3)', color: '#c8d0ff' }}>+</button>
              </div>
              {/* Resize handle */}
              <div onMouseDown={onWsResizeDown} style={{
                position: 'absolute', right: -5, bottom: -5,
                width: 10, height: 10,
                background: '#8b9cf7', border: '1px solid #fff',
                borderRadius: 2, cursor: 'nwse-resize', zIndex: 60,
              }} />
            </div>
          )
        })()}
        {/* News area placeholder */}
        <div className="absolute" style={{
          left: na.x, top: na.y, width: na.w, height: na.h,
          border: '2px dashed rgba(74,222,128,0.5)',
          borderRadius: 6,
          background: 'rgba(74,222,128,0.05)',
          cursor: 'move',
          zIndex: 5,
          overflow: 'hidden',
        }}
          onMouseDown={onNewsDown}
          onClick={e => e.stopPropagation()}>
          <div className="absolute top-1 left-2 right-20 text-[10px] font-mono"
            style={{ color: 'rgba(74,222,128,0.7)', zIndex: 2 }}>
            News Zone · {na.scale}x
          </div>
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center"
            style={{ top: 16 }}>
            <div className="text-[10px] font-mono text-center"
              style={{ color: 'rgba(74,222,128,0.3)' }}>
              Idle characters + screens
            </div>
          </div>
          <div className="absolute bottom-1 left-2 flex items-center gap-1" style={{ zIndex: 2 }}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}>
            <button onClick={() => onUpdateNewsArea({ scale: Math.max(0.3, Math.round((na.scale - 0.05) * 100) / 100) })}
              className="px-1.5 py-0 text-[10px] rounded" style={{ background: 'rgba(74,222,128,0.3)', color: '#a7f3d0' }}>−</button>
            <span className="text-[10px] font-mono" style={{ color: 'rgba(74,222,128,0.7)' }}>{na.scale}x</span>
            <button onClick={() => onUpdateNewsArea({ scale: Math.min(2, Math.round((na.scale + 0.05) * 100) / 100) })}
              className="px-1.5 py-0 text-[10px] rounded" style={{ background: 'rgba(74,222,128,0.3)', color: '#a7f3d0' }}>+</button>
          </div>
          <div onMouseDown={onNewsResizeDown} style={{
            position: 'absolute', right: -5, bottom: -5,
            width: 10, height: 10,
            background: '#4ade80', border: '1px solid #fff',
            borderRadius: 2, cursor: 'nwse-resize', zIndex: 60,
          }} />
        </div>
        {/* Grid overlay */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }} />
      </div>
    </div>
  )
}

const ALL_FILES: { cat: string; file: string }[] = [
  { cat: 'doors', file: 'animated-doors.png' }, { cat: 'doors', file: 'doors-v1.png' },
  { cat: 'doors', file: 'door-rework.png' }, { cat: 'doors', file: 'door-rework-windows.png' },
  { cat: 'office', file: 'Laptop.png' }, { cat: 'office', file: 'TV, Widescreen.png' },
  { cat: 'office', file: 'Desk, Ornate.png' }, { cat: 'office', file: 'Coffee Maker.png' },
  { cat: 'office', file: 'Water Cooler.png' }, { cat: 'office', file: 'Bins.png' },
  { cat: 'office', file: 'office-appliances.png' }, { cat: 'office', file: 'office-chairs.png' },
  { cat: 'furniture', file: 'shelves-brown.png' }, { cat: 'furniture', file: 'house-insides.png' },
  { cat: 'furniture', file: 'upholstery.png' }, { cat: 'furniture', file: 'wooden-dark.png' },
  { cat: 'plants', file: 'potted-plants.png' }, { cat: 'plants', file: 'lpc-plants.png' },
  { cat: 'plants', file: 'rpg-indoor-expansion.png' },
  { cat: 'screens', file: 'scifi-tiles.png' }, { cat: 'screens', file: 'computer-screen.png' },
]

function CustomCropPicker({ onSelect, onCancel }: {
  onSelect: (src: string) => void; onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center" onClick={onCancel}>
      <div className="bg-[#1a1c28] rounded-lg border border-border/50 p-4 max-w-lg" onClick={e => e.stopPropagation()}>
        <div className="text-sm font-semibold mb-3">Select spritesheet to crop from</div>
        <div className="grid grid-cols-2 gap-1 max-h-[60vh] overflow-y-auto">
          {ALL_FILES.map(f => (
            <button key={`${f.cat}/${f.file}`}
              onClick={() => onSelect(`/static/arena-sprites/assets/${f.cat}/${f.file}`)}
              className="text-left px-2 py-1.5 text-[11px] rounded hover:bg-white/10 text-muted-foreground hover:text-white">
              <span className="text-white/40">{f.cat}/</span>{f.file}
            </button>
          ))}
        </div>
        <button onClick={onCancel} className="mt-3 px-3 py-1 text-xs bg-muted rounded">Cancel</button>
      </div>
    </div>
  )
}

function AssetCropper({ src, label, onConfirm, onCancel }: {
  src: string; label: string
  onConfirm: (cx: number, cy: number, cw: number, ch: number) => void
  onCancel: () => void
}) {
  const [sel, setSel] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [start, setStart] = useState({ x: 0, y: 0 })
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 })
  const imgRef = useRef<HTMLImageElement>(null)
  const zoom = 2

  const onImgLoad = () => {
    if (imgRef.current) {
      setImgSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight })
    }
  }

  const getPos = (e: React.MouseEvent) => {
    const rect = imgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: Math.round(((e.clientX - rect.left) / rect.width) * imgSize.w),
      y: Math.round(((e.clientY - rect.top) / rect.height) * imgSize.h),
    }
  }

  const onDown = (e: React.MouseEvent) => {
    const p = getPos(e)
    setStart(p)
    setSel({ x: p.x, y: p.y, w: 1, h: 1 })
    setDrawing(true)
  }

  const onMove = (e: React.MouseEvent) => {
    if (!drawing) return
    const p = getPos(e)
    const x = Math.min(start.x, p.x)
    const y = Math.min(start.y, p.y)
    setSel({ x, y, w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) })
  }

  const onUp = () => setDrawing(false)

  const dispW = imgSize.w * zoom
  const dispH = imgSize.h * zoom

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
      onClick={onCancel}>
      <div className="bg-[#1a1c28] rounded-lg border border-border/50 p-4 max-w-[90vw] max-h-[90vh] flex flex-col gap-3"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Crop: {label}</span>
          <span className="text-xs text-muted-foreground">
            {sel ? `${sel.w}×${sel.h}px from (${sel.x},${sel.y})` : 'Click & drag to select region'}
          </span>
        </div>
        <div className="overflow-auto" style={{ maxHeight: '70vh' }}>
          <div className="relative" style={{ width: dispW || 'auto', height: dispH || 'auto', cursor: 'crosshair' }}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}>
            <img ref={imgRef} src={src} alt={label} onLoad={onImgLoad}
              draggable={false} style={{
                imageRendering: 'pixelated',
                width: dispW || 'auto', height: dispH || 'auto',
              }} />
            {sel && sel.w > 0 && sel.h > 0 && (
              <div className="absolute border-2 border-blue-400 bg-blue-400/10 pointer-events-none" style={{
                left: sel.x * zoom, top: sel.y * zoom,
                width: sel.w * zoom, height: sel.h * zoom,
              }} />
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {sel && sel.w > 2 && sel.h > 2 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Preview:</span>
              <div className="border border-border/30 bg-black/40 p-1" style={{
                width: sel.w * 2 + 8, height: sel.h * 2 + 8,
              }}>
                <div style={{
                  width: sel.w * 2, height: sel.h * 2,
                  backgroundImage: `url(${src})`,
                  backgroundPosition: `-${sel.x * 2}px -${sel.y * 2}px`,
                  backgroundSize: `${imgSize.w * 2}px ${imgSize.h * 2}px`,
                  imageRendering: 'pixelated',
                }} />
              </div>
            </div>
          )}
          <div className="flex gap-2 ml-auto">
            <button onClick={onCancel}
              className="px-3 py-1.5 rounded text-xs bg-muted hover:bg-muted/80">Cancel</button>
            <button disabled={!sel || sel.w < 2 || sel.h < 2}
              onClick={() => sel && onConfirm(sel.x, sel.y, sel.w, sel.h)}
              className="px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground disabled:opacity-30">
              Place on Canvas
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const STATE_LABELS: Record<string, string> = {
  idle: 'Idle (no position)',
  holding_profit: 'Holding Profit',
  holding_loss: 'Holding Loss',
  just_traded: 'Just Traded',
  program_running: 'Program Running',
  ai_thinking: 'AI Thinking',
  error: 'Error',
  offline: 'Offline',
}

function AnimPreview({ animName }: { animName: string }) {
  const anim = ANIM_LOOKUP[animName]
  const [col, setCol] = useState(0)
  const scale = 0.8
  const size = 64 * scale
  const sheetW = 13 * size
  const sheetH = 54 * size
  // Show south-facing (dirOffset 2 for 4-dir, 0 for 1-dir)
  const row = anim ? anim.baseRow + (anim.dirs > 1 ? 2 : 0) : 0
  const frames = anim?.frames || 1

  useEffect(() => {
    if (frames <= 1) { setCol(0); return }
    let idx = 0
    const t = setInterval(() => { idx = (idx + 1) % frames; setCol(idx) }, 200)
    return () => clearInterval(t)
  }, [animName, frames])

  if (!anim) return null
  return (
    <div style={{
      width: size, height: size, flexShrink: 0,
      backgroundImage: 'url(/static/arena-sprites/avatar_01.png)',
      backgroundSize: `${sheetW}px ${sheetH}px`,
      backgroundPosition: `-${col * size}px -${row * size}px`,
      imageRendering: 'pixelated',
    }} />
  )
}

function AnimationMapper({ map, onChange }: {
  map: Record<string, string>; onChange: (state: string, anim: string) => void
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">Animation Mapping (global)</h3>
      <div className="grid grid-cols-2 gap-2" style={{ maxWidth: 800 }}>
        {Object.entries(STATE_LABELS).map(([state, label]) => (
          <div key={state} className="flex items-center gap-2 bg-black/20 rounded px-3 py-1.5">
            <AnimPreview animName={map[state] || 'idle'} />
            <span className="text-xs font-mono w-36 shrink-0">{label}</span>
            <select value={map[state] || 'idle'} onChange={e => onChange(state, e.target.value)}
              className="flex-1 text-xs bg-black/40 border border-border/30 rounded px-2 py-1 text-white">
              {ANIM_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}

function loadConfig(): SceneConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (!shouldUseOfficialConfig(parsed)) {
        return normalizeSceneConfig(parsed)
      }
    }
  } catch { /* ignore */ }
  return normalizeSceneConfig(OFFICIAL_SCENE_CONFIG)
}

export default function SceneEditor() {
  const [config, setConfig] = useState<SceneConfig>(loadConfig)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const [customCropOpen, setCustomCropOpen] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }, [config])

  const placeItem = useCallback((item: AssetItem) => {
    const isWidget = item.file.startsWith('__widget_')
    const defaultScale = isWidget ? 1 : Math.max(2, Math.min(4, Math.round(64 / Math.max(item.w, item.h) * 3)))
    const asset: PlacedAsset = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      src: isWidget ? item.file : `${ITEMS_PATH}/${item.file}`,
      label: item.label,
      x: CANVAS_W / 2 - (item.w * defaultScale) / 2,
      y: CANVAS_H / 2 - (item.h * defaultScale) / 2,
      scale: defaultScale, cropX: 0, cropY: 0, cropW: item.w, cropH: item.h,
    }
    setConfig(c => ({ ...c, assets: [...c.assets, asset] }))
  }, [])

  const addAsset = useCallback((src: string, label: string,
    cropX: number, cropY: number, cropW: number, cropH: number) => {
    const asset: PlacedAsset = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      src, label, x: CANVAS_W / 2 - (cropW * 2) / 2, y: CANVAS_H / 2 - (cropH * 2) / 2,
      scale: 2, cropX, cropY, cropW, cropH,
    }
    setConfig(c => ({ ...c, assets: [...c.assets, asset] }))
    setCropSrc(null)
  }, [])

  const removeSelected = useCallback(() => {
    if (!selectedId) return
    setConfig(c => ({ ...c, assets: c.assets.filter(a => a.id !== selectedId) }))
    setSelectedId(null)
  }, [selectedId])

  const updateAsset = useCallback((id: string, patch: Partial<PlacedAsset>) => {
    setConfig(c => ({
      ...c,
      assets: c.assets.map(a => a.id === id ? { ...a, ...patch } : a),
    }))
  }, [])

  const setAnim = useCallback((state: string, anim: string) => {
    setConfig(c => ({
      ...c, animationMap: { ...c.animationMap, [state]: anim },
    }))
  }, [])

  const updateWsArea = useCallback((patch: Partial<WorkstationArea>) => {
    setConfig(c => ({
      ...c,
      workstationArea: { ...(c.workstationArea || DEFAULT_WS_AREA), ...patch },
    }))
  }, [])

  const updateNewsArea = useCallback((patch: Partial<NewsArea>) => {
    setConfig(c => ({
      ...c,
      newsArea: { ...(c.newsArea || DEFAULT_NEWS_AREA), ...patch },
    }))
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      if (shouldUseOfficialConfig(parsed)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(loadConfig()))
      }
    } catch {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(loadConfig()))
    }
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <button onClick={save}
          className="px-3 py-1.5 rounded text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-500">
          {saved ? 'Saved!' : 'Save Config'}
        </button>
        <button onClick={() => setConfig(normalizeSceneConfig({
          sceneVersion: config.sceneVersion ?? OFFICIAL_SCENE_VERSION,
          assets: [],
          animationMap: { ...DEFAULT_ANIM_MAP },
          workstationArea: { ...DEFAULT_WS_AREA },
          newsArea: { ...DEFAULT_NEWS_AREA },
        }))}
          className="px-3 py-1.5 rounded text-sm font-medium bg-red-900/50 text-red-300 hover:bg-red-900/70">
          Reset All
        </button>
        <span className="text-xs text-muted-foreground ml-2">
          {config.assets.length} assets placed
        </span>
      </div>

      <div className="flex gap-4" style={{ minHeight: CANVAS_H + 40 }}>
        <AssetPalette onPlace={placeItem} onCustomCrop={() => setCustomCropOpen(true)} />
        <EditorCanvas config={config} selectedId={selectedId}
          onSelect={setSelectedId} onUpdate={updateAsset} onRemove={removeSelected}
          onUpdateWsArea={updateWsArea} onUpdateNewsArea={updateNewsArea} />
      </div>

      {customCropOpen && !cropSrc && (
        <CustomCropPicker onSelect={src => setCropSrc(src)} onCancel={() => setCustomCropOpen(false)} />
      )}
      {cropSrc && (
        <AssetCropper src={cropSrc} label={cropSrc.split('/').pop() || 'asset'}
          onConfirm={(cX, cY, cW, cH) => { addAsset(cropSrc, cropSrc.split('/').pop() || 'asset', cX, cY, cW, cH); setCustomCropOpen(false) }}
          onCancel={() => { setCropSrc(null); setCustomCropOpen(false) }}
        />
      )}

      <AnimationMapper map={config.animationMap} onChange={setAnim} />
    </div>
  )
}
