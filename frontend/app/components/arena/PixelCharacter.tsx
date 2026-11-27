import { useEffect, useState } from 'react'
import {
  getPreset, SPRITE_FRAME_SIZE, SPRITE_COLS, SPRITE_ROWS,
  DIR_DOWN, DIR_LEFT, DIR_UP, DIR_EAST,
  ANIM_WALK, ANIM_IDLE, ANIM_SIT, ANIM_EMOTE,
  ANIM_SPELLCAST, ANIM_SLASH, ANIM_HURT, ANIM_RUN,
  ANIM_JUMP, ANIM_COMBAT_IDLE,
  ANIM_THRUST, ANIM_SHOOT, ANIM_CLIMB, ANIM_BACKSLASH, ANIM_HALFSLASH,
  WALK_FRAMES, IDLE_FRAMES, SIT_FRAMES, EMOTE_FRAMES,
  SPELLCAST_FRAMES, SLASH_FRAMES, HURT_FRAMES, RUN_FRAMES,
  JUMP_FRAMES, COMBAT_IDLE_FRAMES,
  THRUST_FRAMES, SHOOT_FRAMES, CLIMB_FRAMES, BACKSLASH_FRAMES, HALFSLASH_FRAMES,
} from './pixelData/palettes'
import type { CharacterState } from './pixelData/characters'

export type CharacterDirection = 'up' | 'down' | 'left' | 'right'

const ANIM_BY_NAME: Record<string, { baseRow: number; frames: number; dirs: number }> = {
  spellcast: { baseRow: ANIM_SPELLCAST, frames: SPELLCAST_FRAMES, dirs: 4 },
  thrust: { baseRow: ANIM_THRUST, frames: THRUST_FRAMES, dirs: 4 },
  walk: { baseRow: ANIM_WALK, frames: WALK_FRAMES, dirs: 4 },
  slash: { baseRow: ANIM_SLASH, frames: SLASH_FRAMES, dirs: 4 },
  shoot: { baseRow: ANIM_SHOOT, frames: SHOOT_FRAMES, dirs: 4 },
  hurt: { baseRow: ANIM_HURT, frames: HURT_FRAMES, dirs: 1 },
  climb: { baseRow: ANIM_CLIMB, frames: CLIMB_FRAMES, dirs: 1 },
  idle: { baseRow: ANIM_IDLE, frames: IDLE_FRAMES, dirs: 4 },
  jump: { baseRow: ANIM_JUMP, frames: JUMP_FRAMES, dirs: 4 },
  sit: { baseRow: ANIM_SIT, frames: SIT_FRAMES, dirs: 4 },
  emote: { baseRow: ANIM_EMOTE, frames: EMOTE_FRAMES, dirs: 4 },
  run: { baseRow: ANIM_RUN, frames: RUN_FRAMES, dirs: 4 },
  combat_idle: { baseRow: ANIM_COMBAT_IDLE, frames: COMBAT_IDLE_FRAMES, dirs: 4 },
  backslash: { baseRow: ANIM_BACKSLASH, frames: BACKSLASH_FRAMES, dirs: 4 },
  halfslash: { baseRow: ANIM_HALFSLASH, frames: HALFSLASH_FRAMES, dirs: 4 },
}

const STATE_SPEED: Record<string, number> = {
  offline: 0, idle: 900, holding_profit: 300, holding_loss: 600,
  just_traded: 150, program_running: 250, ai_thinking: 500, error: 400,
}

interface PixelCharacterProps {
  presetId: number | null
  state: CharacterState
  direction?: CharacterDirection
  scale?: number
  animationMap?: Record<string, string>
}

const DIR_MAP: Record<CharacterDirection, number> = {
  up: DIR_UP, down: DIR_DOWN, left: DIR_LEFT, right: DIR_EAST,
}

function getAnimConfig(state: CharacterState, dir: CharacterDirection, animMap?: Record<string, string>): {
  animBase: number; maxFrames: number; speed: number; singleDir: boolean
} {
  // Use custom animation map if provided
  if (animMap && animMap[state]) {
    const anim = ANIM_BY_NAME[animMap[state]]
    if (anim) {
      const speed = STATE_SPEED[state] ?? 500
      const frames = state === 'offline' ? 1 : anim.frames
      return { animBase: anim.baseRow, maxFrames: frames, speed, singleDir: anim.dirs === 1 }
    }
  }
  // Fallback to hardcoded defaults
  switch (state) {
    case 'offline':
      return { animBase: ANIM_SIT, maxFrames: 1, speed: 0, singleDir: false }
    case 'idle':
      return { animBase: ANIM_IDLE, maxFrames: IDLE_FRAMES, speed: 900, singleDir: false }
    case 'holding_profit':
      return { animBase: ANIM_SLASH, maxFrames: SLASH_FRAMES, speed: 300, singleDir: false }
    case 'holding_loss':
      return { animBase: ANIM_COMBAT_IDLE, maxFrames: COMBAT_IDLE_FRAMES, speed: 600, singleDir: false }
    case 'program_running':
      return { animBase: ANIM_SPELLCAST, maxFrames: SPELLCAST_FRAMES, speed: 250, singleDir: false }
    case 'ai_thinking':
      return { animBase: ANIM_COMBAT_IDLE, maxFrames: COMBAT_IDLE_FRAMES, speed: 500, singleDir: false }
    case 'just_traded':
      if (dir === 'left' || dir === 'right') {
        return { animBase: ANIM_RUN, maxFrames: RUN_FRAMES, speed: 120, singleDir: false }
      }
      return { animBase: ANIM_JUMP, maxFrames: JUMP_FRAMES, speed: 200, singleDir: false }
    case 'error':
      if (dir === 'down') {
        return { animBase: ANIM_HURT, maxFrames: HURT_FRAMES, speed: 400, singleDir: true }
      }
      return { animBase: ANIM_EMOTE, maxFrames: EMOTE_FRAMES, speed: 500, singleDir: false }
    default:
      return { animBase: ANIM_IDLE, maxFrames: IDLE_FRAMES, speed: 900, singleDir: false }
  }
}

export default function PixelCharacter({
  presetId,
  state,
  direction = 'up',
  scale = 1.5,
  animationMap,
}: PixelCharacterProps) {
  const preset = getPreset(presetId)
  const [frameCol, setFrameCol] = useState(0)

  const { animBase, maxFrames, speed, singleDir } = getAnimConfig(state, direction, animationMap)
  const dirRow = DIR_MAP[direction]

  // For offline sit, use frame 0 (fully seated); for others, animate
  const staticFrame = state === 'offline' ? 0 : null

  const row = singleDir ? animBase : animBase + dirRow

  useEffect(() => {
    setFrameCol(0)
    if (staticFrame !== null) { setFrameCol(staticFrame); return }
    if (speed === 0) return
    let idx = 0
    const timer = setInterval(() => {
      idx = (idx + 1) % maxFrames
      setFrameCol(idx)
    }, speed)
    return () => clearInterval(timer)
  }, [state, direction, speed, maxFrames, staticFrame])

  const displaySize = SPRITE_FRAME_SIZE * scale
  const sheetW = SPRITE_COLS * displaySize
  const sheetH = SPRITE_ROWS * displaySize

  return (
    <div
      style={{
        width: displaySize,
        height: displaySize,
        backgroundImage: `url(/static/arena-sprites/${preset.sprite})`,
        backgroundSize: `${sheetW}px ${sheetH}px`,
        backgroundPosition: `-${frameCol * displaySize}px -${row * displaySize}px`,
        imageRendering: 'pixelated',
      }}
    />
  )
}
