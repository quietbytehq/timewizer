import type { SchoolSetup, Shift } from '../types'
import { inkOn } from '../color'
import type { Ink, TextStyle } from './ink'
import { type Item, type PageSpec, items } from './pages'

export type Paper = 'a4' | 'a3' | 'letter'
export const PAPERS: { id: Paper; label: string; mm: [number, number] }[] = [
  { id: 'a4', label: 'A4', mm: [210, 297] },
  { id: 'a3', label: 'A3', mm: [297, 420] },
  { id: 'letter', label: 'Letter', mm: [215.9, 279.4] },
]
export interface PrintOptions { paper: Paper; landscape: boolean; color: boolean; logo: boolean }
export const DEFAULT_OPTIONS: PrintOptions = { paper: 'a4', landscape: true, color: true, logo: true }

export function pageSize(o: PrintOptions): [number, number] {
  const [w, h] = PAPERS.find(p => p.id === o.paper)!.mm
  return o.landscape ? [h, w] : [w, h]
}

const PT = 25.4 / 72
const M = 10 // page margin, mm

interface Palette { ink: string; muted: string; line: string; head: string; headInk: string; side: string; band: string; empty: string; hatch: string }
const COLOUR: Palette = { ink: '#18343F', muted: '#5A6468', line: '#C9BCA6', head: '#18343F', headInk: '#EFE6D8', side: '#EFE6D8', band: '#F3EBDD', empty: '#FFFFFF', hatch: '#C9BCA6' }
const BW: Palette = { ink: '#000000', muted: '#444444', line: '#000000', head: '#FFFFFF', headInk: '#000000', side: '#FFFFFF', band: '#EEEEEE', empty: '#FFFFFF', hatch: '#888888' }

/** Shrinks text until it fits, and cuts it with "…" as a last resort. */
function fit(ink: Ink, s: string, st: TextStyle, maxW: number, minSize = 5.5): { s: string; st: TextStyle } {
  let cur = { ...st }
  while (ink.measure(s, cur) > maxW && cur.size > minSize) cur = { ...cur, size: Math.max(minSize, cur.size - 0.5) }
  if (ink.measure(s, cur) <= maxW) return { s, st: cur }
  let t = s
  while (t.length > 1 && ink.measure(t + '…', cur) > maxW) t = t.slice(0, -1)
  return { s: t + '…', st: cur }
}

function hatch(ink: Ink, x: number, y: number, w: number, h: number, color: string) {
  ink.rect(x, y, w, h, { fill: color === '#888888' ? '#F2F2F2' : '#F1EADD' })
  const step = 2.6
  for (let t = -h; t < w; t += step) {
    // a diagonal from bottom-left to top-right, cut to the rectangle
    let x1 = x + t, y1 = y + h, x2 = x + t + h, y2 = y
    if (x1 < x) { y1 -= x - x1; x1 = x }
    if (x2 > x + w) { y2 += x2 - (x + w); x2 = x + w }
    if (x1 < x2) ink.line(x1, y1, x2, y2, color, 0.15)
  }
}

function header(ink: Ink, setup: SchoolSetup, spec: PageSpec, o: PrintOptions, p: Palette) {
  const { w } = ink
  let x = M
  if (o.logo && setup.logo) {
    const sz = ink.imageSize(setup.logo)
    const box = 17
    const k = Math.min(box / sz.w, box / sz.h)
    ink.image(setup.logo, M, M, sz.w * k, sz.h * k)
    x = M + box + 4
  }
  const school = setup.name.trim() || 'Timetable'
  const f = fit(ink, school, { size: 17, bold: true, serif: true, color: p.ink }, w * 0.5 - x)
  ink.text(f.s, x, M + 1, f.st)
  const sub = fit(ink, spec.subtitle, { size: 9, color: p.muted }, w * 0.5 - x, 6)
  ink.text(sub.s, x, M + 9.5, sub.st)
  const t = fit(ink, spec.title, { size: 22, bold: true, serif: true, color: p.ink, align: 'right' }, w * 0.45, 12)
  ink.text(t.s, w - M, M + 1, t.st)
  ink.line(M, M + 19.5, w - M, M + 19.5, p.ink, 0.4)
}

