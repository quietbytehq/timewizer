import type { Timetable } from './types'

/** How many timetable edits can be undone. */
export const MAX_HISTORY = 100

/** One undoable timetable edit: what it did in plain words, when, and the timetable before and after. */
export interface HistoryStep { label: string; at: number; before: Timetable | null; after: Timetable | null }

export interface History {
  undo: () => void
  redo: () => void
  /** Edits that can be undone, oldest first. */
  done: HistoryStep[]
  /** Edits that were undone and can be redone, the next one to redo last. */
  undone: HistoryStep[]
}

export const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
