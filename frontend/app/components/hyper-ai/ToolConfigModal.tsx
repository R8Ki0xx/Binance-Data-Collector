import { useState, useEffect } from 'react'
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
import { ExternalLink, Loader2, XCircle, Check, Trash2 } from 'lucide-react'

interface ConfigField {
  key: string
  type: string
  label: string
  label_zh?: string
  required: boolean
  placeholder?: string
}

export interface ToolInfo {
  name: string
  display_name: string
  display_name_zh: string
  description: string
  description_zh: string
  icon: string
  config_fields: ConfigField[]
  get_url?: string
  get_url_label?: string
  get_url_label_zh?: string
  configured: boolean
  enabled: boolean
}

interface ToolConfigModalProps {
  open: boolean
  onClose: () => void
  tool: ToolInfo | null
  onSaved: () => void
}

export default function ToolConfigModal({
  open,
  onClose,
  tool,
  onSaved,
}: ToolConfigModalProps) {
  const { t, i18n } = useTranslation()
  const isZh = i18n.language?.startsWith('zh')

  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (open) {
      setValues({})
      setError(null)
      setSuccess(false)
    }
  }, [open])

  if (!tool) return null

  const displayName = isZh ? tool.display_name_zh : tool.display_name
  const description = isZh ? tool.description_zh : tool.description
  const getUrlLabel = isZh ? tool.get_url_label_zh : tool.get_url_label

  const handleSave = async () => {
    // Check required fields
    for (const field of tool.config_fields) {
      if (field.required && !values[field.key]?.trim()) {
        setError(t('tools.fieldRequired', '{{field}} is required', {
          field: isZh ? (field.label_zh || field.label) : field.label
        }))
        return
      }
    }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/hyper-ai/tools/${tool.name}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: values, validate_key: true }),
      })
      const data = await res.json()
      if (!res.ok || data.success === false) {
        setError(data.error || data.detail || 'Save failed')
        return
      }
      setSuccess(true)
      onSaved()
      setTimeout(() => onClose(), 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    setRemoving(true)
    setError(null)
    try {
      const res = await fetch(`/api/hyper-ai/tools/${tool.name}/config`, {
        method: 'DELETE',
      })
      if (res.ok) {
        onSaved()
        onClose()
      }
    } catch (err) {
      setError('Remove failed')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{displayName}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {success ? (
            <div className="flex items-center gap-3 p-4 rounded-lg border bg-green-500/5 border-green-500/20">
              <Check className="w-5 h-5 text-green-500" />
              <span className="text-sm font-medium">{t('tools.configured', 'Configured successfully')}</span>
            </div>
          ) : (
            <>
              {/* Get URL link */}
              {tool.get_url && (
                <a
                  href={tool.get_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-3 rounded-lg border bg-muted/50 hover:bg-muted transition-colors"
                >
                  <ExternalLink className="w-4 h-4 text-primary" />
                  <span className="text-sm">{getUrlLabel || tool.get_url}</span>
                </a>
              )}

              {/* Config fields */}
              {tool.config_fields.map((field) => (
                <div key={field.key}>
                  <label className="text-sm font-medium mb-1 block">
                    {isZh ? (field.label_zh || field.label) : field.label}
                    {field.required && <span className="text-red-500 ml-0.5">*</span>}
                  </label>
                  <Input
                    type={field.type === 'secret' ? 'password' : 'text'}
                    placeholder={tool.configured
                      ? t('tools.keyConfigured', 'Enter new key to update')
                      : (field.placeholder || '')}
                    value={values[field.key] || ''}
                    onChange={(e) => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                    className="font-mono text-sm"
                  />
                </div>
              ))}

              {error && (
                <div className="flex items-center gap-2 text-sm text-red-500">
                  <XCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                {tool.configured && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRemove}
                    disabled={removing || saving}
                    className="text-red-500 hover:text-red-600"
                  >
                    {removing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </Button>
                )}
                <Button className="flex-1" onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {t('tools.validating', 'Validating...')}
                    </>
                  ) : (
                    t('tools.save', 'Save')
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
