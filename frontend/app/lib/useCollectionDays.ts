import { useState, useEffect } from 'react'

// Cache per exchange
const cachedDays: Record<string, number> = {}
const fetchPromises: Record<string, Promise<number>> = {}

export function useCollectionDays(exchange: string = 'hyperliquid') {
  const [days, setDays] = useState<number | null>(cachedDays[exchange] ?? null)

  useEffect(() => {
    if (cachedDays[exchange] !== undefined) {
      setDays(cachedDays[exchange])
      return
    }

    if (!fetchPromises[exchange]) {
      fetchPromises[exchange] = fetch(`/api/system/collection-days?exchange=${exchange}`)
        .then(res => res.json())
        .then(data => {
          cachedDays[exchange] = data.days || 0
          return cachedDays[exchange]
        })
        .catch(() => {
          cachedDays[exchange] = 0
          return 0
        })
    }

    fetchPromises[exchange].then(d => setDays(d))
  }, [exchange])

  return days
}
