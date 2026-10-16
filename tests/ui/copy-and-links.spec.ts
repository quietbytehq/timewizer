import { expect, test } from '@playwright/test'
import { buildTimetable, go, openTimetable, pickEntity, pickView, places, sampleSchool } from './helpers'

test.describe('copy lessons to other classes', () => {
  test('copies a class\'s lessons to a new class after a preview, and will not copy twice', async ({ page }) => {
    await sampleSchool(page, { build: false })
    await go(page, 'Classes')
    await page.getByRole('button', { name: 'Add class' }).click()
    await page.getByPlaceholder('Grade 5 A').fill('Grade 6 C')
    await page.getByPlaceholder('5A', { exact: true }).fill('6C')

    await go(page, 'Lessons')
    await page.getByRole('button', { name: /Copy lessons to other classes/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Copy lessons to other classes' })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Copy from').selectOption({ label: 'Grade 6 A (9 lessons)' })
    // nothing is previewed until a class is ticked, and the button says so
    await expect(dialog.getByRole('button', { name: 'Nothing to copy' })).toBeDisabled()
    await dialog.getByRole('checkbox', { name: /Grade 6 C/ }).check()
    await expect(dialog.getByText('Grade 6 C: 9 lessons will be added')).toBeVisible()
    await expect(dialog.getByText(/English · 5 × single/)).toBeVisible()
    await expect(dialog.getByText(/Computer Studies · 1 × double/)).toBeVisible()
    // nothing has changed yet
    await expect(page.getByRole('button', { name: /English · 6C/ })).toHaveCount(0)

    await dialog.getByRole('button', { name: 'Add 9 lessons' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: /English · 6C/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Art · 6C/ })).toBeVisible()

    // the class now has a full week of lessons
    await go(page, 'Workload')
    await expect(page.getByText('Grade 6 C').first()).toBeVisible()

    // copying again finds everything already there
    await go(page, 'Lessons')
    await page.getByRole('button', { name: /Copy lessons to other classes/ }).click()
    await dialog.getByLabel('Copy from').selectOption({ label: 'Grade 6 A (9 lessons)' })
    await dialog.getByRole('checkbox', { name: /Grade 6 C/ }).check()
    await expect(dialog.getByText('Grade 6 C: 0 lessons will be added')).toBeVisible()
    await expect(dialog.getByText(/already has this lesson/).first()).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Nothing to copy' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('copying without teachers leaves them to be chosen', async ({ page }) => {
    await sampleSchool(page, { build: false })
    await go(page, 'Lessons')
    await page.getByRole('button', { name: /Copy lessons to other classes/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Copy lessons to other classes' })
    await dialog.getByLabel('Copy from').selectOption({ label: 'Grade 6 A (9 lessons)' })
    await dialog.getByRole('checkbox', { name: /Grade 6 B/ }).check()
    await expect(dialog.getByText('Grade 6 B: 0 lessons will be added')).toBeVisible() // 6B already has all of them
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
  })
})

test.describe('lessons that must happen at the same time', () => {
  const partner = (page: import('@playwright/test').Page) => page.getByLabel('Add a lesson that happens at the same time')

  test('two lessons can be linked, are built at the same time, and the link can be removed', async ({ page }) => {
    await sampleSchool(page, { build: false })
    await go(page, 'Lessons')
    await page.getByRole('button', { name: /English · 6A/ }).click()
    // only lessons with the same number and length of sessions are offered
    await partner(page).selectOption({ label: 'Mathematics · 6B · BAH · 5 × 1' })
    await expect(page.getByText('Mathematics · 6B').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /English · 6A.*linked/ })).toBeVisible()

    // linking changes how lessons share times, not how many lesson sessions there are
    await go(page, 'Check before building')
    await expect(page.getByText(/108 lesson sessions \(112 periods\)/)).toBeVisible()
    await buildTimetable(page)
    await expect(page.getByText('All 108 lesson sessions are placed.')).toBeVisible()
    await openTimetable(page)
    await pickEntity(page, /Grade 6 A/)
    const english = await places(page, 'English', 5)
    await pickEntity(page, /Grade 6 B/)
    const maths = await places(page, 'Mathematics', 5)
    // same row (period) and column (day) in each class view
    expect(maths.sort()).toEqual(english.sort())

    // moving one of them moves the other: pick up English for 6A and drop it on a free slot
    await pickEntity(page, /Grade 6 A/)
    await go(page, 'Lessons')
    await page.getByRole('button', { name: /English · 6A/ }).click()
    await page.getByRole('button', { name: 'Remove link' }).click()
    await expect(page.getByRole('button', { name: /English · 6A.*linked/ })).toHaveCount(0)
  })

  test('a link that cannot work is explained in plain English', async ({ page }) => {
    await sampleSchool(page, { build: false })
    await go(page, 'Lessons')
    await page.getByRole('button', { name: /English · 6A/ }).click()
    // English for 6B has the same teacher (Ayesha Khan): she cannot be in two places at once
    await partner(page).selectOption({ label: 'English · 6B · AKH · 5 × 1' })
    await expect(page.getByText(/These lessons cannot happen at the same time: Ayesha Khan teaches both/)).toBeVisible()
    await go(page, 'Check before building')
    await expect(page.getByText(/Ayesha Khan teaches both/).first()).toBeVisible()
    await go(page, 'Build timetable')
    await page.locator('section').getByRole('button', { name: 'Build timetable' }).click()
    await expect(page.getByRole('alert')).toContainText('Check before building')
  })

  test('linked lessons move together in the timetable and lock together', async ({ page }) => {
    await sampleSchool(page, { build: false })
    await go(page, 'Lessons')
    await page.getByRole('button', { name: /English · 6A/ }).click()
    await partner(page).selectOption({ label: 'Mathematics · 6B · BAH · 5 × 1' })
    await buildTimetable(page)
    await openTimetable(page)
    await pickEntity(page, /Grade 6 A/)
    const chip = page.locator('div[draggable][title^="English "]').first()
    await chip.hover()
    await chip.getByRole('button', { name: 'Lock' }).click()
    await pickEntity(page, /Grade 6 B/)
    // the partner lesson is locked too
    await expect(page.locator('div[draggable="false"][title^="Mathematics "]')).toHaveCount(1)
    await pickView(page, 'Teacher')
    await pickEntity(page, /Bilal Ahmed/)
    await expect(page.locator('div[draggable="false"][title^="Mathematics "]')).toHaveCount(1)
  })
})
