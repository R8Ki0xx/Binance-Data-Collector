import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

// index.html reads the same key before the app loads, to avoid a flash of the wrong theme
const STORAGE_KEY = 'quantpilot-theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(
    () => readStoredTheme() ?? (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'),
  )

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
    root.style.colorScheme = theme
  }, [theme])

  // Follow the system setting until the user picks a theme
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY)
    const onChange = () => {
      if (!readStoredTheme()) setTheme(media.matches ? 'dark' : 'light')
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Private mode: the choice just lasts for this visit
    }
    setTheme(next)
  }, [theme])

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
