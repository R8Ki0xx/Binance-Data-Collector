/**
 * SplashScreen - Initial loading screen with logo and random tips
 * Waits for both minimum animation duration AND data ready before completing
 */
import { useEffect, useState, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const TIPS_ZH = [
  '遇到任何问题？直接问 Hyper AI，它了解你的所有配置和运行状态',
  'Testnet 仅用于熟悉操作流程，其价格、K线和交易量与实盘完全不同，不要在测试网验证交易策略',
  '点击任意 AI Trader 的决策记录，可以查看完整的 AI 推理过程和市场数据快照',
  '别忘了设置你的 Watchlist — AI 只能分析和交易 Watchlist 中的币种',
  '信号池可以 7×24 小时自动监控市场，发现异动时触发 AI Trader 决策',
  '在 Factor Library 中点击图表按钮，可以查看每个因子的 IC 曲线和有效性评估',
  'AI Trader 支持定时触发和信号触发两种模式，可以根据策略特点选择',
  'Hyper AI 输入 /health 可以一键执行系统健康检查，快速发现配置问题',
  '每个 AI Trader 都可以独立设置不同的 LLM 模型、Prompt 和触发间隔',
  '决策归因分析可以帮你理解 AI 为什么做出某个交易决策，以及哪些因素影响最大',
  'Program 模式使用代码逻辑执行交易，适合有明确规则的策略，不消耗 LLM 额度',
  '绑定 Telegram 或 Discord 机器人，可以实时接收 AI 交易通知',
  '多账户模式下，不同 AI Trader 可以绑定不同钱包，互不干扰地运行各自策略',
  'Mainnet 交易使用真实资金，建议从小仓位开始，观察 AI 表现后再逐步加仓',
  'Prompt 回测功能可以用历史数据模拟 AI 决策，在投入真金白银之前先验证想法',
  'Hyper AI 不仅能回答问题，还能直接帮你创建 Trader、修改配置、执行诊断',
  'DeepSeek 和 Qwen 模型免费且中文能力强，适合入门；Claude 和 GPT 推理更精细，适合复杂策略',
  '不同 LLM 对同一市场数据可能做出不同决策 — 可以用多个 Trader 对比模型表现',
  'AI Trader 的触发间隔建议不低于 5 分钟，过于频繁会增加 API 成本但不一定提升收益',
]

const TIPS_EN = [
  'Got a question? Just ask Hyper AI — it knows all your configs and system status',
  'Testnet is for learning the interface only. Prices, K-lines, and volume differ from mainnet — don\'t validate strategies there',
  'Click any AI Trader decision log to see the full reasoning process and market data snapshot',
  'Don\'t forget to set up your Watchlist — AI can only analyze and trade coins in your Watchlist',
  'Signal Pools monitor the market 24/7 and trigger AI Trader decisions when anomalies are detected',
  'Click the chart button in Factor Library to view IC curves and effectiveness analysis for each factor',
  'AI Trader supports both scheduled and signal-based triggers — choose based on your strategy needs',
  'Type /health in Hyper AI to run a one-click system health check and spot configuration issues',
  'Each AI Trader can have its own LLM model, Prompt, and trigger interval — fully independent',
  'Decision Attribution Analysis helps you understand why AI made a trade and which factors mattered most',
  'Program mode executes trades with code logic — ideal for rule-based strategies without LLM costs',
  'Connect Telegram or Discord bots to receive real-time AI trading notifications',
  'In multi-account mode, different AI Traders can bind to different wallets and run independently',
  'Mainnet uses real funds — start with small positions and scale up after observing AI performance',
  'Prompt Backtest lets you simulate AI decisions on historical data before committing real capital',
  'Hyper AI can do more than answer questions — it can create Traders, modify configs, and run diagnostics',
  'DeepSeek and Qwen are free with strong multilingual support; Claude and GPT offer more nuanced reasoning for complex strategies',
  'Different LLMs may make different decisions on the same data — run multiple Traders to compare model performance',
  'Set AI Trader trigger intervals to at least 5 minutes — higher frequency increases API costs without guaranteed better results',
]

interface SplashScreenProps {
  onComplete: () => void
  minDuration?: number
  isReady?: boolean
}

export default function SplashScreen({ onComplete, minDuration = 1500, isReady = false }: SplashScreenProps) {
  const [progress, setProgress] = useState(0)
  const [animationDone, setAnimationDone] = useState(false)
  const completedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)
  const { i18n } = useTranslation()

  const tip = useMemo(() => {
    const tips = i18n.language?.startsWith('zh') ? TIPS_ZH : TIPS_EN
    return tips[Math.floor(Math.random() * tips.length)]
  }, [i18n.language])

  useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  // Animation progress
  useEffect(() => {
    const startTime = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime
      const newProgress = Math.min((elapsed / minDuration) * 100, 100)
      setProgress(newProgress)

      if (elapsed >= minDuration) {
        setAnimationDone(true)
        clearInterval(interval)
      }
    }, 50)

    return () => clearInterval(interval)
  }, [minDuration])

  // Complete when both animation done AND data ready
  useEffect(() => {
    if (animationDone && isReady && !completedRef.current) {
      completedRef.current = true
      onCompleteRef.current()
    }
  }, [animationDone, isReady])

  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center z-50">
      <div className="flex flex-col items-center space-y-6">
        <img
          src="/static/arena_logo_app_small.png"
          alt="Hyper Alpha Arena"
          className="w-24 h-24 object-contain"
        />
        <h1 className="text-2xl font-bold text-foreground">
          Hyper Alpha Arena
        </h1>
        <div className="w-48 h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-100 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-sm text-muted-foreground italic text-center px-4" style={{ maxWidth: '800px' }}>
          💡 {tip}
        </p>
      </div>
    </div>
  )
}
