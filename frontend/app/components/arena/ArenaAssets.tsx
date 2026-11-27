import { useEffect, useState } from 'react'
import PixelCharacter from './PixelCharacter'
import SceneEditor from './SceneEditor'
import type { CharacterState } from './pixelData/characters'
import type { CharacterDirection } from './PixelCharacter'

const STATES: CharacterState[] = [
  'idle', 'holding_profit', 'holding_loss', 'just_traded',
  'program_running', 'ai_thinking', 'error', 'offline',
]
const DIRECTIONS: CharacterDirection[] = ['up', 'down', 'left', 'right']

const MOODS = [
  { emoji: '😴', label: 'Sleep', bg: '#1e293b' },
  { emoji: '😄', label: 'Profit', bg: '#14532d' },
  { emoji: '😍', label: 'Big Profit', bg: '#064e3b' },
  { emoji: '🎉', label: 'Celebrate', bg: '#064e3b' },
  { emoji: '😡', label: 'Big Loss', bg: '#7f1d1d' },
  { emoji: '😥', label: 'Loss', bg: '#78350f' },
  { emoji: '😰', label: 'Anxiety', bg: '#78350f' },
  { emoji: '🤔', label: 'Thinking', bg: '#1e3a5f' },
  { emoji: '🤖', label: 'Robot', bg: '#1e3a5f' },
  { emoji: '💡', label: 'Idea', bg: '#1e3a5f' },
  { emoji: '⚡', label: 'Trading', bg: '#4a1d96' },
  { emoji: '☕', label: 'Break', bg: '#3b2f1e' },
  { emoji: '📰', label: 'News', bg: '#1e293b' },
]

// All 15 animations from full LPC sheet (54 rows, baseRow = first row in sheet)
const FULL_ANIMS = [
  { name: 'spellcast', baseRow: 0, frames: 7, dirs: 4, desc: 'Arms raised & moving',
    use: 'Typing / Working' },
  { name: 'thrust', baseRow: 4, frames: 8, dirs: 4, desc: 'Stabbing/pierce motion',
    use: 'Pointing at screen' },
  { name: 'walk', baseRow: 8, frames: 9, dirs: 4, desc: 'Standard walk cycle',
    use: 'Walking between workstations' },
  { name: 'slash', baseRow: 12, frames: 6, dirs: 4, desc: 'Arm swing motion',
    use: 'Celebration / Excitement' },
  { name: 'shoot', baseRow: 16, frames: 13, dirs: 4, desc: 'Ranged attack pose',
    use: 'Available for future use' },
  { name: 'hurt', baseRow: 20, frames: 6, dirs: 1, desc: 'Crouching down in pain',
    use: 'Big loss reaction (south only)' },
  { name: 'climb', baseRow: 21, frames: 6, dirs: 1, desc: 'Ladder climbing',
    use: 'Available for future use' },
  { name: 'idle', baseRow: 22, frames: 2, dirs: 4, desc: 'Subtle breathing',
    use: 'Default standing state' },
  { name: 'jump', baseRow: 26, frames: 5, dirs: 4, desc: 'Jumping up',
    use: 'Big profit celebration' },
  { name: 'sit', baseRow: 30, frames: 3, dirs: 4, desc: 'Stand-to-seated',
    use: 'Offline / Sleeping' },
  { name: 'emote', baseRow: 34, frames: 3, dirs: 4, desc: 'Expressive gestures',
    use: 'Reaction to events' },
  { name: 'run', baseRow: 38, frames: 8, dirs: 4, desc: 'Fast movement',
    use: 'Rushing to trade / Urgent' },
  { name: 'combat_idle', baseRow: 42, frames: 2, dirs: 4, desc: 'Alert fist stance',
    use: 'Focused / AI thinking' },
  { name: 'backslash', baseRow: 46, frames: 13, dirs: 4, desc: 'Two-handed overhead swing',
    use: 'Strong action / Available' },
  { name: 'halfslash', baseRow: 50, frames: 6, dirs: 4, desc: 'Short one-hand slash',
    use: 'Quick action / Available' },
]

const DIR_LABELS = ['North (back)', 'West', 'South (front)', 'East']

