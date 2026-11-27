import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import {
  placeManualOrder,
  estimateLiquidationPrice,
  calculateRequiredMargin,
  getHyperliquidBalance,
  getCurrentPrice,
  getHyperliquidPositions,
  getBinanceBalance,
  getBinancePositions,
  getBinancePrice,
  placeBinanceOrder,
} from '@/lib/hyperliquidApi';
import type { ManualOrderRequest, HyperliquidBalance, HyperliquidPosition } from '@/lib/types/hyperliquid';
import { useTranslation } from 'react-i18next';
import type { ExchangeType } from './WalletSelector';

interface OrderFormProps {
  accountId: number;
  environment: 'testnet' | 'mainnet';
  exchange: ExchangeType;
  availableSymbols: string[];
  maxLeverage: number;
  defaultLeverage: number;
  onOrderPlaced?: () => void;
}

type OrderSide = 'long' | 'short' | 'close';
type TimeInForce = 'Ioc' | 'Gtc' | 'Alo';

export default function OrderForm({
  accountId,
  environment,
  exchange,
  availableSymbols,
  maxLeverage,
  defaultLeverage,
  onOrderPlaced,
}: OrderFormProps) {
  const { t } = useTranslation();
  const [symbol, setSymbol] = useState(availableSymbols[0] || 'BTC');
  const [side, setSide] = useState<OrderSide>('long');
  const [timeInForce, setTimeInForce] = useState<TimeInForce>('Ioc');
  const [size, setSize] = useState('');
  const [price, setPrice] = useState('');
  const [leverage, setLeverage] = useState(defaultLeverage);
  const [takeProfitPrice, setTakeProfitPrice] = useState('');
  const [stopLossPrice, setStopLossPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState<HyperliquidBalance | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [positions, setPositions] = useState<HyperliquidPosition[]>([]);

  useEffect(() => {
    loadBalance();
    loadPositions();
  }, [accountId, exchange]);

  useEffect(() => {
    setLeverage(defaultLeverage);
  }, [defaultLeverage]);

  useEffect(() => {
    loadCurrentPrice();
  }, [symbol, exchange]);

  useEffect(() => {
    if (currentPrice > 0 && !price) {
      const adjustedPrice = side === 'long' ? currentPrice * 1.001 : currentPrice * 0.999;
      setPrice(adjustedPrice.toFixed(2));
    }
  }, [currentPrice, side]);

  const loadBalance = async () => {
    try {
      const data = exchange === 'hyperliquid'
        ? await getHyperliquidBalance(accountId, environment)
        : await getBinanceBalance(accountId, environment);
      setBalance(data);
    } catch (error) {
      console.error('Failed to load balance:', error);
    }
  };

  const loadCurrentPrice = async () => {
    try {
      const priceValue = exchange === 'hyperliquid'
        ? await getCurrentPrice(symbol)
        : await getBinancePrice(symbol);
      setCurrentPrice(priceValue);
    } catch (error) {
      console.error('Failed to load current price:', error);
    }
  };

  const loadPositions = async () => {
    try {
      const data = exchange === 'hyperliquid'
        ? await getHyperliquidPositions(accountId, environment)
        : await getBinancePositions(accountId, environment);
      setPositions(data.positions || []);
    } catch (error) {
      console.error('Failed to load positions:', error);
    }
  };

  const calculateMaxSize = () => {
    if (!balance || balance.availableBalance <= 0) return 0;
    const priceToUse = price ? parseFloat(price) : currentPrice;
    if (!priceToUse || priceToUse <= 0) return 0;
    return (balance.availableBalance * leverage) / priceToUse;
  };

  const getCurrentPosition = () => {
    return positions.find(pos => pos.coin === symbol);
  };

  const handleMaxSize = () => {
    const maxSize = calculateMaxSize();
    if (maxSize > 0) {
      setSize(maxSize.toFixed(4));
    }
  };

  const handleClosePosition = () => {
    const position = getCurrentPosition();
    if (position) {
      // For close position, always use absolute value of position size
      const positionSize = Math.abs(position.szi);
      setSize(positionSize.toString());
    }
  };

  const handleAutoFillTakeProfit = () => {
    const priceToUse = price ? parseFloat(price) : currentPrice;
    if (priceToUse > 0) {
      // 10% profit for long, 10% profit for short
      const tpPrice = side === 'long'
        ? priceToUse * 1.1
        : priceToUse * 0.9;
      setTakeProfitPrice(tpPrice.toFixed(2));
    }
  };

  const handleAutoFillStopLoss = () => {
    const priceToUse = price ? parseFloat(price) : currentPrice;
    if (priceToUse > 0) {
      // 5% loss for long, 5% loss for short
      const slPrice = side === 'long'
        ? priceToUse * 0.95
        : priceToUse * 1.05;
      setStopLossPrice(slPrice.toFixed(2));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!size || parseFloat(size) <= 0) {
      toast.error('Please enter a valid size');
      return;
    }

    if (!price || parseFloat(price) <= 0) {
      toast.error('Please enter a valid price');
      return;
    }

    if (side !== 'close' && leverage > maxLeverage) {
      toast.error(`Leverage cannot exceed ${maxLeverage}x`);
      return;
    }

    if (side === 'close' && !getCurrentPosition()) {
      toast.error(`No position found for ${symbol}`);
      return;
    }

    setLoading(true);
    try {
      // For close position, determine correct direction based on current position
      let isBuy = side === 'long';
      if (side === 'close') {
        const position = getCurrentPosition();
        if (position) {
          isBuy = position.szi < 0;
        }
      }

      let result: any;

      if (exchange === 'hyperliquid') {
        const request: ManualOrderRequest = {
          symbol,
          is_buy: isBuy,
          size: parseFloat(size),
          price: parseFloat(price),
          time_in_force: timeInForce,
          reduce_only: side === 'close',
          leverage: side !== 'close' ? leverage : 1,
          take_profit_price: takeProfitPrice && parseFloat(takeProfitPrice) > 0 ? parseFloat(takeProfitPrice) : undefined,
          stop_loss_price: stopLossPrice && parseFloat(stopLossPrice) > 0 ? parseFloat(stopLossPrice) : undefined,
          environment,
        };
        result = await placeManualOrder(accountId, request);

        const orderResult = result.order_result || result;
        const avgPrice = orderResult.averagePrice || orderResult.average_price || orderResult.price;
        const priceText = avgPrice ? ` @ $${avgPrice.toFixed(2)}` : '';
        const status = orderResult.status;

        if (status === 'filled') {
          toast.success(`Order Filled! ${side.toUpperCase()} ${size} ${symbol}${priceText}`);
        } else if (status === 'resting') {
          toast.success(`Order Placed! ${side.toUpperCase()} ${size} ${symbol}${priceText} (waiting to fill)`);
        } else if (status === 'error') {
          toast.error(`Order failed: ${orderResult.error || 'Unknown error'}`);
        } else {
          toast.error(`Order failed: Unknown status (${status})`);
        }
      } else {
        // Binance order
        result = await placeBinanceOrder(accountId, {
          symbol,
          side: isBuy ? 'BUY' : 'SELL',
          quantity: parseFloat(size),
          orderType: timeInForce === 'Ioc' ? 'MARKET' : 'LIMIT',
          price: timeInForce !== 'Ioc' ? parseFloat(price) : undefined,
          leverage: side !== 'close' ? leverage : 1,
          reduceOnly: side === 'close',
          takeProfitPrice: takeProfitPrice && parseFloat(takeProfitPrice) > 0 ? parseFloat(takeProfitPrice) : undefined,
          stopLossPrice: stopLossPrice && parseFloat(stopLossPrice) > 0 ? parseFloat(stopLossPrice) : undefined,
        }, environment);

        const status = result.status;
        const avgPrice = result.avg_price || result.price;
        const priceText = avgPrice ? ` @ $${avgPrice.toFixed(2)}` : '';

        // Unified status: "filled" or "resting" (same as Hyperliquid)
        if (status === 'filled') {
          toast.success(`Order Filled! ${side.toUpperCase()} ${size} ${symbol}${priceText}`);
        } else if (status === 'resting') {
          toast.success(`Order Placed! ${side.toUpperCase()} ${size} ${symbol}${priceText} (waiting to fill)`);
        } else {
          toast.error(`Order failed: ${result.error || status || 'Unknown error'}`);
        }
      }

      // Reset form
      setSize('');
      setPrice('');
      setLeverage(defaultLeverage);
      setTakeProfitPrice('');
      setStopLossPrice('');
      setTimeInForce('Ioc');

      // Reload balance, positions and notify parent
      await loadBalance();
      await loadPositions();
      if (onOrderPlaced) {
        onOrderPlaced();
      }
    } catch (error: any) {
      console.error('Failed to place order:', error);
      toast.error(error.message || 'Failed to place order');
    } finally {
      setLoading(false);
    }
  };

  const estimatedLiqPrice =
    side !== 'close' && size && parseFloat(size) > 0
      ? estimateLiquidationPrice(
          parseFloat(price || '0'),
          leverage,
          side === 'long'
        )
      : 0;

  const requiredMargin =
    side !== 'close' && size && parseFloat(size) > 0 && price
      ? calculateRequiredMargin(parseFloat(size), parseFloat(price), leverage)
      : 0;

  const canAfford = balance
    ? requiredMargin <= balance.availableBalance
    : true;

  const showLeverageWarning = leverage > 5;

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl font-bold">{t('order.title', 'Place Hyperliquid Order (Manual)')}</h2>
          <p className="text-sm text-gray-500">
            {t('order.description', 'Manual order placement for perpetual contracts')}
          </p>
        </div>

        {/* Symbol Selector */}
        <div className="space-y-2">
          <label htmlFor="symbol" className="block text-sm font-medium">
            {t('order.symbol', 'Symbol')}
          </label>
          <Select value={symbol} onValueChange={setSymbol}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableSymbols.map((sym) => (
                <SelectItem key={sym} value={sym}>
                  {sym}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Side Selector */}
        <div className="space-y-2">
          <label className="block text-sm font-medium">{t('order.side', 'Side')}</label>
          <div className="grid grid-cols-3 gap-2">
            <Button
              type="button"
              variant={side === 'long' ? 'default' : 'outline'}
              onClick={() => setSide('long')}
              className={side === 'long' ? 'bg-green-600 hover:bg-green-700' : ''}
            >
              <TrendingUp className="w-4 h-4 mr-1" />
              {t('order.long', 'Long')}
            </Button>
            <Button
              type="button"
              variant={side === 'short' ? 'default' : 'outline'}
              onClick={() => setSide('short')}
              className={side === 'short' ? 'bg-red-600 hover:bg-red-700' : ''}
            >
              <TrendingDown className="w-4 h-4 mr-1" />
              {t('order.short', 'Short')}
            </Button>
            {/* Removed: Close Position button - use PositionsTable for closing positions */}
            {/* <Button
              type="button"
              variant={side === 'close' ? 'default' : 'outline'}
              onClick={() => setSide('close')}
            >
              Close Position
            </Button> */}
          </div>
        </div>

        {/* Time In Force */}
        <div className="space-y-2">
          <label htmlFor="timeInForce" className="block text-sm font-medium">
            {t('order.timeInForce', 'Time In Force')}
          </label>
          <Select value={timeInForce} onValueChange={(value: TimeInForce) => setTimeInForce(value)}>
            <SelectTrigger id="timeInForce">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Ioc">
                <div className="flex flex-col items-start">
                  <span className="font-medium">{t('order.iocRecommended', 'Ioc (Recommended)')}</span>
                  <span className="text-xs text-gray-500">{t('order.iocDesc', 'Immediate or Cancel - executes like market order')}</span>
                </div>
              </SelectItem>
              <SelectItem value="Gtc">
                <div className="flex flex-col items-start">
                  <span className="font-medium">Gtc</span>
                  <span className="text-xs text-gray-500">{t('order.gtcDesc', 'Good Till Canceled - limit order stays on book')}</span>
                </div>
              </SelectItem>
              <SelectItem value="Alo">
                <div className="flex flex-col items-start">
                  <span className="font-medium">{t('order.aloAdvanced', 'Alo (Advanced)')}</span>
                  <span className="text-xs text-gray-500">{t('order.aloDesc', 'Add Liquidity Only - maker-only orders')}</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Size Input */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label htmlFor="size" className="block text-sm font-medium">
              {t('order.size', 'Size')}
            </label>
            {side !== 'close' && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleMaxSize}
                disabled={!balance || balance.availableBalance <= 0 || !currentPrice}
              >
                {t('order.max', 'Max')}
              </Button>
            )}
            {side === 'close' && getCurrentPosition() && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClosePosition}
              >
                {t('order.fullPosition', 'Full Position')}
              </Button>
            )}
          </div>
          <div className="relative">
            <Input
              id="size"
              type="number"
              step="0.0001"
              value={size}
              onChange={(e) => setSize(e.target.value)}
              placeholder="0.0"
              className="pr-16"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
              {symbol}
            </span>
          </div>
          {side !== 'close' && !canAfford && size && parseFloat(size) > 0 && (
            <p className="text-sm text-red-600">
              {t('order.insufficientFunds', 'Insufficient funds, max available:')} {calculateMaxSize().toFixed(4)} {symbol}
            </p>
          )}
          {side === 'close' && !getCurrentPosition() && (
            <p className="text-sm text-yellow-600">
              {t('order.noPositionFound', 'No {{symbol}} position found', { symbol })}
            </p>
          )}
        </div>

        {/* Leverage Slider (only for open positions) */}
        {side !== 'close' && (
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label htmlFor="leverage" className="text-sm font-medium">
                {t('order.leverage', 'Leverage')}
              </label>
              <span className="text-sm font-bold">{leverage}x</span>
            </div>
            <input
              id="leverage"
              type="range"
              min="1"
              max={maxLeverage}
              value={leverage}
              onChange={(e) => setLeverage(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
            />
            {showLeverageWarning && (
              <div className="flex items-center space-x-2 text-yellow-600 text-sm">
                <AlertTriangle className="w-4 h-4" />
                <span>{t('order.highLeverageWarning', 'High leverage increases liquidation risk')}</span>
              </div>
            )}
          </div>
        )}

        {/* Price Input */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label htmlFor="price" className="block text-sm font-medium">
              {t('order.limitPrice', 'Limit Price')}
            </label>
            {currentPrice > 0 && (
              <span className="text-sm text-gray-500">
                {t('order.market', 'Market')}: ${currentPrice.toFixed(2)}
              </span>
            )}
          </div>
          <div className="relative">
            <Input
              id="price"
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              className="pr-16"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
              USDC
            </span>
          </div>
          {price && currentPrice > 0 && (
            <p className="text-sm text-gray-600">
              {side === 'long' ? t('order.buy', 'Buy') : t('order.sell', 'Sell')} {t('order.priceIs', 'price is')}{' '}
              {((parseFloat(price) - currentPrice) / currentPrice * 100).toFixed(2)}%{' '}
              {parseFloat(price) > currentPrice ? t('order.aboveMarket', 'above') : t('order.belowMarket', 'below')} {t('order.market', 'market')}
            </p>
          )}
        </div>

        {/* Take Profit / Stop Loss (only for open positions) */}
        {side !== 'close' && (
          <div className="space-y-4">
            {/* Take Profit */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label htmlFor="takeProfit" className="block text-sm font-medium">
                  {t('order.takeProfitOptional', 'Take Profit Price (Optional)')}
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAutoFillTakeProfit}
                  disabled={!price && !currentPrice}
                >
                  {t('order.autoFill', 'Auto Fill')}
                </Button>
              </div>
              <div className="relative">
                <Input
                  id="takeProfit"
                  type="number"
                  step="0.01"
                  value={takeProfitPrice}
                  onChange={(e) => setTakeProfitPrice(e.target.value)}
                  placeholder="0.00"
                  className="pr-16"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                  USDC
                </span>
              </div>
              <p className="text-xs text-gray-500">
                {t('order.takeProfitHint', 'Auto-fill sets +10% profit target from entry price')}
              </p>
            </div>

            {/* Stop Loss */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label htmlFor="stopLoss" className="block text-sm font-medium">
                  {t('order.stopLossOptional', 'Stop Loss Price (Optional)')}
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAutoFillStopLoss}
                  disabled={!price && !currentPrice}
                >
                  {t('order.autoFill', 'Auto Fill')}
                </Button>
              </div>
              <div className="relative">
                <Input
                  id="stopLoss"
                  type="number"
                  step="0.01"
                  value={stopLossPrice}
                  onChange={(e) => setStopLossPrice(e.target.value)}
                  placeholder="0.00"
                  className="pr-16"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                  USDC
                </span>
              </div>
              <p className="text-xs text-gray-500">
                {t('order.stopLossHint', 'Auto-fill sets -5% stop loss from entry price')}
              </p>
            </div>
          </div>
        )}

        {/* Risk Information */}
        {side !== 'close' && size && parseFloat(size) > 0 && (
          <div className="p-4 bg-gray-50 rounded-lg space-y-2">
            {estimatedLiqPrice > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center text-gray-700">
                  <AlertTriangle className="w-4 h-4 mr-1 text-yellow-600" />
                  {t('order.estimatedLiquidation', 'Estimated Liquidation')}
                </span>
                <span className="font-medium">${estimatedLiqPrice.toFixed(2)}</span>
              </div>
            )}

            <div className="flex justify-between text-sm">
              <span className="text-gray-700">{t('order.requiredMargin', 'Required Margin')}</span>
              <span className={`font-medium ${canAfford ? 'text-green-600' : 'text-red-600'}`}>
                ${requiredMargin.toFixed(2)}
              </span>
            </div>

            {balance && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-700">{t('order.availableBalance', 'Available Balance')}</span>
                <span className="font-medium">${balance.availableBalance.toFixed(2)}</span>
              </div>
            )}

            {!canAfford && (
              <div className="flex items-center space-x-2 text-red-600 text-sm pt-2">
                <AlertTriangle className="w-4 h-4" />
                <span>{t('order.insufficientBalance', 'Insufficient balance for this order')}</span>
              </div>
            )}
          </div>
        )}

        {/* Position Information (for close orders) */}
        {side === 'close' && (
          <div className="p-4 bg-blue-50 rounded-lg space-y-2">
            {getCurrentPosition() ? (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-700">{t('order.currentPosition', 'Current Position')}</span>
                  <span className="font-medium">
                    {Math.abs(getCurrentPosition()!.szi)} {symbol}
                    ({getCurrentPosition()!.szi > 0 ? 'LONG' : 'SHORT'})
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-700">{t('order.entryPrice', 'Entry Price')}</span>
                  <span className="font-medium">${getCurrentPosition()!.entryPx.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-700">{t('order.unrealizedPnl', 'Unrealized PnL')}</span>
                  <span className={`font-medium ${getCurrentPosition()!.unrealizedPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    ${getCurrentPosition()!.unrealizedPnl.toFixed(2)}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex items-center space-x-2 text-yellow-600 text-sm">
                <AlertTriangle className="w-4 h-4" />
                <span>{t('order.noPositionFound', 'No {{symbol}} position found', { symbol })}</span>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex space-x-3">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => {
              setSize('');
              setPrice('');
              setLeverage(defaultLeverage);
              setTakeProfitPrice('');
              setStopLossPrice('');
              setTimeInForce('Ioc');
            }}
          >
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            type="submit"
            disabled={loading || !canAfford}
            className="flex-1"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('order.placing', 'Placing...')}
              </>
            ) : (
              t('order.placeOrder', 'Place Order')
            )}
          </Button>
        </div>
      </form>
    </Card>
  );
}
