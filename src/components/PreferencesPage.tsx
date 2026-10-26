import { useEffect, useState } from 'react'
import { api, errText } from '@/lib/api'
import { Card, Toggle } from './ui'
import { prefersReducedMotion } from '@/lib/motion'

/** Settings that belong to this computer rather than to a school file. */
export function PreferencesPage() {
  const [splash, setSplash] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { api.preferences().then(p => setSplash(p.splash)).catch(e => setError(errText(e))) }, [])
  const change = (on: boolean) => {
    setError(null)
    api.setSplash(on).then(p => setSplash(p.splash)).catch(e => setError(errText(e)))
  }
  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow">This computer</div>
        <h2 className="mt-1 text-2xl font-semibold">Preferences</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          These settings are for this computer and apply to every school you open on it. Light and dark mode are at the top right.
        </p>
      </div>
      {error && <div role="alert" className="rounded-xl border px-4 py-3 text-sm font-medium" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>}
      <Card>
        <h3 className="text-lg font-semibold">Start-up</h3>
        <div className="mt-4">
          <Toggle label="Show the short animation when Timewizer starts" checked={!!splash} onChange={change} />
        </div>
        <p className="mt-3 text-xs" style={{ color: 'var(--muted)' }}>
          It lasts under two seconds; a click or any key skips it. It is never shown when you open a school file by double-clicking it
          {prefersReducedMotion() ? ', and this computer is set to reduce motion, so it is not shown at all.' : ', or when the computer is set to reduce motion.'}
        </p>
      </Card>
    </div>
  )
}
