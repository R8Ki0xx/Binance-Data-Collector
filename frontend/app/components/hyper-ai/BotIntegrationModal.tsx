import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ExternalLink, Copy, Check, Loader2, XCircle } from 'lucide-react'

interface BotIntegrationModalProps {
  open: boolean
  onClose: () => void
  platform: 'telegram' | 'discord'
  onConnected: () => void
  currentBotUsername?: string
  currentBotAppId?: string
}

export default function BotIntegrationModal({
  open,
  onClose,
  platform,
  onConnected,
  currentBotUsername,
  currentBotAppId,
}: BotIntegrationModalProps) {
  const { t } = useTranslation()
  const [step, setStep] = useState(0)
  const [token, setToken] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [newBotUsername, setNewBotUsername] = useState<string | null>(null)
  const [newBotAppId, setNewBotAppId] = useState<string | null>(null)

  const isConnected = !!currentBotUsername
  const displayUsername = newBotUsername || currentBotUsername
  const displayAppId = newBotAppId || currentBotAppId

  useEffect(() => {
    if (open) {
      setStep(isConnected ? 0 : 1)
      setToken('')
      setError(null)
      setCopied(false)
      setNewBotUsername(null)
      setNewBotAppId(null)
    }
  }, [open, isConnected])

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleConnect = async () => {
    if (!token.trim()) {
      setError(t('bot.tokenRequired', 'Bot token is required'))
      return
    }
    setConnecting(true)
    setError(null)
    try {
      const endpoint = isTelegram ? '/api/bot/telegram/connect' : '/api/bot/discord/connect'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_token: token }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail || 'Connection failed')
        return
      }
      // Store new bot info and go to connected state
      setNewBotUsername(data.bot_username)
      if (data.bot_app_id) {
        setNewBotAppId(data.bot_app_id)
      }
      onConnected()
      setStep(0) // Go to connected state instead of closing
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
    } finally {
      setConnecting(false)
    }
  }

  const isTelegram = platform === 'telegram'

  // Telegram config
  const botFatherLink = 'https://t.me/BotFather'
  const newBotCommand = '/newbot'

  // Discord config
  const discordDevPortalLink = 'https://discord.com/developers/applications'

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isTelegram ? (
              <TelegramIcon />
            ) : (
              <DiscordIcon />
            )}
            {isConnected
              ? t(isTelegram ? 'bot.manageTelegram' : 'bot.manageDiscord', isTelegram ? 'Manage Telegram Bot' : 'Manage Discord Bot')
              : t(isTelegram ? 'bot.connectTelegram' : 'bot.connectDiscord', isTelegram ? 'Connect Telegram Bot' : 'Connect Discord Bot')}
          </DialogTitle>
          <DialogDescription>
            {isConnected
              ? t('bot.manageDesc', 'Your bot is connected. You can change it below.')
              : t('bot.connectDesc', 'Follow these steps to connect your bot.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Step 0: Connected state - show current bot info and chat link */}
          {step === 0 && (isConnected || displayUsername) && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-green-500/5 border-green-500/20">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0"></span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">@{displayUsername}</p>
                  <p className="text-xs text-muted-foreground">{t('bot.connected', 'Connected')}</p>
                </div>
              </div>

              {/* Telegram: Direct chat link */}
              {isTelegram && displayUsername && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {t('bot.telegram.howToChat', 'Click below to start chatting with Hyper AI:')}
                  </p>
                  <a
                    href={`https://t.me/${displayUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 p-3 rounded-lg border bg-[#26A5E4]/10 border-[#26A5E4]/30 hover:bg-[#26A5E4]/20 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4 text-[#26A5E4]" />
                    <span className="text-sm font-medium text-[#26A5E4]">{t('bot.telegram.openChat', 'Open Chat in Telegram')}</span>
                  </a>
                </div>
              )}

              {/* Discord: Invite link + DM instructions */}
              {!isTelegram && displayAppId && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    {t('bot.discord.howToChat', 'Follow these steps to chat with Hyper AI:')}
                  </p>
                  <a
                    href={`https://discord.com/oauth2/authorize?client_id=${displayAppId}&scope=bot&permissions=2048`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 p-3 rounded-lg border bg-[#5865F2]/10 border-[#5865F2]/30 hover:bg-[#5865F2]/20 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4 text-[#5865F2]" />
                    <span className="text-sm font-medium text-[#5865F2]">{t('bot.discord.addToServer', 'Add Bot to Your Server')}</span>
                  </a>
                  <div className="text-xs text-muted-foreground space-y-1 p-2 rounded-lg bg-muted/30">
                    <p>1. {t('bot.discord.dmStep1', 'Click the link above to add the bot to any server')}</p>
                    <p>2. {t('bot.discord.dmStep2', 'In Discord, find the bot in the server member list')}</p>
                    <p>3. {t('bot.discord.dmStep3', 'Right-click the bot → "Message" to start a DM')}</p>
                  </div>
                </div>
              )}

              <Button variant="outline" className="w-full" onClick={() => setStep(1)}>
                {t('bot.changeBot', 'Change Bot')}
              </Button>
            </div>
          )}
          {step === 1 && isTelegram && (
            <div className="space-y-3">
              <p className="text-sm">
                {t('bot.step1Desc', 'Open Telegram and search for @BotFather, or click the link below:')}
              </p>
              <a
                href={botFatherLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 p-3 rounded-lg border bg-muted/50 hover:bg-muted transition-colors"
              >
                <ExternalLink className="w-4 h-4 text-[#26A5E4]" />
                <span className="text-sm font-medium">@BotFather</span>
                <span className="ml-auto text-xs text-muted-foreground">{t('bot.openInTelegram', 'Open in Telegram')}</span>
              </a>
              <p className="text-sm">
                {t('bot.step1Send', 'Send this command to create a new bot:')}
              </p>
              <div
                className="flex items-center gap-2 p-3 rounded-lg border bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                onClick={() => handleCopy(newBotCommand)}
              >
                <code className="text-sm font-mono flex-1">{newBotCommand}</code>
                {copied ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
              <Button className="w-full" onClick={() => setStep(2)}>
                {t('bot.nextStep', 'Next Step')}
              </Button>
              {/* Step indicators */}
              <div className="flex items-center justify-center gap-2 pt-2">
                {[1, 2].map((s) => (
                  <div
                    key={s}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      step === s ? 'bg-primary' : 'bg-muted-foreground/30'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Discord Step 1: Open Developer Portal */}
          {step === 1 && !isTelegram && (
            <div className="space-y-3">
              <p className="text-sm">
                {t('bot.discord.step1Desc', 'Open Discord Developer Portal and create a new Application:')}
              </p>
              <a
                href={discordDevPortalLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 p-3 rounded-lg border bg-muted/50 hover:bg-muted transition-colors"
              >
                <ExternalLink className="w-4 h-4 text-[#5865F2]" />
                <span className="text-sm font-medium">Discord Developer Portal</span>
                <span className="ml-auto text-xs text-muted-foreground">{t('bot.discord.openPortal', 'Open')}</span>
              </a>
              <div className="text-sm space-y-1.5 text-muted-foreground">
                <p>1. {t('bot.discord.step1a', 'Click "New Application" and give it a name')}</p>
                <p>2. {t('bot.discord.step1b', 'Go to "Bot" in the left sidebar')}</p>
                <p>3. {t('bot.discord.step1c', 'Click "Reset Token" to generate a bot token')}</p>
              </div>
              <Button className="w-full" onClick={() => setStep(2)}>
                {t('bot.nextStep', 'Next Step')}
              </Button>
              <div className="flex items-center justify-center gap-2 pt-2">
                {[1, 2, 3].map((s) => (
                  <div
                    key={s}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      step === s ? 'bg-primary' : 'bg-muted-foreground/30'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Telegram Step 2: Paste token and verify */}
          {step === 2 && isTelegram && (
            <div className="space-y-3">
              <p className="text-sm">
                {t('bot.step2Combined', 'Follow BotFather\'s instructions to set a name and username. Once done, paste the token below:')}
              </p>
              <div className="p-2 rounded-lg border bg-muted/30">
                <code className="text-xs font-mono text-muted-foreground break-all">
                  123456789:ABCdefGHIjklMNOpqrsTUVwxyz
                </code>
                <p className="text-xs text-muted-foreground mt-1">{t('bot.tokenExample', 'Token format example')}</p>
              </div>
              <Input
                type="password"
                placeholder={t('bot.tokenPlaceholder', 'Paste your bot token here')}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="font-mono text-sm"
              />
              {error && (
                <div className="flex items-center gap-2 text-sm text-red-500">
                  <XCircle className="w-4 h-4" />
                  {error}
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(1)} disabled={connecting}>
                  {t('bot.back', 'Back')}
                </Button>
                <Button className="flex-1" onClick={handleConnect} disabled={connecting}>
                  {connecting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {t('bot.verifying', 'Verifying...')}
                    </>
                  ) : (
                    t('bot.connectBot', 'Connect Bot')
                  )}
                </Button>
              </div>
              {/* Step indicators */}
              <div className="flex items-center justify-center gap-2 pt-2">
                {[1, 2].map((s) => (
                  <div
                    key={s}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      step === s ? 'bg-primary' : step > s ? 'bg-green-500' : 'bg-muted-foreground/30'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Discord Step 2: Enable MESSAGE CONTENT INTENT */}
          {step === 2 && !isTelegram && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-orange-500">
                ⚠️ {t('bot.discord.intentWarning', 'Important: Enable Message Content Intent')}
              </p>
              <div className="text-sm space-y-1.5 text-muted-foreground">
                <p>1. {t('bot.discord.step2a', 'In the Bot settings page, scroll down to "Privileged Gateway Intents"')}</p>
                <p>2. {t('bot.discord.step2b', 'Enable "MESSAGE CONTENT INTENT"')}</p>
                <p>3. {t('bot.discord.step2c', 'Click "Save Changes"')}</p>
              </div>
              <div className="p-2 rounded-lg border bg-orange-500/10 border-orange-500/20">
                <p className="text-xs text-orange-600 dark:text-orange-400">
                  {t('bot.discord.intentNote', 'Without this, the bot cannot read your messages in DM.')}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(1)}>
                  {t('bot.back', 'Back')}
                </Button>
                <Button className="flex-1" onClick={() => setStep(3)}>
                  {t('bot.discord.intentDone', 'I\'ve enabled it')}
                </Button>
              </div>
              <div className="flex items-center justify-center gap-2 pt-2">
                {[1, 2, 3].map((s) => (
                  <div
                    key={s}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      step === s ? 'bg-primary' : step > s ? 'bg-green-500' : 'bg-muted-foreground/30'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Discord Step 3: Paste token and verify */}
          {step === 3 && !isTelegram && (
            <div className="space-y-3">
              <p className="text-sm">
                {t('bot.discord.step3Desc', 'Now paste your bot token below:')}
              </p>
              <div className="p-2 rounded-lg border bg-muted/30">
                <code className="text-xs font-mono text-muted-foreground break-all">
                  MTIzNDU2Nzg5MDEyMzQ1Njc4OQ.G1a2b3.xYz...
                </code>
                <p className="text-xs text-muted-foreground mt-1">{t('bot.tokenExample', 'Token format example')}</p>
              </div>
              <Input
                type="password"
                placeholder={t('bot.tokenPlaceholder', 'Paste your bot token here')}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="font-mono text-sm"
              />
              {error && (
                <div className="flex items-center gap-2 text-sm text-red-500">
                  <XCircle className="w-4 h-4" />
                  {error}
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep(2)} disabled={connecting}>
                  {t('bot.back', 'Back')}
                </Button>
                <Button className="flex-1" onClick={handleConnect} disabled={connecting}>
                  {connecting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {t('bot.verifying', 'Verifying...')}
                    </>
                  ) : (
                    t('bot.connectBot', 'Connect Bot')
                  )}
                </Button>
              </div>
              <div className="flex items-center justify-center gap-2 pt-2">
                {[1, 2, 3].map((s) => (
                  <div
                    key={s}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      step === s ? 'bg-primary' : step > s ? 'bg-green-500' : 'bg-muted-foreground/30'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#26A5E4]" fill="currentColor">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  )
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#5865F2]" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z"/>
    </svg>
  )
}
