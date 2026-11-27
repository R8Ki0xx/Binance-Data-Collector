import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const DEPTH_OPTIONS = [10, 20, 30, 45, 60]

/** Number of recent price samples the AI trader sees (global sampling pool). */
export default function SamplingDepthCard() {
  const { t } = useTranslation()
  const [depth, setDepth] = useState(10)
  const [interval, setIntervalSeconds] = useState(60)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/config/global-sampling')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(data => {
        setDepth(data.sampling_depth || 10)
        setIntervalSeconds(data.sampling_interval || 60)
      })
      .catch(() => toast.error(t('settings.samplingLoadFailed', 'Failed to load sampling configuration')))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/config/global-sampling', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampling_depth: depth }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success(t('settings.samplingSaved', 'Sampling depth saved'))
    } catch {
      toast.error(t('settings.samplingSaveFailed', 'Failed to save sampling depth'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('settings.samplingDepth', 'Sampling pool depth')}</CardTitle>
        <CardDescription>
          {t('settings.samplingDepthDesc', 'Recent price points given to the AI trader. Covers about {{minutes}} minutes.', {
            minutes: ((depth * interval) / 60).toFixed(0),
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        {DEPTH_OPTIONS.map(option => (
          <Button
            key={option}
            size="sm"
            variant={depth === option ? 'default' : 'outline'}
            onClick={() => setDepth(option)}
          >
            {option}
          </Button>
        ))}
        <Button size="sm" className="ml-auto" onClick={save} disabled={saving}>
          {saving ? t('settings.saving', 'Saving...') : t('settings.save', 'Save')}
        </Button>
      </CardContent>
    </Card>
  )
}
