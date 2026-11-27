import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useState } from 'react'

interface Props {
  status: any
  library: any
  values: any[]
}

function StatusCard({ status }: { status: any }) {
  const { t } = useTranslation()
  if (!status) return null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{t('factors.engineStatus', 'Engine Status')}</CardTitle>
      </CardHeader>
      <CardContent className="flex gap-6 text-sm">
        <div>
          <span className="text-muted-foreground">{t('factors.status', 'Status')}: </span>
          <Badge variant={status.enabled ? 'default' : 'secondary'}>
            {status.enabled ? 'ON' : 'OFF'}
          </Badge>
        </div>
        <div>
          <span className="text-muted-foreground">{t('factors.registeredFactors', 'Factors')}: </span>
          {status.registered_factors}
        </div>
        <div>
          <span className="text-muted-foreground">{t('factors.symbolsCovered', 'Symbols')}: </span>
          {status.symbols_covered}
        </div>
        <div>
          <span className="text-muted-foreground">{t('factors.totalValues', 'Values')}: </span>
          {status.total_factor_values}
        </div>
      </CardContent>
    </Card>
  )
}

function effectivenessColor(val: number | null): string {
  if (val === null || val === undefined) return 'secondary'
  const abs = Math.abs(val)
  if (abs >= 0.6) return 'default'
  if (abs >= 0.3) return 'outline'
  return 'secondary'
}

export default function FactorOverviewTab({ status, library, values }: Props) {
  const { t } = useTranslation()
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const categories = library?.categories || []
  const factors = library?.factors || []
  const valueMap = new Map(values.map(v => [v.factor_name, v]))

  const filtered = categoryFilter === 'all'
    ? factors
    : factors.filter((f: any) => f.category === categoryFilter)

  return (
    <div className="space-y-4">
      <StatusCard status={status} />

      <div className="flex gap-2 flex-wrap">
        <Badge
          variant={categoryFilter === 'all' ? 'default' : 'outline'}
          className="cursor-pointer"
          onClick={() => setCategoryFilter('all')}
        >
          All
        </Badge>
        {categories.map((c: string) => (
          <Badge
            key={c}
            variant={categoryFilter === c ? 'default' : 'outline'}
            className="cursor-pointer capitalize"
            onClick={() => setCategoryFilter(c)}
          >
            {c}
          </Badge>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('factors.name', 'Factor')}</TableHead>
            <TableHead>{t('factors.category', 'Category')}</TableHead>
            <TableHead className="text-right">{t('factors.value', 'Value')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((f: any) => {
            const v = valueMap.get(f.name)
            return (
              <TableRow key={f.name}>
                <TableCell>
                  <div className="font-medium">{f.display_name}</div>
                  <div className="text-xs text-muted-foreground">{f.description}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="capitalize">{f.category}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {v ? v.value?.toFixed(4) : '—'}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
