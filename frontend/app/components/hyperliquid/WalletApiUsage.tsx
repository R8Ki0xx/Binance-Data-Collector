import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, AlertTriangle, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { getWalletRateLimit, getBinanceRateLimit } from '@/lib/hyperliquidApi';
import type { HyperliquidEnvironment } from '@/lib/types/hyperliquid';
import type { ExchangeType } from './WalletSelector';
import { formatDateTime } from '@/lib/dateTime';
import { useTranslation } from 'react-i18next';

interface WalletApiUsageProps {
  accountId: number;
  environment: HyperliquidEnvironment;
  exchange?: ExchangeType;
}

interface RateLimitData {
  // Hyperliquid fields
  cumVlm?: number;
  nRequestsUsed?: number;
  nRequestsCap?: number;
  nRequestsSurplus?: number;
  // Binance fields
  used_weight?: number;
  weight_cap?: number;
  // Common fields
  remaining: number;
  usagePercent: number;
  isOverLimit: boolean;
  environment: string;
  walletAddress?: string;
  timestamp?: number;
}

export default function WalletApiUsage({ accountId, environment, exchange = 'hyperliquid' }: WalletApiUsageProps) {
  const { t } = useTranslation();
  const [rateLimit, setRateLimit] = useState<RateLimitData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null);

  const getCacheKey = () => `${exchange}_rate_limit_${accountId}_${environment}`;

  useEffect(() => {
    setRateLimit(null);
    setLastUpdateTime(null);
  }, [accountId, environment, exchange]);

  const handleUpdate = async () => {
    setLoading(true);
    try {
      if (exchange === 'hyperliquid') {
        const response = await getWalletRateLimit(accountId, environment);
        if (response.success && response.rateLimit) {
          const dataWithTimestamp = {
            ...response.rateLimit,
            timestamp: Date.now(),
          };
          setRateLimit(dataWithTimestamp);
          setLastUpdateTime(new Date());
          localStorage.setItem(getCacheKey(), JSON.stringify(dataWithTimestamp));
          toast.success('Rate limit status updated');
        } else {
          toast.error('Failed to fetch rate limit data');
        }
      } else {
        const response = await getBinanceRateLimit(accountId);
        if (response.success && response.rate_limit) {
          const rl = response.rate_limit;
          const dataWithTimestamp: RateLimitData = {
            used_weight: rl.used_weight,
            weight_cap: rl.weight_cap,
            remaining: rl.remaining,
            usagePercent: rl.usage_percent,
            isOverLimit: rl.usage_percent >= 100,
            environment,
            timestamp: Date.now(),
          };
          setRateLimit(dataWithTimestamp);
          setLastUpdateTime(new Date());
          localStorage.setItem(getCacheKey(), JSON.stringify(dataWithTimestamp));
          toast.success('Rate limit status updated');
        } else {
          toast.error('Failed to fetch rate limit data');
        }
      }
    } catch (error: any) {
      console.error('Error fetching rate limit:', error);
      toast.error(error.message || 'Failed to query rate limit');
    } finally {
      setLoading(false);
    }
  };

  const getUsageColor = () => {
    if (!rateLimit) return 'bg-gray-200';
    if (rateLimit.isOverLimit) return 'bg-red-500';
    if (rateLimit.usagePercent >= 90) return 'bg-red-400';
    if (rateLimit.usagePercent >= 70) return 'bg-yellow-400';
    return 'bg-green-500';
  };

  const getUsageTextColor = () => {
    if (!rateLimit) return 'text-gray-600';
    if (rateLimit.isOverLimit) return 'text-red-600';
    if (rateLimit.usagePercent >= 90) return 'text-red-600';
    if (rateLimit.usagePercent >= 70) return 'text-yellow-600';
    return 'text-green-600';
  };

  return (
    <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 p-4 rounded-lg border border-green-100 dark:border-green-900">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">
          {t('accountDetail.apiUsage', 'API Usage')}
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={handleUpdate}
          disabled={loading}
          className="flex items-center space-x-1 h-7 text-xs"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          <span>{t('common.refresh', 'Refresh')}</span>
        </Button>
      </div>

      {rateLimit ? (
        <div className="space-y-3">
          {/* Usage Stats - different layout for each exchange */}
          {exchange === 'hyperliquid' ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">{t('accountDetail.cumulativeVolume', 'Cumulative Volume')}</p>
                <p className="font-bold">${(rateLimit.cumVlm ?? 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">{t('accountDetail.requestsUsed', 'Requests Used')}</p>
                <p className="font-bold">{(rateLimit.nRequestsUsed ?? 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">{t('accountDetail.requestsCap', 'Requests Cap')}</p>
                <p className="font-bold">{(rateLimit.nRequestsCap ?? 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">{t('accountDetail.remaining', 'Remaining')}</p>
                <p className={`font-bold ${getUsageTextColor()}`}>
                  {rateLimit.remaining.toLocaleString()}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">{t('accountDetail.weightUsed', 'Weight Used')}</p>
                <p className="font-bold">{(rateLimit.used_weight ?? 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">{t('accountDetail.weightCap', 'Weight Cap')}</p>
                <p className="font-bold">{(rateLimit.weight_cap ?? 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">{t('accountDetail.remaining', 'Remaining')}</p>
                <p className={`font-bold ${getUsageTextColor()}`}>
                  {rateLimit.remaining.toLocaleString()}
                </p>
              </div>
            </div>
          )}

          {/* Progress Bar */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-600">Usage</span>
              <span className={`text-sm font-semibold ${getUsageTextColor()}`}>
                {rateLimit.usagePercent.toFixed(1)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full ${getUsageColor()} transition-all duration-300`}
                style={{ width: `${Math.min(rateLimit.usagePercent, 100)}%` }}
              />
            </div>
          </div>

          {/* Over Limit Warning */}
          {rateLimit.isOverLimit && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start space-x-3">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-800 mb-1">
                  ⚠️ API Quota Exceeded
                </p>
                <p className="text-xs text-red-700">
                  You have exceeded your request limit by {(rateLimit.nRequestsUsed - rateLimit.nRequestsCap).toLocaleString()} requests.
                  All order placement operations will be rejected until you increase your quota.
                </p>
                <p className="text-xs text-red-700 mt-2 font-medium">
                  💡 Solution: Trade ${(rateLimit.nRequestsUsed - rateLimit.nRequestsCap).toLocaleString()} USDC to free up quota (1 USDC = 1 request).
                </p>
              </div>
            </div>
          )}

          {/* Information Section */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-gray-700 space-y-2">
                <p>
                  <strong>What is this?</strong> Hyperliquid uses address-based request quotas to prevent API abuse.
                </p>
                <p>
                  <strong>Cumulative Volume:</strong> Total trading volume (USDC) completed on your wallet. Higher volume = more quota.
                </p>
                <p>
                  <strong>Requests Used:</strong> All API requests from your wallet, including queries (prices, positions) and orders.
                </p>
                <p>
                  <strong>Requests Cap:</strong> Maximum allowed requests = 10,000 (base) + your cumulative volume. Each $1 USDC traded adds 1 request.
                </p>
                <p>
                  <strong>What happens if exceeded?</strong> Order placement will fail with "Too many requests" error. Query operations (balance, positions, prices) are not affected.
                </p>
                <p className="font-semibold text-blue-800">
                  To increase your quota: Complete more trades. Every $1 USDC traded releases 1 request.
                </p>
              </div>
            </div>
          </div>

          {/* Last Update Time */}
          {lastUpdateTime && (
            <p className="text-xs text-gray-500 text-center">
              Last updated: {formatDateTime(lastUpdateTime)}
            </p>
          )}
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-gray-600 mb-4">
            Click "Update" to check your wallet's API usage status
          </p>
          <Button
            onClick={handleUpdate}
            disabled={loading}
            className="flex items-center space-x-2 mx-auto"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Loading...' : 'Check Status'}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
