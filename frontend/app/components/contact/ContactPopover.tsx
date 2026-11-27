import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TwitterIcon, TelegramIcon, CommunityIcon } from './ContactIcons'
import { getContactConfig, ContactConfig } from '@/lib/contactApi'

interface ContactPopoverProps {
  children: React.ReactNode
}

export default function ContactPopover({ children }: ContactPopoverProps) {
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {items.map(({ key, label, icon: Icon, data }) => {
          const enabled = data?.enabled && data?.url
          return (
            <DropdownMenuItem
              key={key}
              className={`flex items-center gap-3 ${
                !enabled ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              onClick={() => {
                if (enabled && data?.url) {
                  window.open(data.url, '_blank', 'noopener,noreferrer')
                }
              }}
              disabled={!enabled}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              <span>{label}</span>
              {!enabled && (
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {t('common.notAvailable', 'N/A')}
                </span>
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
