//! Stress test: builds a large double-shift school and measures the generator and the editing
//! commands. Usage: stress [--seed N] [--tight] [--build-only] [--improve 5,20] [--samples N] [--out school.twz] [--json report.json]
fn main() {
    let mut seed = timewizer_lib::stress::TYPICAL_SEED;
    let mut improve: Vec<u64> = vec![5, 20];
    let mut samples = 20usize;
    let (mut out, mut json): (Option<String>, Option<String>) = (None, None);
    let mut profile = timewizer_lib::stress::Profile::NORMAL;
    let mut a = std::env::args().skip(1);
    while let Some(k) = a.next() {
        match k.as_str() {
            "--seed" => seed = a.next().and_then(|v| v.parse().ok()).unwrap_or(timewizer_lib::stress::TYPICAL_SEED),
            "--improve" => improve = a.next().unwrap_or_default().split(',').filter_map(|v| v.parse().ok()).collect(),
            "--samples" => samples = a.next().and_then(|v| v.parse().ok()).unwrap_or(20),
            "--out" => out = a.next(),
            "--json" => json = a.next(),
            "--tight" => profile = timewizer_lib::stress::Profile::TIGHT,
            _ => {}
        }
    }
    if let Some(path) = std::env::args().skip_while(|a| a != "--make-file").nth(1) {
        timewizer_lib::stress::bench::make_file(seed, profile, improve.first().copied().unwrap_or(5), std::path::Path::new(&path));
        return;
    }
    if let Some(n) = std::env::args().skip_while(|a| a != "--survey").nth(1).and_then(|v| v.parse().ok()) {
        timewizer_lib::stress::bench::survey(n, profile);
        return;
    }
    if std::env::args().any(|a| a == "--blockers") {
        timewizer_lib::stress::bench::blockers(seed, profile);
        return;
    }
    if std::env::args().any(|a| a == "--build-only") {
        timewizer_lib::stress::bench::build_only(seed, profile);
        return;
    }
    let r = timewizer_lib::stress::bench::full(seed, profile, &improve, samples, out.as_deref().map(std::path::Path::new));
    let text = serde_json::to_string_pretty(&r).unwrap();
    if let Some(j) = json {
        std::fs::write(j, &text).unwrap();
    }
    println!("{text}");
}
