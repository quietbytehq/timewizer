// Builds the installers for the computer you are on and gathers them in ./release with checksums.
//   npm run release          (Linux: .deb + AppImage;  Windows: .exe installer + .msi)
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const win = process.platform === 'win32'
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', shell: win })
const bundle = 'src-tauri/target/release/bundle'

const plan = win
  ? { bundles: 'nsis,msi', sums: 'SHA256SUMS-windows.txt', want: [['nsis', '.exe'], ['msi', '.msi']] }
  : { bundles: 'deb,appimage', sums: 'SHA256SUMS-linux.txt', want: [['deb', '.deb'], ['appimage', '.AppImage']] }

if (process.platform === 'darwin') {
  console.error('Installers are only set up for Linux and Windows.')
  process.exit(1)
}
run('node', ['scripts/check-cargo.mjs'])
run('npx', ['tauri', 'build', '--bundles', plan.bundles])

const found = []
for (const [dir, ext] of plan.want) {
  const d = path.join(bundle, dir)
  const files = fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith(ext)) : []
  if (files.length === 0) {
    console.error(`Expected a ${ext} file in ${d} but found none.`)
    process.exit(1)
  }
  found.push(...files.map(f => path.join(d, f)))
}
fs.mkdirSync('release', { recursive: true })
for (const f of fs.readdirSync('release')) if (f.endsWith(plan.want[0][1]) || f.endsWith(plan.want[1][1]) || f === plan.sums) fs.rmSync(path.join('release', f))
const sums = []
for (const f of found) {
  const dest = path.join('release', path.basename(f))
  fs.copyFileSync(f, dest)
  sums.push(`${createHash('sha256').update(fs.readFileSync(dest)).digest('hex')}  ${path.basename(f)}`)
  console.log(`${dest}  (${(fs.statSync(dest).size / 1048576).toFixed(1)} MB)`)
}
fs.writeFileSync(path.join('release', plan.sums), sums.join('\n') + '\n')
console.log('\nDone. Files are in ./release')
