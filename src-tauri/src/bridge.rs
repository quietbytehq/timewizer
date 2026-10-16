//! UI test bridge: the same commands the desktop app offers, over plain HTTP.
//! Only built with `--features uitest`; it is not part of the released app.
use crate::jobs::{Jobs, Sink};
use crate::model::SchoolSetup;
use crate::{check, copy, db, export, importer, lessons, solver};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Queue(Mutex<Vec<(usize, String, Value)>>);

impl Sink for Queue {
    fn emit(&self, event: &str, payload: Value) {
        let mut q = self.0.lock().unwrap();
        let n = q.len() + 1;
        q.push((n, event.to_string(), payload));
    }
}

struct Bridge {
    current: Mutex<Option<PathBuf>>,
    jobs: Jobs,
    events: Arc<Queue>,
    startup: Mutex<Option<String>>,
}

fn arg<T: DeserializeOwned>(args: &Value, key: &str) -> Result<T, String> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Value::Null)).map_err(|e| format!("bad argument \"{key}\": {e}"))
}

fn out<T: serde::Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

fn with_ext(path: String) -> PathBuf {
    let mut p = PathBuf::from(path);
    if p.extension().is_none() {
        p.set_extension("twz");
    }
    p
}

impl Bridge {
    fn call(&self, cmd: &str, a: &Value) -> Result<Value, String> {
        match cmd {
            "create_school" => {
                let (path, name): (String, String) = (arg(a, "path")?, arg(a, "name")?);
                let p = with_ext(path);
                if p.exists() {
                    std::fs::remove_file(&p).map_err(|e| format!("Could not replace the existing file: {e}"))?;
                }
                let setup = SchoolSetup::default_new(name.trim());
                db::save(&p, &setup)?;
                *self.current.lock().unwrap() = Some(p.clone());
                Ok(json!({ "path": p.to_string_lossy(), "setup": setup }))
            }
            "startup_file" => Ok(json!(self.startup.lock().unwrap().clone())),
            "test_set_startup_file" => {
                *self.startup.lock().unwrap() = arg::<Option<String>>(a, "path")?;
                Ok(Value::Null)
            }
            "open_school" => {
                let p = PathBuf::from(arg::<String>(a, "path")?);
                let setup = db::load(&p)?;
                *self.current.lock().unwrap() = Some(p.clone());
                Ok(json!({ "path": p.to_string_lossy(), "setup": setup }))
            }
            "save_school" => {
                let setup: SchoolSetup = arg(a, "setup")?;
                let p = self.current.lock().unwrap().clone().ok_or("No school is open.")?;
                db::save(&p, &setup)?;
                Ok(Value::Null)
            }
            "save_school_as" => {
                let (path, setup): (String, SchoolSetup) = (arg(a, "path")?, arg(a, "setup")?);
                let p = with_ext(path);
                if p.exists() {
                    std::fs::remove_file(&p).map_err(|e| format!("Could not replace the existing file: {e}"))?;
                }
                db::save(&p, &setup)?;
                *self.current.lock().unwrap() = Some(p.clone());
                out(p.to_string_lossy())
            }
            "close_school" => {
                *self.current.lock().unwrap() = None;
                Ok(Value::Null)
            }
            "validate_setup" => out(arg::<SchoolSetup>(a, "setup")?.validate()),
            "lesson_loads" => out(lessons::summarize(&arg(a, "setup")?)),
            "check_setup" => out(check::run(&arg(a, "setup")?)),
            "import_file" => {
                let (path, kind, setup): (String, Option<String>, SchoolSetup) = (arg(a, "path")?, arg(a, "kind")?, arg(a, "setup")?);
                let tables = importer::read_file(Path::new(&path), kind.as_deref())?;
                out(importer::apply(setup, tables))
            }
            "write_template" => {
                let (path, kind): (String, Option<String>) = (arg(a, "path")?, arg(a, "kind")?);
                match kind {
                    Some(k) if importer::KINDS.contains(&k.as_str()) => {
                        std::fs::write(&path, importer::csv_template(&k)).map_err(|e| format!("Could not save the template: {e}"))?
                    }
                    _ => importer::write_xlsx_template(Path::new(&path))?,
                }
                Ok(Value::Null)
            }
            "start_generate" => self.jobs.start_generate(arg(a, "setup")?, self.events.clone()).map(|_| Value::Null),
            "start_improve" => self.jobs.start_improve(arg(a, "setup")?, self.events.clone()).map(|_| Value::Null),
            "cancel_generate" => {
                self.jobs.cancel();
                Ok(Value::Null)
            }
            "slot_options" => out(solver::edit::slot_options(&arg(a, "setup")?, &arg::<String>(a, "lessonId")?, arg(a, "number")?)?),
            "move_card" => out(solver::edit::move_card(
                &arg(a, "setup")?, &arg::<String>(a, "lessonId")?, arg(a, "number")?, arg(a, "day")?, arg(a, "period")?, arg(a, "room")?,
            )?),
            "swap_options" => out(solver::edit::swap_options(&arg(a, "setup")?, &arg::<String>(a, "lessonId")?, arg(a, "number")?)?),
            "swap_cards" => out(solver::edit::swap_cards(
                &arg(a, "setup")?, &arg::<String>(a, "lessonId")?, arg(a, "number")?, &arg::<String>(a, "withLesson")?, arg(a, "withNumber")?,
            )?),
            "timetable_consistent" => out(solver::edit::is_consistent(&arg(a, "setup")?)),
            "plan_copy_lessons" => out(copy::plan(&arg(a, "setup")?, &arg::<String>(a, "source")?, &arg::<Vec<String>>(a, "targets")?, arg(a, "copyTeachers")?)?),
            "export_csv" => {
                let (setup, path): (SchoolSetup, String) = (arg(a, "setup")?, arg(a, "path")?);
                if setup.timetable.as_ref().map_or(true, |t| t.cards.is_empty()) {
                    return Err("There is no timetable to export yet. Build one first.".into());
                }
                std::fs::write(&path, export::csv_text(&setup)?).map_err(|e| format!("Could not save the file: {e}"))?;
                Ok(Value::Null)
            }
            "export_excel" => {
                export::write_excel(&arg::<SchoolSetup>(a, "setup")?, Path::new(&arg::<String>(a, "path")?))?;
                Ok(Value::Null)
            }
            "write_file" => {
                use base64::Engine;
                let (path, data): (String, String) = (arg(a, "path")?, arg(a, "dataBase64")?);
                let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|e| format!("Could not read the file data: {e}"))?;
                std::fs::write(&path, bytes).map_err(|e| format!("Could not save the file: {e}"))?;
                Ok(Value::Null)
            }
            "read_file_base64" => {
                use base64::Engine;
                let bytes = std::fs::read(arg::<String>(a, "path")?).map_err(|e| format!("Could not open the file: {e}"))?;
                out(base64::engine::general_purpose::STANDARD.encode(bytes))
            }
            other => Err(format!("unknown command: {other}")),
        }
    }
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript",
        "css" => "text/css",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

