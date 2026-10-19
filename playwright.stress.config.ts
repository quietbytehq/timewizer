import { defineConfig } from '@playwright/test'

// Stress test for a large school. Same idea as playwright.config.ts (real Rust logic through the
// local bridge), but the bridge is built in release mode so the timings mean something.
//   npm run build && npm run test:stress
const PORT = 4311
export default defineConfig({
  testDir: 'tests/stress',
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || (process.platform === 'linux' ? '/opt/pw-browsers/chromium' : undefined) },
  },
  outputDir: 'tests/stress/.results',
  webServer: {
    command: `cargo run --release --manifest-path src-tauri/Cargo.toml --features uitest --bin uibridge -- dist ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: true,
    timeout: 900_000,
  },
})
