import { useEffect, useState } from 'react'
import { Copy, Link2, Plus, Trash2, X } from 'lucide-react'
import type { Lesson, LoadSummary, Load, SchoolSetup } from '@/lib/types'
import { api } from '@/lib/api'
import { Button, Card, Field, inputCls, inputStyle } from './ui'
import { ListDetail } from './MasterData'
import { CopyLessonsDialog } from './CopyLessons'

type Props = { setup: SchoolSetup; onChange: (s: SchoolSetup) => void }
const uid = () => crypto.randomUUID()
const LENGTHS = [{ v: 1, l: 'Single (1 period)' }, { v: 2, l: 'Double (2 periods)' }, { v: 3, l: 'Triple (3 periods)' }]

export function LessonsEditor({ setup, onChange }: Props) {
  const m = setup.master
  const lessons = setup.lessons
  const [copying, setCopying] = useState(false)
  const setAll = (l: Lesson[]) => onChange({ ...setup, lessons: l })
  const set = (id: string, patch: Partial<Lesson>) => setAll(lessons.map(x => (x.id === id ? { ...x, ...patch } : x)))
  const subject = (id: string) => m.subjects.find(s => s.id === id)
  const className = (id: string) => m.classes.find(c => c.id === id)?.shortName || 'Class?'

  const title = (l: Lesson) => {
    const who = l.parts.map(p => {
      const c = m.classes.find(k => k.id === p.classId)
      const g = c?.divisions.flatMap(d => d.groups).find(k => k.id === p.groupId)
      return g ? `${className(p.classId)} ${g.name}` : className(p.classId)
    }).join(', ')
    return `${subject(l.subject)?.name ?? 'No subject'}${who ? ` · ${who}` : ''}`
  }
  const sub = (l: Lesson) => {
    const t = l.teachers.map(id => m.teachers.find(x => x.id === id)?.shortName ?? '?').join(', ')
    return `${t || 'No teacher'} · ${l.cardsPerWeek} × ${l.periodsPerCard}${setup.links.some(k => k.lessons.includes(l.id)) ? ' · linked' : ''}`
  }
  const links = setup.links
  const setLinks = (next: typeof links) => onChange({ ...setup, links: next.filter(k => k.lessons.length >= 2) })
  /** Take a lesson out of its group (the group disappears when fewer than two remain). */
  const unlink = (id: string) => setLinks(links.map(k => ({ ...k, lessons: k.lessons.filter(v => v !== id) })))

  return (
    <>
    {copying && <CopyLessonsDialog setup={setup} onApply={s => onChange(s)} onClose={() => setCopying(false)} />}
    <ListDetail eyebrow="Step 8" title="Lessons"
      action={m.classes.length > 1 && lessons.length > 0 ? (
        <Button kind="secondary" onClick={() => setCopying(true)}><Copy size={15} /> Copy lessons to other classes…</Button>
      ) : undefined} noun="lesson" items={lessons}
      intro="A lesson says who teaches which subject to which class, and how often. Each session a week becomes a lesson session on the timetable."
      empty={m.subjects.length && m.teachers.length && m.classes.length ? 'No lessons yet. Add the first one.'
        : 'First add subjects, teachers and classes, then come back to add lessons.'}
      label={title} sub={sub}
      onAdd={() => {
        const id = uid()
        setAll([...lessons, { id, subject: '', teachers: [], parts: [], periodsPerCard: 1, cardsPerWeek: 1, rooms: [] }])
        return id
      }}
      onDelete={id => onChange({
        ...setup,
        lessons: lessons.filter(x => x.id !== id),
        links: links.map(k => ({ ...k, lessons: k.lessons.filter(v => v !== id) })).filter(k => k.lessons.length >= 2),
      })}>
      {x => {
        const setPart = (i: number, patch: Partial<Lesson['parts'][number]>) =>
          set(x.id, { parts: x.parts.map((p, k) => (k === i ? { ...p, ...patch } : p)) })
        const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter(v => v !== id))
        const group = links.find(k => k.lessons.includes(x.id))
        const partners = group ? group.lessons.filter(id => id !== x.id) : []
        const linkable = lessons.filter(l => l.id !== x.id && !links.some(k => k.lessons.includes(l.id))
          && l.cardsPerWeek === x.cardsPerWeek && l.periodsPerCard === x.periodsPerCard)
        const addPartner = (id: string) => {
          if (!id) return
          setLinks(group
            ? links.map(k => (k === group ? { ...k, lessons: [...k.lessons, id] } : k))
            : [...links, { id: uid(), lessons: [x.id, id] }])
        }
        return (
          <>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Subject">
                <select className={inputCls} style={inputStyle} value={x.subject} onChange={e => set(x.id, { subject: e.target.value })}>
                  <option value="">Choose a subject…</option>
                  {m.subjects.map(s => <option key={s.id} value={s.id}>{s.name || 'Unnamed subject'}</option>)}
                </select>
              </Field>
              <Field label="Session length">
                <select className={inputCls} style={inputStyle} value={x.periodsPerCard} onChange={e => set(x.id, { periodsPerCard: Number(e.target.value) })}>
                  {LENGTHS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              </Field>
              <Field label="Sessions per week">
                <input className={inputCls} style={inputStyle} type="number" min={1} max={20} value={x.cardsPerWeek}
                  onChange={e => set(x.id, { cardsPerWeek: Math.max(0, Math.floor(Number(e.target.value)) || 0) })} />
              </Field>
            </div>

            <div>
              <div className="eyebrow mb-2">Classes that attend</div>
              <div className="space-y-2">
                {x.parts.map((p, i) => {
                  const c = m.classes.find(k => k.id === p.classId)
                  const groups = c?.divisions.flatMap(d => d.groups.map(g => ({ ...g, label: `${d.name || 'Split'}: ${g.name}` }))) ?? []
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <select className={`${inputCls} !w-48`} style={inputStyle} value={p.classId}
                        onChange={e => setPart(i, { classId: e.target.value, groupId: null })}>
                        <option value="">Choose a class…</option>
                        {m.classes.map(k => <option key={k.id} value={k.id}>{k.name || 'Unnamed class'}</option>)}
                      </select>
                      <select className={`${inputCls} !w-56`} style={inputStyle} value={p.groupId ?? ''} disabled={!groups.length}
                        onChange={e => setPart(i, { groupId: e.target.value || null })}>
                        <option value="">Whole class</option>
                        {groups.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                      </select>
                      <Button kind="ghost" aria-label="Remove class" onClick={() => set(x.id, { parts: x.parts.filter((_, k) => k !== i) })}>
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  )
                })}
                <Button kind="ghost" onClick={() => set(x.id, { parts: [...x.parts, { classId: '', groupId: null }] })}>
                  <Plus size={14} /> Add a class
                </Button>
              </div>
            </div>

            <Field group label="Teachers" hint="Choose more than one if the lesson is team-taught.">
              <div className="flex max-h-44 flex-wrap gap-x-5 gap-y-2 overflow-auto">
                {m.teachers.map(t => (
                  <label key={t.id} className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={x.teachers.includes(t.id)}
                      onChange={e => set(x.id, { teachers: toggle(x.teachers, t.id, e.target.checked) })} />
                    {t.name || 'Unnamed teacher'}
                  </label>
                ))}
                {m.teachers.length === 0 && <span className="text-sm" style={{ color: 'var(--muted)' }}>No teachers yet.</span>}
              </div>
            </Field>

            <Field group label="Must happen at the same time as"
              hint="For lessons that run in parallel, like two halves of a class swapping ICT and Library, or electives across sections. Each session of this lesson will be placed at the same time as the matching session of the others. Only lessons with the same number and length of sessions can be linked.">
              <div className="space-y-2">
                {partners.map(id => {
                  const l = lessons.find(k => k.id === id)
                  return (
                    <div key={id} className="flex items-center gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)', background: 'var(--bg)' }}>
                      <Link2 size={14} style={{ color: 'var(--accent)' }} />
                      <span className="flex-1 font-medium">{l ? title(l) : 'A lesson that no longer exists'}<span style={{ color: 'var(--muted)' }}> · {l ? sub(l) : ''}</span></span>
                      <button type="button" aria-label="Remove link" title="Remove from this group" onClick={() => unlink(id)}><X size={15} /></button>
                    </div>
                  )
                })}
                <select className={`${inputCls} !w-full sm:!w-96`} style={inputStyle} value="" aria-label="Add a lesson that happens at the same time"
                  onChange={e => addPartner(e.target.value)} disabled={linkable.length === 0}>
                  <option value="">{linkable.length ? 'Add a lesson to happen at the same time…' : 'No other lessons can be linked to this one'}</option>
                  {linkable.map(l => <option key={l.id} value={l.id}>{title(l)} · {sub(l)}</option>)}
                </select>
                {group && <Button kind="ghost" onClick={() => unlink(x.id)}>Take this lesson out of the group</Button>}
              </div>
            </Field>

            <Field group label="Rooms this lesson can use" hint="Leave all unticked to use the class's own classroom.">
              <div className="flex max-h-44 flex-wrap gap-x-5 gap-y-2 overflow-auto">
                {m.rooms.map(r => (
                  <label key={r.id} className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" checked={x.rooms.includes(r.id)}
                      onChange={e => set(x.id, { rooms: toggle(x.rooms, r.id, e.target.checked) })} />
                    {r.name || 'Unnamed room'}
                  </label>
                ))}
                {m.rooms.length === 0 && <span className="text-sm" style={{ color: 'var(--muted)' }}>No rooms yet.</span>}
              </div>
            </Field>
          </>
        )
      }}
    </ListDetail>
    </>
  )
}