const SCENE_ASSETS: Record<string, { file: string; label: string }[]> = {
  doors: [
    { file: 'animated-doors.png', label: 'Animated Doors (wood+iron, open/close)' },
    { file: 'doors-v1.png', label: 'Windows & Doors v1 (many styles)' },
    { file: 'door-rework.png', label: 'Door Rework (plain)' },
    { file: 'door-rework-windows.png', label: 'Door Rework (with windows)' },
  ],
  office: [
    { file: 'Laptop.png', label: 'Laptop (on/off)' },
    { file: 'TV, Widescreen.png', label: 'Widescreen TV' },
    { file: 'Desk, Ornate.png', label: 'Ornate Desk' },
    { file: 'Copy Machine.png', label: 'Copy Machine' },
    { file: 'Coffee Maker.png', label: 'Coffee Maker' },
    { file: 'Coffee Cup.png', label: 'Coffee Cup' },
    { file: 'Water Cooler.png', label: 'Water Cooler' },
    { file: 'Bins.png', label: 'Waste Bins' },
    { file: 'Office Portraits.png', label: 'Portraits' },
    { file: 'Rotary Phones.png', label: 'Phones' },
    { file: 'office-appliances.png', label: 'Office Appliances (CC0)' },
    { file: 'office-chairs.png', label: 'Office Chairs' },
  ],
  furniture: [
    { file: 'wooden-dark.png', label: 'Dark Wood Furniture' },
    { file: 'wooden-blonde.png', label: 'Blonde Wood Furniture' },
    { file: 'upholstery.png', label: 'Sofas/Chairs/Lamps' },
    { file: 'shelves-brown.png', label: 'Bookshelf Brown' },
    { file: 'shelves-green.png', label: 'Bookshelf Green' },
    { file: 'house-insides.png', label: 'House Insides' },
    { file: 'house-interior.png', label: 'House Interior Pack' },
  ],
  plants: [
    { file: 'potted-plants.png', label: 'Potted Plants' },
    { file: 'flowers-cc0.png', label: 'Flowers (CC0)' },
    { file: 'rpg-indoor-expansion.png', label: 'RPG Indoor (plants+rugs)' },
    { file: 'lpc-plants.png', label: 'LPC Plants & Fungi' },
  ],
  screens: [
    { file: 'tv-modern-white.png', label: 'Modern TV (white)' },
    { file: 'tv-modern-empty.png', label: 'Modern TV (empty, CC0)' },
    { file: 'tv-retro.gif', label: 'Retro TV (animated)' },
    { file: 'computer-screen.png', label: 'CRT Monitor' },
    { file: 'scifi-tiles.png', label: 'Sci-fi Tiles (CC0)' },
  ],
}

type Tab = 'animations' | 'current' | 'moods' | 'scene' | 'editor'

