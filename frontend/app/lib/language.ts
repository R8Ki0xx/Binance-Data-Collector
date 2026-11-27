import type { i18n as I18n } from 'i18next'

export type UiLanguage = 'en' | 'zh'

/** Change the interface language and let the backend (chat bots) know. */
export function setUiLanguage(i18n: I18n, language: UiLanguage) {
  i18n.changeLanguage(language)
  fetch('/api/config/ui_language', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: language }),
  }).catch(() => {})
}