function LoadList({ title, rows }: { title: string; rows: Load[] }) {
  return (
    <Card>
      <div className="eyebrow">{title}</div>
      <div className="mt-3 space-y-3">
        {rows.length === 0 && <p className="text-sm" style={{ color: 'var(--muted)' }}>Nothing to show yet.</p>}
        {rows.map(r => {
          const over = r.used > r.available
          const pct = r.available ? Math.min(100, (r.used / r.available) * 100) : r.used ? 100 : 0
          return (
            <div key={r.id}>
              <div className="flex justify-between text-sm">
                <span className="font-semibold">{r.name || 'Unnamed'}</span>
                <span style={{ color: over ? 'var(--danger)' : 'var(--muted)' }}>
                  {r.used} of {r.available} periods{over ? ' — too many' : ''}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg)' }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: over ? 'var(--danger)' : pct > 90 ? 'var(--warning)' : 'var(--accent)' }} />
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export function WorkloadView({ setup }: { setup: SchoolSetup }) {
  const [sum, setSum] = useState<LoadSummary | null>(null)
  useEffect(() => {
    let live = true
    api.lessonLoads(setup).then(r => { if (live) setSum(r) }).catch(() => {})
    return () => { live = false }
  }, [setup])
  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow">Step 9</div>
        <h2 className="mt-1 text-2xl font-semibold">Workload</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Periods taught compared with the periods available each week. {sum ? `${sum.cards} lesson sessions will be placed on the timetable.` : ''}
        </p>
      </div>
      {sum && (
        <div className="grid gap-6 lg:grid-cols-2">
          <LoadList title="Classes" rows={sum.classes} />
          <LoadList title="Teachers" rows={sum.teachers} />
        </div>
      )}
    </div>
  )
}
