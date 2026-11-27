// Pixel frame data for Arena View characters
// Each frame is a string array where each character maps to a color in the palette
// Character size: 16 wide x 20 tall (compact for isometric workstation view)
// Perspective: isometric 45-deg, character faces upper-right toward monitor

// Legend:
// H = hair, S = skin, E = eye, M = mouth, C = shirt, P = pants, B = shoes
// O = outline, . = transparent

// --- Male frames ---

export const MALE_IDLE_SITTING: string[] = [
  '......HHHH......',
  '.....HHHHHH.....',
  '.....HOHHOH.....',
  '.....HSSEHS.....',
  '......SSSS......',
  '......SMMS......',
  '.....CCCCCC.....',
  '....CCCCCCCC....',
  '....CSCCCCSC....',
  '...SSCCCCCCSS...',
  '...SS.CCCC.SS...',
  '......CCCC......',
  '......PPPP......',
  '......PPPP......',
  '.....PPPPPP.....',
  '.....PP..PP.....',
  '.....BB..BB.....',
]

export const MALE_IDLE_SITTING_2: string[] = [
  '......HHHH......',
  '.....HHHHHH.....',
  '.....HOHHOH.....',
  '.....HSSEHS.....',
  '......SSSS......',
  '......SMMS......',
  '.....CCCCCC.....',
  '....CCCCCCCC....',
  '....CSCCCCSC....',
  '..SSSCCCCCCSS...',
  '..SS..CCCC..S...',
  '......CCCC......',
  '......PPPP......',
  '......PPPP......',
  '.....PPPPPP.....',
  '.....PP..PP.....',
  '.....BB..BB.....',
]

// --- Female frames (slightly different hair shape) ---

export const FEMALE_IDLE_SITTING: string[] = [
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HOHHHOHH....',
  '....HSSEHSHH....',
  '.....HSSSH.H....',
  '......SMMS......',
  '.....CCCCCC.....',
  '....CCCCCCCC....',
  '....CSCCCCSC....',
  '...SSCCCCCCSS...',
  '...SS.CCCC.SS...',
  '......CCCC......',
  '......PPPP......',
  '......PPPP......',
  '.....PPPPPP.....',
  '.....PP..PP.....',
  '.....BB..BB.....',
]

export const FEMALE_IDLE_SITTING_2: string[] = [
  '.....HHHHHH.....',
  '....HHHHHHHH....',
  '....HOHHHOHH....',
  '....HSSEHSHH....',
  '.....HSSSH.H....',
  '......SMMS......',
  '.....CCCCCC.....',
  '....CCCCCCCC....',
  '....CSCCCCSC....',
  '..SSSCCCCCCSS...',
  '..SS..CCCC..S...',
  '......CCCC......',
  '......PPPP......',
  '......PPPP......',
  '.....PPPPPP.....',
  '.....PP..PP.....',
  '.....BB..BB.....',
]

// State frame sets — Phase 2 will expand these
// For Phase 1, all states use idle sitting frames
export type CharacterState =
  | 'offline'
  | 'error'
  | 'program_running'
  | 'just_traded'
  | 'ai_thinking'
  | 'holding_profit'
  | 'holding_loss'
  | 'idle'

export interface FrameSet {
  frames: string[][]
  intervalMs: number  // animation speed
}

export function getFrames(gender: 'male' | 'female', _state: CharacterState): FrameSet {
  // Phase 1: all states use idle frames
  // Phase 2: add unique frames per state
  const frames = gender === 'male'
    ? [MALE_IDLE_SITTING, MALE_IDLE_SITTING_2]
    : [FEMALE_IDLE_SITTING, FEMALE_IDLE_SITTING_2]

  return { frames, intervalMs: 1000 }
}
