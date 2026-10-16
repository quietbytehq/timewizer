//! Export (milestone 9): the timetable as a flat list (CSV) and as an Excel workbook.
//! PDF and PNG are drawn by the front end (see src/lib/print).
use crate::model::SchoolSetup;
use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook, Worksheet};
use serde::Serialize;

/// One lesson session on the timetable, with names instead of ids.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub classes: Vec<String>,
    pub subject: String,
    pub subject_short: String,
    pub color: String,
    pub teachers: Vec<String>,
    pub teacher_shorts: Vec<String>,
    pub room: Option<String>,
    pub day: usize,
    pub day_name: String,
    /// 1-based first period
    pub period: u8,
    pub length: u32,
    pub starts: String,
    pub ends: String,
    pub shift: String,
}

pub fn session_rows(s: &SchoolSetup) -> Vec<SessionRow> {
    let m = &s.master;
    let Some(tt) = &s.timetable else { return vec![] };
    let mut rows: Vec<(usize, SessionRow)> = Vec::new();
    for pc in &tt.cards {
        let Some(l) = s.lessons.iter().find(|l| l.id == pc.lesson_id) else { continue };
        let Some(sh) = s.shifts.iter().find(|x| x.id == pc.shift) else { continue };
        let subject = m.subjects.iter().find(|x| x.id == l.subject);
        let times = sh.days.get(pc.day as usize);
        let at = |p: u32| times.and_then(|t| t.get(p as usize));
        let first = at(pc.period as u32 - 1);
        let last = at(pc.period as u32 - 1 + pc.length - 1);
        let class_order = l.parts.first().and_then(|p| m.classes.iter().position(|c| c.id == p.class_id)).unwrap_or(usize::MAX);
        let classes = crate::links::lesson_classes(s, &l.id);
        rows.push((
            class_order,
            SessionRow {
                classes,
                subject: subject.map_or(String::new(), |x| x.name.trim().to_string()),
                subject_short: subject.map_or(String::new(), |x| x.short_name.trim().to_string()),
                color: subject.map_or("#DCD0BC".into(), |x| x.color.clone()),
                teachers: l.teachers.iter().filter_map(|t| m.teachers.iter().find(|x| &x.id == t)).map(|x| x.name.trim().to_string()).collect(),
                teacher_shorts: l.teachers.iter().filter_map(|t| m.teachers.iter().find(|x| &x.id == t)).map(|x| x.short_name.trim().to_string()).collect(),
                room: pc.room.as_ref().and_then(|r| m.rooms.iter().find(|x| &x.id == r)).map(|x| x.name.trim().to_string()),
                day: pc.day as usize,
                day_name: s.days.get(pc.day as usize).map_or(String::new(), |d| d.name.clone()),
                period: pc.period,
                length: pc.length,
                starts: first.map_or(String::new(), |t| t.start.clone()),
                ends: last.map_or(String::new(), |t| t.end.clone()),
                shift: sh.name.clone(),
            },
        ));
    }
    rows.sort_by(|a, b| (a.0, a.1.day, a.1.period, &a.1.subject).cmp(&(b.0, b.1.day, b.1.period, &b.1.subject)));
    rows.into_iter().map(|x| x.1).collect()
}

pub const CSV_HEADER: [&str; 10] = ["Class", "Subject", "Teachers", "Room", "Day", "First period", "Periods", "Starts", "Ends", "Shift"];

fn record(r: &SessionRow) -> Vec<String> {
    vec![
        r.classes.join(" + "),
        r.subject.clone(),
        r.teachers.join(", "),
        r.room.clone().unwrap_or_default(),
        r.day_name.clone(),
        r.period.to_string(),
        r.length.to_string(),
        r.starts.clone(),
        r.ends.clone(),
        r.shift.clone(),
    ]
}

/// One line per lesson session. UTF-8 with a byte-order mark so Excel shows accents correctly.
pub fn csv_text(s: &SchoolSetup) -> Result<String, String> {
    let mut w = csv::Writer::from_writer(Vec::new());
    w.write_record(CSV_HEADER).map_err(|e| e.to_string())?;
    for r in session_rows(s) {
        w.write_record(record(&r)).map_err(|e| e.to_string())?;
    }
    let bytes = w.into_inner().map_err(|e| e.to_string())?;
    Ok(format!("\u{FEFF}{}", String::from_utf8_lossy(&bytes)))
}

