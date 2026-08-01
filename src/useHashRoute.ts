import { useEffect, useState } from 'react'

/**
 * Hash routing, deliberately.
 *
 * GitHub Pages has no server to rewrite unknown paths onto index.html, so a
 * history-API router turns every deep link into a 404 unless you keep a
 * duplicate 404.html around. A hash costs one character of ugliness and makes
 * the problem disappear.
 */
export function useHashRoute(): string {
  const read = () => window.location.hash.replace(/^#\/?/, '')
  const [route, setRoute] = useState(read)

  useEffect(() => {
    const onChange = () => setRoute(read())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return route
}

export function href(route: string): string {
  return `#/${route}`
}
