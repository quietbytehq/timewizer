export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'timewizer-theme'

export function getStoredTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* ignore */ }
  return 'system'
}

export function applyTheme(choice: ThemeChoice) {
  const dark =
    choice === 'dark' ||
    (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  try { localStorage.setItem(KEY, choice) } catch { /* ignore */ }
}
