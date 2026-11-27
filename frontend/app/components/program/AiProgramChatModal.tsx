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
import { Copy, Check, Wrench, Send, Loader2 } from 'lucide-react'

interface SaveSuggestion {
  code: string
  name: string
  description: string
}

interface ToolCallEntry {
  type: 'tool_call' | 'tool_result' | 'reasoning'
  name?: string
  args?: Record<string, unknown>
  result?: string
  content?: string
}

// API format for tool_calls_log from database
interface ToolCallLogEntry {
  tool: string
  args: Record<string, unknown>
  result: string
}

interface Message {
  id: number
  role: 'user' | 'assistant'
  content: string
  code_suggestion?: string | null
  isStreaming?: boolean
  isInterrupted?: boolean  // True if AI was interrupted and can be continued
  interruptedRound?: number  // Round number when interrupted
  statusText?: string
  toolCalls?: ToolCallEntry[]
  toolCallsLog?: ToolCallLogEntry[]  // From API, for displaying full args
  saveSuggestion?: SaveSuggestion | null
  reasoningSnapshot?: string | null
}

interface Conversation {
  id: number
  program_id: number | null
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

interface AiProgramChatModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaveCode: (code: string, name: string, description: string) => Promise<boolean>
  accounts: TradingAccount[]
  accountsLoading: boolean
  programId?: number | null
  programName?: string | null
  programDescription?: string | null
  currentCode?: string
  isNewProgram?: boolean
}

