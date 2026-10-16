import { useEffect, useMemo, useRef, useState } from 'react'
import { FileSpreadsheet, FileText, Image as ImageIcon, Table2 } from 'lucide-react'
import { api, errText } from '@/lib/api'
import type { SchoolSetup } from '@/lib/types'
import { DEFAULT_OPTIONS, PAPERS, type Paper, type PrintOptions } from '@/lib/print/draw'
import { pdfBase64, pngBase64, renderToCanvas } from '@/lib/print/export'
import { everything, pagesFor, safeName, type Selection } from '@/lib/print/pages'
import { Button, Card, inputCls, inputStyle, Toggle } from './ui'

const KEY = 'timewizer-print-options'
const loadOptions = (): PrintOptions => {
  try { return { ...DEFAULT_OPTIONS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { return DEFAULT_OPTIONS }
}

function Group({ title, ids, names, chosen, onChange }: { title: string; ids: string[]; names: Record<string, string>; chosen: string[]; onChange: (v: string[]) => void }) {
  const all = ids.length > 0 && ids.every(i => chosen.includes(i))
  return (
    <details className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--line)', background: 'var(--bg)' }}>
      <summary className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
        <input type="checkbox" aria-label={`All ${title.toLowerCase()}`} checked={all} disabled={ids.length === 0}
          onClick={e => e.stopPropagation()} onChange={e => onChange(e.target.checked ? ids : [])} />
        {title}
        <span className="font-normal" style={{ color: 'var(--muted)' }}>{chosen.length} of {ids.length}</span>
      </summary>
      <div className="mt-3 flex max-h-48 flex-wrap gap-x-5 gap-y-2 overflow-auto">
        {ids.map(id => (
          <label key={id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={chosen.includes(id)} onChange={e => onChange(e.target.checked ? [...chosen, id] : chosen.filter(x => x !== id))} />
            {names[id]}
          </label>
        ))}
        {ids.length === 0 && <span className="text-sm" style={{ color: 'var(--muted)' }}>Nothing to print here yet.</span>}
      </div>
    </details>
  )
}

function Segmented<T extends string | boolean>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div>
      <div className="eyebrow mb-1.5">{label}</div>
      <div className="inline-flex gap-1 rounded-full p-1" style={{ background: 'var(--bg)' }} role="radiogroup" aria-label={label}>
        {options.map(o => (
          <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} onClick={() => onChange(o.v)}
            className="rounded-full px-3 py-1.5 text-sm font-semibold transition"
            style={value === o.v ? { background: 'var(--ink)', color: 'var(--on-ink)' } : undefined}>{o.l}</button>
        ))}
      </div>
    </div>
  )
}

