import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { AlertTriangle, BarChart3, FileUp, BookOpen, ClipboardList, ClipboardCheck, LayoutGrid, Printer, SlidersHorizontal, Sparkles, CalendarDays, Check, Clock, HardDrive, Settings2, UserCheck, DoorOpen, GraduationCap, Monitor, Moon, School, Sun, Users, XCircle } from 'lucide-react'
import { applyTheme, getStoredTheme, type ThemeChoice } from '@/lib/theme'
import { api, errText } from '@/lib/api'
import type { BackupEntry, Issue, SaveOutcome, SchoolSetup } from '@/lib/types'
import { Welcome } from '@/components/Welcome'
import { SetupEditor, type Section } from '@/components/SetupEditor'
import { MasterDataEditor, type MasterSection } from '@/components/MasterData'
import { ImportPage } from '@/components/ImportPage'
import { LessonsEditor, WorkloadView } from '@/components/Lessons'
import { CheckPage } from '@/components/CheckPage'
import { GeneratePage } from '@/components/GeneratePage'
import { PrintPage } from '@/components/PrintPage'
import { RulesPage } from '@/components/RulesPage'
import { TimetablePage } from '@/components/TimetablePage'
import { MAX_HISTORY, type History, type HistoryStep } from '@/lib/history'
import { BackupPage } from '@/components/BackupPage'
import { PreferencesPage } from '@/components/PreferencesPage'
import { SubstitutionsPage } from '@/components/SubstitutionsPage'
import { Splash } from '@/components/Splash'
import { prefersReducedMotion } from '@/lib/motion'
import { Button, surface } from '@/components/ui'

const themeOptions: { id: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'system', label: 'Auto', Icon: Monitor },
  { id: 'dark', label: 'Dark', Icon: Moon },
]

const sections: { id: Section; label: string; Icon: typeof Sun }[] = [
  { id: 'school', label: 'School', Icon: School },
  { id: 'days', label: 'Working days', Icon: CalendarDays },
  { id: 'shifts', label: 'Shifts & bells', Icon: Clock },
  { id: 'rules', label: 'Rules & limits', Icon: SlidersHorizontal },
]
const dataSections: { id: MasterSection; label: string; Icon: typeof Sun }[] = [
  { id: 'subjects', label: 'Subjects', Icon: BookOpen },
  { id: 'teachers', label: 'Teachers', Icon: Users },
  { id: 'classes', label: 'Classes', Icon: GraduationCap },
  { id: 'rooms', label: 'Rooms', Icon: DoorOpen },
]
const planSections: { id: 'lessons' | 'workload' | 'import' | 'check' | 'generate' | 'timetable' | 'print'; label: string; Icon: typeof Sun }[] = [
  { id: 'lessons', label: 'Lessons', Icon: ClipboardList },
  { id: 'workload', label: 'Workload', Icon: BarChart3 },
  { id: 'import', label: 'Import data', Icon: FileUp },
  { id: 'check', label: 'Check before building', Icon: ClipboardCheck },
  { id: 'generate', label: 'Build timetable', Icon: Sparkles },
  { id: 'timetable', label: 'Timetable', Icon: LayoutGrid },
  { id: 'print', label: 'Print & export', Icon: Printer },
]
type Page = Section | MasterSection | 'backups' | 'preferences' | 'substitutions' | 'lessons' | 'workload' | 'import' | 'check' | 'generate' | 'timetable' | 'print'

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p

