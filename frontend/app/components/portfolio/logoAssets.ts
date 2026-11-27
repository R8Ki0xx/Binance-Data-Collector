import gptLogo from '@/components/ui/public/GPT_logo.webp'
import deepseekLogo from '@/components/ui/public/deepseek_logo.webp'
import qwenLogo from '@/components/ui/public/qwen_logo.webp'
import claudeLogo from '@/components/ui/public/Claude_logo.webp'
import geminiLogo from '@/components/ui/public/Gemini_logo.webp'
import grokLogo from '@/components/ui/public/Grok_logo.webp'
import defaultRobotLogo from '@/components/ui/public/default_robot.svg'

// Chart-specific logos
import gptChartLogo from '@/components/ui/public/GPT_logo_chart.webp'
import deepseekChartLogo from '@/components/ui/public/deepseek_logo_chart.webp'
import qwenChartLogo from '@/components/ui/public/qwen_logo_chart.webp'
import claudeChartLogo from '@/components/ui/public/Claude_logo_chart.webp'
import geminiChartLogo from '@/components/ui/public/Gemini_logo_chart.webp'
import grokChartLogo from '@/components/ui/public/Grok_logo_chart.webp'
import defaultChartLogo from '@/components/ui/public/default_chart.webp'

import btcIcon from '@/components/ui/public/btc.svg'
import ethIcon from '@/components/ui/public/eth.svg'
import xrpIcon from '@/components/ui/public/xrp.svg'
import dogeIcon from '@/components/ui/public/doge.svg'
import solIcon from '@/components/ui/public/sol.svg'
import bnbIcon from '@/components/ui/public/bnb.svg'

type LogoAsset = {
  src: string
  alt: string
  color?: string
}

const modelLogoMap: Record<string, LogoAsset> = {
  gpt: { src: gptLogo, alt: 'GPT logo' },
  deepseek: { src: deepseekLogo, alt: 'DeepSeek logo' },
  'deepseek chat': { src: deepseekLogo, alt: 'DeepSeek logo' },
  qwen: { src: qwenLogo, alt: 'Qwen logo' },
  claude: { src: claudeLogo, alt: 'Claude logo' },
  gemini: { src: geminiLogo, alt: 'Gemini logo' },
  grok: { src: grokLogo, alt: 'Grok logo' },
}

const modelChartLogoMap: Record<string, LogoAsset> = {
  gpt: { src: gptChartLogo, alt: 'GPT logo', color: '#2DA987' },
  deepseek: { src: deepseekChartLogo, alt: 'DeepSeek logo', color: '#4D6BFD' },
  'deepseek chat': { src: deepseekChartLogo, alt: 'DeepSeek logo', color: '#4D6BFD' },
  qwen: { src: qwenChartLogo, alt: 'Qwen logo', color: '#8B5CF6' },
  claude: { src: claudeChartLogo, alt: 'Claude logo', color: '#FF6B35' },
  gemini: { src: geminiChartLogo, alt: 'Gemini logo', color: '#4285F4' },
  grok: { src: grokChartLogo, alt: 'Grok logo', color: '#0D0D0D' },
}

const symbolLogoMap: Record<string, LogoAsset> = {
  BTC: { src: btcIcon, alt: 'BTC icon' },
  ETH: { src: ethIcon, alt: 'ETH icon' },
  XRP: { src: xrpIcon, alt: 'XRP icon' },
  DOGE: { src: dogeIcon, alt: 'DOGE icon' },
  SOL: { src: solIcon, alt: 'SOL icon' },
  BNB: { src: bnbIcon, alt: 'BNB icon' },
}

function normalizeKey(value?: string | null) {
  if (!value) return ''
  return value.replace(/[_-]/g, ' ').trim().toLowerCase()
}

export function getModelLogo(name?: string | null) {
  if (!name) return { src: defaultRobotLogo, alt: 'AI Trader' }
  const normalized = normalizeKey(name)
  if (modelLogoMap[normalized]) return modelLogoMap[normalized]

  const withoutDefault = normalized.replace(/^default\s+/, '').trim()
  if (withoutDefault && modelLogoMap[withoutDefault]) {
    return modelLogoMap[withoutDefault]
  }

  // Try to match by first word (e.g., "Qwen3 Max" -> "qwen")
  const sourceForFirst = withoutDefault || normalized
  const firstWord = sourceForFirst.split(' ')[0]
  if (modelLogoMap[firstWord]) return modelLogoMap[firstWord]

  const trimmedWord = firstWord.replace(/\d+/g, '')
  if (modelLogoMap[trimmedWord]) return modelLogoMap[trimmedWord]

  // Return default robot icon if no match found
  return { src: defaultRobotLogo, alt: 'AI Trader' }
}

