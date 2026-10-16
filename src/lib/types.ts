export interface Day { name: string; working: boolean }
export interface PeriodTime { start: string; end: string }
export interface Break { afterPeriod: number; name: string; cannotCross: boolean }
export interface Shift {
  id: string
  name: string
  enabled: boolean
  days: PeriodTime[][]
  breaks: Break[]
}
export interface TimeOffCell { shift: string; day: number; period: number; state: 1 | 2 }
export interface Subject { id: string; name: string; shortName: string; color: string }
export interface Teacher {
  id: string; name: string; shortName: string; email: string; shifts: string[]
  maxLessonsPerDay: number | null; maxPeriodsPerWeek: number | null; maxConsecutive: number | null; maxDaysPerWeek: number | null
  timeOff: TimeOffCell[]
}
export interface Group { id: string; name: string }
export interface Division { id: string; name: string; groups: Group[] }
export interface SchoolClass {
  id: string; name: string; shortName: string; shift: string
  classTeacher: string | null; homeRoom: string | null
  divisions: Division[]; timeOff: TimeOffCell[]
}
export interface Building { id: string; name: string }
export interface Room {
  id: string; name: string; shortName: string; building: string | null
  capacity: number | null; timeOff: TimeOffCell[]
}
export interface MasterData {
  subjects: Subject[]; teachers: Teacher[]; classes: SchoolClass[]; buildings: Building[]; rooms: Room[]
}
export interface SchoolSetup {
  name: string
  schoolType: string
  academicYear: string
  days: Day[]
  shifts: Shift[]
  master: MasterData
  lessons: Lesson[]
  logo?: string | null
  links: Link[]
  settings: Settings
  timetable?: Timetable | null
}
export interface Issue { level: 'error' | 'warning'; message: string }
export interface Opened { path: string; setup: SchoolSetup }

export const SCHOOL_TYPES: { id: string; label: string }[] = [
  { id: 'primary', label: 'Primary' },
  { id: 'middle', label: 'Middle' },
  { id: 'high', label: 'High (K-12)' },
  { id: 'higher_secondary', label: 'Higher secondary' },
]

export interface LessonPart { classId: string; groupId: string | null }
export interface Lesson {
  id: string; subject: string; teachers: string[]; parts: LessonPart[]
  periodsPerCard: number; cardsPerWeek: number; rooms: string[]
}
export interface Load { id: string; name: string; used: number; available: number }
export interface LoadSummary { cards: number; classes: Load[]; teachers: Load[] }

export interface Problem { sheet: string; row: number; message: string }
export interface Counts { subjects: number; teachers: number; classes: number; rooms: number; lessons: number }
export interface ImportReport { setup: SchoolSetup; added: Counts; skipped: number; problems: Problem[] }
export const KINDS = ['subjects', 'teachers', 'rooms', 'classes', 'lessons'] as const
export type Kind = (typeof KINDS)[number]

export interface Finding { level: 'error' | 'warning'; kind: string; title: string; message: string; fix: string }
export interface CheckReport { errors: number; warnings: number; cards: number; periods: number; findings: Finding[] }

export interface PlacedCard {
  lessonId: string; number: number; shift: string; day: number; period: number
  length: number; room: string | null; locked: boolean
}
export interface Timetable { cards: PlacedCard[] }
export interface UnplacedCard { lessonId: string; number: number; title: string; message: string; fix: string }
export interface QualityItem { key: string; label: string; value: number; weight: number }
export interface Quality { items: QualityItem[]; penalty: number }
export interface Relaxation { kind: string; message: string }
export interface SolveReport {
  total: number; placed: number; unplaced: UnplacedCard[]; timetable: Timetable
  seconds: number; cancelled: boolean; timedOut: boolean
  qualityBefore: Quality; qualityAfter: Quality; relaxed: Relaxation[]
}
export interface ImproveReport { timetable: Timetable; qualityBefore: Quality; qualityAfter: Quality; seconds: number }
export interface GenProgress { phase: 'placing' | 'improving'; placed: number; total: number; fraction: number }

export interface RoomOption { id: string; name: string; free: boolean }
export interface SlotInfo {
  shift: string; day: number; period: number
  status: 'ok' | 'soft' | 'blocked'; reasons: string[]; rooms: RoomOption[]
}
export interface SwapInfo { lessonId: string; number: number; ok: boolean; reasons: string[] }

export interface CopyLine { subject: string; teachers: string[]; cardsPerWeek: number; periodsPerCard: number; group: string | null }
export interface TargetPlan { classId: string; className: string; create: CopyLine[]; skipped: { subject: string; reason: string }[]; warnings: string[] }
export interface CopyPlan { targets: TargetPlan[]; newLessons: Lesson[] }

export interface Link { id: string; lessons: string[] }
export interface Weights { teacherGaps: number; classGaps: number; spread: number; avoid: number; balance: number; roomConsistency: number }
export interface Settings {
  defaultMaxPerDay: number | null; defaultMaxPerWeek: number | null
  maxSameSubjectPerDay: number; weights: Weights; allowRelaxation: boolean; improveSeconds: number
}
