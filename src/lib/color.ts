const lum = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0.5
  const v = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
}

const DARK = '#18343F'
const LIGHT = '#FFFFFF'

/** Text colour that stays readable on a subject colour: whichever of dark teal-navy or white contrasts more. */
export function inkOn(background: string): string {
  const l = lum(background)
  const dark = (l + 0.05) / (lum(DARK) + 0.05)
  const light = 1.05 / (l + 0.05)
  return dark >= light ? DARK : LIGHT
}
