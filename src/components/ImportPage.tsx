import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileUp, X } from 'lucide-react'
import { api, errText } from '@/lib/api'
import { KINDS, type Counts, type Kind, type Problem, type SchoolSetup } from '@/lib/types'
import { Button, Card, inputCls, inputStyle } from './ui'

type Props = { setup: SchoolSetup; onChange: (s: SchoolSetup) => void }
type Item = { path: string; kind: Kind | null }

const LABEL: Record<Kind, string> = { subjects: 'Subjects', teachers: 'Teachers', rooms: 'Rooms', classes: 'Classes', lessons: 'Lessons' }
const base = (p: string) => p.split(/[\\/]/).pop() ?? p
const isCsv = (p: string) => p.toLowerCase().endsWith('.csv')
const guess = (p: string): Kind | null => KINDS.find(k => base(p).toLowerCase().includes(k.slice(0, -1))) ?? null

export function ImportPage({ setup, onChange }: Props) {
  const [items, setItems] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ added: Counts; skipped: number; problems: Problem[] } | null>(null)

  const choose = async () => {
    const files = await api.pickImportFiles()
    if (files.length) { setItems(files.map(path => ({ path, kind: isCsv(path) ? guess(path) : null }))); setDone(null); setError(null) }
  }
  const template = async (kind: Kind | null) => {
    try {
      const ext = kind ? 'csv' : 'xlsx'
      const p = await api.pickTemplatePath(kind ? `${kind}-template.csv` : 'timewizer-template.xlsx', ext)
      if (p) await api.writeTemplate(p, kind)
    } catch (e) { setError(errText(e)) }
  }
  const ready = items.length > 0 && items.every(i => !isCsv(i.path) || i.kind)
  const run = async () => {
    setBusy(true); setError(null)
    try {
      // Excel files hold several sheets; CSV files go in the order the data depends on.
      const order = [...items].sort((a, b) =>
        (isCsv(a.path) ? 1 + KINDS.indexOf(a.kind!) : 0) - (isCsv(b.path) ? 1 + KINDS.indexOf(b.kind!) : 0))
      let cur = setup
      const total: Counts = { subjects: 0, teachers: 0, classes: 0, rooms: 0, lessons: 0 }
      let skipped = 0
      const problems: Problem[] = []
      for (const it of order) {
        const r = await api.importFile(it.path, isCsv(it.path) ? it.kind : null, cur)
        cur = r.setup
        for (const k of KINDS) total[k] += r.added[k]
        skipped += r.skipped
        problems.push(...r.problems.map(p => ({ ...p, sheet: isCsv(it.path) ? `${base(it.path)}` : p.sheet })))
      }
      onChange(cur)
      setDone({ added: total, skipped, problems })
      setItems([])
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow">Step 10</div>
        <h2 className="mt-1 text-2xl font-semibold">Import data</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Fill in a template with Excel and bring in your subjects, teachers, rooms, classes and lessons all at once.
          Rows that already exist are left alone, so it is safe to import twice.
        </p>
      </div>

      <Card>
        <div className="eyebrow">1 · Get a template</div>
        <p className="mt-2 text-sm">The Excel workbook has one sheet for each kind of data. You can also use one CSV file per kind.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button kind="secondary" onClick={() => template(null)}><Download size={15} /> Excel workbook</Button>
          {KINDS.map(k => <Button key={k} kind="ghost" onClick={() => template(k)}><Download size={14} /> {LABEL[k]} (CSV)</Button>)}
        </div>
      </Card>

      <Card>
        <div className="eyebrow">2 · Choose your filled-in files</div>
        <div className="mt-3 space-y-2">
          {items.map((it, i) => (
            <div key={it.path} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold">{base(it.path)}</span>
              {isCsv(it.path) ? (
                <select className={`${inputCls} !w-48`} style={inputStyle} value={it.kind ?? ''}
                  onChange={e => setItems(items.map((x, k) => (k === i ? { ...x, kind: (e.target.value || null) as Kind | null } : x)))}>
                  <option value="">What is in this file?</option>
                  {KINDS.map(k => <option key={k} value={k}>{LABEL[k]}</option>)}
                </select>
              ) : <span style={{ color: 'var(--muted)' }}>Excel workbook</span>}
              <button aria-label="Remove file" className="opacity-60 hover:opacity-100" onClick={() => setItems(items.filter((_, k) => k !== i))}><X size={15} /></button>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <Button kind="secondary" onClick={choose} disabled={busy}><FileUp size={15} /> Choose files…</Button>
            <Button kind="primary" onClick={run} disabled={busy || !ready}>Import</Button>
          </div>
        </div>
      </Card>

      {error && <div role="alert" className="rounded-xl border px-4 py-3 text-sm font-medium" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>}

      {done && (
        <Card>
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />
            Added {done.added.subjects} subjects, {done.added.teachers} teachers, {done.added.rooms} rooms, {done.added.classes} classes and {done.added.lessons} lessons.
          </div>
          {done.skipped > 0 && <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>{done.skipped} {done.skipped === 1 ? 'row was' : 'rows were'} skipped because they already exist.</p>}
          {done.problems.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle size={16} style={{ color: 'var(--warning)' }} />
                {done.problems.length} {done.problems.length === 1 ? 'row' : 'rows'} could not be imported. Fix them in your file and import again.
              </div>
              <ul className="mt-2 max-h-72 space-y-1 overflow-auto text-sm">
                {done.problems.map((p, i) => (
                  <li key={i}><span className="font-semibold">{p.sheet}, row {p.row}:</span> {p.message}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>Remember to press Save to keep the imported data.</p>
        </Card>
      )}
    </div>
  )
}
