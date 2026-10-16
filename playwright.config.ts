import { defineConfig } from '@playwright/test'

// The UI tests drive the real front end in Chromium. The app's commands are answered by the
// real Rust logic through a small local bridge (src-tauri/src/bridge.rs), so a test that builds
// a timetable runs the real solver.
const PORT = 4310
export default defineConfig({
  testDir: 'tests/ui',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1, // the bridge holds one open school at a time
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || (process.platform === 'linux' ? '/opt/pw-browsers/chromium' : undefined) },
    trace: 'retain-on-failure',
  },
  outputDir: 'tests/ui/.results',
  webServer: {
    command: `cargo run --manifest-path src-tauri/Cargo.toml --features uitest --bin uibridge -- dist ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: true,
    timeout: 600_000,
  },
})
