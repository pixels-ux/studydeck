export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'studydeck:theme'
const DARK = '(prefers-color-scheme: dark)'

/** What the student picked last time; "system" until they pick otherwise. */
export function themeChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.(DARK).matches ?? false
}

/** The browser paints its own chrome with this, so it has to match the page. */
const BROWSER_CHROME = { light: '#f4f2ea', dark: '#0d1411' }

function paintBrowserChrome(theme: 'light' | 'dark'): void {
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', BROWSER_CHROME[theme])
}

/** Paints the page and says which theme is now showing. */
export function applyTheme(choice: ThemeChoice): 'light' | 'dark' {
  const dark = choice === 'dark' || (choice === 'system' && systemPrefersDark())
  const theme = dark ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme
  paintBrowserChrome(theme)
  return theme
}

let following = false

/** With "system", a change in the OS theme is followed straight away. */
function followSystem(): void {
  if (following || !window.matchMedia) return
  following = true
  window
    .matchMedia(DARK)
    .addEventListener('change', () => {
      if (themeChoice() === 'system') applyTheme('system')
    })
}

export function rememberTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') window.localStorage.removeItem(KEY)
    else window.localStorage.setItem(KEY, choice)
  } catch {
    // Storage can be turned off; the choice still holds for this visit.
  }
  applyTheme(choice)
  followSystem()
}