export default function ArenaAssets() {
  const [tab, setTab] = useState<Tab>('animations')
  const [selectedPreset, setSelectedPreset] = useState(1)

  const tabs: { key: Tab; label: string }[] = [
    { key: 'animations', label: 'All Animations (Full Sheet)' },
    { key: 'current', label: 'Current Mappings' },
    { key: 'moods', label: 'Mood Bubbles' },
    { key: 'scene', label: 'Scene Assets' },
    { key: 'editor', label: 'Scene Editor' },
  ]

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto p-4">
      <h1 className="text-xl font-bold">Arena Asset Library</h1>
      <div className="flex flex-wrap gap-2">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded text-sm font-medium ${
              tab === t.key ? 'bg-primary text-primary-foreground' : 'bg-muted'
            }`}>{t.label}</button>
        ))}
      </div>
      {tab === 'animations' && <AnimationsTab preset={selectedPreset} onPresetChange={setSelectedPreset} />}
      {tab === 'current' && <CurrentTab preset={selectedPreset} onPresetChange={setSelectedPreset} />}
      {tab === 'moods' && <MoodsTab />}
      {tab === 'scene' && <SceneTab />}
      {tab === 'editor' && <SceneEditor />}
    </div>
  )
}

function PresetSelector({ preset, onPresetChange }: {
  preset: number; onPresetChange: (id: number) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: 12 }, (_, i) => i + 1).map(id => (
        <button key={id} onClick={() => onPresetChange(id)}
          className={`w-10 h-10 rounded border text-xs font-mono ${
            preset === id ? 'border-primary bg-primary/20' : 'border-border'
          }`}
          style={{
            backgroundImage: `url(/static/arena-sprites/avatar_${String(id).padStart(2, '0')}.png)`,
            backgroundSize: '130px 160px',
            backgroundPosition: '0 -40px',
            imageRendering: 'pixelated',
          }}
        />
      ))}
    </div>
  )
}

function SpriteFrame({ presetId, row, col, scale = 1.5 }: {
  presetId: number; row: number; col: number; scale?: number
}) {
  const size = 64 * scale
  const sheetW = 13 * size
  const sheetH = 54 * size
  const sprite = `avatar_${String(presetId).padStart(2, '0')}.png`
  return (
    <div style={{
      width: size, height: size,
      backgroundImage: `url(/static/arena-sprites/${sprite})`,
      backgroundSize: `${sheetW}px ${sheetH}px`,
      backgroundPosition: `-${col * size}px -${row * size}px`,
      imageRendering: 'pixelated',
      flexShrink: 0,
    }} />
  )
}

function AnimatedSprite({ presetId, baseRow, dirOffset, frames, speed = 200, scale = 1.2 }: {
  presetId: number; baseRow: number; dirOffset: number; frames: number
  speed?: number; scale?: number
}) {
  const [col, setCol] = useState(0)
  const row = baseRow + dirOffset
  const size = 64 * scale
  const sheetW = 13 * size
  const sheetH = 54 * size
  const sprite = `avatar_${String(presetId).padStart(2, '0')}.png`

  useEffect(() => {
    if (frames <= 1) { setCol(0); return }
    let idx = 0
    const t = setInterval(() => { idx = (idx + 1) % frames; setCol(idx) }, speed)
    return () => clearInterval(t)
  }, [presetId, baseRow, dirOffset, frames, speed])

  return (
    <div style={{
      width: size, height: size,
      backgroundImage: `url(/static/arena-sprites/${sprite})`,
      backgroundSize: `${sheetW}px ${sheetH}px`,
      backgroundPosition: `-${col * size}px -${row * size}px`,
      imageRendering: 'pixelated',
    }} />
  )
}

const DIR_OFFSETS: Record<string, number> = { up: 0, down: 2, left: 1, right: 3 }

function AnimationsTab({ preset, onPresetChange }: {
  preset: number; onPresetChange: (id: number) => void
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold mb-2">Select Preset</h2>
        <PresetSelector preset={preset} onPresetChange={onPresetChange} />
      </div>

      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded p-3">
        <p className="text-xs text-muted-foreground">
          All 15 animations from the <b>full LPC sheet</b> (54 rows). Switch preset above to see different characters.
        </p>
      </div>

      <div className="space-y-4">
        {FULL_ANIMS.map(anim => (
          <div key={anim.name}
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3">
            <div className="flex items-start justify-between mb-2">
              <div>
                <span className="text-sm font-bold font-mono">{anim.name}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  {anim.frames}f × {anim.dirs} dir{anim.dirs > 1 ? 's' : ''}
                  {' '}| rows {anim.baseRow}-{anim.baseRow + anim.dirs - 1}
                </span>
                <span className="text-xs text-muted-foreground ml-2">— {anim.desc}</span>
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                {anim.use}
              </span>
            </div>
            <div className="bg-black/30 rounded p-2 overflow-x-auto">
              {Array.from({ length: anim.dirs }).map((_, d) => (
                <div key={d} className="flex items-center gap-0.5 mb-0.5">
                  <span className="text-[9px] text-muted-foreground/40 font-mono w-16 shrink-0">
                    {DIR_LABELS[d] || `Dir ${d}`}
                  </span>
                  {Array.from({ length: anim.frames }).map((_, f) => (
                    <SpriteFrame key={f} presetId={preset}
                      row={anim.baseRow + d} col={f} scale={1} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CurrentTab({ preset, onPresetChange }: {
  preset: number; onPresetChange: (id: number) => void
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold mb-2">Select Preset</h2>
        <PresetSelector preset={preset} onPresetChange={onPresetChange} />
      </div>

      <div className="bg-emerald-500/10 border border-emerald-500/30 rounded p-3">
        <p className="text-xs text-muted-foreground">
          Updated state→animation mappings using the <b>full LPC sheet</b>. Each state now has a distinct animation.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="p-2 text-xs text-left">State</th>
              {DIRECTIONS.map(d => (
                <th key={d} className="p-2 text-xs text-center">{d}</th>
              ))}
              <th className="p-2 text-xs text-left">Animation Used</th>
            </tr>
          </thead>
          <tbody>
            {STATES.map(state => (
              <tr key={state} className="border-t border-border/30">
                <td className="p-2 text-xs font-mono whitespace-nowrap">{state}</td>
                {DIRECTIONS.map(dir => (
                  <td key={dir} className="p-2">
                    <div className="bg-black/30 rounded flex items-center justify-center"
                      style={{ width: 80, height: 80 }}>
                      <PixelCharacter presetId={preset} state={state}
                        direction={dir} scale={1.2} />
                    </div>
                  </td>
                ))}
                <td className="p-2 text-xs text-emerald-400 font-mono">
                  {{ offline: 'sit (frame 0)',
                     idle: 'idle (2f)',
                     holding_profit: 'slash (6f)',
                     holding_loss: 'combat_idle (2f)',
                     program_running: 'spellcast (7f)',
                     ai_thinking: 'combat_idle (2f)',
                     just_traded: 'jump/run',
                     error: 'hurt/emote',
                  }[state] || 'idle'}
                </td>
              </tr>
            ))}
            <tr><td colSpan={6} className="pt-4 pb-2 text-xs font-semibold text-amber-400">
              Unmapped Animations (available)
            </td></tr>
            {FULL_ANIMS.filter(a => !MAPPED_ANIMS.has(a.name)).map(anim => (
              <tr key={anim.name} className="border-t border-amber-500/20">
                <td className="p-2 text-xs font-mono whitespace-nowrap text-amber-300">{anim.name}</td>
                {DIRECTIONS.map((dir, di) => (
                  <td key={dir} className="p-2">
                    <div className="bg-black/30 rounded flex items-center justify-center"
                      style={{ width: 80, height: 80 }}>
                      {anim.dirs === 1 && di > 0 ? (
                        <span className="text-[9px] text-muted-foreground/30">N/A</span>
                      ) : (
                        <AnimatedSprite presetId={preset}
                          baseRow={anim.baseRow}
                          dirOffset={anim.dirs === 1 ? 0 : DIR_OFFSETS[dir]}
                          frames={anim.frames} speed={200} />
                      )}
                    </div>
                  </td>
                ))}
                <td className="p-2 text-xs text-amber-400 font-mono">
                  {anim.use}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3">
        <h3 className="text-sm font-semibold text-blue-400">State → Animation Mapping</h3>
        <div className="grid grid-cols-2 gap-1 mt-2 text-xs text-muted-foreground">
          <span>offline → sit frame 0 (seated)</span>
          <span>idle → idle (subtle breathing)</span>
          <span>holding_profit → slash (arm swing celebrate)</span>
          <span>holding_loss → combat_idle (tense stance)</span>
          <span>program_running → spellcast (typing motion)</span>
          <span>ai_thinking → combat_idle (focused)</span>
          <span>just_traded → jump (up/down) / run (left/right)</span>
          <span>error → hurt (south) / emote (other dirs)</span>
        </div>
      </div>

    </div>
  )
}

const MAPPED_ANIMS = new Set([
  'spellcast', 'slash', 'hurt', 'idle', 'jump', 'sit', 'emote', 'run', 'combat_idle',
])

function MoodsTab() {
  return (
    <div className="space-y-6">
      <h2 className="text-sm font-semibold">Mood Bubbles</h2>
      <p className="text-xs text-muted-foreground">
        Showcase of the bubble styles used by the live Arena view, including robot and idle variants.
      </p>
      <div className="flex flex-wrap gap-4">
        {MOODS.map(m => (
          <div key={m.label} className="flex flex-col items-center gap-2">
            <div className="relative">
              <div style={{
                position: 'relative',
                background: m.bg, border: '2px solid rgba(255,255,255,0.2)',
                borderRadius: 10, padding: '3px 6px', fontSize: 15, lineHeight: 1,
                boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
              }}>
                {m.emoji}
                <div style={{
                  position: 'absolute', bottom: -6, left: 3,
                  width: 0, height: 0,
                  borderTop: `6px solid ${m.bg}`,
                  borderRight: '6px solid transparent',
                }} />
              </div>
            </div>
            <span className="text-xs text-muted-foreground">{m.label}</span>
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-semibold mb-2">Size Variants</h3>
        <div className="flex gap-6 items-end">
          {[12, 15, 18, 22].map(size => (
            <div key={size} className="flex flex-col items-center gap-1">
              <div style={{
                position: 'relative',
                background: '#14532d', border: '2px solid rgba(255,255,255,0.2)',
                borderRadius: 10, padding: '3px 6px', fontSize: size, lineHeight: 1,
                boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
              }}>
                😄
                <div style={{
                  position: 'absolute', bottom: -6, left: 3,
                  width: 0, height: 0,
                  borderTop: '6px solid #14532d',
                  borderRight: '6px solid transparent',
                }} />
              </div>
              <span className="text-xs text-muted-foreground">{size}px</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3">
        <h3 className="text-sm font-semibold text-blue-400">Current State → Bubble Mapping</h3>
        <div className="grid grid-cols-2 gap-1 mt-2 text-xs text-muted-foreground">
          <span>offline → 😴</span><span>idle → ☕ or 💡</span>
          <span>holding_profit → 😄 or 😍</span><span>holding_loss → 😥 or 😰</span>
          <span>just_traded → ⚡</span><span>program_running → movement only</span>
          <span>ai_thinking → 🤖</span><span>error → 😡</span>
          <span>big_profit → 🎉</span><span>watching_news → 📰</span>
          <span>coffee_break → ☕</span>
        </div>
      </div>
    </div>
  )
}

function SceneTab() {
  const [zoom, setZoom] = useState(2)

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <h2 className="text-sm font-semibold">Scene Assets from OpenGameArt.org</h2>
        <div className="flex items-center gap-2 text-xs">
          <span>Zoom:</span>
          {[1, 2, 3, 4].map(z => (
            <button key={z} onClick={() => setZoom(z)}
              className={`px-2 py-0.5 rounded ${zoom === z ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
              {z}x
            </button>
          ))}
        </div>
      </div>

      {Object.entries(SCENE_ASSETS).map(([category, assets]) => (
        <div key={category}>
          <h3 className="text-sm font-semibold capitalize mb-3 text-primary">{category}</h3>
          <div className="flex flex-wrap gap-4">
            {assets.map(a => (
              <div key={a.file}
                className="bg-black/20 border border-border/30 rounded-lg p-3 flex flex-col items-center gap-2">
                <div className="bg-black/40 rounded p-2 overflow-auto"
                  style={{ maxWidth: 400, maxHeight: 400 }}>
                  <img src={`/static/arena-sprites/assets/${category}/${a.file}`} alt={a.label}
                    style={{ imageRendering: 'pixelated', transform: `scale(${zoom})`, transformOrigin: 'top left' }} />
                </div>
                <span className="text-xs text-muted-foreground text-center max-w-[200px]">{a.label}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div>
        <h3 className="text-sm font-semibold text-primary mb-3">Misc Atlas (all-in-one)</h3>
        <div className="bg-black/20 border border-border/30 rounded-lg p-3 overflow-auto">
          <img src="/static/arena-sprites/assets/misc-atlas.png" alt="Misc tile atlas"
            style={{ imageRendering: 'pixelated', transform: `scale(${zoom})`, transformOrigin: 'top left' }} />
        </div>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3">
        <h3 className="text-sm font-semibold text-amber-400">Missing Assets</h3>
        <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
          <li>Door sprites — FOUND! See "doors" section above</li>
          <li>Gym/fitness equipment — does NOT exist on OpenGameArt</li>
          <li>Alternative: use coffee maker, water cooler for "break" activities</li>
        </ul>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/30 rounded p-3">
        <h3 className="text-sm font-semibold text-blue-400">License Summary</h3>
        <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
          <li><b>CC0</b>: office-appliances, flowers, tv-modern, computer-screen, scifi-tiles</li>
          <li><b>CC-BY 3.0</b>: office-chairs, rpg-indoor-expansion</li>
          <li><b>CC-BY 4.0</b>: upholstery, lpc-plants</li>
          <li><b>CC-BY-SA 3.0</b>: The Office pack, wooden furniture, shelves, house interior</li>
        </ul>
      </div>
    </div>
  )
}
