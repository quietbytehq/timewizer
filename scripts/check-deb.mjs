// Stops a release when the .deb cannot open a .twz file by double-click.
//   node scripts/check-deb.mjs path/to/Timewizer_x.y.z_amd64.deb
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const deb = process.argv[2]
if (!deb) {
  console.error('Usage: node scripts/check-deb.mjs <file.deb>')
  process.exit(1)
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-deb-'))
try {
  execFileSync('dpkg-deb', ['-x', deb, dir])
  const desktop = fs.readFileSync(path.join(dir, 'usr/share/applications/Timewizer.desktop'), 'utf8')
  const mime = path.join(dir, 'usr/share/mime/packages/io.github.quietbytehq.timewizer.xml')
  const problems = []
  if (!/^Exec=timewizer %f$/m.test(desktop)) problems.push('the .desktop file does not pass the file (Exec=timewizer %f)')
  if (!/^MimeType=application\/x-timewizer;$/m.test(desktop)) problems.push('the .desktop file does not claim application/x-timewizer')
  if (!fs.existsSync(mime)) problems.push('the MIME file for *.twz is missing')
  else if (!fs.readFileSync(mime, 'utf8').includes('<glob pattern="*.twz"/>')) problems.push('the MIME file does not match *.twz')
  if (problems.length) {
    console.error(`${path.basename(deb)}:\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`${path.basename(deb)}: double-clicking a .twz file opens it in Timewizer.`)
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
