import type { SchoolSetup } from '../types'

export type PageKind = 'class' | 'teacher' | 'room' | 'master'

/** What is on one printed page. A teacher in two shifts gets a page for each shift. */
export interface PageSpec {
  kind: PageKind
  /** class / teacher / room id (not used by the master page) */
  id?: string
  title: string
  subtitle: string
  shiftId: string
  /** Master page: the classes shown on this page */
  classIds?: string[]
  /** a name that is safe to use for a file */
  fileName: string
}

export interface Selection { classes: string[]; teachers: string[]; rooms: string[]; master: boolean }

/** One lesson session with names filled in. */
export interface Item {
  lessonId: string
  subject: string
  subjectShort: string
  color: string
  teachers: string[]
  teacherShorts: string[]
  teacherIds: string[]
  classes: string[]
  classShorts: string[]
  classIds: string[]
  roomId: string | null
  room: string | null
  roomShort: string | null
  shiftId: string
  day: number
  /** 1-based */
  period: number
  length: number
}

export function items(setup: SchoolSetup): Item[] {
  const m = setup.master
  const out: Item[] = []
  for (const c of setup.timetable?.cards ?? []) {
    const l = setup.lessons.find(x => x.id === c.lessonId)
    if (!l) continue
    const sub = m.subjects.find(s => s.id === l.subject)
    const ts = l.teachers.map(id => m.teachers.find(t => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t)
    const parts = l.parts.map(p => {
      const cl = m.classes.find(k => k.id === p.classId)
      const g = cl?.divisions.flatMap(d => d.groups).find(k => k.id === p.groupId)
      return cl ? { id: cl.id, name: g ? `${cl.name.trim()} ${g.name.trim()}` : cl.name.trim(), short: g ? `${cl.shortName.trim()} ${g.name.trim()}` : cl.shortName.trim() } : null
    }).filter((x): x is NonNullable<typeof x> => !!x)
    const room = m.rooms.find(r => r.id === c.room)
    out.push({
      lessonId: l.id, subject: sub?.name.trim() ?? '', subjectShort: sub?.shortName.trim() || sub?.name.trim() || '', color: sub?.color ?? '#DCD0BC',
      teachers: ts.map(t => t.name.trim()), teacherShorts: ts.map(t => t.shortName.trim() || t.name.trim()), teacherIds: ts.map(t => t.id),
      classes: parts.map(p => p.name), classShorts: parts.map(p => p.short), classIds: parts.map(p => p.id),
      roomId: room?.id ?? null, room: room?.name.trim() ?? null, roomShort: room?.shortName.trim() || room?.name.trim() || null,
      shiftId: c.shift, day: c.day, period: c.period, length: c.length,
    })
  }
  return out
}

export const safeName = (s: string) => s.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'timetable'

/** Most rows a master page holds, so that every row stays readable. */
export const MASTER_ROWS = 12

export function everything(setup: SchoolSetup): Selection {
  const used = items(setup)
  return {
    classes: setup.master.classes.filter(c => used.some(i => i.classIds.includes(c.id))).map(c => c.id),
    teachers: setup.master.teachers.filter(t => used.some(i => i.teacherIds.includes(t.id))).map(t => t.id),
    rooms: setup.master.rooms.filter(r => used.some(i => i.roomId === r.id)).map(r => r.id),
    master: true,
  }
}

export function pagesFor(setup: SchoolSetup, sel: Selection): PageSpec[] {
  const m = setup.master
  const used = items(setup)
  const enabled = setup.shifts.filter(s => s.enabled)
  const school = setup.academicYear.trim()
  const sub = (shift: string, extra = '') => [extra, `${shift} shift`, school].filter(Boolean).join(' · ')
  const pages: PageSpec[] = []
  const multiShift = enabled.length > 1
  for (const c of m.classes.filter(x => sel.classes.includes(x.id))) {
    const sh = setup.shifts.find(s => s.id === c.shift)
    if (!sh) continue
    pages.push({ kind: 'class', id: c.id, title: c.name.trim(), subtitle: sub(sh.name, 'Class timetable'), shiftId: sh.id, fileName: `Class-${safeName(c.name)}` })
  }
  for (const t of m.teachers.filter(x => sel.teachers.includes(x.id))) {
    for (const sh of enabled.filter(s => t.shifts.includes(s.id) && used.some(i => i.shiftId === s.id && i.teacherIds.includes(t.id)))) {
      pages.push({ kind: 'teacher', id: t.id, title: t.name.trim(), subtitle: sub(sh.name, 'Teacher timetable'), shiftId: sh.id, fileName: `Teacher-${safeName(t.name)}${multiShift ? `-${safeName(sh.name)}` : ''}` })
    }
  }
  for (const r of m.rooms.filter(x => sel.rooms.includes(x.id))) {
    for (const sh of enabled.filter(s => used.some(i => i.shiftId === s.id && i.roomId === r.id))) {
      pages.push({ kind: 'room', id: r.id, title: r.name.trim(), subtitle: sub(sh.name, 'Room timetable'), shiftId: sh.id, fileName: `Room-${safeName(r.name)}${multiShift ? `-${safeName(sh.name)}` : ''}` })
    }
  }
  if (sel.master) {
    for (const sh of enabled) {
      const cs = m.classes.filter(c => c.shift === sh.id)
      for (let i = 0; i < Math.max(1, Math.ceil(cs.length / MASTER_ROWS)); i++) {
        const chunk = cs.slice(i * MASTER_ROWS, (i + 1) * MASTER_ROWS)
        const n = Math.ceil(cs.length / MASTER_ROWS)
        pages.push({
          kind: 'master', title: 'Master timetable', subtitle: sub(sh.name, n > 1 ? `Classes ${chunk[0]?.shortName}–${chunk[chunk.length - 1]?.shortName}` : 'All classes'),
          shiftId: sh.id, classIds: chunk.map(c => c.id), fileName: `Master-${safeName(sh.name)}${n > 1 ? `-${i + 1}` : ''}`,
        })
      }
    }
  }
  return pages
}
