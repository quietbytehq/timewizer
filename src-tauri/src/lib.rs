mod access;
mod backup;
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
mod substitutions;
#[cfg(any(test, feature = "uitest"))]
pub mod stress;

use model::{Issue, SchoolSetup};
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::Arc;
use access::Approved;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

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

// Commands that do real work (or carry the whole school across) are marked `async`: Tauri then runs
// them on a worker thread. A plain command runs on the thread that draws the window, so on a large
// school it froze the screen (and a drag in progress) for as long as it took.
#[tauri::command(async)]
fn create_school(path: String, name: String, cur: State<Current>, ok: State<Approved>) -> Result<Opened, String> {
    let p = with_ext(ok.check(&path)?.to_string_lossy().into());
    if p.exists() {
        std::fs::remove_file(&p).map_err(|e| format!("Could not replace the existing file: {e}"))?;
    }
    let setup = SchoolSetup::default_new(name.trim());
    db::save(&p, &setup)?;
    *cur.0.lock().unwrap() = Some(p.clone());
    Ok(Opened { path: p.to_string_lossy().into(), setup })
}

#[tauri::command(async)]
fn open_school(path: String, cur: State<Current>, ok: State<Approved>) -> Result<Opened, String> {
    let p = ok.check(&path)?;
    let setup = db::load(&p)?;
    *cur.0.lock().unwrap() = Some(p.clone());
    Ok(Opened { path: p.to_string_lossy().into(), setup })
}

/// Saves the school, then makes the automatic backup if it is switched on. `stamp` is the local
/// date and time for the backup's name (see `backup`).
#[tauri::command(async)]
fn save_school(setup: SchoolSetup, stamp: Option<String>, cur: State<Current>, prefs: State<backup::PrefsStore>) -> Result<backup::SaveOutcome, String> {
    let p = cur.0.lock().unwrap().clone().ok_or("No school is open.")?;
    db::save(&p, &setup)?;
    Ok(prefs.after_save(&p, &setup, stamp.as_deref()))
}

/// Writes a copy to a new file and makes that file the current one.
#[tauri::command(async)]
fn save_school_as(path: String, setup: SchoolSetup, stamp: Option<String>, cur: State<Current>, ok: State<Approved>, prefs: State<backup::PrefsStore>) -> Result<backup::SaveOutcome, String> {
    let p = with_ext(ok.check(&path)?.to_string_lossy().into());
    if p.exists() {
        std::fs::remove_file(&p).map_err(|e| format!("Could not replace the existing file: {e}"))?;
    }
    db::save(&p, &setup)?;
    *cur.0.lock().unwrap() = Some(p.clone());
    Ok(prefs.after_save(&p, &setup, stamp.as_deref()))
}

#[tauri::command(async)]
fn get_preferences(prefs: State<backup::PrefsStore>) -> backup::Preferences {
    prefs.get()
}

#[tauri::command(async)]
fn set_backup_prefs(backup: backup::BackupPrefs, prefs: State<backup::PrefsStore>, ok: State<Approved>) -> Result<backup::Preferences, String> {
    prefs.set_backup(backup, |f| ok.folder_allowed(f))
}

#[tauri::command(async)]
fn set_splash(on: bool, prefs: State<backup::PrefsStore>) -> Result<backup::Preferences, String> {
    prefs.set_splash(on)
}

#[tauri::command(async)]
fn back_up_now(setup: SchoolSetup, stamp: String, cur: State<Current>, prefs: State<backup::PrefsStore>) -> Result<String, String> {
    let current = cur.0.lock().unwrap().clone();
    prefs.back_up_now(current.as_deref(), &setup, &stamp)
}

#[tauri::command(async)]
fn list_backups(prefs: State<backup::PrefsStore>) -> Result<Vec<backup::BackupEntry>, String> {
    prefs.list()
}

/// Copies a backup to a new file (chosen in a save dialog), and opens that new file.
#[tauri::command(async)]
fn restore_backup(backup: String, path: String, cur: State<Current>, ok: State<Approved>, prefs: State<backup::PrefsStore>) -> Result<Opened, String> {
    let target = with_ext(ok.check(&path)?.to_string_lossy().into());
    let current = cur.0.lock().unwrap().clone();
    let setup = prefs.restore(std::path::Path::new(&backup), &target, current.as_deref())?;
    *cur.0.lock().unwrap() = Some(target.clone());
    Ok(Opened { path: target.to_string_lossy().into(), setup })
}

#[tauri::command]
fn close_school(cur: State<Current>) {
    *cur.0.lock().unwrap() = None;
}

#[tauri::command(async)]
fn validate_setup(setup: SchoolSetup) -> Vec<Issue> {
    setup.validate()
}

