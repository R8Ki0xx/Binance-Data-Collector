import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import TradingViewChart from './TradingViewChart'
import AIAnalysisPanel from './AIAnalysisPanel'
import PacmanLoader from '../ui/pacman-loader'
import { useCollectionDays } from '@/lib/useCollectionDays'

interface KlinesViewProps {
  onAccountUpdated?: () => void
}

interface MarketData {
  symbol: string
  price: number
  oracle_price: number
  change24h: number
  volume24h: number
  percentage24h: number
  open_interest: number
  funding_rate: number
}

export default function KlinesView({ onAccountUpdated }: KlinesViewProps) {
  const { t } = useTranslation()
  const [selectedExchange, setSelectedExchange] = useState<'hyperliquid' | 'binance'>('hyperliquid')
  const collectionDays = useCollectionDays(selectedExchange)
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTC')
  const [selectedPeriod, setSelectedPeriod] = useState<string>('1m')
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([])
  const [marketData, setMarketData] = useState<MarketData[]>([])
  const [isPageVisible, setIsPageVisible] = useState(true)
  const [chartType, setChartType] = useState<'candlestick' | 'line' | 'area'>('candlestick')
  const [selectedIndicators, setSelectedIndicators] = useState<string[]>([])
  const [chartLoading, setChartLoading] = useState(false)
  const [klinesData, setKlinesData] = useState<any[]>([])
  const [indicatorsData, setIndicatorsData] = useState<Record<string, any>>({})
  const [indicatorLoading, setIndicatorLoading] = useState(false)
  const [selectedFlowIndicators, setSelectedFlowIndicators] = useState<string[]>([])

  const marketDataIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Flow indicator availability based on exchange and period
  const getFlowIndicatorAvailability = (exchange: string, period: string) => {
    // Period to minutes mapping
    const periodMinutes: Record<string, number> = {
      '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30,
      '1h': 60, '2h': 120, '4h': 240, '8h': 480, '12h': 720,
      '1d': 1440, '3d': 4320, '1w': 10080, '1M': 43200
    }
    const minutes = periodMinutes[period] || 1

    if (exchange === 'binance') {
      return {
        cvd: true,
        taker_volume: true,
        // OI: Binance historical API only supports 5m+, real-time collection started recently
        oi: minutes >= 5,
        oi_delta: minutes >= 5,
        // Funding: Now collected every minute via premiumIndex API
        funding: true,
        depth_ratio: true,
        order_imbalance: true
      }
    }
    // Hyperliquid: all indicators available at all periods
    return {
      cvd: true, taker_volume: true, oi: true, oi_delta: true,
      funding: true, depth_ratio: true, order_imbalance: true
    }
  }

  const flowAvailability = getFlowIndicatorAvailability(selectedExchange, selectedPeriod)

  // 页面可见性监听
  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsPageVisible(!document.hidden)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // 获取 watchlist
  useEffect(() => {
    fetchWatchlist()
  }, [selectedExchange])

  // 获取市场数据
  useEffect(() => {
    const fetchData = async () => {
      try {
        const symbolsParam = watchlistSymbols.join(',')
        if (!symbolsParam) return

        const response = await fetch(`/api/market/prices?symbols=${symbolsParam}&market=${selectedExchange}`)
        if (!response.ok) return

        const data = await response.json()
        const formattedData = data.map((item: any) => ({
          symbol: item.symbol,
          price: item.price || 0,
          oracle_price: item.oracle_price || 0,
          change24h: item.change24h || 0,
          volume24h: item.volume24h || 0,
          percentage24h: item.percentage24h || 0,
          open_interest: item.open_interest || 0,
          funding_rate: item.funding_rate || 0
        }))
        setMarketData(formattedData)
      } catch (error) {
        console.error('Failed to fetch market data:', error)
      }
    }

    if (watchlistSymbols.length > 0 && isPageVisible) {
      fetchData()
      marketDataIntervalRef.current = setInterval(fetchData, 60000)
    }

    return () => {
      if (marketDataIntervalRef.current) {
        clearInterval(marketDataIntervalRef.current)
        marketDataIntervalRef.current = null
      }
    }
  }, [watchlistSymbols, isPageVisible, selectedExchange])

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (marketDataIntervalRef.current) {
        clearInterval(marketDataIntervalRef.current)
      }
    }
  }, [])

  const fetchWatchlist = async () => {
    try {
      const endpoint = selectedExchange === 'binance'
        ? '/api/binance/symbols/watchlist'
        : '/api/hyperliquid/symbols/watchlist'
      const response = await fetch(endpoint)
      const data = await response.json()
      const symbols = data.symbols || []
      setWatchlistSymbols(symbols)
      if (symbols.length > 0 && !symbols.includes(selectedSymbol)) {
        setSelectedSymbol(symbols[0])
      }
    } catch (error) {
      console.error('Failed to fetch watchlist:', error)
    }
  }

  const getSymbolMarketData = (symbol: string) => {
    return marketData.find(data => data.symbol === symbol)
  }

  const formatCompactNumber = (value: number) => {
    if (!value && value !== 0) return '-'
    const abs = Math.abs(value)
    if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
    if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`
    return value.toLocaleString()
  }

  return (
    <div className="flex flex-col md:flex-row h-full w-full gap-4 overflow-hidden pb-16 md:pb-0">
      {/* 左侧 70%：选择区 + 市场数据 + 指标 + K线图 */}
      <div className="flex flex-col flex-1 md:flex-[7] min-w-0 space-y-4 overflow-hidden">
        {/* Mobile: Simplified selector bar */}
        <div className="md:hidden flex items-center gap-2 px-2 py-2 bg-background border-b">
          {/* Mobile Exchange Selector */}
          <div className="flex items-center gap-0.5 p-0.5 rounded border-2 border-amber-500/70 bg-amber-500/5">
            <button
              onClick={() => setSelectedExchange('hyperliquid')}
              className={`p-1.5 rounded transition-all ${
                selectedExchange === 'hyperliquid'
                  ? 'bg-primary text-primary-foreground'
                  : ''
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 144 144" fill="none">
                <path d="M144 71.6991C144 119.306 114.866 134.582 99.5156 120.98C86.8804 109.889 83.1211 86.4521 64.116 84.0456C39.9942 81.0113 37.9057 113.133 22.0334 113.133C3.5504 113.133 0 86.2428 0 72.4315C0 58.3063 3.96809 39.0542 19.736 39.0542C38.1146 39.0542 39.1588 66.5722 62.132 65.1073C85.0007 63.5379 85.4184 34.8689 100.247 22.6271C113.195 12.0593 144 23.4641 144 71.6991Z" fill={selectedExchange === 'hyperliquid' ? 'currentColor' : '#50E3C2'}/>
              </svg>
            </button>
            <button
              onClick={() => setSelectedExchange('binance')}
              className={`p-1.5 rounded transition-all ${
                selectedExchange === 'binance'
                  ? 'bg-primary text-primary-foreground'
                  : ''
              }`}
            >
              <img src="/static/binance_logo.svg" alt="Binance" width={14} height={14} />
            </button>
          </div>
          <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
            <SelectTrigger className="flex-1 h-9">
              <SelectValue placeholder={t('kline.selectSymbol', 'Select Symbol')} />
            </SelectTrigger>
            <SelectContent>
              {watchlistSymbols.map(symbol => (
                <SelectItem key={symbol} value={symbol}>{symbol}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-20 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['1m','5m','15m','1h','4h','1d'].map(p => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Desktop: Full control panel */}
        <div className="hidden md:grid grid-cols-1 lg:grid-cols-6 gap-3 flex-shrink-0">
          {/* Symbol and Period Selection */}
          <Card className="lg:col-span-2">
            <CardContent className="pt-4 space-y-3">
              {/* Exchange Selector - Gold border for visibility */}
              <div className="flex items-center gap-1 p-1 rounded-md border-2 border-amber-500/70 bg-amber-500/5">
                <button
                  onClick={() => setSelectedExchange('hyperliquid')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded transition-all ${
                    selectedExchange === 'hyperliquid'
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  }`}
                >
                  <svg width="16" height="16" viewBox="0 0 144 144" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M144 71.6991C144 119.306 114.866 134.582 99.5156 120.98C86.8804 109.889 83.1211 86.4521 64.116 84.0456C39.9942 81.0113 37.9057 113.133 22.0334 113.133C3.5504 113.133 0 86.2428 0 72.4315C0 58.3063 3.96809 39.0542 19.736 39.0542C38.1146 39.0542 39.1588 66.5722 62.132 65.1073C85.0007 63.5379 85.4184 34.8689 100.247 22.6271C113.195 12.0593 144 23.4641 144 71.6991Z" fill={selectedExchange === 'hyperliquid' ? 'currentColor' : '#50E3C2'}/>
                  </svg>
                  Hyperliquid
                </button>
                <button
                  onClick={() => setSelectedExchange('binance')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded transition-all ${
                    selectedExchange === 'binance'
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  }`}
                >
                  <img src="/static/binance_logo.svg" alt="Binance" width={16} height={16} />
                  Binance
                </button>
              </div>

              {/* Symbol and Period */}
              <div className="flex items-center gap-2">
                <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t('kline.selectSymbol', 'Select Symbol')} />
                  </SelectTrigger>
                  <SelectContent>
                    {watchlistSymbols.map(symbol => (
                      <SelectItem key={symbol} value={symbol}>
                        {symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                  <SelectTrigger className="w-24 sm:w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1m">1m</SelectItem>
                    <SelectItem value="3m">3m</SelectItem>
                    <SelectItem value="5m">5m</SelectItem>
                    <SelectItem value="15m">15m</SelectItem>
                    <SelectItem value="30m">30m</SelectItem>
                    <SelectItem value="1h">1h</SelectItem>
                    <SelectItem value="2h">2h</SelectItem>
                    <SelectItem value="4h">4h</SelectItem>
                    <SelectItem value="8h">8h</SelectItem>
                    <SelectItem value="12h">12h</SelectItem>
                    <SelectItem value="1d">1d</SelectItem>
                    <SelectItem value="3d">3d</SelectItem>
                    <SelectItem value="1w">1w</SelectItem>
                    <SelectItem value="1M">1M</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* K-line environment warning - exchange specific */}
              <div className="pt-2 border-t">
                <p className="text-xs text-amber-600 font-medium flex items-center gap-1">
                  <span>⚠️</span>
                  <span>
                    {selectedExchange === 'hyperliquid'
                      ? t('kline.mainnetWarning', 'K-line analysis is only available for Mainnet environment')
                      : t('kline.binanceWarning', 'K-line analysis is only available for Binance Futures production environment')
                    }
                  </span>
                </p>
                {collectionDays !== null && collectionDays > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {selectedExchange === 'hyperliquid'
                      ? t('common.collectionDaysHint', 'Hyperliquid market flow data collected for {{days}} days', { days: collectionDays })
                      : t('common.binanceCollectionDaysHint', 'Binance market flow data collected for {{days}} days', { days: collectionDays })
                    }
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Market Data */}
          <Card className="lg:col-span-2">
            <CardHeader className="py-2">
              <CardTitle className="text-sm">{t('kline.marketData', 'Market Data')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {selectedSymbol && (
                <div className="grid grid-cols-3 gap-2">
                  {(() => {
                    const data = getSymbolMarketData(selectedSymbol)
                    return data ? (
                      <>
                        <div>
                          <p className="text-xs text-muted-foreground">{t('kline.markPrice', 'Mark Price')}</p>
                          <p className="text-sm font-semibold">{data.price.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t('kline.oraclePrice', 'Oracle Price')}</p>
                          <p className="text-sm font-semibold">{data.oracle_price.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t('kline.change24h', '24h Change')}</p>
                          <p className={`text-sm font-semibold ${data.change24h >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {data.percentage24h >= 0 ? "+" : ""}{data.percentage24h.toFixed(2)}%
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t('kline.volume24h', '24h Volume')}</p>
                          <p className="text-sm font-semibold">${formatCompactNumber(data.volume24h)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t('kline.openInterest', 'Open Interest')}</p>
                          <p className="text-sm font-semibold">${formatCompactNumber(data.open_interest)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">{t('kline.fundingRate', 'Funding Rate')}</p>
                          <p className="text-sm font-semibold">{(data.funding_rate * 100).toFixed(4)}%</p>
                        </div>
                      </>
                    ) : (
                      <div className="col-span-full text-center text-muted-foreground">
                        <div className="flex items-center justify-center gap-2">
                          <PacmanLoader className="w-12 h-6" />
                          <span className="text-xs">{t('common.loading', 'Loading...')}</span>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}
              {/* Market Flow Indicators */}
              <div className="flex items-center gap-2 pt-2 border-t">
                <span className="text-xs text-muted-foreground font-medium">{t('kline.flow', 'Flow')}</span>
                <div className="flex gap-1.5 flex-wrap">
                  {[
                    { key: 'cvd', label: 'CVD' },
                    { key: 'taker_volume', label: 'Taker Vol' },
                    { key: 'oi', label: 'OI' },
                    { key: 'oi_delta', label: 'OI Delta' },
                    { key: 'funding', label: 'Funding' },
                    { key: 'depth_ratio', label: 'Depth(log)' },
                    { key: 'order_imbalance', label: 'Imbalance' }
                  ].map(({ key, label }) => {
                    const isAvailable = flowAvailability[key as keyof typeof flowAvailability]
                    return (
                      <button
                        key={key}
                        disabled={!isAvailable}
                        title={!isAvailable ? t('kline.indicatorUnavailable', 'Not available for {{exchange}} at {{period}}', { exchange: selectedExchange, period: selectedPeriod }) : undefined}
                        onClick={() => isAvailable && setSelectedFlowIndicators(prev =>
                          prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
                        )}
                        className={`px-2 py-1 text-xs rounded transition-colors ${
                          !isAvailable
                            ? 'opacity-40 cursor-not-allowed border border-muted'
                            : selectedFlowIndicators.includes(key)
                              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                              : 'hover:bg-muted border'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Technical Indicators */}
          <Card className="lg:col-span-2">
            <CardHeader className="py-3">
              <CardTitle className="text-sm">{t('kline.technicalIndicators', 'Technical Indicators')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-1.5">
              {/* Row 1: Trend */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-muted-foreground font-medium min-w-[52px]">{t('kline.trend', 'Trend')}</span>
                <div className="flex gap-1 flex-wrap">
                  {['MA5', 'MA10', 'MA20', 'EMA20', 'EMA50', 'EMA100'].map(indicator => (
                    <button
                      key={indicator}
                      onClick={() => {
                        setSelectedIndicators(prev =>
                          prev.includes(indicator)
                            ? prev.filter(i => i !== indicator)
                            : [...prev, indicator]
                        )
                      }}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors min-w-[38px] ${
                        selectedIndicators.includes(indicator)
                          ? 'bg-primary/20 text-primary border border-primary/30'
                          : 'hover:bg-muted border'
                      }`}
                    >
                      {indicator}
                    </button>
                  ))}
                </div>
              </div>

              {/* Row 2: Volume */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-muted-foreground font-medium min-w-[52px]">{t('kline.volume', 'Volume')}</span>
                <div className="flex gap-1 flex-wrap">
                  {['VWAP', 'OBV'].map(indicator => (
                    <button
                      key={indicator}
                      onClick={() => {
                        setSelectedIndicators(prev =>
                          prev.includes(indicator)
                            ? prev.filter(i => i !== indicator)
                            : [...prev, indicator]
                        )
                      }}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors min-w-[38px] ${
                        selectedIndicators.includes(indicator)
                          ? 'bg-primary/20 text-primary border border-primary/30'
                          : 'hover:bg-muted border'
                      }`}
                    >
                      {indicator}
                    </button>
                  ))}
                </div>
              </div>

              {/* Row 3: Momentum */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-muted-foreground font-medium min-w-[52px]">{t('kline.momentum', 'Momentum')}</span>
                <div className="flex gap-1 flex-wrap">
                  {['RSI14', 'RSI7', 'STOCH', 'MACD'].map(indicator => (
                    <button
                      key={indicator}
                      onClick={() => {
                        setSelectedIndicators(prev =>
                          prev.includes(indicator)
                            ? prev.filter(i => i !== indicator)
                            : [...prev, indicator]
                        )
                      }}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors min-w-[38px] ${
                        selectedIndicators.includes(indicator)
                          ? 'bg-primary/20 text-primary border border-primary/30'
                          : 'hover:bg-muted border'
                      }`}
                    >
                      {indicator}
                    </button>
                  ))}
                </div>
              </div>

              {/* Row 4: Volatility */}
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-muted-foreground font-medium min-w-[52px]">{t('kline.volatility', 'Volatility')}</span>
                <div className="flex gap-1 flex-wrap">
                  {['BOLL', 'ATR14'].map(indicator => (
                    <button
                      key={indicator}
                      onClick={() => {
                        setSelectedIndicators(prev =>
                          prev.includes(indicator)
                            ? prev.filter(i => i !== indicator)
                            : [...prev, indicator]
                        )
                      }}
                      className={`px-1.5 py-0.5 text-[10px] rounded transition-colors min-w-[38px] ${
                        selectedIndicators.includes(indicator)
                          ? 'bg-primary/20 text-primary border border-primary/30'
                          : 'hover:bg-muted border'
                      }`}
                    >
                      {indicator}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* K-Line Chart Area */}
        <Card className="flex-1 min-h-[300px] md:min-h-[420px] min-w-0 overflow-hidden">
          <CardHeader className="py-2 md:py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 md:gap-3">
                <CardTitle className="text-xs md:text-sm">
                  {selectedSymbol} ({selectedPeriod})
                </CardTitle>
                {chartLoading && (
                  <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
                    <PacmanLoader className="w-12 h-6" />
                    {t('kline.loadingKlineData', 'Loading K-line data...')}
                  </div>
                )}
              </div>
              {/* Chart type selector - hidden on mobile */}
              <div className="hidden md:flex gap-1 bg-background/80 backdrop-blur-sm rounded-md p-1 border">
                <button
                  onClick={() => setChartType('candlestick')}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    chartType === 'candlestick'
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  }`}
                >
                  {t('kline.candlestick', 'Candlestick')}
                </button>
                <button
                  onClick={() => setChartType('line')}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    chartType === 'line'
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  }`}
                >
                  {t('kline.line', 'Line')}
                </button>
                <button
                  onClick={() => setChartType('area')}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    chartType === 'area'
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted'
                  }`}
                >
                  {t('kline.area', 'Area')}
                </button>
              </div>
            </div>
          </CardHeader>
            <CardContent className="h-[calc(100%-3rem)] pb-4">
                <TradingViewChart
                  symbol={selectedSymbol}
                  period={selectedPeriod}
                  exchange={selectedExchange}
                  chartType={chartType}
                  selectedIndicators={selectedIndicators}
                  selectedFlowIndicators={selectedFlowIndicators}
                  onLoadingChange={setChartLoading}
                  onIndicatorLoadingChange={setIndicatorLoading}
                  onDataUpdate={(klines, indicators) => {
                    setKlinesData(klines || [])
                    setIndicatorsData(indicators || {})
                  }}
                />
          </CardContent>
        </Card>
      </div>

      {/* 右侧 30%：AI Analysis 独立列 - Hidden on mobile */}
      <div className="hidden md:flex flex-col flex-[3] min-w-[300px] space-y-4">
        <Card className="flex-1 overflow-hidden">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">{t('kline.aiAnalysis', 'AI Analysis')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 h-full overflow-y-auto">
            <AIAnalysisPanel
              symbol={selectedSymbol}
              period={selectedPeriod}
              klines={klinesData}
              indicators={indicatorsData}
              marketData={getSymbolMarketData(selectedSymbol)}
              selectedIndicators={selectedIndicators}
              selectedFlowIndicators={selectedFlowIndicators}
              onAnalysisComplete={() => {}}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
