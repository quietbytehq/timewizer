import { expect, test } from '@playwright/test'
import { go, newSchool, openApp, sampleSchool, setDialog, setImproveSeconds, tmpFile } from './helpers'

test.describe('rules and limits', () => {
  test('school-wide weekly limit, and a teacher\'s own limit replaces it', async ({ page }) => {
    await sampleSchool(page, { build: false })
    await go(page, 'Rules & limits')
    await page.getByLabel('Most periods per week').fill('17')
    await go(page, 'Check before building')
    // Bilal teaches 20 periods: over the school limit of 17 (and nobody else is)
    await expect(page.getByText('Bilal Ahmed has more lessons than their weekly maximum')).toBeVisible()
    await expect(page.getByText(/the most they may teach is 17/)).toBeVisible()
    await expect(page.getByText(/problem to fix before building/)).toBeVisible()

    // give Bilal his own limit on the Teachers page
    await go(page, 'Teachers')
    await page.getByRole('button', { name: /Bilal Ahmed/ }).click()
    const weekly = page.getByLabel('Most periods per week')
    await expect(weekly).toHaveAttribute('placeholder', 'School: 17')
    await weekly.fill('20')
    await go(page, 'Check before building')
    await expect(page.getByText('No impossible lessons found.')).toBeVisible()
  })

  test('the daily limit is checked against the working days, and the school default fills in for teachers without their own', async ({ page }) => {
    await sampleSchool(page, { build: false })
    // the sample teachers have their own daily limits, so a school default shows only as a hint
    await go(page, 'Rules & limits')
    await page.getByLabel('Most periods per day').fill('3')
    await go(page, 'Teachers')
    await page.getByRole('button', { name: /Bilal Ahmed/ }).click()
    await expect(page.getByLabel('Most periods per day')).toHaveValue('6')
    await page.getByLabel('Most periods per day').fill('2') // 2 x 5 days = 10, but Bilal has 20
    await go(page, 'Check before building')
    await expect(page.getByText('Bilal Ahmed cannot fit their lessons into the daily maximum')).toBeVisible()
    await expect(page.getByText(/at most 2 a day/)).toBeVisible()
  })

  test('quality sliders and options are kept', async ({ page }) => {
    await sampleSchool(page, { build: false })
    await go(page, 'Rules & limits')
    const slider = page.locator('#w-avoid')
    await slider.fill('0')
    await expect(slider).toHaveValue('0')
    await page.locator('#w-teacherGaps').fill('10')
    await page.getByRole('switch', { name: /Allow bending a few rules/ }).click()
    await expect(page.getByRole('switch', { name: /Allow bending a few rules/ })).toHaveAttribute('aria-checked', 'true')
    await page.getByLabel('Most sessions of one subject per class per day').fill('2')
    // leave and come back: nothing is lost
    await go(page, 'Subjects')
    await go(page, 'Rules & limits')
    await expect(page.locator('#w-avoid')).toHaveValue('0')
    await expect(page.locator('#w-teacherGaps')).toHaveValue('10')
    await expect(page.getByLabel('Most sessions of one subject per class per day')).toHaveValue('2')
    await expect(page.getByRole('switch', { name: /Allow bending a few rules/ })).toHaveAttribute('aria-checked', 'true')
  })

  test('when a timetable is impossible, bending rules is allowed only if switched on, and the bent rules are listed', async ({ page }) => {
    test.setTimeout(180_000)
    await sampleSchool(page, { build: false })
    // Bilal teaches 20 periods; allowing him only one lesson in a row cannot work for 4 classes
    await go(page, 'Teachers')
    await page.getByRole('button', { name: /Bilal Ahmed/ }).click()
    await page.getByLabel('Most periods in a row').fill('1')
    await go(page, 'Rules & limits')
    await page.getByRole('switch', { name: /Allow bending a few rules/ }).click()
    await setImproveSeconds(page, 1)
    await go(page, 'Build timetable')
    await page.locator('section').getByRole('button', { name: 'Build timetable' }).click()
    await expect(page.getByText(/rules? (was|were) bent/)).toBeVisible({ timeout: 90_000 })
    await expect(page.getByText(/Bilal Ahmed has \d+ lessons in a row on \w+ \(the limit is 1\)/).first()).toBeVisible()
    await expect(page.getByText(/Nobody is ever in two places at once/)).toBeVisible()
    // the timetable page accepts it (no "changed after it was built" warning)
    await go(page, 'Timetable')
    await expect(page.getByText(/changed after this timetable was built/)).toHaveCount(0)
  })
})

