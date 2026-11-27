import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkGfm from 'remark-gfm'
import { toast } from 'react-hot-toast'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import PacmanLoader from '@/components/ui/pacman-loader'
import { TradingAccount } from '@/lib/api'
import { pollAiStream } from '@/lib/pollAiStream'
import { Wrench, Send, Loader2 } from 'lucide-react'

// Exchange logos
const HyperliquidLogo = () => (
  <svg width="14" height="14" viewBox="0 0 144 144" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M144 71.6991C144 119.306 114.866 134.582 99.5156 120.98C86.8804 109.889 83.1211 86.4521 64.116 84.0456C39.9942 81.0113 37.9057 113.133 22.0334 113.133C3.5504 113.133 0 86.2428 0 72.4315C0 58.3063 3.96809 39.0542 19.736 39.0542C38.1146 39.0542 39.1588 66.5722 62.132 65.1073C85.0007 63.5379 85.4184 34.8689 100.247 22.6271C113.195 12.0593 144 23.4641 144 71.6991Z" fill="#50e3c2"/>
  </svg>
)

const BinanceLogo = () => (
  <img src="/static/binance_logo.svg" alt="Binance" width="14" height="14" />
)

const ExchangeBadge = ({ exchange, size = 'sm' }: { exchange: string; size?: 'sm' | 'xs' }) => {
  const isHyperliquid = exchange === 'hyperliquid'
  const textSize = size === 'xs' ? 'text-[10px]' : 'text-xs'
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${isHyperliquid ? 'bg-emerald-500/10 text-emerald-400' : 'bg-yellow-500/10 text-yellow-400'}`}>
      {isHyperliquid ? <HyperliquidLogo /> : <BinanceLogo />}
      <span className={textSize}>{isHyperliquid ? 'Hyperliquid' : 'Binance'}</span>
    </span>
  )
}

interface SignalConfig {
  name: string
  symbol: string
  description?: string
  exchange?: string  // Exchange: hyperliquid or binance
  _type?: 'signal' | 'pool'  // Type identifier from backend
  // For single signal
  trigger_condition?: {
    metric: string
    operator?: string
    threshold?: number
    time_window?: string
    direction?: string
    ratio_threshold?: number
    volume_threshold?: number
  }
  // For signal pool
  logic?: 'AND' | 'OR'
  signals?: Array<{
    metric?: string      // frontend field name
    indicator?: string   // AI output field name (same as metric)
    operator?: string
    threshold?: number
    time_window?: string
    // taker_volume composite signal fields
    direction?: string
    ratio_threshold?: number
    volume_threshold?: number
  }>
}

interface AnalysisEntry {
  type: 'reasoning' | 'tool_call' | 'tool_result'
  round?: number
  content?: string
  name?: string
  arguments?: Record<string, unknown>
  result?: Record<string, unknown>
}

interface ToolCallLogEntry {
  tool: string
  args: Record<string, unknown>
  result: string
}

interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  signal_configs?: SignalConfig[] | null
  isStreaming?: boolean
  statusText?: string
  analysisLog?: AnalysisEntry[]
  toolCallsLog?: ToolCallLogEntry[]
  reasoningSnapshot?: string | null
  isInterrupted?: boolean
  interruptedRound?: number
}

interface Conversation {
  id: number
  title: string
  created_at: string
  updated_at: string
}

interface CompressionPoint {
  message_id: number
  summary: string
  compressed_at: string
}

interface TokenUsage {
  current_tokens: number
  max_tokens: number
  usage_ratio: number
  show_warning: boolean
}

interface AiSignalChatModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateSignal: (config: SignalConfig) => Promise<boolean>  // Returns true on success
  onCreatePool: (config: SignalConfig) => Promise<boolean>    // Create signal pool
  onPreviewSignal: (config: SignalConfig) => void
  accounts: TradingAccount[]
  accountsLoading: boolean
}

// Component implementation continues below
export default function AiSignalChatModal({
  open,
  onOpenChange,
  onCreateSignal,
  onCreatePool,
  onPreviewSignal,
  accounts,
  accountsLoading,
}: AiSignalChatModalProps) {
  const { t } = useTranslation()
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loadingConversations, setLoadingConversations] = useState(false)
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [compressionPoints, setCompressionPoints] = useState<CompressionPoint[]>([])
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null)
  const [userInput, setUserInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [allSignalConfigs, setAllSignalConfigs] = useState<SignalConfig[]>([])

  // Filter AI accounts
  const aiAccounts = accounts.filter(acc => acc.account_type === 'AI')

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Load conversations when modal opens and select default AI account
  useEffect(() => {
    if (open) {
      loadConversations()
      // Select first AI account by default
      if (aiAccounts.length > 0 && !selectedAccountId) {
        setSelectedAccountId(aiAccounts[0].id)
      }
    }
  }, [open, accounts])

  // Load messages when conversation changes
  useEffect(() => {
    if (currentConversationId) {
      loadMessages(currentConversationId)
    }
  }, [currentConversationId])

  // Refresh token usage when trader changes (without reloading messages)
  useEffect(() => {
    if (!currentConversationId || !selectedAccountId) return
    const params = `?account_id=${selectedAccountId}`
    fetch(`/api/signals/ai-conversations/${currentConversationId}/messages${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.token_usage !== undefined) setTokenUsage(data.token_usage) })
      .catch(() => {})
  }, [selectedAccountId])

  const loadConversations = async () => {
    setLoadingConversations(true)
    try {
      const response = await fetch('/api/signals/ai-conversations')
      if (response.ok) {
        const data = await response.json()
        setConversations(data.conversations || [])
      }
    } catch (error) {
      console.error('Failed to load conversations:', error)
    } finally {
      setLoadingConversations(false)
    }
  }

  const loadMessages = async (conversationId: number) => {
    try {
      const params = selectedAccountId ? `?account_id=${selectedAccountId}` : ''
      const response = await fetch(`/api/signals/ai-conversations/${conversationId}/messages${params}`)
      if (response.ok) {
        const data = await response.json()
        const mappedMessages = (data.messages || []).map((m: any) => {
          // Handle both old format {type, name, arguments, result(object)} and new format {tool, args, result(string)}
          const rawLog = m.tool_calls_log || []
          const toolCalls = rawLog
            .filter((e: any) => e.tool || e.type === 'tool_call')
            .map((e: any) => ({
              tool: e.tool || e.name || 'unknown',
              args: e.args || e.arguments || {},
              result: typeof e.result === 'string' ? e.result : JSON.stringify(e.result || '')
            }))
          return {
            ...m,
            toolCallsLog: toolCalls,
            reasoningSnapshot: m.reasoning_snapshot || null,
            isInterrupted: m.is_complete === false,
          }
        })
        setMessages(mappedMessages)
        setCompressionPoints(data.compression_points || [])
        setTokenUsage(data.token_usage || null)
        // Collect all signal configs from messages
        const configs: SignalConfig[] = []
        ;(data.messages || []).forEach((m: Message) => {
          if (m.role === 'assistant' && m.signal_configs) {
            configs.push(...m.signal_configs)
          }
        })
        setAllSignalConfigs(configs)
      }
    } catch (error) {
      console.error('Failed to load messages:', error)
    }
  }

  const sendMessage = async () => {
    if (!userInput.trim() || !selectedAccountId) return
    const userMessage = userInput.trim()
    setUserInput('')
    setLoading(true)

    const tempUserMsgId = Date.now()
    const tempAssistantMsgId = tempUserMsgId + 1
    const tempUserMsg: Message = { id: tempUserMsgId, role: 'user', content: userMessage }
    const tempAssistantMsg: Message = {
      id: tempAssistantMsgId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      statusText: 'Connecting...',
    }
    setMessages(prev => [...prev, tempUserMsg, tempAssistantMsg])

    try {
      const response = await fetch('/api/signals/ai-chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccountId,
          userMessage: userMessage,
          conversationId: currentConversationId,
        }),
      })

      if (!response.ok) throw new Error('Failed to send message')

      let finalContent = ''
      let finalSignalConfigs: SignalConfig[] = []
      let finalConversationId: number | null = null
      let finalMessageId: number | null = null

      // Check if response is JSON (background task mode) or SSE stream
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        // Background task mode: poll for results
        const taskData = await response.json()
        const taskId = taskData.task_id

        const pollResult = await pollAiStream(taskId, {
          onChunk: (chunk) => {
            handleSSEEvent(chunk.event_type, chunk.data, tempAssistantMsgId, (updates) => {
              if (updates.content !== undefined) finalContent = updates.content
              if (updates.signalConfigs) finalSignalConfigs = updates.signalConfigs
              if (updates.conversationId) finalConversationId = updates.conversationId
              if (updates.messageId) finalMessageId = updates.messageId
            })
          },
          onTaskLost: () => {
            // Task buffer expired — reload conversation to get final result
            if (finalConversationId || currentConversationId) {
              loadMessages(finalConversationId || currentConversationId!)
            }
          },
        })

        if (pollResult.status === 'lost') return
      } else {
        // SSE stream mode (legacy fallback, not recommended)
        if (!response.body) throw new Error('No response body')
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let currentEventType = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEventType = line.slice(7).trim()
              continue
            }
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                handleSSEEvent(currentEventType, data, tempAssistantMsgId, (updates) => {
                  if (updates.content !== undefined) finalContent = updates.content
                  if (updates.signalConfigs) finalSignalConfigs = updates.signalConfigs
                  if (updates.conversationId) finalConversationId = updates.conversationId
                  if (updates.messageId) finalMessageId = updates.messageId
                })
              } catch {}
              currentEventType = ''
            }
          }
        }
      }

      // Finalize the message
      setMessages(prev => prev.map(m =>
        m.id === tempAssistantMsgId
          ? { ...m, content: finalContent, signal_configs: finalSignalConfigs, isStreaming: false, statusText: undefined }
          : m
      ))
      if (finalSignalConfigs.length > 0) {
        setAllSignalConfigs(prev => [...prev, ...finalSignalConfigs])
      }
      if (!currentConversationId && finalConversationId) {
        setCurrentConversationId(finalConversationId)
        loadConversations()
      }
    } catch (error) {
      console.error('Error sending message:', error)
      toast.error('Failed to send message')
      setMessages(prev => prev.filter(m => m.id !== tempUserMsgId && m.id !== tempAssistantMsgId))
    } finally {
      setLoading(false)
    }
  }

  const handleSSEEvent = (
    eventType: string,
    data: Record<string, unknown>,
    msgId: number,
    onUpdate: (updates: { content?: string; signalConfigs?: SignalConfig[]; conversationId?: number; messageId?: number }) => void
  ) => {
    if (eventType === 'conversation_created') {
      onUpdate({ conversationId: data.conversation_id as number })
    } else if (eventType === 'tool_round') {
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, statusText: `Round ${data.round}/${data.max_rounds}...` } : m
      ))
    } else if (eventType === 'retry') {
      toast(`Retrying... (attempt ${data.attempt}/${data.max_retries})`, { icon: '🔄' })
    } else if (eventType === 'status') {
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, statusText: data.message as string } : m
      ))
    } else if (eventType === 'reasoning') {
      const reasoning = data.content as string || ''
      const entry: AnalysisEntry = { type: 'reasoning', content: reasoning }
      setMessages(prev => prev.map(m =>
        m.id === msgId ? {
          ...m,
          statusText: `Thinking: ${reasoning.slice(0, 80)}...`,
          analysisLog: [...(m.analysisLog || []), entry]
        } : m
      ))
    } else if (eventType === 'content') {
      const content = data.content as string
      onUpdate({ content })
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, content, statusText: undefined } : m
      ))
    } else if (eventType === 'signal_config') {
      const config = data.config as SignalConfig
      if (config) {
        onUpdate({ signalConfigs: [config] })
      }
    } else if (eventType === 'done') {
      const content = data.content as string
      const signalConfigs = data.signal_configs as SignalConfig[]
      onUpdate({
        conversationId: data.conversation_id as number,
        messageId: data.message_id as number,
        content: content,
        signalConfigs: signalConfigs,
      })
      if (data.compression_points) setCompressionPoints(data.compression_points as CompressionPoint[])
      // Convert streaming analysisLog to stored formats for immediate display
      // Prefer backend done event data over local conversion
      setMessages(prev => prev.map(m => {
        if (m.id !== msgId) return m
        const tcLog = data.tool_calls_log as ToolCallLogEntry[] | null
        const rSnap = data.reasoning_snapshot as string | null
        if (tcLog || rSnap) {
          return { ...m, isStreaming: false, statusText: undefined, toolCallsLog: tcLog || [], reasoningSnapshot: rSnap }
        }
        // Fallback: convert from streaming analysisLog
        const log = m.analysisLog || []
        const toolCallsLog = log
          .filter(e => e.type === 'tool_call')
          .map(e => ({
            tool: e.name || 'unknown',
            args: e.arguments || {},
            result: typeof e.result === 'string' ? e.result : JSON.stringify(e.result || '')
          }))
        const reasoningParts = log.filter(e => e.type === 'reasoning').map(e => e.content || '')
        const reasoningSnapshot = reasoningParts.length > 0 ? reasoningParts.join('\n\n---\n\n') : null
        return { ...m, isStreaming: false, statusText: undefined, toolCallsLog, reasoningSnapshot }
      }))
    } else if (eventType === 'error') {
      toast.error(data.message as string || 'AI generation failed')
    } else if (eventType === 'interrupted') {
      onUpdate({ conversationId: data.conversation_id as number })
      setMessages(prev => prev.map(m =>
        m.id === msgId ? {
          ...m,
          isStreaming: false,
          isInterrupted: true,
          interruptedRound: data.round as number,
          statusText: ''
        } : m
      ))
    } else if (eventType === 'tool_call') {
      const entry: AnalysisEntry = {
        type: 'tool_call',
        name: data.name as string,
        arguments: data.arguments as Record<string, unknown>
      }
      setMessages(prev => prev.map(m =>
        m.id === msgId ? {
          ...m,
          statusText: `Calling ${data.name}...`,
          analysisLog: [...(m.analysisLog || []), entry]
        } : m
      ))
    } else if (eventType === 'tool_result') {
      const entry: AnalysisEntry = {
        type: 'tool_result',
        name: data.name as string,
        result: data.result as Record<string, unknown>
      }
      setMessages(prev => prev.map(m =>
        m.id === msgId ? {
          ...m,
          statusText: `Got result from ${data.name}`,
          analysisLog: [...(m.analysisLog || []), entry]
        } : m
      ))
    }
  }

  const startNewConversation = () => {
    setCurrentConversationId(null)
    setMessages([])
    setAllSignalConfigs([])
    setTokenUsage(null)
  }

  const getMetricLabel = (metric: string) => {
    const labels: Record<string, string> = {
      oi: 'Open Interest',
      oi_delta_percent: 'OI Delta %',
      cvd: 'CVD',
      funding_rate: 'Funding Rate',
      depth_ratio: 'Depth Ratio',
      order_imbalance: 'Order Imbalance',
      taker_buy_ratio: 'Taker Buy Ratio',
      taker_volume: 'Taker Volume',
    }
    return labels[metric] || metric
  }

  const getOperatorLabel = (op: string) => {
    const labels: Record<string, string> = {
      greater_than: '>',
      less_than: '<',
      greater_than_or_equal: '>=',
      less_than_or_equal: '<=',
      abs_greater_than: 'abs >',
    }
    return labels[op] || op
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[95vw] max-w-[1400px] h-[85vh] flex flex-col p-0"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <DialogTitle>{t('signals.aiGenerator.title', 'AI Signal Generator')}</DialogTitle>
              <span className="text-xs text-muted-foreground">
                {t('signals.aiGenerator.subtitle', '(Requires Function Call support to invoke analysis tools. Reasoning models work best.)')}
              </span>
            </div>
            {(loadingConversations || accountsLoading) && <PacmanLoader className="w-8 h-4" />}
          </div>
          <div className="flex items-center gap-4 mt-4">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">{t('signals.aiGenerator.aiTrader', 'AI Trader')}</label>
              <Select
                value={selectedAccountId?.toString()}
                onValueChange={(val) => setSelectedAccountId(parseInt(val))}
                disabled={accountsLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={accountsLoading ? t('signals.aiGenerator.loading', 'Loading...') : t('signals.aiGenerator.selectAiTrader', 'Select AI Trader')} />
                </SelectTrigger>
                <SelectContent>
                  {aiAccounts.map(acc => (
                    <SelectItem key={acc.id} value={acc.id.toString()}>
                      {acc.name} ({acc.model})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">{t('signals.aiGenerator.conversation', 'Conversation')}</label>
              <div className="flex gap-2">
                <Select
                  value={currentConversationId?.toString() || 'new'}
                  onValueChange={(val) => {
                    if (val === 'new') startNewConversation()
                    else setCurrentConversationId(parseInt(val))
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('signals.aiGenerator.newConversation', 'New Conversation')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">{t('signals.aiGenerator.newConversation', 'New Conversation')}</SelectItem>
                    {conversations.map(conv => (
                      <SelectItem key={conv.id} value={conv.id.toString()}>
                        {conv.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={startNewConversation}>New</Button>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 flex overflow-hidden">
          {/* Left: Chat Area (45%) */}
          <ChatArea
            messages={messages}
            compressionPoints={compressionPoints}
            tokenUsage={tokenUsage}
            userInput={userInput}
            setUserInput={setUserInput}
            loading={loading}
            sendMessage={sendMessage}
            messagesEndRef={messagesEndRef}
            hasAccount={!!selectedAccountId}
            t={t}
          />

          {/* Right: Signal Cards (55%) */}
          <SignalCardsPanel
            configs={allSignalConfigs}
            onPreview={onPreviewSignal}
            onCreate={onCreateSignal}
            onCreatePool={onCreatePool}
            getMetricLabel={getMetricLabel}
            getOperatorLabel={getOperatorLabel}
            t={t}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Chat Area Component
function ChatArea({
  messages, compressionPoints, tokenUsage, userInput, setUserInput, loading, sendMessage, messagesEndRef, hasAccount, t
}: {
  messages: Message[]
  compressionPoints: CompressionPoint[]
  tokenUsage: TokenUsage | null
  userInput: string
  setUserInput: (v: string) => void
  loading: boolean
  sendMessage: () => void
  messagesEndRef: React.RefObject<HTMLDivElement>
  hasAccount: boolean
  t: (key: string, fallback?: string) => string
}) {
  return (
    <div className="w-[45%] flex flex-col border-r">
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground py-8">
              <p className="text-sm">{t('signals.aiGenerator.describeSignal', 'Describe the signal you want to create')}</p>
              <p className="text-xs mt-2">{t('signals.aiGenerator.example', 'Example: "Create a signal for BTC when OI increases by 1%"')}</p>
            </div>
          )}
          {/* Memoize message list rendering to prevent re-renders on input typing.
              Without this, every keystroke re-renders all messages (including expensive
              ReactMarkdown parsing), causing noticeable input lag with long conversations. */}
          {useMemo(() => messages.map((msg) => {
            const compressionPoint = compressionPoints.find(cp => cp.message_id === msg.id)
            return (
              <div key={msg.id}>
                <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-lg p-3 ${
                    msg.role === 'user' ? 'bg-primary text-white' : 'bg-muted'
                  }`}>
                    <div className={`text-xs font-semibold mb-1 ${msg.role === 'user' ? 'text-white/70' : 'opacity-70'}`}>
                      {msg.role === 'user' ? t('signals.aiGenerator.you', 'You') : t('signals.aiGenerator.aiAssistant', 'AI Assistant')}
                      {msg.isStreaming && msg.statusText && (
                        <span className="ml-2 text-primary animate-pulse">({msg.statusText})</span>
                      )}
                    </div>
                    {/* Show analysis log during streaming */}
                    {msg.isStreaming && msg.analysisLog && msg.analysisLog.length > 0 && (
                      <div className="mb-2 text-xs bg-background/50 rounded p-2 max-h-32 overflow-y-auto">
                        {msg.analysisLog.slice(-5).map((entry, idx) => (
                          <div key={idx} className="mb-1 last:mb-0">
                            {entry.type === 'tool_call' && (
                              <span className="text-blue-500">→ {entry.name}({Object.entries(entry.arguments || {}).map(([k,v]) => `${k}=${v}`).join(', ')})</span>
                            )}
                            {entry.type === 'tool_result' && (
                              <span className="text-green-500">← {entry.name}: {JSON.stringify(entry.result).slice(0, 80)}...</span>
                            )}
                            {entry.type === 'reasoning' && (
                              <span className="text-gray-500 italic">{(entry.content || '').slice(0, 100)}...</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Tool calls log - above content, HyperAI style */}
                    {!msg.isStreaming && msg.toolCallsLog && msg.toolCallsLog.length > 0 && (
                      <details className="mb-3 text-xs border rounded-md">
                        <summary className="px-3 py-2 cursor-pointer bg-muted/50 hover:bg-muted font-medium flex items-center gap-1">
                          <Wrench className="w-3 h-3" />
                          {t('signals.aiGenerator.toolCalls', 'Tool calls')} ({msg.toolCallsLog.length})
                        </summary>
                        <div className="p-3 space-y-3 max-h-96 overflow-y-auto">
                          {msg.toolCallsLog.map((entry, idx) => {
                            const resultStr = typeof entry.result === 'string' ? entry.result : JSON.stringify(entry.result || '')
                            return (
                            <div key={idx} className="border-b pb-2 last:border-b-0 last:pb-0">
                              <div className="font-medium text-blue-600 dark:text-blue-400 mb-1">
                                {idx + 1}. {entry.tool}
                              </div>
                              {entry.args && Object.keys(entry.args).length > 0 && (
                                <div className="mb-1 ml-2 text-muted-foreground">
                                  {Object.entries(entry.args).map(([key, value]) => (
                                    <div key={key}>{key}: {JSON.stringify(value)}</div>
                                  ))}
                                </div>
                              )}
                              <div className="ml-2 text-green-600 dark:text-green-400">
                                Result: {resultStr.length > 200 ? resultStr.slice(0, 200) + '...' : resultStr}
                              </div>
                            </div>
                            )
                          })}
                        </div>
                      </details>
                    )}
                    {/* Reasoning snapshot - above content, HyperAI style */}
                    {!msg.isStreaming && msg.reasoningSnapshot && (
                      <details className="mb-3 text-xs border rounded-md">
                        <summary className="px-3 py-2 cursor-pointer bg-muted/50 hover:bg-muted font-medium">
                          {t('signals.aiGenerator.reasoningProcess', 'Reasoning process')}
                        </summary>
                        <div className="p-3 max-h-96 overflow-y-auto">
                          <pre className="whitespace-pre-wrap text-muted-foreground">{msg.reasoningSnapshot}</pre>
                        </div>
                      </details>
                    )}
                    <div className={`text-sm prose prose-sm max-w-none ${
                      msg.role === 'user' ? 'prose-invert text-white' : 'dark:prose-invert'
                    } [&_details]:bg-muted/50 [&_details]:rounded-lg [&_details]:p-2 [&_details]:mb-3 [&_details]:text-xs [&_summary]:cursor-pointer [&_summary]:font-medium [&_summary]:text-muted-foreground [&_details>div]:mt-2 [&_details>div]:max-h-64 [&_details>div]:overflow-y-auto [&_details>div]:whitespace-pre-wrap [&_details>div]:text-muted-foreground`}>
                      {msg.content ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{msg.content}</ReactMarkdown>
                      ) : msg.isStreaming ? (
                        <span className="text-muted-foreground italic">{t('signals.aiGenerator.generating', 'Generating...')}</span>
                      ) : null}
                    </div>
                    {msg.isInterrupted && !loading && (
                      <div className="mt-3 pt-3 border-t border-border/50">
                        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 mb-2">
                          <span>⚠️</span>
                          <span>{t('signals.aiGenerator.interruptedAt', { round: msg.interruptedRound, defaultValue: `Interrupted at round ${msg.interruptedRound}` })}</span>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setUserInput('Please continue from where you left off.')
                            setTimeout(() => sendMessage(), 100)
                          }}
                          className="text-xs"
                        >
                          {t('signals.aiGenerator.continueButton', 'Continue')}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                {compressionPoint && (
                  <div className="flex items-center gap-3 my-4 text-xs text-muted-foreground">
                    <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
                    <span className="px-2 py-1 bg-muted rounded text-[10px]">
                      {t('signals.aiGenerator.compressionPoint', 'Context compressed')}
                    </span>
                    <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
                  </div>
                )}
              </div>
            )
          }), [messages, compressionPoints, loading])}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>
      <div className="px-4 pb-4 pt-2">
        <div className="relative">
          <textarea
            placeholder={t('signals.aiGenerator.inputPlaceholder', 'Describe your signal...')}
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                sendMessage()
              }
            }}
            disabled={loading || !hasAccount}
            className="w-full min-h-[80px] max-h-[200px] rounded-xl border border-input bg-transparent px-4 py-3 pb-12 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-y"
            rows={3}
          />
          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            {tokenUsage?.show_warning && (
              <p className="text-xs text-amber-500">
                {t('signals.contextWarning', 'Context remaining: {{percent}}% · Compressing soon', { percent: Math.max(0, Math.round((1 - tokenUsage.usage_ratio) * 100)) })}
              </p>
            )}
            <Button onClick={sendMessage} disabled={loading || !userInput.trim() || !hasAccount} size="icon" className="rounded-full h-8 w-8 shrink-0">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Signal Cards Panel Component
function SignalCardsPanel({
  configs, onPreview, onCreate, onCreatePool, getMetricLabel, getOperatorLabel, t
}: {
  configs: SignalConfig[]
  onPreview: (config: SignalConfig) => void
  onCreate: (config: SignalConfig) => Promise<boolean>
  onCreatePool: (config: SignalConfig) => Promise<boolean>
  getMetricLabel: (m: string) => string
  getOperatorLabel: (o: string) => string
  t: (key: string, fallback?: string) => string
}) {
  // Track which signals/pools are being created and which have been created
  const [creatingSignals, setCreatingSignals] = useState<Set<string>>(new Set())
  const [createdSignals, setCreatedSignals] = useState<Set<string>>(new Set())

  const handleCreate = async (config: SignalConfig, isPool: boolean) => {
    const signalKey = config.name || `signal-${configs.indexOf(config)}`
    setCreatingSignals(prev => new Set(prev).add(signalKey))
    try {
      const success = isPool ? await onCreatePool(config) : await onCreate(config)
      if (success) {
        setCreatedSignals(prev => new Set(prev).add(signalKey))
      }
    } finally {
      setCreatingSignals(prev => {
        const next = new Set(prev)
        next.delete(signalKey)
        return next
      })
    }
  }

  return (
    <div className="w-[55%] flex flex-col bg-muted/30">
      <div className="p-4 border-b">
        <h3 className="text-sm font-semibold">{t('signals.aiGenerator.generatedSignals', 'Generated Signals')}</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {configs.length > 0
            ? t('signals.aiGenerator.signalsCount', '{{count}} signal(s) generated').replace('{{count}}', configs.length.toString())
            : t('signals.aiGenerator.signalsWillAppear', 'AI-generated signals will appear here')}
        </p>
      </div>
      <ScrollArea className="flex-1 p-4">
        {configs.length > 0 ? (
          <div className="space-y-4">
            {configs.map((config, idx) => {
              const signalKey = config.name || `signal-${idx}`
              const isPool = config._type === 'pool'
              return isPool ? (
                <SignalPoolCard
                  key={idx}
                  config={config}
                  onCreate={() => handleCreate(config, true)}
                  getMetricLabel={getMetricLabel}
                  getOperatorLabel={getOperatorLabel}
                  isCreating={creatingSignals.has(signalKey)}
                  isCreated={createdSignals.has(signalKey)}
                  t={t}
                />
              ) : (
                <SignalCard
                  key={idx}
                  config={config}
                  onPreview={() => onPreview(config)}
                  onCreate={() => handleCreate(config, false)}
                  getMetricLabel={getMetricLabel}
                  getOperatorLabel={getOperatorLabel}
                  isCreating={creatingSignals.has(signalKey)}
                  isCreated={createdSignals.has(signalKey)}
                  t={t}
                />
              )
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <p className="text-sm">{t('signals.aiGenerator.noSignalsYet', 'No signals generated yet')}</p>
              <p className="text-xs mt-2">{t('signals.aiGenerator.startConversation', 'Start a conversation to generate signals')}</p>
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

// Individual Signal Card Component
function SignalCard({
  config, onPreview, onCreate, getMetricLabel, getOperatorLabel, isCreating, isCreated, t
}: {
  config: SignalConfig
  onPreview: () => void
  onCreate: () => void
  getMetricLabel: (m: string) => string
  getOperatorLabel: (o: string) => string
  isCreating?: boolean
  isCreated?: boolean
  t: (key: string, fallback?: string) => string
}) {
  const cond = config.trigger_condition || {}
  const isTakerVolume = cond.metric === 'taker_volume'
  const hasValidMetric = cond.metric && typeof cond.metric === 'string'

  // Check if signal config is valid
  const isValid = hasValidMetric && (
    isTakerVolume || (cond.operator && cond.threshold !== undefined)
  )

  return (
    <div className={`rounded-lg border bg-card p-4 ${!isValid ? 'border-destructive/50' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-sm">{config.name || t('signals.aiGenerator.unnamedSignal', 'Unnamed Signal')}</h4>
            <ExchangeBadge exchange={config.exchange || 'hyperliquid'} size="sm" />
          </div>
          <p className="text-xs text-muted-foreground">{config.symbol || t('signals.aiGenerator.noSymbol', 'No symbol')}</p>
        </div>
        {hasValidMetric ? (
          <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
            {getMetricLabel(cond.metric)}
          </span>
        ) : (
          <span className="text-xs bg-destructive/10 text-destructive px-2 py-1 rounded">
            {t('signals.aiGenerator.invalidConfig', 'Invalid Config')}
          </span>
        )}
      </div>
      {config.description && (
        <p className="text-xs text-muted-foreground mb-3">{config.description}</p>
      )}
      <div className="bg-muted/50 rounded p-2 mb-3">
        <div className="text-xs space-y-1">
          {!hasValidMetric ? (
            <div className="text-destructive">{t('signals.aiGenerator.missingMetric', 'Missing metric configuration')}</div>
          ) : isTakerVolume ? (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('signals.aiGenerator.direction', 'Direction')}:</span>
                <span>{cond.direction || 'any'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('signals.aiGenerator.ratioThreshold', 'Ratio Threshold')}:</span>
                <span>{cond.ratio_threshold || 1.5}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('signals.aiGenerator.volumeThreshold', 'Volume Threshold')}:</span>
                <span>{cond.volume_threshold || 0}</span>
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('signals.aiGenerator.metric', 'Metric')}:</span>
                <span>{getMetricLabel(cond.metric)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('signals.aiGenerator.condition', 'Condition')}:</span>
                <span>{getOperatorLabel(cond.operator || '')} {cond.threshold}</span>
              </div>
            </>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('signals.aiGenerator.timeWindow', 'Time Window')}:</span>
            <span>{cond.time_window || '5m'}</span>
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={onPreview} disabled={!isValid}>
          {t('signals.aiGenerator.preview', 'Preview')}
        </Button>
        {isCreated ? (
          <Button size="sm" className="flex-1" variant="secondary" disabled>
            <span className="text-green-600">✓ {t('signals.aiGenerator.created', 'Created')}</span>
          </Button>
        ) : (
          <Button size="sm" className="flex-1" onClick={onCreate} disabled={!isValid || isCreating}>
            {isCreating ? t('signals.aiGenerator.creating', 'Creating...') : t('signals.aiGenerator.createSignal', 'Create Signal')}
          </Button>
        )}
      </div>
    </div>
  )
}

// Signal Pool Card Component
function SignalPoolCard({
  config, onCreate, getMetricLabel, getOperatorLabel, isCreating, isCreated, t
}: {
  config: SignalConfig
  onCreate: () => void
  getMetricLabel: (m: string) => string
  getOperatorLabel: (o: string) => string
  isCreating?: boolean
  isCreated?: boolean
  t: (key: string, fallback?: string) => string
}) {
  const signals = config.signals || []
  // Validate signals - support both 'metric' and 'indicator' field names (AI uses 'indicator')
  // taker_volume uses direction/ratio_threshold/volume_threshold instead of operator/threshold
  const isValid = signals.length > 0 && signals.every(s => {
    const metricName = s.metric || s.indicator  // AI outputs 'indicator', frontend uses 'metric'
    if (metricName === 'taker_volume') {
      return s.direction && s.ratio_threshold !== undefined && s.volume_threshold !== undefined
    }
    return metricName && s.operator && s.threshold !== undefined
  })

  return (
    <div className={`rounded-lg border bg-card p-4 ${!isValid ? 'border-destructive/50' : 'border-primary/50'}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-sm">{config.name || t('signals.aiGenerator.unnamedPool', 'Unnamed Pool')}</h4>
            <ExchangeBadge exchange={config.exchange || 'hyperliquid'} size="sm" />
          </div>
          <p className="text-xs text-muted-foreground">{config.symbol || t('signals.aiGenerator.noSymbol', 'No symbol')}</p>
        </div>
        <span className="text-xs bg-primary/20 text-primary px-2 py-1 rounded font-medium">
          {t('signals.aiGenerator.pool', 'Pool')} ({config.logic || 'AND'})
        </span>
      </div>
      {config.description && (
        <p className="text-xs text-muted-foreground mb-3">{config.description}</p>
      )}
      <div className="bg-muted/50 rounded p-2 mb-3">
        <div className="text-xs font-medium mb-2">
          {t('signals.aiGenerator.signalsCombined', '{{count}} Signal(s) Combined with {{logic}}:')
            .replace('{{count}}', signals.length.toString())
            .replace('{{logic}}', config.logic || 'AND')}
        </div>
        <div className="space-y-1">
          {signals.map((sig, idx) => {
            const metricName = sig.metric || sig.indicator  // AI outputs 'indicator', frontend uses 'metric'
            return (
              <div key={idx} className="text-xs flex items-center gap-2 bg-background/50 rounded px-2 py-1">
                <span className="font-medium">{getMetricLabel(metricName || '')}</span>
                {metricName === 'taker_volume' ? (
                  <span className="text-muted-foreground">
                    {sig.direction?.toUpperCase()} ≥{sig.ratio_threshold}x, ≥${((sig.volume_threshold || 0) / 1000000).toFixed(1)}M
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {getOperatorLabel(sig.operator || '')} {sig.threshold}
                  </span>
                )}
                <span className="text-muted-foreground">({sig.time_window || '5m'})</span>
              </div>
            )
          })}
        </div>
      </div>
      <div className="flex gap-2">
        {isCreated ? (
          <Button size="sm" className="flex-1" variant="secondary" disabled>
            <span className="text-green-600">✓ {t('signals.aiGenerator.poolCreated', 'Pool Created')}</span>
          </Button>
        ) : (
          <Button size="sm" className="flex-1" onClick={onCreate} disabled={!isValid || isCreating}>
            {isCreating ? t('signals.aiGenerator.creating', 'Creating...') : t('signals.aiGenerator.createPool', 'Create Signal Pool')}
          </Button>
        )}
      </div>
    </div>
  )
}
