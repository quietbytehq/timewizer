// Stops a release when the version is not the same everywhere (and the store files are stale).
//   npm run check:versions
import fs from 'node:fs'

const read = f => fs.readFileSync(f, 'utf8')
const pkg = JSON.parse(read('package.json')).version
const found = {
  'package.json': pkg,
  'package-lock.json': JSON.parse(read('package-lock.json')).version,
  'src-tauri/tauri.conf.json': JSON.parse(read('src-tauri/tauri.conf.json')).version,
  'src-tauri/Cargo.toml': read('src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1],
  'AppStream (newest release)': read('packaging/linux/io.github.quietbytehq.timewizer.metainfo.xml').match(/<release version="([^"]+)"/)?.[1],
  'Flatpak (git tag)': read('packaging/flatpak/io.github.quietbytehq.timewizer.yml').match(/tag: v([\d.]+)/)?.[1],
}
const bad = Object.entries(found).filter(([, v]) => v !== pkg)
if (bad.length) {
  console.error(`The version is ${pkg} in package.json, but:`)
  for (const [f, v] of bad) console.error(`  ${f}: ${v ?? 'not found'}`)
  process.exit(1)
}
console.log(`Version ${pkg} is the same everywhere.`)
