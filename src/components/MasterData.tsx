import { useState, type ReactNode } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { MasterData as MD, SchoolClass, SchoolSetup, Subject, Teacher, Room, Building } from '@/lib/types'
import { Button, Card, Field, inputCls, inputStyle } from './ui'
import { TimeOffEditor } from './TimeOffGrid'

export type MasterSection = 'subjects' | 'teachers' | 'classes' | 'rooms'

const PALETTE = ['#1F6F6B', '#E8A33D', '#C0504D', '#4C78A8', '#7B5EA7', '#6A994E', '#D17A5B', '#3C8DA3', '#A68A3E', '#8C5A6B', '#5B7F5E', '#B0616F']
const uid = () => crypto.randomUUID()
const num = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.floor(Number(v)) || 0))

type Props = { setup: SchoolSetup; onChange: (s: SchoolSetup) => void }

function useMaster({ setup, onChange }: Props) {
  const m = setup.master
  return { m, update: (patch: Partial<MD>) => onChange({ ...setup, master: { ...m, ...patch } }) }
}

/** Left list + right detail editor. */
export function ListDetail<T extends { id: string }>({ eyebrow, title, intro, noun, items, label, sub, onAdd, onDelete, children, empty, action }: {
  eyebrow: string; title: string; intro: string; noun: string; items: T[]; action?: ReactNode
  label: (x: T) => string; sub?: (x: T) => string
  onAdd: () => string; onDelete: (id: string) => void
  children: (x: T) => ReactNode; empty: string
}) {
  const [sel, setSel] = useState<string | null>(null)
  const cur = items.find(i => i.id === sel) ?? items[0]
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h2 className="mt-1 text-2xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>{intro}</p>
        </div>
        {action}
      </div>
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card className="!p-3">
          <div className="max-h-[60vh] space-y-1 overflow-auto">
            {items.map(x => (
              <button key={x.id} onClick={() => setSel(x.id)}
                className="block w-full rounded-xl px-3 py-2 text-left text-sm transition"
                style={cur?.id === x.id ? { background: 'var(--ink)', color: 'var(--on-ink)' } : undefined}>
                <div className="font-semibold">{label(x).trim() || `Unnamed ${noun}`}</div>
                {sub && <div className="text-xs opacity-70">{sub(x)}</div>}
              </button>
            ))}
            {items.length === 0 && <p className="px-3 py-4 text-sm" style={{ color: 'var(--muted)' }}>{empty}</p>}
          </div>
          <Button kind="primary" className="mt-3 w-full" onClick={() => setSel(onAdd())}><Plus size={16} /> Add {noun}</Button>
        </Card>
        {cur ? (
          <Card>
            <div className="space-y-5">
              {children(cur)}
              <div className="border-t pt-4" style={{ borderColor: 'var(--line)' }}>
                <Button kind="danger" onClick={() => { if (window.confirm(`Delete this ${noun}?`)) { onDelete(cur.id); setSel(null) } }}>
                  <Trash2 size={15} /> Delete {noun}
                </Button>
              </div>
            </div>
          </Card>
        ) : <Card><p className="text-sm" style={{ color: 'var(--muted)' }}>{empty}</p></Card>}
      </div>
    </div>
  )
}

export const Text = ({ value, onChange, ...r }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) =>
  <input className={inputCls} style={inputStyle} value={value} onChange={e => onChange(e.target.value)} {...r} />
export const NumIn = ({ value, onChange, placeholder = 'No limit' }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string }) =>
  <input className={inputCls} style={inputStyle} type="number" min={0} value={value ?? ''} placeholder={placeholder}
    onChange={e => onChange(num(e.target.value))} />

