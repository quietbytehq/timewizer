import { jsPDF } from 'jspdf'
import type { SchoolSetup, SheetDay } from '../types'

const INK = '#18343F', MUTED = '#5A6468', LINE = '#D8CCB8', HEAD = '#EFE6D8', DANGER = '#C0504D'
const COLS: { label: string; w: number }[] = [
  { label: 'Period', w: 16 }, { label: 'Time', w: 24 }, { label: 'Class', w: 30 }, { label: 'Subject', w: 28 },
  { label: 'Absent teacher', w: 30 }, { label: 'Cover teacher', w: 34 }, { label: 'Room', w: 18 },
]
const W = 210, H = 297, M = 15, ROW = 8

const toBase64 = (buf: ArrayBuffer) => {
  let s = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** The cover sheet: one A4 page per day (more if a day has many lessons), ready to print. Base64. */
export function coverSheetPdf(setup: SchoolSetup, days: SheetDay[]): string {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  doc.setProperties({ title: `${setup.name} cover sheet`, creator: 'Timewizer' })
  const fit = (text: string, w: number) => (doc.splitTextToSize(text, w - 2) as string[])[0] ?? ''
  let first = true
  const header = (title: string, more: boolean) => {
    if (!first) doc.addPage('a4', 'portrait')
    first = false
    let logoW = 0
    if (setup.logo) {
      try {
        const p = doc.getImageProperties(setup.logo)
        const h = 16, w = Math.min(40, (p.width / p.height) * h)
        doc.addImage(setup.logo, W - M - w, M - 2, w, h)
        logoW = w + 4
      } catch { /* a picture jsPDF cannot read: leave it out */ }
    }
    doc.setTextColor(MUTED); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
    doc.text(fit(setup.name.toUpperCase(), W - 2 * M - logoW), M, M + 2)
    doc.setTextColor(INK); doc.setFont('times', 'bold'); doc.setFontSize(20)
    doc.text('Cover sheet', M, M + 11)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12)
    doc.text(title + (more ? ' (continued)' : ''), M, M + 18)
    let x = M
    const y = M + 24
    doc.setFillColor(HEAD); doc.rect(M, y, W - 2 * M, ROW, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(INK)
    for (const c of COLS) { doc.text(c.label, x + 1.5, y + 5.4); x += c.w }
    return y + ROW
  }
  for (const day of days) {
    let y = header(day.title, false)
    for (const r of day.rows) {
      if (y + ROW > H - M - 8) y = header(day.title, true)
      const cells = [r.shift && days.some(d => d.rows.some(x => x.shift !== r.shift)) ? `${r.shift} ${r.period}` : r.period,
        r.start && r.end ? `${r.start}-${r.end}` : '', r.classes, r.subject, r.absent, r.cover, r.room]
      let x = M
      doc.setDrawColor(LINE); doc.setLineWidth(0.2); doc.line(M, y + ROW, W - M, y + ROW)
      cells.forEach((text, i) => {
        const cover = i === 5
        doc.setFont('helvetica', cover ? 'bold' : 'normal'); doc.setFontSize(9.5)
        doc.setTextColor(cover && !r.covered ? DANGER : INK)
        doc.text(fit(text, COLS[i].w), x + 1.5, y + 5.4)
        x += COLS[i].w
      })
      y += ROW
    }
    const notes = [...new Set(day.rows.map(r => r.note).filter(Boolean))]
    if (notes.length) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(MUTED)
      doc.text(fit(`Notes: ${notes.join('; ')}`, W - 2 * M), M, Math.min(y + 6, H - M - 4))
    }
  }
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(MUTED)
    doc.text(`Cover sheet · page ${i} of ${pages} · made with Timewizer`, W / 2, H - 8, { align: 'center' })
  }
  return toBase64(doc.output('arraybuffer'))
}
