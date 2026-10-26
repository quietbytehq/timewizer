//! Export (milestone 9, 0.2.0 stage 6): the timetable as a flat list (CSV), as timetables in a
//! CSV file, and as an Excel workbook. PDF and PNG are drawn by the front end (see src/lib/print).
//! Excel is written directly (rust_xlsxwriter), so Excel does not need to be installed.
use crate::model::{SchoolSetup, Shift};
use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook, Worksheet};
use serde::{Deserialize, Serialize};

/// What to export, as chosen on the Print & export page (ids). `None` = everything.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportSelection {
    pub classes: Vec<String>,
    pub teachers: Vec<String>,
    pub rooms: Vec<String>,
    pub master: bool,
}

impl ExportSelection {
    pub fn everything(s: &SchoolSetup) -> Self {
        ExportSelection {
            classes: s.master.classes.iter().map(|x| x.id.clone()).collect(),
            teachers: s.master.teachers.iter().map(|x| x.id.clone()).collect(),
            rooms: s.master.rooms.iter().map(|x| x.id.clone()).collect(),
            master: true,
        }
    }
    fn is_empty(&self) -> bool {
        self.classes.is_empty() && self.teachers.is_empty() && self.rooms.is_empty() && !self.master
    }
}

/// "Mon" from "Monday".
fn short_day(name: &str) -> String {
    name.chars().take(3).collect()
}

/// The bell times of period `p` (0-based): the first working day's, then any day that differs,
/// for example "08:00–08:40" and "Fri 08:00–08:35".
fn period_times(s: &SchoolSetup, sh: &Shift, days: &[usize], p: usize) -> Vec<String> {
    let at = |d: usize| sh.days[d].get(p).map(|t| format!("{}–{}", t.start, t.end));
    let Some(first) = days.iter().find_map(|&d| at(d)) else { return vec![] };
    let mut out = vec![first.clone()];
    for &d in days {
        if let Some(t) = at(d).filter(|t| *t != first) {
            out.push(format!("{} {t}", short_day(&s.days[d].name)));
        }
    }
    out
}

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
        // Periods count from 1 and a session lasts at least one period; a damaged file may say otherwise.
        if pc.period == 0 || pc.length == 0 {
            continue;
        }
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
/// `all` is every class name: "Grade 6 A" must not count as part of a class called "Grade 6",
/// so the longest class name that fits the written text wins.
fn class_matches(written: &str, class: &str, all: &[String]) -> bool {
    let fits = |c: &str| written == c || written.strip_prefix(c).map_or(false, |rest| rest.starts_with(' '));
    fits(class) && !all.iter().any(|o| o.len() > class.len() && fits(o))
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
            let times = period_times(self.s, sh, &days, p);
            let side_text = std::iter::once((p + 1).to_string()).chain(times.iter().cloned()).collect::<Vec<_>>().join("\n");
            x(ws.write_string_with_format(r, 0, side_text, &side))?;
            ws.set_row_height(r, 44f64.max(15.0 * (times.len() + 1) as f64)).map_err(|e| e.to_string())?;
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
            ws.set_column_width(c, if c == 0 { 17 } else { 24 }).map_err(|e| e.to_string())?;
        }
        Ok(top + 2 + periods as u32 + 2)
    }
}

/// The class, teacher and room timetables chosen, in the order of the lists, with the shifts each
/// one has lessons in: (kind 0 class / 1 teacher / 2 room, name, shifts).
fn chosen(s: &SchoolSetup, sel: &ExportSelection) -> Vec<(u8, String, Vec<usize>)> {
    let m = &s.master;
    let on = |i: usize| s.shifts[i].enabled;
    let mut out = Vec::new();
    for c in m.classes.iter().filter(|c| sel.classes.contains(&c.id)) {
        out.push((0, c.name.trim().to_string(), s.shifts.iter().position(|x| x.id == c.shift).filter(|&i| on(i)).into_iter().collect()));
    }
    for t in m.teachers.iter().filter(|t| sel.teachers.contains(&t.id)) {
        out.push((1, t.name.trim().to_string(), (0..s.shifts.len()).filter(|&i| on(i) && t.shifts.contains(&s.shifts[i].id)).collect()));
    }
    for r in m.rooms.iter().filter(|r| sel.rooms.contains(&r.id)) {
        out.push((2, r.name.trim().to_string(), (0..s.shifts.len()).filter(|&i| on(i)).collect()));
    }
    out
}

