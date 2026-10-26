# Changelog

## 0.2.0

Backups
- New **Backups** page: choose a backup folder (a USB stick, a shared drive, or a folder a cloud service keeps in sync; Timewizer itself stays offline).
- **Back up now**, and an optional backup every time the school is saved.
- Keeps the newest 10 backups of each school (the number can be changed). Backups are named after the school file with the date and time.
- **Restore from backup** lists the backups and opens the chosen one as a new file; the open school is never replaced. Also on the welcome screen.
- Clear messages when the backup folder is missing or cannot be written to. A failed automatic backup never stops the school from being saved.

Start-up
- A short start-up animation (under two seconds). A click or any key skips it. It is not shown when the computer is set to reduce motion, or when a school file is opened by double-click.
- New **Preferences** page (School setup > Preferences) to switch the animation off.

Undo, redo and change history
- New **Change history** panel on the Timetable page: every timetable edit (move, place, swap, take off, lock, unlock, room change, improve, build) is listed in plain words with its time, newest first.
- The Undo and Redo buttons say what they will undo or redo. They are also on the Build timetable page, and Ctrl+Z / Ctrl+Y work there too.
- Building the timetable again is one step: one Undo brings back the whole previous timetable.

Locks and conflict colours
- When locked lessons stop others from being placed, the build page names them (with day and period, and how many sessions each is in the way of) and offers **Unlock these and build again**. Each unplaced session that is held up by locks says so, and names the locks.
- Two locked lessons that clash now name each other.
- Amber boxes while dragging now also cover the "nice to have" rules: a new free period in the middle of a teacher's or class's day, and two sessions of a lesson on days next to each other (when those rules are switched on in Rules & limits). Hovering a box says why.
- Clearer words on the Timetable page: green free, amber allowed but not ideal, red a clash; a locked lesson's tooltip says to unlock it to move it.

Substitutions (new)
- New **Day to day > Substitutions** page: mark a teacher absent for one day, a date range, or only some periods (part-day).
- For each lesson to cover, Timewizer suggests a teacher who is free (not teaching, not on time off, not away, not already covering), stays within their weekly maximum, teaches the same subject if possible, and has the fewest covers so far. Any other teacher can be chosen (with a warning that says which rule it breaks), or "No cover needed".
- Cover counts per teacher for the school year, with a total and a **Reset counts** button (with a confirmation).
- Cover sheet: one page per day as a print-ready PDF, or a CSV file.
- Substitutions are saved in the school file and never change the timetable. A school file with substitutions uses file format 2 (Timewizer 0.1.x will say it needs a newer version instead of losing them); files without substitutions stay in format 1.

Excel and CSV export
- **Save Excel** and **Save CSV** on the Print & export page now hold exactly the timetables ticked under "What to print" (classes, teachers, rooms, master).
- **Save CSV** writes the class, teacher, room and master timetables themselves (a block each, with the period times). The old one-line-per-session list is now **Save lesson list (CSV)**.
- Period times show each day's own bell times where they differ (for example an early Friday), in Excel and CSV; the Master sheet shows the times in its headers.
- Slightly wider columns in the Excel sheets.

## 0.1.3

Large schools
- Dragging, moving, swapping and "Improve quality" on a school with thousands of sessions took 20-40 seconds; they now take a fraction of a second.
- The Master view opens, zooms and scrolls about ten times faster, and the program no longer freezes while a command runs.
- If some sessions are left over after building, a repair step now tries again to place them (it only runs when something is left, and can be cancelled).

Packaging
- The snap now has its own icon (snap/gui/timewizer.png), and the AppStream file names the application icon.

Fixes
- A class could get two sessions of one subject on a day for a group that should have had only one, when another group of the same class had extra sessions of that subject.

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
