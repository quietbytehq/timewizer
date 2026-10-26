import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, HardDriveDownload, History, RefreshCw } from 'lucide-react'
import { api, errText } from '@/lib/api'
import type { BackupEntry, BackupPrefs, SchoolSetup } from '@/lib/types'
import { Button, Card, Field, Toggle, inputCls, inputStyle } from './ui'

const size = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)

/** The backups in the backup folder, newest first, each with a button to open it as a new file. */
export function BackupList({ onRestore, refreshKey = 0 }: { onRestore: (b: BackupEntry) => void; refreshKey?: number }) {
  const [list, setList] = useState<BackupEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    api.listBackups().then(l => { setError(null); setList(l) }).catch(e => { setList(null); setError(errText(e)) })
  }, [])
  useEffect(load, [load, refreshKey])
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          A backup opens as a <strong>new file</strong>. The school you have open now is never replaced.
        </p>
        <Button kind="ghost" onClick={load} title="Look in the backup folder again"><RefreshCw size={15} /> Refresh</Button>
      </div>
      {error && <div role="alert" className="mt-3 rounded-xl border px-4 py-3 text-sm font-medium" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>}
      {list && list.length === 0 && <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>There are no backups in this folder yet.</p>}
      {list && list.length > 0 && (
        <ul className="mt-3 max-h-80 space-y-1.5 overflow-y-auto" aria-label="Backups">
          {list.map(b => (
            <li key={b.path} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2" style={{ borderColor: 'var(--line)', background: 'var(--bg)' }}>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{b.school}</div>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>{b.when} · {size(b.bytes)}</div>
              </div>
              <Button kind="ghost" onClick={() => onRestore(b)} aria-label={`Open the backup of ${b.school} from ${b.when} as a new file`}>
                <History size={15} /> Open as new file…
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function BackupPage({ setup, onRestore }: { setup: SchoolSetup; onRestore: (b: BackupEntry) => void }) {
  const [prefs, setPrefs] = useState<BackupPrefs | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [keep, setKeep] = useState('')

  useEffect(() => {
    api.preferences().then(p => { setPrefs(p.backup); setKeep(String(p.backup.keep)) }).catch(e => setError(errText(e)))
  }, [])

  const change = async (next: BackupPrefs) => {
    setError(null); setDone(null)
    try {
      const p = await api.setBackupPrefs(next)
      setPrefs(p.backup); setKeep(String(p.backup.keep)); setRefresh(n => n + 1)
    } catch (e) { setError(errText(e)) }
  }
  const choose = async () => {
    if (!prefs) return
    const f = await api.pickFolder().catch(e => { setError(errText(e)); return null })
    if (f) await change({ ...prefs, folder: f })
  }
  const now = async () => {
    setBusy(true); setError(null); setDone(null)
    try {
      const p = await api.backUpNow(setup)
      setDone(`Backed up as "${p.split(/[\\/]/).pop()}".`); setRefresh(n => n + 1)
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  const commitKeep = () => {
    if (!prefs) return
    const n = Math.floor(Number(keep))
    if (!Number.isFinite(n) || n < 1) { setKeep(String(prefs.keep)); return }
    if (n !== prefs.keep) change({ ...prefs, keep: n })
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow">Safety</div>
        <h2 className="mt-1 text-2xl font-semibold">Backups</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Keep copies of your school file in a folder of your choice: a USB stick, a shared drive, or a folder that
          OneDrive, Google Drive or Dropbox keeps in sync. These settings are for this computer and apply to every school you open on it.
        </p>
      </div>

      {error && <div role="alert" className="rounded-xl border px-4 py-3 text-sm font-medium" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>}
      {done && <div role="status" className="rounded-xl border px-4 py-3 text-sm font-medium" style={{ borderColor: 'var(--success)', color: 'var(--success)' }}>{done}</div>}

      <Card>
        <h3 className="text-lg font-semibold">Backup folder</h3>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <code className="min-w-0 flex-1 truncate rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--line)', background: 'var(--bg)' }}
            data-testid="backup-folder" title={prefs?.folder ?? undefined}>
            {prefs?.folder ?? 'No folder chosen yet'}
          </code>
          <Button onClick={choose} disabled={!prefs}><FolderOpen size={16} /> {prefs?.folder ? 'Change folder…' : 'Choose folder…'}</Button>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="How many backups to keep" hint="For each school. When there are more, the oldest are removed. Other files in the folder are never touched.">
            <input className={inputCls} style={inputStyle} type="number" min={1} max={999} value={keep} disabled={!prefs}
              onChange={e => setKeep(e.target.value)} onBlur={commitKeep} onKeyDown={e => { if (e.key === 'Enter') commitKeep() }} />
          </Field>
          <Field label="Automatic backup" group>
            <Toggle label="Back up every time I save" checked={!!prefs?.auto} onChange={v => prefs && change({ ...prefs, auto: v })} />
          </Field>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button kind="primary" onClick={now} disabled={busy || !prefs?.folder}><HardDriveDownload size={16} /> Back up now</Button>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Saves a copy of the school as it is on screen now, including changes you have not saved yet.</span>
        </div>
      </Card>

      {prefs?.folder && (
        <Card>
          <h3 className="text-lg font-semibold">Restore from backup</h3>
          <div className="mt-3"><BackupList onRestore={onRestore} refreshKey={refresh} /></div>
        </Card>
      )}
    </div>
  )
}