function Subjects(p: Props) {
  const { m, update } = useMaster(p)
  const set = (id: string, patch: Partial<Subject>) => update({ subjects: m.subjects.map(x => (x.id === id ? { ...x, ...patch } : x)) })
  return (
    <ListDetail eyebrow="Step 4" title="Subjects" noun="subject" items={m.subjects}
      intro="Every subject has a short name and a colour that shows on the timetable."
      empty="No subjects yet. Add the first one."
      label={x => x.name} sub={x => x.shortName}
      onAdd={() => { const id = uid(); update({ subjects: [...m.subjects, { id, name: '', shortName: '', color: PALETTE[m.subjects.length % PALETTE.length] }] }); return id }}
      onDelete={id => update({ subjects: m.subjects.filter(x => x.id !== id) })}>
      {x => (
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Subject name"><Text value={x.name} onChange={v => set(x.id, { name: v })} placeholder="Mathematics" /></Field>
          <Field label="Short name"><Text value={x.shortName} onChange={v => set(x.id, { shortName: v })} placeholder="MATH" /></Field>
          <Field label="Colour">
            <div className="flex flex-wrap gap-2">
              {PALETTE.map(c => (
                <button key={c} type="button" aria-label={c} onClick={() => set(x.id, { color: c })}
                  className="h-8 w-8 rounded-full border-2 transition"
                  style={{ background: c, borderColor: x.color === c ? 'var(--ink)' : 'transparent' }} />
              ))}
            </div>
          </Field>
        </div>
      )}
    </ListDetail>
  )
}

function ShiftChecks({ setup, value, onChange }: { setup: SchoolSetup; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-3">
      {setup.shifts.filter(s => s.enabled).map(s => (
        <label key={s.id} className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={value.includes(s.id)}
            onChange={e => onChange(e.target.checked ? [...value, s.id] : value.filter(v => v !== s.id))} />
          {s.name}
        </label>
      ))}
    </div>
  )
}

function Teachers(p: Props) {
  const { setup } = p
  const { m, update } = useMaster(p)
  const enabled = setup.shifts.filter(s => s.enabled)
  const set = (id: string, patch: Partial<Teacher>) => update({ teachers: m.teachers.map(x => (x.id === id ? { ...x, ...patch } : x)) })
  return (
    <ListDetail eyebrow="Step 5" title="Teachers" noun="teacher" items={m.teachers}
      intro="Add each teacher, the shift(s) they work in, their limits, and the times they cannot teach."
      empty="No teachers yet. Add the first one."
      label={x => x.name} sub={x => x.shortName}
      onAdd={() => {
        const id = uid()
        update({ teachers: [...m.teachers, { id, name: '', shortName: '', email: '', shifts: enabled.length === 1 ? [enabled[0].id] : [],
          maxLessonsPerDay: null, maxPeriodsPerWeek: null, maxConsecutive: null, maxDaysPerWeek: null, timeOff: [] }] })
        return id
      }}
      onDelete={id => update({
        teachers: m.teachers.filter(x => x.id !== id),
        classes: m.classes.map(c => (c.classTeacher === id ? { ...c, classTeacher: null } : c)),
      })}>
      {x => (
        <>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Teacher name"><Text value={x.name} onChange={v => set(x.id, { name: v })} /></Field>
            <Field label="Short name" hint="Shown on timetables, e.g. AKH"><Text value={x.shortName} onChange={v => set(x.id, { shortName: v })} /></Field>
            <Field label="Email (optional)"><Text value={x.email} onChange={v => set(x.id, { email: v })} /></Field>
          </div>
          <Field group label="Works in shift(s)"><ShiftChecks setup={setup} value={x.shifts} onChange={v => set(x.id, { shifts: v })} /></Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Most periods per day" hint="Empty = the school's rule">
              <NumIn value={x.maxLessonsPerDay} onChange={v => set(x.id, { maxLessonsPerDay: v })}
                placeholder={setup.settings.defaultMaxPerDay ? `School: ${setup.settings.defaultMaxPerDay}` : 'No limit'} />
            </Field>
            <Field label="Most periods per week" hint="Empty = the school's rule">
              <NumIn value={x.maxPeriodsPerWeek} onChange={v => set(x.id, { maxPeriodsPerWeek: v })}
                placeholder={setup.settings.defaultMaxPerWeek ? `School: ${setup.settings.defaultMaxPerWeek}` : 'No limit'} />
            </Field>
            <Field label="Most periods in a row"><NumIn value={x.maxConsecutive} onChange={v => set(x.id, { maxConsecutive: v })} /></Field>
            <Field label="Most days per week"><NumIn value={x.maxDaysPerWeek} onChange={v => set(x.id, { maxDaysPerWeek: v })} /></Field>
          </div>
          <div>
            <div className="eyebrow mb-2">Times this teacher is not available</div>
            <TimeOffEditor shifts={setup.shifts} shiftIds={x.shifts} days={setup.days} value={x.timeOff} onChange={v => set(x.id, { timeOff: v })} />
          </div>
        </>
      )}
    </ListDetail>
  )
}

