import { useState } from 'react'
import { ChevronDown, ChevronRight, History as HistoryIcon, Redo2, Undo2 } from 'lucide-react'
import { timeOf, type History } from '@/lib/history'
import { Button, Card } from './ui'

/** Undo and Redo buttons; the tooltip says what would be undone or redone. */
export function UndoRedo({ history }: { history: History }) {
  const next = history.done[history.done.length - 1]
  const back = history.undone[history.undone.length - 1]
  return (
    <>
      <Button kind="ghost" onClick={history.undo} disabled={!next} title={next ? `Undo: ${next.label} (Ctrl+Z)` : 'Nothing to undo'}><Undo2 size={16} /> Undo</Button>
      <Button kind="ghost" onClick={history.redo} disabled={!back} title={back ? `Redo: ${back.label} (Ctrl+Y)` : 'Nothing to redo'}><Redo2 size={16} /> Redo</Button>
    </>
  )
}

/** The list of timetable edits made since the school was opened, newest first. */
export function HistoryPanel({ history }: { history: History }) {
  const [open, setOpen] = useState(true)
  const done = [...history.done].reverse()
  const undone = history.undone // the next to redo is last, so it sits just above the newest done edit
  const count = done.length + undone.length
  return (
    <Card>
      <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="flex items-center gap-2 text-lg font-semibold"><HistoryIcon size={18} /> Change history</span>
        <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          {count === 0 ? 'No changes yet' : `${count} ${count === 1 ? 'change' : 'changes'}`}
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </button>
      {open && (count === 0
        ? <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>Changes you make to the timetable (moving, swapping, locking, building) are listed here, newest first, so you can undo them.</p>
        : (
          <ol className="mt-3 max-h-72 space-y-1 overflow-y-auto text-sm" aria-label="Change history">
            {undone.map((s, i) => (
              <li key={`u${i}`} className="flex items-baseline gap-3 rounded-lg px-2 py-1" style={{ color: 'var(--muted)' }}>
                <time className="w-20 shrink-0 tabular-nums text-xs">{timeOf(s.at)}</time>
                <span className="line-through">{s.label}</span>
                <span className="ml-auto shrink-0 text-xs font-semibold">undone</span>
              </li>
            ))}
            {done.map((s, i) => (
              <li key={`d${i}`} className="flex items-baseline gap-3 rounded-lg px-2 py-1"
                style={i === 0 ? { background: 'color-mix(in srgb, var(--highlight) 16%, transparent)' } : undefined}>
                <time className="w-20 shrink-0 tabular-nums text-xs" style={{ color: 'var(--muted)' }}>{timeOf(s.at)}</time>
                <span>{s.label}</span>
                {i === 0 && <span className="ml-auto shrink-0 text-xs font-semibold" style={{ color: 'var(--muted)' }}>latest</span>}
              </li>
            ))}
          </ol>
        ))}
    </Card>
  )
}