function footer(ink: Ink, p: Palette) {
  const st = { size: 6.5, color: p.muted }
  ink.text('Created with Timewizer', M, ink.h - M - 2, st)
  ink.text(`Printed ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, ink.w - M, ink.h - M - 2, { ...st, align: 'right' })
}

const dayList = (setup: SchoolSetup, shift: Shift) =>
  setup.days.map((d, i) => ({ d, i })).filter(x => x.d.working && (shift.days[x.i]?.length ?? 0) > 0)

/** Text lines for a lesson tile, most important first. */
function lines(kind: PageSpec['kind'], it: Item): string[] {
  if (kind === 'master') return [it.subjectShort, it.teacherShorts.join('/')].filter(Boolean)
  if (kind === 'class') return [it.subject, it.teachers.join(', '), it.room ?? ''].filter(Boolean)
  if (kind === 'teacher') return [it.subject, it.classes.join(', '), it.room ?? ''].filter(Boolean)
  return [it.subject, it.classes.join(', '), it.teachers.join(', ')].filter(Boolean)
}

function tile(ink: Ink, kind: PageSpec['kind'], it: Item, x: number, y: number, w: number, h: number, o: PrintOptions) {
  const fill = o.color ? it.color : '#FFFFFF'
  ink.rect(x + 0.4, y + 0.4, w - 0.8, h - 0.8, { fill, stroke: o.color ? undefined : '#000000', lw: 0.3, r: o.color ? 1.2 : 0 })
  const text = o.color ? inkOn(it.color) : '#000000'
  const ls = lines(kind, it)
  const small = kind === 'master'
  const maxSize = small ? 7 : 11
  const lineH = (pt: number) => pt * PT * 1.25
  // choose a size so that all lines fit in the tile's height
  let size = Math.min(maxSize, (h - 1.6) / (ls.length * 1.25 * PT * (small ? 0.9 : 0.93)))
  size = Math.max(small ? 4.5 : 6, size)
  const padX = small ? 0.9 : 1.6
  const rendered = ls.map((s, i) => {
    const base: TextStyle = { size: i === 0 ? size : size * 0.82, bold: i === 0, color: text }
    // prefer the full subject name; fall back to the short name when it will not fit
    if (i === 0 && kind !== 'master' && ink.measure(s, base) > w - 2 * padX && size > 7) {
      const alt = fit(ink, s, base, w - 2 * padX, 7)
      if (alt.s === s || ink.measure(it.subjectShort, alt.st) <= w - 2 * padX) return alt.s === s ? alt : fit(ink, it.subjectShort, base, w - 2 * padX)
      return alt
    }
    return fit(ink, s, base, w - 2 * padX)
  })
  const total = rendered.reduce((a, r) => a + lineH(r.st.size), 0)
  let ty = y + Math.max(0.8, (h - total) / 2)
  for (const r of rendered) {
    ink.text(r.s, x + padX, ty, r.st)
    ty += lineH(r.st.size)
  }
}

function drawEntity(ink: Ink, setup: SchoolSetup, spec: PageSpec, all: Item[], o: PrintOptions, p: Palette) {
  const shift = setup.shifts.find(s => s.id === spec.shiftId)
  if (!shift) return
  const days = dayList(setup, shift)
  const periods = Math.max(1, ...days.map(d => shift.days[d.i].length))
  const mine = all.filter(it => it.shiftId === shift.id && (
    spec.kind === 'class' ? it.classIds.includes(spec.id!) : spec.kind === 'teacher' ? it.teacherIds.includes(spec.id!) : it.roomId === spec.id))
  const x0 = M, y0 = M + 24
  const sideW = 24, headH = 8
  const dayW = (ink.w - 2 * M - sideW) / Math.max(1, days.length)
  const breakAfter = new Set(shift.breaks.map(b => b.afterPeriod))
  const breakH = 4.5
  const avail = ink.h - M - 9 - (y0 + headH)
  const rowH = Math.min(30, (avail - breakAfter.size * breakH) / periods)
  const rowY: number[] = []
  let y = y0 + headH
  const breakY: number[] = []
  for (let r = 0; r < periods; r++) {
    rowY.push(y)
    y += rowH
    if (breakAfter.has(r + 1) && r + 1 < periods) { breakY.push(y); y += breakH }
  }
  const bottom = y

  // headings
  ink.rect(x0, y0, sideW, headH, { fill: p.head, stroke: o.color ? undefined : '#000000', lw: 0.35 })
  ink.text('Period', x0 + sideW / 2, y0 + 2.3, { size: 8, bold: true, color: p.headInk, align: 'center' })
  days.forEach((d, c) => {
    const x = x0 + sideW + c * dayW
    ink.rect(x, y0, dayW, headH, { fill: p.head, stroke: o.color ? undefined : '#000000', lw: 0.35 })
    ink.text(d.d.name, x + dayW / 2, y0 + 2, { size: 11, bold: true, color: p.headInk, align: 'center' })
  })
  const first = days[0]
  for (let r = 0; r < periods; r++) {
    ink.rect(x0, rowY[r], sideW, rowH, { fill: p.side, stroke: p.line, lw: 0.25 })
    ink.text(String(r + 1), x0 + sideW / 2, rowY[r] + Math.max(1, rowH / 2 - 5.2), { size: 13, bold: true, color: p.ink, align: 'center' })
    const t = shift.days[first.i][r]
    if (t) ink.text(`${t.start}–${t.end}`, x0 + sideW / 2, rowY[r] + Math.max(1, rowH / 2 - 5.2) + 6, { size: 6.5, color: p.muted, align: 'center' })
  }
  for (const by of breakY) {
    ink.rect(x0, by, sideW + days.length * dayW, breakH, { fill: p.band, stroke: p.line, lw: 0.2 })
    ink.text('Break', x0 + sideW / 2, by + 1.1, { size: 6, color: p.muted, align: 'center' })
  }
  // cells
  const spanH = (r: number, len: number) => rowY[Math.min(periods - 1, r + len - 1)] + rowH - rowY[r]
  days.forEach((d, c) => {
    const x = x0 + sideW + c * dayW
    const n = shift.days[d.i].length
    for (let r = 0; r < periods; r++) {
      if (r >= n) { hatch(ink, x, rowY[r], dayW, rowH, p.hatch); ink.rect(x, rowY[r], dayW, rowH, { stroke: p.line, lw: 0.2 }); continue }
      ink.rect(x, rowY[r], dayW, rowH, { fill: p.empty, stroke: p.line, lw: 0.2 })
      const t = shift.days[d.i][r], ref = shift.days[first.i][r]
      if (t && ref && (t.start !== ref.start || t.end !== ref.end)) {
        ink.text(`${t.start}–${t.end}`, x + dayW - 1, rowY[r] + rowH - 3.3, { size: 5.5, color: p.muted, align: 'right' })
      }
    }
    for (let r = 0; r < n; r++) {
      const starting = mine.filter(it => it.day === d.i && it.period === r + 1)
      if (!starting.length) continue
      const len = Math.max(...starting.map(it => it.length))
      const h = spanH(r, len) / starting.length
      starting.forEach((it, k) => tile(ink, spec.kind, it, x, rowY[r] + k * h, dayW, h, o))
    }
  })
  ink.rect(x0, y0, sideW + days.length * dayW, bottom - y0, { stroke: p.ink, lw: 0.4 })
}

function drawMaster(ink: Ink, setup: SchoolSetup, spec: PageSpec, all: Item[], o: PrintOptions, p: Palette) {
  const shift = setup.shifts.find(s => s.id === spec.shiftId)
  if (!shift) return
  const days = dayList(setup, shift)
  const total = days.reduce((a, d) => a + shift.days[d.i].length, 0)
  const classes = (spec.classIds ?? []).map(id => setup.master.classes.find(c => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c)
  const x0 = M, y0 = M + 24
  const sideW = 17, dayHead = 7, perHead = 5
  const cw = (ink.w - 2 * M - sideW) / Math.max(1, total)
  const avail = ink.h - M - 9 - (y0 + dayHead + perHead)
  const rowH = Math.min(18, avail / Math.max(1, classes.length))
  const stroke = o.color ? undefined : '#000000'
  ink.rect(x0, y0, sideW, dayHead + perHead, { fill: p.head, stroke, lw: 0.35 })
  ink.text('Class', x0 + sideW / 2, y0 + 3.4, { size: 8, bold: true, color: p.headInk, align: 'center' })
  const colX: number[][] = []
  let col = 0
  days.forEach(d => {
    const n = shift.days[d.i].length
    const x = x0 + sideW + col * cw
    ink.rect(x, y0, n * cw, dayHead, { fill: p.head, stroke, lw: 0.35 })
    ink.text(d.d.name, x + (n * cw) / 2, y0 + 1.4, { size: 9, bold: true, color: p.headInk, align: 'center' })
    colX.push(Array.from({ length: n }, (_, k) => x + k * cw))
    for (let k = 0; k < n; k++) {
      ink.rect(x + k * cw, y0 + dayHead, cw, perHead, { fill: p.head, stroke, lw: 0.2 })
      ink.text(String(k + 1), x + k * cw + cw / 2, y0 + dayHead + 1.1, { size: 7, color: p.headInk, align: 'center' })
    }
    col += n
  })
  classes.forEach((c, r) => {
    const y = y0 + dayHead + perHead + r * rowH
    ink.rect(x0, y, sideW, rowH, { fill: p.side, stroke: p.line, lw: 0.25 })
    const f = fit(ink, c.shortName.trim() || c.name.trim(), { size: 11, bold: true, color: p.ink, align: 'center' }, sideW - 2, 6)
    ink.text(f.s, x0 + sideW / 2, y + rowH / 2 - f.st.size * PT * 0.6, f.st)
    days.forEach((d, di) => {
      for (let k = 0; k < shift.days[d.i].length; k++) ink.rect(colX[di][k], y, cw, rowH, { fill: p.empty, stroke: p.line, lw: 0.15 })
      const here = all.filter(it => it.shiftId === shift.id && it.day === d.i && it.classIds.includes(c.id))
      const starts = Array.from(new Set(here.map(it => it.period)))
      for (const ps of starts) {
        const group = here.filter(it => it.period === ps)
        const len = Math.max(...group.map(it => it.length))
        const x = colX[di][ps - 1]
        if (x === undefined) continue
        const w = Math.min(len, shift.days[d.i].length - ps + 1) * cw
        group.forEach((it, g) => tile(ink, 'master', it, x, y + (g * rowH) / group.length, w, rowH / group.length, o))
      }
    })
  })
  const bottom = y0 + dayHead + perHead + classes.length * rowH
  // heavier line between days
  colX.forEach(xs => ink.line(xs[0], y0, xs[0], bottom, p.ink, 0.5))
  ink.line(x0 + sideW + total * cw, y0, x0 + sideW + total * cw, bottom, p.ink, 0.5)
  ink.rect(x0, y0, sideW + total * cw, bottom - y0, { stroke: p.ink, lw: 0.4 })
}

/** Draws one printed page. */
export function drawPage(ink: Ink, setup: SchoolSetup, spec: PageSpec, o: PrintOptions) {
  const p = o.color ? COLOUR : BW
  const all = items(setup)
  header(ink, setup, spec, o, p)
  if (spec.kind === 'master') drawMaster(ink, setup, spec, all, o, p)
  else drawEntity(ink, setup, spec, all, o, p)
  footer(ink, p)
}
