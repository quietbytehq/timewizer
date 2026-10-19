# Large-school stress test

A made-up but realistic **double-shift school**: 120 classes (60 morning, 60 afternoon), 220 teachers,
60 rooms, 1,842 lessons = **4,506 lesson sessions** (5,076 periods a week), 438 "same time" links,
966 lessons for only one group of a class, combined lessons, double periods in labs and other room
pools, part-time teachers, free days, "avoid" cells, an assembly period, Friday shorter, afternoon
starting later on Friday. Same seed, same school (`src-tauri/src/stress.rs`).

## Run it

| What | Command |
| --- | --- |
| Build / improve / file size / edit commands (Rust) | `npm run stress -- --improve 5,20,60` (add `--tight` for a very full school, `--survey 10` for ten schools) |
| Browser: every page, Master view, drag-and-drop | `npm run build && npm run test:stress` |
| The same, inside WebKitGTK (the engine of the Ubuntu app) | `npm run build && npm run bench:webkit` (`-- --chromium` for Chromium) |
| Slow guards in the Rust tests | `cd src-tauri && cargo test --release --features uitest -- --ignored` |

## Results (release build, 4 vCPU, WebKitGTK with software rendering)

**Rust**

| | Before | Now |
| --- | --- | --- |
| Pre-generation check / compile the school | 37 ms / 21 ms | same |
| Build (place sessions) | 6–17 s, 99.4–100 % placed | 9–18 s, 99.7–100 % placed (+ repair, below) |
| "Improve quality" for 5 s | **27 s** (22 s of set-up) | **5.0 s** |
| Pick up a lesson (slot + swap options) | **24 s + 39 s** | **17 ms + 20 ms** |
| Move / swap a lesson | **24 s** | **18 ms** |
| Is the timetable still valid | 45 ms | 44 ms |
| School file | 1.1 MB (0.62 MB without the timetable) | same |
| Open / save the file | 6 ms / 24 ms | same |

Improving (typical school, quality penalty, lower is better): 19,741 -> 13,245 after 5 s, 12,048 after
20 s, 11,216 after 60 s (-43 %). The default Build button (place, then improve for 20 s) took 44 s.

**Screen** (WebKitGTK 2.52, same fast Rust in both columns, so only the page differs)

| | Old page | Now |
| --- | --- | --- |
| Open the Master view | 3,089 ms | 268 ms |
| Zoom the Master view | 2,816 ms | 236 ms |
| Switch shift in the Master view | 1,380 ms | 178 ms |
| Pick up a lesson (slots turn green/yellow/red) | 2,210 ms | 184 ms |
| Drop it (moved and redrawn) | 2,217 ms | 128 ms |
| Undo | 1,278 ms | 64 ms |
| Open any other page (worst: Print & export) | - | under 0.5 s |

## What was slow, and the fixes

1. **Every edit rescanned the whole timetable per session** (`state_from`, `swap_options`, locking):
   quadratic work with a linear lookup by lesson id. Now a hash lookup and one grouping pass.
   Drag, move, swap and Improve went from 22-40 s to about 20 ms.
2. **Heavy commands ran on the thread that draws the window** (Tauri runs plain commands there), so
   they froze the screen and a drag in progress. They are now `async` (worker thread).
3. **Master view drew ~31,000 page elements** and rescanned every lesson for every cell. Now lookups by
   id, a per-slot index, lesson chips draw their lock/room buttons only under the pointer, and only the
   visible rows are drawn (the row being dragged stays drawn so the drag can finish).
4. **Left-over sessions.** A very full school can finish with a few sessions unplaced (typically 2-8
   of 4,506, always listed with the reason). A new *repair* step (force one in, lift out what it
   displaces plus related sessions, place again) cut the left-over total over ten schools from about 50
   to 20, at a cost of 10-30 s, and only when something is left. It can be cancelled.
5. **A real bug the stress test found:** the solver applied one "same subject on one day" limit to a
   whole class, but the limit belongs to each group of students (the checker already did so). A
   whole-class lesson could get a second session on a day. Fixed, with a regression test.

## Not solved / worth knowing

- The hardest part for the solver is **same-time links of three or more busy teachers** (option blocks
  for grades 11-12). Without those links all 4,506 sessions place in 0.1 s. A school this full will
  often need the last few sessions placed by hand, which is now quick.
- With 7/5 periods a day (classes 94-97 % full, `--tight`) a build takes 55 s and leaves about 40 sessions.
- Each command still sends the whole school (0.9 MB) across the window boundary; about 30 ms, fine today.
