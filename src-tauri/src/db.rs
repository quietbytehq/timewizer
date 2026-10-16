use crate::master::*;
use crate::model::*;
use rusqlite::{params, Connection};
use std::path::Path;

const SCHEMA_VERSION: &str = "1";

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
    init(&conn).map_err(|e| e.to_string())?;
    write(&mut conn, s).map_err(|e| format!("Could not save the school file: {e}"))
}

fn write(conn: &mut Connection, s: &SchoolSetup) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for t in ["meta", "days", "shifts", "shift_periods", "shift_breaks", "entities"] {
        tx.execute(&format!("DELETE FROM {t}"), [])?;
    }
    for (k, v) in [
        ("schema_version", SCHEMA_VERSION),
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

pub fn load(path: &Path) -> Result<SchoolSetup, String> {
    if !path.exists() {
        return Err("That file could not be found.".into());
    }
    let conn = Connection::open(path).map_err(|e| format!("Could not open the school file: {e}"))?;
    read(&conn).map_err(|_| "This does not look like a Timewizer school file.".to_string())
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
}