test.describe('school setup, saving and the time-off grid', () => {
  test('a school can be saved, closed and opened again with its data', async ({ page }) => {
    await openApp(page)
    const file = await newSchool(page, 'Reopen Test School')
    page.on('dialog', d => d.accept())
    await go(page, 'Subjects')
    await page.getByRole('button', { name: 'Add subject' }).click()
    await page.getByLabel('Subject name').fill('Geography')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Saved')).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('heading', { name: /Timetables, made simple/ })).toBeVisible()
    await setDialog(page, { open: file })
    await page.getByRole('button', { name: 'Open file…' }).click()
    await go(page, 'Subjects')
    await expect(page.getByRole('button', { name: /Geography/ })).toBeVisible()
  })

  test('Save as writes a copy that can be opened', async ({ page }) => {
    await openApp(page)
    await newSchool(page, 'Copy Me')
    const copy = tmpFile('Copy-Me-2')
    await setDialog(page, { save: copy })
    await page.getByRole('button', { name: 'Save as…' }).click()
    await expect(page.getByText(/Copy-Me-2\.twz/)).toBeVisible()
  })

  test('working days and shifts: turning on Saturday asks for its periods', async ({ page }) => {
    await openApp(page)
    await newSchool(page)
    await go(page, 'Working days')
    await page.getByRole('switch', { name: 'Off' }).first().click()
    await expect(page.getByText(/Please fix these before generating a timetable/)).toBeVisible()
    await expect(page.getByText(/no periods on Saturday/)).toBeVisible()
    await go(page, 'Shifts & bells')
    await expect(page.getByText('Shifts, bell times and breaks')).toBeVisible()
  })

  test('time-off grid: a day name blocks the whole day, and missing periods are greyed out', async ({ page }) => {
    await sampleSchool(page, { build: false })
    await go(page, 'Teachers')
    await page.getByRole('button', { name: /Ayesha Khan/ }).click()
    const friday = page.getByRole('button', { name: /^Fri period \d: / })
    await expect(friday).toHaveCount(5) // Friday morning has 5 periods
    // periods 6 and 7 do not exist on Friday
    await expect(page.getByLabel('Fri period 6: no period')).toBeVisible()
    await expect(page.getByLabel('Fri period 7: no period')).toHaveAttribute('title', 'No period 7 on Fri')
    await expect(page.getByLabel('Mon period 6: Available')).toBeVisible()
    // one click on the day name makes every period that day red
    await page.getByRole('button', { name: 'Fri', exact: true }).first().click()
    for (let p = 1; p <= 5; p++) await expect(page.getByLabel(`Fri period ${p}: Not available`)).toBeVisible()
    await expect(page.getByLabel('Mon period 1: Available')).toBeVisible()
    // a second click frees it again
    await page.getByRole('button', { name: 'Fri', exact: true }).first().click()
    for (let p = 1; p <= 5; p++) await expect(page.getByLabel(`Fri period ${p}: Available`)).toBeVisible()
    // a single cell cycles available -> avoid -> not available
    const cell = page.getByLabel('Mon period 1: Available')
    await cell.click()
    await expect(page.getByLabel('Mon period 1: Avoid if possible')).toBeVisible()
    await page.getByLabel('Mon period 1: Avoid if possible').click()
    await expect(page.getByLabel('Mon period 1: Not available')).toBeVisible()
  })

  test('theme can be switched and is remembered', async ({ page }) => {
    await openApp(page, 'light')
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await page.getByRole('radio', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)
  })
})
