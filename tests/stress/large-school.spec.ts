import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cellsWhere, go, openApp, pickView, setDialog } from '../ui/helpers'

// A large double-shift school (120 classes, 220 teachers, 60 rooms, about 4,500 lesson sessions)
// is made by `cargo run --release --bin stress -- --make-file`, opened through the real app, and
// the places where a person would feel slowness are timed inside the page: opening, the Master
// view, zoom, scrolling, picking up a lesson (the green / yellow / red slots), moving it, dropping it.
// The budgets are generous on purpose: they catch the old multi-second stalls, not small noise.
const results: Record<string, number> = {}
let schoolFile = ''

test.beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timewizer-stress-'))
  schoolFile = path.join(dir, 'Large-School.twz')
  execFileSync('cargo', ['run', '--release', '--manifest-path', 'src-tauri/Cargo.toml', '--features', 'uitest', '--bin', 'stress', '--', '--improve', '3', '--make-file', schoolFile], { stdio: 'inherit', timeout: 900_000 })
})

test.afterAll(() => {
  const out = path.resolve('tests/stress/.results/ui-metrics.json')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(results, null, 2))
  console.log('\nUI timings (ms):\n' + Object.entries(results).map(([k, v]) => `  ${k.padEnd(52)} ${v.toFixed(0).padStart(6)}`).join('\n'))
})

/** Runs in the page before anything else: records long tasks, frame gaps, command round trips and drag events. */
function installMonitor() {
  const w = window as any
  w.__long = [] as number[]
  w.__gaps = [] as number[]
  w.__ipc = [] as { cmd: string; ms: number; at: number }[]
  w.__mark = {} as Record<string, number>
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) w.__long.push(e.duration) }).observe({ entryTypes: ['longtask'] }) } catch { /* not available */ }
  let last = performance.now()
  const tick = (t: number) => { w.__gaps.push(t - last); last = t; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  const paint = (cb: () => void) => requestAnimationFrame(() => requestAnimationFrame(cb))
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input: any, init?: any) => {
    const t0 = performance.now()
    const res = await realFetch(input, init)
    if (String(input).endsWith('/invoke') && init?.body) {
      const cmd = JSON.parse(init.body).cmd
      const t1 = performance.now()
      w.__ipc.push({ cmd, ms: t1 - t0, at: t1 })
      if (cmd === 'move_card' || cmd === 'swap_cards') paint(() => { w.__mark.moved = performance.now() })
    }
    return res
  }
  document.addEventListener('dragstart', () => { w.__mark.dragstart = performance.now(); w.__mark.lit = 0 }, true)
  document.addEventListener('drop', () => { w.__mark.drop = performance.now(); w.__mark.moved = 0 }, true)
  new MutationObserver(() => {
    if (w.__mark.dragstart && !w.__mark.lit && document.querySelector('td div[style*="outline"]')) w.__mark.lit = performance.now()
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['style'], childList: true })
}

async function reset(page: Page) {
  await page.evaluate(() => { const w = window as any; w.__long.length = 0; w.__gaps.length = 0; w.__ipc.length = 0 })
}
async function jank(page: Page, name: string) {
  const m = await page.evaluate(() => {
    const w = window as any
    const gaps: number[] = w.__gaps.slice(1)
    return { longest: Math.max(0, ...w.__long), worstFrame: Math.max(0, ...gaps), frames: gaps.length }
  })
  results[`${name} · longest main-thread block`] = m.longest
  results[`${name} · slowest frame`] = m.worstFrame
}
/** Runs `action`, waits until the page has painted, and records the time and jank. */
async function timed<T>(page: Page, name: string, action: () => Promise<T>): Promise<T> {
  await reset(page)
  const t0 = await page.evaluate(() => performance.now())
  const r = await action()
  const t1 = await page.evaluate(() => new Promise<number>(res => requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now())))))
  results[name] = t1 - t0
  await jank(page, name)
  return r
}
const ipc = (page: Page, cmd: string) => page.evaluate(c => ((window as any).__ipc as { cmd: string; ms: number }[]).filter(x => x.cmd === c).map(x => x.ms), cmd)

