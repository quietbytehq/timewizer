// Guards against `npm run tauri dev` breaking again: with more than one binary in the Rust
// package, Cargo needs `default-run` to know which one is the app.
import { execFileSync } from 'node:child_process'

const meta = JSON.parse(execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml'], { encoding: 'utf8' }))
const pkg = meta.packages.find(p => p.name === 'timewizer')
const bins = pkg.targets.filter(t => t.kind.includes('bin')).map(t => t.name)
const problems = []
if (bins.length > 1 && pkg.default_run !== 'timewizer') {
  problems.push(`src-tauri/Cargo.toml has several binaries (${bins.join(', ')}) but default-run is "${pkg.default_run ?? ''}". Add: default-run = "timewizer"`)
}
if (!bins.includes('timewizer')) problems.push('The app binary "timewizer" is missing.')
if (problems.length) {
  console.error('Cargo setup problem:\n - ' + problems.join('\n - '))
  process.exit(1)
}
console.log(`Cargo setup ok (binaries: ${bins.join(', ')}; default-run: ${pkg.default_run})`)
