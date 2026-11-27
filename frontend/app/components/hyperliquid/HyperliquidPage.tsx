import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, PlusCircle } from 'lucide-react';
import WalletSelector, { ExchangeType, WalletOption } from './WalletSelector';
import BalanceCard from './BalanceCard';
import PositionsTable from './PositionsTable';
import OrderForm from './OrderForm';
import WalletApiUsage from './WalletApiUsage';

const AVAILABLE_SYMBOLS = ['BTC', 'ETH', 'SOL', 'AVAX', 'MATIC', 'ARB', 'OP'];

export default function HyperliquidPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('overview');
  const [exchange, setExchange] = useState<ExchangeType>('hyperliquid');
  const [selectedWallet, setSelectedWallet] = useState<WalletOption | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isWalletSwitching, setIsWalletSwitching] = useState(false);

  const handleExchangeChange = (newExchange: ExchangeType) => {
    setExchange(newExchange);
    setSelectedWallet(null);
  };

  const handleWalletSelect = (wallet: WalletOption) => {
    setIsWalletSwitching(true);
    setSelectedWallet(wallet);
    setRefreshTrigger((prev) => prev + 1);
    setTimeout(() => setIsWalletSwitching(false), 1000);
  };

  const handleOrderPlaced = () => {
    setRefreshTrigger((prev) => prev + 1);
    toast.success(t('trade.refreshingData', 'Refreshing positions and balance'));
  };

  const handlePositionClosed = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Fixed header section */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b bg-background">
        <p className="text-sm text-muted-foreground mb-4">
          {t('trade.subtitle', 'Manual trading for learning rules and closing positions')}
        </p>

        {/* Exchange and Wallet selectors */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          {/* Exchange selector */}
          <div className="sm:w-48">
            <label className="text-xs font-medium text-muted-foreground block mb-2">
              {t('trade.selectExchange', 'Exchange')}
            </label>
            <select
              value={exchange}
              onChange={(e) => handleExchangeChange(e.target.value as ExchangeType)}
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/50 h-10"
            >
              <option value="hyperliquid">Hyperliquid</option>
              <option value="binance">Binance Futures</option>
            </select>
          </div>

          {/* Wallet selector */}
          <div className="flex-1">
            <WalletSelector
              exchange={exchange}
              selectedWalletId={selectedWallet?.wallet_id || null}
              onSelect={handleWalletSelect}
              compact={true}
            />
          </div>
        </div>
      </div>

      {/* Scrollable content section */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* Trading interface if wallet is selected and active */}
        {selectedWallet && selectedWallet.is_active && (
          <div className="relative">
            {isWalletSwitching && (
              <div className="absolute inset-0 bg-background/50 backdrop-blur-sm z-10 flex items-center justify-center rounded-lg">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto mb-2"></div>
                  <p className="text-sm text-muted-foreground">{t('trade.loadingWallet', 'Loading wallet data...')}</p>
                </div>
              </div>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="overview" className="flex items-center space-x-2">
                  <BarChart3 className="w-4 h-4" />
                  <span>{t('trade.overview', 'Overview')}</span>
                </TabsTrigger>
                <TabsTrigger value="trade" className="flex items-center space-x-2">
                  <PlusCircle className="w-4 h-4" />
                  <span>{t('trade.trade', 'Trade')}</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <BalanceCard
                    accountId={selectedWallet.account_id}
                    environment={selectedWallet.environment}
                    exchange={exchange}
                    autoRefresh={true}
                    refreshInterval={300}
                    refreshTrigger={refreshTrigger}
                  />

                  <div className="space-y-4">
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 p-4 rounded-lg border border-blue-100 dark:border-blue-900">
                      <h3 className="text-sm font-semibold mb-2">{t('trade.quickStats', 'Quick Stats')}</h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">{t('trade.maxLeverage', 'Max Leverage')}</span>
                          <span className="font-bold">{selectedWallet.max_leverage}x</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">{t('trade.defaultLeverage', 'Default Leverage')}</span>
                          <span className="font-bold">{selectedWallet.default_leverage}x</span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30 p-4 rounded-lg border border-purple-100 dark:border-purple-900">
                      <h3 className="text-sm font-semibold mb-2">{t('trade.riskManagement', 'Risk Management')}</h3>
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        <li>• {t('trade.riskTip1', 'Start with lower leverage (2-3x)')}</li>
                        <li>• {t('trade.riskTip2', 'Monitor liquidation prices closely')}</li>
                        <li>• {t('trade.riskTip3', 'Keep margin usage below 75%')}</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <PositionsTable
                  accountId={selectedWallet.account_id}
                  environment={selectedWallet.environment}
                  exchange={exchange}
                  autoRefresh={true}
                  refreshInterval={300}
                  refreshTrigger={refreshTrigger}
                  onPositionClosed={handlePositionClosed}
                />

                {exchange === 'hyperliquid' && (
                  <WalletApiUsage
                    accountId={selectedWallet.account_id}
                    environment={selectedWallet.environment}
                    exchange={exchange}
                  />
                )}
              </TabsContent>

              <TabsContent value="trade" className="space-y-4">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2">
                    <OrderForm
                      accountId={selectedWallet.account_id}
                      environment={selectedWallet.environment}
                      exchange={exchange}
                      availableSymbols={AVAILABLE_SYMBOLS}
                      maxLeverage={selectedWallet.max_leverage}
                      defaultLeverage={selectedWallet.default_leverage}
                      onOrderPlaced={handleOrderPlaced}
                    />
                  </div>

                  <div className="space-y-4">
                    <BalanceCard
                      accountId={selectedWallet.account_id}
                      environment={selectedWallet.environment}
                      exchange={exchange}
                      autoRefresh={false}
                      refreshTrigger={refreshTrigger}
                    />

                    <div className="bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900 rounded-lg p-3">
                      <h4 className="font-semibold text-yellow-900 dark:text-yellow-100 mb-2 text-xs">
                        {t('trade.tradingTips', 'Trading Tips')}
                      </h4>
                      <ul className="space-y-1 text-xs text-yellow-800 dark:text-yellow-200">
                        <li>• {t('trade.tip1', 'Market orders execute immediately')}</li>
                        <li>• {t('trade.tip2', 'Limit orders may not fill instantly')}</li>
                        <li>• {t('trade.tip3', 'Higher leverage = higher risk')}</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Disabled wallet warning */}
        {selectedWallet && !selectedWallet.is_active && (
          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-6 text-center">
            <h3 className="font-semibold text-red-900 dark:text-red-100 mb-2">{t('trade.walletDisabled', 'Wallet Disabled')}</h3>
            <p className="text-sm text-red-800 dark:text-red-200">
              {t('trade.walletDisabledDesc', 'Please re-enable this wallet in the AI Traders management page before trading.')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
