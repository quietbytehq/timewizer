# UI tests

Playwright drives the real React front end in Chromium. The Tauri desktop shell is replaced by
`tauri-shim.js`, which sends every command to a small local server (`src-tauri/src/bridge.rs`,
built with `--features uitest`). That server runs the **real Rust code** (import, check, solver,
editing), so a test that builds a timetable runs the real solver. File dialogs are answered by the
tests (`setDialog`).

```
npm run test:ui          # build the front end, then run everything
npm run test:ui:only     # run without rebuilding the front end
UPDATE_SHOTS=1 npx playwright test screenshots   # refresh docs/screenshots (light and dark)
```

Needs Chromium (`/opt/pw-browsers/chromium`, or set `CHROMIUM_PATH`) and the usual Rust/Tauri
build libraries, because the bridge links the app's Rust code.

| File | Covers |
| --- | --- |
| `import-check-build.spec.ts` | import (and importing twice), the check page, building, saving, stopping |
| `timetable.spec.ts` | class/teacher/room/master views, drag and drop, red slots, swap, lock, undo/redo, room picker, improve |
| `copy-and-links.spec.ts` | copy lessons to other classes, same-time links |
| `rules-and-setup.spec.ts` | Rules & limits, relaxation, save/close/open, time-off grid, theme |
| `print-export.spec.ts` | school logo, print page (what to print, paper, colour/B&W, preview), PDF, PNG, Excel and CSV files |
| `screenshots.spec.ts` | a tour of every page in light and dark mode |
