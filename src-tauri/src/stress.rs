//! Stress-test school: a large, realistic double-shift school (120 classes, 220 teachers,
//! 60 rooms, about 4,500 lesson sessions) plus the measurements used by `stress_cli`.
//! Only built for tests and for the UI-test bridge (`--features uitest`); it is not part of the
//! released app.
use crate::lessons::{Lesson, LessonPart};
use crate::links::Link;
use crate::master::*;
use crate::model::{Break, PeriodTime, SchoolSetup, Shift};
use std::collections::{BTreeMap, HashMap};

// ---------------------------------------------------------------- random numbers

pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }
    pub fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    pub fn below(&mut self, n: usize) -> usize {
        (self.next() % n.max(1) as u64) as usize
    }
    pub fn chance(&mut self, percent: u64) -> bool {
        self.next() % 100 < percent
    }
}

// ---------------------------------------------------------------- the school's shape

const SUBJECTS: &[(&str, &str, &str, &str)] = &[
    ("eng", "English", "ENG", "#E8A33D"),
    ("urd", "Urdu", "URD", "#7FB7A4"),
    ("mat", "Mathematics", "MAT", "#5B8DB8"),
    ("sci", "General Science", "SCI", "#7CB36B"),
    ("phy", "Physics", "PHY", "#4F7CAC"),
    ("che", "Chemistry", "CHE", "#C98B6B"),
    ("bio", "Biology", "BIO", "#6FAE8A"),
    ("cs", "Computer Science", "CS", "#8E7CC3"),
    ("soc", "Social Studies", "SOC", "#C9A66B"),
    ("isl", "Islamiyat", "ISL", "#9BB86B"),
    ("civ", "Civics", "CIV", "#B5946B"),
    ("eco", "Economics", "ECO", "#D08C8C"),
    ("bus", "Business Studies", "BUS", "#B58BB5"),
    ("acc", "Accounting", "ACC", "#8BA7B5"),
    ("art", "Art", "ART", "#E08B7A"),
    ("mus", "Music", "MUS", "#D4B15F"),
    ("pe", "Physical Education", "PE", "#6BB5B0"),
    ("lib", "Library", "LIB", "#A3A3C9"),
    ("his", "History", "HIS", "#B59A7A"),
    ("geo", "Geography", "GEO", "#7AA6B5"),
];

/// Subjects taught by specialists who work in both shifts.
const BOTH_SHIFTS: &[&str] = &["cs", "art", "mus", "pe", "lib"];

const FIRST: &[&str] = &[
    "Ayesha", "Bilal", "Farid", "Hina", "Imran", "Sana", "Usman", "Zainab", "Kamran", "Nadia", "Rashid", "Saira",
    "Tariq", "Uzma", "Waqar", "Yasmin", "Adeel", "Farah", "Hamza", "Ilyas", "Junaid", "Kiran", "Mehwish", "Naveed",
    "Omer", "Palwasha", "Qasim", "Rabia", "Shahid", "Tahira", "Umair", "Vaneeza", "Wajiha", "Zeeshan", "Amna",
    "Danish", "Erum", "Fahad", "Gulnaz", "Haider",
];
const LAST: &[&str] = &[
    "Khan", "Ahmed", "Ali", "Hussain", "Shah", "Malik", "Raza", "Iqbal", "Siddiqui", "Baig", "Qureshi", "Mirza",
    "Chaudhry", "Hashmi", "Noor", "Karim", "Rehman", "Butt", "Jamil", "Rizvi",
];

/// How long the school day is. `NORMAL` is the project's large-school shape (8 periods Monday to
/// Thursday, 6 on Friday); `TIGHT` has fewer periods, so classes are almost completely full.
#[derive(Clone, Copy, Debug)]
pub struct Profile {
    pub weekday: usize,
    pub friday: usize,
}
impl Profile {
    pub const NORMAL: Profile = Profile { weekday: 8, friday: 6 };
    pub const TIGHT: Profile = Profile { weekday: 7, friday: 5 };
    pub fn periods_on(&self, day: usize) -> usize {
        if day == 4 { self.friday } else { self.weekday }
    }
    pub fn slots(&self) -> usize {
        (0..DAYS).map(|d| self.periods_on(d)).sum()
    }
}

pub const DAYS: usize = 5;
pub const MORNING: &str = "morning";
pub const AFTERNOON: &str = "afternoon";

fn periods(start: u32, count: usize, len: u32, gaps: &[(usize, u32)]) -> Vec<PeriodTime> {
    let f = |m: u32| format!("{:02}:{:02}", m / 60, m % 60);
    let mut t = start;
    let mut out = Vec::new();
    for i in 0..count {
        out.push(PeriodTime { start: f(t), end: f(t + len) });
        t += len;
        if let Some((_, g)) = gaps.iter().find(|(a, _)| *a == i + 1) {
            t += g;
        }
    }
    out
}

/// A break after period 3 that a double cannot cross. The afternoon shift starts later on Friday.
fn shifts(pr: Profile) -> Vec<Shift> {
    let mk = |id: &str, name: &str, start: u32, fri_start: u32| {
        let week = periods(start, pr.weekday, 40, &[(3, 20)]);
        let fri = periods(fri_start, pr.friday, 40, &[(3, 20)]);
        Shift {
            id: id.into(),
            name: name.into(),
            enabled: true,
            days: (0..7).map(|d| match d { 0..=3 => week.clone(), 4 => fri.clone(), _ => vec![] }).collect(),
            breaks: vec![Break { after_period: 3, name: "Break".into(), cannot_cross: true }],
        }
    };
    vec![mk(MORNING, "Morning", 7 * 60 + 45, 7 * 60 + 45), mk(AFTERNOON, "Afternoon", 13 * 60 + 45, 14 * 60 + 30)]
}

