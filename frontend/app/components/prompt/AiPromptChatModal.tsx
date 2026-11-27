import { useState, useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
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
import { TradingAccount } from '@/lib/api'
import { pollAiStream } from '@/lib/pollAiStream'
import PacmanLoader from '@/components/ui/pacman-loader'
import { copyToClipboard } from '@/lib/utils'
import { Wrench, Send, Loader2 } from 'lucide-react'

interface ToolCallEntry {
  type: 'tool_call' | 'tool_result' | 'reasoning'
  name?: string
  args?: Record<string, unknown>
  result?: string
  content?: string
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
  promptResult?: string | null
  isStreaming?: boolean
  isInterrupted?: boolean
  interruptedRound?: number
  statusText?: string
  toolCalls?: ToolCallEntry[]
  toolCallsLog?: ToolCallLogEntry[]
  reasoningSnapshot?: string | null
}

interface Conversation {
  id: number
  title: string
  messageCount: number
  createdAt: string
  updatedAt: string
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

interface AiPromptChatModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: TradingAccount[]
  accountsLoading: boolean
  onApplyPrompt: (promptText: string) => void
  promptId?: number | null
  promptName?: string | null
}

export default function AiPromptChatModal({
  open,
  onOpenChange,
  accounts,
  accountsLoading,
  onApplyPrompt,
  promptId,
  promptName,
}: AiPromptChatModalProps) {
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
  const [extractedPrompts, setExtractedPrompts] = useState<Array<{id: number, content: string}>>([])
  const [selectedPromptIndex, setSelectedPromptIndex] = useState<number>(0)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const chatContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  // Load conversations when modal opens
  useEffect(() => {
    if (open) {
      loadConversations()
      // Select first AI account by default
      const aiAccounts = accounts.filter(acc => acc.account_type === 'AI')
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
    fetch(`/api/prompts/ai-conversations/${currentConversationId}/messages${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.token_usage !== undefined) setTokenUsage(data.token_usage) })
      .catch(() => {})
  }, [selectedAccountId])

  const loadConversations = async () => {
    setLoadingConversations(true)
    try {
      const response = await fetch('/api/prompts/ai-conversations')
      if (response.ok) {
        const data = await response.json()
        setConversations(data.conversations || [])
      } else if (response.status === 403) {
        toast.error(t('aiPrompt.premiumOnly', 'This feature is only available for premium members'))
        onOpenChange(false)
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
      const response = await fetch(`/api/prompts/ai-conversations/${conversationId}/messages${params}`)
      if (response.ok) {
        const data = await response.json()
        // Map API fields to frontend format
        const mappedMessages = (data.messages || []).map((m: Message & { is_complete?: boolean; tool_calls_log?: ToolCallLogEntry[]; reasoning_snapshot?: string }) => ({
          ...m,
          isInterrupted: m.role === 'assistant' && m.is_complete === false,
          toolCallsLog: m.tool_calls_log || [],
          reasoningSnapshot: m.reasoning_snapshot || null
        }))
        setMessages(mappedMessages)
        setCompressionPoints(data.compression_points || [])
        setTokenUsage(data.token_usage || null)

        // Extract ALL prompts from assistant messages (for version management)
        const prompts: Array<{id: number, content: string}> = []
        mappedMessages
          .filter((m: Message) => m.role === 'assistant' && m.promptResult)
          .forEach((m: Message) => {
            if (m.promptResult) {
              prompts.push({ id: m.id, content: m.promptResult })
            }
          })
        setExtractedPrompts(prompts)
        if (prompts.length > 0) {
          setSelectedPromptIndex(prompts.length - 1)
        }
      }
    } catch (error) {
      console.error('Failed to load messages:', error)
    }
  }

  const sendMessage = async () => {
    if (!userInput.trim() || !selectedAccountId) return
    if (!selectedAccountId) {
      toast.error(t('aiPrompt.selectTraderFirst', 'Please select an AI Trader first'))
      return
    }

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
      statusText: t('aiPrompt.connecting', 'Connecting...'),
      toolCalls: [],
    }
    setMessages(prev => [...prev, tempUserMsg, tempAssistantMsg])

    let finalConversationId: number | null = null

    try {
      const response = await fetch('/api/prompts/ai-chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccountId,
          userMessage: userMessage,
          conversationId: currentConversationId,
          promptId: promptId || undefined,
        }),
      })

      if (!response.ok) {
        if (response.status === 403) {
          toast.error(t('aiPrompt.premiumOnly', 'This feature is only available for premium members'))
          onOpenChange(false)
          return
        }
        throw new Error('Failed to connect')
      }

      // Check if response is JSON (background task mode) or SSE stream
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        // Background task mode: poll for results
        const taskData = await response.json()
        const taskId = taskData.task_id
        if (!taskId) throw new Error('No task_id returned')

        let finalContent = ''
        let finalPromptResult: string | null = null
        let hasError = false

        const pollResult = await pollAiStream(taskId, {
          onChunk: (chunk) => {
            handleSSEEvent(chunk.event_type, chunk.data, tempAssistantMsgId, (updates) => {
              if (updates.content !== undefined) finalContent = updates.content
              if (updates.promptResult !== undefined) finalPromptResult = updates.promptResult
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
            ? { ...m, content: finalContent, promptResult: finalPromptResult, isStreaming: false, statusText: undefined }
            : m
        ))

        // Add new prompt to version list if available
        if (finalPromptResult) {
          setExtractedPrompts(prev => {
            const newPrompts = [...prev, { id: tempAssistantMsgId, content: finalPromptResult! }]
            setSelectedPromptIndex(newPrompts.length - 1)
            return newPrompts
          })
        }

        // Set conversation ID if no error
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
        let finalPromptResult: string | null = null
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
                  if (updates.promptResult !== undefined) finalPromptResult = updates.promptResult
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
            ? { ...m, content: finalContent, promptResult: finalPromptResult, isStreaming: false, statusText: undefined }
            : m
        ))

        // Add new prompt to version list if available
        if (finalPromptResult) {
          setExtractedPrompts(prev => {
            const newPrompts = [...prev, { id: tempAssistantMsgId, content: finalPromptResult! }]
            setSelectedPromptIndex(newPrompts.length - 1)
            return newPrompts
          })
        }

        // Set conversation ID if no error
        if (!hasError && !currentConversationId && finalConversationId) {
          setCurrentConversationId(finalConversationId)
          loadConversations()
        }
      }
    } catch (error) {
      console.error('Chat error:', error)
      const convId = finalConversationId || currentConversationId
      if (convId) {
        toast.error(t('aiPrompt.connectionLost', 'Connection lost, reloading messages...'))
        await loadMessages(convId)
        if (!currentConversationId && finalConversationId) {
          setCurrentConversationId(finalConversationId)
          loadConversations()
        }
      } else {
        toast.error(t('aiPrompt.sendFailed', 'Failed to send message'))
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
    onUpdate: (updates: { content?: string; promptResult?: string | null; conversationId?: number; error?: boolean }) => void
  ) => {

    if (eventType === 'conversation_created') {
      onUpdate({ conversationId: data.conversation_id as number })
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, statusText: t('aiPrompt.thinking', 'Thinking...') } : m
      ))
    } else if (eventType === 'tool_round') {
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, statusText: `${t('aiPrompt.toolRound', 'Tool round')} ${data.round}/${data.max}` } : m
      ))
    } else if (eventType === 'retry') {
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, statusText: `${t('aiPrompt.retrying', 'Retrying')} (${data.attempt}/${data.max_retries})` } : m
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
          statusText: `${t('aiPrompt.calling', 'Calling')} ${data.name}...`,
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
    } else if (eventType === 'suggest_apply') {
      const promptResult = data.prompt as string
      onUpdate({ promptResult })
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, promptResult } : m
      ))
    } else if (eventType === 'content') {
      const content = data.content as string
      onUpdate({ content })
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, content, statusText: '' } : m
      ))
    } else if (eventType === 'done') {
      const content = data.content as string
      if (content) onUpdate({ content })
      if (data.conversation_id) onUpdate({ conversationId: data.conversation_id as number })
      if (data.prompt_result) onUpdate({ promptResult: data.prompt_result as string })
      if (data.compression_points) setCompressionPoints(data.compression_points as CompressionPoint[])
      // Convert streaming toolCalls to stored formats for immediate display after completion
      setMessages(prev => prev.map(m => {
        if (m.id !== msgId) return m
        const tcLog = data.tool_calls_log as ToolCallLogEntry[] | null
        const rSnap = data.reasoning_snapshot as string | null
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
      onUpdate({ error: true })
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, content: data.content as string, isStreaming: false } : m
      ))
    } else if (eventType === 'interrupted') {
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


  const handleApplyPrompt = (index?: number) => {
    const idx = index !== undefined ? index : selectedPromptIndex
    const prompt = extractedPrompts[idx]
    if (prompt) {
      onApplyPrompt(prompt.content)
      toast.success(t('aiPrompt.promptApplied', 'Prompt applied to editor'))
      onOpenChange(false)
    }
  }

  const startNewConversation = () => {
    setCurrentConversationId(null)
    setMessages([])
    setExtractedPrompts([])
    setSelectedPromptIndex(0)
    setTokenUsage(null)
  }

  const aiAccounts = accounts.filter(acc => acc.account_type === 'AI')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[95vw] max-w-[1600px] h-[85vh] flex flex-col p-0"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <DialogTitle>{t('aiPrompt.title', 'AI Strategy Prompt Generator')}</DialogTitle>
              {/* Show prompt name badge when editing */}
              {promptName && (
                <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded font-medium">
                  {t('aiPrompt.editing', 'Editing')}: {promptName}
                </span>
              )}
            </div>
            {(accountsLoading || loadingConversations) && (
              <PacmanLoader className="w-8 h-4" />
            )}
          </div>
          <div className="flex items-center gap-4 mt-4">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">{t('aiPrompt.aiTrader', 'AI Trader')}</label>
              <Select
                value={selectedAccountId?.toString()}
                onValueChange={(val) => setSelectedAccountId(parseInt(val))}
                disabled={accountsLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={accountsLoading ? t('common.loading', 'Loading...') : t('aiPrompt.selectAiTrader', 'Select AI Trader')} />
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
              <label className="text-xs text-muted-foreground mb-1 block">{t('aiPrompt.conversation', 'Conversation')}</label>
              <div className="flex gap-2">
                <Select
                  value={currentConversationId?.toString() || 'new'}
                  onValueChange={(val) => {
                    if (val === 'new') {
                      startNewConversation()
                    } else {
                      setCurrentConversationId(parseInt(val))
                    }
                  }}
                  disabled={loadingConversations}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={loadingConversations ? t('common.loading', 'Loading...') : t('aiPrompt.newConversation', 'New Conversation')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">{t('aiPrompt.newConversation', 'New Conversation')}</SelectItem>
                    {conversations.map(conv => (
                      <SelectItem key={conv.id} value={conv.id.toString()}>
                        {conv.title} ({conv.messageCount} {t('aiPrompt.msgs', 'msgs')})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startNewConversation}
                  className="shrink-0"
                >
                  {t('aiPrompt.new', 'New')}
                </Button>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 flex overflow-hidden">
          {/* Left: Chat Area (40%) */}
          <div className="w-[40%] flex flex-col border-r">
            <ScrollArea className="flex-1 p-4" ref={chatContainerRef}>
              <div className="space-y-4">
                {messages.length === 0 && (
                  <div className="text-center text-muted-foreground py-8">
                    <p className="text-sm">{t('aiPrompt.startHint', 'Start by describing your trading strategy')}</p>
                    <p className="text-xs mt-2">{t('aiPrompt.example', 'Example: "I want a trend-following strategy using MA crossovers"')}</p>
                  </div>
                )}
                {/* Memoize message list rendering to prevent re-renders on input typing.
                    Without this, every keystroke re-renders all messages (including expensive
                    ReactMarkdown parsing), causing noticeable input lag with long conversations. */}
                {useMemo(() => messages.map((msg) => {
                  const compressionPoint = compressionPoints.find(cp => cp.message_id === msg.id)
                  return (
                    <div key={msg.id}>
                      <div
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-lg p-3 ${
                            msg.role === 'user'
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted'
                          }`}
                        >
                      <div className={`text-xs font-semibold mb-1 ${msg.role === 'user' ? 'text-primary-foreground/70' : 'opacity-70'}`}>
                        {msg.role === 'user' ? t('aiPrompt.you', 'You') : t('aiPrompt.aiAssistant', 'AI Assistant')}
                        {msg.isStreaming && msg.statusText && (
                          <span className="ml-2 text-primary animate-pulse">({msg.statusText})</span>
                        )}
                      </div>
                      {/* Tool calls progress during streaming */}
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
                            {t('aiPrompt.toolCallsDetail', 'Tool calls ({{count}})').replace('{{count}}', msg.toolCallsLog.length.toString())}
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
                                        {key === 'prompt_text' ? (
                                          <div>
                                            <span className="text-muted-foreground">prompt_text:</span>
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
                            {t('aiPrompt.reasoningProcess', 'Reasoning process')}
                          </summary>
                          <div className="p-3 max-h-96 overflow-y-auto">
                            <pre className="whitespace-pre-wrap text-muted-foreground">{msg.reasoningSnapshot}</pre>
                          </div>
                        </details>
                      )}
                      <div className={`text-sm prose prose-sm max-w-none ${msg.role === 'user' ? 'prose-invert' : 'dark:prose-invert'}`}>
                        {msg.content ? (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              pre: ({ node, children, ...props }) => {
                                // Check if this pre contains a prompt code block
                                const child = node?.children?.[0] as { properties?: { className?: string[] } } | undefined
                                const className = child?.properties?.className || []
                                if (className.includes('language-prompt')) {
                                  return null
                                }
                                return <pre {...props}>{children}</pre>
                              },
                              code: ({ node, inline, className, children, ...props }) => {
                                const match = /language-(\w+)/.exec(className || '')
                                if (!inline && match?.[1] === 'prompt') {
                                  return null
                                }
                                return <code className={className} {...props}>{children}</code>
                              },
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        ) : msg.isStreaming ? (
                          <span className="text-muted-foreground italic">{t('aiPrompt.generating', 'Generating...')}</span>
                        ) : null}
                      </div>
                      {/* Continue button for interrupted messages */}
                      {msg.isInterrupted && !loading && (
                        <div className="mt-3 pt-3 border-t border-border/50">
                          <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 mb-2">
                            <span>⚠️</span>
                            <span>{t('aiPrompt.interruptedAt', 'Interrupted at round {{round}}').replace('{{round}}', String(msg.interruptedRound || '?'))}</span>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setUserInput(t('aiPrompt.continueMessage', 'Please continue'))
                              setTimeout(() => sendMessage(), 100)
                            }}
                            className="text-xs"
                          >
                            {t('aiPrompt.continueButton', 'Continue')}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                  {compressionPoint && (
                    <div className="flex items-center gap-3 my-4 text-xs text-muted-foreground">
                      <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
                      <span className="px-2 py-1 bg-muted rounded text-[10px]">
                        {t('aiPrompt.compressionPoint', 'Context compressed')}
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
                  placeholder={t('aiPrompt.inputPlaceholder', 'Describe your strategy or ask for modifications...')}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      sendMessage()
                    }
                  }}
                  disabled={loading || !selectedAccountId}
                  className="w-full min-h-[80px] max-h-[200px] rounded-xl border border-input bg-transparent px-4 py-3 pb-12 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                  rows={3}
                />
                <div className="absolute bottom-3 right-3 flex items-center gap-2">
                  {tokenUsage?.show_warning && (
                    <p className="text-xs text-amber-500">
                      {t('aiPrompt.contextWarning', 'Context remaining: {{percent}}% · Compressing soon', { percent: Math.max(0, Math.round((1 - tokenUsage.usage_ratio) * 100)) })}
                    </p>
                  )}
                  <Button onClick={sendMessage} disabled={loading || !userInput.trim() || !selectedAccountId} size="icon" className="rounded-full h-8 w-8 shrink-0">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Artifact Preview (60%) */}
          <div className="w-[60%] flex flex-col bg-muted/30">
            <div className="p-4 border-b">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">{t('aiPrompt.generatedPrompts', 'Generated Prompts')}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {extractedPrompts.length > 0
                      ? t('aiPrompt.versionsAvailable', '{{count}} version(s) available').replace('{{count}}', extractedPrompts.length.toString())
                      : t('aiPrompt.promptWillAppear', 'The AI-generated strategy prompt will appear here')}
                  </p>
                </div>
                {extractedPrompts.length > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedPromptIndex(Math.max(0, selectedPromptIndex - 1))}
                      disabled={selectedPromptIndex === 0}
                      className="h-7 px-2"
                    >
                      ← {t('aiPrompt.prev', 'Prev')}
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {selectedPromptIndex + 1} / {extractedPrompts.length}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedPromptIndex(Math.min(extractedPrompts.length - 1, selectedPromptIndex + 1))}
                      disabled={selectedPromptIndex === extractedPrompts.length - 1}
                      className="h-7 px-2"
                    >
                      {t('aiPrompt.next', 'Next')} →
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <ScrollArea className="flex-1 p-4">
              {extractedPrompts.length > 0 ? (
                <div className="space-y-4">
                  {extractedPrompts.length > 1 && (
                    <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
                      {t('aiPrompt.versionOf', 'Version {{current}} of {{total}}').replace('{{current}}', (selectedPromptIndex + 1).toString()).replace('{{total}}', extractedPrompts.length.toString())}
                      {selectedPromptIndex === extractedPrompts.length - 1 && ` (${t('aiPrompt.latest', 'Latest')})`}
                    </div>
                  )}
                  <div className="rounded-lg overflow-hidden border bg-muted/50 p-4">
                    <pre className="text-sm whitespace-pre-wrap break-words font-mono">
                      {extractedPrompts[selectedPromptIndex]?.content || ''}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <p className="text-sm">{t('aiPrompt.noPromptYet', 'No prompt generated yet')}</p>
                    <p className="text-xs mt-2">
                      {t('aiPrompt.startConversation', 'Start a conversation to generate a strategy prompt')}
                    </p>
                  </div>
                </div>
              )}
            </ScrollArea>

            {extractedPrompts.length > 0 && (
              <div className="p-4 border-t flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={async () => {
                    const currentPrompt = extractedPrompts[selectedPromptIndex]
                    if (currentPrompt) {
                      const success = await copyToClipboard(currentPrompt.content)
                      if (success) {
                        toast.success(t('aiPrompt.copied', 'Prompt copied to clipboard'))
                      } else {
                        toast.error(t('aiPrompt.copyFailed', 'Failed to copy to clipboard'))
                      }
                    }
                  }}
                >
                  {t('aiPrompt.copy', 'Copy')}
                </Button>
                <Button onClick={() => handleApplyPrompt()}>
                  {t('aiPrompt.applyToEditor', 'Apply to Editor')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
