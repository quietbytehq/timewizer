//! Backups: copies of the school file in a folder the person chooses (a USB stick, a network
//! drive, or a folder that a cloud service keeps in sync; Timewizer itself never goes online).
//!
//! A backup is a normal school file named `<school file name> backup <date and time>.twz`, so it
//! can also be opened by hand. Only files with exactly that kind of name are ever listed or
//! removed; anything else in the folder is left alone.
//!
//! The backup settings belong to this computer (the folder only exists here), so they are kept in
//! the program's own preferences file, not in the school file.
use crate::model::SchoolSetup;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const DEFAULT_KEEP: u32 = 10;
pub const MAX_KEEP: u32 = 999;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct BackupPrefs {
    /// The chosen folder, if any.
    pub folder: Option<String>,
    /// Make a backup every time the school is saved.
    pub auto: bool,
    /// How many backups of each school to keep (older ones are removed).
    pub keep: u32,
}

impl Default for BackupPrefs {
    fn default() -> Self {
        BackupPrefs { folder: None, auto: false, keep: DEFAULT_KEEP }
    }
}

/// This computer's preferences for the program (not part of any school file).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    pub backup: BackupPrefs,
    /// Show the short animation when the program starts.
    pub splash: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Preferences { backup: BackupPrefs::default(), splash: true }
    }
}

/// Reads the preferences file. A missing or unreadable file gives the defaults: preferences are
/// a convenience and must never stop the program from starting.
pub fn load_prefs(file: &Path) -> Preferences {
    let mut p: Preferences = std::fs::read_to_string(file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    p.backup.keep = p.backup.keep.clamp(1, MAX_KEEP);
    p
}

pub fn save_prefs(file: &Path, p: &Preferences) -> Result<(), String> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Could not save your preferences: {e}"))?;
    }
    let text = serde_json::to_string_pretty(p).map_err(|e| e.to_string())?;
    std::fs::write(file, text).map_err(|e| format!("Could not save your preferences: {e}"))
}

/// Checks that the backup folder is there and that files can be saved in it.
pub fn check_folder(folder: &Path) -> Result<(), String> {
    let shown = folder.display();
    if !folder.exists() {
        return Err(format!(
            "The backup folder \"{shown}\" could not be found. If it is on a USB stick or a network drive, connect it and try again. Otherwise choose the backup folder again."
        ));
    }
    if !folder.is_dir() {
        return Err(format!("The backup folder \"{shown}\" is not a folder. Please choose the backup folder again."));
    }
    let probe = folder.join(format!(".timewizer-write-test-{}", std::process::id()));
    match std::fs::write(&probe, b"test") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            Ok(())
        }
        Err(_) => Err(format!(
            "Timewizer is not allowed to save files in the backup folder \"{shown}\". Check that the folder is not read-only, or choose another folder."
        )),
    }
}

/// "2026-10-23 14-05-09": the local date and time, made by the front end (which knows the
/// computer's time zone). Dashes instead of colons, because Windows does not allow colons.
fn valid_stamp(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 19
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 | 13 | 16 => *c == b'-',
            10 => *c == b' ',
            _ => c.is_ascii_digit(),
        })
}

const MARK: &str = " backup ";

/// The school file's name without ".twz" (the backups are named after it).
pub fn school_stem(school_file: &Path) -> String {
    school_file.file_stem().map(|s| s.to_string_lossy().into_owned()).filter(|s| !s.trim().is_empty()).unwrap_or_else(|| "School".into())
}

/// Splits "<school> backup <stamp>[ (n)].twz" into (school, stamp, n). Anything else is not ours.
fn parse_name(file_name: &str) -> Option<(String, String, u32)> {
    let base = file_name.strip_suffix(".twz")?;
    let (base, n) = match base.strip_suffix(')').and_then(|b| b.rsplit_once(" (")) {
        Some((b, n)) => (b, n.parse::<u32>().ok().filter(|n| *n >= 2)?),
        None => (base, 1),
    };
    if base.len() < 19 + MARK.len() || !base.is_char_boundary(base.len() - 19) {
        return None;
    }
    let (rest, stamp) = base.split_at(base.len() - 19);
    let school = rest.strip_suffix(MARK)?;
    (valid_stamp(stamp) && !school.is_empty()).then(|| (school.to_string(), stamp.to_string(), n))
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub path: String,
    pub file_name: String,
    /// The school file the backup was made from (without ".twz").
    pub school: String,
    /// "2026-10-23 14:05:09"
    pub when: String,
    pub bytes: u64,
}

