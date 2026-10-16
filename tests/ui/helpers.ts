import { expect, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const SAMPLES = path.resolve('samples')
export const SAMPLE_FILES = ['subjects', 'teachers', 'rooms', 'classes', 'lessons'].map(k => path.join(SAMPLES, `${k}.csv`))
// Screenshots are written to docs/screenshots only when UPDATE_SHOTS=1; otherwise they go to a scratch folder.
export const SHOTS = process.env.UPDATE_SHOTS ? path.resolve('docs/screenshots') : path.resolve('tests/ui/.results/screenshots')

export type Theme = 'light' | 'dark'

/** Opens the app in the browser with the Tauri shell replaced by the Rust bridge. */
export async function openApp(page: Page, theme: Theme = 'light') {
  await page.addInitScript({ path: 'tests/ui/tauri-shim.js' })
  await page.addInitScript(`try { if (!localStorage.getItem('timewizer-theme')) localStorage.setItem('timewizer-theme', '${theme}') } catch {}`)
  await page.emulateMedia({ colorScheme: theme })
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/')
  return errors
}

export async function setDialog(page: Page, d: { open?: string | string[] | null; save?: string | null }) {
  await page.evaluate(v => Object.assign((window as any).__twDialog, v), d)
}

export function tmpFile(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timewizer-ui-'))
  return path.join(dir, `${name}.twz`)
}

export const nav = (page: Page, label: string | RegExp) => page.getByRole('navigation').getByRole('button', { name: label, exact: typeof label === 'string' })

export async function go(page: Page, label: string | RegExp) {
  await nav(page, label).click()
}

/** New school through the welcome screen. */
export async function newSchool(page: Page, name = 'Riverside Test School') {
  const file = tmpFile(name.replace(/\W+/g, '-'))
  await setDialog(page, { save: file })
  await page.getByPlaceholder('e.g. Riverside Secondary School').fill(name)
  await page.getByRole('button', { name: 'Create school' }).click()
  await expect(page.getByRole('heading', { name: 'About the school' })).toBeVisible()
  return file
}

/** Imports the five sample CSV files through the Import page. */
export async function importSample(page: Page) {
  await go(page, 'Import data')
  await setDialog(page, { open: SAMPLE_FILES })
  await page.getByRole('button', { name: 'Choose files…' }).click()
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(page.getByText(/Added 9 subjects, 9 teachers, 7 rooms, 4 classes and 36 lessons/)).toBeVisible()
}

/** Sets how long the improving step runs (short, so tests stay quick). */
export async function setImproveSeconds(page: Page, seconds: number) {
  await go(page, 'Rules & limits')
  const box = page.getByLabel('Time spent improving (seconds)')
  await box.fill(String(seconds))
}

export async function buildTimetable(page: Page) {
  await go(page, 'Build timetable')
  await page.locator('section').getByRole('button', { name: /Build (again|timetable)/ }).click()
  await expect(page.getByText(/All \d+ lesson sessions are placed/)).toBeVisible({ timeout: 60_000 })
}

/** New school + sample data + a built timetable. */
export async function sampleSchool(page: Page, { build = true, theme = 'light' as Theme } = {}) {
  const errors = await openApp(page, theme)
  await newSchool(page)
  await importSample(page)
  await setImproveSeconds(page, 1)
  if (build) await buildTimetable(page)
  return errors
}

export async function shot(page: Page, theme: Theme, name: string, opts: { target?: Locator; full?: boolean } = {}) {
  const { target, full = true } = opts
  await page.mouse.move(0, 0).catch(() => {})
  await page.waitForTimeout(550) // let fade-in animations finish
  const dir = path.join(SHOTS, theme)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.png`)
  if (target) await target.screenshot({ path: file })
  else await page.screenshot({ path: file, fullPage: full })
}

export async function openTimetable(page: Page) {
  await go(page, 'Timetable')
  await expect(page.getByRole('heading', { name: 'Timetable', exact: true })).toBeVisible()
}

/** A lesson chip on the timetable grid, by its subject short name and day/period (class view). */
export const chips = (page: Page) => page.locator('[draggable="true"], [draggable="false"]')

/** Real mouse drag of one element onto another, waiting for the green/yellow/red highlighting. */
export async function dragTo(page: Page, from: Locator, to: Locator, { waitHighlight = true } = {}) {
  const a = (await from.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 })
  if (waitHighlight) await expect(page.locator('[style*="outline"]').first()).toBeVisible()
  const b = (await to.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
}

/** "row:col" of the table cell holding an element, so a lesson's place can be compared. */
export function cellOf(el: Locator) {
  return el.evaluate(node => {
    const td = node.closest('td')!
    return `${(td.parentElement as HTMLTableRowElement).rowIndex}:${td.cellIndex}`
  })
}

/** Highlighted cells while dragging: ok (green), soft (yellow), blocked (red). */
export const cellsWhere = (page: Page, kind: 'success' | 'warning' | 'danger') => page.locator(`td div:not([draggable])[style*="outline"][style*="var(--${kind})"]`)

/** The lesson chip on a grid with a given subject name, nth occurrence. */
export const lessonChip = (page: Page, subject: string, nth = 0) => page.locator(`div[draggable][title^="${subject} "]`).nth(nth)

export async function pickView(page: Page, view: 'Class' | 'Teacher' | 'Room' | 'Master') {
  await page.getByRole('tab', { name: view, exact: true }).click()
}

export async function pickEntity(page: Page, name: RegExp) {
  const select = page.getByLabel('Show', { exact: true })
  const options = await select.locator('option').allTextContents()
  const hit = options.find(o => name.test(o))
  if (!hit) throw new Error(`No "${name}" among ${options.join(', ')}`)
  await select.selectOption({ label: hit })
}

/** Press the mouse on an element and start dragging it; waits until the slots are coloured. */
export async function pickUp(page: Page, el: Locator) {
  const b = (await el.boundingBox())!
  await page.mouse.move(b.x + Math.min(20, b.width / 2), b.y + Math.min(10, b.height / 2))
  await page.mouse.down()
  await page.mouse.move(b.x + Math.min(30, b.width / 2 + 5), b.y + Math.min(18, b.height / 2 + 5), { steps: 3 })
  await expect(page.locator('td div[style*="outline"]').first()).toBeVisible()
}

/** Move to the middle of an element and let go. */
export async function dropOn(page: Page, el: Locator) {
  const b = (await el.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
}

export async function places(page: Page, subject: string, count: number) {
  return Promise.all(Array.from({ length: count }, (_, i) => cellOf(lessonChip(page, subject, i))))
}
