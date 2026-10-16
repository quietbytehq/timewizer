import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, XCircle } from 'lucide-react'
import { api, errText } from '@/lib/api'
import type { GenProgress, ImproveReport, PlacedCard, SchoolSetup, SolveReport } from '@/lib/types'
import { ImproveButton, QualityTable } from './Quality'
import { inkOn } from '@/lib/color'
import { Button, Card, inputCls, inputStyle } from '@/components/ui'

export function GeneratePage({ setup, onChange }: { setup: SchoolSetup; onChange: (s: SchoolSetup) => void }) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<GenProgress>({ phase: 'placing', placed: 0, total: 0, fraction: 0 })
  const [improved, setImproved] = useState<ImproveReport | null>(null)
  const [report, setReport] = useState<SolveReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(setup)
  latest.current = setup

  useEffect(() => {
    const subs = [
      api.onProgress(p => setProgress(p)),
      api.onDone(r => {
        setRunning(false); setReport(r)
        // Keep the new timetable unless the person pressed Stop (then the old one stays).
        if (!r.cancelled && r.placed > 0) onChange({ ...latest.current, timetable: r.timetable })
      }),
    ]
    return () => { subs.forEach(s => s.then(u => u()).catch(() => {})) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = async () => {
    setError(null); setReport(null); setImproved(null); setProgress({ phase: 'placing', placed: 0, total: 0, fraction: 0 }); setRunning(true)
    try { await api.startGenerate(setup) } catch (e) { setRunning(false); setError(errText(e)) }
  }
  const improving = progress.phase === 'improving'
  const pct = improving ? Math.round(progress.fraction * 100) : progress.total ? Math.round((progress.placed / progress.total) * 100) : 0
  const locked = setup.timetable?.cards.filter(c => c.locked).length ?? 0

  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow">Step 11</div>
        <h2 className="mt-1 text-2xl font-semibold">Build the timetable</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Places every lesson so that no teacher, class or room is in two places at once, and every time-off rule is respected.
          {locked > 0 && ` ${locked} locked ${locked === 1 ? 'lesson stays' : 'lessons stay'} where ${locked === 1 ? 'it is' : 'they are'}.`}
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-4">
          {running
            ? <Button kind="danger" onClick={() => api.cancelGenerate()}><XCircle size={16} /> Stop</Button>
            : <Button kind="primary" onClick={start}><Sparkles size={16} /> {setup.timetable ? 'Build again' : 'Build timetable'}</Button>}
          {!running && setup.timetable && setup.timetable.cards.length > 0 && (
            <ImproveButton setup={setup} onTimetable={t => onChange({ ...latest.current, timetable: t })} onResult={setImproved} />
          )}
          {running && (
            <div className="min-w-[240px] flex-1" aria-live="polite">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                <Loader2 size={14} className="animate-spin" />
                {improving ? `Improving the timetable… ${pct}%` : `${progress.placed} of ${progress.total || '…'} lesson sessions placed`}
              </div>
              <div className="h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--line)' }}
                role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: 'var(--highlight)' }} />
              </div>
            </div>
          )}
        </div>
        {error && <p role="alert" className="mt-3 text-sm font-medium" style={{ color: 'var(--danger)' }}>{error}</p>}
      </Card>

      {report && <ReportView report={report} />}
      {improved && (
        <Card><QualityTable before={improved.qualityBefore} after={improved.qualityAfter} /></Card>
      )}
      {!running && setup.timetable && <ClassGrid setup={setup} cards={setup.timetable.cards} />}
    </div>
  )
}

