import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RefreshCw, Play, ChevronRight, X, Loader2, History, Search, Check } from 'lucide-react'
import {
  createBacktestTask,
  BacktestTaskItemForImport,
} from '@/lib/api'
import BacktestHistoryModal from './BacktestHistoryModal'

dayjs.extend(utc)

interface ModelChatEntry {
  id: number
  account_id: number
  account_name: string
  operation: string
  symbol: string | null
  reason: string
  executed: boolean
  decision_time: string | null
  realized_pnl?: number | null
  has_snapshot?: boolean
  prompt_snapshot?: string
  reasoning_snapshot?: string
  decision_snapshot?: string
}

interface PromptBacktestProps {
  accountId: string
  tradingMode?: string
  exchange?: string
}

interface SelectedRecord extends ModelChatEntry {
  modifiedPrompt: string
  // Search/replace state
  isMatched?: boolean        // Whether keyword was found
  isSelected?: boolean       // Whether selected for replacement (default true)
  isModified?: boolean       // Whether already replaced
  matchContext?: string      // Matched line with context
}

export default function PromptBacktest({
  accountId,
  tradingMode = 'all',
  exchange = 'all',
}: PromptBacktestProps) {
  const { t } = useTranslation()

  // State for record selection
  const [records, setRecords] = useState<ModelChatEntry[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  // Filter state
  const [filterOperation, setFilterOperation] = useState<string>('all')
  const [filterSymbol, setFilterSymbol] = useState<string>('all')
  const [filterHasSnapshot, setFilterHasSnapshot] = useState(false)
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([])

  // State for workspace
  const [workspace, setWorkspace] = useState<SelectedRecord[]>([])
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [replaceCount, setReplaceCount] = useState<number | null>(null)
  const [loadingSnapshots, setLoadingSnapshots] = useState(false)
  const [searchMode, setSearchMode] = useState(false)  // Whether in search preview mode

  // State for editing single prompt
  const [editingRecord, setEditingRecord] = useState<SelectedRecord | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)

  // State for history modal
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const [initialTaskId, setInitialTaskId] = useState<number | undefined>(undefined)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const PAGE_SIZE = 100

  // Fetch model chat records (without snapshots for performance)
  const fetchRecords = useCallback(async (beforeTime?: string, append = false) => {
    if (accountId === 'all') return
    if (append) {
      setLoadingMore(true)
    } else {
      setLoading(true)
      setHasMore(true)
    }
    try {
      const params = new URLSearchParams()
      params.append('account_id', accountId)
      params.append('limit', String(PAGE_SIZE))
      // Don't include snapshots in list - load them when adding to workspace
      if (tradingMode !== 'all') {
        params.append('trading_mode', tradingMode)
      }
      if (exchange !== 'all') {
        params.append('exchange', exchange)
      }
      if (beforeTime) {
        params.append('before_time', beforeTime)
      }

      const response = await fetch(`/api/arena/model-chat?${params}`)
      const data = await response.json()
      const entries = data.entries || []

      if (append) {
        setRecords(prev => [...prev, ...entries])
      } else {
        setRecords(entries)
        // Extract unique symbols for filter
        const symbols = [...new Set(entries.map((e: ModelChatEntry) => e.symbol).filter(Boolean))] as string[]
        setAvailableSymbols(symbols)
      }

      setHasMore(entries.length >= PAGE_SIZE)
    } catch (error) {
      console.error('Failed to fetch records:', error)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [accountId, tradingMode, exchange])

  // Load more records
  const loadMore = () => {
    if (records.length === 0 || loadingMore) return
    const lastRecord = records[records.length - 1]
    if (lastRecord.decision_time) {
      fetchRecords(lastRecord.decision_time, true)
    }
  }

  useEffect(() => {
    fetchRecords()
  }, [fetchRecords])

  // Toggle record selection
  const toggleSelect = (id: number) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  // Filter records based on current filters
  const filteredRecords = records.filter(r => {
    if (filterOperation !== 'all' && r.operation?.toLowerCase() !== filterOperation) return false
    if (filterSymbol !== 'all' && r.symbol !== filterSymbol) return false
    if (filterHasSnapshot && !r.has_snapshot) return false
    return true
  })

  // Select all / deselect all
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredRecords.length && filteredRecords.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredRecords.map(r => r.id)))
    }
  }

  // Load selected records into workspace (fetch snapshots on demand)
  const loadToWorkspace = async () => {
    const selectedRecords = records.filter(r => selectedIds.has(r.id))
    if (selectedRecords.length === 0) return

    setLoadingSnapshots(true)
    try {
      // Fetch snapshots for selected records
      const ids = selectedRecords.map(r => r.id)
      const params = new URLSearchParams()
      params.append('account_id', accountId)
      params.append('ids', ids.join(','))
      params.append('include_snapshots', 'true')

      const response = await fetch(`/api/arena/model-chat?${params}`)
      const data = await response.json()
      const entriesWithSnapshots = data.entries || []

      // Map snapshots to selected records
      const snapshotMap = new Map(entriesWithSnapshots.map((e: ModelChatEntry) => [e.id, e]))
      const workspaceItems = selectedRecords
        .map(r => {
          const withSnapshot = snapshotMap.get(r.id)
          if (withSnapshot?.prompt_snapshot) {
            return { ...withSnapshot, modifiedPrompt: withSnapshot.prompt_snapshot }
          }
          return null
        })
        .filter(Boolean) as SelectedRecord[]

      setWorkspace(prev => {
        const existingIds = new Set(prev.map(p => p.id))
        const newItems = workspaceItems.filter(w => !existingIds.has(w.id))
        // Sort by decision_time descending (newest first)
        return [...prev, ...newItems].sort((a, b) => {
          const timeA = a.decision_time ? new Date(a.decision_time).getTime() : 0
          const timeB = b.decision_time ? new Date(b.decision_time).getTime() : 0
          return timeB - timeA
        })
      })
      setSelectedIds(new Set())
      setReplaceCount(null)
    } catch (error) {
      console.error('Failed to load snapshots:', error)
    } finally {
      setLoadingSnapshots(false)
    }
  }

  // Remove item from workspace
  const removeFromWorkspace = (id: number) => {
    setWorkspace(prev => prev.filter(r => r.id !== id))
  }

  // Apply batch replace
  const applyReplace = () => {
    if (!findText) return
    let count = 0
    const updated = workspace.map(r => {
      // Only replace if matched and selected
      if (r.isMatched && r.isSelected !== false && r.modifiedPrompt.includes(findText)) {
        count++
        return {
          ...r,
          modifiedPrompt: r.modifiedPrompt.replaceAll(findText, replaceText),
          isModified: true,
          isMatched: false,  // Clear match state after replace
          matchContext: undefined,
        }
      }
      return r
    })
    setWorkspace(updated)
    setReplaceCount(count)
    setSearchMode(false)
  }

  // Search and preview matches
  const searchPreview = () => {
    if (!findText) {
      // Clear search mode
      setSearchMode(false)
      setWorkspace(prev => prev.map(r => ({
        ...r,
        isMatched: undefined,
        isSelected: undefined,
        matchContext: undefined,
      })))
      return
    }

    const updated = workspace.map(r => {
      const matchPos = r.modifiedPrompt.indexOf(findText)

      if (matchPos >= 0) {
        // Find line number of match position
        const textBefore = r.modifiedPrompt.substring(0, matchPos)
        const linesBefore = textBefore.split('\n')
        const matchLineNum = linesBefore.length - 1  // 0-indexed

        // Split entire text into lines
        const allLines = r.modifiedPrompt.split('\n')

        // Calculate how many lines the search text spans
        const searchLines = findText.split('\n').length

        // Extract context: 1 line before, matched lines, 1 line after
        const start = Math.max(0, matchLineNum - 1)
        const end = Math.min(allLines.length, matchLineNum + searchLines + 1)
        const contextLines = allLines.slice(start, end).map((line, i) => {
          const lineNum = start + i + 1
          const isInMatch = (start + i >= matchLineNum) && (start + i < matchLineNum + searchLines)
          return `${isInMatch ? '>' : ' '} ${lineNum}: ${line}`
        })

        return {
          ...r,
          isMatched: true,
          isSelected: true,  // Default selected
          matchContext: contextLines.join('\n'),
        }
      }

      return {
        ...r,
        isMatched: false,
        isSelected: undefined,
        matchContext: undefined,
      }
    })

    setWorkspace(updated)
    setSearchMode(true)
    setReplaceCount(null)
  }

  // Toggle selection for a workspace item
  const toggleWorkspaceSelect = (id: number) => {
    setWorkspace(prev => prev.map(r =>
      r.id === id ? { ...r, isSelected: !r.isSelected } : r
    ))
  }

  // Clear search mode
  const clearSearch = () => {
    setFindText('')
    setReplaceText('')
    setSearchMode(false)
    setReplaceCount(null)
    setWorkspace(prev => prev.map(r => ({
      ...r,
      isMatched: undefined,
      isSelected: undefined,
      matchContext: undefined,
    })))
  }

  // Import items from history task to workspace
  const handleImportFromHistory = (items: BacktestTaskItemForImport[]) => {
    const newWorkspaceItems: SelectedRecord[] = items.map(item => ({
      id: item.id,
      account_id: Number(accountId),
      account_name: '',
      operation: item.operation || '',
      symbol: item.symbol,
      reason: item.reason || '',
      executed: true,
      decision_time: item.decision_time,
      realized_pnl: item.realized_pnl,
      has_snapshot: true,
      prompt_snapshot: item.modified_prompt,
      modifiedPrompt: item.modified_prompt,
    }))

    setWorkspace(prev => {
      const existingIds = new Set(prev.map(p => p.id))
      const newItems = newWorkspaceItems.filter(w => !existingIds.has(w.id))
      // Sort by decision_time descending (newest first)
      return [...prev, ...newItems].sort((a, b) => {
        const timeA = a.decision_time ? new Date(a.decision_time).getTime() : 0
        const timeB = b.decision_time ? new Date(b.decision_time).getTime() : 0
        return timeB - timeA
      })
    })

    // Clear search state
    clearSearch()
  }

  // Save edited prompt
  const saveEditedPrompt = () => {
    if (!editingRecord) return
    setWorkspace(prev =>
      prev.map(r =>
        r.id === editingRecord.id
          ? { ...r, modifiedPrompt: editingRecord.modifiedPrompt }
          : r
      )
    )
    setEditDialogOpen(false)
    setEditingRecord(null)
  }

  // Submit backtest task
  const submitBacktest = async () => {
    if (workspace.length === 0 || accountId === 'all' || isSubmitting) return
    setIsSubmitting(true)
    try {
      const result = await createBacktestTask({
        account_id: Number(accountId),
        name: `Backtest ${dayjs().format('YYYY-MM-DD HH:mm')}`,
        items: workspace.map(r => ({
          decision_log_id: r.id,
          modified_prompt: r.modifiedPrompt,
        })),
        replace_rules: findText ? [{ find: findText, replace: replaceText }] : undefined,
      })
      // Open history modal with the new task
      setInitialTaskId(result.task_id)
      setHistoryModalOpen(true)
    } catch (error) {
      console.error('Failed to create backtest task:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Format time to local
  const formatTime = (time: string | null) => {
    if (!time) return '-'
    return dayjs.utc(time).local().format('MM-DD HH:mm')
  }

  // Get operation badge color
  const getOperationColor = (op: string | null) => {
    if (!op) return 'secondary'
    const opLower = op.toLowerCase()
    if (opLower === 'buy') return 'default'
    if (opLower === 'sell') return 'destructive'
    return 'secondary'
  }

  if (accountId === 'all') {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-center">
            {t('promptBacktest.selectAccount', 'Please select a specific AI Trader to use Prompt Backtest')}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Main Layout: Left (Records) + Right (Workspace) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0">
        {/* Left Panel: Decision Records */}
        <Card className="flex flex-col min-h-0">
          <CardHeader className="pb-2 shrink-0">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base shrink-0">
                {t('promptBacktest.decisionRecords', 'Decision Records')}
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Filters */}
                <Select value={filterOperation} onValueChange={setFilterOperation}>
                  <SelectTrigger className="w-24 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('common.all', 'All')}</SelectItem>
                    <SelectItem value="buy">Buy</SelectItem>
                    <SelectItem value="sell">Sell</SelectItem>
                    <SelectItem value="hold">Hold</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={filterSymbol} onValueChange={setFilterSymbol}>
                  <SelectTrigger className="w-28 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('common.all', 'All')}</SelectItem>
                    {availableSymbols.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" onClick={() => fetchRecords()} disabled={loading}>
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col pt-0 min-h-0">
            <div className="border rounded-md flex-1 overflow-auto min-h-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 sticky top-0 bg-background z-10">
                      <Checkbox
                        checked={selectedIds.size === filteredRecords.length && filteredRecords.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead className="sticky top-0 bg-background z-10 w-20">{t('promptBacktest.time', 'Time')}</TableHead>
                    <TableHead className="sticky top-0 bg-background z-10 w-16">{t('promptBacktest.operation', 'Op')}</TableHead>
                    <TableHead className="sticky top-0 bg-background z-10 w-16">{t('promptBacktest.symbol', 'Symbol')}</TableHead>
                    <TableHead className="sticky top-0 bg-background z-10 w-16">P&L</TableHead>
                    <TableHead className="sticky top-0 bg-background z-10">{t('promptBacktest.reason', 'Reason')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRecords.map(record => (
                    <TableRow key={record.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(record.id)}
                          onCheckedChange={() => toggleSelect(record.id)}
                        />
                      </TableCell>
                      <TableCell className="text-xs">{formatTime(record.decision_time)}</TableCell>
                      <TableCell>
                        <Badge variant={getOperationColor(record.operation) as 'default' | 'secondary' | 'destructive'} className="text-xs">
                          {record.operation}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{record.symbol || '-'}</TableCell>
                      <TableCell className={`text-xs ${record.realized_pnl && record.realized_pnl < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {record.realized_pnl != null ? `$${record.realized_pnl.toFixed(2)}` : '-'}
                      </TableCell>
                      <TableCell className="text-xs max-w-[200px] truncate" title={record.reason}>
                        {record.reason || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredRecords.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        {loading ? t('common.loading', 'Loading...') : t('promptBacktest.noRecords', 'No records found')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {/* Load More & Add to Workspace */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t">
              <div className="text-xs text-muted-foreground">
                {filteredRecords.length} {t('promptBacktest.records', 'records')}
                {selectedIds.size > 0 && ` · ${selectedIds.size} ${t('promptBacktest.selected', 'selected')}`}
              </div>
              <div className="flex gap-2">
                {hasMore && (
                  <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : t('common.loadMore', 'Load More')}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={loadToWorkspace}
                  disabled={selectedIds.size === 0 || loadingSnapshots}
                >
                  {loadingSnapshots ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <ChevronRight className="h-4 w-4 mr-1" />
                  )}
                  {t('promptBacktest.addToWorkspace', 'Add')} ({selectedIds.size})
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right Panel: Workspace */}
        <Card className="flex flex-col min-h-0">
          <CardHeader className="pb-2 shrink-0">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {t('promptBacktest.workspace', 'Workspace')} ({workspace.length})
              </CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setInitialTaskId(undefined); setHistoryModalOpen(true) }}>
                  <History className="h-4 w-4 mr-1" />
                  {t('promptBacktest.history', 'History')}
                </Button>
                <Button size="sm" onClick={submitBacktest} disabled={workspace.length === 0 || isSubmitting}>
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4 mr-1" />
                  )}
                  {t('promptBacktest.runBacktest', 'Run')}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col pt-0 space-y-3 min-h-0">
            {/* Batch Replace */}
            <div className="flex gap-2 items-stretch shrink-0">
              <Textarea
                placeholder={t('promptBacktest.findText', 'Find...')}
                value={findText}
                onChange={e => {
                  setFindText(e.target.value)
                  // Clear search mode when input changes
                  if (searchMode) {
                    setSearchMode(false)
                    setReplaceCount(null)
                    setWorkspace(prev => prev.map(r => ({
                      ...r,
                      isMatched: undefined,
                      isSelected: undefined,
                      matchContext: undefined,
                    })))
                  }
                }}
                className="flex-1 min-h-[68px] max-h-[100px] text-xs font-mono resize-none"
              />
              <Textarea
                placeholder={t('promptBacktest.replaceWith', 'Replace...')}
                value={replaceText}
                onChange={e => setReplaceText(e.target.value)}
                className="flex-1 min-h-[68px] max-h-[100px] text-xs font-mono resize-none"
              />
              <div className="flex flex-col gap-1">
                <Button variant="outline" size="sm" onClick={searchPreview} disabled={!findText} className="flex-1">
                  <Search className="h-4 w-4 mr-1" />
                  {t('promptBacktest.preview', 'Preview')}
                </Button>
                <Button
                  size="sm"
                  onClick={applyReplace}
                  disabled={!findText || !searchMode || workspace.filter(r => r.isMatched && r.isSelected).length === 0}
                  className="flex-1"
                >
                  {t('promptBacktest.replace', 'Replace')}
                </Button>
              </div>
            </div>
            {/* Search/Replace Status */}
            {searchMode && (
              <div className="flex items-center justify-between text-xs shrink-0">
                <span className="text-muted-foreground">
                  {t('promptBacktest.matchedCount', '{{matched}} matched, {{selected}} selected', {
                    matched: workspace.filter(r => r.isMatched).length,
                    selected: workspace.filter(r => r.isMatched && r.isSelected).length,
                  })}
                </span>
                <Button variant="ghost" size="sm" onClick={clearSearch} className="h-6 px-2 text-xs">
                  <X className="h-3 w-3 mr-1" />
                  {t('promptBacktest.clearSearch', 'Clear')}
                </Button>
              </div>
            )}
            {replaceCount !== null && (
              <p className="text-xs text-muted-foreground shrink-0">
                {t('promptBacktest.replacedCount', 'Replaced in {{count}} records', { count: replaceCount })}
              </p>
            )}

            {/* Workspace Items */}
            <div className="border rounded-md flex-1 overflow-auto min-h-0">
              {workspace.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm py-12">
                  {t('promptBacktest.emptyWorkspace', 'Select records from the left and click Add')}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {searchMode && (
                        <TableHead className="sticky top-0 bg-background z-10 w-8"></TableHead>
                      )}
                      <TableHead className="sticky top-0 bg-background z-10">{t('promptBacktest.time', 'Time')}</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10">{t('promptBacktest.operation', 'Op')}</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10">{t('promptBacktest.symbol', 'Symbol')}</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 text-right">{t('promptBacktest.pnl', 'P&L')}</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10">{t('promptBacktest.status', 'Status')}</TableHead>
                      <TableHead className="sticky top-0 bg-background z-10 w-24">{t('common.actions', 'Actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workspace.map(record => (
                      <>
                        <TableRow
                          key={record.id}
                          className={record.isMatched === false ? 'opacity-50' : ''}
                        >
                          {searchMode && (
                            <TableCell className="w-8">
                              {record.isMatched && (
                                <Checkbox
                                  checked={record.isSelected}
                                  onCheckedChange={() => toggleWorkspaceSelect(record.id)}
                                />
                              )}
                            </TableCell>
                          )}
                          <TableCell className="text-xs">{formatTime(record.decision_time)}</TableCell>
                          <TableCell>
                            <Badge variant={getOperationColor(record.operation) as 'default' | 'secondary' | 'destructive'} className="text-xs">
                              {record.operation}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{record.symbol || '-'}</TableCell>
                          <TableCell className="text-xs text-right">
                            {record.realized_pnl != null ? (
                              <span className={record.realized_pnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                                {record.realized_pnl >= 0 ? '+' : ''}{record.realized_pnl.toFixed(2)}
                              </span>
                            ) : '-'}
                          </TableCell>
                          <TableCell className="text-xs">
                            {record.isModified ? (
                              <Badge variant="default" className="text-xs bg-green-600">
                                <Check className="h-3 w-3 mr-1" />
                                {t('promptBacktest.modified', 'Modified')}
                              </Badge>
                            ) : record.isMatched === true ? (
                              <Badge variant="outline" className="text-xs border-blue-500 text-blue-600">
                                {t('promptBacktest.matched', 'Matched')}
                              </Badge>
                            ) : record.isMatched === false ? (
                              <span className="text-muted-foreground">{t('promptBacktest.noMatch', 'No match')}</span>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => {
                                  setEditingRecord(record)
                                  setEditDialogOpen(true)
                                }}
                              >
                                {t('common.edit', 'Edit')}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-destructive"
                                onClick={() => removeFromWorkspace(record.id)}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        {/* Context row - show when matched */}
                        {record.isMatched && record.matchContext && (
                          <TableRow key={`${record.id}-context`} className="bg-muted/30">
                            <TableCell colSpan={searchMode ? 7 : 6} className="py-2">
                              <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground max-h-[80px] overflow-auto">
                                {record.matchContext}
                              </pre>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit Prompt Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{t('promptBacktest.editPrompt', 'Edit Prompt')}</DialogTitle>
          </DialogHeader>
          {editingRecord && (
            <div className="space-y-4">
              <Textarea
                value={editingRecord.modifiedPrompt}
                onChange={e => setEditingRecord({ ...editingRecord, modifiedPrompt: e.target.value })}
                className="min-h-[400px] font-mono text-xs"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button onClick={saveEditedPrompt}>
                  {t('common.save', 'Save')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Backtest History Modal */}
      <BacktestHistoryModal
        open={historyModalOpen}
        onOpenChange={setHistoryModalOpen}
        accountId={accountId}
        initialTaskId={initialTaskId}
        onImportToWorkspace={handleImportFromHistory}
      />
    </div>
  )
}