import type { SceneConfig } from './SceneEditor'

export const OFFICIAL_SCENE_VERSION = 4

export const OFFICIAL_SCENE_CONFIG: SceneConfig = {
  sceneVersion: OFFICIAL_SCENE_VERSION,
  assets: [
    { id: 'mmtfr4sv9w89', src: '/static/arena-sprites/assets/office/office-appliances.png', label: 'Cabinet', x: 0, y: 75, scale: 1.5, cropX: 64, cropY: 0, cropW: 64, cropH: 64 },
    { id: 'mmtfrklcwcoj', src: '/static/arena-sprites/assets/office/office-appliances.png', label: 'Work Desk', x: 11, y: 17, scale: 0.9, cropX: 96, cropY: 128, cropW: 64, cropH: 32 },
    { id: 'mmtfs4gsc4u3', src: '/static/arena-sprites/assets/office/Water Cooler.png', label: 'Water Cooler', x: 418, y: 196, scale: 2, cropX: 0, cropY: 0, cropW: 32, cropH: 64 },
    { id: 'mmtfs593a505', src: '/static/arena-sprites/assets/office/Water Cooler.png', label: 'Water Cooler 2', x: 418, y: 196, scale: 2, cropX: 32, cropY: 0, cropW: 32, cropH: 64 },
    { id: 'mmtfs6pd6hgo', src: '/static/arena-sprites/assets/office/Desk, Ornate.png', label: 'Desk (top)', x: 302, y: 222, scale: 2, cropX: 0, cropY: 0, cropW: 160, cropH: 64 },
    { id: 'mmtfs6zku1k6', src: '/static/arena-sprites/assets/office/Desk, Ornate.png', label: 'Desk (top)', x: 237, y: 97, scale: 2, cropX: 0, cropY: 0, cropW: 160, cropH: 64 },
    { id: 'mmtfsqhmvr22', src: '/static/arena-sprites/assets/furniture/shelves-brown.png', label: 'Bookshelf', x: 393, y: 0, scale: 1.4, cropX: 0, cropY: 0, cropW: 64, cropH: 96 },
    { id: 'mmu8ndzj8xvb', src: '__widget_clock__', label: 'Live Clock', x: 264, y: 24, scale: 1.8, cropX: 0, cropY: 0, cropW: 80, cropH: 14 },
    { id: 'mmu9x2c60r21', src: '/static/arena-sprites/assets/items/sign-hyper-arena.png', label: 'Hyper Alpha Arena', x: 90, y: 21, scale: 1.4, cropX: 0, cropY: 0, cropW: 124, cropH: 30 },
    { id: 'mmubrxujeoj4', src: '/static/arena-sprites/assets/items/water-cooler-1.png', label: 'Water Cooler', x: 83, y: 48, scale: 1.3, cropX: 0, cropY: 0, cropW: 32, cropH: 64 },
    { id: 'mmug8n5tf0gs', src: '/static/arena-sprites/assets/items/chair-black.png', label: 'Chair Black', x: 136, y: 56, scale: 1.7, cropX: 0, cropY: 0, cropW: 18, cropH: 42 },
    { id: 'mmug94ebdzsm', src: '/static/arena-sprites/assets/items/office-plant.png', label: 'Office Plant', x: 57, y: 41, scale: 1, cropX: 0, cropY: 0, cropW: 32, cropH: 32 },
    { id: 'mmug9rw1ohay', src: '/static/arena-sprites/assets/items/flower-pot.png', label: 'Flower Pot', x: 5, y: 52, scale: 1.4, cropX: 0, cropY: 0, cropW: 16, cropH: 16 },
    { id: 'mmzyxrmmnre4', src: '/static/arena-sprites/assets/items/desk-top.png', label: 'Desk Top View', x: 478, y: 39, scale: 1.4, cropX: 0, cropY: 0, cropW: 160, cropH: 64 },
    { id: 'mmzyykj68w9t', src: '/static/arena-sprites/assets/items/bookshelf-green-1.png', label: 'Bookshelf Green', x: 613, y: 0, scale: 1.4, cropX: 0, cropY: 0, cropW: 64, cropH: 96 },
    { id: 'mmzz17uv7zsi', src: '/static/arena-sprites/assets/items/coffee-maker-1.png', label: 'Coffee Maker', x: 477, y: 30, scale: 1.4, cropX: 0, cropY: 0, cropW: 32, cropH: 32 },
    { id: 'mmzz1d86130z', src: '/static/arena-sprites/assets/items/coffee-cup.png', label: 'Coffee Cup', x: 498, y: 45, scale: 1.4, cropX: 0, cropY: 0, cropW: 32, cropH: 32 },
    { id: 'mmzz1jmh0ifk', src: '/static/arena-sprites/assets/items/copier.png', label: 'Copy Machine', x: 563, y: 29, scale: 0.7, cropX: 0, cropY: 0, cropW: 64, cropH: 64 },
    { id: 'mmzz1rmvb0qy', src: '/static/arena-sprites/assets/items/bin-0-1.png', label: 'Bin Dark', x: 691, y: 102, scale: 0.8, cropX: 0, cropY: 0, cropW: 32, cropH: 32 },
  ],
  animationMap: {
    idle: 'idle',
    holding_profit: 'emote',
    holding_loss: 'hurt',
    just_traded: 'walk',
    program_running: 'run',
    ai_thinking: 'combat_idle',
    error: 'sit',
    offline: 'sit',
  },
  workstationArea: {
    x: 377,
    y: 145,
    w: 488,
    h: 372,
    scale: 0.55,
  },
  newsArea: {
    x: 9,
    y: 139,
    w: 361,
    h: 296,
    scale: 0.55,
  },
}
