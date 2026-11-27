import { useEffect } from 'react'
import { User, LogOut, UserCog, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuth } from '@/contexts/AuthContext'
import { useCurrentExchangeInfo } from '@/contexts/ExchangeContext'
import { getSignInUrl } from '@/lib/auth'

interface Account {
  id: number
  user_id: number
  name: string
  account_type: string
  initial_capital: number
  current_cash: number
  frozen_cash: number
}

interface HeaderProps {
  title?: string
  currentAccount?: Account | null
  showAccountSelector?: boolean
}

export default function Header({ title = 'Hyper Alpha Arena', currentAccount, showAccountSelector = false }: HeaderProps) {
  const { t } = useTranslation()
  const { user, loading, authEnabled, membership, logout } = useAuth()
  const currentExchangeInfo = useCurrentExchangeInfo()
  const isVipMember = membership?.status === 'ACTIVE'

  // Preload VIP icons so dropdown renders instantly
  useEffect(() => {
    ;['/static/vip_logo.png', '/static/vip_no.png'].forEach((src) => {
      const img = new Image()
      img.src = src
    })
  }, [])

  // Helper function to format membership expiry date
  const formatExpiryDate = (dateString?: string) => {
    if (!dateString) return ''
    try {
      return new Date(dateString).toLocaleDateString()
    } catch {
      return ''
    }
  }

  // Helper function to open pricing page
  const openPricingPage = () => {
    window.open('https://www.akooi.com/#pricing-section', '_blank')
  }

  const handleSignUp = async () => {
    const signInUrl = await getSignInUrl()
    if (signInUrl) {
      window.location.href = signInUrl
    }
  }

  return (
    <header className="w-full border-b bg-background/50 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="w-full py-2 px-3 md:px-4 flex items-center justify-between">
        <div className="flex items-center gap-2 md:gap-3">
          <h1 className="text-base md:text-xl font-bold truncate">{title}</h1>

          {currentExchangeInfo.id === 'hyperliquid' && !isVipMember && (
            <span className="hidden md:inline text-xs text-muted-foreground ml-2">{t('header.premiumDiscount', 'Subscribe to Premium for service fee 50% off.')}</span>
          )}
        </div>

        {/* Right side controls - Hidden on mobile */}
        <div className="hidden md:flex items-center gap-3">
          {authEnabled && (
            <>
              {loading ? (
                <div className="w-20 h-9 bg-muted animate-pulse rounded-md" />
              ) : user ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
                      <div className={`relative rounded-full ${isVipMember ? 'p-[3px] bg-gradient-to-br from-yellow-200 via-amber-500 to-orange-600 shadow-[0_0_18px_rgba(202,138,4,0.85)]' : ''}`}>
                        {isVipMember && (
                          <>
                            <span className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.55),transparent_60%)] opacity-90 blur-[1px]" aria-hidden="true" />
                            <span className="pointer-events-none absolute -inset-1 rounded-full bg-[radial-gradient(circle,rgba(234,179,8,0.55),transparent_70%)] blur-xl opacity-80" aria-hidden="true" />
                          </>
                        )}
                        <div className={`relative rounded-full overflow-hidden ${isVipMember ? 'ring-2 ring-yellow-50 bg-black/70' : ''}`}>
                          <Avatar className="h-9 w-9">
                            <AvatarImage src={user.avatar} alt={user.displayName || user.name} />
                            <AvatarFallback className="text-xs">
                              {user.displayName?.[0] || user.name?.[0] || "U"}
                            </AvatarFallback>
                          </Avatar>
                        </div>
                      </div>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="end" forceMount>
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">
                          {user.displayName || user.name}
                        </p>
                        <p className="text-xs leading-none text-muted-foreground">
                          {user.email}
                        </p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />

                    {/* Membership Status */}
                    {membership && membership.status === 'ACTIVE' ? (
                      <DropdownMenuItem className="cursor-default">
                        <img src="/static/vip_logo.png" alt="VIP" className="mr-2 h-4 w-4" />
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-yellow-600">{t('header.vipMember', 'VIP Member')}</span>
                          <span className="text-xs text-muted-foreground">
                            {membership.planKey === 'yearly' ? t('header.yearlyPlan', 'Yearly Plan') : t('header.monthlyPlan', 'Monthly Plan')}
                            {membership.currentPeriodEnd && ` • ${t('header.expires', 'Expires')} ${formatExpiryDate(membership.currentPeriodEnd)}`}
                          </span>
                        </div>
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onClick={openPricingPage}>
                        <img src="/static/vip_no.png" alt="Upgrade" className="mr-2 h-4 w-4" />
                        <span>{t('header.upgradeToVip', 'Upgrade to VIP')}</span>
                        <ExternalLink className="ml-auto h-3 w-3" />
                      </DropdownMenuItem>
                    )}

                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => window.open('https://account.akooi.com/account', '_blank')}>
                      <UserCog className="mr-2 h-4 w-4" />
                      <span>{t('header.myAccount', 'My Account')}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={logout}>
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>{t('header.signOut', 'Sign Out')}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button
                  onClick={handleSignUp}
                  size="sm"
                  className="px-4 py-2 text-sm font-medium"
                >
                  {t('header.login', 'Login')}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

    </header>
  )
}