fn belongs(kind: u8, name: &str, q: &SessionRow, class_names: &[String]) -> bool {
    match kind {
        0 => q.classes.iter().any(|c| class_matches(c, name, class_names)),
        1 => q.teachers.iter().any(|t| t == name),
        _ => q.room.as_deref() == Some(name),
    }
}

fn cell_label(kind: u8, q: &SessionRow, sep: &str) -> String {
    let room = q.room.as_ref().map_or(String::new(), |r| format!(" · {r}"));
    match kind {
        0 => format!("{}{sep}{}{room}", q.subject, q.teachers.join(", ")),
        1 => format!("{}{sep}{}{room}", q.subject, q.classes.join(", ")),
        _ => format!("{}{sep}{} · {}", q.subject, q.classes.join(", "), q.teachers.join(", ")),
    }
}

/// The chosen timetables as one CSV file: a block per class, teacher or room (and shift), and the
/// master timetable, each with a title row, a header row and one row per period with its times.
/// UTF-8 with a byte-order mark so Excel shows accents correctly.
pub fn timetables_csv(s: &SchoolSetup, sel: &ExportSelection) -> Result<String, String> {
    let rows = session_rows(s);
    if rows.is_empty() {
        return Err("There is no timetable to export yet. Build one first.".into());
    }
    if sel.is_empty() {
        return Err("Nothing is chosen. Tick something under \"What to print\".".into());
    }
    let class_names: Vec<String> = s.master.classes.iter().map(|c| c.name.trim().to_string()).collect();
    let days: Vec<usize> = (0..7).filter(|&d| s.days[d].working).collect();
    let mut w = csv::WriterBuilder::new().flexible(true).from_writer(Vec::new());
    let mut put = |rec: Vec<String>| w.write_record(&rec).map_err(|e| e.to_string());
    let kinds = ["Class", "Teacher", "Room"];
    let mut any = false;
    for (kind, name, shifts) in chosen(s, sel) {
        for sh in shifts {
            let shift = &s.shifts[sh];
            if !rows.iter().any(|q| q.shift == shift.name && belongs(kind, &name, q, &class_names)) {
                continue;
            }
            any = true;
            put(vec![format!("{}: {name}", kinds[kind as usize]), format!("{} shift", shift.name)])?;
            put(["Period".to_string(), "Time".to_string()].into_iter().chain(days.iter().map(|&d| s.days[d].name.clone())).collect())?;
            let periods = days.iter().map(|&d| shift.days[d].len()).max().unwrap_or(0);
            for p in 0..periods {
                let mut rec = vec![(p + 1).to_string(), period_times(s, shift, &days, p).join("; ")];
                for &d in &days {
                    if p >= shift.days[d].len() {
                        rec.push("-".into());
                        continue;
                    }
                    let here: Vec<String> = rows
                        .iter()
                        .filter(|q| q.day == d && q.shift == shift.name && belongs(kind, &name, q, &class_names) && (p as u8 + 1) >= q.period && (p as u8 + 1) < q.period + q.length as u8)
                        .map(|q| if q.period as usize == p + 1 { cell_label(kind, q, " · ") } else { format!("{} (continued)", q.subject) })
                        .collect();
                    rec.push(here.join(" / "));
                }
                put(rec)?;
            }
            put(vec![String::new()])?;
        }
    }
    if sel.master {
        for sh in (0..s.shifts.len()).filter(|&i| s.shifts[i].enabled) {
            let shift = &s.shifts[sh];
            let classes: Vec<&crate::master::Class> = s.master.classes.iter().filter(|c| c.shift == shift.id).collect();
            if classes.is_empty() {
                continue;
            }
            any = true;
            put(vec!["Master timetable".into(), format!("{} shift", shift.name)])?;
            let mut head = vec!["Class".to_string()];
            let mut times = vec!["Time".to_string()];
            for &d in &days {
                for (p, t) in shift.days[d].iter().enumerate() {
                    head.push(format!("{} {}", short_day(&s.days[d].name), p + 1));
                    times.push(format!("{}–{}", t.start, t.end));
                }
            }
            put(head)?;
            put(times)?;
            for c in classes {
                let mut rec = vec![c.short_name.trim().to_string()];
                for &d in &days {
                    for p in 0..shift.days[d].len() {
                        let here: Vec<String> = rows
                            .iter()
                            .filter(|q| q.day == d && q.shift == shift.name && q.classes.iter().any(|n| class_matches(n, c.name.trim(), &class_names)) && (p as u8 + 1) >= q.period && (p as u8 + 1) < q.period + q.length as u8)
                            .map(|q| format!("{} {}", q.subject_short, q.teacher_shorts.join("/")))
                            .collect();
                        rec.push(here.join(" / "));
                    }
                }
                put(rec)?;
            }
            put(vec![String::new()])?;
        }
    }
    if !any {
        return Err("The chosen timetables have no lessons yet.".into());
    }
    let bytes = w.into_inner().map_err(|e| e.to_string())?;
    // The CSV writer marks a row with one empty cell as `""`; between blocks a plain empty line reads better.
    let text: Vec<&str> = std::str::from_utf8(&bytes).map_err(|e| e.to_string())?.split('\n').map(|l| if l == "\"\"" { "" } else { l }).collect();
    Ok(format!("\u{FEFF}{}", text.join("\n")))
}