#[tauri::command(async)]
fn lesson_loads(setup: SchoolSetup) -> lessons::LoadSummary {
    lessons::summarize(&setup)
}

#[tauri::command(async)]
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
#[tauri::command(async)]
fn start_generate(setup: SchoolSetup, app: AppHandle, jobs: State<jobs::Jobs>) -> Result<(), String> {
    jobs.start_generate(setup, Arc::new(TauriSink(app)))
}

/// Improves the quality of the current timetable in the background (see `jobs`).
#[tauri::command(async)]
fn start_improve(setup: SchoolSetup, app: AppHandle, jobs: State<jobs::Jobs>) -> Result<(), String> {
    jobs.start_improve(setup, Arc::new(TauriSink(app)))
}

#[tauri::command(async)]
fn slot_options(setup: SchoolSetup, lesson_id: String, number: u32) -> Result<Vec<solver::edit::SlotInfo>, String> {
    solver::edit::slot_options(&setup, &lesson_id, number)
}

#[tauri::command(async)]
fn move_card(setup: SchoolSetup, lesson_id: String, number: u32, day: u8, period: u8, room: Option<String>) -> Result<solver::Timetable, String> {
    solver::edit::move_card(&setup, &lesson_id, number, day, period, room)
}

#[tauri::command(async)]
fn swap_options(setup: SchoolSetup, lesson_id: String, number: u32) -> Result<Vec<solver::edit::SwapInfo>, String> {
    solver::edit::swap_options(&setup, &lesson_id, number)
}

#[tauri::command(async)]
fn swap_cards(setup: SchoolSetup, lesson_id: String, number: u32, with_lesson: String, with_number: u32) -> Result<solver::Timetable, String> {
    solver::edit::swap_cards(&setup, &lesson_id, number, &with_lesson, with_number)
}

#[tauri::command(async)]
fn timetable_consistent(setup: SchoolSetup) -> bool {
    solver::edit::is_consistent(&setup)
}

#[tauri::command(async)]
fn plan_copy_lessons(setup: SchoolSetup, source: String, targets: Vec<String>, copy_teachers: bool) -> Result<copy::CopyPlan, String> {
    copy::plan(&setup, &source, &targets, copy_teachers)
}

#[tauri::command(async)]
fn export_csv(setup: SchoolSetup, path: String, ok: State<Approved>) -> Result<(), String> {
    let path = ok.check(&path)?;
    if setup.timetable.as_ref().map_or(true, |t| t.cards.is_empty()) {
        return Err("There is no timetable to export yet. Build one first.".into());
    }
    std::fs::write(&path, export::csv_text(&setup)?).map_err(|e| format!("Could not save the file: {e}"))
}

#[tauri::command(async)]
fn cover_day(setup: SchoolSetup, date: String) -> Result<substitutions::CoverDay, String> {
    substitutions::cover_day(&setup, &date)
}

#[tauri::command(async)]
fn cover_counts(setup: SchoolSetup) -> substitutions::CoverCounts {
    substitutions::cover_counts(&setup)
}

#[tauri::command(async)]
fn reset_cover_counts(setup: SchoolSetup, today: String) -> Result<substitutions::Substitutions, String> {
    substitutions::parse_date(&today).ok_or("That is not a date.")?;
    let mut sub = setup.substitutions;
    substitutions::reset_counts(&mut sub, &today, &setup.academic_year);
    Ok(sub)
}

#[tauri::command(async)]
fn check_absence(setup: SchoolSetup, absence: substitutions::Absence) -> Result<(), String> {
    substitutions::check_absence(&setup, &absence)
}

#[tauri::command(async)]
fn cover_sheet(setup: SchoolSetup, from: String, to: String) -> Result<Vec<substitutions::SheetDay>, String> {
    substitutions::cover_sheet(&setup, &from, &to)
}

#[tauri::command(async)]
fn export_cover_csv(setup: SchoolSetup, from: String, to: String, path: String, ok: State<Approved>) -> Result<(), String> {
    let path = ok.check(&path)?;
    std::fs::write(&path, substitutions::cover_sheet_csv(&setup, &from, &to)?).map_err(|e| format!("Could not save the file: {e}"))
}

/// `selection`: what is ticked on the Print & export page (`None` = everything).
#[tauri::command(async)]
fn export_excel(setup: SchoolSetup, path: String, selection: Option<export::ExportSelection>, ok: State<Approved>) -> Result<(), String> {
    let sel = selection.unwrap_or_else(|| export::ExportSelection::everything(&setup));
    export::write_excel(&setup, &ok.check(&path)?, &sel)
}

