import type { PeriodTime, Shift } from './types'

export function toMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t)
  if (!m) return null
  const v = Number(m[1]) * 60 + Number(m[2])
  return v < 24 * 60 ? v : null
}

export function fmt(mins: number): string {
  const m = Math.max(0, Math.min(mins, 24 * 60 - 1))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Builds a day's periods: equal-length periods, with a gap after each break of the shift. */
export function buildDay(shift: Shift, startTime: string, count: number, length: number, breakMinutes: number): PeriodTime[] {
  let t = toMinutes(startTime) ?? 8 * 60
  const out: PeriodTime[] = []
  for (let i = 1; i <= count; i++) {
    out.push({ start: fmt(t), end: fmt(t + length) })
    t += length
    if (shift.breaks.some(b => b.afterPeriod === i)) t += breakMinutes
  }
  return out
}
