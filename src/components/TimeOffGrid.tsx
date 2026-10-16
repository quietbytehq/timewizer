import type { Day, Shift, TimeOffCell } from '@/lib/types'

const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const LABEL = ['Available', 'Avoid if possible', 'Not available']
const look = [
  { background: 'var(--bg)', color: 'var(--muted)', borderColor: 'var(--line)' },
  { background: 'var(--warning)', color: '#18343F', borderColor: 'var(--warning)' },
  { background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' },
]

const stateOf = (cells: TimeOffCell[], shift: string, day: number, period: number) =>
  cells.find(c => c.shift === shift && c.day === day && c.period === period)?.state ?? 0

/** Click a cell to cycle Available -> Avoid -> Not available. Click a day name to flip the whole day. */
export function TimeOffGrid({ shift, days, value, onChange }:
  { shift: Shift; days: Day[]; value: TimeOffCell[]; onChange: (v: TimeOffCell[]) => void }) {
  const working = days.map((d, i) => ({ d, i })).filter(x => x.d.working)
  const rows = Math.max(0, ...working.map(w => shift.days[w.i]?.length ?? 0))
  const set = (day: number, period: number, state: number) => {
    const rest = value.filter(c => !(c.shift === shift.id && c.day === day && c.period === period))
    onChange(state === 0 ? rest : [...rest, { shift: shift.id, day, period, state: state as 1 | 2 }])
  }
  const flipDay = (day: number) => {
    const n = shift.days[day]?.length ?? 0
    const allOff = Array.from({ length: n }, (_, p) => stateOf(value, shift.id, day, p + 1)).every(s => s === 2)
    const rest = value.filter(c => !(c.shift === shift.id && c.day === day))
    onChange(allOff ? rest : [...rest, ...Array.from({ length: n }, (_, p) => ({ shift: shift.id, day, period: p + 1, state: 2 as const }))])
  }
  if (rows === 0) return <p className="text-sm" style={{ color: 'var(--muted)' }}>This shift has no periods yet.</p>
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--muted)' }}>
        {LABEL.map((l, i) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border" style={look[i]} /> {l}
          </span>
        ))}
        <button type="button" className="ml-auto underline" onClick={() => onChange(value.filter(c => c.shift !== shift.id))}>
          Clear all
        </button>
      </div>
      <table className="border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th />
            {working.map(({ i }) => (
              <th key={i}>
                <button type="button" title="Click to mark the whole day Not available (click again to free it)" onClick={() => flipDay(i)}
                  className="w-full rounded-lg px-2 py-1 text-xs font-bold uppercase tracking-wider hover:opacity-70">
                  {SHORT[i]}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, p) => (
            <tr key={p}>
              <th className="pr-2 text-right text-xs font-semibold" style={{ color: 'var(--muted)' }}>P{p + 1}</th>
              {working.map(({ i }) => {
                const exists = p < (shift.days[i]?.length ?? 0)
                const st = stateOf(value, shift.id, i, p + 1)
                return (
                  <td key={i}>
                    {exists ? (
                      <button type="button" aria-label={`${SHORT[i]} period ${p + 1}: ${LABEL[st]}`}
                        onClick={() => set(i, p + 1, (st + 1) % 3)}
                        className="h-9 w-14 rounded-lg border text-xs font-bold transition hover:opacity-80"
                        style={look[st]}>
                        {st === 2 ? '✕' : st === 1 ? '!' : ''}
                      </button>
                    ) : <div title={`No period ${p + 1} on ${SHORT[i]}`} aria-label={`${SHORT[i]} period ${p + 1}: no period`}
                        className="flex h-9 w-14 cursor-not-allowed items-center justify-center rounded-lg border border-dashed text-xs"
                        style={{ background: 'repeating-linear-gradient(135deg, var(--line) 0 4px, transparent 4px 8px)', color: 'var(--muted)', borderColor: 'var(--line)', opacity: 0.55 }}>
                        –
                      </div>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** One grid per enabled shift in `shiftIds`. */
export function TimeOffEditor({ shifts, shiftIds, days, value, onChange }:
  { shifts: Shift[]; shiftIds: string[]; days: Day[]; value: TimeOffCell[]; onChange: (v: TimeOffCell[]) => void }) {
  const list = shifts.filter(s => s.enabled && shiftIds.includes(s.id))
  if (list.length === 0) return <p className="text-sm" style={{ color: 'var(--muted)' }}>Choose a shift first.</p>
  return (
    <div className="space-y-5">
      {list.map(s => (
        <div key={s.id}>
          {list.length > 1 && <div className="eyebrow mb-1">{s.name} shift</div>}
          <TimeOffGrid shift={s} days={days} value={value} onChange={onChange} />
        </div>
      ))}
    </div>
  )
}