/// The backups in the folder, newest first.
pub fn list(folder: &Path) -> Result<Vec<BackupEntry>, String> {
    check_folder(folder)?;
    let rd = std::fs::read_dir(folder).map_err(|e| format!("Could not look inside the backup folder: {e}"))?;
    let mut out: Vec<(String, u32, BackupEntry)> = Vec::new();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some((school, stamp, n)) = parse_name(&name) else { continue };
        let Ok(meta) = e.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let when = format!("{} {}", &stamp[..10], stamp[11..].replace('-', ":"));
        out.push((stamp, n, BackupEntry { path: e.path().to_string_lossy().into_owned(), file_name: name, school, when, bytes: meta.len() }));
    }
    out.sort_by(|a, b| (&b.0, b.1, &a.2.school).cmp(&(&a.0, a.1, &b.2.school)));
    Ok(out.into_iter().map(|x| x.2).collect())
}

/// Saves a backup of `setup` (named after `school_file`) in `folder`, then removes the oldest
/// backups of that school beyond `keep`. Returns the new backup's path.
pub fn back_up(folder: &Path, school_file: &Path, setup: &SchoolSetup, stamp: &str, keep: u32) -> Result<PathBuf, String> {
    if !valid_stamp(stamp) {
        return Err("The date and time for the backup name are not valid.".into());
    }
    check_folder(folder)?;
    // Save and "Back up now" can run at the same moment: one at a time picks a free name and
    // writes it, so two backups made in the same second never land on the same file.
    static ONE_AT_A_TIME: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _turn = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
    let school = school_stem(school_file);
    let name = |n: u32| folder.join(if n < 2 { format!("{school}{MARK}{stamp}.twz") } else { format!("{school}{MARK}{stamp} ({n}).twz") });
    // Written under a temporary name first, so a half-written file never looks like a backup
    // (a sync program may pick files up as soon as they appear).
    let part = folder.join(format!(".{school}{MARK}{stamp}.{}.part", std::process::id()));
    let _ = std::fs::remove_file(&part);
    let failed = |e: String| {
        let _ = std::fs::remove_file(&part);
        format!("The backup could not be saved in \"{}\": {e}", folder.display())
    };
    crate::db::save(&part, setup).map_err(&failed)?;
    // Then given the first free name. A hard link never replaces an existing file, so even
    // another copy of Timewizer using the same folder cannot overwrite this backup (or have
    // it overwrite theirs). Folders that do not allow hard links fall back to a rename.
    let mut n = 1;
    let target = loop {
        let target = name(n);
        n += 1;
        if target.exists() {
            continue;
        }
        match std::fs::hard_link(&part, &target) {
            Ok(()) => {
                let _ = std::fs::remove_file(&part);
                break target;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => {
                std::fs::rename(&part, &target).map_err(|e| failed(e.to_string()))?;
                break target;
            }
        }
    };
    prune(folder, &school, keep);
    Ok(target)
}

/// Removes the oldest backups of one school so that `keep` remain. Never touches other files.
pub fn prune(folder: &Path, school: &str, keep: u32) {
    let Ok(all) = list(folder) else { return };
    for old in all.iter().filter(|b| b.school == school).skip(keep.max(1) as usize) {
        let _ = std::fs::remove_file(&old.path);
    }
}

/// Checks that `backup` is a backup in the backup folder (and not some other file).
pub fn is_backup_in(folder: &Path, backup: &Path) -> bool {
    backup.parent() == Some(folder) && backup.file_name().and_then(|n| parse_name(&n.to_string_lossy())).is_some() && backup.is_file()
}

/// Copies a backup to `target` as a new school file. Refuses to write over the school that is
/// open now (`current`) or over the backup itself, and checks that the backup can be opened.
pub fn restore(folder: &Path, backup: &Path, target: &Path, current: Option<&Path>) -> Result<SchoolSetup, String> {
    if !is_backup_in(folder, backup) {
        return Err("That backup could not be found in the backup folder.".into());
    }
    let same = |a: &Path, b: &Path| a == b || (a.canonicalize().ok().is_some() && a.canonicalize().ok() == b.canonicalize().ok());
    if current.is_some_and(|c| same(c, target)) {
        return Err("Please choose a different name. Restoring never replaces the school that is open now.".into());
    }
    if same(backup, target) || target.parent() == Some(folder) {
        return Err("Please save the restored school outside the backup folder, so the backups stay as they are.".into());
    }
    let setup = crate::db::load(backup)?;
    if target.exists() {
        std::fs::remove_file(target).map_err(|e| format!("Could not replace the existing file: {e}"))?;
    }
    std::fs::copy(backup, target).map_err(|e| format!("Could not save the restored school: {e}"))?;
    Ok(setup)
}

/// What happened to the automatic backup after a save.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SaveOutcome {
    /// The school file that was saved.
    pub path: String,
    /// The new backup, if one was made.
    pub backup: Option<String>,
    /// Why the automatic backup failed (the school itself was saved).
    pub backup_error: Option<String>,
}