function Classes(p: Props) {
  const { setup } = p
  const { m, update } = useMaster(p)
  const enabled = setup.shifts.filter(s => s.enabled)
  const set = (id: string, patch: Partial<SchoolClass>) => update({ classes: m.classes.map(x => (x.id === id ? { ...x, ...patch } : x)) })
  return (
    <ListDetail eyebrow="Step 6" title="Classes" noun="class" items={m.classes}
      intro="Each class belongs to one shift. You can split a class into groups, for example Boys and Girls."
      empty="No classes yet. Add the first one."
      label={x => x.name} sub={x => `${x.shortName}${x.divisions.length ? ' · split into groups' : ''}`}
      onAdd={() => {
        const id = uid()
        update({ classes: [...m.classes, { id, name: '', shortName: '', shift: enabled[0]?.id ?? '', classTeacher: null, homeRoom: null, divisions: [], timeOff: [] }] })
        return id
      }}
      onDelete={id => update({ classes: m.classes.filter(x => x.id !== id) })}>
      {x => (
        <>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Class name"><Text value={x.name} onChange={v => set(x.id, { name: v })} placeholder="Grade 5 A" /></Field>
            <Field label="Short name"><Text value={x.shortName} onChange={v => set(x.id, { shortName: v })} placeholder="5A" /></Field>
            <Field label="Shift">
              <select className={inputCls} style={inputStyle} value={x.shift} onChange={e => set(x.id, { shift: e.target.value })}>
                {!enabled.some(s => s.id === x.shift) && <option value={x.shift}>Choose a shift…</option>}
                {enabled.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Class teacher">
              <select className={inputCls} style={inputStyle} value={x.classTeacher ?? ''} onChange={e => set(x.id, { classTeacher: e.target.value || null })}>
                <option value="">None</option>
                {m.teachers.map(t => <option key={t.id} value={t.id}>{t.name || 'Unnamed teacher'}</option>)}
              </select>
            </Field>
            <Field label="Home classroom">
              <select className={inputCls} style={inputStyle} value={x.homeRoom ?? ''} onChange={e => set(x.id, { homeRoom: e.target.value || null })}>
                <option value="">None</option>
                {m.rooms.map(r => <option key={r.id} value={r.id}>{r.name || 'Unnamed room'}</option>)}
              </select>
            </Field>
          </div>

          <div>
            <div className="eyebrow mb-2">Splitting this class into groups</div>
            <div className="space-y-3">
              {x.divisions.map(d => {
                const setDiv = (patch: Partial<typeof d>) => set(x.id, { divisions: x.divisions.map(k => (k.id === d.id ? { ...k, ...patch } : k)) })
                return (
                  <div key={d.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
                    <div className="flex items-center gap-2">
                      <Text value={d.name} onChange={v => setDiv({ name: v })} placeholder="Split name, e.g. Boys / Girls" />
                      <Button kind="ghost" aria-label="Remove split" onClick={() => set(x.id, { divisions: x.divisions.filter(k => k.id !== d.id) })}><Trash2 size={15} /></Button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {d.groups.map(g => (
                        <div key={g.id} className="flex w-44 items-center gap-1">
                          <Text value={g.name} onChange={v => setDiv({ groups: d.groups.map(k => (k.id === g.id ? { ...k, name: v } : k)) })} />
                          {d.groups.length > 2 && (
                            <button type="button" aria-label="Remove group" className="p-1 opacity-60 hover:opacity-100"
                              onClick={() => setDiv({ groups: d.groups.filter(k => k.id !== g.id) })}><Trash2 size={14} /></button>
                          )}
                        </div>
                      ))}
                      <Button kind="ghost" onClick={() => setDiv({ groups: [...d.groups, { id: uid(), name: `Group ${d.groups.length + 1}` }] })}>
                        <Plus size={14} /> Group
                      </Button>
                    </div>
                  </div>
                )
              })}
              <Button kind="ghost" onClick={() => set(x.id, { divisions: [...x.divisions, {
                id: uid(), name: '', groups: [{ id: uid(), name: 'Group 1' }, { id: uid(), name: 'Group 2' }] }] })}>
                <Plus size={14} /> Add a split
              </Button>
            </div>
          </div>

          <div>
            <div className="eyebrow mb-2">Times this class has no lessons</div>
            <TimeOffEditor shifts={setup.shifts} shiftIds={[x.shift]} days={setup.days} value={x.timeOff} onChange={v => set(x.id, { timeOff: v })} />
          </div>
        </>
      )}
    </ListDetail>
  )
}

function Rooms(p: Props) {
  const { setup } = p
  const { m, update } = useMaster(p)
  const set = (id: string, patch: Partial<Room>) => update({ rooms: m.rooms.map(x => (x.id === id ? { ...x, ...patch } : x)) })
  const setB = (id: string, patch: Partial<Building>) => update({ buildings: m.buildings.map(x => (x.id === id ? { ...x, ...patch } : x)) })
  const allShifts = setup.shifts.filter(s => s.enabled).map(s => s.id)
  return (
    <div className="space-y-8">
      <Card>
        <div className="eyebrow">Step 7</div>
        <h2 className="mt-1 text-2xl font-semibold">Buildings</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>Optional. Useful when teachers must walk between blocks.</p>
        <div className="mt-4 space-y-2">
          {m.buildings.map(b => (
            <div key={b.id} className="flex max-w-md items-center gap-2">
              <Text value={b.name} onChange={v => setB(b.id, { name: v })} placeholder="Main block" />
              <Button kind="ghost" aria-label="Delete building" onClick={() => update({
                buildings: m.buildings.filter(k => k.id !== b.id),
                rooms: m.rooms.map(r => (r.building === b.id ? { ...r, building: null } : r)),
              })}><Trash2 size={15} /></Button>
            </div>
          ))}
          <Button kind="secondary" onClick={() => update({ buildings: [...m.buildings, { id: uid(), name: '' }] })}><Plus size={16} /> Add building</Button>
        </div>
      </Card>
      <ListDetail eyebrow="Classrooms" title="Classrooms and labs" noun="room" items={m.rooms}
        intro="Rooms where lessons happen, with their capacity and the times they are not free."
        empty="No rooms yet. Add the first one."
        label={x => x.name} sub={x => x.shortName}
        onAdd={() => { const id = uid(); update({ rooms: [...m.rooms, { id, name: '', shortName: '', building: null, capacity: null, timeOff: [] }] }); return id }}
        onDelete={id => update({
          rooms: m.rooms.filter(x => x.id !== id),
          classes: m.classes.map(c => (c.homeRoom === id ? { ...c, homeRoom: null } : c)),
        })}>
        {x => (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Room name"><Text value={x.name} onChange={v => set(x.id, { name: v })} placeholder="Physics Lab 1" /></Field>
              <Field label="Short name"><Text value={x.shortName} onChange={v => set(x.id, { shortName: v })} placeholder="PHY1" /></Field>
              <Field label="Building">
                <select className={inputCls} style={inputStyle} value={x.building ?? ''} onChange={e => set(x.id, { building: e.target.value || null })}>
                  <option value="">None</option>
                  {m.buildings.map(b => <option key={b.id} value={b.id}>{b.name || 'Unnamed building'}</option>)}
                </select>
              </Field>
              <Field label="Capacity (students)"><NumIn value={x.capacity} onChange={v => set(x.id, { capacity: v })} /></Field>
            </div>
            <div>
              <div className="eyebrow mb-2">Times this room is not available</div>
              <TimeOffEditor shifts={setup.shifts} shiftIds={allShifts} days={setup.days} value={x.timeOff} onChange={v => set(x.id, { timeOff: v })} />
            </div>
          </>
        )}
      </ListDetail>
    </div>
  )
}

export function MasterDataEditor({ section, ...p }: Props & { section: MasterSection }) {
  if (section === 'subjects') return <Subjects {...p} />
  if (section === 'teachers') return <Teachers {...p} />
  if (section === 'classes') return <Classes {...p} />
  return <Rooms {...p} />
}