fn respond(s: &mut TcpStream, code: &str, ctype: &str, body: &[u8]) {
    let head = format!("HTTP/1.1 {code}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", body.len());
    let _ = s.write_all(head.as_bytes());
    let _ = s.write_all(body);
}

fn handle(mut s: TcpStream, b: &Bridge, dist: &Path) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let (head_end, len) = loop {
        let n = match s.read(&mut chunk) {
            Ok(0) | Err(_) => return,
            Ok(n) => n,
        };
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&buf[..i]).to_lowercase();
            let len = head.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse::<usize>().ok()).unwrap_or(0);
            break (i + 4, len);
        }
    };
    while buf.len() < head_end + len {
        match s.read(&mut chunk) {
            Ok(0) | Err(_) => return,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }
    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut first = head.lines().next().unwrap_or("").split_whitespace();
    let (method, target) = (first.next().unwrap_or(""), first.next().unwrap_or("/"));
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let body = &buf[head_end..head_end + len];
    match (method, path) {
        ("POST", "/invoke") => {
            let req: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
            let cmd = req.get("cmd").and_then(|c| c.as_str()).unwrap_or("");
            let reply = match b.call(cmd, req.get("args").unwrap_or(&Value::Null)) {
                Ok(v) => json!({ "ok": v }),
                Err(e) => json!({ "err": e }),
            };
            respond(&mut s, "200 OK", "application/json", reply.to_string().as_bytes());
        }
        ("GET", "/events") => {
            let since: usize = query.split('&').find_map(|kv| kv.strip_prefix("since=")).and_then(|v| v.parse().ok()).unwrap_or(0);
            let q = b.events.0.lock().unwrap();
            let list: Vec<Value> = q.iter().filter(|(n, _, _)| *n > since).map(|(n, e, p)| json!({ "n": n, "event": e, "payload": p })).collect();
            respond(&mut s, "200 OK", "application/json", json!({ "events": list }).to_string().as_bytes());
        }
        ("GET", "/favicon.ico") => respond(&mut s, "204 No Content", "image/x-icon", b""),
        ("GET", p) => {
            let rel = if p == "/" { "index.html" } else { p.trim_start_matches('/') };
            let file = dist.join(rel);
            match std::fs::read(&file) {
                Ok(bytes) if !rel.contains("..") => respond(&mut s, "200 OK", content_type(&file), &bytes),
                _ => respond(&mut s, "404 Not Found", "text/plain", b"not found"),
            }
        }
        _ => respond(&mut s, "405 Method Not Allowed", "text/plain", b"no"),
    }
}

/// Runs until the process is stopped.
pub fn serve(dist: &str, port: u16) {
    let listener = TcpListener::bind(("127.0.0.1", port)).expect("could not open the port");
    let events = Arc::new(Queue::default());
    let bridge = Arc::new(Bridge { current: Mutex::new(None), jobs: Jobs::default(), events, startup: Mutex::new(None) });
    let dist = PathBuf::from(dist);
    eprintln!("uibridge listening on http://127.0.0.1:{port}");
    for conn in listener.incoming().flatten() {
        let (b, d) = (bridge.clone(), dist.clone());
        std::thread::spawn(move || handle(conn, &b, &d));
    }
}