pub fn write_excel(s: &SchoolSetup, path: &std::path::Path, sel: &ExportSelection) -> Result<(), String> {
    let rows = session_rows(s);
    if rows.is_empty() {
        return Err("There is no timetable to export yet. Build one first.".into());
    }
    if sel.is_empty() {
        return Err("Nothing is chosen. Tick something under \"What to print\".".into());
    }
    let g = Grid { s, rows: &rows };
    let class_names: Vec<String> = s.master.classes.iter().map(|c| c.name.trim().to_string()).collect();
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

    // Master: one row per class, a column per day and period (with its times).
    if sel.master {
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
                    let t = &sh.days[d][p as usize];
                    x(ws.write_string_with_format(top + 2, col + p, format!("{}\n{}–{}", p + 1, t.start, t.end), &head.clone().set_text_wrap()))?;
                    x(ws.set_column_width(col + p, 12))?;
                }
                col += n;
            }
            x(ws.write_string_with_format(top + 2, 0, "", &head))?;
            x(ws.set_row_height(top + 2, 30))?;
            let mut r = top + 3;
            for c in m.classes.iter().filter(|c| c.shift == sh.id) {
                x(ws.write_string_with_format(r, 0, &c.short_name, &Format::new().set_bold().set_border(FormatBorder::Thin)))?;
                let mut col = 1u16;
                for &d in &days {
                    for p in 0..sh.days[d].len() {
                        let here: Vec<&SessionRow> = rows.iter().filter(|q| q.day == d && q.shift == sh.name && q.classes.iter().any(|n| class_matches(n, c.name.trim(), &class_names)) && (p as u8 + 1) >= q.period && (p as u8 + 1) < q.period + q.length as u8).collect();
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

    // One sheet each for the chosen classes, teachers and rooms, a block per name.
    let picked = chosen(s, sel);
    for (sheet, kind) in [("Classes", 0u8), ("Teachers", 1), ("Rooms", 2)] {
        let names: Vec<&(u8, String, Vec<usize>)> = picked.iter().filter(|(k, name, _)| *k == kind && rows.iter().any(|q| belongs(kind, name, q, &class_names))).collect();
        if names.is_empty() {
            continue;
        }
        let ws = wb.add_worksheet();
        x(ws.set_name(sheet))?;
        let mut top = 0u32;
        for (_, name, shifts) in names {
            let mine = |q: &SessionRow| belongs(kind, name, q, &class_names);
            let label = |q: &SessionRow| cell_label(kind, q, "\n");
            for &sh in shifts {
                if rows.iter().any(|q| q.shift == s.shifts[sh].name && mine(q)) {
                    top = g.block(ws, top, name, sh, &mine, &label)?;
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
    fn a_class_called_grade_6_does_not_take_over_grade_6_a() {
        let all = vec!["Grade 6".to_string(), "Grade 6 A".to_string()];
        assert!(class_matches("Grade 6", "Grade 6", &all));
        assert!(!class_matches("Grade 6 A", "Grade 6", &all));
        assert!(class_matches("Grade 6 A", "Grade 6 A", &all));
        // a group name after the class still belongs to the class
        assert!(class_matches("Grade 6 A Boys", "Grade 6 A", &all));
        assert!(!class_matches("Grade 6 A Boys", "Grade 6", &all));
        // without a longer class in the way the group still belongs to "Grade 6"
        assert!(class_matches("Grade 6 Boys", "Grade 6", &all));
    }

    #[test]
    fn a_damaged_file_with_period_zero_is_skipped_not_a_crash() {
        let mut s = built();
        let n = session_rows(&s).len();
        s.timetable.as_mut().unwrap().cards[0].period = 0;
        s.timetable.as_mut().unwrap().cards[1].length = 0;
        assert_eq!(session_rows(&s).len(), n - 2);
        let f = std::env::temp_dir().join(format!("tw-damaged-{}.xlsx", std::process::id()));
        write_excel(&s, &f, &ExportSelection::everything(&s)).unwrap(); // must not panic either
        let _ = std::fs::remove_file(&f);
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

    /// The sample school with an earlier Friday (period 1 starts at 07:30).
    fn built_with_short_friday() -> SchoolSetup {
        let mut s = built();
        let fri = &mut s.shifts[0].days[4][0];
        fri.start = "07:30".into();
        fri.end = "08:05".into();
        s
    }
    fn only_class(s: &SchoolSetup, name: &str) -> ExportSelection {
        ExportSelection { classes: vec![s.master.classes.iter().find(|c| c.name == name).unwrap().id.clone()], ..Default::default() }
    }

    #[test]
    fn timetables_csv_has_a_block_per_timetable_with_each_days_times() {
        let s = built_with_short_friday();
        let text = timetables_csv(&s, &only_class(&s, "Grade 6 A")).unwrap();
        assert!(text.starts_with('\u{FEFF}'));
        let lines: Vec<&str> = text.trim_start_matches('\u{FEFF}').lines().collect();
        assert_eq!(lines[0], "Class: Grade 6 A,Morning shift");
        assert_eq!(lines[1], "Period,Time,Monday,Tuesday,Wednesday,Thursday,Friday");
        assert!(lines[2].starts_with("1,08:00–08:40; Fri 07:30–08:05,"), "{}", lines[2]);
        assert!(lines[3].starts_with("2,08:40–09:20,"), "{}", lines[3]);
        assert_eq!(lines.len(), 2 + 7 + 1, "title, header, 7 periods, a blank line");
        assert_eq!(lines[9], "", "an empty line between blocks");
        assert!(lines[8].ends_with(",-"), "Friday has 5 periods: {}", lines[8]);
        // every lesson of 6A is in the block: 27 sessions (the double counts once, plus its "continued")
        let cells: Vec<&str> = lines[2..9].iter().flat_map(|l| l.split(',').skip(2)).filter(|c| !c.is_empty() && *c != "-").collect();
        assert_eq!(cells.iter().filter(|c| !c.contains("(continued)")).count(), 27);
        assert_eq!(cells.iter().filter(|c| c.contains("(continued)")).count(), 1);
        assert!(!text.contains("Teacher:") && !text.contains("Master timetable"));

        // everything: teachers, rooms and the master timetable with its times
        let all = timetables_csv(&s, &ExportSelection::everything(&s)).unwrap();
        for want in ["Teacher: Bilal Ahmed,Morning shift", "Room: Computer Lab,Morning shift", "Master timetable,Morning shift", "Class,Mon 1,Mon 2,", "Time,08:00–08:40,08:40–09:20,"] {
            assert!(all.contains(want), "missing {want}");
        }
        assert!(all.contains(",07:30–08:05,"), "Friday's own time in the master header");
        assert!(all.lines().any(|l| l.starts_with("6A,") && l.contains("ENG ")));
        // nothing chosen
        assert!(timetables_csv(&s, &ExportSelection::default()).unwrap_err().contains("Nothing is chosen"));
    }

    #[test]
    fn excel_follows_the_selection_and_shows_each_days_times() {
        use calamine::{open_workbook, Reader, Xlsx};
        let s = built_with_short_friday();
        let p = std::env::temp_dir().join(format!("tw-export-sel-{}.xlsx", std::process::id()));
        write_excel(&s, &p, &only_class(&s, "Grade 6 A")).unwrap();
        let mut wb: Xlsx<_> = open_workbook(&p).unwrap();
        assert_eq!(wb.sheet_names(), vec!["Sessions", "Classes"]);
        let text: Vec<String> = wb.worksheet_range("Classes").unwrap().rows().flat_map(|r| r.iter().map(|c| c.to_string())).collect();
        assert!(text.iter().any(|t| t == "Grade 6 A · Morning shift"));
        assert!(!text.iter().any(|t| t.starts_with("Grade 6 B")));
        assert!(text.iter().any(|t| t == "1\n08:00–08:40\nFri 07:30–08:05"), "{text:?}");
        assert!(text.iter().any(|t| t == "2\n08:40–09:20"));
        // master only
        write_excel(&s, &p, &ExportSelection { master: true, ..Default::default() }).unwrap();
        let mut wb: Xlsx<_> = open_workbook(&p).unwrap();
        assert_eq!(wb.sheet_names(), vec!["Sessions", "Master"]);
        let m: Vec<String> = wb.worksheet_range("Master").unwrap().rows().flat_map(|r| r.iter().map(|c| c.to_string())).collect();
        assert!(m.iter().any(|t| t == "1\n08:00–08:40") && m.iter().any(|t| t == "1\n07:30–08:05"));
        assert!(write_excel(&s, &p, &ExportSelection::default()).unwrap_err().contains("Nothing is chosen"));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn nothing_to_export_before_a_timetable_exists() {
        let s = SchoolSetup::default_new("Empty");
        assert!(session_rows(&s).is_empty());
        let p = std::env::temp_dir().join(format!("tw-empty-{}.xlsx", std::process::id()));
        assert!(write_excel(&s, &p, &ExportSelection::everything(&s)).unwrap_err().contains("Build one first"));
        assert!(timetables_csv(&s, &ExportSelection::everything(&s)).unwrap_err().contains("Build one first"));
    }

    #[test]
    fn excel_has_all_sheets_and_the_timetable_in_them() {
        use calamine::{open_workbook, Reader, Xlsx};
        let s = built();
        let p = std::env::temp_dir().join(format!("tw-export-{}.xlsx", std::process::id()));
        write_excel(&s, &p, &ExportSelection::everything(&s)).unwrap();
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
