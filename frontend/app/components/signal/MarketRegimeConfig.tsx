import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Save, ArrowDown, Zap, CheckCircle2, Info } from 'lucide-react'

// Types
interface RegimeConfig {
  id: number
  name: string
  is_default: boolean
  rolling_window: number
  breakout_cvd_z: number
  breakout_oi_z: number
  breakout_price_atr: number
  breakout_taker_high: number
  breakout_taker_low: number
  breakout_body_ratio: number
  absorption_cvd_z: number
  absorption_price_atr: number
  trap_cvd_z: number
  trap_oi_z: number
  exhaustion_cvd_z: number
  exhaustion_rsi_high: number
  exhaustion_rsi_low: number
  stop_hunt_range_atr: number
  stop_hunt_close_atr: number
  noise_cvd_z: number
  continuation_cvd_divisor: number
}

// Default values matching database defaults (updated 2024-12)
const DEFAULT_CONFIG: Omit<RegimeConfig, 'id' | 'name' | 'is_default'> = {
  rolling_window: 48,
  breakout_cvd_z: 1.5,
  breakout_oi_z: 0.1,        // OI increase threshold (% change)
  breakout_price_atr: 0.3,   // Price movement threshold
  breakout_taker_high: 33.0, // Taker ratio high (~25% extreme, log threshold 3.5)
  breakout_taker_low: 0.03,  // Taker ratio low (~25% extreme, log threshold -3.5)
  breakout_body_ratio: 0.4,  // Body/Range ratio threshold for Breakout
  absorption_cvd_z: 1.5,
  absorption_price_atr: 0.3,
  trap_cvd_z: 1.0,
  trap_oi_z: -0.5,           // OI decrease threshold (% change)
  exhaustion_cvd_z: 1.0,
  exhaustion_rsi_high: 70.0,
  exhaustion_rsi_low: 30.0,
  stop_hunt_range_atr: 1.0,
  stop_hunt_close_atr: 0.3,
  noise_cvd_z: 0.5,
  continuation_cvd_divisor: 3.0, // cvd_weak = cvd_strong / divisor
}

// Regime icons
function IconProhibit({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M763.776 968.96H261.504C147.456 968.96 55.04 876.544 55.04 762.496V260.224C55.04 146.176 147.456 53.76 261.504 53.76h502.272C877.824 53.76 970.24 146.176 970.24 260.224v502.272c0 114.048-92.416 206.464-206.464 206.464z" fill="#FF4D3C"/>
      <path d="M512.64 252.8c-142.592 0-258.56 115.968-258.56 258.56s115.968 258.56 258.56 258.56 258.56-115.968 258.56-258.56-115.968-258.56-258.56-258.56z m-194.688 258.56c0-42.24 13.568-81.152 36.48-113.024l271.36 271.36c-31.872 22.912-70.912 36.48-113.024 36.48-107.52 0-194.816-87.424-194.816-194.816z m352.896 113.152l-271.36-271.36c31.872-22.912 70.912-36.48 113.024-36.48 107.392 0 194.688 87.424 194.688 194.688 0.128 42.24-13.44 81.152-36.352 113.152z" fill="#FFFFFF"/>
    </svg>
  )
}

function IconSignal3({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 1303 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 1024h186.18V744.73H0zM279.27 1024h186.18V558.55H279.27zM558.55 1024h186.18V372.36H558.55z" fill="#67C23A"/>
      <path d="M837.82 1024h186.18V186.18H837.82zM1117.09 1024h186.18V0h-186.18z" fill="#E0E0E0"/>
    </svg>
  )
}

function IconSignal4({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 1303 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 1024h186.18V744.73H0zM279.27 1024h186.18V558.55H279.27zM558.55 1024h186.18V372.36H558.55zM837.82 1024h186.18V186.18H837.82z" fill="#67C23A"/>
      <path d="M1117.09 1024h186.18V0h-186.18z" fill="#E0E0E0"/>
    </svg>
  )
}

function IconSignal5({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 1303 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M0 1024h186.18V744.73H0zM279.27 1024h186.18V558.55H279.27zM558.55 1024h186.18V372.36H558.55zM837.82 1024h186.18V186.18H837.82zM1117.09 1024h186.18V0h-186.18z" fill="#67C23A"/>
    </svg>
  )
}

// API functions
async function fetchConfig(): Promise<RegimeConfig | null> {
  const res = await fetch('/api/market-regime/configs/list')
  if (!res.ok) throw new Error('Failed to fetch config')
  const configs: RegimeConfig[] = await res.json()
  return configs.find(c => c.is_default) || configs[0] || null
}

