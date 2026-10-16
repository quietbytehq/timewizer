import { jsPDF } from 'jspdf'
import type { SchoolSetup } from '../types'
import { CanvasInk, PdfInk } from './ink'
import { drawPage, pageSize, type PrintOptions } from './draw'
import type { PageSpec } from './pages'

/** Draws a page onto a canvas. `pxPerMm` 4 is a screen preview, 8 is about 200 dpi for PNG files. */
export async function renderToCanvas(canvas: HTMLCanvasElement, setup: SchoolSetup, spec: PageSpec, o: PrintOptions, pxPerMm: number) {
  const [w, h] = pageSize(o)
  const ink = new CanvasInk(canvas, w, h, pxPerMm)
  if (o.logo && setup.logo) await ink.preload(setup.logo)
  drawPage(ink, setup, spec, o)
}

const toBase64 = (buf: ArrayBuffer) => {
  let s = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** All pages in one PDF file, as base64. */
export function pdfBase64(setup: SchoolSetup, pages: PageSpec[], o: PrintOptions): string {
  const [w, h] = pageSize(o)
  const doc = new jsPDF({ orientation: o.landscape ? 'landscape' : 'portrait', unit: 'mm', format: [w, h].sort((a, b) => a - b), compress: true })
  doc.setProperties({ title: `${setup.name} timetables`, creator: 'Timewizer' })
  pages.forEach((spec, i) => {
    if (i > 0) doc.addPage([w, h].sort((a, b) => a - b), o.landscape ? 'landscape' : 'portrait')
    drawPage(new PdfInk(doc, w, h), setup, spec, o)
  })
  return toBase64(doc.output('arraybuffer'))
}

/** One page as a PNG picture, as base64. */
export async function pngBase64(setup: SchoolSetup, spec: PageSpec, o: PrintOptions): Promise<string> {
  const canvas = document.createElement('canvas')
  await renderToCanvas(canvas, setup, spec, o, 8)
  return canvas.toDataURL('image/png').split(',')[1]
}
