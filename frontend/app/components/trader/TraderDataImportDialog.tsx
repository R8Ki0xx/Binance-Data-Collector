import { useState, useRef } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Upload, FileJson, AlertTriangle, CheckCircle } from 'lucide-react'
import {
  previewTraderImport,
  executeTraderImport,
  type TraderExportData,
  type ImportPreviewResponse,
  type TradingAccount
} from '@/lib/api'

interface TraderDataImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: TradingAccount
  onImportComplete: () => void
}

type ImportStep = 'select' | 'preview' | 'importing' | 'done'

export default function TraderDataImportDialog({
  open,
  onOpenChange,
  account,
  onImportComplete
}: TraderDataImportDialogProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<ImportStep>('select')
  const [importData, setImportData] = useState<TraderExportData | null>(null)
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null)

  const resetState = () => {
    setStep('select')
    setImportData(null)
    setPreview(null)
    setLoading(false)
    setError(null)
    setImportResult(null)
  }

  const handleClose = () => {
    resetState()
    onOpenChange(false)
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setLoading(true)
      setError(null)
      const text = await file.text()
      const data = JSON.parse(text) as TraderExportData

      if (!data.decision_logs || !Array.isArray(data.decision_logs)) {
        throw new Error(t('traderData.invalidFormat'))
      }

      setImportData(data)
      const previewResult = await previewTraderImport(account.id, data)
      setPreview(previewResult)
      setStep('preview')
    } catch (err) {
      console.error('File parse error:', err)
      setError(err instanceof Error ? err.message : t('traderData.parseError'))
    } finally {
      setLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleImport = async () => {
    if (!importData) return
    try {
      setLoading(true)
      setStep('importing')
      const result = await executeTraderImport(account.id, importData, true)
      if (result.success) {
        setImportResult({
          imported: result.imported.decision_logs + result.imported.trades,
          skipped: result.skipped.decision_logs + result.skipped.trades
        })
        setStep('done')
        toast.success(t('traderData.importSuccess'))
      } else {
        throw new Error(result.errors.join(', ') || t('traderData.importFailed'))
      }
    } catch (err) {
      console.error('Import error:', err)
      setError(err instanceof Error ? err.message : t('traderData.importFailed'))
      setStep('preview')
    } finally {
      setLoading(false)
    }
  }

  // Render functions will be added via Edit
  const renderSelectStep = () => (
    <div className="space-y-4">
      <div
        className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground">{t('traderData.selectFile')}</p>
        <p className="text-xs text-muted-foreground mt-2">{t('traderData.jsonOnly')}</p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileSelect}
      />
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}
    </div>
  )

  const renderPreviewStep = () => (
    <div className="space-y-4">
      {importData && (
        <div className="bg-muted/50 rounded-lg p-4 space-y-2">
          <div className="flex items-center gap-2">
            <FileJson className="h-5 w-5 text-blue-500" />
            <span className="font-medium">{t('traderData.sourceTrader')}: {importData.account_name}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('traderData.exportedAt')}: {new Date(importData.exported_at).toLocaleString()}
          </p>
        </div>
      )}
      {preview && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle className="h-4 w-4" />
            <span>{t('traderData.willImport')}: {preview.will_import.decision_logs} {t('traderData.decisions')}, {preview.will_import.trades} {t('traderData.trades')}</span>
          </div>
          {(preview.will_skip.decision_logs > 0 || preview.will_skip.trades > 0) && (
            <div className="flex items-center gap-2 text-yellow-600">
              <AlertTriangle className="h-4 w-4" />
              <span>{t('traderData.willSkip')}: {preview.will_skip.decision_logs} {t('traderData.decisions')}, {preview.will_skip.trades} {t('traderData.trades')}</span>
            </div>
          )}
        </div>
      )}
      <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded text-sm">
        <AlertTriangle className="h-4 w-4 inline mr-2" />
        {t('traderData.importWarning')}
      </div>
    </div>
  )

  const renderDoneStep = () => (
    <div className="text-center space-y-4">
      <CheckCircle className="h-16 w-16 mx-auto text-green-500" />
      <p className="text-lg font-medium">{t('traderData.importComplete')}</p>
      {importResult && (
        <p className="text-sm text-muted-foreground">
          {t('traderData.importedCount', { count: importResult.imported })}
        </p>
      )}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t('traderData.importTitle')}</DialogTitle>
          <DialogDescription>
            {t('traderData.importTo', { name: account.name })}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          {loading && step !== 'done' ? (
            <div className="text-center py-8">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
              <p className="text-sm text-muted-foreground">
                {step === 'importing' ? t('traderData.importing') : t('common.loading')}
              </p>
            </div>
          ) : (
            <>
              {step === 'select' && renderSelectStep()}
              {step === 'preview' && renderPreviewStep()}
              {step === 'done' && renderDoneStep()}
            </>
          )}
        </div>
        <DialogFooter>
          {step === 'select' && (
            <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={resetState}>{t('common.back')}</Button>
              <Button onClick={handleImport} disabled={loading}>{t('traderData.confirmImport')}</Button>
            </>
          )}
          {step === 'done' && (
            <Button onClick={() => { handleClose(); onImportComplete(); }}>{t('common.close')}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
