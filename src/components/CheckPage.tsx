import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { api } from '@/lib/api'
import type { CheckReport, SchoolSetup } from '@/lib/types'
import { Card } from '@/components/ui'

export function CheckPage({ setup }: { setup: SchoolSetup }) {
  const [report, setReport] = useState<CheckReport | null>(null)
  useEffect(() => {
    let live = true
    api.checkSetup(setup).then(r => { if (live) setReport(r) }).catch(() => {})
    return () => { live = false }
  }, [setup])

  const ok = report && report.errors === 0
  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow">Step 10</div>
        <h2 className="mt-1 text-2xl font-semibold">Check before building</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Looks for lessons that can never fit, before any timetable is built. It updates as you change things.
        </p>
      </div>
      {report && (
        <Card>
          <div className="flex items-center gap-3">
            {ok ? <CheckCircle2 style={{ color: 'var(--success)' }} /> : <XCircle style={{ color: 'var(--danger)' }} />}
            <div>
              <div className="font-semibold">
                {ok ? 'No impossible lessons found.' : `${report.errors} ${report.errors === 1 ? 'problem' : 'problems'} to fix before building.`}
              </div>
              <div className="text-sm" style={{ color: 'var(--muted)' }}>
                {report.cards} lesson sessions ({report.periods} periods){report.warnings > 0 && ` · ${report.warnings} ${report.warnings === 1 ? 'note' : 'notes'}`}
              </div>
            </div>
          </div>
        </Card>
      )}
      {report?.findings.map((f, i) => (
        <Card key={i}>
          <div className="flex gap-3">
            {f.level === 'error'
              ? <XCircle size={20} className="mt-0.5 shrink-0" style={{ color: 'var(--danger)' }} />
              : <AlertTriangle size={20} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />}
            <div className="space-y-1.5">
              <div className="font-semibold">{f.title}</div>
              <p className="text-sm">{f.message}</p>
              <p className="text-sm" style={{ color: 'var(--muted)' }}><strong>How to fix:</strong> {f.fix}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}