export function PrintPage({ setup, onNeedTimetable }: { setup: SchoolSetup; onNeedTimetable: () => void }) {
  const has = (setup.timetable?.cards.length ?? 0) > 0
  const all = useMemo(() => everything(setup), [setup])
  const [sel, setSel] = useState<Selection>(() => everything(setup))
  const [opts, setOpts] = useState<PrintOptions>(loadOptions)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [which, setWhich] = useState(0)
  const canvas = useRef<HTMLCanvasElement>(null)
  const pages = useMemo(() => pagesFor(setup, sel), [setup, sel])
  const page = pages[Math.min(which, pages.length - 1)]

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(opts)) } catch { /* not saved */ }
  }, [opts])
  useEffect(() => {
    if (!canvas.current || !page || !has) return
    renderToCanvas(canvas.current, setup, page, opts, 4).catch(() => {})
  }, [setup, page, opts, has])

  const m = setup.master
  const names = (list: { id: string; name: string }[]) => Object.fromEntries(list.map(x => [x.id, x.name.trim() || 'Unnamed']))
  const set = (patch: Partial<PrintOptions>) => setOpts({ ...opts, ...patch })

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true); setStatus(null)
    try {
      const done = await fn()
      if (done) setStatus({ ok: true, text: done })
    } catch (e) { setStatus({ ok: false, text: errText(e) }) } finally { setBusy(false) }
  }
  const base = safeName(setup.name || 'school')
  const joinPath = (dir: string, file: string) => `${dir}${dir.includes('\\') ? '\\' : '/'}${file}`

  const savePdf = () => run(async () => {
    const path = await api.pickSaveFile(`${base}-timetables.pdf`, 'pdf', 'PDF')
    if (!path) return null
    await api.writeFile(path, pdfBase64(setup, pages, opts))
    return `Saved a PDF with ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}: ${path}`
  })
  const savePng = () => run(async () => {
    const dir = await api.pickFolder()
    if (!dir) return null
    const used = new Map<string, number>()
    for (const p of pages) {
      const n = (used.get(p.fileName) ?? 0) + 1
      used.set(p.fileName, n)
      await api.writeFile(joinPath(dir, `${p.fileName}${n > 1 ? `-${n}` : ''}.png`), await pngBase64(setup, p, opts))
    }
    return `Saved ${pages.length} ${pages.length === 1 ? 'picture' : 'pictures'} in ${dir}`
  })
  const saveExcel = () => run(async () => {
    const path = await api.pickSaveFile(`${base}-timetable.xlsx`, 'xlsx', 'Excel workbook')
    if (!path) return null
    await api.exportExcel(setup, path)
    return `Saved the Excel workbook: ${path}`
  })
  const saveCsv = () => run(async () => {
    const path = await api.pickSaveFile(`${base}-timetable.csv`, 'csv', 'CSV file')
    if (!path) return null
    await api.exportCsv(setup, path)
    return `Saved the list of lessons: ${path}`
  })

  if (!has) {
    return (
      <div className="space-y-6">
        <div>
          <div className="eyebrow">Step 13</div>
          <h2 className="mt-1 text-2xl font-semibold">Print and export</h2>
        </div>
        <Card>
          <p className="text-sm">There is no timetable to print yet.</p>
          <Button kind="primary" className="mt-4" onClick={onNeedTimetable}>Build the timetable first</Button>
        </Card>
      </div>
    )
  }

  const none = pages.length === 0
  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow">Step 13</div>
        <h2 className="mt-1 text-2xl font-semibold">Print and export</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Choose what to print and how it should look. PDF pages and pictures show your school's name and logo.
        </p>
      </div>

      <Card>
        <div className="eyebrow">What to print</div>
        <div className="mt-3 space-y-2">
          <Group title="Classes" ids={all.classes} names={names(m.classes)} chosen={sel.classes} onChange={v => setSel({ ...sel, classes: v })} />
          <Group title="Teachers" ids={all.teachers} names={names(m.teachers)} chosen={sel.teachers} onChange={v => setSel({ ...sel, teachers: v })} />
          <Group title="Rooms" ids={all.rooms} names={names(m.rooms)} chosen={sel.rooms} onChange={v => setSel({ ...sel, rooms: v })} />
          <label className="flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold" style={{ borderColor: 'var(--line)', background: 'var(--bg)' }}>
            <input type="checkbox" checked={sel.master} onChange={e => setSel({ ...sel, master: e.target.checked })} />
            Master timetable (all classes together)
          </label>
        </div>
      </Card>

      <Card>
        <div className="eyebrow">Paper and style</div>
        <div className="mt-3 flex flex-wrap items-end gap-6">
          <div>
            <div className="eyebrow mb-1.5">Paper size</div>
            <select aria-label="Paper size" className={`${inputCls} !w-32`} style={inputStyle} value={opts.paper} onChange={e => set({ paper: e.target.value as Paper })}>
              {PAPERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <Segmented label="Page" value={opts.landscape} options={[{ v: true, l: 'Wide' }, { v: false, l: 'Tall' }]} onChange={v => set({ landscape: v })} />
          <Segmented label="Colours" value={opts.color} options={[{ v: true, l: 'Colour' }, { v: false, l: 'Black and white' }]} onChange={v => set({ color: v })} />
          {sel.master && opts.paper !== 'a3' && (
            <p className="basis-full text-xs" style={{ color: 'var(--muted)' }}>Tip: the master timetable holds a lot of small boxes. It is easiest to read on A3.</p>
          )}
          <Toggle checked={opts.logo && !!setup.logo} onChange={v => set({ logo: v })} label={setup.logo ? 'Show the school logo' : 'No school logo yet (add it on the School page)'} />
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="eyebrow">Preview</div>
          {pages.length > 1 && (
            <select aria-label="Preview page" className={`${inputCls} !w-72`} style={inputStyle} value={Math.min(which, pages.length - 1)} onChange={e => setWhich(Number(e.target.value))}>
              {pages.map((p, i) => <option key={i} value={i}>{p.title} · {p.subtitle.split(' · ').filter(s => s.includes('shift') || s.startsWith('Classes')).join(' · ') || p.subtitle}</option>)}
            </select>
          )}
        </div>
        {none
          ? <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>Nothing is chosen. Tick something above.</p>
          : <canvas ref={canvas} aria-label="Preview of the page" className="mt-3 w-full rounded-lg border bg-white shadow-sm" style={{ borderColor: 'var(--line)' }} />}
      </Card>

      <Card>
        <div className="eyebrow">Save</div>
        <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>{none ? 'Choose what to print first.' : `${pages.length} ${pages.length === 1 ? 'page' : 'pages'} will be made.`}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button kind="primary" disabled={busy || none} onClick={savePdf}><FileText size={16} /> Save PDF…</Button>
          <Button kind="secondary" disabled={busy || none} onClick={savePng}><ImageIcon size={16} /> Save pictures (PNG)…</Button>
          <Button kind="secondary" disabled={busy} onClick={saveExcel}><FileSpreadsheet size={16} /> Save Excel…</Button>
          <Button kind="secondary" disabled={busy} onClick={saveCsv}><Table2 size={16} /> Save CSV…</Button>
        </div>
        {status && <p role={status.ok ? 'status' : 'alert'} className="mt-4 break-all text-sm font-medium" style={{ color: status.ok ? 'var(--success)' : 'var(--danger)' }}>{status.text}</p>}
      </Card>
    </div>
  )
}
