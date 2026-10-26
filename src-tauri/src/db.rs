use crate::master::*;
use crate::model::*;
use rusqlite::{params, Connection, OpenFlags};
use std::path::Path;

/// The newest file format this version reads and writes.
///   1: Timetable 0.1.x, and 0.2.0 files without substitutions (still written as 1, so 0.1.x can open them)
///   2: with absences and covers (0.2.0); 0.1.x refuses these instead of losing the substitutions on save
const SCHEMA_VERSION: u32 = 2;

/// The format a school is written in: the oldest that holds everything in it.
fn version_for(s: &SchoolSetup) -> u32 {
    if s.substitutions.has_records() { 2 } else { 1 }
}

/// Brings a school read from an older file up to date. Version 1 has no substitution rows, so
/// they start empty (already the case after reading); nothing else changed between 1 and 2.
fn migrate(from: u32, s: &mut SchoolSetup) {
    if from < 2 {
        s.substitutions.absences.clear();
        s.substitutions.covers.clear();
    }
}

fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS days (idx INTEGER PRIMARY KEY, name TEXT NOT NULL, working INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS shifts (id TEXT PRIMARY KEY, ord INTEGER NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS shift_periods (
             shift_id TEXT NOT NULL, day_idx INTEGER NOT NULL, period_no INTEGER NOT NULL,
             start_time TEXT NOT NULL, end_time TEXT NOT NULL,
             PRIMARY KEY (shift_id, day_idx, period_no));
         CREATE TABLE IF NOT EXISTS shift_breaks (
             shift_id TEXT NOT NULL, after_period INTEGER NOT NULL, name TEXT NOT NULL, cannot_cross INTEGER NOT NULL,
             PRIMARY KEY (shift_id, after_period));
         CREATE TABLE IF NOT EXISTS entities (
             kind TEXT NOT NULL, ord INTEGER NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL,
             PRIMARY KEY (kind, id));",
    )
}

pub fn save(path: &Path, s: &SchoolSetup) -> Result<(), String> {
    let mut conn = Connection::open(path).map_err(|e| format!("Could not open the school file: {e}"))?;
    lock_down(&conn);
    init(&conn).map_err(|e| e.to_string())?;
    write(&mut conn, s).map_err(|e| format!("Could not save the school file: {e}"))
}

fn write(conn: &mut Connection, s: &SchoolSetup) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for t in ["meta", "days", "shifts", "shift_periods", "shift_breaks", "entities"] {
        tx.execute(&format!("DELETE FROM {t}"), [])?;
    }
    let version = version_for(s).to_string();
    for (k, v) in [
        ("schema_version", version.as_str()),
        ("name", &s.name),
        ("school_type", &s.school_type),
        ("academic_year", &s.academic_year),
    ] {
        tx.execute("INSERT INTO meta VALUES (?1, ?2)", params![k, v])?;
    }
    if let Some(logo) = &s.logo {
        tx.execute("INSERT INTO meta VALUES ('logo', ?1)", params![logo])?;
    }
    for (i, d) in s.days.iter().enumerate() {
        tx.execute("INSERT INTO days VALUES (?1, ?2, ?3)", params![i as i64, d.name, d.working])?;
    }
    for (ord, sh) in s.shifts.iter().enumerate() {
        tx.execute("INSERT INTO shifts VALUES (?1, ?2, ?3, ?4)", params![sh.id, ord as i64, sh.name, sh.enabled])?;
        for (di, periods) in sh.days.iter().enumerate() {
            for (pi, p) in periods.iter().enumerate() {
                tx.execute(
                    "INSERT INTO shift_periods VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![sh.id, di as i64, (pi + 1) as i64, p.start, p.end],
                )?;
            }
        }
        for b in &sh.breaks {
            tx.execute(
                "INSERT INTO shift_breaks VALUES (?1, ?2, ?3, ?4)",
                params![sh.id, b.after_period, b.name, b.cannot_cross],
            )?;
        }
    }
    let m = &s.master;
    put_all(&tx, "subject", m.subjects.iter().map(|x| (&x.id, serde_json::to_string(x))))?;
    put_all(&tx, "teacher", m.teachers.iter().map(|x| (&x.id, serde_json::to_string(x))))?;
    put_all(&tx, "class", m.classes.iter().map(|x| (&x.id, serde_json::to_string(x))))?;
    put_all(&tx, "building", m.buildings.iter().map(|x| (&x.id, serde_json::to_string(x))))?;
    put_all(&tx, "room", m.rooms.iter().map(|x| (&x.id, serde_json::to_string(x))))?;
    put_all(&tx, "lesson", s.lessons.iter().map(|x| (&x.id, serde_json::to_string(x))))?;
    put_all(&tx, "link", s.links.iter().map(|x| (&x.id, serde_json::to_string(x))))?;
    tx.execute("INSERT INTO entities VALUES ('settings', 0, 'settings', ?1)", params![serde_json::to_string(&s.settings).unwrap_or_default()])?;
    let sub = &s.substitutions;
    put_all(&tx, "absence", sub.absences.iter().map(|x| (&x.id, serde_json::to_string(x))))?;
    // A cover is known by its session, date and absence; a repeated one replaces the earlier copy.
    for (ord, c) in sub.covers.iter().enumerate() {
        let json = serde_json::to_string(c).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        tx.execute("INSERT OR REPLACE INTO entities VALUES ('cover', ?1, ?2, ?3)", params![ord as i64, c.key(), json])?;
    }
    if sub.counts_from.is_some() || sub.counts_year.is_some() {
        let cs = crate::substitutions::CountSettings { counts_from: sub.counts_from.clone(), counts_year: sub.counts_year.clone() };
        tx.execute("INSERT INTO entities VALUES ('substitution_settings', 0, 'counts', ?1)", params![serde_json::to_string(&cs).unwrap_or_default()])?;
    }
    if let Some(t) = &s.timetable {
        let id = "timetable".to_string();
        tx.execute("INSERT INTO entities VALUES ('timetable', 0, ?1, ?2)", params![id, serde_json::to_string(t).unwrap_or_default()])?;
    }
    tx.commit()
}

