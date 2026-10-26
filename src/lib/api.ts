import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { Absence, CoverCounts, CoverDay, SheetDay, Substitutions, BackupEntry, BackupPrefs, Preferences, SaveOutcome, GenProgress, ImproveReport, CopyPlan, SwapInfo, SlotInfo, Timetable, SolveReport, CheckReport, ImportReport, Issue, LoadSummary, Opened, SchoolSetup } from './types'

/** What to export (ids), as chosen on the Print & export page. */
export interface ExportSelection { classes: string[]; teachers: string[]; rooms: string[]; master: boolean }

// The file dialogs are opened by the program itself, which remembers what was chosen: the
// other commands only accept files that were picked here (see src-tauri/src/access.rs).
const pickOpen = (what: 'school' | 'import' | 'picture' | 'folder') => invoke<string[] | string | null>('pick_open', { what })
const toList = (r: string[] | string | null): string[] => (Array.isArray(r) ? r : typeof r === 'string' ? [r] : [])
const pickSave = (title: string, defaultName: string, label: string, ext: string) =>
  invoke<string | null>('pick_save', { title, defaultName, label, ext })

export const api = {
  async pickNewPath(defaultName: string): Promise<string | null> {
    return pickSave('Where should the school file be saved?', `${defaultName}.twz`, 'Timewizer school', 'twz')
  },
  async pickOpenPath(): Promise<string | null> {
    return toList(await pickOpen('school'))[0] ?? null
  },
  create: (path: string, name: string) => invoke<Opened>('create_school', { path, name }),
  startupFile: () => invoke<string | null>('startup_file'),
  open: (path: string) => invoke<Opened>('open_school', { path }),
  save: (setup: SchoolSetup) => invoke<SaveOutcome>('save_school', { setup, stamp: localStamp() }),
  saveAs: (path: string, setup: SchoolSetup) => invoke<SaveOutcome>('save_school_as', { path, setup, stamp: localStamp() }),
  preferences: () => invoke<Preferences>('get_preferences'),
  setBackupPrefs: (backup: BackupPrefs) => invoke<Preferences>('set_backup_prefs', { backup }),
  setSplash: (on: boolean) => invoke<Preferences>('set_splash', { on }),
  backUpNow: (setup: SchoolSetup) => invoke<string>('back_up_now', { setup, stamp: localStamp() }),
  listBackups: () => invoke<BackupEntry[]>('list_backups'),
  restoreBackup: (backup: string, path: string) => invoke<Opened>('restore_backup', { backup, path }),
  close: () => invoke<void>('close_school'),
  lessonLoads: (setup: SchoolSetup) => invoke<LoadSummary>('lesson_loads', { setup }),
  async pickImportFiles(): Promise<string[]> {
    return toList(await pickOpen('import'))
  },
  async pickTemplatePath(name: string, ext: string): Promise<string | null> {
    return pickSave('Save the template', name, ext.toUpperCase(), ext)
  },
  importFile: (path: string, kind: string | null, setup: SchoolSetup) =>
    invoke<ImportReport>('import_file', { path, kind, setup }),
  writeTemplate: (path: string, kind: string | null) => invoke<void>('write_template', { path, kind }),
  checkSetup: (setup: SchoolSetup) => invoke<CheckReport>('check_setup', { setup }),
  startGenerate: (setup: SchoolSetup) => invoke<void>('start_generate', { setup }),
  cancelGenerate: () => invoke<void>('cancel_generate'),
  onProgress: (fn: (p: GenProgress) => void): Promise<UnlistenFn> =>
    listen<GenProgress>('generate-progress', e => fn(e.payload)),
  startImprove: (setup: SchoolSetup) => invoke<void>('start_improve', { setup }),
  onImproveProgress: (fn: (f: number) => void): Promise<UnlistenFn> => listen<number>('improve-progress', e => fn(e.payload)),
  onImproveDone: (fn: (r: ImproveReport) => void): Promise<UnlistenFn> => listen<ImproveReport>('improve-done', e => fn(e.payload)),
  onDone: (fn: (r: SolveReport) => void): Promise<UnlistenFn> => listen<SolveReport>('generate-done', e => fn(e.payload)),
  slotOptions: (setup: SchoolSetup, lessonId: string, number: number) =>
    invoke<SlotInfo[]>('slot_options', { setup, lessonId, number }),
  moveCard: (setup: SchoolSetup, lessonId: string, number: number, day: number, period: number, room: string | null) =>
    invoke<Timetable>('move_card', { setup, lessonId, number, day, period, room }),
  swapOptions: (setup: SchoolSetup, lessonId: string, number: number) =>
    invoke<SwapInfo[]>('swap_options', { setup, lessonId, number }),
  swapCards: (setup: SchoolSetup, lessonId: string, number: number, withLesson: string, withNumber: number) =>
    invoke<Timetable>('swap_cards', { setup, lessonId, number, withLesson, withNumber }),
  planCopyLessons: (setup: SchoolSetup, source: string, targets: string[], copyTeachers: boolean) =>
    invoke<CopyPlan>('plan_copy_lessons', { setup, source, targets, copyTeachers }),
  timetableConsistent: (setup: SchoolSetup) => invoke<boolean>('timetable_consistent', { setup }),
  async pickSaveFile(defaultName: string, ext: string, label: string): Promise<string | null> {
    return pickSave('Save as', defaultName, label, ext)
  },
  async pickFolder(): Promise<string | null> {
    return toList(await pickOpen('folder'))[0] ?? null
  },
  async pickPicture(): Promise<string | null> {
    return toList(await pickOpen('picture'))[0] ?? null
  },
  exportCsv: (setup: SchoolSetup, path: string) => invoke<void>('export_csv', { setup, path }),
  /** `selection`: what is ticked on the Print & export page. */
  exportExcel: (setup: SchoolSetup, path: string, selection?: ExportSelection) => invoke<void>('export_excel', { setup, path, selection: selection ?? null }),
  exportTimetablesCsv: (setup: SchoolSetup, path: string, selection: ExportSelection) => invoke<void>('export_timetables_csv', { setup, path, selection }),
  writeFile: (path: string, dataBase64: string) => invoke<void>('write_file', { path, dataBase64 }),
  readFileBase64: (path: string) => invoke<string>('read_file_base64', { path }),
  validate: (setup: SchoolSetup) => invoke<Issue[]>('validate_setup', { setup }),
  coverDay: (setup: SchoolSetup, date: string) => invoke<CoverDay>('cover_day', { setup, date }),
  coverCounts: (setup: SchoolSetup) => invoke<CoverCounts>('cover_counts', { setup }),
  checkAbsence: (setup: SchoolSetup, absence: Absence) => invoke<void>('check_absence', { setup, absence }),
  resetCoverCounts: (setup: SchoolSetup, today: string) => invoke<Substitutions>('reset_cover_counts', { setup, today }),
  coverSheet: (setup: SchoolSetup, from: string, to: string) => invoke<SheetDay[]>('cover_sheet', { setup, from, to }),
  exportCoverCsv: (setup: SchoolSetup, from: string, to: string, path: string) => invoke<void>('export_cover_csv', { setup, from, to, path }),
}

/** The local date and time for a backup's name: "2026-10-23 14-05-09" (no colons, for Windows). */
export function localStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

export function errText(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : 'Something went wrong.'
}
