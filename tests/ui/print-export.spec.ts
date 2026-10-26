import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { go, importSample, newSchool, openApp, sampleSchool, setDialog, setImproveSeconds } from './helpers'

const FIX = path.resolve('tests/ui/fixtures')
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'timewizer-export-'))
const pngSize = (file: string) => {
  const b = fs.readFileSync(file)
  expect(b.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}
const pdfPages = (file: string) => (fs.readFileSync(file).toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length
const status = (page: Page) => page.getByRole('status')

async function openPrint(page: Page) {
  await go(page, 'Print & export')
  await expect(page.getByRole('heading', { name: 'Print and export' })).toBeVisible()
}

/** How many pixels on the preview are clearly coloured (not white, grey or black). */
const colouredPixels = (page: Page) => page.getByLabel('Preview of the page').evaluate((c: HTMLCanvasElement) => {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
  let n = 0
  for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 40) n++
  return n
})

test.describe('school logo', () => {
  test('a logo can be chosen, changed, removed, and is saved with the school', async ({ page }) => {
    const errors = await openApp(page)
    const file = await newSchool(page, 'Logo Test School')
    const img = page.getByAltText('School logo')
    await expect(img).toHaveCount(0)
    await setDialog(page, { open: `${FIX}/logo.png` })
    await page.getByRole('button', { name: 'Choose a picture…' }).click()
    await expect(img).toBeVisible()
    expect(await img.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    // an SVG works too, and replaces it
    const first = await img.getAttribute('src')
    await setDialog(page, { open: `${FIX}/logo.svg` })
    await page.getByRole('button', { name: 'Change picture…' }).click()
    await expect.poll(() => img.getAttribute('src')).not.toBe(first)
    // saved with the school
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Saved')).toBeVisible()
    page.on('dialog', d => d.accept())
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await setDialog(page, { open: file })
    await page.getByRole('button', { name: 'Open file…' }).click()
    await expect(page.getByAltText('School logo')).toBeVisible()
    await page.getByRole('button', { name: 'Remove' }).click()
    await expect(page.getByAltText('School logo')).toHaveCount(0)
    expect(errors.filter(e => !/Failed to load resource/.test(e))).toEqual([])
  })

  test('files that are not pictures give a clear message', async ({ page }) => {
    await openApp(page)
    await newSchool(page)
    await setDialog(page, { open: `${FIX}/notes.txt` })
    await page.getByRole('button', { name: 'Choose a picture…' }).click()
    await expect(page.getByRole('alert')).toContainText('Please choose a PNG, JPG, GIF, WEBP or SVG picture')
    await setDialog(page, { open: `${FIX}/broken.png` })
    await page.getByRole('button', { name: 'Choose a picture…' }).click()
    await expect(page.getByRole('alert')).toContainText('could not be read')
    await expect(page.getByAltText('School logo')).toHaveCount(0)
  })
})

test.describe('print and export', () => {
  test('without a timetable the page says what to do', async ({ page }) => {
    await sampleSchool(page, { build: false })
    await openPrint(page)
    await expect(page.getByText('There is no timetable to print yet.')).toBeVisible()
    await page.getByRole('button', { name: 'Build the timetable first' }).click()
    await expect(page.getByRole('heading', { name: 'Build the timetable' })).toBeVisible()
  })

  test('choosing what to print changes how many pages will be made', async ({ page }) => {
    await sampleSchool(page)
    await openPrint(page)
    // 4 classes + 9 teachers + 2 rooms that are used + the master timetable
    await expect(page.getByText('16 pages will be made.')).toBeVisible()
    await page.getByLabel('All teachers', { exact: true }).uncheck()
    await expect(page.getByText('7 pages will be made.')).toBeVisible()
    await page.getByLabel('All rooms', { exact: true }).uncheck()
    await page.getByLabel('All classes', { exact: true }).uncheck()
    await expect(page.getByText('1 page will be made.')).toBeVisible()
    await page.getByLabel('Master timetable').uncheck()
    await expect(page.getByText('Choose what to print first.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save PDF…' })).toBeDisabled()
    await expect(page.getByRole('button', { name: /Save pictures/ })).toBeDisabled()
    // single names can be picked too
    await page.locator('details summary', { hasText: 'Teachers' }).click()
    await page.getByRole('checkbox', { name: 'Bilal Ahmed' }).check()
    await expect(page.getByText('1 page will be made.')).toBeVisible()
  })

  test('the PDF has one page for everything chosen', async ({ page }) => {
    await sampleSchool(page)
    await openPrint(page)
    const out = path.join(tmpDir(), 'all.pdf')
    await setDialog(page, { save: out })
    await page.getByRole('button', { name: 'Save PDF…' }).click()
    await expect(status(page)).toContainText('Saved a PDF with 16 pages')
    expect(fs.readFileSync(out).subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdfPages(out)).toBe(16)
    // only classes
    await page.getByLabel('All teachers', { exact: true }).uncheck()
    await page.getByLabel('All rooms', { exact: true }).uncheck()
    await page.getByLabel('Master timetable').uncheck()
    const small = path.join(tmpDir(), 'classes.pdf')
    await setDialog(page, { save: small })
    await page.getByRole('button', { name: 'Save PDF…' }).click()
    await expect(status(page)).toContainText('Saved a PDF with 4 pages')
    expect(pdfPages(small)).toBe(4)
    expect(fs.statSync(small).size).toBeLessThan(fs.statSync(out).size)
  })

  test('pictures: one PNG per timetable, named clearly, in the chosen size', async ({ page }) => {
    await sampleSchool(page)
    await openPrint(page)
    await page.getByLabel('All teachers', { exact: true }).uncheck()
    await page.getByLabel('All rooms', { exact: true }).uncheck()
    const dir = tmpDir()
    await setDialog(page, { open: dir })
    await page.getByRole('button', { name: /Save pictures/ }).click()
    await expect(status(page)).toContainText('Saved 5 pictures')
    expect(fs.readdirSync(dir).sort()).toEqual(['Class-Grade-6-A.png', 'Class-Grade-6-B.png', 'Class-Grade-7-A.png', 'Class-Grade-7-B.png', 'Master-Morning.png'])
    expect(pngSize(path.join(dir, 'Class-Grade-6-A.png'))).toEqual({ w: 2376, h: 1680 }) // A4 wide at 8 pixels per mm

    // A3 tall
    await page.getByLabel('Paper size').selectOption('a3')
    await page.getByRole('radio', { name: 'Tall' }).click()
    await page.getByLabel('All classes', { exact: true }).uncheck()
    const dir2 = tmpDir()
    await setDialog(page, { open: dir2 })
    await page.getByRole('button', { name: /Save pictures/ }).click()
    await expect(status(page)).toContainText('Saved 1 picture in')
    expect(pngSize(path.join(dir2, 'Master-Morning.png'))).toEqual({ w: 2376, h: 3360 })
  })

  test('black and white has no colours, colour has, and the choice is remembered', async ({ page }) => {
    await sampleSchool(page)
    await openPrint(page)
    await expect(page.getByAltText('Preview of the page').or(page.getByLabel('Preview of the page'))).toBeVisible()
    await expect.poll(() => colouredPixels(page)).toBeGreaterThan(5000)
    await page.getByRole('radio', { name: 'Black and white' }).click()
    await expect.poll(() => colouredPixels(page)).toBe(0)
    await go(page, 'Timetable')
    await openPrint(page)
    await expect(page.getByRole('radio', { name: 'Black and white' })).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => colouredPixels(page)).toBe(0)
    await page.getByRole('radio', { name: 'Colour' }).click()
    await expect.poll(() => colouredPixels(page)).toBeGreaterThan(5000)
  })

  test('the school logo and name are on the printed pages', async ({ page }) => {
    await openApp(page)
    await newSchool(page, 'Logo Print School')
    await importSample(page)
    await setImproveSeconds(page, 1)
    await go(page, 'School')
    await setDialog(page, { open: `${FIX}/logo.png` })
    await page.getByRole('button', { name: 'Choose a picture…' }).click()
    await expect(page.getByAltText('School logo')).toBeVisible()
    await go(page, 'Build timetable')
    await page.locator('section').getByRole('button', { name: 'Build timetable' }).click()
    await expect(page.getByText(/All \d+ lesson sessions are placed/)).toBeVisible({ timeout: 60_000 })
    await openPrint(page)
    const preview = page.getByLabel('Preview of the page')
    const withLogo = await preview.evaluate((c: HTMLCanvasElement) => c.toDataURL())
    // the logo's teal ring is in the top-left corner of the page
    const teal = await preview.evaluate((c: HTMLCanvasElement) => {
      const k = c.width / 297, d = c.getContext('2d')!.getImageData(Math.round(11 * k), Math.round(11 * k), Math.round(15 * k), Math.round(15 * k)).data
      let n = 0
      for (let i = 0; i < d.length; i += 4) if (d[i] < 80 && d[i + 1] > 90 && d[i + 2] > 90 && d[i + 3] > 0) n++
      return n
    })
    expect(teal).toBeGreaterThan(200)
    await page.getByRole('switch', { name: /Show the school logo/ }).click()
    await expect.poll(() => preview.evaluate((c: HTMLCanvasElement) => c.toDataURL())).not.toBe(withLogo)
    // a PDF made with the logo is bigger than one made without
    const withFile = path.join(tmpDir(), 'with.pdf'), withoutFile = path.join(tmpDir(), 'without.pdf')
    await setDialog(page, { save: withoutFile })
    await page.getByRole('button', { name: 'Save PDF…' }).click()
    await expect(status(page)).toContainText('Saved a PDF')
    await page.getByRole('switch', { name: /Show the school logo/ }).click()
    await setDialog(page, { save: withFile })
    await page.getByRole('button', { name: 'Save PDF…' }).click()
    await expect(status(page)).toContainText(withFile)
    expect(fs.statSync(withFile).size).toBeGreaterThan(fs.statSync(withoutFile).size + 1000)
  })

  test('Excel and CSV files are made from the timetable', async ({ page }) => {
    await sampleSchool(page)
    await openPrint(page)
    const csv = path.join(tmpDir(), 'lessons.csv')
    await setDialog(page, { save: csv })
    await page.getByRole('button', { name: 'Save lesson list (CSV)…' }).click()
    await expect(status(page)).toContainText('Saved the list of lessons')
    const lines = fs.readFileSync(csv, 'utf8').replace(/^﻿/, '').trim().split('\n')
    expect(lines[0]).toBe('Class,Subject,Teachers,Room,Day,First period,Periods,Starts,Ends,Shift')
    expect(lines).toHaveLength(109)
    expect(lines.some(l => l.startsWith('Grade 6 A,Computer Studies,Hamza Noor,Computer Lab,'))).toBe(true)

    const xlsx = path.join(tmpDir(), 'timetable.xlsx')
    await setDialog(page, { save: xlsx })
    await page.getByRole('button', { name: 'Save Excel…' }).click()
    await expect(status(page)).toContainText('Saved the Excel workbook')
    const b = fs.readFileSync(xlsx)
    expect(b.subarray(0, 2).toString()).toBe('PK')
    expect(b.length).toBeGreaterThan(8000)
  })

  test('Excel and the timetables CSV hold what is ticked, with the period times', async ({ page }) => {
    await sampleSchool(page)
    await openPrint(page)
    // only Grade 6 A and the master timetable
    await page.getByLabel('All teachers', { exact: true }).uncheck()
    await page.getByLabel('All rooms', { exact: true }).uncheck()
    await page.getByLabel('All classes', { exact: true }).uncheck()
    await page.locator('summary', { hasText: 'Classes' }).click()
    await page.getByLabel('Grade 6 A', { exact: true }).check()
    const csv = path.join(tmpDir(), 'timetables.csv')
    await setDialog(page, { save: csv })
    await page.getByRole('button', { name: 'Save CSV…', exact: true }).click()
    await expect(status(page)).toContainText('Saved the timetables as a CSV file')
    const text = fs.readFileSync(csv, 'utf8').replace(/^\uFEFF/, '')
    const lines = text.trim().split(/\r?\n/)
    expect(lines[0]).toBe('Class: Grade 6 A,Morning shift')
    expect(lines[1]).toBe('Period,Time,Monday,Tuesday,Wednesday,Thursday,Friday')
    expect(lines[2]).toMatch(/^1,08:00–08:40,/)
    expect(text).toContain('Master timetable,Morning shift')
    expect(text).toContain('Time,08:00–08:40,')
    expect(text).not.toContain('Grade 6 B,')
    expect(text).not.toContain('Teacher:')

    const xlsx = path.join(tmpDir(), 'timetables.xlsx')
    await setDialog(page, { save: xlsx })
    await page.getByRole('button', { name: 'Save Excel…' }).click()
    await expect(status(page)).toContainText('Saved the Excel workbook')
    expect(fs.readFileSync(xlsx).subarray(0, 2).toString()).toBe('PK')

    // nothing ticked: Excel and CSV wait for a choice, the lesson list does not
    await page.getByLabel('Grade 6 A', { exact: true }).uncheck()
    await page.getByLabel('Master timetable (all classes together)').uncheck()
    await expect(page.getByText('Nothing is chosen. Tick something above.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save Excel…' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Save CSV…', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Save lesson list (CSV)…' })).toBeEnabled()
  })

  test('many classes are split over several master pages so each row stays readable', async ({ page }) => {
    await sampleSchool(page)
    const extra = path.join(tmpDir(), 'classes.csv')
    fs.writeFileSync(extra, 'Name,Short name,Shift\n' + Array.from({ length: 14 }, (_, i) => `Extra ${i + 1},E${i + 1},Morning`).join('\n') + '\n')
    await go(page, 'Import data')
    await setDialog(page, { open: extra })
    await page.getByRole('button', { name: 'Choose files…' }).click()
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(page.getByText(/Added 0 subjects, 0 teachers, 0 rooms, 14 classes/)).toBeVisible()
    await openPrint(page)
    // 18 classes -> 2 master pages; the new classes have no lessons so only the first 4 classes are listed
    await expect(page.getByText('17 pages will be made.')).toBeVisible()
    await page.getByLabel('All teachers', { exact: true }).uncheck()
    await page.getByLabel('All rooms', { exact: true }).uncheck()
    await page.getByLabel('All classes', { exact: true }).uncheck()
    await expect(page.getByText('2 pages will be made.')).toBeVisible()
    const dir = tmpDir()
    await setDialog(page, { open: dir })
    await page.getByRole('button', { name: /Save pictures/ }).click()
    await expect(status(page)).toContainText('Saved 2 pictures')
    expect(fs.readdirSync(dir).sort()).toEqual(['Master-Morning-1.png', 'Master-Morning-2.png'])
  })

  test('the file chooser being cancelled changes nothing', async ({ page }) => {
    await sampleSchool(page)
    await openPrint(page)
    await setDialog(page, { save: null })
    await page.getByRole('button', { name: 'Save PDF…' }).click()
    await expect(page.getByRole('button', { name: 'Save PDF…' })).toBeEnabled()
    await expect(page.getByRole('status')).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
})
