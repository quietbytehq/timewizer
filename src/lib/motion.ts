/** How long the start-up animation shows before it fades out by itself (the fade adds 0.25 s; under 2 s in all). */
export const SPLASH_MS = 1450

export const prefersReducedMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}