test('the large school opens, shows its Master view and can be edited by hand without stalls', async ({ page }) => {
  await page.addInitScript(installMonitor)
  const errors = await openApp(page)
  await setDialog(page, { open: schoolFile })
  await timed(page, 'open the school file', async () => {
    await page.getByRole('button', { name: 'Open file…' }).click()
    await expect(page.getByText(/Crescent Double-Shift School/).first()).toBeVisible()
  })

  await timed(page, 'go to the Timetable page', async () => {
    await go(page, 'Timetable')
    await expect(page.getByRole('heading', { name: 'Timetable', exact: true })).toBeVisible()
  })
  await timed(page, 'class view -> Master view', async () => {
    await pickView(page, 'Master')
    await expect(page.getByRole('rowheader', { name: '6A', exact: true })).toBeVisible()
  })
  await timed(page, 'zoom in once', async () => { await page.getByRole('button', { name: 'Zoom in' }).click() })
  await timed(page, 'zoom out once', async () => { await page.getByRole('button', { name: 'Zoom out' }).click() })
  await timed(page, 'Master: morning -> afternoon shift', async () => {
    await page.getByLabel('Shift').selectOption({ label: 'Afternoon shift' })
    await expect(page.getByRole('rowheader', { name: 'KGA', exact: true })).toBeVisible()
  })
  await page.getByLabel('Shift').selectOption({ label: 'Morning shift' })
  await expect(page.getByRole('rowheader', { name: '6A', exact: true })).toBeVisible()

  // scrolling the whole grid top to bottom, one wheel notch at a time
  await page.locator('div.overflow-auto').first().hover()
  await reset(page)
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 150); await page.waitForTimeout(20) }
  await jank(page, 'scroll the Master grid (40 wheel notches)')
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('div.overflow-auto')!.scrollTop = 0 })
  await expect(page.getByRole('rowheader', { name: '6A', exact: true })).toBeVisible()

  // pick up a lesson: the slots turn green / yellow / red. A full school has many lessons with nowhere
  // free to go, so try plain classroom lessons until one has a free (green) slot, like a person would.
  const greenCells = cellsWhere(page, 'success').filter({ hasNot: page.locator('[draggable]') })
  let pickedUp = false
  for (let i = 0; i < 40 && !pickedUp; i++) {
    const chip = page.locator('div[draggable="true"][title^="Mathematics "], div[draggable="true"][title^="English "], div[draggable="true"][title^="Urdu "]').nth(i * 7)
    await chip.scrollIntoViewIfNeeded()
    const b = (await chip.boundingBox())!
    await page.mouse.move(b.x + Math.min(20, b.width / 2), b.y + Math.min(10, b.height / 2))
    await reset(page)
    await page.mouse.down()
    await page.mouse.move(b.x + Math.min(30, b.width / 2 + 5), b.y + Math.min(18, b.height / 2 + 5), { steps: 3 })
    await expect(page.locator('td div[style*="outline"]').first()).toBeVisible({ timeout: 60_000 })
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    pickedUp = (await greenCells.count()) > 0
    if (!pickedUp) { await page.mouse.up(); await page.waitForTimeout(100) }
  }
  expect(pickedUp, 'found a lesson with a free slot').toBe(true)
  results['drag: pick up -> slots coloured'] = await page.evaluate(() => { const m = (window as any).__mark; return m.lit - m.dragstart })
  results['  slot_options round trip'] = Math.max(0, ...(await ipc(page, 'slot_options')))
  results['  swap_options round trip'] = Math.max(0, ...(await ipc(page, 'swap_options')))
  await jank(page, 'drag: pick up')

  const green = greenCells
  await expect(green.first()).toBeVisible()
  await green.first().scrollIntoViewIfNeeded()
  const g = (await green.first().boundingBox())!
  await timed(page, 'drag: move across the grid (25 steps)', async () => {
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2, { steps: 25 })
  })
  await reset(page)
  await page.mouse.up()
  await page.waitForFunction(() => (window as any).__mark.moved > 0)
  results['drop -> lesson moved and grid repainted'] = await page.evaluate(() => { const m = (window as any).__mark; return m.moved - m.drop })
  results['  move_card round trip'] = Math.max(0, ...(await ipc(page, 'move_card')))
  await page.waitForFunction(() => (window as any).__ipc.some((x: any) => x.cmd === 'timetable_consistent'))
  results['  timetable_consistent round trip (after each change)'] = Math.max(0, ...(await ipc(page, 'timetable_consistent')))
  await page.waitForFunction(() => (window as any).__ipc.some((x: any) => x.cmd === 'validate_setup'))
  results['  validate_setup round trip (after each change)'] = Math.max(0, ...(await ipc(page, 'validate_setup')))
  await jank(page, 'drop')
  await timed(page, 'undo', async () => { await page.getByRole('button', { name: 'Undo' }).click() })

  // a second drag right after must be just as quick
  const chip2 = page.locator('div[draggable="true"][title^="English "]').nth(3)
  await chip2.scrollIntoViewIfNeeded()
  const c2 = (await chip2.boundingBox())!
  await page.mouse.move(c2.x + Math.min(20, c2.width / 2), c2.y + Math.min(10, c2.height / 2))
  await page.mouse.down()
  await page.mouse.move(c2.x + Math.min(30, c2.width / 2 + 5), c2.y + Math.min(18, c2.height / 2 + 5), { steps: 3 })
  await expect(page.locator('td div[style*="outline"]').first()).toBeVisible({ timeout: 60_000 })
  results['drag again: pick up -> slots coloured'] = await page.evaluate(() => { const m = (window as any).__mark; return m.lit - m.dragstart })
  await page.mouse.up()

  const worst = Math.max(...Object.entries(results).filter(([k]) => k.endsWith('longest main-thread block')).map(([, v]) => v))
  results['WORST main-thread block anywhere'] = worst
  expect(errors).toEqual([])
  // Budgets (ms). Before the fixes these were 20,000-40,000 (commands) and 1,000-2,000 (page).
  expect(results['drag: pick up -> slots coloured']).toBeLessThan(1000)
  expect(results['drop -> lesson moved and grid repainted']).toBeLessThan(1000)
  expect(results['class view -> Master view']).toBeLessThan(1500)
  expect(results['zoom in once']).toBeLessThan(1000)
  expect(worst).toBeLessThan(600)
})

test('every page of the app opens quickly with the large school loaded', async ({ page }) => {
  await page.addInitScript(installMonitor)
  const errors = await openApp(page)
  await setDialog(page, { open: schoolFile })
  await page.getByRole('button', { name: 'Open file…' }).click()
  await expect(page.getByText(/Crescent Double-Shift School/).first()).toBeVisible()
  const pages = ['School', 'Working days', 'Shifts & bells', 'Rules & limits', 'Subjects', 'Teachers', 'Classes', 'Rooms', 'Lessons', 'Workload',
    'Import data', 'Check before building', 'Build timetable', 'Timetable', 'Print & export']
  const slowest: [string, number][] = []
  for (const name of pages) {
    await timed(page, `page: ${name}`, async () => { await go(page, name) })
    slowest.push([name, results[`page: ${name}`]])
  }
  // typing in a long list (the Lessons page has about 1,800 rows) must not lag either
  await go(page, 'Lessons')
  const worst = Math.max(...slowest.map(([, v]) => v))
  results['WORST page opening'] = worst
  expect(errors).toEqual([])
  expect(worst).toBeLessThan(2500)
})
