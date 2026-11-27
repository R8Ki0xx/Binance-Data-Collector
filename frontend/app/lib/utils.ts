import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Copy text to clipboard with fallback for non-secure contexts.
 * navigator.clipboard is only available in secure contexts (HTTPS or localhost).
 * This function provides a fallback using execCommand for HTTP environments.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Try modern Clipboard API first (requires secure context)
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (err) {
      console.warn('Clipboard API failed, trying fallback:', err)
    }
  }

  // Fallback for non-secure contexts (HTTP with non-localhost)
  try {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.style.position = 'fixed'
    textArea.style.left = '-9999px'
    textArea.style.top = '-9999px'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    const success = document.execCommand('copy')
    document.body.removeChild(textArea)
    if (!success) {
      throw new Error('execCommand copy failed')
    }
    return true
  } catch (err) {
    console.error('Failed to copy text:', err)
    return false
  }
}