/// The preferences file and the backup commands that use it (shared by the app and the UI test bridge).
pub struct PrefsStore {
    file: PathBuf,
    lock: std::sync::Mutex<()>,
}

impl PrefsStore {
    pub fn new(file: PathBuf) -> Self {
        PrefsStore { file, lock: std::sync::Mutex::new(()) }
    }

    pub fn get(&self) -> Preferences {
        let _g = self.lock.lock().unwrap();
        load_prefs(&self.file)
    }

    fn folder(&self) -> Result<(PathBuf, BackupPrefs), String> {
        let b = self.get().backup;
        let f = b.folder.clone().ok_or("Choose a backup folder first.")?;
        Ok((PathBuf::from(f), b))
    }

    /// Changes the backup settings. A new folder must have been chosen by the person
    /// (`folder_ok`, see `access`) and must be usable.
    pub fn set_backup(&self, new: BackupPrefs, folder_ok: impl Fn(&Path) -> bool) -> Result<Preferences, String> {
        let _g = self.lock.lock().unwrap();
        let mut p = load_prefs(&self.file);
        if new.folder != p.backup.folder {
            if let Some(f) = &new.folder {
                if !folder_ok(Path::new(f)) {
                    return Err("Please choose the backup folder with the \"Choose folder\" button.".into());
                }
                check_folder(Path::new(f))?;
            }
        }
        p.backup = BackupPrefs { keep: new.keep.clamp(1, MAX_KEEP), ..new };
        save_prefs(&self.file, &p)?;
        Ok(p)
    }

    /// Switches the start-up animation on or off.
    pub fn set_splash(&self, on: bool) -> Result<Preferences, String> {
        let _g = self.lock.lock().unwrap();
        let mut p = load_prefs(&self.file);
        p.splash = on;
        save_prefs(&self.file, &p)?;
        Ok(p)
    }

    /// Back to the defaults (used by the UI tests).
    #[cfg(feature = "uitest")]
    pub fn reset(&self) -> Result<Preferences, String> {
        let _g = self.lock.lock().unwrap();
        save_prefs(&self.file, &Preferences::default())?;
        Ok(Preferences::default())
    }

