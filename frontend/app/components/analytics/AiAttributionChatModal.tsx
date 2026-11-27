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

interface DiagnosisResult {
  _type: 'diagnosis' | 'prompt_suggestion'
  title?: string
  severity?: string
  metrics?: Record<string, unknown>
  description?: string
  current_behavior?: string
  suggested_change?: string
  reason?: string
  roundIndex?: number  // Which conversation round this result belongs to
}

interface AnalysisEntry {
  type: 'reasoning' | 'tool_call' | 'tool_result'
  content?: string
  name?: string
  arguments?: Record<string, unknown>
  result?: Record<string, unknown>
}

interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  diagnosis_results?: DiagnosisResult[]
  isStreaming?: boolean
  statusText?: string
  analysisLog?: AnalysisEntry[]
  reasoning_snapshot?: string  // Stored reasoning from history
  tool_calls_log?: AnalysisEntry[]  // Stored tool calls log from history (renamed from analysis_log)
  is_complete?: boolean  // False if message was interrupted
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

interface AiAttributionChatModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: TradingAccount[]
  accountsLoading: boolean
}

export default function AiAttributionChatModal({
  open,
  onOpenChange,
  accounts,
  accountsLoading,
}: AiAttributionChatModalProps) {
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
  const [allDiagnosisResults, setAllDiagnosisResults] = useState<DiagnosisResult[]>([])
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0)

  const aiAccounts = accounts.filter(acc => acc.account_type === 'AI')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  useEffect(() => {
    if (open) {
      loadConversations()
      if (aiAccounts.length > 0 && !selectedAccountId) {
        setSelectedAccountId(aiAccounts[0].id)
      }
    }
  }, [open, accounts])

  useEffect(() => {
    if (currentConversationId) {
      loadMessages(currentConversationId)
    }
  }, [currentConversationId])

  // Refresh token usage when trader changes (without reloading messages)
  useEffect(() => {
    if (!currentConversationId || !selectedAccountId) return
    const params = `?account_id=${selectedAccountId}`
    fetch(`/api/analytics/ai-attribution/conversations/${currentConversationId}/messages${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.token_usage !== undefined) setTokenUsage(data.token_usage) })
      .catch(() => {})
  }, [selectedAccountId])

  const loadConversations = async () => {
    setLoadingConversations(true)
    try {
      const response = await fetch('/api/analytics/ai-attribution/conversations')
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
      const response = await fetch(`/api/analytics/ai-attribution/conversations/${conversationId}/messages${params}`)
      if (response.ok) {
        const data = await response.json()
        // Map tool_calls_log from API to analysisLog for display
        // Handle both old format {type, name, arguments, result} and new format {tool, args, result}
        const mappedMessages = (data.messages || []).map((m: any) => {
          const rawLog = m.tool_calls_log || []
          const analysisLog = rawLog
            .filter((e: any) => e.tool || e.type === 'tool_call')
            .map((e: any) => ({
              type: 'tool_call' as const,
              name: e.tool || e.name || 'unknown',
              arguments: e.args || e.arguments || {},
              result: typeof e.result === 'string' ? JSON.parse(e.result || '{}') : (e.result || {})
            }))
          return {
            ...m,
            analysisLog: analysisLog.length > 0 ? analysisLog : undefined,
            isInterrupted: m.is_complete === false,
          }
        })
        setMessages(mappedMessages)
        setCompressionPoints(data.compression_points || [])
        setTokenUsage(data.token_usage || null)
        // Assign roundIndex to each message's diagnosis results based on message order
        const results: DiagnosisResult[] = []
        let roundIdx = 0
        mappedMessages.forEach((m: Message) => {
          if (m.role === 'assistant' && m.diagnosis_results && m.diagnosis_results.length > 0) {
            // Add roundIndex to each result from this message
            const resultsWithRound = m.diagnosis_results.map((r: DiagnosisResult) => ({ ...r, roundIndex: roundIdx }))
            results.push(...resultsWithRound)
            roundIdx++
          }
        })
        // Reverse to show newest first
        setAllDiagnosisResults(results.reverse())
        setCurrentRoundIndex(roundIdx)
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
      const response = await fetch('/api/analytics/ai-attribution/chat-stream', {
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
      let finalDiagnosisResults: DiagnosisResult[] = []
      let finalConversationId: number | null = null

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
              if (updates.diagnosisResults) finalDiagnosisResults = updates.diagnosisResults
              if (updates.conversationId) finalConversationId = updates.conversationId
            })
          },
          onTaskLost: () => {
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
                  if (updates.diagnosisResults) finalDiagnosisResults = updates.diagnosisResults
                  if (updates.conversationId) finalConversationId = updates.conversationId
                })
              } catch {}
              currentEventType = ''
            }
          }
        }
      }

      setMessages(prev => prev.map(m =>
        m.id === tempAssistantMsgId
          ? { ...m, content: finalContent, diagnosis_results: finalDiagnosisResults, isStreaming: false }
          : m
      ))
      if (finalDiagnosisResults.length > 0) {
        // Add roundIndex to each result and prepend to array (newest first)
        const resultsWithRound = finalDiagnosisResults.map(r => ({ ...r, roundIndex: currentRoundIndex }))
        setAllDiagnosisResults(prev => [...resultsWithRound, ...prev])
        setCurrentRoundIndex(prev => prev + 1)
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
    onUpdate: (updates: { content?: string; diagnosisResults?: DiagnosisResult[]; conversationId?: number }) => void
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
      const entry: AnalysisEntry = { type: 'reasoning', content: data.content as string }
      setMessages(prev => prev.map(m =>
        m.id === msgId ? {
          ...m,
          statusText: `Thinking...`,
          analysisLog: [...(m.analysisLog || []), entry]
        } : m
      ))
    } else if (eventType === 'content') {
      onUpdate({ content: data.content as string })
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, content: data.content as string, statusText: undefined } : m
      ))
    } else if (eventType === 'done') {
      onUpdate({
        conversationId: data.conversation_id as number,
        content: data.content as string,
        diagnosisResults: data.diagnosis_results as DiagnosisResult[],
      })
      if (data.compression_points) setCompressionPoints(data.compression_points as CompressionPoint[])
      // Convert streaming analysisLog to stored format for immediate display
      // Prefer backend done event data over local conversion
      setMessages(prev => prev.map(m => {
        if (m.id !== msgId) return m
        const backendTcLog = data.tool_calls_log as AnalysisEntry[] | null
        const backendRSnap = data.reasoning_snapshot as string | null
        if (backendTcLog || backendRSnap) {
          const analysisLog = backendTcLog
            ? backendTcLog.map((e: any) => ({ type: 'tool_call' as const, name: e.tool || e.name, arguments: e.args || e.arguments, result: e.result }))
            : (m.analysisLog || []).filter(e => e.type === 'tool_call')
          return { ...m, isStreaming: false, statusText: undefined, analysisLog: analysisLog.length > 0 ? analysisLog : undefined, reasoning_snapshot: backendRSnap || undefined }
        }
        // Fallback: convert from streaming analysisLog
        const log = m.analysisLog || []
        const toolCalls = log.filter(e => e.type === 'tool_call')
        const reasoningParts = log.filter(e => e.type === 'reasoning').map(e => e.content || '')
        return {
          ...m,
          isStreaming: false,
          statusText: undefined,
          analysisLog: toolCalls.length > 0 ? toolCalls : undefined,
          reasoning_snapshot: reasoningParts.length > 0 ? reasoningParts.join('\n\n---\n\n') : undefined,
        }
      }))
    } else if (eventType === 'error') {
      toast.error(data.message as string || 'Analysis failed')
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
      const entry: AnalysisEntry = { type: 'tool_call', name: data.name as string, arguments: data.arguments as Record<string, unknown> }
      setMessages(prev => prev.map(m =>
        m.id === msgId ? {
          ...m,
          statusText: `Calling ${data.name}...`,
          analysisLog: [...(m.analysisLog || []), entry]
        } : m
      ))
    } else if (eventType === 'tool_result') {
      const entry: AnalysisEntry = { type: 'tool_result', name: data.name as string, result: data.result as Record<string, unknown> }
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
    setAllDiagnosisResults([])
    setCurrentRoundIndex(0)
    setTokenUsage(null)
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
              <DialogTitle>{t('attribution.aiAnalysis.title', 'AI Strategy Diagnosis')}</DialogTitle>
              <span className="text-xs text-muted-foreground">
                {t('attribution.aiAnalysis.subtitle', '(Analyze trading performance and get improvement suggestions)')}
              </span>
            </div>
            {(loadingConversations || accountsLoading) && <PacmanLoader className="w-8 h-4" />}
          </div>
          <div className="flex items-center gap-4 mt-4">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">{t('attribution.aiAnalysis.aiTrader', 'AI Trader')}</label>
              <Select
                value={selectedAccountId?.toString()}
                onValueChange={(val) => setSelectedAccountId(parseInt(val))}
                disabled={accountsLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('attribution.aiAnalysis.selectAiTrader', 'Select AI Trader')} />
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
              <label className="text-xs text-muted-foreground mb-1 block">{t('attribution.aiAnalysis.conversation', 'Conversation')}</label>
              <div className="flex gap-2">
                <Select
                  value={currentConversationId?.toString() || 'new'}
                  onValueChange={(val) => {
                    if (val === 'new') startNewConversation()
                    else setCurrentConversationId(parseInt(val))
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('attribution.aiAnalysis.newConversation', 'New Conversation')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">{t('attribution.aiAnalysis.newConversation', 'New Conversation')}</SelectItem>
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

          {/* Right: Diagnosis Cards (55%) */}
          <DiagnosisCardsPanel
            results={allDiagnosisResults}
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
              <p className="text-sm">{t('attribution.aiAnalysis.describeAnalysis', 'Describe what you want to analyze')}</p>
              <p className="text-xs mt-2">{t('attribution.aiAnalysis.example', 'Example: "Analyze my trading performance in the last 30 days"')}</p>
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
                      {msg.role === 'user' ? t('attribution.aiAnalysis.you', 'You') : t('attribution.aiAnalysis.aiAssistant', 'AI Assistant')}
                      {msg.isStreaming && msg.statusText && (
                        <span className="ml-2 text-primary animate-pulse">({msg.statusText})</span>
                      )}
                    </div>
                    {/* Show analysis log - streaming: compact inline, history: HyperAI-style details */}
                    {msg.isStreaming && msg.analysisLog && msg.analysisLog.length > 0 && (
                      <div className="mb-2 text-xs bg-background/50 rounded p-2 max-h-32 overflow-y-auto">
                        {msg.analysisLog.slice(-5).map((entry, idx) => (
                          <div key={idx} className="mb-1 last:mb-0">
                            {entry.type === 'tool_call' && (
                              <span className="text-blue-500">→ {entry.name}</span>
                            )}
                            {entry.type === 'tool_result' && (
                              <span className="text-green-500">← {entry.name}: done</span>
                            )}
                            {entry.type === 'reasoning' && (
                              <span className="text-gray-500 italic">{(entry.content || '').slice(0, 100)}...</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Historical Tool calls - above content, HyperAI style */}
                    {!msg.isStreaming && msg.analysisLog && msg.analysisLog.filter(e => e.type === 'tool_call').length > 0 && (
                      <details className="mb-3 text-xs border rounded-md">
                        <summary className="px-3 py-2 cursor-pointer bg-muted/50 hover:bg-muted font-medium flex items-center gap-1">
                          <Wrench className="w-3 h-3" />
                          Tool calls ({msg.analysisLog.filter(e => e.type === 'tool_call').length})
                        </summary>
                        <div className="p-3 space-y-3 max-h-96 overflow-y-auto">
                          {msg.analysisLog.filter(e => e.type === 'tool_call').map((entry, idx) => (
                            <div key={idx} className="border-b last:border-0 pb-2 last:pb-0">
                              <div className="font-medium text-blue-500">{entry.name}</div>
                              {entry.arguments && (
                                <pre className="mt-1 text-muted-foreground whitespace-pre-wrap break-all">{JSON.stringify(entry.arguments, null, 2)}</pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                    {/* Historical Reasoning - above content, HyperAI style */}
                    {!msg.isStreaming && msg.reasoning_snapshot && (
                      <details className="mb-3 text-xs border rounded-md">
                        <summary className="px-3 py-2 cursor-pointer bg-muted/50 hover:bg-muted font-medium">
                          Reasoning process
                        </summary>
                        <div className="p-3 max-h-96 overflow-y-auto">
                          <pre className="whitespace-pre-wrap text-muted-foreground">{msg.reasoning_snapshot}</pre>
                        </div>
                      </details>
                    )}
                    <div className={`text-sm prose prose-sm max-w-none ${
                      msg.role === 'user' ? 'prose-invert text-white' : 'dark:prose-invert'
                    } [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:bg-muted [&_td]:border [&_td]:border-border [&_td]:p-2`}>
                      {msg.content ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{msg.content}</ReactMarkdown>
                      ) : msg.isStreaming ? (
                        <span className="text-muted-foreground italic">{t('attribution.aiAnalysis.analyzing', 'Analyzing...')}</span>
                      ) : null}
                    </div>
                    {msg.isInterrupted && !loading && (
                      <div className="mt-3 pt-3 border-t border-border/50">
                        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 mb-2">
                          <span>⚠️</span>
                          <span>{t('attribution.aiAnalysis.interruptedAt', { round: msg.interruptedRound, defaultValue: `Interrupted at round ${msg.interruptedRound}` })}</span>
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
                          {t('attribution.aiAnalysis.continueButton', 'Continue')}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                {compressionPoint && (
                  <div className="flex items-center gap-3 my-4 text-xs text-muted-foreground">
                    <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
                    <span className="px-2 py-1 bg-muted rounded text-[10px]">
                      {t('attribution.aiAnalysis.compressionPoint', 'Context compressed')}
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
            placeholder={t('attribution.aiAnalysis.inputPlaceholder', 'Describe what you want to analyze...')}
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
                {t('attribution.contextWarning', 'Context remaining: {{percent}}% · Compressing soon', { percent: Math.max(0, Math.round((1 - tokenUsage.usage_ratio) * 100)) })}
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

// Diagnosis Cards Panel Component
function DiagnosisCardsPanel({
  results, t
}: {
  results: DiagnosisResult[]
  t: (key: string, fallback?: string) => string
}) {
  // Group results by roundIndex
  const groupedResults = results.reduce((acc, result) => {
    const round = result.roundIndex ?? 0
    if (!acc[round]) acc[round] = []
    acc[round].push(result)
    return acc
  }, {} as Record<number, DiagnosisResult[]>)

  // Get sorted round indices (newest first, so descending)
  const sortedRounds = Object.keys(groupedResults).map(Number).sort((a, b) => b - a)

  return (
    <div className="w-[55%] flex flex-col bg-muted/30">
      <div className="p-4 border-b">
        <h3 className="text-sm font-semibold">{t('attribution.aiAnalysis.diagnosisResults', 'Diagnosis Results')}</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {results.length > 0
            ? t('attribution.aiAnalysis.resultsCount', '{{count}} result(s)').replace('{{count}}', results.length.toString())
            : t('attribution.aiAnalysis.resultsWillAppear', 'AI diagnosis results will appear here')}
        </p>
      </div>
      <ScrollArea className="flex-1 p-4">
        {results.length > 0 ? (
          <div className="space-y-4">
            {sortedRounds.map((roundIdx, groupIndex) => (
              <div key={roundIdx}>
                {groupIndex > 0 && (
                  <div className="flex items-center gap-2 my-4">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground">Round {roundIdx + 1}</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                )}
                {groupIndex === 0 && sortedRounds.length > 1 && (
                  <div className="text-xs text-muted-foreground mb-2 font-medium">Latest</div>
                )}
                <div className="space-y-3">
                  {groupedResults[roundIdx].filter(r => r._type === 'diagnosis').map((card, idx) => (
                    <DiagnosisCard key={`diag-${roundIdx}-${idx}`} card={card} t={t} />
                  ))}
                  {groupedResults[roundIdx].filter(r => r._type === 'prompt_suggestion').map((suggestion, idx) => (
                    <PromptSuggestionCard key={`sugg-${roundIdx}-${idx}`} suggestion={suggestion} t={t} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <p className="text-sm">{t('attribution.aiAnalysis.noResultsYet', 'No diagnosis results yet')}</p>
              <p className="text-xs mt-2">{t('attribution.aiAnalysis.startAnalysis', 'Start a conversation to get diagnosis')}</p>
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

// Diagnosis Card Component
function DiagnosisCard({
  card, t
}: {
  card: DiagnosisResult
  t: (key: string, fallback?: string) => string
}) {
  const severityColors: Record<string, string> = {
    high: 'border-red-500/50 bg-red-500/10',
    medium: 'border-yellow-500/50 bg-yellow-500/10',
    low: 'border-blue-500/50 bg-blue-500/10',
  }
  const colorClass = severityColors[card.severity || 'medium'] || severityColors.medium

  return (
    <div className={`rounded-lg border p-4 ${colorClass}`}>
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-semibold text-sm">{card.title || 'Diagnosis'}</h4>
        {card.severity && (
          <span className={`text-xs px-2 py-0.5 rounded ${
            card.severity === 'high' ? 'bg-red-500/20 text-red-600' :
            card.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-600' :
            'bg-blue-500/20 text-blue-600'
          }`}>
            {card.severity.toUpperCase()}
          </span>
        )}
      </div>
      {card.metrics && (
        <div className="flex flex-wrap gap-2 mb-2">
          {Object.entries(card.metrics).map(([key, value]) => (
            <span key={key} className="text-xs bg-background/50 px-2 py-1 rounded">
              {key}: {String(value)}
            </span>
          ))}
        </div>
      )}
      {card.description && (
        <p className="text-sm text-muted-foreground">{card.description}</p>
      )}
    </div>
  )
}

// Prompt Suggestion Card Component
function PromptSuggestionCard({
  suggestion, t
}: {
  suggestion: DiagnosisResult
  t: (key: string, fallback?: string) => string
}) {
  return (
    <div className="rounded-lg border border-primary/50 bg-primary/5 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded font-medium">
          {t('attribution.aiAnalysis.promptSuggestion', 'Prompt Suggestion')}
        </span>
      </div>
      <h4 className="font-semibold text-sm mb-2">{suggestion.title}</h4>
      {suggestion.current_behavior && (
        <div className="mb-2">
          <span className="text-xs text-muted-foreground">{t('attribution.aiAnalysis.currentBehavior', 'Current')}:</span>
          <p className="text-sm bg-muted/50 rounded p-2 mt-1">{suggestion.current_behavior}</p>
        </div>
      )}
      {suggestion.suggested_change && (
        <div className="mb-2">
          <span className="text-xs text-muted-foreground">{t('attribution.aiAnalysis.suggestedChange', 'Suggested')}:</span>
          <p className="text-sm bg-green-500/10 border border-green-500/30 rounded p-2 mt-1">{suggestion.suggested_change}</p>
        </div>
      )}
      {suggestion.reason && (
        <p className="text-xs text-muted-foreground mt-2">
          <strong>{t('attribution.aiAnalysis.reason', 'Reason')}:</strong> {suggestion.reason}
        </p>
      )}
    </div>
  )
}
