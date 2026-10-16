import type { SchoolSetup, Settings, Weights } from '@/lib/types'
import { Card, Field, Toggle } from './ui'
import { NumIn } from './MasterData'

const WEIGHTS: { key: keyof Weights; label: string; hint: string }[] = [
  { key: 'teacherGaps', label: 'Teachers: no free periods in the middle of the day', hint: 'Fewer "windows" between a teacher\'s first and last lesson.' },
  { key: 'classGaps', label: 'Classes: start early, no free periods', hint: 'Classes begin at period 1 and have no gaps until the end of their day.' },
  { key: 'spread', label: 'Spread lessons across the week', hint: 'A subject taught three times a week is better on Mon-Wed-Fri than Mon-Tue-Wed.' },
  { key: 'avoid', label: 'Respect "avoid if possible" times', hint: 'The amber cells in teachers\' and classes\' time-off grids.' },
  { key: 'balance', label: 'Even days for each class', hint: 'Similar number of periods on each day.' },
  { key: 'roomConsistency', label: 'Same room all week', hint: 'All sessions of a lesson in the same room.' },
]

export function RulesPage({ setup, onChange }: { setup: SchoolSetup; onChange: (s: SchoolSetup) => void }) {
  const st = setup.settings
  const set = (patch: Partial<Settings>) => onChange({ ...setup, settings: { ...st, ...patch } })
  const setW = (k: keyof Weights, v: number) => set({ weights: { ...st.weights, [k]: v } })
  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow">Step 4</div>
        <h2 className="mt-1 text-2xl font-semibold">Rules and limits</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          School-wide rules. These are always kept when the timetable is built, unless you allow bending them below.
        </p>
      </div>

      <Card>
        <h3 className="text-lg font-semibold">Teacher limits for the whole school</h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          These apply to every teacher. A teacher can have their own numbers on the Teachers page, which replace these.
        </p>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="Most periods per day"><NumIn value={st.defaultMaxPerDay} onChange={v => set({ defaultMaxPerDay: v })} /></Field>
          <Field label="Most periods per week"><NumIn value={st.defaultMaxPerWeek} onChange={v => set({ defaultMaxPerWeek: v })} /></Field>
        </div>
      </Card>

      <Card>
        <h3 className="text-lg font-semibold">Same subject on the same day</h3>
        <div className="mt-4 max-w-lg">
          <Field label="Most sessions of one subject per class per day"
            hint="1 means a class never has, for example, two separate Maths sessions on one day. A double period counts as one session. If a subject has more sessions than days, it will share days automatically.">
            <input className="w-full rounded-xl border px-3 py-2 text-sm" type="number" min={1} max={8}
              style={{ background: 'var(--bg)', borderColor: 'var(--line)', color: 'var(--ink)' }}
              value={st.maxSameSubjectPerDay} onChange={e => set({ maxSameSubjectPerDay: Math.max(1, Math.floor(Number(e.target.value)) || 1) })} />
          </Field>
        </div>
      </Card>

      <Card>
        <h3 className="text-lg font-semibold">What makes a timetable good</h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          After all lesson sessions are placed, Timewizer improves the timetable using these wishes. 0 = ignore, 10 = very important.
        </p>
        <div className="mt-5 space-y-5">
          {WEIGHTS.map(w => (
            <div key={w.key}>
              <div className="flex items-center justify-between gap-4">
                <label htmlFor={`w-${w.key}`} className="text-sm font-semibold">{w.label}</label>
                <span className="w-6 text-right text-sm font-bold">{st.weights[w.key]}</span>
              </div>
              <input id={`w-${w.key}`} type="range" min={0} max={10} step={1} value={st.weights[w.key]}
                className="mt-1 w-full accent-[var(--accent)]" onChange={e => setW(w.key, Number(e.target.value))} />
              <p className="text-xs" style={{ color: 'var(--muted)' }}>{w.hint}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 max-w-xs">
          <Field label="Time spent improving (seconds)" hint="More time can give a better timetable. 0 skips improving.">
            <NumIn value={st.improveSeconds} placeholder="20" onChange={v => set({ improveSeconds: v ?? 0 })} />
          </Field>
        </div>
      </Card>

      <Card>
        <h3 className="text-lg font-semibold">If a timetable is not possible</h3>
        <div className="mt-4">
          <Toggle checked={st.allowRelaxation} onChange={v => set({ allowRelaxation: v })}
            label="Allow bending a few rules to place every lesson, and tell me which" />
        </div>
        <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
          Only used when some lessons cannot be placed. It may allow two sessions of one lesson on a day, more of the same subject in a day,
          or longer runs of lessons for a teacher. Clashes and time off are never bent. Every bent rule is listed afterwards.
        </p>
      </Card>
    </div>
  )
}
