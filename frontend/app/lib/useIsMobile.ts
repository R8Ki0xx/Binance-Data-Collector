import { useState, useEffect } from 'react'

// Mobile breakpoint: 768px (Tailwind's md breakpoint)
// Devices below 768px are considered mobile
const MOBILE_BREAKPOINT = 768

/**
 * Hook to detect if the current viewport is mobile-sized.
 * Uses window.matchMedia for reliable detection that responds to:
 * - Screen rotation
 * - Window resize
 * - Initial render (with SSR safety)
 *
 * @returns boolean - true if viewport width < 768px
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    // Create media query for mobile detection
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)

    // Set initial value
    setIsMobile(mediaQuery.matches)

    // Handler for media query changes
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches)
    }

    // Add listener (using addEventListener for modern browsers)
    mediaQuery.addEventListener('change', handleChange)

    // Cleanup
    return () => {
      mediaQuery.removeEventListener('change', handleChange)
    }
  }, [])

  return isMobile
}

export default useIsMobile
