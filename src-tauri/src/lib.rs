mod check;
mod copy;
mod db;
mod export;
mod importer;
mod jobs;
mod lessons;
mod links;
mod master;
mod model;
mod settings;
mod solver;

use model::{Issue, SchoolSetup};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[cfg(feature = "uitest")]
pub mod bridge;

#[derive(Default)]
struct Current(Mutex<Option<PathBuf>>);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Opened {
    path: String,
    setup: SchoolSetup,
}

fn with_ext(path: String) -> PathBuf {
    let mut p = PathBuf::from(path);
    if p.extension().is_none() {
        p.set_extension("twz");
    }
    p
}

#[tauri::command]
fn create_school(path: String, name: String, cur: State<Current>) -> Result<Opened, String> {
    let p = with_ext(path);
    if p.exists() {
        std::fs::remove_file(&p).map_err(|e| format!("Could not replace the existing file: {e}"))?;
    }
    let setup = SchoolSetup::default_new(name.trim());
    db::save(&p, &setup)?;
    *cur.0.lock().unwrap() = Some(p.clone());
    Ok(Opened { path: p.to_string_lossy().into(), setup })
}

#[tauri::command]
fn open_school(path: String, cur: State<Current>) -> Result<Opened, String> {
    let p = PathBuf::from(path);
    let setup = db::load(&p)?;
    *cur.0.lock().unwrap() = Some(p.clone());
    Ok(Opened { path: p.to_string_lossy().into(), setup })
}

#[tauri::command]
fn save_school(setup: SchoolSetup, cur: State<Current>) -> Result<(), String> {
    let p = cur.0.lock().unwrap().clone().ok_or("No school is open.")?;
    db::save(&p, &setup)
}

/// Writes a copy to a new file and makes that file the current one.
#[tauri::command]
fn save_school_as(path: String, setup: SchoolSetup, cur: State<Current>) -> Result<String, String> {
    let p = with_ext(path);
    if p.exists() {
        std::fs::remove_file(&p).map_err(|e| format!("Could not replace the existing file: {e}"))?;
    }
    db::save(&p, &setup)?;
    *cur.0.lock().unwrap() = Some(p.clone());
    Ok(p.to_string_lossy().into())
}

#[tauri::command]
fn close_school(cur: State<Current>) {
    *cur.0.lock().unwrap() = None;
}

#[tauri::command]
fn validate_setup(setup: SchoolSetup) -> Vec<Issue> {
    setup.validate()
}

#[tauri::command]
fn lesson_loads(setup: SchoolSetup) -> lessons::LoadSummary {
    lessons::summarize(&setup)
}

#[tauri::command]
fn check_setup(setup: SchoolSetup) -> check::CheckReport {
    check::run(&setup)
}

struct TauriSink(AppHandle);

impl jobs::Sink for TauriSink {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        let _ = self.0.emit(event, payload);
    }
}

/// Starts building the timetable in the background (see `jobs`).
#[tauri::command]
fn start_generate(setup: SchoolSetup, app: AppHandle, jobs: State<jobs::Jobs>) -> Result<(), String> {
    jobs.start_generate(setup, Arc::new(TauriSink(app)))
}

/// Improves the quality of the current timetable in the background (see `jobs`).
#[tauri::command]
fn start_improve(setup: SchoolSetup, app: AppHandle, jobs: State<jobs::Jobs>) -> Result<(), String> {
    jobs.start_improve(setup, Arc::new(TauriSink(app)))
}

#[tauri::command]
fn slot_options(setup: SchoolSetup, lesson_id: String, number: u32) -> Result<Vec<solver::edit::SlotInfo>, String> {
    solver::edit::slot_options(&setup, &lesson_id, number)
}

#[tauri::command]
fn move_card(setup: SchoolSetup, lesson_id: String, number: u32, day: u8, period: u8, room: Option<String>) -> Result<solver::Timetable, String> {
    solver::edit::move_card(&setup, &lesson_id, number, day, period, room)
}

#[tauri::command]
fn swap_options(setup: SchoolSetup, lesson_id: String, number: u32) -> Result<Vec<solver::edit::SwapInfo>, String> {
    solver::edit::swap_options(&setup, &lesson_id, number)
}