/// Which teacher a lesson gets: one named in advance (a primary class teacher) or any from a
/// subject pool, chosen later so every teacher ends up with a sensible load.
#[derive(Clone)]
enum Who {
    Teacher(usize),
    Pool(&'static str),
}

struct Draft {
    subject: &'static str,
    parts: Vec<(usize, Option<usize>)>, // (class index, group index within its division)
    ppc: u32,
    cpw: u32,
    who: Who,
    room: Option<&'static str>,
}

struct Plan {
    classes: Vec<Class>,
    class_shift: Vec<&'static str>,
    drafts: Vec<Draft>,
    links: Vec<Vec<usize>>,
    class_teachers: usize,
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Primary,
    Middle,
    Lower,
    Upper,
}

fn halves(ci: usize) -> Division {
    Division {
        id: format!("d{ci}h"),
        name: "Halves".into(),
        groups: vec![
            Group { id: format!("g{ci}h1"), name: "Group 1".into() },
            Group { id: format!("g{ci}h2"), name: "Group 2".into() },
        ],
    }
}

fn options(ci: usize) -> Division {
    Division {
        id: format!("d{ci}o"),
        name: "Options".into(),
        groups: (1..=3).map(|n| Group { id: format!("g{ci}o{n}"), name: format!("Option {n}") }).collect(),
    }
}

impl Plan {
    fn add(&mut self, subject: &'static str, parts: &[(usize, Option<usize>)], ppc: u32, cpw: u32, who: Who, room: Option<&'static str>) -> usize {
        self.drafts.push(Draft { subject, parts: parts.to_vec(), ppc, cpw, who, room });
        self.drafts.len() - 1
    }
    fn link(&mut self, ids: &[usize]) {
        self.links.push(ids.to_vec());
    }
}

/// Classes and lessons, with teachers still to be chosen for the pooled ones.
fn plan() -> Plan {
    let mut p = Plan { classes: vec![], class_shift: vec![], drafts: vec![], links: vec![], class_teachers: 0 };
    let sections = |n: usize| (0..n).map(|i| (b'A' + i as u8) as char).collect::<Vec<_>>();
    // (name of the grade, sections, shift, kind)
    let grades: Vec<(&str, usize, &'static str, Kind)> = vec![
        ("KG", 10, AFTERNOON, Kind::Primary), ("1", 10, AFTERNOON, Kind::Primary), ("2", 10, AFTERNOON, Kind::Primary),
        ("3", 10, AFTERNOON, Kind::Primary), ("4", 10, AFTERNOON, Kind::Primary), ("5", 10, AFTERNOON, Kind::Primary),
        ("6", 8, MORNING, Kind::Middle), ("7", 8, MORNING, Kind::Middle), ("8", 8, MORNING, Kind::Middle),
        ("9", 9, MORNING, Kind::Lower), ("10", 9, MORNING, Kind::Lower),
        ("11", 9, MORNING, Kind::Upper), ("12", 9, MORNING, Kind::Upper),
    ];
    let mut by_grade: Vec<Vec<usize>> = Vec::new();
    for (g, n, shift, kind) in &grades {
        let mut ids = Vec::new();
        for sec in sections(*n) {
            let ci = p.classes.len();
            let (name, short) = if *g == "KG" { (format!("KG {sec}"), format!("KG{sec}")) } else { (format!("Grade {g} {sec}"), format!("{g}{sec}")) };
            let divisions = match kind {
                Kind::Upper => vec![options(ci)],
                _ => vec![halves(ci)],
            };
            p.classes.push(Class { id: format!("c{ci}"), name, short_name: short, shift: (*shift).into(), divisions, ..Default::default() });
            p.class_shift.push(shift);
            ids.push(ci);
        }
        by_grade.push(ids);
    }
    // One class teacher for every primary class: they teach the main subjects themselves.
    let primary: Vec<usize> = (0..p.classes.len()).filter(|&c| p.class_shift[c] == AFTERNOON).collect();
    p.class_teachers = primary.len();
    let whole = |c: usize| [(c, None)];
    let g1 = |c: usize| [(c, Some(0))];
    let g2 = |c: usize| [(c, Some(1))];
    let g = |c: usize, i: usize| [(c, Some(i))];

    for (gi, (_, _, _, kind)) in grades.iter().enumerate() {
        let cls = by_grade[gi].clone();
        for (k, &c) in cls.iter().enumerate() {
            match kind {
                Kind::Primary => {
                    let t = Who::Teacher(primary.iter().position(|&x| x == c).unwrap());
                    for (s, cpw) in [("eng", 4), ("urd", 3), ("mat", 5), ("sci", 3), ("soc", 2), ("isl", 2)] {
                        p.add(s, &whole(c), 1, cpw, t.clone(), None);
                    }
                    p.add("mus", &whole(c), 1, 1, Who::Pool("mus"), Some("mus"));
                    // Computer and Art swap between the two halves of the class.
                    let a1 = p.add("cs", &g1(c), 2, 1, Who::Pool("cs"), Some("cs"));
                    let a2 = p.add("art", &g2(c), 2, 1, Who::Pool("art"), Some("art"));
                    p.link(&[a1, a2]);
                    let b1 = p.add("art", &g1(c), 2, 1, Who::Pool("art"), Some("art"));
                    let b2 = p.add("cs", &g2(c), 2, 1, Who::Pool("cs"), Some("cs"));
                    p.link(&[b1, b2]);
                    // Reading with the class teacher while the other half is in the library.
                    let c1 = p.add("eng", &g1(c), 1, 2, t.clone(), None);
                    let c2 = p.add("lib", &g2(c), 1, 2, Who::Pool("lib"), Some("lib"));
                    p.link(&[c1, c2]);
                    let d1 = p.add("lib", &g1(c), 1, 2, Who::Pool("lib"), Some("lib"));
                    let d2 = p.add("eng", &g2(c), 1, 2, t.clone(), None);
                    p.link(&[d1, d2]);
                    if k % 2 == 0 && k + 1 < cls.len() {
                        p.add("pe", &[(c, None), (cls[k + 1], None)], 1, 2, Who::Pool("pe"), Some("pe"));
                    }
                }
                Kind::Middle => {
                    for (s, cpw) in [("eng", 5), ("urd", 3), ("mat", 5), ("sci", 4), ("soc", 3), ("isl", 2)] {
                        p.add(s, &whole(c), 1, cpw, Who::Pool(s), None);
                    }
                    let a1 = p.add("cs", &g1(c), 2, 1, Who::Pool("cs"), Some("cs"));
                    let a2 = p.add("art", &g2(c), 2, 1, Who::Pool("art"), Some("art"));
                    p.link(&[a1, a2]);
                    let b1 = p.add("art", &g1(c), 2, 1, Who::Pool("art"), Some("art"));
                    let b2 = p.add("cs", &g2(c), 2, 1, Who::Pool("cs"), Some("cs"));
                    p.link(&[b1, b2]);
                    let c1 = p.add("lib", &g1(c), 1, 2, Who::Pool("lib"), Some("lib"));
                    let c2 = p.add("eng", &g2(c), 1, 2, Who::Pool("eng"), None);
                    p.link(&[c1, c2]);
                    // Combined PE for two neighbouring sections.
                    if k % 2 == 0 && k + 1 < cls.len() {
                        p.add("pe", &[(c, None), (cls[k + 1], None)], 1, 2, Who::Pool("pe"), Some("pe"));
                    }
                }
                Kind::Lower => {
                    for (s, cpw) in [("eng", 4), ("urd", 2), ("mat", 5), ("isl", 2), ("civ", 2)] {
                        p.add(s, &whole(c), 1, cpw, Who::Pool(s), None);
                    }
                    for s in ["phy", "che", "bio"] {
                        p.add(s, &whole(c), 1, 2, Who::Pool(s), None);
                        p.add(s, &whole(c), 2, 1, Who::Pool(s), Some(s_room(s)));
                    }
                    let a1 = p.add("cs", &g1(c), 2, 1, Who::Pool("cs"), Some("cs"));
                    let a2 = p.add("pe", &g2(c), 2, 1, Who::Pool("pe"), Some("pe"));
                    p.link(&[a1, a2]);
                    let b1 = p.add("pe", &g1(c), 2, 1, Who::Pool("pe"), Some("pe"));
                    let b2 = p.add("cs", &g2(c), 2, 1, Who::Pool("cs"), Some("cs"));
                    p.link(&[b1, b2]);
                }
                Kind::Upper => {
                    for (s, cpw) in [("eng", 4), ("urd", 2), ("isl", 1)] {
                        p.add(s, &whole(c), 1, cpw, Who::Pool(s), None);
                    }
                    p.add("pe", &whole(c), 1, 1, Who::Pool("pe"), Some("pe"));
                    // Option lines: three groups run side by side, each taught a different subject.
                    let lines: [([&'static str; 3], u32, u32); 5] = [
                        (["phy", "acc", "bio"], 1, 5),
                        (["che", "eco", "mat"], 1, 5),
                        (["bio", "bus", "phy"], 1, 5),
                        (["che", "cs", "bio"], 2, 2),
                        (["his", "geo", "soc"], 1, 4),
                    ];
                    for (subs, ppc, cpw) in lines {
                        let ids: Vec<usize> = (0..3)
                            .map(|i| {
                                let room = if ppc == 2 && ["phy", "che", "bio"].contains(&subs[i]) { Some(s_room(subs[i])) } else if ppc == 2 && subs[i] == "cs" { Some("cs") } else { None };
                                p.add(subs[i], &g(c, i), ppc, cpw, Who::Pool(subs[i]), room)
                            })
                            .collect();
                        p.link(&ids);
                    }
                }
            }
        }
    }
    p
}

fn s_room(subject: &str) -> &'static str {
    match subject {
        "phy" => "phy",
        "che" => "che",
        _ => "bio",
    }
}

// ---------------------------------------------------------------- building the school

pub struct Counts {
    pub classes: usize,
    pub teachers: usize,
    pub rooms: usize,
    pub lessons: usize,
    /// Lesson sessions to place (a double period is one session).
    pub sessions: usize,
    pub periods: usize,
    pub links: usize,
    /// Lessons for only one group of a class.
    pub group_lessons: usize,
}

pub fn counts(s: &SchoolSetup) -> Counts {
    Counts {
        classes: s.master.classes.len(),
        teachers: s.master.teachers.len(),
        rooms: s.master.rooms.len(),
        lessons: s.lessons.len(),
        sessions: s.lessons.iter().map(|l| l.cards_per_week as usize).sum(),
        periods: s.lessons.iter().map(|l| (l.cards_per_week * l.periods_per_card) as usize).sum(),
        links: s.links.len(),
        group_lessons: s.lessons.iter().filter(|l| l.parts.iter().any(|p| p.group_id.is_some())).count(),
    }
}

fn unique_names(rng: &mut Rng, n: usize) -> Vec<(String, String)> {
    let mut used = std::collections::HashSet::new();
    let mut shorts = std::collections::HashSet::new();
    let mut out = Vec::new();
    while out.len() < n {
        let (f, l) = (FIRST[rng.below(FIRST.len())], LAST[rng.below(LAST.len())]);
        let name = format!("{f} {l}");
        if !used.insert(name.clone()) {
            continue;
        }
        let base: String = format!("{}{}", &f[..1], &l[..2]).to_uppercase();
        let mut short = base.clone();
        let mut k = 2;
        while !shorts.insert(short.clone()) {
            short = format!("{base}{k}");
            k += 1;
        }
        out.push((name, short));
    }
    out
}

/// A large double-shift school. The same seed always gives the same school.
/// The seed of the school used for the headline measurements: a typical one (middle of the pack
/// when building ten different large schools).
pub const TYPICAL_SEED: u64 = 8;

pub fn large_school(seed: u64) -> SchoolSetup {
    large_school_with(seed, Profile::NORMAL)
}

pub fn large_school_with(seed: u64, pr: Profile) -> SchoolSetup {
    large_school_sized(seed, pr, 220, 60)
}

pub fn large_school_sized(seed: u64, pr: Profile, teacher_target: usize, room_target: usize) -> SchoolSetup {
    let mut rng = Rng::new(seed);
    let p = plan();
    let mut s = SchoolSetup::default_new("Crescent Double-Shift School");
    s.academic_year = "2026-27".into();
    s.school_type = "high".into();
    s.shifts = shifts(pr);
    for (i, d) in s.days.iter_mut().enumerate() {
        d.working = i < DAYS;
    }
    s.master.subjects = SUBJECTS
        .iter()
        .map(|(id, name, short, color)| Subject { id: (*id).into(), name: (*name).into(), short_name: (*short).into(), color: (*color).into() })
        .collect();
    s.settings.default_max_per_week = Some(30);
    s.settings.default_max_per_day = Some(6);

    // ---- rooms: sized from what the lessons ask for, padded with ordinary classrooms ----
    let mut demand: BTreeMap<(&str, &str), u32> = BTreeMap::new(); // (room kind, shift) -> periods a week
    for d in &p.drafts {
        if let Some(r) = d.room {
            *demand.entry((r, p.class_shift[d.parts[0].0])).or_default() += d.ppc * d.cpw;
        }
    }
    let slots = pr.slots() as f64;
    let kinds: [(&str, &str, &str, &str); 9] = [
        ("phy", "Physics Lab", "PL", "Science Block"),
        ("che", "Chemistry Lab", "CL", "Science Block"),
        ("bio", "Biology Lab", "BL", "Science Block"),
        ("cs", "Computer Lab", "CO", "Main Block"),
        ("art", "Art Room", "AR", "Main Block"),
        ("mus", "Music Room", "MR", "Main Block"),
        ("lib", "Library", "LB", "Main Block"),
        ("pe", "Sports Area", "SP", "Sports Complex"),
        ("cls", "Classroom", "CR", "Junior Wing"),
    ];
    let need = |k: &str, util: f64| -> usize {
        let d = demand.iter().filter(|((r, _), _)| *r == k).map(|(_, v)| *v).max().unwrap_or(0) as f64;
        (d / (slots * util)).ceil() as usize
    };
    let mut util = 0.62;
    let special = |util: f64| kinds.iter().filter(|(k, ..)| *k != "cls").map(|(k, ..)| need(k, util)).sum::<usize>();
    while special(util) + 2 > room_target {
        util += 0.01;
    }
    s.master.buildings = ["Main Block", "Science Block", "Sports Complex", "Junior Wing"].iter().enumerate()
        .map(|(i, n)| Building { id: format!("b{i}"), name: (*n).into() }).collect();
    let mut room_ids: HashMap<&str, Vec<String>> = HashMap::new();
    for (k, name, short, building) in kinds {
        let n = if k == "cls" { room_target - special(util) } else { need(k, util) };
        let bid = s.master.buildings.iter().find(|b| b.name == building).map(|b| b.id.clone());
        for i in 1..=n {
            let id = format!("r{}", s.master.rooms.len());
            // Labs are closed for cleaning on Friday's last period.
            let time_off = if matches!(k, "phy" | "che" | "bio") && i % 2 == 0 {
                [MORNING, AFTERNOON].iter().map(|sh| TimeOffCell { shift: (*sh).into(), day: 4, period: pr.friday as u8, state: 2 }).collect()
            } else { vec![] };
            s.master.rooms.push(Room { id: id.clone(), name: format!("{name} {i}"), short_name: format!("{short}{i}"), building: bid.clone(), capacity: Some(if k == "cls" { 36 } else { 30 }), time_off });
            room_ids.entry(k).or_default().push(id);
        }
    }

    // ---- teachers: pools sized so the average load is sensible ----
    let mut pool_demand: BTreeMap<(&'static str, &'static str), u32> = BTreeMap::new(); // (subject, shift or "both")
    for d in &p.drafts {
        if let Who::Pool(sub) = d.who {
            let sh = if BOTH_SHIFTS.contains(&sub) { "both" } else { p.class_shift[d.parts[0].0] };
            *pool_demand.entry((sub, sh)).or_default() += d.ppc * d.cpw;
        }
    }
    // Big pools contain a part-timer for every eight teachers, who can teach only about half as much.
    let eff = |d: u32, l: f64| if d as f64 / l >= 8.0 { d as f64 * 1.08 } else { d as f64 };
    let total = |l: f64| p.class_teachers + pool_demand.values().map(|&d| ((eff(d, l) / l).round() as usize).max(1)).sum::<usize>();
    let mut load = 12.0;
    while total(load) > teacher_target && load < 60.0 {
        load += 0.05;
    }
    let mut sizes: BTreeMap<(&'static str, &'static str), usize> = pool_demand.iter().map(|(k, &d)| (*k, ((eff(d, load) / load).round() as usize).max(1))).collect();
    // land exactly on the target: grow the busiest pools, trim the quietest
    loop {
        let t = p.class_teachers + sizes.values().sum::<usize>();
        if t == teacher_target {
            break;
        }
        let key = if t < teacher_target {
            *pool_demand.iter().max_by(|a, b| (*a.1 as f64 / sizes[a.0] as f64).partial_cmp(&(*b.1 as f64 / sizes[b.0] as f64)).unwrap()).unwrap().0
        } else {
            *pool_demand.iter().filter(|(k, _)| sizes[*k] > 1).min_by(|a, b| (*a.1 as f64 / sizes[a.0] as f64).partial_cmp(&(*b.1 as f64 / sizes[b.0] as f64)).unwrap()).unwrap().0
        };
        if t < teacher_target { *sizes.get_mut(&key).unwrap() += 1 } else { *sizes.get_mut(&key).unwrap() -= 1 }
    }

    let names = unique_names(&mut rng, teacher_target);
    let mut pools: HashMap<(&'static str, &'static str), Vec<usize>> = HashMap::new();
    let mut cap: Vec<u32> = Vec::new();
    let new_teacher = |s: &mut SchoolSetup, shifts: Vec<&str>, rng: &mut Rng, part_time: bool, allow_free_day: bool, cap: &mut Vec<u32>| -> usize {
        let i = s.master.teachers.len();
        let (name, short) = names[i].clone();
        let mut t = Teacher { id: format!("t{i}"), name, short_name: short, shifts: shifts.iter().map(|x| x.to_string()).collect(), ..Default::default() };
        if rng.chance(70) {
            t.max_consecutive = Some(4);
        }
        let mut c = 28;
        if part_time {
            // part-time: three or four days a week, fewer periods
            t.max_days_per_week = Some(3 + rng.below(2) as u32);
            c = 13;
        } else if allow_free_day && rng.chance(15) {
            // a free day (all periods of one day blocked); not for class teachers or tiny subject pools
            // (a school cannot give a day off to its only geography teacher)
            let day = rng.below(DAYS) as u8;
            for sh in &shifts {
                for per in 1..=pr.periods_on(day as usize) as u8 {
                    t.time_off.push(TimeOffCell { shift: (*sh).into(), day, period: per, state: 2 });
                }
            }
            c = 22;
        }
        // a few "avoid if possible" cells
        for _ in 0..rng.below(4) {
            let sh = shifts[rng.below(shifts.len())];
            let day = rng.below(DAYS) as u8;
            let period = 1 + rng.below(pr.periods_on(day as usize)) as u8;
            if !t.time_off.iter().any(|x| x.shift == sh && x.day == day && x.period == period) {
                t.time_off.push(TimeOffCell { shift: sh.into(), day, period, state: 1 });
            }
        }
        cap.push(c);
        s.master.teachers.push(t);
        i
    };
    for _ in 0..p.class_teachers {
        new_teacher(&mut s, vec![AFTERNOON], &mut rng, false, false, &mut cap);
    }
    for (&(sub, sh), &n) in &sizes {
        let shifts: Vec<&str> = if sh == "both" { vec![MORNING, AFTERNOON] } else { vec![sh] };
        for k in 0..n {
            let part = n >= 4 && k % 8 == 7; // about one in eight is part-time
            let t = new_teacher(&mut s, shifts.clone(), &mut rng, part, n >= 8, &mut cap);
            pools.entry((sub, sh)).or_default().push(t);
        }
    }

    // ---- classes get their time off and (for the morning) a class teacher ----
    s.master.classes = p.classes.clone();
    for c in &mut s.master.classes {
        // Monday's first period is the school assembly.
        c.time_off.push(TimeOffCell { shift: c.shift.clone(), day: 0, period: 1, state: 2 });
    }

    // ---- lessons: hand out pooled teachers, least busy first, never the same person twice in a link ----
    let mut load_of = vec![0u32; s.master.teachers.len()];
    let mut link_of: HashMap<usize, usize> = HashMap::new();
    for (li, l) in p.links.iter().enumerate() {
        for &d in l {
            link_of.insert(d, li);
        }
    }
    let mut chosen: Vec<Option<usize>> = vec![None; p.drafts.len()];
    for (i, d) in p.drafts.iter().enumerate() {
        if let Who::Teacher(t) = d.who {
            chosen[i] = Some(t);
            load_of[t] += d.ppc * d.cpw;
        }
    }
    // biggest lessons first so the loads even out
    let mut order: Vec<usize> = (0..p.drafts.len()).filter(|&i| matches!(p.drafts[i].who, Who::Pool(_))).collect();
    order.sort_by_key(|&i| std::cmp::Reverse((p.drafts[i].ppc * p.drafts[i].cpw, i)));
    for i in order {
        let d = &p.drafts[i];
        let Who::Pool(sub) = d.who else { continue };
        let sh = if BOTH_SHIFTS.contains(&sub) { "both" } else { p.class_shift[d.parts[0].0] };
        let pool = &pools[&(sub, sh)];
        let size = d.ppc * d.cpw;
        let banned: Vec<usize> = link_of.get(&i).map(|&k| p.links[k].iter().filter_map(|&o| chosen[o]).collect()).unwrap_or_default();
        // a teacher may not be in two classes of a combined lesson, nor the same person twice in a link
        let pick = pool.iter().copied().filter(|t| !banned.contains(t))
            .min_by_key(|&t| (load_of[t] + size > cap[t], load_of[t]))
            .unwrap_or(pool[0]);
        chosen[i] = Some(pick);
        load_of[pick] += size;
    }
    // Move lessons off anyone who ended up over their own limit (part-timers especially).
    for _ in 0..4 {
        for t in 0..load_of.len() {
            if load_of[t] <= cap[t] {
                continue;
            }
            let mut mine: Vec<usize> = (0..p.drafts.len()).filter(|&i| chosen[i] == Some(t) && matches!(p.drafts[i].who, Who::Pool(_))).collect();
            mine.sort_by_key(|&i| p.drafts[i].ppc * p.drafts[i].cpw);
            for i in mine {
                if load_of[t] <= cap[t] {
                    break;
                }
                let d = &p.drafts[i];
                let Who::Pool(sub) = d.who else { continue };
                let sh = if BOTH_SHIFTS.contains(&sub) { "both" } else { p.class_shift[d.parts[0].0] };
                let size = d.ppc * d.cpw;
                let banned: Vec<usize> = link_of.get(&i).map(|&k| p.links[k].iter().filter_map(|&o| chosen[o]).collect()).unwrap_or_default();
                if let Some(&other) = pools[&(sub, sh)].iter().filter(|&&o| o != t && !banned.contains(&o) && load_of[o] + size <= cap[o]).min_by_key(|&&o| load_of[o]) {
                    chosen[i] = Some(other);
                    load_of[t] -= size;
                    load_of[other] += size;
                }
            }
        }
    }
    for t in 0..load_of.len() {
        if load_of[t] > cap[t] {
            s.master.teachers[t].max_days_per_week = None; // cannot be kept part-time: make them full-time
            cap[t] = 28;
        }
    }
    for (i, d) in p.drafts.iter().enumerate() {
        let parts = d.parts.iter().map(|&(c, g)| LessonPart {
            class_id: format!("c{c}"),
            group_id: g.map(|gi| p.classes[c].divisions[0].groups[gi].id.clone()),
        }).collect();
        s.lessons.push(Lesson {
            id: format!("l{i}"),
            subject: d.subject.into(),
            teachers: vec![format!("t{}", chosen[i].unwrap())],
            parts,
            periods_per_card: d.ppc,
            cards_per_week: d.cpw,
            rooms: d.room.map(|r| room_ids[r].clone()).unwrap_or_default(),
        });
    }
    s.links = p.links.iter().enumerate().map(|(k, l)| Link { id: format!("k{k}"), lessons: l.iter().map(|i| format!("l{i}")).collect() }).collect();

    // morning classes: the teacher of their English lesson is the class teacher
    for c in 0..s.master.classes.len() {
        if p.class_shift[c] == AFTERNOON {
            s.master.classes[c].class_teacher = Some(format!("t{}", primary_index(&p, c)));
        } else if let Some(l) = s.lessons.iter().find(|l| l.subject == "eng" && l.parts.len() == 1 && l.parts[0].class_id == format!("c{c}") && l.parts[0].group_id.is_none()) {
            s.master.classes[c].class_teacher = l.teachers.first().cloned();
        }
    }
    s
}

fn primary_index(p: &Plan, c: usize) -> usize {
    (0..c).filter(|&x| p.class_shift[x] == AFTERNOON).count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_large_school_has_the_asked_for_size_and_is_deterministic() {
        let a = large_school(1);
        let n = counts(&a);
        eprintln!(
            "classes {} teachers {} rooms {} lessons {} sessions {} periods {} links {} group-lessons {}",
            n.classes, n.teachers, n.rooms, n.lessons, n.sessions, n.periods, n.links, n.group_lessons
        );
        assert_eq!((n.classes, n.teachers, n.rooms), (120, 220, 60));
        assert!((4300..=4700).contains(&n.sessions), "{} sessions", n.sessions);
        assert_eq!(serde_json::to_string(&a).unwrap(), serde_json::to_string(&large_school(1)).unwrap());
        assert_ne!(serde_json::to_string(&a).unwrap(), serde_json::to_string(&large_school(2)).unwrap());
    }

    #[test]
    fn every_seed_gives_a_valid_large_school_of_the_same_size() {
        for seed in 1..=8 {
            let s = large_school(seed);
            let n = counts(&s);
            assert_eq!((n.classes, n.teachers, n.rooms), (120, 220, 60), "seed {seed}");
            assert!((4300..=4700).contains(&n.sessions), "seed {seed}: {} sessions", n.sessions);
            assert!(s.validate().iter().all(|i| i.level != "error"), "seed {seed}");
            let r = crate::check::run(&s);
            assert_eq!(r.errors, 0, "seed {seed}: {:?}", r.findings.iter().filter(|f| f.level == "error").map(|f| &f.message).take(3).collect::<Vec<_>>());
        }
    }

    #[test]
    fn the_tight_profile_also_gives_a_valid_school() {
        let s = large_school_with(1, Profile::TIGHT);
        assert!(s.validate().iter().all(|i| i.level != "error"));
        // fewer periods in the week, so classes are fuller; this is the "very tight" variant
        assert_eq!(Profile::TIGHT.slots(), 33);
        assert_eq!(Profile::NORMAL.slots(), 38);
    }

    #[test]
    fn the_large_school_is_a_real_double_shift_with_groups_links_rooms_and_time_off() {
        let s = large_school(TYPICAL_SEED);
        assert_eq!(s.shifts.iter().filter(|x| x.enabled).count(), 2);
        let morning = s.master.classes.iter().filter(|c| c.shift == MORNING).count();
        assert_eq!((morning, s.master.classes.len() - morning), (60, 60));
        // Friday is shorter, and the afternoon starts later on Friday
        assert!(s.shifts.iter().all(|sh| sh.days[4].len() < sh.days[0].len()));
        assert!(s.shifts[1].days[4][0].start > s.shifts[1].days[0][0].start);
        assert!(s.validate().iter().all(|i| i.level != "warning" || !i.message.contains("overlap")), "the shifts must not overlap");
        // split groups, same-time links, combined lessons, room pools, double periods
        assert!(s.lessons.iter().any(|l| l.parts.iter().any(|p| p.group_id.is_some())));
        assert!(!s.links.is_empty() && s.links.iter().all(|k| k.lessons.len() >= 2));
        assert!(s.lessons.iter().any(|l| l.parts.len() > 1), "combined lessons");
        assert!(s.lessons.iter().any(|l| !l.rooms.is_empty()) && s.lessons.iter().any(|l| l.periods_per_card == 2));
        // teachers in both shifts, part-timers, free days and "avoid" cells
        assert!(s.master.teachers.iter().any(|t| t.shifts.len() == 2));
        assert!(s.master.teachers.iter().any(|t| t.max_days_per_week.is_some()));
        assert!(s.master.teachers.iter().any(|t| t.time_off.iter().any(|c| c.state == 2)));
        assert!(s.master.teachers.iter().any(|t| t.time_off.iter().any(|c| c.state == 1)));
        // nobody is given more than their own limit
        let sum = crate::lessons::summarize(&s);
        assert!(sum.teachers.iter().all(|t| t.used <= t.available), "a teacher has more than they can teach");
    }

    #[test]
    fn the_large_school_survives_saving_and_opening() {
        let s = large_school(TYPICAL_SEED);
        let path = std::env::temp_dir().join(format!("tw-large-{}.twz", std::process::id()));
        crate::db::save(&path, &s).unwrap();
        let back = crate::db::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(serde_json::to_string(&back).unwrap(), serde_json::to_string(&s).unwrap());
    }

    #[test]
    fn the_large_school_passes_the_setup_and_pre_generation_checks() {
        let s = large_school(1);
        let issues: Vec<_> = s.validate().into_iter().filter(|i| i.level == "error").collect();
        assert!(issues.is_empty(), "{:#?}", issues.iter().take(10).collect::<Vec<_>>());
        let r = crate::check::run(&s);
        let errs: Vec<_> = r.findings.iter().filter(|f| f.level == "error").map(|f| f.message.clone()).collect();
        assert!(errs.is_empty(), "{} errors, first: {:#?}", errs.len(), errs.iter().take(10).collect::<Vec<_>>());
    }
}

// ---------------------------------------------------------------- measurements

pub mod bench {
    use super::*;
    use crate::{check, db, lessons, solver};
    use serde::Serialize;
    use std::sync::atomic::AtomicBool;
    use std::time::{Duration, Instant};

    pub fn ms<T>(f: impl FnOnce() -> T) -> (T, f64) {
        let t = Instant::now();
        let v = f();
        (v, t.elapsed().as_secs_f64() * 1000.0)
    }

    #[derive(Serialize, Clone, Debug)]
    pub struct Dist {
        pub n: usize,
        pub median_ms: f64,
        pub p95_ms: f64,
        pub max_ms: f64,
    }

    pub fn dist(mut v: Vec<f64>) -> Dist {
        v.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let at = |q: f64| v.get(((v.len() as f64 - 1.0) * q).round() as usize).copied().unwrap_or(0.0);
        Dist { n: v.len(), median_ms: at(0.5), p95_ms: at(0.95), max_ms: v.last().copied().unwrap_or(0.0) }
    }

    #[derive(Serialize, Debug, Default)]
    pub struct Report {
        pub classes: usize,
        pub teachers: usize,
        pub rooms: usize,
        pub lessons: usize,
        pub sessions: usize,
        pub periods: usize,
        pub links: usize,
        pub group_lessons: usize,
        pub generate_school_ms: f64,
        pub validate_ms: f64,
        pub check_ms: f64,
        pub check_errors: u32,
        pub check_warnings: u32,
        pub loads_ms: f64,
        pub compile_ms: f64,
        pub cards: usize,
        pub domain_entries: usize,
        pub build_seconds: f64,
        pub build_placed: u32,
        pub build_total: u32,
        pub build_unplaced: usize,
        pub build_penalty: f64,
        pub unplaced_by_subject: BTreeMap<String, usize>,
        pub unplaced_by_shift: BTreeMap<String, usize>,
        pub unplaced_examples: Vec<String>,
        pub improve: Vec<(u64, f64, f64, f64)>, // (seconds asked, before, after, seconds taken)
        pub generate_with_improve_seconds: f64,
        pub generate_with_improve_penalty: f64,
        pub setup_json_bytes: usize,
        pub setup_json_with_timetable_bytes: usize,
        pub timetable_json_bytes: usize,
        pub decode_setup_ms: f64,
        pub file_bytes: u64,
        pub file_bytes_without_timetable: u64,
        pub save_ms: f64,
        pub load_ms: f64,
        pub consistent_ms: f64,
        pub slot_options: Option<Dist>,
        pub swap_options: Option<Dist>,
        pub move_card: Option<Dist>,
        pub swap_cards: Option<Dist>,
        pub notes: Vec<String>,
    }

    fn run_solve(s: &SchoolSetup, improve: Duration, seed: u64) -> solver::SolveReport {
        let o = solver::Options { improve_time: improve, seed, time_limit: Duration::from_secs(120), ..solver::Options::default() };
        solver::solve(s, &[], &o, &AtomicBool::new(false), &mut |_| {})
    }

    /// Writes the large school, with a built (and briefly improved) timetable, to a school file.
    pub fn make_file(seed: u64, pr: Profile, improve_secs: u64, path: &std::path::Path) {
        let mut s = large_school_with(seed, pr);
        let rep = run_solve(&s, Duration::from_secs(improve_secs), 1);
        println!("built {}/{} sessions in {:.1}s", rep.placed, rep.total, rep.seconds);
        s.timetable = Some(rep.timetable);
        db::save(path, &s).unwrap();
        println!("wrote {} ({} bytes)", path.display(), std::fs::metadata(path).unwrap().len());
    }

    fn grade_of(s: &SchoolSetup, lesson: &str) -> u32 {
        let l = s.lessons.iter().find(|l| l.id == lesson).unwrap();
        let c = s.master.classes.iter().find(|c| c.id == l.parts[0].class_id).unwrap();
        c.short_name.trim_end_matches(|ch: char| ch.is_ascii_alphabetic()).parse().unwrap_or(0)
    }
    fn drop_links(s: &mut SchoolSetup, f: impl Fn(u32) -> bool) {
        let keep: Vec<_> = s.links.iter().filter(|k| !f(grade_of(s, &k.lessons[0]))).cloned().collect();
        s.links = keep;
    }

    /// Builds the large school for several random seeds, with and without the repair step.
    pub fn survey(seeds: u64, pr: Profile) -> Vec<(u64, u32, u32, f64, u32, f64)> {
        let mut out = Vec::new();
        for seed in 1..=seeds {
            let s = large_school_with(seed, pr);
            let run = |repair: bool| {
                let o = solver::Options { improve_time: Duration::ZERO, repair, time_limit: Duration::from_secs(120), ..solver::Options::default() };
                solver::solve(&s, &[], &o, &AtomicBool::new(false), &mut |_| {})
            };
            let (plain, fixed) = (run(false), run(true));
            let (vp, vf) = (crate::solver::verify::check(&s, &plain.timetable).len(), crate::solver::verify::check(&s, &fixed.timetable).len());
            println!("school {seed:>2}: plain {}/{} in {:>5.1}s | with repair {}/{} in {:>5.1}s | rule violations: plain {vp}, repaired {vf}", plain.placed, plain.total, plain.seconds, fixed.placed, fixed.total, fixed.seconds);
            for v in crate::solver::verify::check(&s, &plain.timetable).iter().take(3) {
                println!("    violation: {v}");
                // which sessions are on that day?
                let class = v.strip_prefix("class ").and_then(|r| r.split(" has ").next()).unwrap_or("");
                let day: u8 = v.split("on day ").nth(1).and_then(|r| r.split(' ').next()).and_then(|d| d.parse().ok()).unwrap_or(0);
                let cid = s.master.classes.iter().find(|c| c.name == class).map(|c| c.id.clone()).unwrap_or_default();
                for pc in plain.timetable.cards.iter().filter(|pc| pc.day == day) {
                    let l = s.lessons.iter().find(|l| l.id == pc.lesson_id).unwrap();
                    if l.subject == "eng" && l.parts.iter().any(|p| p.class_id == cid) {
                        println!("      {} #{} period {} len {} parts {:?} teachers {:?}", l.id, pc.number, pc.period, pc.length, l.parts.iter().map(|p| (&p.class_id[..], p.group_id.as_deref())).collect::<Vec<_>>(), l.teachers);
                    }
                }
            }
            out.push((seed, plain.total - plain.placed, plain.total, plain.seconds, fixed.total - fixed.placed, fixed.seconds));
        }
        out
    }

    /// Which rule is in the way? Builds the large school with one rule switched off at a time.
    pub fn blockers(school_seed: u64, pr: Profile) {
        let base = large_school_with(school_seed, pr);
        let variants: Vec<(&str, Box<dyn Fn(&mut SchoolSetup)>)> = vec![
            ("as generated", Box::new(|_| {})),
            ("no 'max lessons in a row'", Box::new(|s| s.master.teachers.iter_mut().for_each(|t| t.max_consecutive = None))),
            ("no part-time day limits", Box::new(|s| s.master.teachers.iter_mut().for_each(|t| t.max_days_per_week = None))),
            ("no free days (forbidden cells)", Box::new(|s| s.master.teachers.iter_mut().for_each(|t| t.time_off.retain(|c| c.state != 2)))),
            ("no daily / weekly teacher maximum", Box::new(|s| { s.settings.default_max_per_day = None; s.settings.default_max_per_week = None })),
            ("2 sessions of a subject a day allowed", Box::new(|s| s.settings.max_same_subject_per_day = 2)),
            ("no room pools", Box::new(|s| s.lessons.iter_mut().for_each(|l| l.rooms.clear()))),
            ("no same-time links", Box::new(|s| s.links.clear())),
            ("drop links of grades 11-12", Box::new(|s| drop_links(s, |g| g >= 11))),
            ("drop links of grades 9-10", Box::new(|s| drop_links(s, |g| (9..=10).contains(&g)))),
            ("drop links of grades 6-8", Box::new(|s| drop_links(s, |g| (6..=8).contains(&g)))),
            ("drop links of KG-5 (afternoon)", Box::new(|s| drop_links(s, |g| g <= 5))),
            ("no assembly period", Box::new(|s| s.master.classes.iter_mut().for_each(|c| c.time_off.clear()))),
        ];
        for (name, f) in variants {
            let mut s = base.clone();
            f(&mut s);
            let o = solver::Options { improve_time: Duration::ZERO, seed: 1, time_limit: Duration::from_secs(120), ..solver::Options::default() };
            let r = solver::solve(&s, &[], &o, &AtomicBool::new(false), &mut |_| {});
            println!("{name:<42} placed {}/{} ({} left) in {:.1}s", r.placed, r.total, r.total - r.placed, r.seconds);
        }
    }

    /// Quick experiment: placement only, for a few solver seeds and search depths.
    pub fn build_only(school_seed: u64, pr: Profile) {
        let s = large_school_with(school_seed, pr);
        for (depth, seed) in [(8usize, 1u64)] {
            let _ = ();
            let o = solver::Options { improve_time: Duration::ZERO, seed, max_depth: depth, time_limit: Duration::from_secs(120), repair: std::env::var("TW_NOREPAIR").is_err() };
            let r = solver::solve(&s, &[], &o, &AtomicBool::new(false), &mut |_| {});
            println!("depth {depth} seed {seed}: placed {}/{} in {:.1}s (timed out: {})", r.placed, r.total, r.seconds, r.timed_out);
            if depth == 8 && seed == 1 {
                let mut by: BTreeMap<String, usize> = BTreeMap::new();
                for u in &r.unplaced {
                    let l = s.lessons.iter().find(|l| l.id == u.lesson_id).unwrap();
                    let c = s.master.classes.iter().find(|c| c.id == l.parts[0].class_id).unwrap();
                    *by.entry(format!("{} {}", c.short_name, l.subject)).or_default() += 1;
                }
                println!("  unplaced (class subject): {by:?}");
                // why can't the first few be put anywhere?
                let mut s2 = s.clone();
                s2.timetable = Some(r.timetable.clone());
                let mut seen = std::collections::HashSet::new();
                for u in r.unplaced.iter().take(40) {
                    if !seen.insert(u.title.clone()) { continue; }
                    if seen.len() > 4 { break; }
                    let slots = solver::edit::slot_options(&s2, &u.lesson_id, u.number).unwrap();
                    let open = slots.iter().filter(|x| x.status != "blocked").count();
                    let mut reasons: BTreeMap<String, usize> = BTreeMap::new();
                    for x in slots.iter().filter(|x| x.status == "blocked") {
                        for why in &x.reasons {
                            // "Name is already teaching X." -> keep who
                            let key = why.split(" is already").next().unwrap_or(why).split(" already has").next().unwrap_or(why).to_string();
                            *reasons.entry(key).or_default() += 1;
                        }
                    }
                    let mut top: Vec<_> = reasons.into_iter().collect();
                    top.sort_by_key(|x| std::cmp::Reverse(x.1));
                    println!("  * {} : {} of {} slots open; blocked by {:?}", u.title, open, slots.len(), &top[..top.len().min(6)]);
                }
                for u in r.unplaced.iter().take(4) {
                    println!("  - {}", u.message);
                }
            }
        }
    }

    /// Everything the stress test measures, on a freshly generated school.
    pub fn full(seed: u64, pr: Profile, improve_secs: &[u64], samples: usize, out_file: Option<&std::path::Path>) -> Report {
        let mut r = Report::default();
        let (mut s, t) = ms(|| large_school_with(seed, pr));
        r.generate_school_ms = t;
        let n = counts(&s);
        (r.classes, r.teachers, r.rooms, r.lessons, r.sessions, r.periods, r.links, r.group_lessons) =
            (n.classes, n.teachers, n.rooms, n.lessons, n.sessions, n.periods, n.links, n.group_lessons);

        r.validate_ms = ms(|| s.validate()).1;
        let (c, t) = ms(|| check::run(&s));
        (r.check_ms, r.check_errors, r.check_warnings) = (t, c.errors, c.warnings);
        r.loads_ms = ms(|| lessons::summarize(&s)).1;
        let (cc, t) = ms(|| solver::bench_compile(&s));
        (r.compile_ms, r.cards, r.domain_entries) = (t, cc.1, cc.2);
        let _ = cc.0;

        // ---- build (place every session), without the improving step ----
        let (rep, _) = ms(|| run_solve(&s, Duration::ZERO, 1));
        r.build_seconds = rep.seconds;
        (r.build_placed, r.build_total, r.build_unplaced) = (rep.placed, rep.total, rep.unplaced.len());
        r.build_penalty = rep.quality_before.penalty;
        for u in &rep.unplaced {
            let l = s.lessons.iter().find(|l| l.id == u.lesson_id);
            *r.unplaced_by_subject.entry(l.map_or("?".into(), |l| l.subject.clone())).or_default() += 1;
            let sh = l.and_then(|l| l.parts.first()).and_then(|p| s.master.classes.iter().find(|c| c.id == p.class_id)).map_or("?".into(), |c| c.shift.clone());
            *r.unplaced_by_shift.entry(sh).or_default() += 1;
        }
        r.unplaced_examples = rep.unplaced.iter().take(6).map(|u| format!("{} — {}", u.title, u.message)).collect();
        s.timetable = Some(rep.timetable.clone());
        let placed_timetable = rep.timetable.clone();

        // ---- improve, for increasing times, always starting from the same built timetable ----
        for &secs in improve_secs {
            let mut s2 = s.clone();
            s2.timetable = Some(placed_timetable.clone());
            let ir = solver::improve_timetable(&s2, Duration::from_secs(secs), 7, &AtomicBool::new(false), &mut |_| {});
            r.improve.push((secs, ir.quality_before.penalty, ir.quality_after.penalty, ir.seconds));
        }
        // the full "Build timetable" button: place, then improve for the school's default 20 s
        let (full, _) = ms(|| run_solve(&s, Duration::from_secs(s.settings.improve_seconds as u64), 1));
        r.generate_with_improve_seconds = full.seconds;
        r.generate_with_improve_penalty = full.quality_after.penalty;
        if full.unplaced.is_empty() {
            s.timetable = Some(full.timetable.clone());
        }

        // ---- sizes ----
        let tt = s.timetable.clone().unwrap_or_default();
        r.timetable_json_bytes = serde_json::to_vec(&tt).unwrap().len();
        let with = serde_json::to_string(&s).unwrap();
        r.setup_json_with_timetable_bytes = with.len();
        let mut bare = s.clone();
        bare.timetable = None;
        r.setup_json_bytes = serde_json::to_string(&bare).unwrap().len();
        r.decode_setup_ms = ms(|| serde_json::from_str::<SchoolSetup>(&with).unwrap()).1;
        let dir = std::env::temp_dir().join(format!("tw-stress-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("school.twz");
        r.save_ms = ms(|| db::save(&f, &s).unwrap()).1;
        r.file_bytes = std::fs::metadata(&f).unwrap().len();
        r.load_ms = ms(|| db::load(&f).unwrap()).1;
        let f2 = dir.join("bare.twz");
        db::save(&f2, &bare).unwrap();
        r.file_bytes_without_timetable = std::fs::metadata(&f2).unwrap().len();
        if let Some(p) = out_file {
            std::fs::copy(&f, p).unwrap();
        }
        let _ = std::fs::remove_dir_all(&dir);

        // ---- what runs while someone edits the timetable by hand ----
        r.consistent_ms = ms(|| solver::edit::is_consistent(&s)).1;
        let mut rng = Rng::new(99);
        let placed: Vec<_> = tt.cards.iter().filter(|c| !c.locked).cloned().collect();
        if placed.is_empty() {
            r.notes.push("no complete timetable to edit".into());
            return r;
        }
        let (mut so, mut sw, mut mv, mut sc) = (vec![], vec![], vec![], vec![]);
        for _ in 0..samples {
            let c = &placed[rng.below(placed.len())];
            let (opts, t) = ms(|| solver::edit::slot_options(&s, &c.lesson_id, c.number));
            so.push(t);
            let (swaps, t) = ms(|| solver::edit::swap_options(&s, &c.lesson_id, c.number));
            sw.push(t);
            if let Ok(o) = opts {
                if let Some(g) = o.iter().find(|x| x.status == "ok" && !(x.day == c.day && x.period == c.period)) {
                    mv.push(ms(|| solver::edit::move_card(&s, &c.lesson_id, c.number, g.day, g.period, None)).1);
                }
            }
            if let Ok(w) = swaps {
                if let Some(o) = w.iter().find(|x| x.ok) {
                    sc.push(ms(|| solver::edit::swap_cards(&s, &c.lesson_id, c.number, &o.lesson_id, o.number)).1);
                }
            }
        }
        (r.slot_options, r.swap_options, r.move_card, r.swap_cards) = (Some(dist(so)), Some(dist(sw)), Some(dist(mv)), Some(dist(sc)));
        r
    }
}

#[cfg(test)]
mod tightness {
    use super::*;

    /// Prints how full the school is. Run with `--nocapture`; it never fails.
    #[test]
    fn how_tight_is_the_large_school() {
        let s = large_school(1);
        let sum = crate::lessons::summarize(&s);
        let pct = |l: &crate::lessons::Load| l.used as f64 / l.available.max(1) as f64 * 100.0;
        let mut cl: Vec<f64> = sum.classes.iter().map(pct).collect();
        cl.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let mut te: Vec<(f64, &str, u32, u32)> = sum.teachers.iter().filter(|t| t.used > 0).map(|t| (pct(t), t.name.as_str(), t.used, t.available)).collect();
        te.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
        eprintln!("class fill %: min {:.0} median {:.0} max {:.0}", cl[0], cl[cl.len() / 2], cl[cl.len() - 1]);
        eprintln!("teachers over 90%: {}, over 100%: {}", te.iter().filter(|t| t.0 > 90.0).count(), te.iter().filter(|t| t.0 > 100.0).count());
        for t in te.iter().take(8) {
            eprintln!("  {} {}/{} = {:.0}%", t.1, t.2, t.3, t.0);
        }
        // per subject: how many teachers, how loaded are they together?
        let mut by_sub: BTreeMap<String, (usize, u32, u32, f64)> = BTreeMap::new();
        for t in s.master.teachers.iter() {
            let load = sum.teachers.iter().find(|l| l.id == t.id).unwrap();
            let mut subs: Vec<&str> = s.lessons.iter().filter(|l| l.teachers.contains(&t.id)).map(|l| l.subject.as_str()).collect();
            subs.sort();
            subs.dedup();
            if subs.len() == 1 && load.used > 0 {
                let e = by_sub.entry(format!("{}{}", subs[0], if t.shifts.len() > 1 { "*" } else { "" })).or_default();
                e.0 += 1;
                e.1 += load.used;
                e.2 += load.available;
                e.3 = e.3.max(load.used as f64 / load.available.max(1) as f64 * 100.0);
            }
        }
        for (k, (n, used, avail, worst)) in &by_sub {
            eprintln!("  subject {k:<5} {n:>3} teachers  {used:>4}/{avail:<4} = {:>3.0}%  busiest teacher {worst:.0}%", *used as f64 / *avail as f64 * 100.0);
        }
        let mean = te.iter().map(|t| t.0).sum::<f64>() / te.len() as f64;
        eprintln!("teachers with lessons: {}, mean fill {:.0}%", te.len(), mean);
        // rooms
        for (kind, prefix) in [("Physics", "Physics Lab"), ("Chemistry", "Chemistry Lab"), ("Biology", "Biology Lab"), ("Computer", "Computer Lab"), ("Art", "Art Room"), ("Music", "Music Room"), ("Library", "Library"), ("Sports", "Sports Area"), ("Classrooms", "Classroom")] {
            let rooms: Vec<_> = s.master.rooms.iter().filter(|r| r.name.starts_with(prefix)).collect();
            let ids: Vec<&str> = rooms.iter().map(|r| r.id.as_str()).collect();
            let cap: u32 = rooms.iter().map(|r| Profile::NORMAL.slots() as u32 - r.time_off.len() as u32 / 2).sum::<u32>();
            for shift in [MORNING, AFTERNOON] {
                let demand: u32 = s.lessons.iter().filter(|l| !l.rooms.is_empty() && l.rooms.iter().all(|r| ids.contains(&r.as_str())) && s.master.classes.iter().find(|c| c.id == l.parts[0].class_id).unwrap().shift == shift).map(|l| l.periods_per_card * l.cards_per_week).sum();
                if demand > 0 {
                    eprintln!("  {kind} ({} rooms) {shift}: {demand} periods of {cap} = {:.0}%", rooms.len(), demand as f64 / cap as f64 * 100.0);
                }
            }
        }
    }
}
