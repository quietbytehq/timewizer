import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import { go, importSample, newSchool, openApp, openTimetable, pickEntity, pickView, places, buildTimetable, setDialog, setImproveSeconds, tmpFile } from './helpers'

const MONDAY = '2026-11-02'

async function school(page: Page) {
  const errors = await openApp(page)
  const file = await newSchool(page)
  await importSample(page)
  await setImproveSeconds(page, 1)
  await buildTimetable(page)
  return { errors, file }
}
async function addAbsence(page: Page, teacher: string, from: string, to = from, periods: number[] | null = null, note = '') {
  await page.getByLabel('Teacher').selectOption({ label: teacher })
  await page.getByLabel('First day').fill(from)
  await page.getByLabel('Last day').fill(to)
  if (note) await page.getByLabel('Note (optional)').fill(note)
  if (periods) {
    await page.getByLabel('Only some periods').check()
    for (const p of periods) await page.getByRole('group', { name: 'Periods away' }).getByLabel(`period ${p}`, { exact: true }).check()
  }
  await page.getByRole('button', { name: 'Add absence' }).click()
}
const needs = (page: Page) => page.getByTestId('need')
const total = (page: Page) => page.getByTestId('cover-total')
/** Where Bilal Ahmed's maths lessons are, to prove the timetable never changes. */
async function bilalsWeek(page: Page) {
  await openTimetable(page)
  await pickView(page, 'Teacher')
  await pickEntity(page, /Bilal Ahmed/)
  return (await places(page, 'Mathematics', 20)).join()
}