    /// "Back up now": a backup of the school as it is on screen (unsaved changes included).
    pub fn back_up_now(&self, current: Option<&Path>, setup: &SchoolSetup, stamp: &str) -> Result<String, String> {
        let (folder, b) = self.folder()?;
        let name = current.map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from(format!("{}.twz", setup.name)));
        back_up(&folder, &name, setup, stamp, b.keep).map(|p| p.to_string_lossy().into_owned())
    }

    /// After the school was saved to `file`: the automatic backup, if it is switched on. `stamp`
    /// is `None` when the caller did not ask for one.
    pub fn after_save(&self, file: &Path, setup: &SchoolSetup, stamp: Option<&str>) -> SaveOutcome {
        let mut out = SaveOutcome { path: file.to_string_lossy().into_owned(), ..Default::default() };
        let b = self.get().backup;
        let (Some(folder), true, Some(stamp)) = (b.folder, b.auto, stamp) else { return out };
        match back_up(Path::new(&folder), file, setup, stamp, b.keep) {
            Ok(p) => out.backup = Some(p.to_string_lossy().into_owned()),
            Err(e) => out.backup_error = Some(e),
        }
        out
    }

    pub fn list(&self) -> Result<Vec<BackupEntry>, String> {
        list(&self.folder()?.0)
    }

    pub fn restore(&self, backup: &Path, target: &Path, current: Option<&Path>) -> Result<SchoolSetup, String> {
        restore(&self.folder()?.0, backup, target, current)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn automatic_backup_only_when_switched_on_and_a_failure_does_not_stop_the_save() {
        let d = dir("auto");
        let store = PrefsStore::new(d.join("preferences.json"));
        let s = SchoolSetup::default_new("A");
        let file = d.join("A.twz");
        assert_eq!(store.after_save(&file, &s, Some(&stamp(1))).backup, None, "no folder yet");
        assert!(store.back_up_now(Some(&file), &s, &stamp(1)).unwrap_err().contains("Choose a backup folder"));
        let folder = d.join("backups");
        std::fs::create_dir_all(&folder).unwrap();
        // a folder that was not chosen in the dialog is refused
        let wanted = BackupPrefs { folder: Some(folder.to_string_lossy().into()), auto: false, keep: 2 };
        assert!(store.set_backup(wanted.clone(), |_| false).is_err());
        store.set_backup(wanted.clone(), |_| true).unwrap();
        assert_eq!(store.after_save(&file, &s, Some(&stamp(1))).backup, None, "automatic backup is off");
        store.set_backup(BackupPrefs { auto: true, ..wanted.clone() }, |_| false).unwrap(); // same folder: no need to choose again
        let o = store.after_save(&file, &s, Some(&stamp(2)));
        assert!(o.backup.as_deref().unwrap().ends_with(&format!("A backup {}.twz", stamp(2))));
        assert_eq!(store.after_save(&file, &s, None).backup, None, "no stamp, no backup");
        store.back_up_now(Some(&file), &s, &stamp(3)).unwrap();
        store.back_up_now(Some(&file), &s, &stamp(4)).unwrap();
        assert_eq!(store.list().unwrap().len(), 2, "keeps 2");
        // the folder disappears (USB stick removed): the save still counts, with a message
        std::fs::remove_dir_all(&folder).unwrap();
        let o = store.after_save(&file, &s, Some(&stamp(5)));
        assert_eq!(o.backup, None);
        assert!(o.backup_error.unwrap().contains("could not be found"));
        // keep is kept within sensible bounds
        assert_eq!(store.set_backup(BackupPrefs { folder: None, auto: false, keep: 0 }, |_| true).unwrap().backup.keep, 1);
        let _ = std::fs::remove_dir_all(d);
    }

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("timewizer-backup-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn stamp(i: u32) -> String {
        format!("2026-10-{:02} 09-{:02}-00", 1 + i / 60, i % 60)
    }

    #[test]
    fn names_are_read_back_and_other_files_are_ignored() {
        assert_eq!(parse_name("Riverside backup 2026-10-23 14-05-09.twz"), Some(("Riverside".into(), "2026-10-23 14-05-09".into(), 1)));
        assert_eq!(parse_name("My School backup 2026-10-23 14-05-09 (3).twz"), Some(("My School".into(), "2026-10-23 14-05-09".into(), 3)));
        for other in ["Riverside.twz", "Riverside backup 2026-10-23.twz", "backup 2026-10-23 14-05-09.twz",
            "Riverside backup 2026-10-23 14:05:09.twz", "Riverside backup 2026-10-23 14-05-09.pdf", "Riverside backup 2026-10-23 14-05-09 (x).twz",
            "Riverside backup 2026-10-23 14-05-09 (1).twz", "é backup 2026-10-23 14-05-0é.twz"] {
            assert_eq!(parse_name(other), None, "{other}");
        }
        assert!(valid_stamp("2026-10-23 14-05-09"));
        assert!(!valid_stamp("2026-10-23 14:05:09") && !valid_stamp("../../etc/passwd") && !valid_stamp(""));
    }

    #[test]
    fn back_up_keeps_the_newest_copies_and_leaves_other_files_alone() {
        let d = dir("keep");
        let school = Path::new("/somewhere/Riverside.twz");
        let mut s = SchoolSetup::default_new("Riverside");
        std::fs::write(d.join("notes.txt"), "mine").unwrap();
        std::fs::write(d.join("Riverside.twz"), "not a backup").unwrap();
        // another school's backups in the same folder are not counted or removed
        back_up(&d, Path::new("/x/Hillside.twz"), &SchoolSetup::default_new("Hillside"), &stamp(0), 3).unwrap();
        for i in 1..=5 {
            s.academic_year = format!("year {i}");
            back_up(&d, school, &s, &stamp(i), 3).unwrap();
        }
        let all = list(&d).unwrap();
        let ours: Vec<_> = all.iter().filter(|b| b.school == "Riverside").collect();
        assert_eq!(ours.len(), 3);
        assert_eq!(ours[0].file_name, format!("Riverside backup {}.twz", stamp(5)), "newest first");
        assert_eq!(ours[0].when, "2026-10-01 09:05:00");
        assert_eq!(crate::db::load(Path::new(&ours[0].path)).unwrap().academic_year, "year 5");
        assert_eq!(crate::db::load(Path::new(&ours[2].path)).unwrap().academic_year, "year 3");
        assert_eq!(all.iter().filter(|b| b.school == "Hillside").count(), 1);
        assert!(d.join("notes.txt").exists() && d.join("Riverside.twz").exists());
        // no temporary files are left behind
        assert!(std::fs::read_dir(&d).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().ends_with(".part")));
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn two_backups_in_the_same_second_both_survive() {
        let d = dir("same");
        let s = SchoolSetup::default_new("A");
        let a = back_up(&d, Path::new("A.twz"), &s, &stamp(1), 10).unwrap();
        let b = back_up(&d, Path::new("A.twz"), &s, &stamp(1), 10).unwrap();
        assert_ne!(a, b);
        assert!(b.to_string_lossy().ends_with(" (2).twz"));
        let l = list(&d).unwrap();
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].path, b.to_string_lossy(), "the later copy is listed first");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn backups_made_at_the_same_moment_never_overwrite_each_other() {
        // Save and "Back up now" run side by side, so several backups can start in the same second.
        let d = dir("together");
        let s = SchoolSetup::default_new("A");
        let made: Vec<PathBuf> = std::thread::scope(|sc| {
            let all: Vec<_> = (0..8).map(|_| sc.spawn(|| back_up(&d, Path::new("A.twz"), &s, &stamp(1), 100).unwrap())).collect();
            all.into_iter().map(|h| h.join().unwrap()).collect()
        });
        let unique: std::collections::HashSet<_> = made.iter().collect();
        assert_eq!(unique.len(), 8, "every backup got its own name: {made:?}");
        assert_eq!(list(&d).unwrap().len(), 8);
        for p in &made {
            assert_eq!(crate::db::load(p).unwrap().name, "A", "{} is a whole school file", p.display());
        }
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn a_missing_or_wrong_folder_gives_a_clear_message() {
        let d = dir("missing").join("not-there");
        let s = SchoolSetup::default_new("A");
        let e = back_up(&d, Path::new("A.twz"), &s, &stamp(1), 10).unwrap_err();
        assert!(e.contains("could not be found") && e.contains("not-there"), "{e}");
        assert!(list(&d).unwrap_err().contains("could not be found"));
        let f = dir("file").join("a-file");
        std::fs::write(&f, "x").unwrap();
        assert!(check_folder(&f).unwrap_err().contains("not a folder"));
        assert!(back_up(&dir("stamp"), Path::new("A.twz"), &s, "../../x", 10).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_folder_gives_a_clear_message() {
        use std::os::unix::fs::PermissionsExt;
        let d = dir("readonly");
        std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o555)).unwrap();
        let writable_anyway = std::fs::write(d.join("probe"), "x").is_ok(); // running as root
        if !writable_anyway {
            let e = back_up(&d, Path::new("A.twz"), &SchoolSetup::default_new("A"), &stamp(1), 10).unwrap_err();
            assert!(e.contains("not allowed to save"), "{e}");
        }
        std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o755)).unwrap();
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn restore_makes_a_new_file_and_never_replaces_the_open_school() {
        let d = dir("restore");
        let out = dir("restore-out");
        let mut s = SchoolSetup::default_new("Riverside");
        s.academic_year = "old".into();
        let b = back_up(&d, Path::new("Riverside.twz"), &s, &stamp(1), 10).unwrap();
        let current = out.join("Riverside.twz");
        std::fs::write(&current, "the open school").unwrap();
        // not over the open school
        assert!(restore(&d, &b, &current, Some(&current)).unwrap_err().contains("different name"));
        assert_eq!(std::fs::read_to_string(&current).unwrap(), "the open school");
        // not into the backup folder
        assert!(restore(&d, &b, &d.join("Copy.twz"), None).is_err());
        // only real backups from the backup folder
        assert!(restore(&d, &current, &out.join("x.twz"), None).is_err());
        assert!(restore(&d, &d.join("Riverside backup 2026-01-01 00-00-00.twz"), &out.join("x.twz"), None).is_err());
        // a damaged backup is refused with the usual message
        let bad = d.join("Bad backup 2026-01-01 00-00-00.twz");
        std::fs::write(&bad, "junk").unwrap();
        assert!(restore(&d, &bad, &out.join("bad.twz"), None).unwrap_err().contains("Timewizer school file"));
        // the real thing
        let target = out.join("Riverside restored.twz");
        let got = restore(&d, &b, &target, Some(&current)).unwrap();
        assert_eq!(got.academic_year, "old");
        assert_eq!(crate::db::load(&target).unwrap(), got);
        assert!(b.exists(), "the backup stays");
        let _ = std::fs::remove_dir_all(d);
        let _ = std::fs::remove_dir_all(out);
    }

    #[test]
    fn preferences_survive_a_restart_and_bad_files_give_defaults() {
        let d = dir("prefs");
        let f = d.join("sub").join("preferences.json");
        assert_eq!(load_prefs(&f), Preferences::default());
        assert_eq!(load_prefs(&f).backup.keep, 10);
        assert!(load_prefs(&f).splash, "the start-up animation is on unless switched off");
        let p = Preferences { backup: BackupPrefs { folder: Some("/media/usb/backups".into()), auto: true, keep: 4 }, splash: false };
        save_prefs(&f, &p).unwrap();
        assert_eq!(load_prefs(&f), p);
        std::fs::write(&f, "{ not json").unwrap();
        assert_eq!(load_prefs(&f), Preferences::default());
        std::fs::write(&f, r#"{"backup":{"keep":0}}"#).unwrap();
        assert_eq!(load_prefs(&f).backup.keep, 1);
        assert!(load_prefs(&f).splash, "a file from 0.2.0 stage 1 (no splash setting) keeps the animation on");
        let store = PrefsStore::new(f.clone());
        assert!(!store.set_splash(false).unwrap().splash);
        assert!(!load_prefs(&f).splash);
        assert_eq!(load_prefs(&f).backup.keep, 1, "other settings are kept");
        let _ = std::fs::remove_dir_all(d);
    }
}
