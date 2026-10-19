// Times the large school in a real browser engine, from inside the page, with no test framework:
//   npm run build && npm run bench:webkit            (WebKitGTK's MiniBrowser, the engine the Ubuntu app uses)
//   npm run bench:webkit -- --chromium               (Chromium, for comparison)
// Needs: the release build of the bridge (made here), Xvfb (if there is no screen), and for WebKit the
// package libwebkit2gtk-4.1 (its MiniBrowser). Options: --school <file.twz> to use your own school.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = n => args.includes(n)
const value = n => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined)
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'timewizer-bench-'))
const run = (cmd, a, o = {}) => execFileSync(cmd, a, { stdio: 'inherit', ...o })
const procs = []
const stop = () => procs.forEach(p => { try { p.kill() } catch { /* already gone */ } })
process.on('exit', stop)

run('cargo', ['build', '--release', '--manifest-path', 'src-tauri/Cargo.toml', '--features', 'uitest', '--bin', 'uibridge', '--bin', 'stress'])
let school = value('--school')
if (!school) {
  school = path.join(work, 'Large-School.twz')
  run('src-tauri/target/release/stress', ['--improve', '3', '--make-file', school])
}
const site = path.join(work, 'site')
run('node', ['scripts/bench-site.mjs', site])
const port = 4320 + Math.floor(Math.random() * 500)
procs.push(spawn('src-tauri/target/release/uibridge', [site, String(port)], { stdio: 'ignore' }))
await new Promise(r => setTimeout(r, 800))
const out = path.join(work, 'results.json')
const url = `http://127.0.0.1:${port}/bench.html?file=${encodeURIComponent(school)}&out=${encodeURIComponent(out)}`

if (flag('--chromium')) {
  const { chromium } = await import('@playwright/test')
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (process.platform === 'linux' ? '/opt/pw-browsers/chromium' : undefined) })
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await page.goto(url)
  await page.waitForSelector('body[data-bench=done]', { timeout: 600_000 })
  await browser.close()
} else {
  const mb = ['/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser', '/usr/lib/webkit2gtk-4.1/MiniBrowser', '/usr/lib/aarch64-linux-gnu/webkit2gtk-4.1/MiniBrowser'].find(p => fs.existsSync(p))
  if (!mb) throw new Error('WebKitGTK MiniBrowser not found (install libwebkit2gtk-4.1-0), or use --chromium')
  const env = { ...process.env, WEBKIT_DISABLE_COMPOSITING_MODE: '1' }
  if (!env.DISPLAY) {
    env.DISPLAY = ':97'
    procs.push(spawn('Xvfb', [':97', '-screen', '0', '1600x1000x24'], { stdio: 'ignore' }))
    await new Promise(r => setTimeout(r, 1000))
  }
  procs.push(spawn(mb, ['-f', url], { stdio: 'ignore', env }))
  for (let i = 0; i < 600 && !fs.existsSync(out); i++) await new Promise(r => setTimeout(r, 1000))
}
await new Promise(r => setTimeout(r, 300))
const res = JSON.parse(fs.readFileSync(out, 'utf8'))
console.log(`\nEngine: ${res.engine}\n${res.ok ? 'Finished.' : 'FAILED: ' + res.error}\n`)
for (const [k, v] of Object.entries(res.steps)) if (!k.includes('slowest') && !k.includes('stall')) console.log(`${v.toFixed(0).padStart(7)} ms  ${k}`)
console.log('\nSlowest frame / worst event-loop stall (ms):')
const worst = Object.entries(res.steps).filter(([k]) => k.includes('slowest') || k.includes('stall')).sort((a, b) => b[1] - a[1]).slice(0, 6)
for (const [k, v] of worst) console.log(`${v.toFixed(0).padStart(7)} ms  ${k}`)
stop()
process.exit(res.ok ? 0 : 1)
