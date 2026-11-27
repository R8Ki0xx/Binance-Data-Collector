// Avatar presets for Arena View pixel characters
// Each sprite sheet: 832x3456 PNG (13 cols x 54 rows, 64x64 per frame)
// Full LPC universal-expanded format with all animations.

export interface AvatarPreset {
  id: number
  sprite: string
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 1,  sprite: 'avatar_01.png' },
  { id: 2,  sprite: 'avatar_02.png' },
  { id: 3,  sprite: 'avatar_03.png' },
  { id: 4,  sprite: 'avatar_04.png' },
  { id: 5,  sprite: 'avatar_05.png' },
  { id: 6,  sprite: 'avatar_06.png' },
  { id: 7,  sprite: 'avatar_07.png' },
  { id: 8,  sprite: 'avatar_08.png' },
  { id: 9,  sprite: 'avatar_09.png' },
  { id: 10, sprite: 'avatar_10.png' },
  { id: 11, sprite: 'avatar_11.png' },
  { id: 12, sprite: 'avatar_12.png' },
]

export function getPreset(id: number | null | undefined): AvatarPreset {
  if (!id) return AVATAR_PRESETS[0]
  return AVATAR_PRESETS.find(p => p.id === id) || AVATAR_PRESETS[0]
}

// Sprite sheet layout constants
export const SPRITE_FRAME_SIZE = 64
export const SPRITE_COLS = 13
export const SPRITE_ROWS = 54

// Directions (row offset within each 4-row animation block)
export const DIR_UP = 0    // North (back to viewer)
export const DIR_LEFT = 1  // West
export const DIR_DOWN = 2  // South (facing viewer)
export const DIR_EAST = 3  // East

// Animation base rows (first row of each animation block)
// Original LPC animations (rows 0-20)
export const ANIM_SPELLCAST = 0    // rows 0-3, 7 frames — "typing/working"
export const ANIM_THRUST = 4       // rows 4-7, 8 frames — "pointing"
export const ANIM_WALK = 8         // rows 8-11, 9 frames — walking
export const ANIM_SLASH = 12       // rows 12-15, 6 frames — "celebrate"
export const ANIM_SHOOT = 16       // rows 16-19, 13 frames — ranged
export const ANIM_HURT = 20        // row 20 only (south), 6 frames — "loss reaction"

// Expanded animations (rows 21-53)
export const ANIM_CLIMB = 21       // row 21 only (north), 6 frames
export const ANIM_IDLE = 22        // rows 22-25, 2 frames — standing
export const ANIM_JUMP = 26        // rows 26-29, 5 frames — "big celebrate"
export const ANIM_SIT = 30         // rows 30-33, 3 frames — sitting/sleeping
export const ANIM_EMOTE = 34       // rows 34-37, 3 frames — expressions
export const ANIM_RUN = 38         // rows 38-41, 8 frames — fast movement
export const ANIM_COMBAT_IDLE = 42 // rows 42-45, 2 frames — "focused/alert"
export const ANIM_BACKSLASH = 46   // rows 46-49, 13 frames
export const ANIM_HALFSLASH = 50   // rows 50-53, 6 frames

// Frame counts per animation
export const SPELLCAST_FRAMES = 7
export const THRUST_FRAMES = 8
export const WALK_FRAMES = 9
export const SLASH_FRAMES = 6
export const SHOOT_FRAMES = 13
export const HURT_FRAMES = 6
export const CLIMB_FRAMES = 6
export const IDLE_FRAMES = 2
export const JUMP_FRAMES = 5
export const SIT_FRAMES = 3
export const EMOTE_FRAMES = 3
export const RUN_FRAMES = 8
export const COMBAT_IDLE_FRAMES = 2
export const BACKSLASH_FRAMES = 13
export const HALFSLASH_FRAMES = 6
