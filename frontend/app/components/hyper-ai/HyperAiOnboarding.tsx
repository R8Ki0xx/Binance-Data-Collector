/**
 * HyperAiOnboarding - Full-screen onboarding overlay for Hyper AI setup
 * Step 1: LLM Provider configuration
 * Step 2: AI connectivity test + chat for user profile
 * Step 3: Completion message
 */
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Loader2, CheckCircle2, AlertCircle, ArrowRight, Bot, User, ChevronDown, Send } from 'lucide-react'
import { pollAiStream } from '@/lib/pollAiStream'

interface LLMProvider {
  id: string
  name: string
  base_url: string
  models: string[]
  api_format: string
}

interface HyperAiOnboardingProps {
  onComplete: () => void
  onSkip: () => void
}

type OnboardingStep = 'config' | 'chat' | 'complete'

export default function HyperAiOnboarding({ onComplete, onSkip }: HyperAiOnboardingProps) {
  const { t, i18n } = useTranslation()
  const [step, setStep] = useState<OnboardingStep>('config')
  const [providers, setProviders] = useState<LLMProvider[]>([])
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [apiKey, setApiKey] = useState('')
  const [modelInput, setModelInput] = useState('')
  const [customBaseUrl, setCustomBaseUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null)
  const [error, setError] = useState('')

  // Detect browser language on mount
  useEffect(() => {
    const browserLang = navigator.language.toLowerCase()
    if (browserLang.startsWith('zh') && i18n.language !== 'zh') {
      i18n.changeLanguage('zh')
    }
  }, [i18n])

  // Fetch providers on mount
  useEffect(() => {
    fetchProviders()
  }, [])

  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/hyper-ai/providers')
      const data = await res.json()
      setProviders(data.providers || [])
    } catch (e) {
      console.error('Failed to fetch providers:', e)
    }
  }

  const currentProvider = providers.find(p => p.id === selectedProvider)

  // Set default model when provider changes
  useEffect(() => {
    if (selectedProvider && currentProvider && currentProvider.models.length > 0 && !modelInput) {
      setModelInput(currentProvider.models[0])
    }
  }, [selectedProvider, currentProvider])

  const handleProviderChange = (value: string) => {
    setSelectedProvider(value)
    setModelInput('')  // Reset model when provider changes
  }

  const handleTestAndContinue = async () => {
    if (!selectedProvider || !apiKey) {
      setError(t('hyperAi.onboarding.fillRequired', 'Please fill in all required fields'))
      return
    }

    if (selectedProvider === 'custom' && !customBaseUrl) {
      setError(t('hyperAi.onboarding.baseUrlRequired', 'Base URL is required for custom provider'))
      return
    }

    setTesting(true)
    setError('')
    setTestResult(null)

    try {
      const saveRes = await fetch('/api/hyper-ai/profile/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          api_key: apiKey,
          model: modelInput,
          base_url: selectedProvider === 'custom' ? customBaseUrl : undefined
        })
      })

      if (!saveRes.ok) {
        const errData = await saveRes.json()
        throw new Error(errData.detail || 'Connection test failed')
      }

      setTestResult('success')
      setTimeout(() => setStep('chat'), 800)
    } catch (e: any) {
      setTestResult('error')
      setError(e.message || 'Connection test failed')
    } finally {
      setTesting(false)
    }
  }

  // Render based on current step
  if (step === 'chat') {
    return <ChatStep onSkip={onComplete} onComplete={onComplete} />
  }

  // Config step (default)
  return (
    <div className="fixed inset-0 bg-background/95 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="w-full max-w-md p-8 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <img
            src="/static/arena_logo_app_small.png"
            alt="Hyper Alpha Arena"
            className="w-16 h-16 mx-auto mb-4"
          />
          <h1 className="text-2xl font-bold">
            {t('hyperAi.onboarding.welcome', 'Welcome to Hyper Alpha Arena')}
          </h1>
          <p className="text-muted-foreground">
            {t('hyperAi.onboarding.configureAi', 'Configure Hyper AI to get started')}
          </p>
        </div>

        {/* Provider Selection */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('hyperAi.onboarding.provider', 'AI Provider')}</Label>
            <Select value={selectedProvider} onValueChange={handleProviderChange}>
              <SelectTrigger>
                <SelectValue placeholder={t('hyperAi.onboarding.selectProvider', 'Select provider')} />
              </SelectTrigger>
              <SelectContent>
                {providers.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Custom base URL for custom provider */}
          {selectedProvider === 'custom' && (
            <div className="space-y-2">
              <Label>{t('hyperAi.onboarding.baseUrl', 'Base URL')}</Label>
              <Input
                value={customBaseUrl}
                onChange={e => setCustomBaseUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
              />
            </div>
          )}

          {/* API Key */}
          <div className="space-y-2">
            <Label>{t('hyperAi.onboarding.apiKey', 'API Key')}</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
          </div>

          {/* Model Selection - Input + Dropdown */}
          {selectedProvider && (
            <div className="space-y-2">
              <Label>{t('hyperAi.onboarding.model', 'Model')}</Label>
              <div className="flex gap-1">
                <Input
                  value={modelInput}
                  onChange={e => setModelInput(e.target.value)}
                  placeholder={t('hyperAi.onboarding.modelPlaceholder', 'Enter or select model')}
                  className="flex-1"
                />
                {currentProvider && currentProvider.models.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" className="shrink-0">
                        <ChevronDown className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-h-60 overflow-y-auto">
                      {currentProvider.models.map(m => (
                        <DropdownMenuItem key={m} onClick={() => setModelInput(m)}>
                          {m}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Error message */}
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {/* Test result */}
        {testResult === 'success' && (
          <div className="flex items-center gap-2 text-green-600 text-sm">
            <CheckCircle2 className="w-4 h-4" />
            {t('hyperAi.onboarding.connectionSuccess', 'Connection successful!')}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Button variant="ghost" onClick={onSkip} className="flex-1">
            {t('common.skip', 'Skip')}
          </Button>
          <Button
            onClick={handleTestAndContinue}
            disabled={!selectedProvider || !apiKey || testing}
            className="flex-1"
          >
            {testing ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <ArrowRight className="w-4 h-4 mr-2" />
            )}
            {t('common.next', 'Continue')}
          </Button>
        </div>
      </div>
    </div>
  )
}

// Chat step component - Full implementation with SSE streaming
interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// Strip profile data markers from content for display
function stripProfileMarkers(content: string): string {
  return content.replace(/\[PROFILE_DATA\][\s\S]*?\[COMPLETE\]/g, '').trim()
}

function ChatStep({ onSkip, onComplete }: { onSkip: () => void; onComplete: () => void }) {
  const { t, i18n } = useTranslation()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [streamingContent, setStreamingContent] = useState('')
  const [lastOffset, setLastOffset] = useState(0)
  const [onboardingComplete, setOnboardingComplete] = useState(false)
  const [showEnterButton, setShowEnterButton] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const initializedRef = useRef(false)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // AI greeting on mount - useRef survives StrictMode remount
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      sendGreeting()
    }
  }, [])

  const sendGreeting = async () => {
    setLoading(true)
    setStreamingContent('')
    setLastOffset(0)

    try {
      // Use navigator.language as primary source - i18n.changeLanguage may not have completed yet
      const lang = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'

      const res = await fetch('/api/hyper-ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: '__GREETING__',
          conversation_id: null,
          mode: 'onboarding',
          lang
        })
      })

      if (!res.ok) throw new Error('Failed to start chat')

      const data = await res.json()
      setConversationId(data.conversation_id)
      await pollStreamResponse(data.task_id)
    } catch (e) {
      console.error('Greeting error:', e)
      setMessages([{
        role: 'assistant',
        content: t('hyperAi.onboarding.defaultGreeting',
          'Hello! I\'m Hyper AI. Before we begin, I\'d like to learn about your trading background. Do you have experience with cryptocurrency trading?')
      }])
    } finally {
      setLoading(false)
      textareaRef.current?.focus()
    }
  }

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return

    const userMessage: ChatMessage = { role: 'user', content: text }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)
    setStreamingContent('')
    setLastOffset(0)

    try {
      const res = await fetch('/api/hyper-ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversation_id: conversationId,
          mode: 'onboarding',
          lang: i18n.language?.startsWith('zh') ? 'zh' : 'en'
        })
      })

      if (!res.ok) throw new Error('Failed to send message')

      const data = await res.json()
      setConversationId(data.conversation_id)
      await pollStreamResponse(data.task_id)
    } catch (e) {
      console.error('Chat error:', e)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: t('hyperAi.onboarding.chatError', 'Sorry, something went wrong. Please try again.')
      }])
    } finally {
      setLoading(false)
      textareaRef.current?.focus()
    }
  }

  const pollStreamResponse = async (taskId: string) => {
    let content = ''
    let isOnboardingComplete = false

    await pollAiStream(taskId, {
      interval: 150,
      maxDuration: 2 * 60 * 1000,
      onChunk: (chunk) => {
        const eventType = chunk.event_type || chunk.data?.type
        if (eventType === 'content' && chunk.data?.text) {
          content += chunk.data.text
          setStreamingContent(content)
        } else if (eventType === 'done') {
          if (chunk.data?.onboarding_complete) {
            isOnboardingComplete = true
          }
        } else if (eventType === 'error') {
          throw new Error(chunk.data?.message || 'Stream error')
        }
      },
    })

    // Finalize message after polling completes
    if (content) {
      setMessages(prev => [...prev, { role: 'assistant', content }])
      setStreamingContent('')
    }
    if (isOnboardingComplete) {
      setOnboardingComplete(true)
      setTimeout(() => setShowEnterButton(true), 2000)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-3xl bg-background rounded-lg shadow-xl flex flex-col" style={{ height: '85vh' }}>
        {/* Header */}
        <div className="border-b p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold">Hyper AI</h2>
              <p className="text-xs text-muted-foreground">
                {t('hyperAi.onboarding.gettingToKnowQuestions', 'Getting to know you (3-4 questions)')}
              </p>
            </div>
          </div>
          {!onboardingComplete && (
            <Button variant="ghost" size="sm" onClick={onSkip}>
              {t('common.skip', 'Skip')}
            </Button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Initial loading state */}
          {messages.length === 0 && !streamingContent && loading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="rounded-lg px-4 py-2.5 bg-muted flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Hyper AI is typing...</span>
              </div>
            </div>
          )}

          {messages.map((msg, idx) => {
            const displayContent = msg.role === 'assistant' ? stripProfileMarkers(msg.content) : msg.content
            if (!displayContent) return null
            return (
              <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                )}
                <div className={`max-w-[80%] rounded-lg px-4 py-2.5 ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}>
                  <p className="text-sm whitespace-pre-wrap">{displayContent}</p>
                </div>
                {msg.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            )
          })}

          {/* Streaming message */}
          {streamingContent && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="max-w-[80%] rounded-lg px-4 py-2.5 bg-muted">
                <p className="text-sm whitespace-pre-wrap">{stripProfileMarkers(streamingContent)}</p>
              </div>
            </div>
          )}

          {/* Loading indicator for subsequent messages */}
          {loading && !streamingContent && messages.length > 0 && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="rounded-lg px-4 py-2.5 bg-muted">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input or Enter Button */}
        <div className="border-t p-4">
          {showEnterButton ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
              <p className="text-sm text-muted-foreground">
                {t('hyperAi.onboarding.profileSaved', 'Your profile has been saved!')}
              </p>
              <Button onClick={onComplete} size="lg" className="px-8">
                {t('hyperAi.onboarding.enterSystem', 'Enter System')}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          ) : (
            <>
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t('hyperAi.onboarding.typeMessage', 'Type a message...')}
                  disabled={loading || onboardingComplete}
                  className="w-full min-h-[80px] max-h-[200px] rounded-xl border border-input bg-transparent px-4 py-3 pb-12 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                  rows={3}
                />
                <div className="absolute bottom-3 right-3">
                  <Button
                    onClick={() => sendMessage(input)}
                    disabled={!input.trim() || loading || onboardingComplete}
                    size="icon"
                    className="rounded-full h-8 w-8 shrink-0"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
