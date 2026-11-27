// Pixel data for isometric workstation furniture
// Perspective: 45-deg isometric, viewer from bottom-left
// Layout: monitor at top, desk surface below, character sits at bottom

// Legend:
// D = desk surface (dark wood), d = desk shadow/side
// N = monitor frame, G = screen (glow area — DOM overlay target)
// K = keyboard, k = keyboard shadow
// R = chair back, r = chair seat, A = chair arm
// . = transparent

// Monitor + Desk + Chair composite (22 wide x 24 tall)
// Character overlays on top of this at a specific offset
export const WORKSTATION: string[] = [
  '....NNNNNNNNNN....',
  '....NNNNNNNNNN....',
  '....NGGGGGGGNN....',
  '....NGGGGGGGNN....',
  '....NGGGGGGGNN....',
  '....NGGGGGGGNN....',
  '....NGGGGGGGNN....',
  '....NNNNNNNNNN....',
  '.......NN.........',
  '.......NN.........',
  '..DDDDDDDDDDDDDD.',
  '..DDDDDDDDDDDDDD.',
  '..DDDDkKKKkDDDDD.',
  '..DDDDDDDDDDDDDD.',
  '..dDDDDDDDDDDDDd..',
  '...dddddddddddd...',
  '..................',
  '.....RRRRRRRR.....',
  '.....RRRRRRRR.....',
  '....Arrrrrrrr A...',
  '....Arrrrrrrr A...',
  '.....rrrrrrrr.....',
  '..................',
]

// Color mapping for furniture elements
export const FURNITURE_COLORS: Record<string, string> = {
  '.': 'transparent',
  D: '#3d2b1f',   // desk surface
  d: '#2a1e15',   // desk side/shadow
  N: '#1a1a2e',   // monitor frame
  G: '#0d1117',   // screen (base color, will be overlaid with DOM)
  K: '#2c2c2c',   // keyboard
  k: '#1a1a1a',   // keyboard shadow
  R: '#2c2c2c',   // chair back
  r: '#3a3a3a',   // chair seat
  A: '#252525',   // chair arm
}

// Screen region coordinates (for DOM overlay positioning)
// These define the pixel area of the "G" region in the workstation
export const SCREEN_REGION = {
  x: 4,       // pixel col where screen starts
  y: 2,       // pixel row where screen starts
  width: 7,   // screen width in pixels
  height: 5,  // screen height in pixels
}

// Character placement offset relative to workstation top-left
// Character should sit in the chair area
export const CHARACTER_OFFSET = {
  x: 1,   // pixels from left edge of workstation
  y: 7,   // pixels from top (roughly at desk level)
}