fn put_all<'a>(
    tx: &rusqlite::Transaction,
    kind: &str,
    items: impl Iterator<Item = (&'a String, serde_json::Result<String>)>,
) -> rusqlite::Result<()> {
    for (ord, (id, json)) in items.enumerate() {
        let json = json.map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        tx.execute("INSERT INTO entities VALUES (?1, ?2, ?3, ?4)", params![kind, ord as i64, id, json])?;
    }
    Ok(())
}

fn get_all<T: serde::de::DeserializeOwned>(conn: &Connection, kind: &str) -> rusqlite::Result<Vec<T>> {
    let mut st = conn.prepare("SELECT json FROM entities WHERE kind = ?1 ORDER BY ord")?;
    let rows: Vec<String> = st.query_map([kind], |r| r.get(0))?.collect::<Result<_, _>>()?;
    rows.iter()
        .map(|j| serde_json::from_str(j).map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))))
        .collect()
}

/// Turns off SQLite features a hand-made file could use to run its own code.
fn lock_down(conn: &Connection) {
    let _ = conn.pragma_update(None, "trusted_schema", "OFF");
}

const NOT_OURS: &str = "This does not look like a Timewizer school file.";

/// Opens a school file. Anything wrong with the file (not ours, from a newer version, damaged,
/// or holding values that make no sense) comes back as a plain message, never a crash.
pub fn load(path: &Path) -> Result<SchoolSetup, String> {
    if path.is_dir() {
        return Err("That is a folder, not a school file.".into());
    }
    if !path.exists() {
        return Err("That file could not be found.".into());
    }
    // Read-only: opening a school must never change the file.
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| format!("Could not open the school file: {e}"))?;
    lock_down(&conn);
    let version: String = conn
        .query_row("SELECT value FROM meta WHERE key = 'schema_version'", [], |r| r.get(0))
        .map_err(|_| NOT_OURS.to_string())?;
    let version = match version.trim().parse::<u32>() {
        Ok(v) if v > SCHEMA_VERSION => {
            return Err("This school file was made by a newer version of Timewizer. Please update Timewizer to open it.".into())
        }
        Ok(v) => v,
        Err(_) => return Err(NOT_OURS.into()),
    };
    let mut setup = read(&conn).map_err(|e| format!("This school file is damaged or incomplete and could not be read ({e})."))?;
    migrate(version, &mut setup);
    sanity_check(&setup)?;
    Ok(setup)
}