export default function AiProgramChatModal({
  open,
  onOpenChange,
  onSaveCode,
  accounts,
  accountsLoading,
  programId,
  programName,
  programDescription,
  currentCode,
  isNewProgram,
}: AiProgramChatModalProps) {
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
  const [allCodeSuggestions, setAllCodeSuggestions] = useState<SaveSuggestion[]>([])

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
    fetch(`/api/programs/ai-conversations/${currentConversationId}/messages${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.token_usage !== undefined) setTokenUsage(data.token_usage) })
      .catch(() => {})
  }, [selectedAccountId])

  const loadConversations = async () => {
    setLoadingConversations(true)
    try {
      const url = programId
        ? `/api/programs/ai-conversations?program_id=${programId}`
        : '/api/programs/ai-conversations'
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        setConversations(data || [])
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
      const response = await fetch(`/api/programs/ai-conversations/${conversationId}/messages${params}`)
      if (response.ok) {
        const data = await response.json()
        // Map API fields to frontend format
        const mappedMessages = (data.messages || data).map((m: Message & { is_complete?: boolean; tool_calls_log?: ToolCallLogEntry[]; reasoning_snapshot?: string }) => ({
          ...m,
          isInterrupted: m.role === 'assistant' && m.is_complete === false,
          toolCallsLog: m.tool_calls_log || [],
          reasoningSnapshot: m.reasoning_snapshot || null
        }))
        setMessages(mappedMessages || [])
        setCompressionPoints(data.compression_points || [])
        setTokenUsage(data.token_usage || null)
        const suggestions: SaveSuggestion[] = []
        ;(data.messages || data).forEach((m: Message) => {
          if (m.role === 'assistant' && m.saveSuggestion) {
            suggestions.push(m.saveSuggestion)
          }
        })
        setAllCodeSuggestions(suggestions)
      }
    } catch (error) {
      console.error('Failed to load messages:', error)
    }
  }

  const startNewConversation = () => {
    setCurrentConversationId(null)
    setMessages([])
    setCompressionPoints([])
    setAllCodeSuggestions([])
    setTokenUsage(null)
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
      statusText: t('program.aiChat.connecting'),
      toolCalls: [],
    }
    setMessages(prev => [...prev, tempUserMsg, tempAssistantMsg])

    // Declare outside try block so catch can access it
    let finalConversationId: number | null = null

    try {
      const response = await fetch('/api/programs/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: selectedAccountId,
          message: userMessage,
          conversation_id: currentConversationId,
          program_id: programId,
        }),
      })

      if (!response.ok) throw new Error('Failed to connect')

      // Check if response is JSON (background task mode) or SSE stream
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        // Background task mode: poll for results
        const taskData = await response.json()
        const taskId = taskData.task_id
        if (!taskId) throw new Error('No task_id returned')

        let finalContent = ''
        let finalSuggestion: SaveSuggestion | null = null
        let hasError = false

        const pollResult = await pollAiStream(taskId, {
          onChunk: (chunk) => {
            handleSSEEvent(chunk.event_type, chunk.data, tempAssistantMsgId, (updates) => {
              if (updates.content !== undefined) finalContent = updates.content
              if (updates.suggestion) finalSuggestion = updates.suggestion
              if (updates.conversationId) finalConversationId = updates.conversationId
              if (updates.error) hasError = true
            })
          },
          onTaskLost: () => {
            if (finalConversationId || currentConversationId) {
              loadMessages(finalConversationId || currentConversationId!)
            }
          },
        })

        if (pollResult.status === 'lost') return

        // Finalize the message
        setMessages(prev => prev.map(m =>
          m.id === tempAssistantMsgId
            ? { ...m, content: finalContent, isStreaming: false, statusText: undefined }
            : m
        ))

        if (finalSuggestion) {
          setAllCodeSuggestions(prev => [...prev, finalSuggestion!])
        }

        if (!hasError && !currentConversationId && finalConversationId) {
          setCurrentConversationId(finalConversationId)
          loadConversations()
        }
      } else {
        // SSE stream mode (legacy fallback)
        const reader = response.body?.getReader()
        if (!reader) throw new Error('No reader')

        const decoder = new TextDecoder()
        let buffer = ''
        let finalContent = ''
        let finalSuggestion: SaveSuggestion | null = null
        let hasError = false
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
                handleSSEEvent(currentEventType || data.type as string, data, tempAssistantMsgId, (updates) => {
                  if (updates.content !== undefined) finalContent = updates.content
                  if (updates.suggestion) finalSuggestion = updates.suggestion
                  if (updates.conversationId) finalConversationId = updates.conversationId
                  if (updates.error) hasError = true
                })
              } catch {}
              currentEventType = ''
            }
          }
        }

        // Finalize the message
        setMessages(prev => prev.map(m =>
          m.id === tempAssistantMsgId
            ? { ...m, content: finalContent, isStreaming: false, statusText: undefined }
            : m
        ))

        if (finalSuggestion) {
          setAllCodeSuggestions(prev => [...prev, finalSuggestion!])
        }

        // Only set conversation ID if no error occurred
        if (!hasError && !currentConversationId && finalConversationId) {
          setCurrentConversationId(finalConversationId)
          loadConversations()
        }
      }
    } catch (error) {
      console.error('Chat error:', error)
      // Connection lost - reload messages from server instead of deleting
      const convId = finalConversationId || currentConversationId
      if (convId) {
        toast.error(t('program.aiChat.connectionLost'))
        // Reload saved messages from server
        await loadMessages(convId)
        if (!currentConversationId && finalConversationId) {
          setCurrentConversationId(finalConversationId)
          loadConversations()
        }
      } else {
        // No conversation created yet, remove temp messages
        toast.error(t('program.aiChat.error'))
        setMessages(prev => prev.filter(m => m.id !== tempUserMsgId && m.id !== tempAssistantMsgId))
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSSEEvent = (
    eventType: string,
    data: Record<string, unknown>,
    msgId: number,
    onUpdate: (updates: { content?: string; suggestion?: SaveSuggestion; conversationId?: number; error?: boolean }) => void
  ) => {

    if (eventType === 'conversation_created') {
      // Only save the ID, don't set state yet (will be set after SSE completes)
      onUpdate({ conversationId: data.conversation_id as number })
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, statusText: t('program.aiChat.thinking') } : m
      ))
    } else if (eventType === 'tool_round') {
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, statusText: `${t('program.aiChat.toolRound')} ${data.round}/${data.max}` } : m
      ))
    } else if (eventType === 'retry') {
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, statusText: `${t('program.aiChat.retrying')} (${data.attempt}/${data.max_retries})` } : m
      ))
    } else if (eventType === 'reasoning') {
      const reasoningText = data.content as string || ''
      setMessages(prev => prev.map(m =>
        m.id === msgId ? {
          ...m,
          statusText: `Thinking: ${reasoningText.slice(0, 80)}...`,
          toolCalls: [...(m.toolCalls || []), { type: 'reasoning', content: reasoningText }],
        } : m
      ))
    } else if (eventType === 'tool_call') {
      setMessages(prev => prev.map(m =>
        m.id === msgId ? {
          ...m,
          statusText: `${t('program.aiChat.calling')} ${data.name}...`,
          toolCalls: [...(m.toolCalls || []), {
            type: 'tool_call',
            name: data.name as string,
            args: data.args as Record<string, unknown>,
          }],
        } : m
      ))
    } else if (eventType === 'tool_result') {
      setMessages(prev => prev.map(m =>
        m.id === msgId ? {
          ...m,
          toolCalls: [...(m.toolCalls || []), {
            type: 'tool_result',
            name: data.name as string,
            result: data.result as string,
          }],
        } : m
      ))
    } else if (eventType === 'save_suggestion') {
      const suggestion = data.data as SaveSuggestion
      onUpdate({ suggestion })
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, saveSuggestion: suggestion } : m
      ))
    } else if (eventType === 'content') {
      const content = data.content as string
      onUpdate({ content })
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, content, statusText: '' } : m
      ))
    } else if (eventType === 'done') {
      // Final content and conversation_id come in done event
      const content = data.content as string
      if (content) onUpdate({ content })
      if (data.conversation_id) onUpdate({ conversationId: data.conversation_id as number })
      if (data.compression_points) setCompressionPoints(data.compression_points as CompressionPoint[])
      // Convert streaming toolCalls to stored formats for immediate display after completion
      setMessages(prev => prev.map(m => {
        if (m.id !== msgId) return m
        const tcLog = data.tool_calls_log as ToolCallLogEntry[] | null
        const rSnap = data.reasoning_snapshot as string | null
        // Fallback: convert streaming toolCalls if backend didn't send stored formats
        let toolCallsLog = tcLog || m.toolCallsLog
        let reasoningSnapshot = rSnap || m.reasoningSnapshot
        if (!toolCallsLog && m.toolCalls && m.toolCalls.length > 0) {
          toolCallsLog = m.toolCalls
            .filter(e => e.type === 'tool_call')
            .map(e => ({ tool: e.name || 'unknown', args: e.args || {}, result: '' }))
        }
        if (!reasoningSnapshot && m.toolCalls) {
          const parts = m.toolCalls.filter(e => e.type === 'reasoning').map(e => e.content || '')
          if (parts.length > 0) reasoningSnapshot = parts.join('\n\n---\n\n')
        }
        return { ...m, isStreaming: false, toolCallsLog, reasoningSnapshot: reasoningSnapshot || null }
      }))
    } else if (eventType === 'error') {
      // Mark as error so we don't set conversationId
      onUpdate({ error: true })
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, content: data.content as string, isStreaming: false } : m
      ))
    } else if (eventType === 'interrupted') {
      // AI was interrupted but progress was saved - can be continued
      onUpdate({ conversationId: data.conversation_id as number | undefined })
      setMessages(prev => prev.map(m =>
        m.id === msgId ? {
          ...m,
          isStreaming: false,
          isInterrupted: true,
          interruptedRound: data.round as number,
          statusText: ''
        } : m
      ))
    }
  }

  const handleSaveCode = async (suggestion: SaveSuggestion) => {
    // In edit mode, use original name/description; in new mode, use AI suggestion
    const finalName = !isNewProgram && programName ? programName : suggestion.name
    const finalDescription = !isNewProgram && programDescription !== undefined ? (programDescription || '') : suggestion.description
    const success = await onSaveCode(suggestion.code, finalName, finalDescription)
    if (success) {
      toast.success(t('program.aiChat.codeSaved'))
    }
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
              <DialogTitle>
                {isNewProgram ? t('program.aiChat.titleNew') : t('program.aiChat.titleEdit')}
              </DialogTitle>
              {/* Show program name badge when editing */}
              {!isNewProgram && programName && (
                <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded font-medium">
                  {t('program.aiChat.editing')}: {programName}
                </span>
              )}
              {isNewProgram && (
                <span className="text-xs bg-green-500/10 text-green-600 px-2 py-1 rounded font-medium">
                  {t('program.aiChat.creatingNew')}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {t('program.aiChat.subtitle')}
              </span>
            </div>
            {(loadingConversations || accountsLoading) && <PacmanLoader className="w-8 h-4" />}
          </div>
          <div className="flex items-center gap-4 mt-4">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">
                {t('program.aiChat.aiTrader')}
              </label>
              <Select
                value={selectedAccountId?.toString()}
                onValueChange={(val) => setSelectedAccountId(parseInt(val))}
                disabled={accountsLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={accountsLoading ? t('common.loading') : t('program.aiChat.selectAI')} />
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
              <label className="text-xs text-muted-foreground mb-1 block">
                {t('program.aiChat.conversation')}
              </label>
              <div className="flex gap-2">
                <Select
                  value={currentConversationId?.toString() || 'new'}
                  onValueChange={(val) => {
                    if (val === 'new') startNewConversation()
                    else setCurrentConversationId(parseInt(val))
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('program.aiChat.newChat')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">{t('program.aiChat.newChat')}</SelectItem>
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
          <CodeSuggestionsPanel
            suggestions={allCodeSuggestions}
            onSave={handleSaveCode}
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
              <p className="text-sm">{t('program.aiChat.describeProgram')}</p>
              <p className="text-xs mt-2">{t('program.aiChat.example')}</p>
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
                  {msg.role === 'user' ? t('program.aiChat.you') : t('program.aiChat.aiAssistant')}
                  {msg.isStreaming && msg.statusText && (
                    <span className="ml-2 text-primary animate-pulse">({msg.statusText})</span>
                  )}
                </div>
                {msg.isStreaming && msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mb-2 text-xs bg-background/50 rounded p-2 max-h-32 overflow-y-auto">
                    {msg.toolCalls.slice(-5).map((entry, idx) => (
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
                {/* Tool calls log - above content, HyperAI style */}
                {!msg.isStreaming && msg.toolCallsLog && msg.toolCallsLog.length > 0 && (
                  <details className="mb-3 text-xs border rounded-md">
                    <summary className="px-3 py-2 cursor-pointer bg-muted/50 hover:bg-muted font-medium flex items-center gap-1">
                      <Wrench className="w-3 h-3" />
                      {t('program.aiChat.toolCallsDetail', { count: msg.toolCallsLog.length })}
                    </summary>
                    <div className="p-3 space-y-3 max-h-96 overflow-y-auto">
                      {msg.toolCallsLog.map((entry, idx) => {
                        const resultStr = typeof entry.result === 'string' ? entry.result : JSON.stringify(entry.result || '')
                        return (
                        <div key={idx} className="border-b pb-2 last:border-b-0 last:pb-0">
                          <div className="font-medium text-blue-600 dark:text-blue-400 mb-1">
                            Round {idx + 1}: {entry.tool}
                          </div>
                          {entry.args && Object.keys(entry.args).length > 0 && (
                            <div className="mb-1">
                              {Object.entries(entry.args).map(([key, value]) => (
                                <div key={key} className="ml-2">
                                  {key === 'code' ? (
                                    <div>
                                      <span className="text-muted-foreground">code:</span>
                                      <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto max-h-48 overflow-y-auto">
                                        <code>{String(value)}</code>
                                      </pre>
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground">{key}: {JSON.stringify(value)}</span>
                                  )}
                                </div>
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
                      {t('program.aiChat.reasoningProcess', 'Reasoning process')}
                    </summary>
                    <div className="p-3 max-h-96 overflow-y-auto">
                      <pre className="whitespace-pre-wrap text-muted-foreground">{msg.reasoningSnapshot}</pre>
                    </div>
                  </details>
                )}
                <div className={`text-sm prose prose-sm max-w-none overflow-x-auto ${
                  msg.role === 'user' ? 'prose-invert text-white' : 'dark:prose-invert'
                } [&_table]:w-full [&_table]:table-fixed [&_th]:text-left [&_td]:break-words`}>
                  {msg.content ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{msg.content}</ReactMarkdown>
                  ) : msg.isStreaming ? (
                    <span className="text-muted-foreground italic">{t('program.aiChat.generating')}</span>
                  ) : null}
                </div>
                {/* Show continue button for interrupted messages */}
                {msg.isInterrupted && !loading && (
                  <div className="mt-3 pt-3 border-t border-border/50">
                    <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 mb-2">
                      <span>⚠️</span>
                      <span>{t('program.aiChat.interruptedAt', { round: msg.interruptedRound })}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setUserInput(t('program.aiChat.continueMessage'))
                        setTimeout(() => sendMessage(), 100)
                      }}
                      className="text-xs"
                    >
                      {t('program.aiChat.continueButton')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
            {compressionPoint && (
              <div className="flex items-center gap-3 my-4 text-xs text-muted-foreground">
                <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
                <span className="px-2 py-1 bg-muted rounded text-[10px]">
                  {t('program.aiChat.compressionPoint', 'Context compressed')}
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
            placeholder={t('program.aiChat.placeholder')}
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
                {t('program.contextWarning', 'Context remaining: {{percent}}% · Compressing soon', { percent: Math.max(0, Math.round((1 - tokenUsage.usage_ratio) * 100)) })}
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

// Code Suggestions Panel Component (Right side - 55%)
function CodeSuggestionsPanel({
  suggestions, onSave, t
}: {
  suggestions: SaveSuggestion[]
  onSave: (suggestion: SaveSuggestion) => void
  t: (key: string, fallback?: string) => string
}) {
  const [savedCodes, setSavedCodes] = useState<Set<string>>(new Set())
  const [savingCodes, setSavingCodes] = useState<Set<string>>(new Set())

  const handleSave = async (suggestion: SaveSuggestion) => {
    const key = suggestion.name
    setSavingCodes(prev => new Set(prev).add(key))
    try {
      await onSave(suggestion)
      setSavedCodes(prev => new Set(prev).add(key))
    } finally {
      setSavingCodes(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  return (
    <div className="w-[55%] flex flex-col bg-muted/30">
      <div className="p-4 border-b">
        <h3 className="text-sm font-semibold">{t('program.aiChat.generatedCode')}</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {suggestions.length > 0
            ? t('program.aiChat.codeCount').replace('{{count}}', suggestions.length.toString())
            : t('program.aiChat.codeWillAppear')}
        </p>
      </div>
      <ScrollArea className="flex-1 p-4">
        {suggestions.length > 0 ? (
          <div className="space-y-4">
            {/* Reverse order: newest first */}
            {[...suggestions].reverse().map((suggestion, idx) => (
              <div key={idx}>
                {/* Divider between cards (not before first) */}
                {idx > 0 && (
                  <div className="flex items-center gap-2 mb-4 -mt-2">
                    <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
                    <span className="text-xs text-muted-foreground/50">
                      {t('program.aiChat.previousVersion', 'Previous')}
                    </span>
                    <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
                  </div>
                )}
                <CodeCard
                  suggestion={suggestion}
                  onSave={() => handleSave(suggestion)}
                  isSaving={savingCodes.has(suggestion.name)}
                  isSaved={savedCodes.has(suggestion.name)}
                  isLatest={idx === 0}
                  t={t}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <p className="text-sm">{t('program.aiChat.noCodeYet')}</p>
              <p className="text-xs mt-2">{t('program.aiChat.startConversation')}</p>
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  )
}

// Individual Code Card Component
function CodeCard({
  suggestion, onSave, isSaving, isSaved, isLatest, t
}: {
  suggestion: SaveSuggestion
  onSave: () => void
  isSaving?: boolean
  isSaved?: boolean
  isLatest?: boolean
  t: (key: string, fallback?: string) => string
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`rounded-lg border bg-card p-4 ${isLatest ? 'ring-1 ring-green-500/30' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="font-semibold text-sm">{suggestion.name || t('program.aiChat.unnamedProgram')}</h4>
          <p className="text-xs text-muted-foreground">{suggestion.description}</p>
        </div>
        {isLatest ? (
          <span className="text-xs bg-green-500/10 text-green-600 px-2 py-1 rounded">
            {t('program.aiChat.latest', 'Latest')}
          </span>
        ) : (
          <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
            {t('program.aiChat.program')}
          </span>
        )}
      </div>
      <div className="bg-muted/50 rounded p-2 mb-3">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? t('program.aiChat.hideCode') : t('program.aiChat.showCode')}
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(suggestion.code)
              toast.success(t('common.copied'))
            }}
          >
            <Copy className="h-3 w-3 mr-1" />
            {t('common.copy')}
          </Button>
        </div>
        {expanded && (
          <pre className="text-xs overflow-x-auto max-h-64 whitespace-pre-wrap">
            {suggestion.code}
          </pre>
        )}
      </div>
      <div className="flex gap-2">
        {isSaved ? (
          <Button size="sm" className="flex-1" variant="secondary" disabled>
            <Check className="h-3 w-3 mr-1" />
            <span className="text-green-600">{t('program.aiChat.saved')}</span>
          </Button>
        ) : (
          <Button size="sm" className="flex-1" onClick={onSave} disabled={isSaving}>
            {isSaving ? t('program.aiChat.saving') : t('program.aiChat.confirmSave')}
          </Button>
        )}
      </div>
    </div>
  )
}