test.describe('substitutions', () => {
  test('a whole-day absence: accept, choose anyone (with a warning), or no cover; sheets; saved; timetable untouched', async ({ page }) => {
    const { errors, file } = await school(page)
    const week = await bilalsWeek(page)
    await go(page, 'Substitutions')
    await addAbsence(page, 'Bilal Ahmed', MONDAY, MONDAY, null, 'Course')
    await expect(page.getByRole('list', { name: 'Absences' })).toContainText('Bilal Ahmed · Mon 2 Nov 2026 · whole day · Course')
    await expect(page.getByRole('heading', { name: 'Cover for Monday 2 November 2026' })).toBeVisible()
    const n = await needs(page).count()
    expect(n).toBeGreaterThanOrEqual(3)
    await expect(page.getByTestId('cover-summary')).toHaveText(`${n} of ${n} lessons still need a cover teacher.`)
    await expect(needs(page).first()).toContainText('Mathematics')
    await expect(needs(page).first()).toContainText('Bilal Ahmed')

    // 1: accept the suggestion
    const first = needs(page).nth(0)
    const accept = first.getByRole('button', { name: /^Accept / })
    const chosen = (await accept.innerText()).trim()
    await accept.click()
    await expect(first.getByLabel(/^Cover for /)).toHaveValue(/.+/)
    await expect(first.getByLabel(/^Cover for /).locator('option:checked')).toContainText(chosen)
    await expect(total(page)).toHaveText('1')

    // 2: choose a teacher who is not free: allowed, with a warning that says why
    const second = needs(page).nth(1)
    const busy = second.locator('optgroup[label="Breaks a rule"] option').first()
    await second.getByLabel(/^Cover for /).selectOption((await busy.getAttribute('value'))!)
    await expect(second.getByRole('alert')).toContainText(/is teaching|not available|is away|already covering|weekly maximum|does not work/)
    await expect(total(page)).toHaveText('2')

    // 3: no cover needed (counts for nobody)
    await needs(page).nth(2).getByRole('button', { name: /^No cover needed/ }).click()
    await expect(needs(page).nth(2).getByTestId('decision')).toHaveText('No cover needed')
    await expect(total(page)).toHaveText('2')
    await expect(page.getByTestId('cover-summary')).toHaveText(n === 3 ? 'All 3 lessons are covered or need no cover.' : `${n - 3} of ${n} lessons still need a cover teacher.`)

    // cover sheet: PDF (one page for one day) and CSV
    const pdf = tmpFile('cover').replace(/\.twz$/, '.pdf')
    await setDialog(page, { save: pdf })
    await page.getByRole('button', { name: 'Save PDF…' }).click()
    await expect(page.getByRole('status')).toContainText('Saved the cover sheet as a PDF (1 day)')
    const bytes = fs.readFileSync(pdf, 'latin1')
    expect(bytes.startsWith('%PDF')).toBe(true)
    expect((bytes.match(/\/Type \/Page\b/g) ?? []).length).toBe(1)
    const csv = tmpFile('cover').replace(/\.twz$/, '.csv')
    await setDialog(page, { save: csv })
    await page.getByRole('button', { name: 'Save CSV…' }).click()
    await expect(page.getByRole('status')).toContainText('CSV')
    const lines = fs.readFileSync(csv, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/)
    expect(lines[0]).toBe('Date,Day,Shift,Period,Start,End,Class,Subject,Absent teacher,Cover teacher,Room,Note')
    expect(lines).toHaveLength(n + 1)
    expect(lines.filter(l => l.startsWith(`${MONDAY},Monday,Morning,`) && l.includes(',Bilal Ahmed,') && l.endsWith(',Course'))).toHaveLength(n)
    expect(lines.filter(l => l.includes(',No cover needed,'))).toHaveLength(1)
    expect(lines.some(l => l.includes(`,${chosen},`))).toBe(true)

    // the timetable is exactly the same, and no timetable change was recorded
    expect(await bilalsWeek(page)).toBe(week)
    await expect(page.getByRole('list', { name: 'Change history' }).getByRole('listitem')).toHaveCount(1)

    // saved with the school
    await page.keyboard.press('Control+s')
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    await setDialog(page, { open: file })
    await page.getByRole('button', { name: 'Open file…' }).click()
    await go(page, 'Substitutions')
    await page.getByLabel('Date', { exact: true }).fill(MONDAY)
    await expect(page.getByRole('list', { name: 'Absences' })).toContainText('Bilal Ahmed')
    await expect(total(page)).toHaveText('2')
    await expect(needs(page).nth(2).getByTestId('decision')).toHaveText('No cover needed')
    expect(errors).toEqual([])
  })

  test('a part-day absence only lists the lessons in the chosen periods', async ({ page }) => {
    await school(page)
    await go(page, 'Substitutions')
    await addAbsence(page, 'Bilal Ahmed', MONDAY)
    await expect(needs(page).first()).toBeVisible()
    const periods = await needs(page).evaluateAll(rows => rows.map(r => Number(r.getAttribute('data-period'))))
    const p = periods[0]
    page.once('dialog', d => d.accept())
    await page.getByRole('button', { name: /^Remove the absence of Bilal Ahmed/ }).click()
    await expect(page.getByRole('list', { name: 'Absences' })).toHaveCount(0)

    // no period ticked: a clear message
    await page.getByLabel('Teacher').selectOption({ label: 'Bilal Ahmed' })
    await page.getByLabel('Only some periods').check()
    await page.getByRole('button', { name: 'Add absence' }).click()
    await expect(page.getByRole('alert').first()).toContainText('Tick the periods')

    await addAbsence(page, 'Bilal Ahmed', MONDAY, MONDAY, [p])
    await expect(page.getByRole('list', { name: 'Absences' })).toContainText(`period ${p}`)
    await expect(needs(page)).toHaveCount(periods.filter(x => x === p).length)
    await expect(needs(page).first().locator('td').first()).toContainText(`P${p}`)
  })

  test('counts can be reset (after a confirmation), and removing an absence removes its covers', async ({ page }) => {
    await school(page)
    await go(page, 'Substitutions')
    await addAbsence(page, 'Bilal Ahmed', MONDAY, '2026-11-03')
    await needs(page).first().getByRole('button', { name: /^Accept / }).click()
    await expect(total(page)).toHaveText('1')
    await expect(page.getByText('Counted since the first cover.')).toBeVisible()
    await expect(page.getByRole('table', { name: 'Cover counts' }).getByRole('row')).toHaveCount(2)

    // cancelled: nothing changes
    page.once('dialog', d => d.dismiss())
    await page.getByRole('button', { name: 'Reset counts…' }).click()
    await expect(total(page)).toHaveText('1')
    // confirmed: counting starts again today
    page.once('dialog', d => { expect(d.message()).toContain('Start counting covers again from today'); d.accept() })
    await page.getByRole('button', { name: 'Reset counts…' }).click()
    await expect(total(page)).toHaveText('0')
    await expect(page.getByText(/^Counted since /)).toBeVisible()
    // the decision itself is kept
    await expect(needs(page).first().getByRole('button', { name: /^Clear the cover/ })).toBeVisible()

    // removing the absence removes its covers
    page.once('dialog', d => { expect(d.message()).toContain('and its 1 cover decision'); d.accept() })
    await page.getByRole('button', { name: /^Remove the absence of Bilal Ahmed/ }).click()
    await expect(needs(page)).toHaveCount(0)
    await expect(page.getByText('No lessons need cover on this day.')).toBeVisible()
  })

  test('without a timetable the page says what to do', async ({ page }) => {
    await openApp(page)
    await newSchool(page)
    await importSample(page)
    await go(page, 'Substitutions')
    await addAbsence(page, 'Bilal Ahmed', MONDAY)
    await expect(page.getByText('Build the timetable first')).toBeVisible()
  })

  test('nobody over their weekly maximum is suggested; they are listed under "Breaks a rule" with the reason', async ({ page }) => {
    await school(page)
    // every teacher already teaches more than 1 period a week, so one more cover breaks the limit
    await go(page, 'Rules & limits')
    await page.getByLabel('Most periods per week').fill('1')
    await go(page, 'Substitutions')
    await addAbsence(page, 'Bilal Ahmed', MONDAY)
    const first = needs(page).first()
    await expect(first.getByRole('button', { name: /^Accept / })).toHaveCount(0)
    await expect(first.getByText(/^Suggested:/)).toHaveCount(0)
    await expect(first.locator('optgroup[label^="Free"]')).toHaveCount(0)
    await expect(first.locator('option').first()).toHaveText('Nobody is free. Choose anyway…')
    const broken = first.locator('optgroup[label="Breaks a rule"] option')
    expect(await broken.count()).toBeGreaterThan(0)
    for (const text of await broken.allInnerTexts()) expect(text).toMatch(/would teach \d+ periods that week, more than their weekly maximum of 1\./)
  })
})
