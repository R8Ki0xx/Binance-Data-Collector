import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { TwitterIcon, TelegramIcon, CommunityIcon } from './ContactIcons'
import { getContactConfig, ContactConfig } from '@/lib/contactApi'

interface ContactDialogProps {
  children: React.ReactNode
}

// Extract domain from URL (e.g., "https://x.com/user" -> "x.com")
function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const hostname = new URL(url).hostname
    // Remove www. prefix if present
    return hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export default function ContactDialog({ children }: ContactDialogProps) {
  const { t } = useTranslation()
  const [config, setConfig] = useState<ContactConfig | null>(null)

  useEffect(() => {
    getContactConfig().then(setConfig)
  }, [])

  const items = [
    {
      key: 'twitter',
      label: 'Twitter',
      icon: TwitterIcon,
      data: config?.twitter,
    },
    {
      key: 'telegram',
      label: 'Telegram',
      icon: TelegramIcon,
      data: config?.telegram,
    },
    {
      key: 'community',
      label: t('sidebar.community', 'Community'),
      icon: CommunityIcon,
      data: config?.community,
    },
  ]

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center">
            {t('contact.contactAuthor', 'Contact Author')}
          </DialogTitle>
        </DialogHeader>
        <div className="flex justify-center gap-4 py-4">
          {items.map(({ key, label, icon: Icon, data }) => {
            const enabled = data?.enabled && data?.url
            const domain = extractDomain(data?.url)
            return (
              <button
                key={key}
                className={`flex flex-col items-center gap-2 p-4 rounded-lg border transition-colors min-w-[100px] ${
                  enabled
                    ? 'hover:bg-muted cursor-pointer border-border'
                    : 'opacity-50 cursor-not-allowed border-border/50'
                }`}
                onClick={() => {
                  if (enabled && data?.url) {
                    window.open(data.url, '_blank', 'noopener,noreferrer')
                  }
                }}
                disabled={!enabled}
              >
                <Icon className="w-8 h-8" />
                <span className="text-sm font-medium">{label}</span>
                <span className="text-[10px] text-muted-foreground">
                  {enabled && domain ? domain : t('common.notAvailable', 'N/A')}
                </span>
              </button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
