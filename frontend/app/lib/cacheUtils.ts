/**
 * Cache utilities for managing localStorage-based caching
 * Used for low-frequency data like API Usage and Trading Stats
 */

interface CachedData<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL_HOURS = 24; // Default cache TTL: 24 hours

/**
 * Get cached data from localStorage
 * Returns null if cache doesn't exist or is expired
 */
export function getCachedData<T>(key: string, ttlHours: number = CACHE_TTL_HOURS): T | null {
  if (typeof window === 'undefined') return null;

  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;

    const parsed: CachedData<T> = JSON.parse(cached);
    const now = Date.now();
    const ttlMs = ttlHours * 60 * 60 * 1000;

    if (now - parsed.timestamp > ttlMs) {
      // Cache expired
      localStorage.removeItem(key);
      return null;
    }

    return parsed.data;
  } catch (error) {
    console.error(`Failed to read cache for ${key}:`, error);
    return null;
  }
}

/**
 * Set cached data to localStorage with timestamp
 */
export function setCachedData<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;

  try {
    const cached: CachedData<T> = {
      data,
      timestamp: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(cached));
  } catch (error) {
    console.error(`Failed to write cache for ${key}:`, error);
  }
}

/**
 * Check if cache exists and is not expired
 */
export function isCacheValid(key: string, ttlHours: number = CACHE_TTL_HOURS): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const cached = localStorage.getItem(key);
    if (!cached) return false;

    const parsed: CachedData<unknown> = JSON.parse(cached);
    const now = Date.now();
    const ttlMs = ttlHours * 60 * 60 * 1000;

    return now - parsed.timestamp <= ttlMs;
  } catch {
    return false;
  }
}

/**
 * Get cache timestamp (for displaying "last updated" time)
 */
export function getCacheTimestamp(key: string): number | null {
  if (typeof window === 'undefined') return null;

  try {
    const cached = localStorage.getItem(key);
    if (!cached) return null;

    const parsed: CachedData<unknown> = JSON.parse(cached);
    return parsed.timestamp;
  } catch {
    return null;
  }
}

/**
 * Clear specific cache entry
 */
export function clearCache(key: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(key);
}

/**
 * Generate cache key for API Usage
 */
export function getApiUsageCacheKey(accountId: number, environment: string, exchange: string = 'hyperliquid'): string {
  return `api_usage_${accountId}_${environment}_${exchange}`;
}

/**
 * Generate cache key for Trading Stats
 */
export function getTradingStatsCacheKey(accountId: number, environment: string, exchange: string = 'hyperliquid'): string {
  return `trading_stats_${accountId}_${environment}_${exchange}`;
}