/// Checks the loaded data for values the rest of the program cannot work with (a hand-edited or
/// damaged file). Mistakes a person can fix in the app are left to `SchoolSetup::validate`.
fn sanity_check(s: &SchoolSetup) -> Result<(), String> {
    let damaged = |what: String| Err(format!("This school file is damaged: {what}"));
    if s.days.len() != 7 {
        return damaged(format!("it lists {} days of the week instead of 7.", s.days.len()));
    }
    if s.shifts.is_empty() {
        return damaged("it has no shifts.".into());
    }
    for sh in &s.shifts {
        if sh.days.len() != 7 {
            return damaged(format!("the shift \"{}\" does not have 7 days.", sh.name));
        }
        if sh.days.iter().any(|d| d.len() > 24) {
            return damaged(format!("the shift \"{}\" has more than 24 periods in a day.", sh.name));
        }
    }
    // Zero is allowed here: a person can save a half-finished lesson, and the checks tell them to fix it.
    // Absurdly large numbers can only come from a damaged file and would overflow the maths later.
    for l in &s.lessons {
        if l.periods_per_card > 24 {
            return damaged(format!("a lesson has {} periods in a row (the most possible is 24).", l.periods_per_card));
        }
        if l.cards_per_week > 200 {
            return damaged(format!("a lesson has {} sessions a week (the most possible is 200).", l.cards_per_week));
        }
    }
    for a in &s.substitutions.absences {
        if crate::substitutions::parse_date(&a.from).is_none() || crate::substitutions::parse_date(&a.to).is_none() {
            return damaged(format!("an absence has a date that does not exist (\"{}\" to \"{}\").", a.from, a.to));
        }
    }
    // A timetable can be out of date (a lesson or period was removed after building); that is
    // shown to the person. But periods count from 1, so a card at period 0 is plainly damaged.
    if let Some(t) = &s.timetable {
        for c in &t.cards {
            if c.number == 0 || c.period == 0 || c.length == 0 || c.day > 6 {
                return damaged(format!(
                    "the timetable places a lesson at a time that does not exist (day {}, period {}).",
                    c.day as u32 + 1,
                    c.period
                ));
            }
        }
    }
    Ok(())
}

