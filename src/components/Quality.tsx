import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Loader2, Wand2, XCircle } from 'lucide-react'
import { api, errText } from '@/lib/api'
import type { ImproveReport, Quality, SchoolSetup, Timetable } from '@/lib/types'
import { Button } from './ui'

/** Before and after for each quality rule. Lower numbers are better. */
export function QualityTable({ before, after }: { before: Quality; after: Quality }) {
  const gain = before.penalty > 0 ? Math.round(((before.penalty - after.penalty) / before.penalty) * 100) : 0
  const rows = before.items.map((b, i) => ({ b, a: after.items[i] })).filter(r => r.b.weight > 0 || r.a.value > 0)
  return (
    <div>
      <div className="mb-2 text-sm font-semibold">
        {gain > 0 ? `Timetable quality improved by ${gain}%` : 'Timetable quality'}
        <span className="font-normal" style={{ color: 'var(--muted)' }}> (fewer problems is better)</span>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(({ b, a }) => (
            <tr key={b.key} className="border-t" style={{ borderColor: 'var(--line)' }}>
              <td className="py-1.5 pr-3">{b.label}</td>
              <td className="whitespace-nowrap py-1.5 text-right" style={{ color: 'var(--muted)' }}>{b.value}</td>
              <td className="px-2"><ArrowRight size={13} style={{ color: 'var(--muted)' }} /></td>
              <td className="whitespace-nowrap py-1.5 text-right font-bold" style={{ color: a.value < b.value ? 'var(--success)' : undefined }}>{a.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** "Improve quality" for the timetable that exists now. Runs in the background and can be stopped. */
export function ImproveButton({ setup, onTimetable, onResult }:
  { setup: SchoolSetup; onTimetable: (t: Timetable) => void; onResult?: (r: ImproveReport | null) => void }) {
  const [running, setRunning] = useState(false)
  const [fraction, setFraction] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const cb = useRef({ onTimetable, onResult })
  useEffect(() => { cb.current = { onTimetable, onResult } })

  useEffect(() => {
    const subs = [
      api.onImproveProgress(f => setFraction(f)),
      api.onImproveDone(r => {
        setRunning(false)
        if (r.qualityAfter.penalty < r.qualityBefore.penalty) cb.current.onTimetable(r.timetable)
        cb.current.onResult?.(r)
      }),
    ]
    return () => { subs.forEach(s => s.then(u => u()).catch(() => {})) }
  }, [])

  const start = async () => {
    setError(null); setFraction(0); setRunning(true); cb.current.onResult?.(null)
    try { await api.startImprove(setup) } catch (e) { setRunning(false); setError(errText(e)) }
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      {running
        ? <Button kind="danger" onClick={() => api.cancelGenerate()}><XCircle size={16} /> Stop</Button>
        : <Button kind="secondary" onClick={start} disabled={!setup.timetable?.cards.length}><Wand2 size={16} /> Improve quality</Button>}
      {running && (
        <div className="flex min-w-[180px] items-center gap-2 text-sm font-semibold" aria-live="polite">
          <Loader2 size={14} className="animate-spin" /> Improving… {Math.round(fraction * 100)}%
        </div>
      )}
      {error && <span role="alert" className="text-sm font-medium" style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  )
}