fn rgb(hex: &str) -> Color {
    let h = hex.trim().trim_start_matches('#');
    u32::from_str_radix(h, 16).map(Color::RGB).unwrap_or(Color::RGB(0xDCD0BC))
}

/// White or dark text, whichever reads better on this fill.
fn ink_on(hex: &str) -> Color {
    let h = hex.trim().trim_start_matches('#');
    let v = u32::from_str_radix(h, 16).unwrap_or(0xDCD0BC);
    let ch = |shift: u32| {
        let c = ((v >> shift) & 0xFF) as f64 / 255.0;
        if c <= 0.03928 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
    };
    let l = 0.2126 * ch(16) + 0.7152 * ch(8) + 0.0722 * ch(0);
    let dark = (l + 0.05) / (0.0295 + 0.05);
    let light = 1.05 / (l + 0.05);
    if dark >= light { Color::RGB(0x18343F) } else { Color::White }
}

/// A class name as written on a session ("Grade 6 A" or "Grade 6 A Boys") belongs to this class.
fn class_matches(written: &str, class: &str) -> bool {
    written == class || written.strip_prefix(class).map_or(false, |rest| rest.starts_with(' '))
}

fn x<T>(r: Result<T, rust_xlsxwriter::XlsxError>) -> Result<T, String> {
    r.map_err(|e| format!("Could not write the Excel file: {e}"))
}

struct Grid<'a> {
    s: &'a SchoolSetup,
    rows: &'a [SessionRow],
}

impl Grid<'_> {
    fn shift_ids(&self) -> Vec<usize> {
        (0..self.s.shifts.len()).filter(|&i| self.s.shifts[i].enabled).collect()
    }

    /// Writes one timetable block (title, day headers, period rows). Returns the next free row.
    fn block(&self, ws: &mut Worksheet, top: u32, title: &str, shift: usize, mine: &dyn Fn(&SessionRow) -> bool, label: &dyn Fn(&SessionRow) -> String) -> Result<u32, String> {
        let sh = &self.s.shifts[shift];
        let days: Vec<usize> = (0..7).filter(|&d| self.s.days[d].working).collect();
        let periods = days.iter().map(|&d| sh.days[d].len()).max().unwrap_or(0);
        let title_fmt = Format::new().set_bold().set_font_size(14);
        x(ws.write_string_with_format(top, 0, format!("{title} · {} shift", sh.name), &title_fmt))?;
        let head = Format::new().set_bold().set_align(FormatAlign::Center).set_background_color(Color::RGB(0x18343F)).set_font_color(Color::White).set_border(FormatBorder::Thin);
        x(ws.write_string_with_format(top + 1, 0, "Period", &head))?;
        for (c, &d) in days.iter().enumerate() {
            x(ws.write_string_with_format(top + 1, c as u16 + 1, &self.s.days[d].name, &head))?;
        }
        let side = Format::new().set_bold().set_align(FormatAlign::Center).set_align(FormatAlign::VerticalCenter).set_text_wrap().set_border(FormatBorder::Thin).set_background_color(Color::RGB(0xEFE6D8));
        let empty = Format::new().set_border(FormatBorder::Thin);
        let nodash = Format::new().set_border(FormatBorder::Thin).set_background_color(Color::RGB(0xDDDDDD)).set_align(FormatAlign::Center).set_font_color(Color::RGB(0x888888));
        for p in 0..periods {
            let r = top + 2 + p as u32;
            let t = days.first().and_then(|&d| sh.days[d].get(p));
            let side_text = match t {
                Some(t) => format!("{}\n{}–{}", p + 1, t.start, t.end),
                None => format!("{}", p + 1),
            };
            x(ws.write_string_with_format(r, 0, side_text, &side))?;
            ws.set_row_height(r, 44).map_err(|e| e.to_string())?;
            for (c, &d) in days.iter().enumerate() {
                let col = c as u16 + 1;
                if p >= sh.days[d].len() {
                    x(ws.write_string_with_format(r, col, "–", &nodash))?;
                    continue;
                }
                let here: Vec<&SessionRow> = self.rows.iter().filter(|q| q.day == d && q.shift == sh.name && mine(q) && (p as u8 + 1) >= q.period && (p as u8 + 1) < q.period + q.length as u8).collect();
                match here.as_slice() {
                    [] => {
                        x(ws.write_blank(r, col, &empty))?;
                    }
                    many => {
                        let text = many.iter().map(|q| if q.period as usize == p + 1 { label(q) } else { format!("{} (continued)", q.subject) }).collect::<Vec<_>>().join("\n");
                        let fmt = Format::new().set_text_wrap().set_align(FormatAlign::Center).set_align(FormatAlign::VerticalCenter).set_border(FormatBorder::Thin)
                            .set_background_color(rgb(&many[0].color)).set_font_color(ink_on(&many[0].color));
                        x(ws.write_string_with_format(r, col, text, &fmt))?;
                    }
                }
            }
        }
        for c in 0..=days.len() as u16 {
            ws.set_column_width(c, if c == 0 { 14 } else { 22 }).map_err(|e| e.to_string())?;
        }
        Ok(top + 2 + periods as u32 + 2)
    }
}

