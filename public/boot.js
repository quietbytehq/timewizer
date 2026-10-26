// Runs before anything is drawn: picks light or dark (as src/lib/theme.ts does), so the
// logo shown while Timewizer starts sits on the right background.
try {
  var t = localStorage.getItem('timewizer-theme')
  if (t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark')
} catch (e) { /* the app sets the theme itself a moment later */ }
