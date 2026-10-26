import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, FileDown, Plus, RotateCcw, Trash2, UserCheck, X } from 'lucide-react'
import { api, errText } from '@/lib/api'
import type { Absence, Cover, CoverCounts, CoverDay, Need, PeriodRef, SchoolSetup, Substitutions } from '@/lib/types'
import { coverSheetPdf } from '@/lib/print/cover'
import { Button, Card, Field, inputCls, inputStyle } from './ui'

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = () => iso(new Date())
const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split('-').map(Number)
  return iso(new Date(y, m - 1, d + n))
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Mon 2 Nov 2026", the same on every computer. */
const shortDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return `${DAYS[new Date(y, m - 1, d).getDay()]} ${d} ${MONTHS[m - 1]} ${y}`
}
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `a${Date.now()}${Math.random()}`)
const keyOf = (c: { absenceId: string; date: string; lessonId: string; number: number; absentTeacher: string }) =>
  `${c.absenceId}|${c.date}|${c.lessonId}#${c.number}|${c.absentTeacher}`
const alertStyle = { borderColor: 'var(--danger)', color: 'var(--danger)' }

export function SubstitutionsPage({ setup, onChange }: { setup: SchoolSetup; onChange: (s: SchoolSetup) => void }) {
  const subs: Substitutions = setup.substitutions ?? { absences: [], covers: [], countsFrom: null, countsYear: null }
  const [date, setDate] = useState(today)
  const [day, setDay] = useState<CoverDay | null>(null)
  const [counts, setCounts] = useState<CoverCounts | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const seq = useRef(0)

  // The day's lessons needing cover and the counts, worked out by the program after every change.
  useEffect(() => {
    const id = ++seq.current
    const t = setTimeout(() => {
      Promise.all([api.coverDay(setup, date), api.coverCounts(setup)])
        .then(([d, c]) => { if (id === seq.current) { setDay(d); setCounts(c) } })
        .catch(e => { if (id === seq.current) setError(errText(e)) })
    }, 120)
    return () => clearTimeout(t)
  }, [setup, date])

  const save = (next: Partial<Substitutions>) => onChange({ ...setup, substitutions: { ...subs, ...next } })
  const decide = (n: Need, coverTeacher: string | null, noCover: boolean) => {
    const c: Cover = { absenceId: n.absenceId, date: n.date, lessonId: n.lessonId, number: n.number, absentTeacher: n.absentTeacher,
      coverTeacher, noCover, shift: n.shift, period: n.period, length: n.length, archived: false }
    save({ covers: [...subs.covers.filter(x => keyOf(x) !== keyOf(c)), c] })
  }
  const undecide = (k: string) => save({ covers: subs.covers.filter(x => keyOf(x) !== k) })
  const removeAbsence = (a: Absence) => {
    const n = subs.covers.filter(c => c.absenceId === a.id).length
    const who = setup.master.teachers.find(t => t.id === a.teacherId)?.name ?? 'this teacher'
    if (!window.confirm(`Remove the absence of ${who}${n ? ` and its ${n} cover ${n === 1 ? 'decision' : 'decisions'}` : ''}? The timetable is not changed.`)) return
    save({ absences: subs.absences.filter(x => x.id !== a.id), covers: subs.covers.filter(c => c.absenceId !== a.id) })
  }
  const resetCounts = async () => {
    if (!window.confirm(`Start counting covers again from today (${shortDate(today())})? Earlier covers stay on the cover sheets; they are just no longer counted.`)) return
    try { onChange({ ...setup, substitutions: await api.resetCoverCounts(setup, today()) }) } catch (e) { setError(errText(e)) }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow">Day to day</div>
        <h2 className="mt-1 text-2xl font-semibold">Substitutions</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Mark a teacher as away, then choose who covers each of their lessons. The timetable itself never changes.
          Remember to save the school afterwards.
        </p>
      </div>
      {error && <div role="alert" className="rounded-xl border px-4 py-3 text-sm font-medium" style={alertStyle}>{error}</div>}
      {done && <div role="status" className="rounded-xl border px-4 py-3 text-sm font-medium" style={{ borderColor: 'var(--success)', color: 'var(--success)' }}>{done}</div>}
      {setup.master.teachers.length === 0
        ? <Card><p className="text-sm">Add teachers first (Master data &gt; Teachers).</p></Card>
        : <AbsenceCard setup={setup} subs={subs} onAdd={a => { setError(null); save({ absences: [...subs.absences, a] }); setDate(a.from) }}
            onRemove={removeAbsence} onPick={setDate} onError={setError} />}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Cover for {day?.title ?? shortDate(date)}</h3>
          <div className="flex items-center gap-1">
            <Button kind="ghost" aria-label="Previous day" onClick={() => setDate(d => addDays(d, -1))}><ChevronLeft size={16} /></Button>
            <input type="date" aria-label="Date" className={`${inputCls} !w-44`} style={inputStyle} value={date} onChange={e => e.target.value && setDate(e.target.value)} />
            <Button kind="ghost" aria-label="Next day" onClick={() => setDate(d => addDays(d, 1))}><ChevronRight size={16} /></Button>
            <Button kind="ghost" onClick={() => setDate(today())}>Today</Button>
          </div>
        </div>
        {day && <DayView day={day} onDecide={decide} onUndecide={n => undecide(keyOf(n))}
          onRemoveStale={c => undecide(keyOf(c))} />}
      </Card>

      {counts && <CountsCard counts={counts} onReset={resetCounts} />}
      {/* keyed by the date, so the sheet's dates follow the day being looked at */}
      <SheetCard key={date} setup={setup} date={date} onError={setError} onDone={setDone} />
    </div>
  )
}