#[tauri::command]
fn swap_cards(setup: SchoolSetup, lesson_id: String, number: u32, with_lesson: String, with_number: u32) -> Result<solver::Timetable, String> {
    solver::edit::swap_cards(&setup, &lesson_id, number, &with_lesson, with_number)
}

#[tauri::command]
fn timetable_consistent(setup: SchoolSetup) -> bool {
    solver::edit::is_consistent(&setup)
}

#[tauri::command]
fn plan_copy_lessons(setup: SchoolSetup, source: String, targets: Vec<String>, copy_teachers: bool) -> Result<copy::CopyPlan, String> {
    copy::plan(&setup, &source, &targets, copy_teachers)
}

#[tauri::command]
fn export_csv(setup: SchoolSetup, path: String) -> Result<(), String> {
    if setup.timetable.as_ref().map_or(true, |t| t.cards.is_empty()) {
        return Err("There is no timetable to export yet. Build one first.".into());
    }
    std::fs::write(&path, export::csv_text(&setup)?).map_err(|e| format!("Could not save the file: {e}"))
}

#[tauri::command]
fn export_excel(setup: SchoolSetup, path: String) -> Result<(), String> {
    export::write_excel(&setup, std::path::Path::new(&path))
}

/// Saves a file the front end made (PDF, PNG). The bytes arrive as base64 text.
#[tauri::command]
fn write_file(path: String, data_base64: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data_base64).map_err(|e| format!("Could not read the file data: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("Could not save the file: {e}"))
}

/// Reads a file (a logo picture) and returns it as base64 text.
#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    use base64::Engine;
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not open the file: {e}"))?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("That picture is too large (more than 8 MB).".into());
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn cancel_generate(jobs: State<jobs::Jobs>) {
    jobs.cancel();
}

/// Reads an Excel/CSV file and adds its rows to the setup (nothing is saved yet).
#[tauri::command]
fn import_file(path: String, kind: Option<String>, setup: SchoolSetup) -> Result<importer::ImportReport, String> {
    let tables = importer::read_file(std::path::Path::new(&path), kind.as_deref())?;
    Ok(importer::apply(setup, tables))
}

#[tauri::command]
fn write_template(path: String, kind: Option<String>) -> Result<(), String> {
    match kind {
        Some(k) if importer::KINDS.contains(&k.as_str()) => {
            std::fs::write(&path, importer::csv_template(&k)).map_err(|e| format!("Could not save the template: {e}"))
        }
        _ => importer::write_xlsx_template(std::path::Path::new(&path)),
    }
}

/// The school file this program was started with (double-clicking a .twz file in the file
/// manager passes its path as the first argument), if any.
pub fn startup_file_from(args: impl IntoIterator<Item = String>) -> Option<String> {
    args.into_iter()
        .skip(1)
        .find(|a| a.to_lowercase().ends_with(".twz") && std::path::Path::new(a).is_file())
}

#[tauri::command]
fn startup_file() -> Option<String> {
    startup_file_from(std::env::args())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Current::default())
        .manage(jobs::Jobs::default())
        .invoke_handler(tauri::generate_handler![
            create_school,
            open_school,
            save_school,
            save_school_as,
            close_school,
            validate_setup,
            lesson_loads,
            check_setup,
            start_generate,
            start_improve,
            cancel_generate,
            export_csv,
            export_excel,
            write_file,
            read_file_base64,
            plan_copy_lessons,
            slot_options,
            move_card,
            swap_options,
            swap_cards,
            timetable_consistent,
            import_file,
            write_template,
            startup_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Timewizer");
}

#[cfg(test)]
mod startup_tests {
    use super::startup_file_from;

    #[test]
    fn finds_the_school_file_argument() {
        let dir = std::env::temp_dir().join(format!("tw-startup-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("School.TWZ");
        std::fs::write(&f, b"x").unwrap();
        let f = f.to_string_lossy().to_string();
        assert_eq!(startup_file_from(["timewizer".into(), f.clone()]), Some(f));
        assert_eq!(startup_file_from(["timewizer".into()]), None);
        assert_eq!(startup_file_from(["timewizer".into(), "missing.twz".into()]), None);
        assert_eq!(startup_file_from(["timewizer".into(), "notes.txt".into()]), None);
    }
}
