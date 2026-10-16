// A tiny drawing surface with two back ends: a PDF page and a canvas (for PNG and the preview).
// Everything is measured in millimetres on the paper, so both back ends look the same.
import { jsPDF } from 'jspdf'

export interface RectStyle { fill?: string; stroke?: string; lw?: number; r?: number }
export interface TextStyle { size: number; bold?: boolean; color?: string; align?: 'left' | 'center' | 'right'; serif?: boolean; italic?: boolean }

export interface Ink {
  readonly w: number
  readonly h: number
  rect(x: number, y: number, w: number, h: number, s: RectStyle): void
  line(x1: number, y1: number, x2: number, y2: number, color: string, lw: number): void
  /** y is the top of the text line */
  text(s: string, x: number, y: number, st: TextStyle): void
  measure(s: string, st: TextStyle): number
  image(dataUrl: string, x: number, y: number, w: number, h: number): void
  imageSize(dataUrl: string): { w: number; h: number }
}

const PT = 25.4 / 72 // millimetres in a point
const SANS = 'Helvetica, Arial, "Liberation Sans", sans-serif'
const SERIF = 'Georgia, "Times New Roman", "Liberation Serif", serif'

export class CanvasInk implements Ink {
  readonly canvas: HTMLCanvasElement
  readonly w: number
  readonly h: number
  readonly scale: number
  private ctx: CanvasRenderingContext2D
  private images = new Map<string, HTMLImageElement>()
  constructor(canvas: HTMLCanvasElement, w: number, h: number, scale: number) {
    this.canvas = canvas; this.w = w; this.h = h; this.scale = scale
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    this.ctx = canvas.getContext('2d')!
    this.ctx.fillStyle = '#FFFFFF'
    this.ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  /** Pictures must be decoded before drawing starts. */
  async preload(dataUrl: string) {
    if (this.images.has(dataUrl)) return
    const img = new Image()
    await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error('picture')); img.src = dataUrl })
    this.images.set(dataUrl, img)
  }
  private font(st: TextStyle) {
    return `${st.italic ? 'italic ' : ''}${st.bold ? 'bold ' : ''}${st.size * PT * this.scale}px ${st.serif ? SERIF : SANS}`
  }
  rect(x: number, y: number, w: number, h: number, s: RectStyle) {
    const c = this.ctx, k = this.scale
    c.beginPath()
    if (s.r && s.r > 0) c.roundRect(x * k, y * k, w * k, h * k, s.r * k)
    else c.rect(x * k, y * k, w * k, h * k)
    if (s.fill) { c.fillStyle = s.fill; c.fill() }
    if (s.stroke) { c.strokeStyle = s.stroke; c.lineWidth = (s.lw ?? 0.2) * k; c.stroke() }
  }
  line(x1: number, y1: number, x2: number, y2: number, color: string, lw: number) {
    const c = this.ctx, k = this.scale
    c.beginPath(); c.moveTo(x1 * k, y1 * k); c.lineTo(x2 * k, y2 * k)
    c.strokeStyle = color; c.lineWidth = lw * k; c.stroke()
  }
  text(s: string, x: number, y: number, st: TextStyle) {
    const c = this.ctx
    c.font = this.font(st)
    c.fillStyle = st.color ?? '#000000'
    c.textBaseline = 'top'
    c.textAlign = st.align ?? 'left'
    c.fillText(s, x * this.scale, y * this.scale)
  }
  measure(s: string, st: TextStyle) {
    this.ctx.font = this.font(st)
    return this.ctx.measureText(s).width / this.scale
  }
  image(dataUrl: string, x: number, y: number, w: number, h: number) {
    const img = this.images.get(dataUrl)
    if (img) this.ctx.drawImage(img, x * this.scale, y * this.scale, w * this.scale, h * this.scale)
  }
  imageSize(dataUrl: string) {
    const img = this.images.get(dataUrl)
    return { w: img?.naturalWidth ?? 1, h: img?.naturalHeight ?? 1 }
  }
}

/** The standard PDF fonts only hold Western letters; anything else would print as rubbish. */
const winAnsi = (s: string) => s.replace(/[^ -~ -ÿ–—‘’“”•…€]/g, '?')

export class PdfInk implements Ink {
  private doc: jsPDF
  readonly w: number
  readonly h: number
  constructor(doc: jsPDF, w: number, h: number) {
    this.doc = doc; this.w = w; this.h = h
  }
  private rgb(hex: string): [number, number, number] {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex)
    const v = m ? parseInt(m[1], 16) : 0
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
  }
  private setFont(st: TextStyle) {
    this.doc.setFont(st.serif ? 'times' : 'helvetica', st.italic ? (st.bold ? 'bolditalic' : 'italic') : st.bold ? 'bold' : 'normal')
    this.doc.setFontSize(st.size)
  }
  rect(x: number, y: number, w: number, h: number, s: RectStyle) {
    const d = this.doc
    if (s.fill) d.setFillColor(...this.rgb(s.fill))
    if (s.stroke) { d.setDrawColor(...this.rgb(s.stroke)); d.setLineWidth(s.lw ?? 0.2) }
    const mode = s.fill && s.stroke ? 'FD' : s.fill ? 'F' : s.stroke ? 'S' : null
    if (!mode) return
    if (s.r && s.r > 0) d.roundedRect(x, y, w, h, s.r, s.r, mode)
    else d.rect(x, y, w, h, mode)
  }
  line(x1: number, y1: number, x2: number, y2: number, color: string, lw: number) {
    this.doc.setDrawColor(...this.rgb(color)); this.doc.setLineWidth(lw); this.doc.line(x1, y1, x2, y2)
  }
  text(s: string, x: number, y: number, st: TextStyle) {
    this.setFont(st)
    this.doc.setTextColor(...this.rgb(st.color ?? '#000000'))
    this.doc.text(winAnsi(s), x, y, { baseline: 'top', align: st.align ?? 'left' })
  }
  measure(s: string, st: TextStyle) {
    this.setFont(st)
    return this.doc.getTextWidth(winAnsi(s))
  }
  image(dataUrl: string, x: number, y: number, w: number, h: number) {
    this.doc.addImage(dataUrl, 'PNG', x, y, w, h)
  }
  imageSize(dataUrl: string) {
    const p = this.doc.getImageProperties(dataUrl)
    return { w: p.width, h: p.height }
  }
}
