import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { apiRequest } from '@/lib/api'

const FORWARD_PERIODS = ['1h', '4h', '12h', '24h']

interface Props {
  effectiveness: any[]
  symbol: string
  period: string
  forwardPeriod: string
  onForwardPeriodChange: (v: string) => void
}

function icBadge(ic: number | null) {
  if (ic === null || ic === undefined) return <Badge variant="secondary">—</Badge>
  const abs = Math.abs(ic)
  if (abs >= 0.05) return <Badge variant="default" className="bg-green-600">{ic.toFixed(4)}</Badge>
  if (abs >= 0.02) return <Badge variant="outline" className="text-yellow-500">{ic.toFixed(4)}</Badge>
  return <Badge variant="secondary">{ic.toFixed(4)}</Badge>
}

function wrBadge(wr: number | null) {
  if (wr === null || wr === undefined) return '—'
  const pct = (wr * 100).toFixed(1) + '%'
  if (wr >= 0.55) return <span className="text-green-500">{pct}</span>
  if (wr >= 0.45) return <span className="text-yellow-500">{pct}</span>
  return <span className="text-red-500">{pct}</span>
}

export default function FactorEffectivenessTab({
  effectiveness, symbol, period, forwardPeriod, onForwardPeriodChange,
}: Props) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<string | null>(null)
  const [history, setHistory] = useState<any[]>([])

  const toggleExpand = async (factorName: string) => {
    if (expanded === factorName) {
      setExpanded(null)
      return
    }
    setExpanded(factorName)
    try {
      const url = `/factors/effectiveness/${factorName}/history?symbol=${symbol}&period=${period}&forward_period=${forwardPeriod}`
      const res = await apiRequest(url)
      const data = await res.json()
      setHistory(data.history || [])
    } catch {
      setHistory([])
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {t('factors.forwardPeriod', 'Forward Period')}:
        </span>
        <Select value={forwardPeriod} onValueChange={onForwardPeriodChange}>
          <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
          <SelectContent>
            {FORWARD_PERIODS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {effectiveness.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {t('factors.noData', 'No effectiveness data yet. The engine computes daily at UTC 01:00.')}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('factors.name', 'Factor')}</TableHead>
              <TableHead>{t('factors.category', 'Category')}</TableHead>
              <TableHead className="text-right">IC</TableHead>
              <TableHead className="text-right">ICIR</TableHead>
              <TableHead className="text-right">{t('factors.winRate', 'Win Rate')}</TableHead>
              <TableHead className="text-right">{t('factors.samples', 'Samples')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {effectiveness.map((item: any) => (
              <TableRow
                key={item.factor_name}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => toggleExpand(item.factor_name)}
              >
                <TableCell className="font-medium">{item.factor_name}</TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">{item.category}</Badge>
                </TableCell>
                <TableCell className="text-right">{icBadge(item.ic_mean)}</TableCell>
                <TableCell className="text-right font-mono">
                  {item.icir?.toFixed(2) ?? '—'}
                </TableCell>
                <TableCell className="text-right">{wrBadge(item.win_rate)}</TableCell>
                <TableCell className="text-right">{item.sample_count ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
