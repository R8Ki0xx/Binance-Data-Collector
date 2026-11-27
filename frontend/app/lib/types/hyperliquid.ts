/**
 * Hyperliquid type definitions for frontend
 */

export type HyperliquidEnvironment = 'testnet' | 'mainnet';

export interface HyperliquidConfig {
  enabled: boolean;
  environment: HyperliquidEnvironment;
  maxLeverage: number;
  defaultLeverage: number;
  hasTestnetKey: boolean;
  hasMainnetKey: boolean;
}

export interface HyperliquidBalance {
  totalEquity: number;
  availableBalance: number;
  usedMargin: number;
  marginUsagePercent: number;
  maintenanceMargin: number;
  withdrawalAvailable?: number;
  lastUpdated: string;
  walletAddress?: string;
}

export interface HyperliquidPosition {
  coin: string;
  szi: number; // signed size (positive = long, negative = short)
  entryPx: number; // entry price
  positionValue: number;
  unrealizedPnl: number;
  marginUsed: number;
  liquidationPx: number; // liquidation price
  leverage: number;
  // Extended fields from Hyperliquid API
  side?: string; // 'Long' or 'Short'
  returnOnEquity?: number; // ROE percentage
  maxLeverage?: number; // maximum allowed leverage
  leverageType?: string; // 'cross' or 'isolated'
  cumFundingAllTime?: number; // total cumulative funding
  cumFundingSinceOpen?: number; // funding since position opened
  notional?: number; // notional value
  percentage?: number; // portfolio percentage
  marginMode?: string; // margin mode
}

export interface HyperliquidPositionsResponse {
  positions: HyperliquidPosition[];
  count: number;
  environment?: HyperliquidEnvironment | string;
  source: 'cache' | 'live';
  cachedAt?: string;
}

export interface HyperliquidAccountState {
  marginSummary: {
    accountValue: number;
    totalMarginUsed: number;
    totalNtlPos: number; // total notional position value
    totalRawUsd: number; // total raw USD balance
  };
  crossMaintenanceMarginUsed: number;
  crossMarginSummary: {
    accountValue: number;
    totalMarginUsed: number;
    totalNtlPos: number;
    totalRawUsd: number;
  };
  positions: HyperliquidPosition[];
}

export interface SetupRequest {
  environment: HyperliquidEnvironment;
  privateKey: string;
  maxLeverage?: number;
  defaultLeverage?: number;
}

export interface SwitchEnvironmentRequest {
  targetEnvironment: HyperliquidEnvironment;
  confirm: boolean;
}

export interface ManualOrderRequest {
  symbol: string;
  is_buy: boolean;
  size: number;
  price: number;
  time_in_force: 'Ioc' | 'Gtc' | 'Alo';
  reduce_only?: boolean;
  leverage?: number;
  take_profit_price?: number;
  stop_loss_price?: number;
  environment?: HyperliquidEnvironment;
}

export interface OrderResult {
  status: 'filled' | 'resting';
  orderId: string;
  filledAmount: number;
  averagePrice: number;
}

// Response from manual order API
export interface ManualOrderResponse {
  account_id: number;
  environment: HyperliquidEnvironment;
  order_result: {
    main_order: OrderResult;
    tp_order?: {
      trigger_px: number;
      limit_px?: number;
      is_market: boolean;
    };
    sl_order?: {
      trigger_px: number;
      limit_px?: number;
      is_market: boolean;
    };
  };
}

export interface TestConnectionResponse {
  success: boolean;
  environment: HyperliquidEnvironment;
  address: string;
  balance?: number;
  message?: string;
}

export interface HyperliquidHealthResponse {
  status: string;
  service: string;
  encryptionConfigured: boolean;
  endpoints: {
    setup: string;
    balance: string;
    positions: string;
    test: string;
  };
}

export interface ApiError {
  detail: string;
}

export type PositionSide = 'LONG' | 'SHORT';

export interface PositionDisplay extends HyperliquidPosition {
  side: PositionSide;
  sizeAbs: number;
  pnlPercent: number;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface MarginStatus {
  level: 'healthy' | 'warning' | 'danger';
  color: string;
  message: string;
}

// Agent Wallet types
export type WalletKeyType = 'private_key' | 'agent_key';

export interface AgentWalletUpgradeRequest {
  environment: HyperliquidEnvironment;
  agentName?: string;
}

export interface AgentWalletConfigRequest {
  agentPrivateKey: string;
  masterWalletAddress: string;
  environment: HyperliquidEnvironment;
  maxLeverage?: number;
  defaultLeverage?: number;
}

export interface AgentWalletUpgradeResponse {
  success: boolean;
  message: string;
  agentAddress: string;
  masterWalletAddress: string;
  agentName: string;
  validUntil: string | null;
}

export interface AgentWalletConfigResponse {
  success: boolean;
  walletId: number;
  agentAddress: string;
  masterWalletAddress: string;
  validUntil: string | null;
  message: string;
}

export interface AgentWalletStatus {
  success: boolean;
  keyType: WalletKeyType;
  agentAddress?: string;
  masterWalletAddress?: string;
  agentName?: string;
  validUntil?: string | null;
  isExpired?: boolean;
  daysRemaining?: number;
  found?: boolean;
  message?: string;
}

export interface WalletUpgradeCheckResponse {
  success: boolean;
  needsUpgrade: {
    accountId: number;
    accountName: string;
    environment: HyperliquidEnvironment;
    walletAddress: string;
  }[];
  count: number;
}

export interface HyperliquidActionSummaryEntry {
  actionType: string;
  count: number;
  errors: number;
  lastOccurrence?: string | null;
}

export interface HyperliquidActionSummary {
  windowMinutes: number;
  accountId?: number;
  totalActions: number;
  generatedAt: string;
  latestActionAt?: string | null;
  byAction: HyperliquidActionSummaryEntry[];
}