fn read(conn: &Connection) -> rusqlite::Result<SchoolSetup> {
    let meta = |k: &str| -> rusqlite::Result<String> {
        conn.query_row("SELECT value FROM meta WHERE key = ?1", [k], |r| r.get(0))
    };
    let mut days = Vec::new();
    let mut st = conn.prepare("SELECT name, working FROM days ORDER BY idx")?;
    for r in st.query_map([], |r| Ok(Day { name: r.get(0)?, working: r.get(1)? }))? {
        days.push(r?);
    }
    let mut shifts = Vec::new();
    let mut st = conn.prepare("SELECT id, name, enabled FROM shifts ORDER BY ord")?;
    let rows: Vec<(String, String, bool)> = st
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    for (id, name, enabled) in rows {
        let mut per_day: Vec<Vec<PeriodTime>> = vec![vec![]; 7];
        let mut st = conn.prepare(
            "SELECT day_idx, start_time, end_time FROM shift_periods WHERE shift_id = ?1 ORDER BY day_idx, period_no",
        )?;
        for r in st.query_map([&id], |r| {
            Ok((r.get::<_, i64>(0)? as usize, PeriodTime { start: r.get(1)?, end: r.get(2)? }))
        })? {
            let (d, p) = r?;
            if d < 7 {
                per_day[d].push(p);
            }
        }
        let mut breaks = Vec::new();
        let mut st = conn.prepare(
            "SELECT after_period, name, cannot_cross FROM shift_breaks WHERE shift_id = ?1 ORDER BY after_period",
        )?;
        for r in st.query_map([&id], |r| {
            Ok(Break { after_period: r.get::<_, i64>(0)? as u32, name: r.get(1)?, cannot_cross: r.get(2)? })
        })? {
            breaks.push(r?);
        }
        shifts.push(Shift { id, name, enabled, days: per_day, breaks });
    }
    Ok(SchoolSetup {
        name: meta("name")?,
        school_type: meta("school_type")?,
        academic_year: meta("academic_year")?,
        logo: meta("logo").ok(),
        days,
        shifts,
        master: MasterData {
            subjects: get_all(conn, "subject")?,
            teachers: get_all(conn, "teacher")?,
            classes: get_all(conn, "class")?,
            buildings: get_all(conn, "building")?,
            rooms: get_all(conn, "room")?,
        },
        lessons: get_all(conn, "lesson")?,
        links: get_all(conn, "link")?,
        settings: get_all::<crate::settings::Settings>(conn, "settings")?.into_iter().next().unwrap_or_default(),
        substitutions: {
            let cs = get_all::<crate::substitutions::CountSettings>(conn, "substitution_settings")?.into_iter().next().unwrap_or_default();
            crate::substitutions::Substitutions {
                absences: get_all(conn, "absence")?,
                covers: get_all(conn, "cover")?,
                counts_from: cs.counts_from,
                counts_year: cs.counts_year,
            }
        },
        timetable: get_all::<crate::solver::Timetable>(conn, "timetable")?.into_iter().next(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("timewizer-test-{}-{name}.twz", std::process::id()))
    }

    #[test]
    fn save_and_load_round_trip() {
        let p = tmp("roundtrip");
        let mut s = SchoolSetup::default_new("Round Trip School");
        s.days[5].working = true;
        s.shifts[1].enabled = true;
        s.academic_year = "2026-27".into();
        save(&p, &s).unwrap();
        assert_eq!(load(&p).unwrap(), s);
        // saving again over the same file replaces the data
        s.name = "Renamed".into();
        s.shifts[0].breaks.clear();
        save(&p, &s).unwrap();
        assert_eq!(load(&p).unwrap(), s);
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn master_data_round_trip() {
        let p = tmp("master");
        let mut s = SchoolSetup::default_new("Master");
        s.master.subjects.push(Subject { id: "s1".into(), name: "Maths".into(), short_name: "MA".into(), color: "#1F6F6B".into() });
        s.master.teachers.push(Teacher {
            id: "t1".into(), name: "Ms A".into(), short_name: "A".into(), shifts: vec!["morning".into()],
            max_lessons_per_day: Some(6),
            time_off: vec![TimeOffCell { shift: "morning".into(), day: 0, period: 1, state: 2 }],
            ..Default::default()
        });
        s.master.buildings.push(Building { id: "b1".into(), name: "Main".into() });
        s.master.rooms.push(Room { id: "r1".into(), name: "Lab".into(), short_name: "LAB".into(), building: Some("b1".into()), capacity: Some(30), time_off: vec![] });
        s.master.classes.push(Class {
            id: "c1".into(), name: "Grade 5A".into(), short_name: "5A".into(), shift: "morning".into(),
            class_teacher: Some("t1".into()), home_room: Some("r1".into()),
            divisions: vec![Division { id: "d1".into(), name: "Boys/Girls".into(),
                groups: vec![Group { id: "g1".into(), name: "Boys".into() }, Group { id: "g2".into(), name: "Girls".into() }] }],
            time_off: vec![],
        });
        s.lessons.push(crate::lessons::Lesson {
            id: "l1".into(), subject: "s1".into(), teachers: vec!["t1".into()],
            parts: vec![crate::lessons::LessonPart { class_id: "c1".into(), group_id: Some("g1".into()) }],
            periods_per_card: 2, cards_per_week: 3, rooms: vec!["r1".into()],
        });
        save(&p, &s).unwrap();
        assert_eq!(load(&p).unwrap(), s);
        assert!(s.validate().is_empty(), "{:?}", s.validate());
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn rejects_non_school_files() {
        let p = tmp("junk");
        std::fs::write(&p, b"hello, not a database").unwrap();
        assert!(load(&p).is_err());
        let _ = std::fs::remove_file(p);
    }

    fn saved(name: &str, s: &SchoolSetup) -> std::path::PathBuf {
        let p = tmp(name);
        let _ = std::fs::remove_file(&p);
        save(&p, s).unwrap();
        p
    }
    fn edit(p: &std::path::Path, sql: &str) {
        Connection::open(p).unwrap().execute_batch(sql).unwrap();
    }
    fn message(p: &std::path::Path) -> String {
        let e = load(p).unwrap_err();
        let _ = std::fs::remove_file(p);
        e
    }

    #[test]
    fn bad_files_get_clear_messages() {
        // not a database, an empty file, a folder, a missing file
        let p = tmp("text");
        std::fs::write(&p, b"hello").unwrap();
        assert_eq!(message(&p), NOT_OURS);
        let p = tmp("empty");
        std::fs::write(&p, b"").unwrap();
        assert_eq!(message(&p), NOT_OURS);
        assert!(load(&std::env::temp_dir()).unwrap_err().contains("folder"));
        assert!(load(&tmp("missing")).unwrap_err().contains("could not be found"));
        // a database that is not ours
        let p = tmp("other");
        let _ = std::fs::remove_file(&p);
        edit(&p, "CREATE TABLE photos (id INTEGER)");
        assert_eq!(message(&p), NOT_OURS);
        // ours, but from the future
        let p = saved("future", &SchoolSetup::default_new("X"));
        edit(&p, "UPDATE meta SET value = '99' WHERE key = 'schema_version'");
        assert!(message(&p).contains("newer version"));
        // a damaged part
        let p = saved("damaged", &SchoolSetup::default_new("X"));
        edit(&p, "INSERT INTO entities VALUES ('lesson', 0, 'l', '{not json')");
        assert!(message(&p).contains("damaged or incomplete"));
        // a missing part
        let p = saved("nodays", &SchoolSetup::default_new("X"));
        edit(&p, "DELETE FROM days WHERE idx > 2");
        assert!(message(&p).contains("7"));
    }

    #[test]
    fn nonsense_values_are_refused_instead_of_crashing_later() {
        let mut s = SchoolSetup::default_new("X");
        s.master.subjects.push(Subject { id: "s".into(), name: "S".into(), short_name: "S".into(), color: "#000000".into() });
        s.master.classes.push(Class { id: "c".into(), name: "C".into(), short_name: "C".into(), shift: "morning".into(), ..Default::default() });
        s.master.teachers.push(Teacher { id: "t".into(), name: "T".into(), short_name: "T".into(), shifts: vec!["morning".into()], ..Default::default() });
        s.lessons.push(crate::lessons::Lesson {
            id: "l".into(), subject: "s".into(), teachers: vec!["t".into()],
            parts: vec![crate::lessons::LessonPart { class_id: "c".into(), group_id: None }],
            periods_per_card: 1, cards_per_week: 2, rooms: vec![],
        });
        let card = |period: u8, length: u32| crate::solver::PlacedCard {
            lesson_id: "l".into(), number: 1, shift: "morning".into(), day: 0, period, length, room: None, locked: false,
        };
        // a normal timetable loads
        s.timetable = Some(crate::solver::Timetable { cards: vec![card(1, 1)] });
        let p = saved("fine", &s);
        assert!(load(&p).is_ok());
        let _ = std::fs::remove_file(p);
        // period 0 or a zero-length session
        for (period, length) in [(0u8, 1u32), (1, 0)] {
            s.timetable = Some(crate::solver::Timetable { cards: vec![card(period, length)] });
            let p = saved("badcard", &s);
            assert!(message(&p).contains("time that does not exist"), "period {period} length {length}");
        }
        // an out-of-date timetable (its lesson was deleted, or the day got shorter) still opens:
        // the app shows a warning, the person's work must not be locked away
        s.timetable = Some(crate::solver::Timetable { cards: vec![crate::solver::PlacedCard { lesson_id: "ghost".into(), ..card(1, 1) }, card(30, 1)] });
        let p = saved("stale", &s);
        assert!(load(&p).is_ok());
        let _ = std::fs::remove_file(p);
        // a half-finished lesson (zero sessions) also opens, so the person can fix it
        s.timetable = None;
        s.lessons[0].cards_per_week = 0;
        let p = saved("zero", &s);
        assert!(load(&p).is_ok());
        let _ = std::fs::remove_file(p);
        // absurd sizes only come from a damaged file
        s.lessons[0].cards_per_week = 4_000_000_000;
        assert!(message(&saved("huge", &s)).contains("sessions a week"));
        s.lessons[0].cards_per_week = 2;
        s.lessons[0].periods_per_card = 500;
        assert!(message(&saved("tall", &s)).contains("periods in a row"));
    }

    /// A file saved by Timewizer 0.1.3 (the demo school from `samples/`, built, one lesson locked)
    /// must keep opening in every later version.
    #[test]
    fn opens_a_school_file_from_0_1_3() {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample-school-0.1.3.twz");
        let before = std::fs::read(&p).unwrap();
        let s = load(&p).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), before, "opening must not change the file");
        assert_eq!(s.name, "Sample School");
        assert!(!s.lessons.is_empty() && !s.master.teachers.is_empty());
        let t = s.timetable.as_ref().expect("the timetable was saved");
        let sessions: u32 = s.lessons.iter().map(|l| l.cards_per_week).sum();
        assert_eq!(t.cards.len() as u32, sessions);
        assert_eq!(t.cards.iter().filter(|c| c.locked).count(), 1);
        // and it saves again in the current format
        let q = tmp("from-0.1.3");
        save(&q, &s).unwrap();
        assert_eq!(load(&q).unwrap(), s);
        let _ = std::fs::remove_file(q);
    }

    fn version_of(p: &std::path::Path) -> String {
        Connection::open(p).unwrap().query_row("SELECT value FROM meta WHERE key = 'schema_version'", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn substitutions_round_trip_and_set_the_file_version() {
        use crate::substitutions::*;
        let mut s = SchoolSetup::default_new("Subs");
        let p = saved("subs-none", &s);
        assert_eq!(version_of(&p), "1", "no substitutions: the old format, so 0.1.x can still open it");
        let _ = std::fs::remove_file(&p);
        s.substitutions.absences.push(Absence {
            id: "a1".into(), teacher_id: "t1".into(), from: "2026-10-26".into(), to: "2026-10-28".into(),
            periods: vec![PeriodRef { shift: "morning".into(), period: 2 }], note: "Course".into(),
        });
        let c = Cover {
            absence_id: "a1".into(), date: "2026-10-26".into(), lesson_id: "l1".into(), number: 1, absent_teacher: "t1".into(),
            cover_teacher: Some("t2".into()), no_cover: false, shift: "morning".into(), period: 2, length: 1, archived: false,
        };
        s.substitutions.covers = vec![c.clone(), Cover { number: 2, cover_teacher: None, no_cover: true, archived: true, ..c.clone() }];
        s.substitutions.counts_from = Some("2026-09-01".into());
        s.substitutions.counts_year = Some("2026-27".into());
        let p = saved("subs", &s);
        assert_eq!(version_of(&p), "2");
        assert_eq!(load(&p).unwrap(), s);
        // the same cover twice (a repeated save of one decision) does not stop the save
        s.substitutions.covers.push(c);
        save(&p, &s).unwrap();
        assert_eq!(load(&p).unwrap().substitutions.covers.len(), 2);
        // all removed again: back to the old format
        s.substitutions = Default::default();
        save(&p, &s).unwrap();
        assert_eq!(version_of(&p), "1");
        assert_eq!(load(&p).unwrap(), s);
        // a version from the future is refused, version 2 opens
        edit(&p, "UPDATE meta SET value = '3' WHERE key = 'schema_version'");
        assert!(load(&p).unwrap_err().contains("newer version"));
        edit(&p, "UPDATE meta SET value = '2' WHERE key = 'schema_version'");
        assert!(load(&p).is_ok());
        // an absence with an impossible date is a damaged file
        edit(&p, r#"INSERT INTO entities VALUES ('absence', 0, 'x', '{"id":"x","teacherId":"t","from":"2026-02-30","to":"2026-03-01"}')"#);
        assert!(message(&p).contains("absence has a date that does not exist"));
    }

    #[test]
    fn a_0_1_3_file_has_no_substitutions_and_stays_in_the_old_format() {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample-school-0.1.3.twz");
        assert_eq!(version_of(&p), "1");
        let s = load(&p).unwrap();
        assert_eq!(s.substitutions, Default::default());
        let q = tmp("from-0.1.3-subs");
        save(&q, &s).unwrap();
        assert_eq!(version_of(&q), "1");
        let _ = std::fs::remove_file(q);
    }

    #[test]
    fn opening_a_school_does_not_change_the_file() {
        let p = saved("readonly", &SchoolSetup::default_new("X"));
        let before = std::fs::read(&p).unwrap();
        load(&p).unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), before);
        let _ = std::fs::remove_file(p);
    }
}
