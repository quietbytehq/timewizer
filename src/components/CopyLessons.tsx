import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Copy, MinusCircle } from 'lucide-react'
import { api, errText } from '@/lib/api'
import type { CopyPlan, SchoolSetup } from '@/lib/types'
import { Button, inputCls, inputStyle, Toggle } from './ui'

/** Copy all lessons of one class to other classes, with a preview before anything changes. */
export function CopyLessonsDialog({ setup, onApply, onClose }:
  { setup: SchoolSetup; onApply: (s: SchoolSetup) => void; onClose: () => void }) {
  const classes = setup.master.classes
  const withLessons = (id: string) => setup.lessons.filter(l => l.parts.some(p => p.classId === id)).length
  const [source, setSource] = useState(classes.find(c => withLessons(c.id) > 0)?.id ?? classes[0]?.id ?? '')
  const [targets, setTargets] = useState<string[]>([])
  const [teachers, setTeachers] = useState(true)
  const [plan, setPlan] = useState<CopyPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])

  useEffect(() => {
    const id = ++seq.current
    if (!source || targets.length === 0) return
    api.planCopyLessons(setup, source, targets, teachers)
      .then(p => { if (id === seq.current) { setPlan(p); setError(null) } })
      .catch(e => { if (id === seq.current) setError(errText(e)) })
  }, [setup, source, targets, teachers])

  const toggle = (id: string) => setTargets(t => (t.includes(id) ? t.filter(x => x !== id) : [...t, id]))
  const shown = targets.length > 0 ? plan : null
  const n = shown?.newLessons.length ?? 0
  const apply = () => {
    if (!shown || n === 0) return
    onApply({ ...setup, lessons: [...setup.lessons, ...shown.newLessons] })
    onClose()
  }
  const others = classes.filter(c => c.id !== source)
  const sessions = (cards: number, len: number) => `${cards} × ${len === 1 ? 'single' : len === 2 ? 'double' : 'triple'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,34,41,0.55)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Copy lessons to other classes" onClick={e => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border shadow-xl" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
        <div className="space-y-5 overflow-y-auto p-6">
          <div>
            <div className="eyebrow">Lessons</div>
            <h3 className="mt-1 text-xl font-semibold">Copy lessons to other classes</h3>
            <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>Nothing changes until you press the button at the bottom.</p>
          </div>

          <label className="block">
            <span className="eyebrow block">Copy from</span>
            <select className={`${inputCls} mt-1.5 !w-64`} style={inputStyle} value={source} onChange={e => { setSource(e.target.value); setTargets(t => t.filter(id => id !== e.target.value)) }}>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name} ({withLessons(c.id)} lessons)</option>)}
            </select>
          </label>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="eyebrow">Copy to</span>
              <span className="flex gap-3 text-xs underline">
                <button type="button" onClick={() => setTargets(others.map(c => c.id))}>All other classes</button>
                <button type="button" onClick={() => setTargets([])}>None</button>
              </span>
            </div>
            {others.length === 0
              ? <p className="text-sm" style={{ color: 'var(--muted)' }}>There are no other classes yet.</p>
              : (
                <div className="flex max-h-40 flex-wrap gap-x-5 gap-y-2 overflow-auto">
                  {others.map(c => (
                    <label key={c.id} className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" checked={targets.includes(c.id)} onChange={() => toggle(c.id)} />
                      {c.name}{withLessons(c.id) > 0 && <span className="text-xs" style={{ color: 'var(--muted)' }}>({withLessons(c.id)} already)</span>}
                    </label>
                  ))}
                </div>
              )}
          </div>

          <Toggle checked={teachers} onChange={setTeachers} label="Also copy the teachers (turn off to choose them yourself afterwards)" />
          {error && <p role="alert" className="text-sm font-medium" style={{ color: 'var(--danger)' }}>{error}</p>}

          {shown && (
            <div className="space-y-4">
              <div className="eyebrow">Preview</div>
              {shown.targets.map(t => (
                <div key={t.classId} className="rounded-xl border p-4" style={{ borderColor: 'var(--line)', background: 'var(--bg)' }}>
                  <div className="mb-2 font-semibold">{t.className}: {t.create.length} {t.create.length === 1 ? 'lesson' : 'lessons'} will be added</div>
                  <ul className="space-y-1 text-sm">
                    {t.create.map((l, i) => (
                      <li key={i} className="flex gap-2">
                        <Check size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--success)' }} />
                        <span>
                          {l.subject}{l.group && ` (${l.group} only)`} · {sessions(l.cardsPerWeek, l.periodsPerCard)} ·{' '}
                          <span style={{ color: 'var(--muted)' }}>{l.teachers.length ? l.teachers.join(', ') : 'no teacher yet'}</span>
                        </span>
                      </li>
                    ))}
                    {t.skipped.map((l, i) => (
                      <li key={`s${i}`} className="flex gap-2" style={{ color: 'var(--muted)' }}>
                        <MinusCircle size={15} className="mt-0.5 shrink-0" />
                        <span><strong>{l.subject}</strong> not copied. {l.reason}</span>
                      </li>
                    ))}
                    {t.warnings.map((w, i) => (
                      <li key={`w${i}`} className="flex gap-2">
                        <AlertTriangle size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />{w}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t p-4" style={{ borderColor: 'var(--line)' }}>
          <Button kind="ghost" onClick={onClose}>Cancel</Button>
          <Button kind="primary" onClick={apply} disabled={n === 0}>
            <Copy size={15} /> {n === 0 ? 'Nothing to copy' : `Add ${n} ${n === 1 ? 'lesson' : 'lessons'}`}
          </Button>
        </div>
      </div>
    </div>
  )
}
