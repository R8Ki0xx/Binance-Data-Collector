const CONTACT_API_URL = 'https://www.akooi.com/api/config/contact'
const CACHE_KEY = 'contact_config'
const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours

export interface ContactItem {
  url: string | null
  enabled: boolean
}

export interface ContactConfig {
  twitter: ContactItem
  telegram: ContactItem
  community: ContactItem
}

interface CachedData {
  data: ContactConfig
  timestamp: number
}

const DEFAULT_CONFIG: ContactConfig = {
  twitter: { url: 'https://x.com/GptHammer3309', enabled: true },
  telegram: { url: 'https://t.me/hammergpt', enabled: true },
  community: { url: null, enabled: false },
}

function getFromCache(): ContactConfig | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY)
    if (!cached) return null
    const { data, timestamp }: CachedData = JSON.parse(cached)
    if (Date.now() - timestamp > CACHE_DURATION) {
      localStorage.removeItem(CACHE_KEY)
      return null
    }
    return data
  } catch {
    return null
  }
}

function saveToCache(data: ContactConfig): void {
  try {
    const cached: CachedData = { data, timestamp: Date.now() }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached))
  } catch {
    // Ignore storage errors
  }
}

export async function getContactConfig(): Promise<ContactConfig> {
  // Try cache first
  const cached = getFromCache()
  if (cached) return cached

  // Fetch from API
  try {
    const response = await fetch(CONTACT_API_URL, { cache: 'no-store' })
    if (!response.ok) throw new Error('API error')
    const data: ContactConfig = await response.json()
    saveToCache(data)
    return data
  } catch {
    // Return default on error
    return DEFAULT_CONFIG
  }
}