function ReportView({ report }: { report: SolveReport }) {
  const full = report.unplaced.length === 0 && !report.cancelled
  return (
    <>
      <Card>
        <div className="flex items-center gap-3">
          {full ? <CheckCircle2 style={{ color: 'var(--success)' }} /> : report.cancelled ? <XCircle style={{ color: 'var(--muted)' }} /> : <AlertTriangle style={{ color: 'var(--warning)' }} />}
          <div>
            <div className="font-semibold">
              {report.cancelled ? 'Stopped. Your previous timetable (if any) was kept.'
                : full ? `All ${report.total} lesson sessions are placed.`
                : `${report.placed} of ${report.total} lesson sessions placed. ${report.total - report.placed} could not be fitted in.`}
            </div>
            <div className="text-sm" style={{ color: 'var(--muted)' }}>
              Took {report.seconds < 10 ? report.seconds.toFixed(1) : Math.round(report.seconds)} seconds
              {report.timedOut && ' (time limit reached)'}
            </div>
          </div>
        </div>
      </Card>
      {report.relaxed.length > 0 && (
        <Card>
          <div className="flex gap-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
            <div className="space-y-2">
              <div className="font-semibold">To place every lesson, {report.relaxed.length === 1 ? 'one rule was' : `${report.relaxed.length} rules were`} bent</div>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {report.relaxed.map((r, i) => <li key={i}>{r.message}</li>)}
              </ul>
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                <strong>How to fix:</strong> raise the limit, give a lesson to another teacher, or free up time. Then build again.
                Nobody is ever in two places at once, and time off is never bent.
              </p>
            </div>
          </div>
        </Card>
      )}
      {!report.cancelled && report.qualityBefore.penalty !== report.qualityAfter.penalty && (
        <Card><QualityTable before={report.qualityBefore} after={report.qualityAfter} /></Card>
      )}
      {report.unplaced.map((u, i) => (
        <Card key={i}>
          <div className="flex gap-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
            <div className="space-y-1.5">
              <div className="font-semibold">{u.title}</div>
              <p className="text-sm">{u.message}</p>
              <p className="text-sm" style={{ color: 'var(--muted)' }}><strong>How to fix:</strong> {u.fix}</p>
            </div>
          </div>
        </Card>
      ))}
    </>
  )
}

const SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** A simple read-only view, one class at a time. (Full views and editing come in the next milestone.) */
function ClassGrid({ setup, cards }: { setup: SchoolSetup; cards: PlacedCard[] }) {
  const classes = setup.master.classes
  const [cid, setCid] = useState(classes[0]?.id ?? '')
  const cls = classes.find(c => c.id === cid) ?? classes[0]
  if (!cls) return null
  const shift = setup.shifts.find(s => s.id === cls.shift)
  if (!shift) return null
  const days = setup.days.map((d, i) => ({ d, i })).filter(x => x.d.working)
  const rows = Math.max(0, ...days.map(x => shift.days[x.i]?.length ?? 0))
  const lesson = (id: string) => setup.lessons.find(l => l.id === id)
  const mine = cards.filter(c => c.shift === shift.id && lesson(c.lessonId)?.parts.some(p => p.classId === cls.id))
  const at = (day: number, period: number) => mine.filter(c => c.day === day && period >= c.period && period < c.period + c.length)

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="eyebrow">Preview</div>
        <select value={cls.id} onChange={e => setCid(e.target.value)} aria-label="Class"
          className={`${inputCls} !w-auto`} style={inputStyle}>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1 text-xs">
          <thead>
            <tr><th />{days.map(({ i }) => <th key={i} className="eyebrow px-2 py-1">{SHORT[i]}</th>)}</tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, p) => (
              <tr key={p}>
                <th className="pr-2 text-right font-semibold" style={{ color: 'var(--muted)' }}>P{p + 1}</th>
                {days.map(({ i }) => {
                  if (p >= (shift.days[i]?.length ?? 0)) {
                    return <td key={i}><div className="h-12 w-28 rounded-lg opacity-40" style={{ background: 'repeating-linear-gradient(135deg, var(--line) 0 4px, transparent 4px 8px)' }} /></td>
                  }
                  const here = at(i, p + 1)
                  return (
                    <td key={i}>
                      <div className="flex h-12 w-28 flex-col gap-0.5">
                        {here.length === 0 && <div className="h-full rounded-lg border border-dashed" style={{ borderColor: 'var(--line)' }} />}
                        {here.map((c, k) => {
                          const l = lesson(c.lessonId)
                          const sub = setup.master.subjects.find(s => s.id === l?.subject)
                          const teachers = l?.teachers.map(t => setup.master.teachers.find(x => x.id === t)?.shortName).filter(Boolean).join(', ')
                          const room = setup.master.rooms.find(r => r.id === c.room)
                          return (
                            <div key={k} className="flex-1 overflow-hidden rounded-lg px-1.5 py-0.5 leading-tight"
                              style={{ background: sub?.color ?? 'var(--line)', color: inkOn(sub?.color ?? '#DCD0BC') }}
                              title={`${sub?.name ?? ''} · ${teachers ?? ''}${room ? ` · ${room.name}` : ''}`}>
                              <div className="truncate font-bold">{sub?.shortName ?? sub?.name}</div>
                              <div className="truncate opacity-80">{teachers}{room ? ` · ${room.shortName}` : ''}</div>
                            </div>
                          )
                        })}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
