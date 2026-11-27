import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, RotateCcw, ChevronRight, Download } from 'lucide-react'
import {
  BacktestTask,
  BacktestResultItem,
  BacktestResultSummary,
  BacktestItemDetail,
  listBacktestTasks,
  getBacktestTaskStatus,
  getBacktestTaskResults,
  getBacktestItemDetail,
  retryBacktestTask,
  getBacktestTaskItems,
  BacktestTaskItemForImport,
} from '@/lib/api'

dayjs.extend(utc)

interface BacktestHistoryModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId: string
  initialTaskId?: number
  onImportToWorkspace?: (items: BacktestTaskItemForImport[]) => void
}

export default function BacktestHistoryModal({
  open,
  onOpenChange,
  accountId,
  initialTaskId,
  onImportToWorkspace,
}: BacktestHistoryModalProps) {
  const { t } = useTranslation()

  // State
  const [tasks, setTasks] = useState<BacktestTask[]>([])
  const [selectedTask, setSelectedTask] = useState<BacktestTask | null>(null)
  const [results, setResults] = useState<BacktestResultItem[]>([])
  const [summary, setSummary] = useState<BacktestResultSummary | null>(null)
  const [selectedItem, setSelectedItem] = useState<BacktestItemDetail | null>(null)
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [loadingResults, setLoadingResults] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [importing, setImporting] = useState(false)

  const formatTime = (time: string | null) => time ? dayjs.utc(time).local().format('MM-DD HH:mm') : '-'
  const getOperationColor = (op: string | null): 'default' | 'secondary' | 'destructive' =>
    op?.toLowerCase() === 'buy' ? 'default' : op?.toLowerCase() === 'sell' ? 'destructive' : 'secondary'

  const fetchTasks = useCallback(async () => {
    if (accountId === 'all') return
    setLoadingTasks(true)
    try {
      const data = await listBacktestTasks(Number(accountId))
      setTasks(data.tasks || [])
    } catch (error) {
      console.error('Failed to fetch tasks:', error)
    } finally {
      setLoadingTasks(false)
    }
  }, [accountId])

  const pollTaskStatus = useCallback(async (taskId: number) => {
    const poll = async () => {
      try {
        const status = await getBacktestTaskStatus(taskId)
        setSelectedTask(status)
        if (status.status === 'running' || status.status === 'pending') {
          setTimeout(poll, 3000)
        } else {
          const resultData = await getBacktestTaskResults(taskId)
          setResults(resultData.items)
          setSummary(resultData.summary)
          fetchTasks()
        }
      } catch (error) {
        console.error('Failed to poll task status:', error)
      }
    }
    poll()
  }, [fetchTasks])

  const selectTask = async (task: BacktestTask) => {
    setSelectedTask(task)
    setSelectedItem(null)
    setResults([])
    setSummary(null)
    if (task.status === 'running' || task.status === 'pending') {
      pollTaskStatus(task.id)
    } else {
      setLoadingResults(true)
      try {
        const resultData = await getBacktestTaskResults(task.id)
        setResults(resultData.items)
        setSummary(resultData.summary)
      } catch (error) {
        console.error('Failed to fetch results:', error)
      } finally {
        setLoadingResults(false)
      }
    }
  }

  const viewItemDetail = async (itemId: number) => {
    setLoadingDetail(true)
    try {
      const detail = await getBacktestItemDetail(itemId)
      setSelectedItem(detail)
    } catch (error) {
      console.error('Failed to fetch item detail:', error)
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleRetry = async () => {
    if (!selectedTask) return
    setRetrying(true)
    try {
      const result = await retryBacktestTask(selectedTask.id)
      if (result.success) {
        pollTaskStatus(selectedTask.id)
      }
    } catch (error) {
      console.error('Failed to retry:', error)
    } finally {
      setRetrying(false)
    }
  }

  const handleImport = async () => {
    if (!selectedTask || !onImportToWorkspace) return
    setImporting(true)
    try {
      const data = await getBacktestTaskItems(selectedTask.id)
      onImportToWorkspace(data.items)
      onOpenChange(false)  // Close modal after import
    } catch (error) {
      console.error('Failed to import:', error)
    } finally {
      setImporting(false)
    }
  }

  useEffect(() => {
    if (open) fetchTasks()
  }, [open, fetchTasks])

  useEffect(() => {
    if (open && initialTaskId && tasks.length > 0) {
      const task = tasks.find(t => t.id === initialTaskId)
      if (task) selectTask(task)
    }
  }, [open, initialTaskId, tasks])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1600px] w-[95vw] h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle>{t('promptBacktest.backtestHistory', 'Backtest History')}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 flex min-h-0">
          {/* Left: Task List */}
          <div className="w-72 border-r flex flex-col">
            <div className="p-3 border-b text-sm font-medium">{t('promptBacktest.tasks', 'Tasks')}</div>
            <ScrollArea className="flex-1">
              <div className="p-2 space-y-1">
                {loadingTasks ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : tasks.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    {t('promptBacktest.noTasks', 'No tasks yet')}
                  </div>
                ) : (
                  tasks.map(task => (
                    <div
                      key={task.id}
                      className={`p-2 rounded cursor-pointer text-sm ${
                        selectedTask?.id === task.id ? 'bg-accent' : 'hover:bg-muted/50'
                      }`}
                      onClick={() => selectTask(task)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate">{task.name || `Task #${task.id}`}</span>
                        <Badge
                          variant={task.status === 'completed' ? 'default' : task.status === 'failed' ? 'destructive' : 'secondary'}
                          className="text-xs shrink-0 ml-1"
                        >
                          {task.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {formatTime(task.created_at)} · {task.total_count} items
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
          {/* Middle: Results */}
          <div className="flex-1 border-r flex flex-col min-w-0">
            <div className="p-3 border-b text-sm font-medium flex items-center justify-between">
              <span>{t('promptBacktest.results', 'Results')}</span>
              {selectedTask && selectedTask.status === 'completed' && onImportToWorkspace && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleImport}
                  disabled={importing}
                >
                  {importing ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Download className="h-3 w-3 mr-1" />
                  )}
                  {t('promptBacktest.importToWorkspace', 'Import')}
                </Button>
              )}
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3">
                {!selectedTask ? (
                  <div className="text-center py-12 text-sm text-muted-foreground">
                    {t('promptBacktest.selectTaskHint', 'Select a task to view results')}
                  </div>
                ) : selectedTask.status === 'running' || selectedTask.status === 'pending' ? (
                  <div className="text-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
                    <p className="text-sm font-medium">{t('promptBacktest.running', 'Running...')}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {selectedTask.completed_count} / {selectedTask.total_count}
                    </p>
                  </div>
                ) : loadingResults ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {summary && (
                      <div className="grid grid-cols-2 gap-2 text-xs p-2 bg-muted/50 rounded">
                        <div>
                          <span className="text-muted-foreground">{t('promptBacktest.total', 'Total')}:</span> {summary.total}
                        </div>
                        <div>
                          <span className="text-muted-foreground">{t('promptBacktest.changed', 'Changed')}:</span> {summary.changed}
                        </div>
                        <div className="text-green-600">
                          {t('promptBacktest.avoidedLoss', 'Avoided')}: {summary.avoided_loss_count} (${Math.abs(summary.avoided_loss_amount).toFixed(0)})
                        </div>
                        <div className="text-red-600">
                          {t('promptBacktest.missedProfit', 'Missed')}: {summary.missed_profit_count} (${summary.missed_profit_amount.toFixed(0)})
                        </div>
                      </div>
                    )}
                    {summary && summary.failed > 0 && (
                      <div className="flex items-center justify-between p-2 bg-destructive/10 rounded text-xs">
                        <span className="text-destructive">{summary.failed} failed</span>
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleRetry} disabled={retrying}>
                          {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3 mr-1" />}
                          {t('promptBacktest.retry', 'Retry')}
                        </Button>
                      </div>
                    )}
                    <div className="space-y-1">
                      {results.map(item => (
                        <div
                          key={item.id}
                          className={`p-2 rounded cursor-pointer text-xs border ${
                            selectedItem?.id === item.id ? 'border-primary bg-accent' : 'hover:bg-muted/50'
                          }`}
                          onClick={() => viewItemDetail(item.id)}
                        >
                          <div className="flex items-center justify-between">
                            <span>{formatTime(item.original_decision_time)}</span>
                            <div className="flex items-center gap-1">
                              <Badge variant={getOperationColor(item.original_operation)} className="text-xs">
                                {item.original_operation}
                              </Badge>
                              {item.decision_changed && (
                                <>
                                  <ChevronRight className="h-3 w-3" />
                                  <Badge variant={getOperationColor(item.new_operation)} className="text-xs">
                                    {item.new_operation}
                                  </Badge>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between mt-1 text-muted-foreground">
                            <span>{item.original_symbol || '-'}</span>
                            <span className={item.original_realized_pnl && item.original_realized_pnl < 0 ? 'text-red-600' : 'text-green-600'}>
                              {item.original_realized_pnl ? `$${item.original_realized_pnl.toFixed(2)}` : '-'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
          {/* Right: Detail */}
          <div className="w-[400px] flex flex-col">
            <div className="p-3 border-b text-sm font-medium">{t('promptBacktest.detail', 'Detail')}</div>
            <ScrollArea className="flex-1">
              <div className="p-4">
                {!selectedItem ? (
                  <div className="text-center py-12 text-sm text-muted-foreground">
                    {t('promptBacktest.selectItemHint', 'Select a result to view detail')}
                  </div>
                ) : loadingDetail ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-medium mb-2">{t('promptBacktest.originalDecision', 'Original')}</h4>
                      <Badge variant={getOperationColor(selectedItem.original_operation)} className="mb-2">
                        {selectedItem.original_operation} {selectedItem.original_symbol || ''}
                      </Badge>
                      <div className="bg-muted p-3 rounded text-xs max-h-48 overflow-auto">
                        <pre className="whitespace-pre-wrap">{selectedItem.original_reasoning || 'No reasoning'}</pre>
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium mb-2">{t('promptBacktest.newDecision', 'New')}</h4>
                      <Badge variant={getOperationColor(selectedItem.new_operation)} className="mb-2">
                        {selectedItem.new_operation || '-'}
                      </Badge>
                      <div className="bg-muted p-3 rounded text-xs max-h-48 overflow-auto">
                        <pre className="whitespace-pre-wrap">{selectedItem.new_reasoning || 'No reasoning'}</pre>
                      </div>
                    </div>
                    {selectedItem.decision_changed && (
                      <div className="p-3 bg-accent rounded text-sm">
                        <span className="font-medium">{t('promptBacktest.impact', 'Impact')}:</span>{' '}
                        {selectedItem.change_type}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
