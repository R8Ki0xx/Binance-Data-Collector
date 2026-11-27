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

export default function Header({ title = 'Hyper Alpha Arena' }: HeaderProps) {
  return (
    <header className="w-full border-b bg-background/50 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="w-full py-2 px-3 md:px-4 flex items-center justify-between">
        <h1 className="text-base md:text-xl font-bold truncate">{title}</h1>
      </div>
    </header>
  )
}
