import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
import type { GenProgress, ImproveReport, CopyPlan, SwapInfo, SlotInfo, Timetable, SolveReport, CheckReport, ImportReport, Issue, LoadSummary, Opened, SchoolSetup } from './types'

const filters = [{ name: 'Timewizer school', extensions: ['twz'] }]

export const api = {
  async pickNewPath(defaultName: string): Promise<string | null> {
    return save({ title: 'Where should the school file be saved?', defaultPath: `${defaultName}.twz`, filters })
  },
  async pickOpenPath(): Promise<string | null> {
    const r = await open({ title: 'Open a school', multiple: false, filters })
    return typeof r === 'string' ? r : null
  },
  create: (path: string, name: string) => invoke<Opened>('create_school', { path, name }),
  startupFile: () => invoke<string | null>('startup_file'),
  open: (path: string) => invoke<Opened>('open_school', { path }),
  save: (setup: SchoolSetup) => invoke<void>('save_school', { setup }),
  saveAs: (path: string, setup: SchoolSetup) => invoke<string>('save_school_as', { path, setup }),
  close: () => invoke<void>('close_school'),
  lessonLoads: (setup: SchoolSetup) => invoke<LoadSummary>('lesson_loads', { setup }),
  async pickImportFiles(): Promise<string[]> {
    const r = await open({ title: 'Choose files to import', multiple: true,
      filters: [{ name: 'Excel or CSV', extensions: ['xlsx', 'xlsm', 'xls', 'csv'] }] })
    return Array.isArray(r) ? r : typeof r === 'string' ? [r] : []
  },
  async pickTemplatePath(name: string, ext: string): Promise<string | null> {
    return save({ title: 'Save the template', defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
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
    return save({ title: 'Save as', defaultPath: defaultName, filters: [{ name: label, extensions: [ext] }] })
  },
  async pickFolder(): Promise<string | null> {
    const r = await open({ title: 'Choose a folder for the pictures', directory: true, multiple: false })
    return typeof r === 'string' ? r : null
  },
  async pickPicture(): Promise<string | null> {
    const r = await open({ title: 'Choose your school logo', multiple: false,
      filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }] })
    return typeof r === 'string' ? r : null
  },
  exportCsv: (setup: SchoolSetup, path: string) => invoke<void>('export_csv', { setup, path }),
  exportExcel: (setup: SchoolSetup, path: string) => invoke<void>('export_excel', { setup, path }),
  writeFile: (path: string, dataBase64: string) => invoke<void>('write_file', { path, dataBase64 }),
  readFileBase64: (path: string) => invoke<string>('read_file_base64', { path }),
  validate: (setup: SchoolSetup) => invoke<Issue[]>('validate_setup', { setup }),
}

export function errText(e: unknown): string {
  return typeof e === 'string' ? e : e instanceof Error ? e.message : 'Something went wrong.'
}