function AbsenceCard({ setup, subs, onAdd, onRemove, onPick, onError }: {
  setup: SchoolSetup; subs: Substitutions; onAdd: (a: Absence) => void; onRemove: (a: Absence) => void
  onPick: (date: string) => void; onError: (e: string | null) => void
}) {
  const teachers = setup.master.teachers
  const [teacher, setTeacher] = useState('')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [part, setPart] = useState(false)
  const [periods, setPeriods] = useState<PeriodRef[]>([])
  const [note, setNote] = useState('')
  const t = teachers.find(x => x.id === teacher)
  // The periods of the teacher's shifts (the longest day of each).
  const choices = useMemo(() => setup.shifts.filter(s => s.enabled && (!t || t.shifts.includes(s.id)))
    .map(s => ({ shift: s, count: Math.max(0, ...s.days.map(d => d.length)) })), [setup.shifts, t])
  const has = (p: PeriodRef) => periods.some(x => x.shift === p.shift && x.period === p.period)
  const toggle = (p: PeriodRef) => setPeriods(has(p) ? periods.filter(x => !(x.shift === p.shift && x.period === p.period)) : [...periods, p])
  const add = async () => {
    const a: Absence = { id: newId(), teacherId: teacher, from, to: to < from ? from : to, periods: part ? periods : [], note: note.trim() }
    if (part && periods.length === 0) { onError('Tick the periods the teacher is away, or choose "The whole day".'); return }
    try { await api.checkAbsence(setup, a) } catch (e) { onError(errText(e)); return }
    onAdd(a); setNote(''); setPeriods([]); setPart(false)
  }
  const name = (id: string) => teachers.find(x => x.id === id)?.name ?? '(removed teacher)'
  const list = [...subs.absences].sort((a, b) => b.from.localeCompare(a.from) || name(a.teacherId).localeCompare(name(b.teacherId)))
  const shiftName = (id: string) => setup.shifts.find(s => s.id === id)?.name ?? id
  const many = setup.shifts.filter(s => s.enabled).length > 1
  return (
    <Card>
      <h3 className="text-lg font-semibold">Absences</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Teacher">
          <select className={inputCls} style={inputStyle} value={teacher} onChange={e => { setTeacher(e.target.value); setPeriods([]) }}>
            <option value="">Choose a teacher…</option>
            {[...teachers].sort((a, b) => a.name.localeCompare(b.name)).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="First day"><input type="date" className={inputCls} style={inputStyle} value={from} onChange={e => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value) }} /></Field>
        <Field label="Last day"><input type="date" className={inputCls} style={inputStyle} value={to} min={from} onChange={e => setTo(e.target.value)} /></Field>
        <Field label="Note (optional)"><input className={inputCls} style={inputStyle} value={note} placeholder="e.g. course, ill" onChange={e => setNote(e.target.value)} /></Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm" role="radiogroup" aria-label="How long">
        <label className="flex items-center gap-2"><input type="radio" checked={!part} onChange={() => setPart(false)} /> The whole day</label>
        <label className="flex items-center gap-2"><input type="radio" checked={part} onChange={() => setPart(true)} /> Only some periods</label>
      </div>
      {part && (
        <div className="mt-3 space-y-2" role="group" aria-label="Periods away">
          {choices.map(({ shift, count }) => (
            <div key={shift.id} className="flex flex-wrap items-center gap-2 text-sm">
              {many && <span className="w-24 font-semibold">{shift.name}</span>}
              {Array.from({ length: count }, (_, i) => {
                const p = { shift: shift.id, period: i + 1 }
                return (
                  <label key={i} className="flex items-center gap-1 rounded-lg border px-2 py-1" style={{ borderColor: has(p) ? 'var(--highlight)' : 'var(--line)' }}>
                    <input type="checkbox" checked={has(p)} onChange={() => toggle(p)} aria-label={`${many ? `${shift.name} ` : ''}period ${i + 1}`} /> P{i + 1}
                  </label>
                )
              })}
            </div>
          ))}
          <p className="text-xs" style={{ color: 'var(--muted)' }}>These periods count on every day from the first to the last day.</p>
        </div>
      )}
      <Button kind="primary" className="mt-4" disabled={!teacher} onClick={add}><Plus size={16} /> Add absence</Button>

      {list.length > 0 && (
        <ul className="mt-5 space-y-1.5" aria-label="Absences">
          {list.map(a => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)', background: 'var(--bg)' }}>
              <button type="button" className="min-w-0 text-left" onClick={() => onPick(a.from)} title="Show the cover for the first day">
                <span className="font-semibold">{name(a.teacherId)}</span>
                <span style={{ color: 'var(--muted)' }}>
                  {' · '}{a.from === a.to ? shortDate(a.from) : `${shortDate(a.from)} to ${shortDate(a.to)}`}
                  {' · '}{a.periods.length === 0 ? 'whole day' : `period${a.periods.length > 1 ? 's' : ''} ${a.periods.map(p => `${many ? `${shiftName(p.shift)} ` : ''}${p.period}`).join(', ')}`}
                  {a.note && ` · ${a.note}`}
                </span>
              </button>
              <Button kind="ghost" onClick={() => onRemove(a)} aria-label={`Remove the absence of ${name(a.teacherId)} from ${a.from}`}><Trash2 size={15} /> Remove</Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function DayView({ day, onDecide, onUndecide, onRemoveStale }: {
  day: CoverDay; onDecide: (n: Need, teacher: string | null, noCover: boolean) => void; onUndecide: (n: Need) => void; onRemoveStale: (c: Cover) => void
}) {
  if (!day.hasTimetable) return <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>Build the timetable first: the lessons to cover come from it.</p>
  if (!day.working) return <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>This is not a working day.</p>
  const open = day.needs.filter(n => !n.coverTeacher && !n.noCover).length
  return (
    <div className="mt-3">
      {day.needs.length === 0
        ? <p className="text-sm" style={{ color: 'var(--muted)' }}>No lessons need cover on this day.</p>
        : (
          <>
            <p className="text-sm" style={{ color: open ? 'var(--warning)' : 'var(--success)' }} data-testid="cover-summary">
              {open === 0 ? `All ${day.needs.length} lessons are covered or need no cover.` : `${open} of ${day.needs.length} ${day.needs.length === 1 ? 'lesson still needs' : 'lessons still need'} a cover teacher.`}
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm" aria-label="Lessons needing cover">
                <thead><tr className="eyebrow">
                  <th className="py-2 pr-3">Period</th><th className="pr-3">Class</th><th className="pr-3">Subject</th><th className="pr-3">Absent</th><th className="pr-3">Room</th><th>Cover teacher</th>
                </tr></thead>
                <tbody>{day.needs.map(n => <NeedRow key={keyOf(n)} n={n} onDecide={onDecide} onUndecide={onUndecide} />)}</tbody>
              </table>
            </div>
          </>
        )}
      {day.stale.length > 0 && (
        <div className="mt-4 rounded-xl border p-3 text-sm" style={{ borderColor: 'var(--warning)' }}>
          <div className="font-semibold">Saved covers for lessons that are no longer at that time in the timetable</div>
          <ul className="mt-2 space-y-1">
            {day.stale.map(s => (
              <li key={keyOf(s.cover)} className="flex items-center justify-between gap-2">
                <span>{s.title}: {s.cover.noCover ? 'no cover needed' : s.coverName ?? '—'}</span>
                <Button kind="ghost" onClick={() => onRemoveStale(s.cover)}><Trash2 size={15} /> Remove</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function NeedRow({ n, onDecide, onUndecide }: { n: Need; onDecide: (n: Need, teacher: string | null, noCover: boolean) => void; onUndecide: (n: Need) => void }) {
  const best = n.candidates.find(c => c.suitable)
  const same = n.candidates.filter(c => c.suitable && c.sameSubject)
  const other = n.candidates.filter(c => c.suitable && !c.sameSubject)
  const no = n.candidates.filter(c => !c.suitable)
  const label = `${n.subject} ${n.classes} period ${n.period}`
  const covers = (k: number) => `${k} ${k === 1 ? 'cover' : 'covers'}`
  const decided = !!n.coverTeacher || n.noCover
  return (
    <tr className="border-t align-top" style={{ borderColor: 'var(--line)' }} data-testid="need" data-period={n.period}>
      <td className="py-2.5 pr-3 font-semibold">
        {n.length > 1 ? `P${n.period}-${n.period + n.length - 1}` : `P${n.period}`}
        <div className="text-xs font-normal" style={{ color: 'var(--muted)' }}>{n.start}-{n.end}</div>
      </td>
      <td className="py-2.5 pr-3">{n.classes}</td>
      <td className="py-2.5 pr-3">{n.subject}</td>
      <td className="py-2.5 pr-3">{n.absentName}{n.note && <div className="text-xs" style={{ color: 'var(--muted)' }}>{n.note}</div>}</td>
      <td className="py-2.5 pr-3">{n.room || '—'}</td>
      <td className="py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {n.noCover
            ? <span className="font-semibold" data-testid="decision">No cover needed</span>
            : (
              <select aria-label={`Cover for ${label}`} className={`${inputCls} !w-64`} style={inputStyle} value={n.coverTeacher ?? ''}
                onChange={e => e.target.value ? onDecide(n, e.target.value, false) : onUndecide(n)}>
                <option value="">{best ? 'Choose a teacher…' : 'Nobody is free. Choose anyway…'}</option>
                {same.length > 0 && <optgroup label="Free · teaches this subject">{same.map(c => <option key={c.teacherId} value={c.teacherId}>{c.name} ({covers(c.covers)})</option>)}</optgroup>}
                {other.length > 0 && <optgroup label="Free · other subjects">{other.map(c => <option key={c.teacherId} value={c.teacherId}>{c.name} ({covers(c.covers)})</option>)}</optgroup>}
                {no.length > 0 && <optgroup label="Breaks a rule">{no.map(c => <option key={c.teacherId} value={c.teacherId}>{c.name}: {c.reasons.map(r => r.replace(`${c.name} `, '')).join(' · ')}</option>)}</optgroup>}
              </select>
            )}
          {!decided && best && (
            <Button kind="primary" onClick={() => onDecide(n, best.teacherId, false)} aria-label={`Accept ${best.name} for ${label}`}>
              <Check size={15} /> {best.name}
            </Button>
          )}
          {!decided && <Button kind="ghost" onClick={() => onDecide(n, null, true)} aria-label={`No cover needed for ${label}`}><X size={15} /> No cover needed</Button>}
          {decided && <Button kind="ghost" onClick={() => onUndecide(n)} aria-label={`Clear the cover for ${label}`}><RotateCcw size={15} /> Clear</Button>}
        </div>
        {!decided && best && <div className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>Suggested: {best.name}{best.sameSubject ? ' (teaches this subject)' : ''}, {covers(best.covers)} so far.</div>}
        {n.warning && (
          <div role="alert" className="mt-1.5 flex gap-1.5 text-xs font-semibold" style={{ color: 'var(--danger)' }}>
            <AlertTriangle size={14} className="shrink-0" /> {n.warning}
          </div>
        )}
      </td>
    </tr>
  )
}

function CountsCard({ counts, onReset }: { counts: CoverCounts; onReset: () => void }) {
  const [all, setAll] = useState(false)
  const shown = all ? counts.teachers : counts.teachers.filter(t => t.covers > 0)
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold"><UserCheck size={18} /> Cover counts{counts.year && ` · ${counts.year}`}</h3>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            {counts.since ? `Counted since ${shortDate(counts.since)}.` : 'Counted since the first cover.'} Suggestions prefer teachers with fewer covers.
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold" data-testid="cover-total">{counts.total}</div>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>{counts.total === 1 ? 'cover' : 'covers'} in all ({counts.totalPeriods} {counts.totalPeriods === 1 ? 'period' : 'periods'})</div>
        </div>
      </div>
      {counts.newYear && (
        <div className="mt-3 rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--warning)' }}>
          The school year on the School page has changed. Reset the counts to start the new year.
        </div>
      )}
      {shown.length === 0
        ? <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>No covers yet.</p>
        : (
          <table className="mt-3 w-full max-w-lg text-sm" aria-label="Cover counts">
            <thead><tr className="eyebrow text-left"><th className="py-1">Teacher</th><th className="text-right">Covers</th><th className="text-right">Periods</th></tr></thead>
            <tbody>{shown.map(t => (
              <tr key={t.teacherId} className="border-t" style={{ borderColor: 'var(--line)' }}>
                <td className="py-1">{t.name}</td><td className="text-right tabular-nums">{t.covers}</td><td className="text-right tabular-nums">{t.periods}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button kind="ghost" onClick={() => setAll(a => !a)}>{all ? 'Show only teachers with covers' : 'Show every teacher'}</Button>
        <Button kind="danger" onClick={onReset}><RotateCcw size={15} /> Reset counts…</Button>
      </div>
    </Card>
  )
}

function SheetCard({ setup, date, onError, onDone }: { setup: SchoolSetup; date: string; onError: (e: string | null) => void; onDone: (m: string | null) => void }) {
  const [from, setFrom] = useState(date)
  const [to, setTo] = useState(date)
  const [busy, setBusy] = useState(false)
  const range = from === to ? from : `${from} to ${to}`
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); onError(null); onDone(null)
    try { await fn() } catch (e) { onError(errText(e)) } finally { setBusy(false) }
  }
  const pdf = () => run(async () => {
    const days = await api.coverSheet(setup, from, to)
    if (days.length === 0) { onError('No lessons need cover on these dates.'); return }
    const path = await api.pickSaveFile(`Cover sheet ${range}.pdf`, 'pdf', 'PDF')
    if (!path) return
    await api.writeFile(path, coverSheetPdf(setup, days))
    onDone(`Saved the cover sheet as a PDF (${days.length} ${days.length === 1 ? 'day' : 'days'}).`)
  })
  const csv = () => run(async () => {
    const path = await api.pickSaveFile(`Cover sheet ${range}.csv`, 'csv', 'CSV')
    if (!path) return
    await api.exportCoverCsv(setup, from, to, path)
    onDone('Saved the cover sheet as a CSV file.')
  })
  return (
    <Card>
      <h3 className="text-lg font-semibold">Cover sheet</h3>
      <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>One page per day with lessons to cover: period and time, class, subject, absent teacher, cover teacher and room.</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="From"><input type="date" className={`${inputCls} !w-44`} style={inputStyle} value={from} onChange={e => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value) }} /></Field>
        <Field label="To"><input type="date" className={`${inputCls} !w-44`} style={inputStyle} value={to} min={from} onChange={e => setTo(e.target.value)} /></Field>
        <Button onClick={pdf} disabled={busy}><FileDown size={16} /> Save PDF…</Button>
        <Button kind="ghost" onClick={csv} disabled={busy}><FileDown size={16} /> Save CSV…</Button>
      </div>
    </Card>
  )
}