export function getModelChartLogo(name?: string | null) {
  if (!name) return { src: defaultChartLogo, alt: 'Default logo', color: '#656565' }
  const normalized = normalizeKey(name)
  if (modelChartLogoMap[normalized]) return modelChartLogoMap[normalized]

  const withoutDefault = normalized.replace(/^default\s+/, '').trim()
  if (withoutDefault && modelChartLogoMap[withoutDefault]) {
    return modelChartLogoMap[withoutDefault]
  }

  // Try to match by first word (e.g., "Qwen3 Max" -> "qwen")
  const sourceForFirst = withoutDefault || normalized
  const firstWord = sourceForFirst.split(' ')[0]
  if (modelChartLogoMap[firstWord]) return modelChartLogoMap[firstWord]

  const trimmedWord = firstWord.replace(/\d+/g, '')
  if (modelChartLogoMap[trimmedWord]) return modelChartLogoMap[trimmedWord]

  // Return default if no match found
  return { src: defaultChartLogo, alt: 'Default logo', color: '#656565' }
}

export function getModelColor(name?: string | null) {
  const chartLogo = getModelChartLogo(name)
  return chartLogo.color || '#656565'
}

export function getSymbolLogo(symbol?: string | null) {
  if (!symbol) return undefined
  return symbolLogoMap[symbol.toUpperCase()]
}

// Program icon colors - cycle through these for different programs
const PROGRAM_COLORS = [
  { primary: '#3773A5', secondary: '#FFD731' }, // Python original
  { primary: '#E74C3C', secondary: '#F39C12' }, // Red/Orange
  { primary: '#9B59B6', secondary: '#3498DB' }, // Purple/Blue
  { primary: '#1ABC9C', secondary: '#2ECC71' }, // Teal/Green
  { primary: '#E91E63', secondary: '#00BCD4' }, // Pink/Cyan
  { primary: '#FF5722', secondary: '#795548' }, // Deep Orange/Brown
  { primary: '#607D8B', secondary: '#9E9E9E' }, // Blue Grey/Grey
  { primary: '#673AB7', secondary: '#FFEB3B' }, // Deep Purple/Yellow
]

export function getProgramColor(index: number) {
  return PROGRAM_COLORS[index % PROGRAM_COLORS.length]
}

export function getProgramIconSvg(index: number = 0) {
  const colors = getProgramColor(index)
  return `<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <path d="M508.416 3.584c-260.096 0-243.712 112.64-243.712 112.64l0.512 116.736h248.32v34.816H166.4S0 248.832 0 510.976s145.408 252.928 145.408 252.928h86.528v-121.856S227.328 496.64 374.784 496.64h246.272s138.24 2.048 138.24-133.632V139.776c-0.512 0 20.48-136.192-250.88-136.192zM371.712 82.432c24.576 0 44.544 19.968 44.544 44.544 0 24.576-19.968 44.544-44.544 44.544-24.576 0-44.544-19.968-44.544-44.544-0.512-24.576 19.456-44.544 44.544-44.544z" fill="${colors.primary}"/>
    <path d="M515.584 1022.464c260.096 0 243.712-112.64 243.712-112.64l-0.512-116.736H510.976V757.76h346.624s166.4 18.944 166.4-243.2-145.408-252.928-145.408-252.928h-86.528v121.856s4.608 145.408-142.848 145.408h-245.76s-138.24-2.048-138.24 133.632v224.768c0-0.512-20.992 135.168 250.368 135.168z m136.704-78.336c-24.576 0-44.544-19.968-44.544-44.544 0-24.576 19.968-44.544 44.544-44.544 24.576 0 44.544 19.968 44.544 44.544 0.512 24.576-19.456 44.544-44.544 44.544z" fill="${colors.secondary}"/>
  </svg>`
}

// For React components - returns color info for inline SVG rendering
export function getProgramIconColors(programId?: number) {
  const index = programId ? (programId - 1) : 0
  return getProgramColor(index)
}