async function updateConfig(id: number, data: Partial<RegimeConfig>): Promise<RegimeConfig> {
  const res = await fetch(`/api/market-regime/configs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update config')
  return res.json()
}

// Parameter input with label, default, and range
interface ParamProps {
  label: string
  value: number
  def: number
  range: string
  onChange: (v: number) => void
  step?: number
}

function Param({ label, value, def, range, onChange, step = 0.1 }: ParamProps) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-foreground font-medium">{label}</span>
      <Input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="h-6 w-16 text-xs px-1 text-center font-mono"
      />
      <span className="text-muted-foreground text-xs">def:{def} ({range})</span>
    </span>
  )
}

// Decision node component
interface DecisionNodeProps {
  title: string
  color: string
  desc: string
  icon?: React.ReactNode
  isLast?: boolean
  children: React.ReactNode
}

function DecisionNode({ title, color, desc, icon, isLast, children }: DecisionNodeProps) {
  return (
    <div className="relative">
      {/* Card row: card + description side by side */}
      <div className="flex items-center gap-4">
        <Card className={`border-l-4 ${color} w-fit`}>
          <CardContent className="min-h-[60px] py-3 px-4 flex items-center">
            <div className="flex items-center gap-3">
              {icon || <CheckCircle2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
              <span className="font-semibold text-sm min-w-[120px]">{title}</span>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                {children}
              </div>
            </div>
          </CardContent>
        </Card>
        <span className="text-sm font-medium text-green-700 dark:text-green-300 bg-green-100 dark:bg-green-900/40 px-3 py-1.5 rounded-md whitespace-nowrap">
          → {desc}
        </span>
      </div>
      {/* Arrow below - aligned with card number */}
      {!isLast && (
        <div className="flex items-center gap-1 py-2 pl-7">
          <ArrowDown className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Not matched</span>
        </div>
      )}
    </div>
  )
}

// Logic separator components
function And() {
  return <span className="text-muted-foreground bg-muted px-1.5 py-0.5 rounded text-xs">AND</span>
}

function Or() {
  return <span className="text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded text-xs">OR</span>
}

function All() {
  return <span className="text-blue-500 bg-blue-500/10 px-1.5 py-0.5 rounded text-xs font-medium">[ALL]</span>
}

function Any() {
  return <span className="text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded text-xs font-medium">[ANY]</span>
}

// Info tooltip content
function FormulaReference() {
  return (
    <div className="text-xs space-y-1 max-w-sm">
      <div className="font-semibold mb-2">Indicator Formulas:</div>
      <div><span className="font-mono">Price Range</span> = (High - Low) / ATR</div>
      <div><span className="font-mono">Close Offset</span> = |Close - Open| / ATR</div>
      <div><span className="font-mono">CVD Ratio</span> = CVD / Total Notional</div>
      <div><span className="font-mono">OI Delta</span> = Open Interest Change %</div>
      <div><span className="font-mono">Price Move</span> = (Close - Open) / ATR</div>
      <div><span className="font-mono">Body Ratio</span> = |Price Move| / Price Range</div>
      <div><span className="font-mono">CVD Weak</span> = CVD Strong / Divisor</div>
      <div><span className="font-mono">Taker Ratio</span> = Buy Notional / Sell Notional</div>
      <div><span className="font-mono">RSI</span> = RSI14 indicator</div>
    </div>
  )
}

export default function MarketRegimeConfig() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<RegimeConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadConfig() }, [])

  const loadConfig = async () => {
    try {
      setLoading(true)
      const data = await fetchConfig()
      setConfig(data)
    } catch {
      toast.error('Failed to load config')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!config) return
    try {
      setSaving(true)
      const updated = await updateConfig(config.id, config)
      setConfig(updated)
      toast.success('Configuration saved')
    } catch {
      toast.error('Failed to save config')
    } finally {
      setSaving(false)
    }
  }

  const u = (field: keyof RegimeConfig, value: number) => {
    if (!config) return
    setConfig({ ...config, [field]: value })
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64">{t('common.loading', 'Loading...')}</div>
  }

  if (!config) {
    return <div className="text-center text-muted-foreground">{t('regime.noConfig', 'No configuration found')}</div>
  }

  return (
    <TooltipProvider>
      <div className="h-full overflow-y-auto">
        <div className="border-2 border-dashed border-yellow-500/50 rounded-lg p-4 bg-yellow-500/5 flex-1 min-h-0 overflow-y-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-yellow-500" />
              <span className="font-semibold text-yellow-600 dark:text-yellow-400">{t('regime.signalTriggered', 'Signal Triggered')}</span>
              <span className="text-xs text-muted-foreground">→ {t('regime.classificationFlow', 'Regime Classification Flow')}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-4 h-4 text-muted-foreground hover:text-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="p-3">
                  <FormulaReference />
                </TooltipContent>
              </Tooltip>
            </div>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <Save className="w-4 h-4 mr-1" />{saving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
            </Button>
          </div>

          {/* Decision Flow - Order matches backend classify_regime priority */}
          <div className="space-y-4">
            {/* 1. Stop Hunt */}
            <DecisionNode title={t('regime.stopHunt', '1. Stop Hunt (止损猎杀)')} color="border-red-500" desc={t('regime.liquidityGrab', 'Liquidity grab (流动性猎取)')} icon={<IconProhibit className="w-5 h-5 flex-shrink-0" />}>
              <All />
              <Param label="Price Range >" value={config.stop_hunt_range_atr} def={1.0} range="0.5~2" onChange={v => u('stop_hunt_range_atr', v)} />
              <And />
              <Param label="Close Offset <" value={config.stop_hunt_close_atr} def={0.3} range="0.1~0.5" onChange={v => u('stop_hunt_close_atr', v)} />
            </DecisionNode>

            {/* 2. Breakout */}
            <DecisionNode title={t('regime.breakout', '2. Breakout (突破)')} color="border-green-500" desc={t('regime.trendInitiation', 'Trend initiation (趋势启动)')} icon={<IconSignal5 className="w-5 h-5 flex-shrink-0" />}>
              <All />
              <Param label="CVD Ratio >" value={config.breakout_cvd_z} def={1.5} range="0.5~5" onChange={v => u('breakout_cvd_z', v)} />
              <span className="text-muted-foreground text-xs">(×0.1)</span>
              <And />
              <Param label="Price Move >" value={config.breakout_price_atr} def={0.3} range="0.1~2" onChange={v => u('breakout_price_atr', v)} />
              <span className="text-muted-foreground text-xs">(+0.2)</span>
              <And />
              <Param label="Body Ratio >" value={config.breakout_body_ratio} def={0.4} range="0.2~0.8" onChange={v => u('breakout_body_ratio', v)} />
              <And />
              <span className="text-foreground">CVD-Price aligned</span>
              <And />
              <Any />
              <span className="text-foreground">Taker extreme</span>
              <span className="text-muted-foreground text-xs">(log ±3.5)</span>
              <Or />
              <Param label="OI Delta >" value={config.breakout_oi_z} def={0.1} range="0.01~2" onChange={v => u('breakout_oi_z', v)} step={0.05} />
            </DecisionNode>

            {/* 3. Exhaustion */}
            <DecisionNode title={t('regime.exhaustion', '3. Exhaustion (衰竭)')} color="border-orange-500" desc={t('regime.trendWeakening', 'Trend weakening (趋势减弱)')} icon={<IconSignal3 className="w-5 h-5 flex-shrink-0" />}>
              <All />
              <span className="text-foreground">CVD strong</span>
              <And />
              <Param label="OI Delta <" value={config.trap_oi_z} def={-0.5} range="-2~0" onChange={v => u('trap_oi_z', v)} />
              <And />
              <Any />
              <Param label="RSI >" value={config.exhaustion_rsi_high} def={70} range="65~80" onChange={v => u('exhaustion_rsi_high', v)} step={1} />
              <Or />
              <Param label="RSI <" value={config.exhaustion_rsi_low} def={30} range="20~35" onChange={v => u('exhaustion_rsi_low', v)} step={1} />
            </DecisionNode>

            {/* 4. Trap */}
            <DecisionNode title={t('regime.trap', '4. Trap (陷阱)')} color="border-yellow-600" desc={t('regime.falseBreakout', 'False breakout (假突破)')} icon={<IconProhibit className="w-5 h-5 flex-shrink-0" />}>
              <All />
              <span className="text-foreground">CVD strong</span>
              <And />
              <span className="text-foreground">OI Delta &lt; {config.trap_oi_z}</span>
              <And />
              <span className="text-foreground">Close Offset &lt; {config.stop_hunt_close_atr}</span>
              <span className="text-muted-foreground text-xs">(reuse Stop Hunt)</span>
            </DecisionNode>

            {/* 5. Absorption */}
            <DecisionNode title={t('regime.absorption', '5. Absorption (吸收)')} color="border-purple-500" desc={t('regime.flowAbsorbed', 'Flow absorbed (流量被吸收)')} icon={<IconSignal3 className="w-5 h-5 flex-shrink-0" />}>
              <All />
              <span className="text-foreground">CVD strong</span>
              <And />
              <Param label="Price Move <" value={config.absorption_price_atr} def={0.3} range="0.1~0.5" onChange={v => u('absorption_price_atr', v)} />
            </DecisionNode>

            {/* 6. Continuation */}
            <DecisionNode title={t('regime.continuation', '6. Continuation (延续)')} color="border-blue-500" desc={t('regime.trendContinues', 'Trend continues (趋势延续)')} icon={<IconSignal4 className="w-5 h-5 flex-shrink-0" />}>
              <All />
              <span className="text-foreground">CVD weak</span>
              <span className="text-muted-foreground text-xs">(CVD Strong ÷</span>
              <Param label="" value={config.continuation_cvd_divisor} def={3} range="1~10" onChange={v => u('continuation_cvd_divisor', v)} step={0.5} />
              <span className="text-muted-foreground text-xs">)</span>
              <And />
              <span className="text-foreground">Price Move &gt; {config.absorption_price_atr}</span>
              <And />
              <span className="text-foreground">CVD-Price aligned</span>
            </DecisionNode>

            {/* 7. Noise */}
            <DecisionNode title={t('regime.noise', '7. Noise (噪音)')} color="border-gray-400" desc={t('regime.noClearPattern', 'No clear pattern (无明确模式)')} isLast>
              <span className="text-muted-foreground">{t('regime.noneMatched', 'None of the above matched')}</span>
            </DecisionNode>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
