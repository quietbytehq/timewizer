import { useState } from 'react'
import { Plus, Trash2, Copy, Wand2 } from 'lucide-react'
import type { Day, PeriodTime, Shift } from '@/lib/types'
import { buildDay, fmt, toMinutes } from '@/lib/schedule'
import { Button, Card, Field, inputCls, inputStyle, Toggle } from './ui'

const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function ShiftEditor({ shift, days, onChange }: { shift: Shift; days: Day[]; onChange: (s: Shift) => void }) {
  const working = days.map((d, i) => ({ d, i })).filter(x => x.d.working)
  const [dayIdx, setDayIdx] = useState(working[0]?.i ?? 0)
  const active = working.some(w => w.i === dayIdx) ? dayIdx : (working[0]?.i ?? 0)
  const periods = shift.days[active] ?? []
  const [fill, setFill] = useState({ start: '08:00', count: 7, length: 40, brk: 20 })
  const [copyTo, setCopyTo] = useState('all')

  const setDay = (i: number, ps: PeriodTime[]) => {
    const next = shift.days.map((p, k) => (k === i ? ps : p))
    onChange({ ...shift, days: next })
  }
  const setPeriod = (pi: number, patch: Partial<PeriodTime>) =>
    setDay(active, periods.map((p, k) => (k === pi ? { ...p, ...patch } : p)))

  const addPeriod = () => {
    const last = periods[periods.length - 1]
    const end = last ? toMinutes(last.end) ?? 8 * 60 : 8 * 60
    const len = last ? Math.max(5, end - (toMinutes(last.start) ?? end - 40)) : 40
    setDay(active, [...periods, { start: fmt(end), end: fmt(end + len) }])
  }
  const copyDay = () => {
    const targets = copyTo === 'all' ? working.map(w => w.i).filter(i => i !== active) : [Number(copyTo)]
    const next = shift.days.map((p, k) => (targets.includes(k) ? periods.map(x => ({ ...x })) : p))
    onChange({ ...shift, days: next })
  }
  const setBreak = (bi: number, patch: Partial<Shift['breaks'][number]>) =>
    onChange({ ...shift, breaks: shift.breaks.map((b, k) => (k === bi ? { ...b, ...patch } : b)) })

  const breakAfter = (n: number) => shift.breaks.find(b => b.afterPeriod === n)

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Shift</div>
          <h3 className="text-xl font-semibold">{shift.name}</h3>
        </div>
        <Toggle checked={shift.enabled} onChange={v => onChange({ ...shift, enabled: v })} label={shift.enabled ? 'This shift runs' : 'Not used'} />
      </div>

      {shift.enabled && (
        <div className="mt-6 space-y-8">
          <div>
            <div className="eyebrow">Bell times</div>
            <div className="mt-2 flex flex-wrap gap-2" role="tablist">
              {working.map(({ d, i }) => (
                <button key={i} role="tab" aria-selected={i === active} onClick={() => setDayIdx(i)}
                  className="rounded-full border px-4 py-1.5 text-sm font-semibold transition"
                  style={i === active
                    ? { background: 'var(--ink)', color: 'var(--on-ink)', borderColor: 'var(--ink)' }
                    : { borderColor: 'var(--line)' }}>
                  {SHORT[i] ?? d.name}
                </button>
              ))}
            </div>
            {working.length === 0 && <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>Choose working days first.</p>}

            {working.length > 0 && (
              <>
                <div className="mt-4 rounded-xl border p-4" style={{ borderColor: 'var(--line)' }}>
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Wand2 size={15} /> Quick fill for {days[active].name}</div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <Field label="First bell">
                      <input type="time" className={inputCls} style={inputStyle} value={fill.start}
                        onChange={e => setFill({ ...fill, start: e.target.value })} />
                    </Field>
                    <Field label="Periods">
                      <input type="number" min={1} max={14} className={inputCls} style={inputStyle} value={fill.count}
                        onChange={e => setFill({ ...fill, count: Number(e.target.value) })} />
                    </Field>
                    <Field label="Minutes each">
                      <input type="number" min={5} max={120} className={inputCls} style={inputStyle} value={fill.length}
                        onChange={e => setFill({ ...fill, length: Number(e.target.value) })} />
                    </Field>
                    <Field label="Break minutes">
                      <input type="number" min={0} max={90} className={inputCls} style={inputStyle} value={fill.brk}
                        onChange={e => setFill({ ...fill, brk: Number(e.target.value) })} />
                    </Field>
                    <div className="flex items-end">
                      <Button className="w-full" onClick={() => setDay(active, buildDay(shift, fill.start, Math.max(1, fill.count), Math.max(5, fill.length), Math.max(0, fill.brk)))}>
                        Apply
                      </Button>
                    </div>
                  </div>
                </div>

                <ol className="mt-4 space-y-1.5">
                  {periods.map((p, pi) => {
                    const n = pi + 1
                    const b = breakAfter(n)
                    return (
                      <li key={pi}>
                        <div className="flex items-center gap-3">
                          <span className="w-20 text-sm font-semibold">Period {n}</span>
                          <input type="time" aria-label={`Period ${n} start`} className={`${inputCls} !w-36`} style={inputStyle}
                            value={p.start} onChange={e => setPeriod(pi, { start: e.target.value })} />
                          <span style={{ color: 'var(--muted)' }}>to</span>
                          <input type="time" aria-label={`Period ${n} end`} className={`${inputCls} !w-36`} style={inputStyle}
                            value={p.end} onChange={e => setPeriod(pi, { end: e.target.value })} />
                          <button type="button" title={`Delete period ${n}`} aria-label={`Delete period ${n}`}
                            onClick={() => setDay(active, periods.filter((_, k) => k !== pi))}
                            className="rounded-lg p-2 transition hover:opacity-80" style={{ color: 'var(--danger)' }}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                        {b && pi < periods.length - 1 && (
                          <div className="my-1.5 ml-20 rounded-lg px-3 py-1 text-xs font-semibold"
                            style={{ background: 'var(--bg)', color: 'var(--accent)' }}>
                            {b.name} {b.cannotCross && '· double periods cannot cross'}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ol>
                {periods.length === 0 && <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>No periods yet. Use Quick fill or add one.</p>}

                <Button className="mt-3" onClick={addPeriod}><Plus size={15} /> Add period</Button>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <select className={`${inputCls} !w-auto`} style={inputStyle} value={copyTo} onChange={e => setCopyTo(e.target.value)}
                    aria-label="Copy this day to">
                    <option value="all">All other days</option>
                    {working.filter(w => w.i !== active).map(w => <option key={w.i} value={w.i}>{w.d.name}</option>)}
                  </select>
                  <Button kind="ghost" className="border-[var(--line)]" onClick={copyDay}><Copy size={15} /> Copy {SHORT[active]} times</Button>
                </div>
              </>
            )}
          </div>

          <div>
            <div className="eyebrow">Breaks</div>
            <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
              Breaks and lunch sit between two periods. Turn on “cannot be crossed” to stop double periods running through them.
            </p>
            <ul className="mt-3 space-y-2">
              {shift.breaks.map((b, bi) => (
                <li key={bi} className="flex flex-wrap items-center gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--line)' }}>
                  <input className={`${inputCls} !w-40`} style={inputStyle} value={b.name} aria-label="Break name"
                    onChange={e => setBreak(bi, { name: e.target.value })} />
                  <span className="text-sm">after period</span>
                  <input type="number" min={1} max={14} className={`${inputCls} !w-20`} style={inputStyle} value={b.afterPeriod}
                    aria-label="After period" onChange={e => setBreak(bi, { afterPeriod: Number(e.target.value) })} />
                  <Toggle checked={b.cannotCross} onChange={v => setBreak(bi, { cannotCross: v })} label="Cannot be crossed" />
                  <Button kind="danger" className="ml-auto" aria-label="Remove break"
                    onClick={() => onChange({ ...shift, breaks: shift.breaks.filter((_, k) => k !== bi) })}>
                    <Trash2 size={15} />
                  </Button>
                </li>
              ))}
            </ul>
            <Button className="mt-3" onClick={() => {
              const used = new Set(shift.breaks.map(b => b.afterPeriod))
              let n = 1
              while (used.has(n)) n++
              onChange({ ...shift, breaks: [...shift.breaks, { afterPeriod: n, name: 'Break', cannotCross: true }] })
            }}>
              <Plus size={15} /> Add break
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
