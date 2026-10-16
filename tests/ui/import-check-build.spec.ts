import { expect, test } from '@playwright/test'
import { go, importSample, newSchool, openApp, sampleSchool, setImproveSeconds } from './helpers'

test.describe('import, check, build', () => {
  test('importing the sample school fills every list, and importing twice changes nothing', async ({ page }) => {
    const errors = await openApp(page)
    await newSchool(page)
    await importSample(page)

    await go(page, 'Subjects')
    await expect(page.getByRole('button', { name: /Mathematics/ })).toBeVisible()
    await go(page, 'Teachers')
    await expect(page.getByRole('button', { name: /Ayesha Khan/ })).toBeVisible()
    await go(page, 'Classes')
    await expect(page.getByRole('button', { name: /Grade 6 A/ })).toBeVisible()
    await go(page, 'Rooms')
    await expect(page.getByRole('button', { name: /Computer Lab/ })).toBeVisible()
    await go(page, 'Lessons')
    await expect(page.getByRole('button', { name: /English · 6A/ }).first()).toBeVisible()

    // a second import skips everything that already exists
    await go(page, 'Import data')
    await page.getByRole('button', { name: 'Choose files…' }).click()
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(page.getByText(/Added 0 subjects, 0 teachers, 0 rooms, 0 classes and 0 lessons/)).toBeVisible()
    await expect(page.getByText(/rows were skipped because they already exist/)).toBeVisible()
    expect(errors).toEqual([])
  })

  test('importing a file that cannot be used says which row is wrong', async ({ page }) => {
    await openApp(page)
    await newSchool(page)
    await go(page, 'Import data')
    // lessons before anything else exists: every row points at things that are not there yet
    const { SAMPLES, setDialog } = await import('./helpers')
    await setDialog(page, { open: [`${SAMPLES}/lessons.csv`] })
    await page.getByRole('button', { name: 'Choose files…' }).click()
    await page.getByRole('button', { name: 'Import', exact: true }).click()
    await expect(page.getByText(/could not be imported/)).toBeVisible()
    await expect(page.getByText(/lessons\.csv, row 2:/).first()).toBeVisible()
  })

  test('the check page passes for the sample school and builds a plain-English report when it does not', async ({ page }) => {
    await sampleSchool(page, { build: false })
    await go(page, 'Check before building')
    await expect(page.getByText('No impossible lessons found.')).toBeVisible()
    await expect(page.getByText(/108 lesson sessions \(112 periods\)/)).toBeVisible()

    // overload a teacher: the weekly maximum is lower than Bilal's 20 lessons
    await go(page, 'Rules & limits')
    await page.getByLabel('Most periods per week').fill('12')
    await go(page, 'Check before building')
    await expect(page.getByText(/more lessons than their weekly maximum/).first()).toBeVisible()
    await expect(page.getByText(/the most they may teach is 12/).first()).toBeVisible()
    await expect(page.getByText(/How to fix:/).first()).toBeVisible()

    // and the build page refuses to start, with the same advice
    await go(page, 'Build timetable')
    await page.locator('section').getByRole('button', { name: 'Build timetable' }).click()
    await expect(page.getByRole('alert')).toContainText('Check before building')
  })

  test('building the sample school places all 108 lessons, shows quality, and can be saved', async ({ page }) => {
    const errors = await sampleSchool(page)
    // the Build page and the Check page count the same thing the same way
    await expect(page.getByText('All 108 lesson sessions are placed.')).toBeVisible()
    await expect(page.getByText(/Timetable quality improved by \d+%/)).toBeVisible()
    await expect(page.getByText('Free periods in the middle of teachers\' days')).toBeVisible()
    // preview of a class
    await expect(page.getByRole('combobox', { name: 'Class' })).toBeVisible()
    await expect(page.locator('table', { hasText: 'P1' })).toBeVisible()
    // saving works and the unsaved marker goes away
    await expect(page.getByText(/unsaved changes/)).toBeVisible()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Saved')).toBeVisible()
    await expect(page.getByText(/unsaved changes/)).toHaveCount(0)
    await go(page, 'Check before building')
    await expect(page.getByText(/108 lesson sessions \(112 periods\)/)).toBeVisible()
    expect(errors).toEqual([])
  })

  test('stopping a build keeps the previous timetable', async ({ page }) => {
    await sampleSchool(page)
    await setImproveSeconds(page, 30)
    await go(page, 'Build timetable')
    await page.getByRole('button', { name: 'Build again' }).click()
    await expect(page.getByText(/Improving the timetable/)).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Stop' }).click()
    await expect(page.getByRole('button', { name: 'Build again' })).toBeVisible({ timeout: 20_000 })
  })
})
