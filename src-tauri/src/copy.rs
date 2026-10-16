//! "Copy lessons to other classes": builds a preview and the new lessons.
use crate::lessons::{Lesson, LessonPart};
use crate::master::Class;
use crate::model::SchoolSetup;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CopyLine {
    pub subject: String,
    pub teachers: Vec<String>,
    pub cards_per_week: u32,
    pub periods_per_card: u32,
    /// e.g. "Boys" when only a group of the class attends
    pub group: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkippedLine {
    pub subject: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TargetPlan {
    pub class_id: String,
    pub class_name: String,
    pub create: Vec<CopyLine>,
    pub skipped: Vec<SkippedLine>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CopyPlan {
    pub targets: Vec<TargetPlan>,
    /// Ready to append to the school's lessons when the person confirms.
    pub new_lessons: Vec<Lesson>,
}

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn new_id() -> String {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
    format!("les-{:x}-{}", t, COUNTER.fetch_add(1, Ordering::Relaxed))
}

/// The group of `target` that matches a group of `source` (same split name, same group name).
fn match_group<'a>(source: &Class, group_id: &str, target: &'a Class) -> Option<&'a str> {
    let (div, grp) = source.divisions.iter().find_map(|d| d.groups.iter().find(|g| g.id == group_id).map(|g| (d, g)))?;
    let td = target.divisions.iter().find(|d| d.name.trim().eq_ignore_ascii_case(div.name.trim()))?;
    td.groups.iter().find(|g| g.name.trim().eq_ignore_ascii_case(grp.name.trim())).map(|g| g.id.as_str())
}

fn group_name(c: &Class, id: &str) -> Option<String> {
    c.divisions.iter().flat_map(|d| d.groups.iter()).find(|g| g.id == id).map(|g| g.name.trim().to_string())
}

/// Plans copying every lesson of `source` to each class in `targets`.
/// Lessons shared with other classes, ones the target already has, and groups the
/// target does not have are skipped, each with a reason.
pub fn plan(s: &SchoolSetup, source: &str, targets: &[String], copy_teachers: bool) -> Result<CopyPlan, String> {
    let m = &s.master;
    let src = m.classes.iter().find(|c| c.id == source).ok_or("Choose the class to copy from.")?;
    let mut out = CopyPlan::default();
    let mut seen: Vec<&str> = Vec::new();
    for tid in targets {
        if tid == source || seen.contains(&tid.as_str()) {
            continue;
        }
        seen.push(tid);
        let Some(t) = m.classes.iter().find(|c| &c.id == tid) else { continue };
        let mut tp = TargetPlan { class_id: t.id.clone(), class_name: t.name.trim().to_string(), ..Default::default() };
        let mut warned: Vec<String> = Vec::new();
        for l in s.lessons.iter().filter(|l| l.parts.iter().any(|p| p.class_id == src.id)) {
            let subject = m.subjects.iter().find(|x| x.id == l.subject).map_or("(no subject)", |x| x.name.trim()).to_string();
            let skip = |tp: &mut TargetPlan, reason: String| tp.skipped.push(SkippedLine { subject: subject.clone(), reason });
            if l.parts.iter().any(|p| p.class_id != src.id) {
                skip(&mut tp, format!("It is shared with other classes. Set it up by hand for {}.", t.name.trim()));
                continue;
            }
            if l.subject.is_empty() {
                skip(&mut tp, "It has no subject.".into());
                continue;
            }
            // Map groups onto the target class.
            let mut parts = Vec::new();
            let mut missing = None;
            for p in &l.parts {
                match &p.group_id {
                    None => parts.push(LessonPart { class_id: t.id.clone(), group_id: None }),
                    Some(g) => match match_group(src, g, t) {
                        Some(tg) => parts.push(LessonPart { class_id: t.id.clone(), group_id: Some(tg.to_string()) }),
                        None => missing = Some(group_name(src, g).unwrap_or_default()),
                    },
                }
            }
            if let Some(g) = missing {
                skip(&mut tp, format!("{} has no group called \"{g}\".", t.name.trim()));
                continue;
            }
            let exists = s.lessons.iter().chain(out.new_lessons.iter()).any(|o| {
                o.subject == l.subject
                    && o.parts.len() == parts.len()
                    && parts.iter().all(|p| o.parts.contains(p))
            });
            if exists {
                skip(&mut tp, format!("{} already has this lesson.", t.name.trim()));
                continue;
            }
            let teachers = if copy_teachers { l.teachers.clone() } else { vec![] };
            for tc in &teachers {
                if let Some(te) = m.teachers.iter().find(|x| &x.id == tc) {
                    if !te.shifts.contains(&t.shift) && !warned.contains(tc) {
                        warned.push(tc.clone());
                        tp.warnings.push(format!("{} does not work in {}'s shift.", te.name.trim(), t.name.trim()));
                    }
                }
            }
            tp.create.push(CopyLine {
                subject,
                teachers: teachers.iter().filter_map(|id| m.teachers.iter().find(|x| &x.id == id)).map(|x| x.name.trim().to_string()).collect(),
                cards_per_week: l.cards_per_week,
                periods_per_card: l.periods_per_card,
                group: l.parts.first().and_then(|p| p.group_id.as_deref()).and_then(|g| group_name(src, g)),
            });
            out.new_lessons.push(Lesson {
                id: new_id(),
                subject: l.subject.clone(),
                teachers,
                parts,
                periods_per_card: l.periods_per_card,
                cards_per_week: l.cards_per_week,
                rooms: l.rooms.clone(),
            });
        }
        out.targets.push(tp);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::master::{Division, Group, Subject, Teacher};
    use std::collections::HashSet;
    use std::path::Path;

    fn school() -> SchoolSetup {
        let mut s = SchoolSetup::default_new("T");
        for (i, n) in ["Maths", "PE", "Art"].iter().enumerate() {
            s.master.subjects.push(Subject { id: format!("s{i}"), name: n.to_string(), short_name: n.to_string(), color: "#000".into() });
        }
        for t in ["t1", "t2"] {
            s.master.teachers.push(Teacher { id: t.into(), name: t.into(), short_name: t.into(), shifts: vec!["morning".into()], ..Default::default() });
        }
        let split = |c: &str| vec![Division { id: format!("{c}d"), name: "Gender".into(), groups: vec![Group { id: format!("{c}b"), name: "Boys".into() }, Group { id: format!("{c}g"), name: "Girls".into() }] }];
        for c in ["a", "b", "c"] {
            s.master.classes.push(Class { id: c.into(), name: format!("Class {c}"), short_name: c.into(), shift: "morning".into(), divisions: if c == "c" { vec![] } else { split(c) }, ..Default::default() });
        }
        s
    }
    fn lesson(id: &str, subj: &str, class: &[(&str, Option<&str>)], teacher: &str) -> Lesson {
        Lesson {
            id: id.into(), subject: subj.into(), teachers: vec![teacher.into()],
            parts: class.iter().map(|(c, g)| LessonPart { class_id: c.to_string(), group_id: g.map(Into::into) }).collect(),
            periods_per_card: 1, cards_per_week: 3, rooms: vec!["r".into()],
        }
    }
    fn go(s: &SchoolSetup, to: &[&str], teachers: bool) -> CopyPlan {
        plan(s, "a", &to.iter().map(|x| x.to_string()).collect::<Vec<_>>(), teachers).unwrap()
    }

    #[test]
    fn copies_every_lesson_with_teachers_and_rooms() {
        let mut s = school();
        s.lessons = vec![lesson("l1", "s0", &[("a", None)], "t1"), lesson("l2", "s2", &[("a", None)], "t2")];
        let p = go(&s, &["b"], true);
        assert_eq!(p.targets.len(), 1);
        assert_eq!(p.targets[0].create.len(), 2);
        assert_eq!(p.new_lessons.len(), 2);
        let n = &p.new_lessons[0];
        assert_eq!((n.subject.as_str(), n.cards_per_week, n.teachers.clone(), n.rooms.clone()), ("s0", 3, vec!["t1".to_string()], vec!["r".to_string()]));
        assert_eq!(n.parts, vec![LessonPart { class_id: "b".into(), group_id: None }]);
        assert_eq!(p.targets[0].create[0].teachers, vec!["t1"]);
    }

    #[test]
    fn can_leave_teachers_empty() {
        let mut s = school();
        s.lessons = vec![lesson("l1", "s0", &[("a", None)], "t1")];
        let p = go(&s, &["b"], false);
        assert!(p.new_lessons[0].teachers.is_empty() && p.targets[0].create[0].teachers.is_empty());
    }

    #[test]
    fn several_targets_get_their_own_copies_with_unique_ids() {
        let mut s = school();
        s.lessons = vec![lesson("l1", "s0", &[("a", None)], "t1"), lesson("l2", "s2", &[("a", None)], "t1")];
        let p = go(&s, &["b", "c", "b", "a"], true); // repeats and the source itself are ignored
        assert_eq!(p.targets.len(), 2);
        assert_eq!(p.new_lessons.len(), 4);
        let ids: HashSet<_> = p.new_lessons.iter().map(|l| &l.id).collect();
        assert_eq!(ids.len(), 4);
        assert!(p.new_lessons.iter().filter(|l| l.parts[0].class_id == "c").count() == 2);
    }

    #[test]
    fn groups_are_matched_by_name_or_skipped() {
        let mut s = school();
        s.lessons = vec![lesson("l1", "s1", &[("a", Some("ab"))], "t1")]; // PE for Boys of a
        let p = go(&s, &["b", "c"], true);
        assert_eq!(p.new_lessons.len(), 1);
        assert_eq!(p.new_lessons[0].parts[0], LessonPart { class_id: "b".into(), group_id: Some("bb".into()) });
        assert_eq!(p.targets[0].create[0].group.as_deref(), Some("Boys"));
        assert!(p.targets[1].skipped[0].reason.contains("no group called \"Boys\""), "{:?}", p.targets[1].skipped);
    }

    #[test]
    fn shared_lessons_and_existing_lessons_are_skipped_with_reasons() {
        let mut s = school();
        s.lessons = vec![
            lesson("shared", "s0", &[("a", None), ("b", None)], "t1"),
            lesson("own", "s2", &[("a", None)], "t1"),
            lesson("already", "s2", &[("b", None)], "t2"),
        ];
        let p = go(&s, &["b"], true);
        assert!(p.new_lessons.is_empty());
        let r: Vec<_> = p.targets[0].skipped.iter().map(|x| x.reason.clone()).collect();
        assert!(r[0].contains("shared with other classes"), "{r:?}");
        assert!(r[1].contains("already has"), "{r:?}");
    }

    #[test]
    fn copying_twice_does_not_duplicate() {
        let mut s = school();
        s.lessons = vec![lesson("l1", "s0", &[("a", None)], "t1")];
        let p = go(&s, &["b"], true);
        s.lessons.extend(p.new_lessons);
        let again = go(&s, &["b"], true);
        assert!(again.new_lessons.is_empty());
        assert_eq!(again.targets[0].skipped.len(), 1);
    }

    #[test]
    fn warns_when_a_teacher_is_not_in_the_target_shift() {
        let mut s = school();
        s.shifts[1].enabled = true;
        s.master.classes[1].shift = "afternoon".into();
        s.lessons = vec![lesson("l1", "s0", &[("a", None)], "t1"), lesson("l2", "s2", &[("a", None)], "t1")];
        let p = go(&s, &["b"], true);
        assert_eq!(p.targets[0].warnings.len(), 1, "once per teacher");
        assert!(p.targets[0].warnings[0].contains("does not work in"));
    }

    #[test]
    fn unknown_source_is_a_plain_error_and_nothing_is_changed() {
        let s = school();
        assert!(plan(&s, "nope", &["b".into()], true).is_err());
        let before = s.clone();
        let _ = go(&s, &["b"], true);
        assert_eq!(s, before, "planning never edits the school");
    }

    #[test]
    fn copied_sample_class_is_valid_and_schedulable() {
        use crate::importer::*;
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../samples");
        let tables = KINDS.iter().map(|k| read_file(&dir.join(format!("{k}.csv")), Some(k)).unwrap().remove(0)).collect();
        let mut s = apply(SchoolSetup::default_new("Sample"), tables).setup;
        // a new empty class, then copy Grade 6 A into it
        let mut c = s.master.classes[0].clone();
        c.id = "new".into();
        c.name = "Grade 6 C".into();
        c.short_name = "6C".into();
        s.master.classes.push(c);
        let src = s.master.classes[0].id.clone();
        let p = plan(&s, &src, &["new".into()], true).unwrap();
        assert_eq!(p.new_lessons.len(), 9, "{:?}", p.targets[0].skipped);
        s.lessons.extend(p.new_lessons);
        assert!(s.validate().iter().all(|i| i.level != "error"), "{:?}", s.validate());
        assert_eq!(crate::lessons::summarize(&s).classes.last().unwrap().used, 28);
    }
}
