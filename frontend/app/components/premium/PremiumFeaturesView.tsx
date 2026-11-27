'use client'

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Database,
  TrendingUp,
  Clock,
  Target,
  Lock,
  ExternalLink,
  Info,
  Sparkles,
  Percent,
  Zap
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import PremiumRequiredModal from '@/components/ui/PremiumRequiredModal'

interface PremiumFeaturesViewProps {
  onAccountUpdated?: () => void
  onPageChange?: (page: string) => void
}

export default function PremiumFeaturesView({ onAccountUpdated, onPageChange }: PremiumFeaturesViewProps) {
  const { t } = useTranslation()
  const { user, membership, membershipLoading } = useAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [samplingDepth, setSamplingDepth] = useState(10)
  const [showPremiumModal, setShowPremiumModal] = useState(false)
  const [samplingInterval, setSamplingInterval] = useState(18)

  // All supported technical indicators
  const technicalIndicators = [
    { name: 'MA5/10/20', description: 'Simple Moving Averages for trend identification', category: 'Trend' },
    { name: 'EMA20/50/100', description: 'Exponential Moving Averages for responsive trend tracking', category: 'Trend' },
    { name: 'MACD', description: 'Moving Average Convergence Divergence for momentum analysis', category: 'Momentum' },
    { name: 'RSI7/14', description: 'Relative Strength Index for overbought/oversold detection', category: 'Momentum' },
    { name: 'BOLL', description: 'Bollinger Bands for volatility and price extremes', category: 'Volatility' },
    { name: 'ATR14', description: 'Average True Range for volatility measurement', category: 'Volatility' },
  ]

  // Determine if user has premium subscription
  const isPremium = membership?.status === 'ACTIVE'
  const maxAllowedDepth = isPremium ? 60 : 10
  const subscriptionEndDate = membership?.currentPeriodEnd

  useEffect(() => {
    fetchGlobalConfig()
  }, [])

  const fetchGlobalConfig = async () => {
    try {
      setIsLoading(true)

      // Fetch global sampling configuration
      const response = await fetch('/api/config/global-sampling')
      if (!response.ok) {
        throw new Error('Failed to fetch global sampling configuration')
      }
      const data = await response.json()

      setSamplingDepth(data.sampling_depth || 10)
      setSamplingInterval(data.sampling_interval || 18)

      console.log('Global config loaded:', data)
    } catch (error) {
      console.error('Failed to fetch global config:', error)
      toast.error('Failed to load sampling configuration')
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpgradeClick = () => {
    window.open('https://www.akooi.com/#pricing-section', '_blank')
  }

  const handlePromptToolClick = () => {
    // Check if user is logged in
    if (!user) {
      toast.error('Please log in to use this feature')
      return
    }

    // Limited Time Free - skip premium check
    // Navigate to prompt page
    onPageChange?.('prompt-management')
  }

  const handleSaveConfiguration = async (section: string) => {
    if (section === 'sampling-pool') {
      // Check if user is logged in
      if (!user) {
        toast.error('Please log in to save configuration')
        // Could add login redirect logic here
        return
      }

      // Check premium requirement - show modal instead of direct redirect
      if (samplingDepth > 10 && !isPremium) {
        setShowPremiumModal(true)
        return
      }

      setIsSaving(true)
      try {
        const response = await fetch(`/api/config/global-sampling`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sampling_depth: samplingDepth
          })
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.detail || 'Failed to save configuration')
        }

        const result = await response.json()
        toast.success('Sampling depth configuration saved successfully!')

        // Refresh configuration
        await fetchGlobalConfig()
      } catch (error) {
        console.error('Failed to save sampling configuration:', error)
        toast.error(error instanceof Error ? error.message : 'Failed to save configuration')
      } finally {
        setIsSaving(false)
      }
    } else {
      // For not-yet-implemented features
      toast('This feature is coming soon!', { icon: '🚧' })
    }
  }

  if (isLoading || membershipLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">{t('premium.loading', 'Loading premium features...')}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header Section */}
      <div className="px-6 py-4 border-b min-h-[110px]">
        <div className="space-y-2">
          {/* Title row with subscription card */}
          <div className="flex items-stretch gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold">{t('premium.title', 'Premium Features')}</h1>
                {isPremium && subscriptionEndDate && (
                  <Badge variant="outline" className="text-sm">
                    {t('premium.activeUntil', 'Active until')} {new Date(subscriptionEndDate).toLocaleDateString()}
                  </Badge>
                )}
              </div>
              <p className="text-muted-foreground">
                {t('premium.subscriptionDesc', 'Continuous development requires financial support. Subscribe to unlock:')}
              </p>
              <div className="flex flex-wrap gap-3 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Target className="w-4 h-4" />
                  <span>{t('premium.advancedDataAnalysis', 'Advanced data analysis')}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  <span>{t('premium.prioritySupport', 'Priority technical support')}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <TrendingUp className="w-4 h-4" />
                  <span>{t('premium.featureRequestPriority', 'Feature request priority')}</span>
                </div>
              </div>
            </div>

            {/* Subscribe card next to title */}
            {!isPremium && (
              <Card className="border text-card-foreground shadow border-orange-500/50 bg-orange-50/5 h-[100px] flex">
                <CardContent className="p-4 flex flex-col justify-center h-full space-y-3">
                  <div className="space-y-1">
                    <p className="font-medium text-sm">{t('premium.premiumRequired', 'Premium subscription required')}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('premium.unlockAllFeatures', 'Unlock all features below with a premium subscription')}
                    </p>
                  </div>
                  <Button
                    onClick={handleUpgradeClick}
                    className="gap-2 shrink-0 h-8 text-xs self-start w-full"
                  >
                    {t('premium.subscribeNow', 'Subscribe Now')}
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Features Container with scroll */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-8">
          {/* Trading Improvement Section */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-primary" />
              <h2 className="text-xl font-semibold">{t('premium.tradingImprovement', 'Trading Improvement')}</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Service Fee Card */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Percent className="w-5 h-5 text-blue-500" />
                      {t('premium.serviceFee', 'Service Fee')}
                      {isPremium && (
                        <Badge className="bg-green-500 text-white text-xs">FREE</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {t('premium.serviceFeeDesc', 'A small fee per trade supports long-term project development and maintenance')}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="h-[200px] p-3 bg-muted/50 rounded-lg text-xs flex flex-col items-center justify-center">
                    <div className="font-medium flex items-center gap-2 mb-4">
                      <Info className="w-4 h-4" />
                      {t('premium.currentRate', 'Current Rate')}
                    </div>
                    <div className="text-center">
                      <div className="text-3xl font-bold text-foreground mb-2">
                        {isPremium ? (
                          <>
                            <span className="line-through text-muted-foreground text-xl mr-2">0.03%</span>
                            0%
                          </>
                        ) : (
                          '0.03%'
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground mb-2">{t('premium.perTrade', 'per trade')}</div>
                      {isPremium ? (
                        <div className="text-green-600 font-medium">{t('premium.premiumDiscount', 'Premium discount applied')}</div>
                      ) : (
                        <div className="text-muted-foreground">{t('premium.standardRate', 'Standard rate for non-subscribers')}</div>
                      )}
                    </div>
                  </div>

                  {!isPremium && (
                    <Button
                      onClick={handleUpgradeClick}
                      className="w-full h-8 text-xs"
                    >
                      {t('premium.subscribeFor50Off', 'Subscribe for 50% Off')}
                      <ExternalLink className="w-3 h-3 ml-1" />
                    </Button>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      {t('premium.samplingPoolDepth', '60+ Sampling Pool Depth')}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {t('premium.samplingPoolDesc', 'Provide AI with deeper historical data for better trend analysis')}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{t('premium.samplingDepth', 'Sampling Depth (points)')}</span>
                      <span className="text-xs text-muted-foreground">{samplingDepth} points</span>
                    </div>
                    <div className="flex gap-2">
                      {[10, 20, 30, 40, 50, 60].map((depth) => (
                        <Button
                          key={depth}
                          variant={samplingDepth === depth ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setSamplingDepth(depth)}
                          className="flex-1 h-7 text-xs"
                        >
                          {depth}
                          {depth > 10 && !isPremium && (
                            <Lock className="w-3 h-3 ml-1" />
                          )}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1 p-3 bg-muted/50 rounded-lg text-xs">
                    <div className="font-medium flex items-center gap-2">
                      <Info className="w-3 h-3" />
                      {t('premium.currentConfig', 'Current Configuration')}
                    </div>
                    <div className="space-y-0.5 text-muted-foreground ml-5">
                      <div>• {t('premium.samplingInterval', 'Sampling Interval')}: {samplingInterval} seconds</div>
                      <div>• {t('premium.dataCoverage', 'Data Coverage')}: {((samplingDepth * samplingInterval) / 60).toFixed(1)} minutes of price history</div>
                      <div>• {t('premium.storage', 'Storage')}: {t('premium.minimalRolling', 'Minimal (rolling buffer)')}</div>
                      <div>• {t('premium.estimatedAccuracyBoost', 'Estimated Accuracy Boost')}: +{(() => {
                        const baseDepth = 10;
                        if (samplingDepth <= baseDepth) return 0;
                        const steps = (samplingDepth - baseDepth) / 10;
                        return Math.round(Math.pow(2, steps) * 10 - 10);
                      })()}%</div>
                    </div>
                  </div>

                  <Button
                    onClick={() => handleSaveConfiguration('sampling-pool')}
                    disabled={isSaving}
                    className="w-full h-8 text-xs"
                  >
                    {isSaving ? t('premium.saving', 'Saving...') : t('premium.saveConfig', 'Save Configuration')}
                  </Button>
                </CardContent>
              </Card>

              {/* AI Prompt Generator */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Sparkles className="w-5 h-5 text-purple-500" />
                      {t('premium.aiPromptGenerator', 'AI Prompt Generator')}
                      <Badge className="bg-green-500 text-white text-xs">{t('premium.limitedTimeFree', 'Limited Time Free')}</Badge>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {t('premium.aiPromptGeneratorDesc', 'Generate professional trading strategy prompts through natural language conversation with AI')}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2 p-3 bg-muted/50 rounded-lg text-xs">
                    <div className="font-medium flex items-center gap-2">
                      <Info className="w-3 h-3" />
                      {t('premium.keyFeatures', 'Key Features')}
                    </div>
                    <div className="space-y-0.5 text-muted-foreground ml-5">
                      <div>• {t('premium.naturalLanguageInterface', 'Natural language conversation interface')}</div>
                      <div>• {t('premium.noTemplateKnowledge', 'No template syntax knowledge required')}</div>
                      <div>• {t('premium.multiTurnDialogue', 'Multi-turn dialogue for strategy refinement')}</div>
                      <div>• {t('premium.autoVariableSelection', 'Automatic variable selection and optimization')}</div>
                      <div>• {t('premium.versionManagement', 'Version management for prompt iterations')}</div>
                    </div>
                  </div>

                  <Button
                    onClick={handlePromptToolClick}
                    className="w-full h-8 text-xs bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0"
                  >
                    <Sparkles className="w-3 h-3 mr-1" />
                    {t('premium.startWritePrompt', 'Start Write Strategy Prompt')}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </section>

          {/* Analysis Tools Section */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              <h2 className="text-xl font-semibold">{t('premium.analysisTools', 'Analysis Tools')}</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Advanced Indicators */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      {t('premium.technicalIndicatorsSuite', 'Technical Indicators Suite')}
                      <Badge className="bg-green-500 text-white text-xs">{t('premium.limitedTimeFree', 'Limited Time Free')}</Badge>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {t('premium.technicalIndicatorsDesc', '11 professional-grade technical indicators across trend, momentum, and volatility analysis')}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    {technicalIndicators.map((indicator, index) => (
                      <div key={index} className="flex items-start gap-2 p-2 border rounded-lg">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold">{indicator.name}</span>
                            <Badge variant="outline" className="text-[10px] px-1 py-0">{indicator.category}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {indicator.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="p-2 bg-muted/50 rounded-lg text-xs text-muted-foreground">
                    <div className="font-medium mb-1">{t('premium.multiPeriodSupport', 'Multi-Period Support')}</div>
                    <div>Available on 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 12h, 1d, 3d, 1w, 1M timeframes</div>
                  </div>

                  <Button
                    onClick={() => onPageChange?.('klines')}
                    className="w-full h-8 text-xs"
                  >
                    {t('premium.tryNow', 'Try Now')}
                  </Button>
                </CardContent>
              </Card>

              {/* AI K-line Analysis */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      {t('premium.aiQuantAnalysis', 'AI Quantitative Analysis')}
                      <Badge className="bg-green-500 text-white text-xs">{t('premium.limitedTimeFree', 'Limited Time Free')}</Badge>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {t('premium.aiQuantAnalysisDesc', 'Deep learning-powered market microstructure analysis with multi-dimensional signal extraction')}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <div className="p-2 bg-muted/50 rounded-lg">
                      <div className="text-xs font-semibold mb-1">{t('premium.patternRecognition', 'Pattern Recognition Engine')}</div>
                      <div className="text-xs text-muted-foreground">
                        • {t('premium.classicalFormations', 'Classical formations: Head & Shoulders, Double Top/Bottom, Triangles, Wedges')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        • {t('premium.candlestickPatterns', 'Candlestick patterns: Doji, Engulfing, Hammer, Shooting Star, Morning/Evening Star')}
                      </div>
                    </div>

                    <div className="p-2 bg-muted/50 rounded-lg">
                      <div className="text-xs font-semibold mb-1">{t('premium.multiTimeframeAnalysis', 'Multi-Timeframe Confluence Analysis')}</div>
                      <div className="text-xs text-muted-foreground">
                        • {t('premium.crossPeriodTrend', 'Cross-period trend alignment detection (1m to 1M)')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        • {t('premium.supportResistance', 'Support/Resistance level clustering across timeframes')}
                      </div>
                    </div>

                    <div className="p-2 bg-muted/50 rounded-lg">
                      <div className="text-xs font-semibold mb-1">{t('premium.quantSignalGeneration', 'Quantitative Signal Generation')}</div>
                      <div className="text-xs text-muted-foreground">
                        • {t('premium.momentumDivergence', 'Momentum divergence detection (price vs. indicator)')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        • {t('premium.volumePriceAnalysis', 'Volume-price relationship analysis')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        • {t('premium.marketStructureBreak', 'Market structure break identification')}
                      </div>
                    </div>

                    <div className="p-2 bg-muted/50 rounded-lg">
                      <div className="text-xs font-semibold mb-1">{t('premium.actionableInsights', 'Actionable Trading Insights')}</div>
                      <div className="text-xs text-muted-foreground">
                        • {t('premium.entryExitZones', 'Entry/Exit zone recommendations with probability scoring')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        • {t('premium.riskRewardCalc', 'Risk/Reward ratio calculation and position sizing guidance')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        • {t('premium.marketRegime', 'Market regime classification (trending/ranging/volatile)')}
                      </div>
                    </div>
                  </div>

                  <Button
                    onClick={() => onPageChange?.('klines')}
                    className="w-full h-8 text-xs"
                  >
                    {t('premium.launchAnalysis', 'Launch Analysis')}
                  </Button>
                </CardContent>
              </Card>

              {/* AI Signal Generator */}
              <Card className="border text-card-foreground shadow">
                <CardHeader className="pb-3">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Zap className="w-5 h-5 text-yellow-500" />
                      {t('premium.aiSignalGenerator', 'AI Signal Generator')}
                      <Badge className="bg-green-500 text-white text-xs">{t('premium.limitedTimeFree', 'Limited Time Free')}</Badge>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {t('premium.aiSignalGeneratorDesc', 'Transform trading ideas into executable signals using natural language - no technical knowledge required')}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-2">
                    <div className="p-2 bg-muted/50 rounded-lg">
                      <div className="text-xs font-semibold mb-1">{t('premium.naturalLanguageToSignal', 'Natural Language to Signal')}</div>
                      <div className="text-xs text-muted-foreground">
                        {t('premium.naturalLanguageToSignalDesc', 'Describe what you want to monitor: "Alert me when BTC open interest surges with high buying pressure"')}
                      </div>
                    </div>

                    <div className="p-2 bg-muted/50 rounded-lg">
                      <div className="text-xs font-semibold mb-1">{t('premium.smartParamOptimization', 'Smart Parameter Optimization')}</div>
                      <div className="text-xs text-muted-foreground">
                        {t('premium.smartParamOptimizationDesc', 'AI analyzes market data to suggest optimal thresholds - no guesswork needed')}
                      </div>
                    </div>

                    <div className="p-2 bg-muted/50 rounded-lg">
                      <div className="text-xs font-semibold mb-1">{t('premium.multiConditionLogic', 'Multi-Condition Logic')}</div>
                      <div className="text-xs text-muted-foreground">
                        {t('premium.multiConditionLogicDesc', 'Combine CVD, OI, funding rate, order flow into sophisticated AND/OR signal pools')}
                      </div>
                    </div>

                    <div className="p-2 bg-muted/50 rounded-lg">
                      <div className="text-xs font-semibold mb-1">{t('premium.triggerAiTrading', 'Trigger AI Trading')}</div>
                      <div className="text-xs text-muted-foreground">
                        {t('premium.triggerAiTradingDesc', 'Bind signals to AI accounts - when conditions hit, AI evaluates and executes')}
                      </div>
                    </div>
                  </div>

                  <Button
                    onClick={() => onPageChange?.('signal-management')}
                    className="w-full h-8 text-xs bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-600 hover:to-orange-600 text-white border-0"
                  >
                    <Zap className="w-3 h-3 mr-1" />
                    {t('premium.createSignalWithAI', 'Create Signal with AI')}
                  </Button>
                </CardContent>
              </Card>
            </div>
          </section>
        </div>
      </div>

      {/* Premium Required Modal */}
      <PremiumRequiredModal
        isOpen={showPremiumModal}
        onClose={() => setShowPremiumModal(false)}
        onSubscribe={() => {
          setShowPremiumModal(false)
          handleUpgradeClick()
        }}
        featureName={`Sampling Pool Depth (${samplingDepth} points)`}
        description="Increase sampling depth to provide AI with more historical data for better trend analysis."
      />
    </div>
  )
}
