//! Serves the built front end and the app's real Rust commands over HTTP, so Playwright can
//! drive the whole app in a browser. Usage: uibridge <dist folder> <port>
fn main() {
    let mut args = std::env::args().skip(1);
    let dist = args.next().unwrap_or_else(|| "../dist".into());
    let port: u16 = args.next().and_then(|p| p.parse().ok()).unwrap_or(4310);
    timewizer_lib::bridge::serve(&dist, port);
}
