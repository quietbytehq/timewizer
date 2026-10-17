# Changelog

## 0.1.2

- Snap and Flatpak packaging.

## 0.1.1

Fixes
- Importing lessons: teacher, class and room names that contain a comma (for example "Khan, Ayesha") are now found, so exporting to Excel and importing again no longer loses lessons.
- Timetable: taking one lesson of a "same time" pair off the timetable now takes its partner off too.
- Timetable: dropping a linked lesson on a free slot no longer opens an empty "Choose a room" window.
- Excel export: a class named "Grade 6" no longer shows the sessions of "Grade 6 A" on its sheet.
- The checker no longer reports a false clash when two sessions of a lesson share a day because no other day can hold them.
- "Improve quality" now always returns the best timetable it found, even when time ran out mid-search.
- Exporting a damaged file with a lesson at period 0 skips that row instead of crashing.

Safety
- School files are checked when they open. A file that is not a school, comes from a newer version, or is damaged gives a clear message instead of a crash. Opening a file never changes it.
- The app now has a strict content security policy and only the permissions it needs. File dialogs are opened by the program itself, and the program only reads or writes files you chose in a dialog (or opened by double-clicking).

## 0.1.0

First release: Linux and Windows installers, timetable builder, import and export.
