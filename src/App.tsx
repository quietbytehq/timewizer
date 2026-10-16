import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, BarChart3, FileUp, BookOpen, ClipboardList, ClipboardCheck, LayoutGrid, Printer, SlidersHorizontal, Sparkles, CalendarDays, Check, Clock, DoorOpen, GraduationCap, Monitor, Moon, School, Sun, Users, XCircle } from 'lucide-react'
import { applyTheme, getStoredTheme, type ThemeChoice } from '@/lib/theme'
import { api, errText } from '@/lib/api'
import type { Issue, SchoolSetup, Timetable } from '@/lib/types'
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
type Page = Section | MasterSection | 'lessons' | 'workload' | 'import' | 'check' | 'generate' | 'timetable' | 'print'

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
  const seq = useRef(0)
  const hist = useRef<{ past: (Timetable | null)[]; future: (Timetable | null)[] }>({ past: [], future: [] })
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

  // Every change goes through here so that timetable edits can be undone.
  const update = (s: SchoolSetup) => {
    if (setup && s.timetable !== setup.timetable) {
      hist.current.past = [...hist.current.past.slice(-99), setup.timetable ?? null]
      hist.current.future = []
    }
    setSetup(s); setDirty(true)
  }
  const undo = () => {
    const h = hist.current
    if (!setup || h.past.length === 0) return
    h.future.push(setup.timetable ?? null)
    setSetup({ ...setup, timetable: h.past.pop() ?? null }); setDirty(true); bump(n => n + 1)
  }
  const redo = () => {
    const h = hist.current
    if (!setup || h.future.length === 0) return
    h.past.push(setup.timetable ?? null)
    setSetup({ ...setup, timetable: h.future.pop() ?? null }); setDirty(true); bump(n => n + 1)
  }

  const opened = (p: string, s: SchoolSetup) => { hist.current = { past: [], future: [] }; setPath(p); setSetup(s); setDirty(false); setSection('school') }

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
  useEffect(() => {
    api.startupFile().then(p => { if (p) return run(async () => { const r = await api.open(p); opened(r.path, r.setup) }) }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const save = useCallback(() => run(async () => {
    if (!setup) return
    await api.save(setup)
    setDirty(false); setSavedAt(true)
    setTimeout(() => setSavedAt(false), 2000)
  }), [setup])
  const saveAs = () => run(async () => {
    if (!setup) return
    const p = await api.pickNewPath(setup.name)
    if (!p) return
    setPath(await api.saveAs(p, setup)); setDirty(false)
  })
  const close = () => run(async () => {
    if (dirty && !window.confirm('You have unsaved changes. Close without saving?')) return
    await api.close(); setSetup(null); setPath(null); setIssues([])
  })

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && setup) { e.preventDefault(); save() }
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement | null)?.tagName ?? '')
      if ((e.ctrlKey || e.metaKey) && !typing && section === 'timetable') {
        const k = e.key.toLowerCase()
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [save, setup, section])

  const errors = issues.filter(i => i.level === 'error')
  const warnings = issues.filter(i => i.level === 'warning')

  return (
    <div className="min-h-screen">
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
        <Welcome busy={busy} error={error} onNew={newSchool} onOpen={openSchool} />
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
          </nav>
          <div className="min-w-0 space-y-6">
            {error && (
              <div role="alert" className="rounded-xl border px-4 py-3 text-sm font-medium"
                style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>
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
            {section === 'rules' ? (
              <RulesPage setup={setup} onChange={update} />
            ) : (['school', 'days', 'shifts'] as string[]).includes(section) ? (
              <SetupEditor section={section as Section} setup={setup} onChange={update} />
            ) : section === 'lessons' ? (
              <LessonsEditor setup={setup} onChange={update} />
            ) : section === 'import' ? (
              <ImportPage setup={setup} onChange={update} />
            ) : section === 'generate' ? (
              <GeneratePage setup={setup} onChange={update} />
            ) : section === 'print' ? (
              <PrintPage setup={setup} onNeedTimetable={() => setSection('generate')} />
            ) : section === 'timetable' ? (
              <TimetablePage setup={setup} onTimetable={t => update({ ...setup, timetable: t })}
                history={{ undo, redo, canUndo: hist.current.past.length > 0, canRedo: hist.current.future.length > 0 }} />
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
