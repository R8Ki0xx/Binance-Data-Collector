/**
 * Unified AI stream polling utility.
 *
 * Replaces inline while(true) loops across all AI chat components with
 * consistent error handling, 404 recovery, network retry with backoff,
 * and a maximum polling duration guard.
 */

export interface PollChunk {
  event_type: string
  data: Record<string, any>
  timestamp?: number
}

export interface PollOptions {
  /** Polling interval in ms (default 500) */
  interval?: number
  /** Max polling duration in ms (default 30 minutes) */
  maxDuration?: number
  /** Called for each new chunk */
  onChunk: (chunk: PollChunk) => void
  /**
   * Called when the task is lost (404 after buffer expiry).
   * The component should treat this as "task finished but we missed the result"
   * and reload conversation history.
   */
  onTaskLost?: () => void
  /** Called on unrecoverable error */
  onError?: (error: Error) => void
}

export interface PollResult {
  status: 'completed' | 'error' | 'timeout' | 'lost' | 'network_error'
  result?: Record<string, any>
  error?: string
}

const DEFAULT_INTERVAL = 500
const DEFAULT_MAX_DURATION = 30 * 60 * 1000 // 30 minutes
const MAX_CONSECUTIVE_404 = 3
const MAX_NETWORK_RETRIES = 10
const NETWORK_RETRY_BASE_MS = 1000

/**
 * Poll an AI stream task until completion, error, or timeout.
 *
 * Handles:
 * - Normal completion (status=completed/error from backend)
 * - Task lost (consecutive 404s → buffer expired, task finished but missed)
 * - Network errors (temporary disconnects with exponential backoff)
 * - Timeout (max polling duration exceeded)
 */
export async function pollAiStream(
  taskId: string,
  options: PollOptions
): Promise<PollResult> {
  const interval = options.interval ?? DEFAULT_INTERVAL
  const maxDuration = options.maxDuration ?? DEFAULT_MAX_DURATION
  const startTime = Date.now()
  let offset = 0
  let consecutive404 = 0
  let consecutiveNetworkErrors = 0

  while (true) {
    // Timeout guard
    if (Date.now() - startTime > maxDuration) {
      return { status: 'timeout', error: 'Polling exceeded max duration' }
    }

    await new Promise(resolve => setTimeout(resolve, interval))

    try {
      const res = await fetch(`/api/ai-stream/${taskId}?offset=${offset}`)

      if (res.status === 404) {
        consecutive404++
        if (consecutive404 >= MAX_CONSECUTIVE_404) {
          // Task buffer expired — task likely finished but we missed it
          options.onTaskLost?.()
          return { status: 'lost' }
        }
        continue
      }

      if (!res.ok) {
        throw new Error(`Poll returned ${res.status}`)
      }

      // Reset counters on successful response
      consecutive404 = 0
      consecutiveNetworkErrors = 0

      const pollData = await res.json()
      const { chunks, status, next_offset, result, error } = pollData

      // Process new chunks
      for (const chunk of (chunks || [])) {
        options.onChunk(chunk)
      }

      offset = next_offset ?? (offset + (chunks?.length || 0))

      if (status === 'completed') {
        return { status: 'completed', result }
      }
      if (status === 'error') {
        return { status: 'error', error: error || 'Task failed' }
      }
    } catch (e) {
      consecutiveNetworkErrors++
      if (consecutiveNetworkErrors >= MAX_NETWORK_RETRIES) {
        const err = e instanceof Error ? e : new Error(String(e))
        options.onError?.(err)
        return { status: 'network_error', error: err.message }
      }
      // Exponential backoff: 1s, 2s, 4s, 8s... capped at 30s
      const backoff = Math.min(
        NETWORK_RETRY_BASE_MS * Math.pow(2, consecutiveNetworkErrors - 1),
        30000
      )
      await new Promise(r => setTimeout(r, backoff))
    }
  }
}
