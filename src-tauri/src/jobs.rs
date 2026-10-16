//! Background jobs (building and improving a timetable) that report back through events.
//! The desktop app sends the events to the window; the UI test bridge queues them.
use crate::model::SchoolSetup;
use crate::{check, solver};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

pub trait Sink: Send + Sync + 'static {
    fn emit(&self, event: &str, payload: Value);
}

#[derive(Default, Clone)]
pub struct Jobs {
    pub cancel: Arc<AtomicBool>,
    pub running: Arc<AtomicBool>,
}

fn json<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}

impl Jobs {
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    /// Starts building the timetable in the background. Progress arrives as "generate-progress"
    /// events and the final report as a "generate-done" event.
    pub fn start_generate(&self, setup: SchoolSetup, sink: Arc<dyn Sink>) -> Result<(), String> {
        let report = check::run(&setup);
        if report.errors > 0 {
            return Err(format!(
                "Please fix the {} on the \"Check before building\" page first.",
                if report.errors == 1 { "1 problem".to_string() } else { format!("{} problems", report.errors) }
            ));
        }
        if report.cards == 0 {
            return Err("There are no lessons yet. Add lessons first.".into());
        }
        if self.running.swap(true, Ordering::SeqCst) {
            return Err("A timetable is already being built.".into());
        }
        self.cancel.store(false, Ordering::SeqCst);
        let (cancel, running) = (self.cancel.clone(), self.running.clone());
        std::thread::spawn(move || {
            let locked: Vec<solver::PlacedCard> =
                setup.timetable.as_ref().map(|t| t.cards.iter().filter(|c| c.locked).cloned().collect()).unwrap_or_default();
            let opts = solver::Options {
                improve_time: Duration::from_secs(setup.settings.improve_seconds as u64),
                ..solver::Options::default()
            };
            let mut last = (0, 0);
            let r = solver::solve(&setup, &locked, &opts, &cancel, &mut |p| {
                let key = (p.placed, (p.fraction * 50.0) as usize);
                if key != last || p.placed == p.total {
                    last = key;
                    sink.emit("generate-progress", json(&p));
                }
            });
            running.store(false, Ordering::SeqCst);
            sink.emit("generate-done", json(&r));
        });
        Ok(())
    }

    /// Improves the quality of the current timetable (after hand edits, for example) in the
    /// background. Progress arrives as "improve-progress" (0..1) and the result as "improve-done".
    pub fn start_improve(&self, setup: SchoolSetup, sink: Arc<dyn Sink>) -> Result<(), String> {
        if setup.timetable.as_ref().map_or(true, |t| t.cards.is_empty()) {
            return Err("There is no timetable to improve yet. Build one first.".into());
        }
        if self.running.swap(true, Ordering::SeqCst) {
            return Err("A timetable is already being built.".into());
        }
        self.cancel.store(false, Ordering::SeqCst);
        let (cancel, running) = (self.cancel.clone(), self.running.clone());
        std::thread::spawn(move || {
            let secs = setup.settings.improve_seconds.max(1) as u64;
            let r = solver::improve_timetable(&setup, Duration::from_secs(secs), 7, &cancel, &mut |f| {
                sink.emit("improve-progress", json(&f));
            });
            running.store(false, Ordering::SeqCst);
            sink.emit("improve-done", json(&r));
        });
        Ok(())
    }
}