/// The chosen class, teacher, room and master timetables as one CSV file.
#[tauri::command(async)]
fn export_timetables_csv(setup: SchoolSetup, path: String, selection: Option<export::ExportSelection>, ok: State<Approved>) -> Result<(), String> {
    let path = ok.check(&path)?;
    let sel = selection.unwrap_or_else(|| export::ExportSelection::everything(&setup));
    std::fs::write(&path, export::timetables_csv(&setup, &sel)?).map_err(|e| format!("Could not save the file: {e}"))
}

/// Saves a file the front end made (PDF, PNG). The bytes arrive as base64 text.
#[tauri::command(async)]
fn write_file(path: String, data_base64: String, ok: State<Approved>) -> Result<(), String> {
    use base64::Engine;
    let path = ok.check(&path)?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data_base64).map_err(|e| format!("Could not read the file data: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("Could not save the file: {e}"))
}

/// Reads a file (a logo picture) and returns it as base64 text.
#[tauri::command(async)]
fn read_file_base64(path: String, ok: State<Approved>) -> Result<String, String> {
    use base64::Engine;
    let path = ok.check(&path)?;
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
#[tauri::command(async)]
fn import_file(path: String, kind: Option<String>, setup: SchoolSetup, ok: State<Approved>) -> Result<importer::ImportReport, String> {
    let tables = importer::read_file(&ok.check(&path)?, kind.as_deref())?;
    Ok(importer::apply(setup, tables))
}

#[tauri::command(async)]
fn write_template(path: String, kind: Option<String>, ok: State<Approved>) -> Result<(), String> {
    let path = ok.check(&path)?;
    match kind {
        Some(k) if importer::KINDS.contains(&k.as_str()) => {
            std::fs::write(&path, importer::csv_template(&k)).map_err(|e| format!("Could not save the template: {e}"))
        }
        _ => importer::write_xlsx_template(&path),
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
fn startup_file(ok: State<Approved>) -> Option<String> {
    let f = startup_file_from(std::env::args())?;
    ok.allow_file(&f); // the person opened it from the file manager
    Some(f)
}

/// Shows the system "open" dialog. Only paths chosen here can be used later (see `access`).
/// `what`: "school", "import", "picture" or "folder". An empty list means cancelled.
#[tauri::command]
async fn pick_open(what: String, app: AppHandle, ok: State<'_, Approved>) -> Result<Vec<String>, String> {
    let d = app.dialog().file();
    let d = match what.as_str() {
        "school" => d.set_title("Open a school").add_filter("Timewizer school", &["twz"]),
        "import" => d.set_title("Choose files to import").add_filter("Excel or CSV", &["xlsx", "xlsm", "xls", "csv"]),
        "picture" => d.set_title("Choose your school logo").add_filter("Pictures", &["png", "jpg", "jpeg", "gif", "webp", "svg"]),
        "folder" => d.set_title("Choose a folder for the pictures"),
        _ => return Err("Unknown kind of file.".into()),
    };
    let picked: Vec<PathBuf> = if what == "folder" {
        d.blocking_pick_folder().into_iter().filter_map(|p| p.into_path().ok()).collect()
    } else if what == "import" {
        d.blocking_pick_files().unwrap_or_default().into_iter().filter_map(|p| p.into_path().ok()).collect()
    } else {
        d.blocking_pick_file().into_iter().filter_map(|p| p.into_path().ok()).collect()
    };
    for p in &picked {
        if what == "folder" { ok.allow_folder(p) } else { ok.allow_file(p) }
    }
    Ok(picked.iter().map(|p| p.to_string_lossy().into_owned()).collect())
}

/// Shows the system "save" dialog and remembers the chosen path. `None` means cancelled.
#[tauri::command]
async fn pick_save(title: String, default_name: String, label: String, ext: String, app: AppHandle, ok: State<'_, Approved>) -> Result<Option<String>, String> {
    let picked = app.dialog().file().set_title(title).set_file_name(default_name).add_filter(label, &[ext.as_str()]).blocking_save_file();
    let Some(p) = picked.and_then(|p| p.into_path().ok()) else { return Ok(None) };
    ok.allow_file(&p);
    Ok(Some(p.to_string_lossy().into_owned()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Current::default())
        .manage(Approved::default())
        .manage(jobs::Jobs::default())
        .setup(|app| {
            // This computer's preferences (the backup folder): kept with the program's settings,
            // not in any school file.
            let dir = app.path().app_config_dir().unwrap_or_else(|_| std::env::temp_dir().join("timewizer"));
            app.manage(backup::PrefsStore::new(dir.join("preferences.json")));
            Ok(())
        })
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
            export_timetables_csv,
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
            startup_file,
            pick_open,
            pick_save,
            get_preferences,
            set_backup_prefs,
            set_splash,
            back_up_now,
            list_backups,
            restore_backup,
            cover_day,
            cover_counts,
            check_absence,
            reset_cover_counts,
            cover_sheet,
            export_cover_csv
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
