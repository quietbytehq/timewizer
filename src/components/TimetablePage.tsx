import { useEffect, useMemo, useRef, useState } from 'react'
import { DoorOpen, Lock, Redo2, Undo2, Unlock, ZoomIn, ZoomOut } from 'lucide-react'
import { api, errText } from '@/lib/api'
import type { ImproveReport, PlacedCard, SchoolSetup, Shift, SlotInfo, SwapInfo, Timetable } from '@/lib/types'
import { Button, Card, inputCls, inputStyle } from '@/components/ui'
import { ImproveButton, QualityTable } from './Quality'
import { inkOn } from '@/lib/color'

type Mode = 'class' | 'teacher' | 'room' | 'master'
interface Ref { lessonId: string; number: number }
interface Picker extends Ref { day: number; period: number; rooms: SlotInfo['rooms']; current: string | null }

const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const tint = (c: string, n: number) => `color-mix(in srgb, var(${c}) ${n}%, transparent)`
const same = (a: Ref, b: Ref) => a.lessonId === b.lessonId && a.number === b.number

export interface History { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean }

export function TimetablePage({ setup, onTimetable, history }:
  { setup: SchoolSetup; onTimetable: (t: Timetable) => void; history: History }) {
  const cards = useMemo(() => setup.timetable?.cards ?? [], [setup.timetable])
  const m = setup.master
  const enabled = setup.shifts.filter(s => s.enabled)
  const [mode, setMode] = useState<Mode>('class')
  const [entity, setEntity] = useState<Record<string, string>>({})
  const [masterShift, setMasterShift] = useState(enabled[0]?.id ?? '')
  const [drag, setDrag] = useState<(Ref & { shift: string; placed: boolean }) | null>(null)
  const [opts, setOpts] = useState<Map<string, SlotInfo>>(new Map())
  const [swaps, setSwaps] = useState<Map<string, SwapInfo>>(new Map())
  const [zoom, setZoom] = useState(() => {
    try { return Number(localStorage.getItem('tw-master-zoom')) || 1.5 } catch { return 1.5 }
  })
  const [improved, setImproved] = useState<ImproveReport | null>(null)
  const [picker, setPicker] = useState<Picker | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [consistent, setConsistent] = useState(true)
  const seq = useRef(0)

  useEffect(() => {
    const id = ++seq.current
    api.timetableConsistent(setup).then(ok => { if (id === seq.current) setConsistent(ok) }).catch(() => {})
  }, [setup])

  const lesson = (id: string) => setup.lessons.find(l => l.id === id)
  const placedKey = useMemo(() => new Set(cards.map(c => `${c.lessonId}#${c.number}`)), [cards])
  const unplaced = useMemo(() => {
    const out: Ref[] = []
    for (const l of setup.lessons) {
      if (l.parts.length === 0) continue
      for (let n = 1; n <= l.cardsPerWeek; n++) if (!placedKey.has(`${l.id}#${n}`)) out.push({ lessonId: l.id, number: n })
    }
    return out
  }, [setup.lessons, placedKey])

  const entities = mode === 'class' ? m.classes.map(c => ({ id: c.id, name: c.name }))
    : mode === 'teacher' ? m.teachers.map(t => ({ id: t.id, name: t.name }))
    : mode === 'room' ? m.rooms.map(r => ({ id: r.id, name: r.name })) : []
  const chosen = entities.find(e => e.id === entity[mode])?.id ?? entities[0]?.id

  const matches = (c: PlacedCard): boolean => {
    const l = lesson(c.lessonId)
    if (!l || !chosen) return false
    if (mode === 'class') return l.parts.some(p => p.classId === chosen)
    if (mode === 'teacher') return l.teachers.includes(chosen)
    return c.room === chosen
  }
  const shiftsFor: Shift[] = mode === 'class' ? enabled.filter(s => s.id === m.classes.find(c => c.id === chosen)?.shift)
    : mode === 'teacher' ? enabled.filter(s => m.teachers.find(t => t.id === chosen)?.shifts.includes(s.id)) : enabled

  const fail = (e: unknown) => setMessage(errText(e))
  const doMove = async (r: Ref, day: number, period: number, room: string | null) => {
    try { onTimetable(await api.moveCard(setup, r.lessonId, r.number, day, period, room)); setMessage(null) } catch (e) { fail(e) }
  }
  const startDrag = async (r: Ref, shift: string, placed: boolean) => {
    setDrag({ ...r, shift, placed }); setMessage(null); setOpts(new Map()); setSwaps(new Map())
    try {
      const [list, sw] = await Promise.all([api.slotOptions(setup, r.lessonId, r.number), api.swapOptions(setup, r.lessonId, r.number)])
      setOpts(new Map(list.map(o => [`${o.shift}-${o.day}-${o.period}`, o])))
      setSwaps(new Map(sw.map(o => [`${o.lessonId}#${o.number}`, o])))
    } catch (e) { fail(e) }
  }
  const endDrag = () => { setDrag(null); setOpts(new Map()); setSwaps(new Map()) }
  const swapWith = async (target: Ref) => {
    const r = drag; endDrag()
    if (!r) return
    try { onTimetable(await api.swapCards(setup, r.lessonId, r.number, target.lessonId, target.number)); setMessage(null) } catch (e) { fail(e) }
  }
  const setZoomSaved = (z: number) => {
    const v = Math.min(3, Math.max(0.8, Math.round(z * 10) / 10))
    setZoom(v)
    try { localStorage.setItem('tw-master-zoom', String(v)) } catch { /* not saved */ }
  }
  const drop = (shift: string, day: number, period: number) => {
    const r = drag; endDrag()
    if (!r || r.shift !== shift) return
    const o = opts.get(`${shift}-${day}-${period}`)
    if (!o) return
    if (o.status === 'blocked') { setMessage(o.reasons.join(' ')); return }
    const pool = lesson(r.lessonId)?.rooms.length ?? 0
    if (pool > 1) setPicker({ ...r, day, period, rooms: o.rooms, current: null })
    else doMove(r, day, period, null)
  }
  const unplace = () => {
    const r = drag; endDrag()
    if (!r || !r.placed) return
    const c = cards.find(x => same(x, r))
    if (c?.locked) { setMessage('This lesson is locked. Unlock it first to take it off the timetable.'); return }
    onTimetable({ cards: cards.filter(x => !same(x, r)) })
  }
  const toggleLock = (r: Ref) => {
    const lock = !cards.find(c => same(c, r))?.locked
    const group = new Set(setup.links.find(k => k.lessons.includes(r.lessonId))?.lessons ?? [r.lessonId])
    onTimetable({ cards: cards.map(c => (group.has(c.lessonId) && c.number === r.number ? { ...c, locked: lock } : c)) })
  }
  const openRoomPicker = async (c: PlacedCard) => {
    try {
      const list = await api.slotOptions(setup, c.lessonId, c.number)
      const o = list.find(x => x.day === c.day && x.period === c.period)
      if (o) setPicker({ lessonId: c.lessonId, number: c.number, day: c.day, period: c.period, rooms: o.rooms, current: c.room })
    } catch (e) { fail(e) }
  }

  const chip = (r: Ref, shift: string, c: PlacedCard | null, compact: boolean, z = 1) => {
    const l = lesson(r.lessonId)
    const sub = m.subjects.find(s => s.id === l?.subject)
    const teachers = l?.teachers.map(t => m.teachers.find(x => x.id === t)?.shortName).filter(Boolean).join(', ') ?? ''
    const classes = l?.parts.map(p => m.classes.find(x => x.id === p.classId)?.shortName).filter(Boolean).join(', ') ?? ''
    const room = m.rooms.find(x => x.id === c?.room)
    const locked = !!c?.locked
    const hasPool = (l?.rooms.length ?? 0) > 0
    const sw = c && drag && drag.shift === shift && !same(drag, r) ? swaps.get(`${r.lessonId}#${r.number}`) : undefined
    const swapStyle = sw?.ok ? { outline: '2px solid var(--success)', outlineOffset: 1 } : {}
    return (
      <div draggable={!locked}
        onDragOver={e => { if (sw?.ok) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move' } }}
        onDrop={e => { if (sw?.ok) { e.preventDefault(); e.stopPropagation(); swapWith(r) } }}
        onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', `${r.lessonId}#${r.number}`); startDrag(r, shift, !!c) }}
        onDragEnd={endDrag}
        className={`group relative h-full min-h-0 overflow-hidden rounded-lg px-1.5 py-0.5 leading-tight shadow-sm ${locked ? 'cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'}`}
        style={{ background: sub?.color ?? 'var(--line)', color: inkOn(sub?.color ?? '#DCD0BC'), opacity: drag && same(drag, r) ? 0.4 : 1, ...swapStyle }}
        title={`${sub?.name ?? ''} · ${classes} · ${teachers}${room ? ` · ${room.name}` : ''}${locked ? ' · locked' : ''}${sw ? (sw.ok ? ' — drop to swap' : ` — cannot swap: ${sw.reasons.join(' ')}`) : ''}`}>
        <div className={compact ? 'truncate font-bold' : 'truncate text-xs font-bold'} style={compact ? { fontSize: `${0.62 * z}rem` } : undefined}>
          {sub?.shortName ?? sub?.name}{locked && <Lock size={10} className="ml-1 inline" />}
        </div>
        {!compact && <div className="truncate text-[11px] opacity-80">{mode === 'class' ? teachers : mode === 'teacher' ? classes : `${classes} · ${teachers}`}{room && mode !== 'room' ? ` · ${room.shortName}` : ''}</div>}
        {compact && z >= 1.3 && <div className="truncate opacity-80" style={{ fontSize: `${0.52 * z}rem` }}>{teachers}</div>}
        {c && (
          <div className="absolute right-0.5 top-0.5 hidden gap-0.5 group-hover:flex">
            {hasPool && <button type="button" aria-label="Choose room" title="Choose room" onClick={() => openRoomPicker(c)}
              className="rounded bg-white/80 p-0.5"><DoorOpen size={12} /></button>}
            <button type="button" aria-label={locked ? 'Unlock' : 'Lock'} title={locked ? 'Unlock' : 'Lock in place'} onClick={() => toggleLock(r)}
              className="rounded bg-white/80 p-0.5">{locked ? <Unlock size={12} /> : <Lock size={12} />}</button>
          </div>
        )}
      </div>
    )
  }

  const cellProps = (shift: string, day: number, period: number) => {
    const o = drag && drag.shift === shift ? opts.get(`${shift}-${day}-${period}`) : undefined
    const style = o ? {
      outline: `2px solid ${o.status === 'ok' ? 'var(--success)' : o.status === 'soft' ? 'var(--warning)' : 'var(--danger)'}`,
      background: tint(o.status === 'ok' ? '--success' : o.status === 'soft' ? '--warning' : '--danger', o.status === 'blocked' ? 14 : 24),
    } : {}
    return {
      style,
      title: o ? (o.status === 'ok' ? 'Free' : o.reasons.join(' ')) : undefined,
      onDragOver: (e: React.DragEvent) => { if (o && o.status !== 'blocked') { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } },
      onDrop: (e: React.DragEvent) => { e.preventDefault(); drop(shift, day, period) },
    }
  }

  const cardsAt = (shift: string, day: number, period: number, f: (c: PlacedCard) => boolean) =>
    cards.filter(c => c.shift === shift && c.day === day && period >= c.period && period < c.period + c.length && f(c))

  const cell = (shift: Shift, day: number, p: number, f: (c: PlacedCard) => boolean, compact: boolean, z = 1) => {
    const here = cardsAt(shift.id, day, p + 1, f)
    return (
      <div {...cellProps(shift.id, day, p + 1)} className={`flex flex-col gap-0.5 rounded-lg ${compact ? '' : 'h-14 w-28'}`}
        style={{ ...cellProps(shift.id, day, p + 1).style, ...(compact ? { width: `${3.2 * z}rem`, height: `${2.4 * z}rem` } : {}) }}>
        {here.length === 0 && <div className="h-full rounded-lg border border-dashed" style={{ borderColor: 'var(--line)' }} />}
        {here.map(c => c.period === p + 1
          ? <div key={`${c.lessonId}#${c.number}`} className="min-h-0 flex-1">{chip(c, shift.id, c, compact, z)}</div>
          : <div key={`${c.lessonId}#${c.number}`} className="flex-1 rounded-lg px-1 text-center text-[10px] opacity-60"
              style={{ background: tint('--line', 60), fontSize: `${0.6 * z}rem` }}>↑ cont.</div>)}
      </div>
    )
  }

  const workingDays = setup.days.map((d, i) => ({ d, i })).filter(x => x.d.working)
  const noPeriod = (compact: boolean) => (
    <div className={`${compact ? 'h-10 w-14' : 'h-14 w-28'} rounded-lg`} title="No period"
      style={{ background: 'repeating-linear-gradient(135deg, var(--line) 0 4px, transparent 4px 8px)', opacity: 0.45 }} />
  )

  const shiftGrid = (shift: Shift) => {
    const rows = Math.max(0, ...workingDays.map(x => shift.days[x.i]?.length ?? 0))
    return (
      <div key={shift.id} className="overflow-x-auto">
        {shiftsFor.length > 1 && <div className="eyebrow mb-1">{shift.name} shift</div>}
        <table className="border-separate border-spacing-1 text-xs">
          <thead><tr><th />{workingDays.map(({ i }) => <th key={i} className="eyebrow px-2 py-1">{SHORT[i]}</th>)}</tr></thead>
          <tbody>
            {Array.from({ length: rows }, (_, p) => (
              <tr key={p}>
                <th className="pr-2 text-right font-semibold" style={{ color: 'var(--muted)' }}>P{p + 1}</th>
                {workingDays.map(({ i }) => (
                  <td key={i}>{p < (shift.days[i]?.length ?? 0) ? cell(shift, i, p, matches, false) : noPeriod(false)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const masterGrid = () => {
    const shift = enabled.find(s => s.id === masterShift) ?? enabled[0]
    if (!shift) return null
    const rows = m.classes.filter(c => c.shift === shift.id)
    const maxP = (i: number) => shift.days[i]?.length ?? 0
    return (
      <div className="max-h-[75vh] overflow-auto rounded-xl">
        <table className="border-separate border-spacing-0.5" style={{ fontSize: `${0.65 * zoom}rem` }}>
          <thead className="sticky top-0 z-10" style={{ background: 'var(--surface)' }}>
            <tr><th />{workingDays.map(({ i }) => <th key={i} colSpan={maxP(i)} className="eyebrow border-l px-1 py-1" style={{ borderColor: 'var(--line)' }}>{SHORT[i]}</th>)}</tr>
            <tr><th />{workingDays.flatMap(({ i }) => Array.from({ length: maxP(i) }, (_, p) =>
              <th key={`${i}-${p}`} className="font-semibold" style={{ color: 'var(--muted)' }}>{p + 1}</th>))}</tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id}>
                <th className="sticky left-0 z-[5] whitespace-nowrap pr-2 text-right font-semibold" style={{ background: 'var(--surface)', fontSize: `${0.8 * zoom}rem` }}>{c.shortName}</th>
                {workingDays.flatMap(({ i }) => Array.from({ length: maxP(i) }, (_, p) => (
                  <td key={`${i}-${p}`}>{cell(shift, i, p, x => !!lesson(x.lessonId)?.parts.some(pt => pt.classId === c.id), true, zoom)}</td>
                )))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (setup.lessons.length === 0) {
    return <Card><p className="text-sm">Add lessons first, then build the timetable. You can then adjust it here by hand.</p></Card>
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Step 12</div>
          <h2 className="mt-1 text-2xl font-semibold">Timetable</h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Drag a lesson to a new time. Green is free, yellow is possible but not ideal, red is blocked. Drop it on another lesson to swap them (that lesson lights up green when the swap works). Hover a lesson to lock it or choose its room.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ImproveButton setup={setup} onTimetable={onTimetable} onResult={setImproved} />
          <Button kind="ghost" onClick={history.undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)"><Undo2 size={16} /> Undo</Button>
          <Button kind="ghost" onClick={history.redo} disabled={!history.canRedo} title="Redo (Ctrl+Y)"><Redo2 size={16} /> Redo</Button>
        </div>
      </div>

      {!consistent && (
        <div role="alert" className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: 'var(--warning)' }}>
          Some lessons or time-off cells were changed after this timetable was built, so a few places may now clash.
          Use <strong>Build timetable</strong> again (locked lessons stay put) or move the lessons by hand.
        </div>
      )}
      {improved && <Card><QualityTable before={improved.qualityBefore} after={improved.qualityAfter} /></Card>}
      {message && <div role="alert" className="rounded-xl border px-4 py-3 text-sm font-medium" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{message}</div>}

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-full p-1" style={{ background: 'var(--bg)' }} role="tablist" aria-label="View">
            {([['class', 'Class'], ['teacher', 'Teacher'], ['room', 'Room'], ['master', 'Master']] as [Mode, string][]).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={mode === id} onClick={() => setMode(id)}
                className="rounded-full px-3 py-1.5 text-sm font-semibold transition"
                style={mode === id ? { background: 'var(--ink)', color: 'var(--on-ink)' } : undefined}>{label}</button>
            ))}
          </div>
          {mode !== 'master' ? (
            <select aria-label="Show" className={`${inputCls} !w-56`} style={inputStyle} value={chosen ?? ''}
              onChange={e => setEntity({ ...entity, [mode]: e.target.value })}>
              {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          ) : enabled.length > 1 && (
            <select aria-label="Shift" className={`${inputCls} !w-40`} style={inputStyle} value={masterShift} onChange={e => setMasterShift(e.target.value)}>
              {enabled.map(s => <option key={s.id} value={s.id}>{s.name} shift</option>)}
            </select>
          )}
          {mode === 'master' && (
            <div className="flex items-center gap-1" role="group" aria-label="Zoom">
              <Button kind="ghost" onClick={() => setZoomSaved(zoom - 0.2)} aria-label="Zoom out" title="Smaller"><ZoomOut size={16} /></Button>
              <input type="range" min={0.8} max={3} step={0.1} value={zoom} aria-label="Zoom" className="w-28 accent-[var(--accent)]"
                onChange={e => setZoomSaved(Number(e.target.value))} />
              <Button kind="ghost" onClick={() => setZoomSaved(zoom + 0.2)} aria-label="Zoom in" title="Larger"><ZoomIn size={16} /></Button>
              <span className="w-10 text-xs font-semibold" style={{ color: 'var(--muted)' }}>{Math.round(zoom * 100)}%</span>
            </div>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--muted)' }}>
            {([['--success', 'Free'], ['--warning', 'Not ideal'], ['--danger', 'Blocked']] as const).map(([c, l]) => (
              <span key={l} className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border-2" style={{ borderColor: `var(${c})`, background: tint(c, 25) }} /> {l}</span>
            ))}
          </div>
        </div>
        {mode === 'master' ? masterGrid() : entities.length === 0
          ? <p className="text-sm" style={{ color: 'var(--muted)' }}>Nothing to show yet.</p>
          : shiftsFor.length === 0
            ? <p className="text-sm" style={{ color: 'var(--muted)' }}>This one is not in any shift that is switched on.</p>
            : <div className="space-y-5">{shiftsFor.map(shiftGrid)}</div>}
      </Card>

      <div onDragOver={e => { if (drag?.placed) e.preventDefault() }} onDrop={e => { e.preventDefault(); unplace() }}
        className="rounded-2xl border-2 border-dashed p-4"
        style={{ borderColor: drag?.placed ? 'var(--highlight)' : 'var(--line)', background: drag?.placed ? tint('--highlight', 12) : 'transparent' }}>
        <div className="mb-2 flex items-center justify-between">
          <div className="eyebrow">Not placed yet ({unplaced.length})</div>
          {drag?.placed && <span className="text-xs font-semibold">Drop here to take it off the timetable</span>}
        </div>
        {unplaced.length === 0
          ? <p className="text-sm" style={{ color: 'var(--muted)' }}>Every lesson has a time.</p>
          : (
            <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
              {unplaced.map(r => {
                const l = lesson(r.lessonId)
                const classId = l?.parts[0]?.classId
                const shift = m.classes.find(c => c.id === classId)?.shift ?? ''
                const cls = l?.parts.map(p => m.classes.find(x => x.id === p.classId)?.shortName).filter(Boolean).join(', ')
                return (
                  <div key={`${r.lessonId}#${r.number}`} className="h-12 w-32">
                    {chip(r, shift, null, false)}
                    <span className="sr-only">{cls}</span>
                  </div>
                )
              })}
            </div>
          )}
      </div>

      {picker && <RoomPicker picker={picker} setup={setup} onClose={() => setPicker(null)}
        onPick={room => { const p = picker; setPicker(null); doMove(p, p.day, p.period, room) }} />}
    </div>
  )
}

function RoomPicker({ picker, setup, onPick, onClose }:
  { picker: Picker; setup: SchoolSetup; onPick: (room: string) => void; onClose: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])
  const l = setup.lessons.find(x => x.id === picker.lessonId)
  const sub = setup.master.subjects.find(s => s.id === l?.subject)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,34,41,0.55)' }} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Choose a room" onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border p-6 shadow-xl" style={{ background: 'var(--surface)', borderColor: 'var(--line)' }}>
        <div className="eyebrow">Choose a room</div>
        <h3 className="mt-1 text-lg font-semibold">{sub?.name ?? 'Lesson'} · {SHORT[picker.day]} period {picker.period}</h3>
        <ul className="mt-4 space-y-2">
          {picker.rooms.map(r => (
            <li key={r.id}>
              <button type="button" disabled={!r.free} onClick={() => onPick(r.id)}
                className="flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: r.id === picker.current ? 'var(--highlight)' : 'var(--line)', background: 'var(--bg)' }}>
                <span>{r.name}{r.id === picker.current && ' (current)'}</span>
                <span className="text-xs font-bold" style={{ color: r.free ? 'var(--success)' : 'var(--danger)' }}>{r.free ? 'Free' : 'In use'}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 text-right"><Button kind="ghost" onClick={onClose}>Cancel</Button></div>
      </div>
    </div>
  )
}
