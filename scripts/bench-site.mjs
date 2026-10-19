// Builds the small folder the in-page benchmark runs from: the built app (dist/) plus the Tauri
// stand-in, the driver and a start page. Usage: node scripts/bench-site.mjs <output folder>
import fs from 'node:fs'
import path from 'node:path'

const out = path.resolve(process.argv[2] ?? 'tests/stress/.results/bench-site')
const dist = path.resolve(process.argv[3] ?? 'dist')
fs.rmSync(out, { recursive: true, force: true })
fs.cpSync(dist, out, { recursive: true })
fs.copyFileSync('tests/ui/tauri-shim.js', path.join(out, 'tauri-shim.js'))
fs.copyFileSync('tests/stress/bench-driver.js', path.join(out, 'bench-driver.js'))
const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const js = /src="([^"]+index-[^"]+\.js)"/.exec(index)?.[1]
const css = /href="([^"]+index-[^"]+\.css)"/.exec(index)?.[1]
if (!js || !css) throw new Error('could not find the built app files in index.html of the app folder')
fs.writeFileSync(path.join(out, 'bench.html'), fs.readFileSync('tests/stress/bench.html', 'utf8').replace('__APP_JS__', js).replace('__APP_CSS__', css))
console.log(out)
