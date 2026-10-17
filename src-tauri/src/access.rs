//! Which files the app may touch. The web page can only ask for a file by path, so a path is
//! accepted only if the person picked it in a file dialog that the program itself opened (or it
//! was handed to the program when it started). That way a bug or a malicious school file can
//! never make the app read or overwrite some other file.
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Default)]
pub struct Approved {
    files: Mutex<HashSet<PathBuf>>,
    folders: Mutex<HashSet<PathBuf>>,
}

impl Approved {
    pub fn allow_file(&self, p: impl Into<PathBuf>) {
        let p = p.into();
        // A save dialog may add the extension afterwards ("School" becomes "School.twz").
        let mut with_ext = p.clone();
        if with_ext.extension().is_none() {
            with_ext.set_extension("twz");
        }
        let mut f = self.files.lock().unwrap();
        f.insert(p);
        f.insert(with_ext);
    }

    pub fn allow_folder(&self, p: impl Into<PathBuf>) {
        self.folders.lock().unwrap().insert(p.into());
    }

    /// The path as a `PathBuf` if it was chosen by the person; otherwise a plain message.
    pub fn check(&self, path: &str) -> Result<PathBuf, String> {
        let p = PathBuf::from(path);
        let plain = p.components().all(|c| !matches!(c, std::path::Component::ParentDir));
        let in_chosen_folder = p.parent().map_or(false, |d| self.folders.lock().unwrap().contains(d)) && p.file_name().is_some();
        if plain && (self.files.lock().unwrap().contains(&p) || in_chosen_folder) {
            Ok(p)
        } else {
            Err("Timewizer can only use files you choose yourself. Please choose the file again.".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_chosen_files_and_files_in_chosen_folders_pass() {
        let a = Approved::default();
        assert!(a.check("/home/me/School.twz").is_err());
        a.allow_file("/home/me/School.twz");
        assert!(a.check("/home/me/School.twz").is_ok());
        assert!(a.check("/home/me/Other.twz").is_err());
        assert!(a.check("/home/me/../etc/passwd").is_err());
        // a save dialog may add the extension
        a.allow_file("/home/me/New");
        assert!(a.check("/home/me/New.twz").is_ok());
        // a chosen folder allows files directly inside it, nothing sideways or deeper
        a.allow_folder("/home/me/pictures");
        assert!(a.check("/home/me/pictures/6A.png").is_ok());
        assert!(a.check("/home/me/pictures/../secret.png").is_err());
        assert!(a.check("/home/me/pictures/sub/6A.png").is_err());
        assert!(a.check("/home/me/other/6A.png").is_err());
        assert!(a.check("/home/me/pictures").is_err());
    }
}