export default function App() {
  const [theme, setTheme] = useState<ThemeChoice>(getStoredTheme)
  const [setup, setSetup] = useState<SchoolSetup | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [section, setSection] = useState<Page>('school')
  const [issues, setIssues] = useState<Issue[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // The start-up animation: 'wait' (a plain cover for the few milliseconds it takes to read the
  // preference), 'show', or 'off'. It is skipped for reduced motion and for a double-clicked file.
  const [splash, setSplash] = useState<'wait' | 'show' | 'off'>(() => (prefersReducedMotion() ? 'off' : 'wait'))
  const endSplash = useCallback(() => setSplash('off'), [])
  const seq = useRef(0)
  // Timetable edits that can be undone, oldest first. Each step keeps the timetable before and
  // after it (shared with the neighbouring steps, so no extra copies).
  const hist = useRef<{ done: HistoryStep[]; undone: HistoryStep[] }>({ done: [], undone: [] })
  const [, bump] = useState(0)

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => applyTheme('system')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [theme])

  // Re-check the setup a moment after every change.
  useEffect(() => {
    if (!setup) return
    const id = ++seq.current
    const t = setTimeout(() => {
      api.validate(setup).then(r => { if (id === seq.current) setIssues(r) }).catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [setup])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }

  // Every change goes through here so that timetable edits can be undone. `label` says in plain
  // words what the edit did (shown in the change history).
  const update = (s: SchoolSetup, label?: string) => {
    if (setup && s.timetable !== setup.timetable) {
      const step: HistoryStep = { label: label ?? 'Changed the timetable', at: Date.now(), before: setup.timetable ?? null, after: s.timetable ?? null }
      hist.current.done = [...hist.current.done.slice(-(MAX_HISTORY - 1)), step]
      hist.current.undone = []
    }
    setSetup(s); setDirty(true)
  }
  const undo = () => {
    const h = hist.current
    const step = h.done.pop()
    if (!setup || !step) return
    h.undone.push(step)
    setSetup({ ...setup, timetable: step.before }); setDirty(true); bump(n => n + 1)
  }
  const redo = () => {
    const h = hist.current
    const step = h.undone.pop()
    if (!setup || !step) return
    h.done.push(step)
    setSetup({ ...setup, timetable: step.after }); setDirty(true); bump(n => n + 1)
  }

  const opened = (p: string, s: SchoolSetup) => { hist.current = { done: [], undone: [] }; setPath(p); setSetup(s); setDirty(false); setSection('school') }

  const newSchool = (name: string) => run(async () => {
    const p = await api.pickNewPath(name.trim())
    if (!p) return
    const r = await api.create(p, name)
    opened(r.path, r.setup)
  })
  const openSchool = () => run(async () => {
    const p = await api.pickOpenPath()
    if (!p) return
    const r = await api.open(p)
    opened(r.path, r.setup)
  })
  // Double-clicking a .twz file in the file manager starts the program with that file.
  // The animation never delays the file: it is switched off as soon as there is one.
  useEffect(() => {
    api.startupFile().then(p => {
      if (!p) return
      setSplash('off')
      return run(async () => { const r = await api.open(p); opened(r.path, r.setup) })
    }).catch(() => {})
    api.preferences().then(p => setSplash(s => (s === 'wait' ? (p.splash ? 'show' : 'off') : s))).catch(() => setSplash('off'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // The school is saved even when the automatic backup fails; the person is told, not stopped.
  const afterSave = (o: SaveOutcome) => {
    setNotice(o.backupError ? `Your school was saved, but the automatic backup did not work. ${o.backupError}` : null)
  }
  const save = useCallback(() => run(async () => {
    if (!setup) return
    afterSave(await api.save(setup))
    setDirty(false); setSavedAt(true)
    setTimeout(() => setSavedAt(false), 2000)
  }), [setup])
  const saveAs = () => run(async () => {
    if (!setup) return
    const p = await api.pickNewPath(setup.name)
    if (!p) return
    const o = await api.saveAs(p, setup)
    setPath(o.path); setDirty(false); afterSave(o)
  })
  // A backup is always opened as a new file: the person picks where it goes.
  const restore = (b: BackupEntry) => run(async () => {
    if (setup && dirty && !window.confirm('You have unsaved changes in the school that is open now. Open the backup without saving them?')) return
    const p = await api.pickNewPath(`${b.school} restored ${b.when.slice(0, 10)}`)
    if (!p) return
    const r = await api.restoreBackup(b.path, p)
    opened(r.path, r.setup); setNotice(null)
  })
  const close = () => run(async () => {
    if (dirty && !window.confirm('You have unsaved changes. Close without saving?')) return
    await api.close(); setSetup(null); setPath(null); setIssues([]); setNotice(null)
  })

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && setup) { e.preventDefault(); save() }
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement | null)?.tagName ?? '')
      if ((e.ctrlKey || e.metaKey) && !typing && (section === 'timetable' || section === 'generate')) {
        const k = e.key.toLowerCase()
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save, setup, section])

  const history: History = { undo, redo, done: hist.current.done, undone: hist.current.undone }
  const errors = issues.filter(i => i.level === 'error')
  const warnings = issues.filter(i => i.level === 'warning')

  return (
    <div className="min-h-screen">
      {splash === 'wait' && (
        <div data-testid="boot" className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'var(--bg)' }} onClick={endSplash}>
          <img src="/timewizer-logo.svg" alt="Timewizer is starting" className="h-28 w-28 rounded-3xl" style={{ boxShadow: '0 12px 40px rgba(15,34,41,0.25)' }} />
        </div>
      )}
      <AnimatePresence>{splash === 'show' && <Splash key="splash" onDone={endSplash} />}</AnimatePresence>
      <header className="flex items-center justify-between border-b px-8 py-3" style={surface}>
        <div className="flex items-center gap-3">
          <img src="/timewizer-logo.svg" alt="Timewizer" className="h-14 w-14 rounded-2xl" style={{ boxShadow: '0 0 0 1px var(--line)' }} />
          <div>
            <div className="font-serif text-xl font-semibold leading-tight">Timewizer</div>
            {setup && path && (
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                {setup.name || 'Untitled school'} · {fileName(path)}{dirty && ' · unsaved changes'}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {setup && (
            <>
              <Button kind="ghost" onClick={close} disabled={busy}>Close</Button>
              <Button kind="ghost" onClick={saveAs} disabled={busy}>Save as…</Button>
              <Button kind="primary" onClick={save} disabled={busy || !dirty && !savedAt}>
                {savedAt ? <><Check size={16} /> Saved</> : 'Save'}
              </Button>
            </>
          )}
          <div className="flex gap-1 rounded-full p-1" style={{ background: 'var(--bg)' }} role="radiogroup" aria-label="Theme">
            {themeOptions.map(({ id, label, Icon }) => (
              <button key={id} role="radio" aria-checked={theme === id} aria-label={label} title={label} onClick={() => setTheme(id)}
                className="flex items-center rounded-full p-2 transition hover:opacity-80"
                style={theme === id ? { background: 'var(--ink)', color: 'var(--on-ink)' } : undefined}>
                <Icon size={15} />
              </button>
            ))}
          </div>
        </div>
      </header>

      {!setup ? (
        <Welcome busy={busy} error={error} onNew={newSchool} onOpen={openSchool} onRestore={restore} />
      ) : (
        <div className="mx-auto grid max-w-7xl gap-8 px-8 py-8 md:grid-cols-[220px_1fr]">
          <nav className="space-y-1" aria-label="Setup steps">
            <div className="eyebrow mb-2">School setup</div>
            {sections.map(({ id, label, Icon }) => (
              <button key={id} onClick={() => setSection(id)}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition"
                style={section === id ? { background: 'var(--ink)', color: 'var(--on-ink)' } : undefined}>
                <Icon size={16} /> {label}
              </button>
            ))}
            <button onClick={() => setSection('backups')}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition"
              style={section === 'backups' ? { background: 'var(--ink)', color: 'var(--on-ink)' } : undefined}>
              <HardDrive size={16} /> Backups
            </button>
            <button onClick={() => setSection('preferences')}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition"
              style={section === 'preferences' ? { background: 'var(--ink)', color: 'var(--on-ink)' } : undefined}>
              <Settings2 size={16} /> Preferences
            </button>
            <div className="eyebrow mb-2 mt-6">Master data</div>
            {dataSections.map(({ id, label, Icon }) => (
              <button key={id} onClick={() => setSection(id)}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition"
                style={section === id ? { background: 'var(--ink)', color: 'var(--on-ink)' } : undefined}>
                <Icon size={16} /> {label}
              </button>
            ))}
            <div className="eyebrow mb-2 mt-6">Lessons</div>
            {planSections.map(({ id, label, Icon }) => (
              <button key={id} onClick={() => setSection(id)}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition"
                style={section === id ? { background: 'var(--ink)', color: 'var(--on-ink)' } : undefined}>
                <Icon size={16} /> {label}
              </button>
            ))}
            <div className="eyebrow mb-2 mt-6">Day to day</div>
            <button onClick={() => setSection('substitutions')}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition"
              style={section === 'substitutions' ? { background: 'var(--ink)', color: 'var(--on-ink)' } : undefined}>
              <UserCheck size={16} /> Substitutions
            </button>
          </nav>
          <div className="min-w-0 space-y-6">
            {error && (
              <div role="alert" className="rounded-xl border px-4 py-3 text-sm font-medium"
                style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>
            )}
            {notice && (
              <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium"
                style={{ borderColor: 'var(--warning)' }}>
                <span>{notice}</span>
                <button type="button" className="text-xs font-semibold underline" onClick={() => setNotice(null)}>Dismiss</button>
              </div>
            )}
            {issues.length > 0 && (
              <div className="rounded-2xl border p-4 text-sm" style={surface}>
                <div className="mb-2 font-semibold">
                  {errors.length > 0 ? 'Please fix these before generating a timetable' : 'Things to look at'}
                </div>
                <ul className="space-y-1.5">
                  {errors.map((i, k) => (
                    <li key={`e${k}`} className="flex gap-2" style={{ color: 'var(--danger)' }}>
                      <XCircle size={16} className="mt-0.5 shrink-0" /> {i.message}
                    </li>
                  ))}
                  {warnings.map((i, k) => (
                    <li key={`w${k}`} className="flex gap-2">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} /> {i.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {section === 'substitutions' ? (
              <SubstitutionsPage setup={setup} onChange={update} />
            ) : section === 'preferences' ? (
              <PreferencesPage />
            ) : section === 'backups' ? (
              <BackupPage setup={setup} onRestore={restore} />
            ) : section === 'rules' ? (
              <RulesPage setup={setup} onChange={update} />
            ) : (['school', 'days', 'shifts'] as string[]).includes(section) ? (
              <SetupEditor section={section as Section} setup={setup} onChange={update} />
            ) : section === 'lessons' ? (
              <LessonsEditor setup={setup} onChange={update} />
            ) : section === 'import' ? (
              <ImportPage setup={setup} onChange={update} />
            ) : section === 'generate' ? (
              <GeneratePage setup={setup} onChange={update} history={history} />
            ) : section === 'print' ? (
              <PrintPage setup={setup} onNeedTimetable={() => setSection('generate')} />
            ) : section === 'timetable' ? (
              <TimetablePage setup={setup} onTimetable={(t, label) => update({ ...setup, timetable: t }, label)} history={history} />
            ) : section === 'check' ? (
              <CheckPage setup={setup} />
            ) : section === 'workload' ? (
              <WorkloadView setup={setup} />
            ) : (
              <MasterDataEditor section={section as MasterSection} setup={setup} onChange={update} />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
