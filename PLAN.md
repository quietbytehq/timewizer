# Timewizer — Build Plan

Each milestone ends with something the owner can **run and test**. Do not start the next milestone until the current one works.

## Milestone 0 — Project setup
- [x] Install toolchain on Ubuntu (Rust, Node LTS, Tauri system libraries)
- [x] Create Tauri 2 + React + TypeScript + Tailwind + shadcn/ui project
- [x] App window opens with Timewizer logo, cream/teal/amber theme (see CLAUDE.md), light/dark toggle
- [x] Apache-2.0 LICENSE file
- [x] Git repo with first commit
**Test:** the app opens and looks good in light and dark mode.

## Milestone 1 — School setup (Stage 1)
- [x] New school / open / save (SQLite file)
- [x] School type, academic year, working days (Saturday optional)
- [x] Shifts: morning and/or afternoon, each with its own periods
- [x] Bell times per day (Friday early-off for morning, late-start for afternoon)
- [x] Breaks, with a "cannot be crossed" option
**Test:** sets up a double-shift school with a Friday schedule.

## Milestone 2 — Master data (Stage 2)
- [x] Subjects (name, short name, colour)
- [x] Teachers (shift(s), limits, time-off grid)
- [x] Classes (shift, homeroom, class teacher, time-off grid)
- [x] Divisions and groups (e.g. Boys/Girls, Group 1/2)
- [x] Buildings and classrooms (capacity, time-off grid)
- [x] Time-off grid editor: click cells to cycle Available / Avoid / Forbidden
**Test:** enters a small real school by hand.

## Milestone 3 — Lessons (Stage 3)
- [x] Lesson editor: teachers + subject + classes/groups + periods per week + single/double/triple + room pool
- [x] Cards are generated automatically
- [x] Per-class and per-teacher load summary (periods used vs available)
**Test:** enters all lessons for the sample school.

## Milestone 4 — Import / export of data
- [x] Excel/CSV templates (downloadable) for subjects, teachers, classes, rooms, lessons
- [x] Import with clear error report (row and problem)
- [x] Sample school dataset in `samples/`
**Test:** fills a template from real (anonymised) data and imports it.

## Milestone 5 — Pre-generation check (blueprint section 6)
- [x] Class, teacher, and room volume checks
- [x] Time-off bottleneck check per lesson
- [x] Plain-English report: what is wrong and how to fix it
**Test:** deliberately overloads a teacher and checks the warning.

## Milestone 6 — Solver (blueprint sections 4 and 7)
- [x] Bitmask data structures and collision checks (with tests)
- [x] Difficulty ordering + placement + ejection-chain swaps
- [x] Hard constraints (section 5.1)
- [x] Progress bar, cancel button, runs in background
- [x] Report of any unplaced cards and why
**Test:** generates a timetable for the sample school.

## Milestone 7 — Timetable views and manual editing (blueprint section 8)
- [x] Views by class, teacher, room, plus master view
- [x] Drag-and-drop with green / yellow / red slot highlighting
- [x] Room picker on drop
- [x] Lock / unlock cards; regenerate keeps locked cards
- [x] Undo / redo
- [x] Swap two lessons by dropping one on the other; Master view zoom
**Test:** moves lessons by hand, locks some, regenerates.

## Before Milestone 8 — Copy lessons to other classes (small item)
- [x] "Copy lessons to other classes": copy all lessons of one class to selected classes
- [x] Preview of what will be created, shown before anything is applied
**Test:** copies Grade 6 A's lessons to 6 B and checks the preview first.

## Milestone 8 — Quality optimisation
- [x] "Must happen at the same time" links between lessons (e.g. ICT/library 50/50 swap within a class, electives across sections, combined PE)
  - The solver must respect links as a hard rule
  - Create / remove links in the lesson editor
- [x] School-wide default teacher limits: max periods per day and per week
  - Individual teachers can override the defaults
  - The pre-generation check and the solver must both respect the weekly maximum
- [x] Setting: max periods of the same subject per class per day (default 1)
- [x] Soft constraints (section 5.2) with adjustable weights
- [x] Optimisation pass (fewer teacher gaps, better spread across the week)
- [x] Constraint relaxation mode with a report
**Test:** compares timetables before and after optimisation.

## Milestone 9 — Printing and export
- [x] School logo upload (School page), shown on printouts and exports
- [x] PDF: per class, per teacher, per room, master; with the school's own logo and name
- [x] Excel and CSV export
- [x] Print settings (paper size, colour / black-and-white)
- [x] Export each timetable (class, teacher, room) as an image (PNG) as well as PDF
**Test:** prints timetables and shares with a school.

## Milestone 10 — Linux release
- [x] App icon from the Timewizer logo
- [x] Build .deb and AppImage
- [x] Short user guide (PDF): docs/Timewizer-User-Guide.pdf (`npm run guide`)
- [x] One-command release build (`npm run release:linux`) and a GitHub workflow that builds the installers
**Test:** installs on a clean Ubuntu machine.

## Later (Phase 2)
- [x] Windows installer (NSIS .exe + .msi, built by GitHub Actions; not yet tested on a real Windows PC)
- [ ] aSc Timetables XML import / export
- [ ] Substitutions module (blueprint section 9)
- [ ] Make the GitHub repo public (when the project owner agrees)
- [ ] Placement preferences (e.g. heavy subjects early in the day), waiting for input from a larger school
- [ ] Bilingual (English / Urdu) user guide

## Out of scope
These will not be built:
- Mobile app
- Cloud sync, or any online service (Timewizer stays fully offline)