pub fn write_excel(s: &SchoolSetup, path: &std::path::Path) -> Result<(), String> {
    let rows = session_rows(s);
    if rows.is_empty() {
        return Err("There is no timetable to export yet. Build one first.".into());
    }
    let g = Grid { s, rows: &rows };
    let m = &s.master;
    let mut wb = Workbook::new();

    // Sessions: the flat list, like the CSV file.
    {
        let ws = wb.add_worksheet();
        x(ws.set_name("Sessions"))?;
        let head = Format::new().set_bold().set_background_color(Color::RGB(0x18343F)).set_font_color(Color::White);
        for (c, h) in CSV_HEADER.iter().enumerate() {
            x(ws.write_string_with_format(0, c as u16, *h, &head))?;
            ws.set_column_width(c as u16, if c < 4 { 24 } else { 12 }).map_err(|e| e.to_string())?;
        }
        for (i, r) in rows.iter().enumerate() {
            for (c, v) in record(r).iter().enumerate() {
                x(ws.write_string(i as u32 + 1, c as u16, v))?;
            }
        }
        x(ws.autofilter(0, 0, rows.len() as u32, CSV_HEADER.len() as u16 - 1))?;
        x(ws.set_freeze_panes(1, 0))?;
    }

    // Master: one row per class, a column per day and period.
    {
        let ws = wb.add_worksheet();
        x(ws.set_name("Master"))?;
        let head = Format::new().set_bold().set_align(FormatAlign::Center).set_background_color(Color::RGB(0x18343F)).set_font_color(Color::White).set_border(FormatBorder::Thin);
        let mut top = 0u32;
        for shift in g.shift_ids() {
            let sh = &s.shifts[shift];
            let days: Vec<usize> = (0..7).filter(|&d| s.days[d].working).collect();
            x(ws.write_string_with_format(top, 0, format!("{} shift", sh.name), &Format::new().set_bold().set_font_size(14)))?;
            x(ws.write_string_with_format(top + 1, 0, "Class", &head))?;
            let mut col = 1u16;
            for &d in &days {
                let n = sh.days[d].len() as u16;
                if n == 0 { continue; }
                if n > 1 { x(ws.merge_range(top + 1, col, top + 1, col + n - 1, &s.days[d].name, &head))?; } else { x(ws.write_string_with_format(top + 1, col, &s.days[d].name, &head))?; }
                for p in 0..n {
                    x(ws.write_string_with_format(top + 2, col + p, (p + 1).to_string(), &head))?;
                }
                col += n;
            }
            x(ws.write_string_with_format(top + 2, 0, "", &head))?;
            let mut r = top + 3;
            for c in m.classes.iter().filter(|c| c.shift == sh.id) {
                x(ws.write_string_with_format(r, 0, &c.short_name, &Format::new().set_bold().set_border(FormatBorder::Thin)))?;
                let mut col = 1u16;
                for &d in &days {
                    for p in 0..sh.days[d].len() {
                        let here: Vec<&SessionRow> = rows.iter().filter(|q| q.day == d && q.shift == sh.name && q.classes.iter().any(|n| class_matches(n, c.name.trim())) && (p as u8 + 1) >= q.period && (p as u8 + 1) < q.period + q.length as u8).collect();
                        let fmt = match here.first() {
                            Some(q) => Format::new().set_align(FormatAlign::Center).set_border(FormatBorder::Thin).set_background_color(rgb(&q.color)).set_font_color(ink_on(&q.color)),
                            None => Format::new().set_border(FormatBorder::Thin),
                        };
                        let text = here.iter().map(|q| format!("{} {}", q.subject_short, q.teacher_shorts.join("/"))).collect::<Vec<_>>().join("\n");
                        x(ws.write_string_with_format(r, col + p as u16, text, &fmt))?;
                    }
                    col += sh.days[d].len() as u16;
                }
                r += 1;
            }
            top = r + 2;
            x(ws.set_column_width(0, 12))?;
            x(ws.set_freeze_panes(0, 1))?;
        }
    }

    // One sheet each for classes, teachers and rooms, a block per name.
    let classes: Vec<(String, String)> = m.classes.iter().map(|c| (c.name.trim().to_string(), c.shift.clone())).collect();
    for (sheet, kind) in [("Classes", 0), ("Teachers", 1), ("Rooms", 2)] {
        let ws = wb.add_worksheet();
        x(ws.set_name(sheet))?;
        let mut top = 0u32;
        let names: Vec<(String, Vec<usize>)> = match kind {
            0 => classes.iter().map(|(n, sh)| (n.clone(), s.shifts.iter().position(|x| &x.id == sh).into_iter().collect())).collect(),
            1 => m.teachers.iter().map(|t| (t.name.trim().to_string(), (0..s.shifts.len()).filter(|&i| s.shifts[i].enabled && t.shifts.contains(&s.shifts[i].id)).collect())).collect(),
            _ => m.rooms.iter().map(|r| (r.name.trim().to_string(), g.shift_ids())).collect(),
        };
        for (name, shifts) in names {
            let mine = |q: &SessionRow| match kind {
                0 => q.classes.iter().any(|c| class_matches(c, &name)),
                1 => q.teachers.contains(&name),
                _ => q.room.as_deref() == Some(name.as_str()),
            };
            if !rows.iter().any(|q| mine(q)) {
                continue;
            }
            let label = |q: &SessionRow| match kind {
                0 => format!("{}\n{}{}", q.subject, q.teachers.join(", "), q.room.as_ref().map_or(String::new(), |r| format!(" · {r}"))),
                1 => format!("{}\n{}{}", q.subject, q.classes.join(", "), q.room.as_ref().map_or(String::new(), |r| format!(" · {r}"))),
                _ => format!("{}\n{} · {}", q.subject, q.classes.join(", "), q.teachers.join(", ")),
            };
            for sh in shifts {
                if rows.iter().any(|q| q.shift == s.shifts[sh].name && mine(q)) {
                    top = g.block(ws, top, &name, sh, &mine, &label)?;
                }
            }
        }
    }
    x(wb.save(path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use std::time::Duration;

    fn built() -> SchoolSetup {
        use crate::importer::*;
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../samples");
        let tables = KINDS.iter().map(|k| read_file(&dir.join(format!("{k}.csv")), Some(k)).unwrap().remove(0)).collect();
        let mut s = apply(SchoolSetup::default_new("Sample School"), tables).setup;
        let r = crate::solver::solve(&s, &[], &crate::solver::Options { time_limit: Duration::from_secs(30), ..Default::default() }, &AtomicBool::new(false), &mut |_| {});
        assert!(r.unplaced.is_empty());
        s.timetable = Some(r.timetable);
        s
    }

    #[test]
    fn one_row_per_lesson_session_with_names_and_times() {
        let s = built();
        let rows = session_rows(&s);
        assert_eq!(rows.len(), 108);
        let r = rows.iter().find(|r| r.subject == "Computer Studies" && r.classes == vec!["Grade 6 A".to_string()]).unwrap();
        assert_eq!((r.length, r.room.as_deref(), r.teachers.clone()), (2, Some("Computer Lab"), vec!["Hamza Noor".to_string()]));
        // a double starts at its first period and ends when its second period ends
        let t = &s.shifts[0].days[r.day];
        assert_eq!(r.starts, t[r.period as usize - 1].start);
        assert_eq!(r.ends, t[r.period as usize].end);
        // classes come first in class order, then by day and period
        assert!(rows.windows(2).all(|w| (w[0].day, w[0].period) <= (w[1].day, w[1].period) || w[0].classes != w[1].classes));
        assert_eq!(rows[0].classes, vec!["Grade 6 A".to_string()]);
    }

    #[test]
    fn csv_is_readable_back_and_keeps_commas_and_quotes() {
        let mut s = built();
        s.master.teachers[0].name = "Khan, Ayesha \"AK\"".into();
        let text = csv_text(&s).unwrap();
        assert!(text.starts_with('\u{FEFF}'));
        let mut rd = csv::Reader::from_reader(text.trim_start_matches('\u{FEFF}').as_bytes());
        assert_eq!(rd.headers().unwrap().iter().collect::<Vec<_>>(), CSV_HEADER.to_vec());
        let recs: Vec<csv::StringRecord> = rd.records().map(|r| r.unwrap()).collect();
        assert_eq!(recs.len(), 108);
        assert!(recs.iter().any(|r| &r[2] == "Khan, Ayesha \"AK\""));
        assert!(recs.iter().all(|r| r.len() == 10 && !r[4].is_empty() && r[5].parse::<u32>().is_ok()));
    }

    #[test]
    fn nothing_to_export_before_a_timetable_exists() {
        let s = SchoolSetup::default_new("Empty");
        assert!(session_rows(&s).is_empty());
        let p = std::env::temp_dir().join(format!("tw-empty-{}.xlsx", std::process::id()));
        assert!(write_excel(&s, &p).unwrap_err().contains("Build one first"));
    }

    #[test]
    fn excel_has_all_sheets_and_the_timetable_in_them() {
        use calamine::{open_workbook, Reader, Xlsx};
        let s = built();
        let p = std::env::temp_dir().join(format!("tw-export-{}.xlsx", std::process::id()));
        write_excel(&s, &p).unwrap();
        let mut wb: Xlsx<_> = open_workbook(&p).unwrap();
        assert_eq!(wb.sheet_names(), vec!["Sessions", "Master", "Classes", "Teachers", "Rooms"]);
        let sessions = wb.worksheet_range("Sessions").unwrap();
        assert_eq!(sessions.rows().count(), 109); // heading + 108
        assert_eq!(sessions.get_value((0, 0)).unwrap().to_string(), "Class");
        let master = wb.worksheet_range("Master").unwrap();
        let text: Vec<String> = master.rows().flat_map(|r| r.iter().map(|c| c.to_string())).collect();
        for want in ["Class", "6A", "7B", "Monday"] {
            assert!(text.iter().any(|t| t == want), "Master lacks {want}");
        }
        assert!(text.iter().any(|t| t.starts_with("ENG ")));
        let classes = wb.worksheet_range("Classes").unwrap();
        let ctext: Vec<String> = classes.rows().flat_map(|r| r.iter().map(|c| c.to_string())).collect();
        assert!(ctext.iter().any(|t| t.starts_with("Grade 6 A · Morning shift")));
        assert!(ctext.iter().any(|t| t == "Friday") && ctext.iter().any(|t| t.contains("Hamza Noor")));
        let teachers = wb.worksheet_range("Teachers").unwrap();
        assert!(teachers.rows().flat_map(|r| r.iter().map(|c| c.to_string())).any(|t| t.starts_with("Bilal Ahmed")));
        let rooms = wb.worksheet_range("Rooms").unwrap();
        assert!(rooms.rows().flat_map(|r| r.iter().map(|c| c.to_string())).any(|t| t.starts_with("Computer Lab")));
        let _ = std::fs::remove_file(p);
    }

    #[test]
    fn the_school_logo_is_saved_with_the_school() {
        let mut s = SchoolSetup::default_new("Logo School");
        s.logo = Some("data:image/png;base64,iVBORw0KGgo=".into());
        let p = std::env::temp_dir().join(format!("tw-logo-{}.twz", std::process::id()));
        crate::db::save(&p, &s).unwrap();
        assert_eq!(crate::db::load(&p).unwrap().logo, s.logo);
        s.logo = None;
        crate::db::save(&p, &s).unwrap();
        assert_eq!(crate::db::load(&p).unwrap().logo, None);
        let _ = std::fs::remove_file(p);
    }
}
