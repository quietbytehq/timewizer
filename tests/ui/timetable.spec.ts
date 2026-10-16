import { expect, test } from '@playwright/test'
import { buildTimetable, cellOf, cellsWhere, dropOn, go, lessonChip, openTimetable, pickEntity, pickUp, pickView, places, sampleSchool } from './helpers'

test.describe('timetable views and editing', () => {
  test('class, teacher, room and master views show the built timetable', async ({ page }) => {
    const errors = await sampleSchool(page)
    await openTimetable(page)

    // class view: Grade 6 A has 27 sessions (the double counts once)
    await pickEntity(page, /Grade 6 A/)
    await expect(page.locator('div[draggable]')).toHaveCount(27)
    await expect(lessonChip(page, 'English').first()).toBeVisible()
    await expect(page.locator('div[draggable][title^="English "]')).toHaveCount(5)
    await expect(page.locator('div[draggable][title^="Computer Studies "]')).toHaveCount(1)

    // teacher view: Bilal Ahmed teaches Mathematics for four classes, five times each
    await pickView(page, 'Teacher')
    await pickEntity(page, /Bilal Ahmed/)
    await expect(page.locator('div[draggable][title^="Mathematics "]')).toHaveCount(20)

    // room view: the computer lab holds the four Computer Studies doubles
    await pickView(page, 'Room')
    await pickEntity(page, /Computer Lab/)
    await expect(page.locator('div[draggable][title^="Computer Studies "]')).toHaveCount(4)

    // master view: one row per class, readable text, and a working zoom
    await pickView(page, 'Master')
    for (const c of ['6A', '6B', '7A', '7B']) await expect(page.getByRole('rowheader', { name: c })).toBeVisible()
    const cell = page.locator('table td div').first()
    const before = (await cell.boundingBox())!.width
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await expect.poll(async () => (await cell.boundingBox())!.width).toBeGreaterThan(before)
    expect(errors).toEqual([])
  })

  test('dragging a lesson to a green slot moves it; undo and redo bring it back and forth', async ({ page }) => {
    await sampleSchool(page)
    await openTimetable(page)
    await pickEntity(page, /Grade 6 A/)
    const original = await places(page, 'Science', 4)

    await pickUp(page, lessonChip(page, 'Science'))
    const empty = cellsWhere(page, 'success').filter({ hasNot: page.locator('[draggable]') })
    await expect(empty.first()).toBeVisible()
    await dropOn(page, empty.first())

    await expect.poll(async () => (await places(page, 'Science', 4)).join()).not.toBe(original.join())
    const moved = await places(page, 'Science', 4)

    await page.getByRole('button', { name: 'Undo' }).click()
    expect(await places(page, 'Science', 4)).toEqual(original)
    await page.getByRole('button', { name: 'Redo' }).click()
    expect(await places(page, 'Science', 4)).toEqual(moved)
    // the keyboard shortcut does the same as the button
    await page.keyboard.press('Control+z')
    expect(await places(page, 'Science', 4)).toEqual(original)
    await page.keyboard.press('Control+y')
    expect(await places(page, 'Science', 4)).toEqual(moved)
  })

  test('red slots explain themselves and refuse the drop', async ({ page }) => {
    await sampleSchool(page)
    await openTimetable(page)
    await pickEntity(page, /Grade 6 A/)
    const before = await places(page, 'English', 5)
    await pickUp(page, lessonChip(page, 'English'))
    const red = cellsWhere(page, 'danger')
    await expect(red.first()).toBeVisible()
    // hovering gives the reason in plain English
    await expect(red.first()).toHaveAttribute('title', /already|not available|same day|Another session|that day/)
    await dropOn(page, red.first())
    expect(await places(page, 'English', 5)).toEqual(before)
  })

  test('dropping a lesson on another swaps them when both moves are valid', async ({ page }) => {
    await sampleSchool(page)
    await openTimetable(page)
    await pickEntity(page, /Grade 6 A/)
    const a = lessonChip(page, 'Urdu')
    const posA = await cellOf(a)
    await pickUp(page, a)
    // a different lesson that lights up green can be swapped with
    const other = page.locator('div[draggable][style*="outline"][style*="var(--success)"]:not([title^="Urdu "])').first()
    await expect(other).toBeVisible()
    const subject = (await other.getAttribute('title'))!.split(' · ')[0]
    const posOther = await cellOf(other)
    const n = await page.locator(`div[draggable][title^="${subject} "]`).count()
    await dropOn(page, other)

    await expect.poll(async () => (await places(page, 'Urdu', 4)).includes(posOther)).toBe(true)
    expect(await places(page, 'Urdu', 4)).not.toContain(posA)
    // the other lesson went to where Urdu was
    expect(await places(page, subject, n)).toContain(posA)
  })

  test('locked lessons cannot be dragged, and stay put when the timetable is built again', async ({ page }) => {
    await sampleSchool(page)
    await openTimetable(page)
    await pickEntity(page, /Grade 6 A/)
    const chip = lessonChip(page, 'Mathematics')
    const pos = await cellOf(chip)
    await chip.hover()
    await chip.getByRole('button', { name: 'Lock' }).click()
    await expect(lessonChip(page, 'Mathematics')).toHaveAttribute('title', /locked/)
    await expect(lessonChip(page, 'Mathematics')).toHaveAttribute('draggable', 'false')

    await buildTimetable(page)
    await openTimetable(page)
    await pickEntity(page, /Grade 6 A/)
    const locked = page.locator('div[draggable="false"][title^="Mathematics "]')
    await expect(locked).toHaveCount(1)
    expect(await cellOf(locked)).toBe(pos)

    // unlock again
    await locked.hover()
    await locked.getByRole('button', { name: 'Unlock' }).click()
    await expect(page.locator('div[draggable="false"]')).toHaveCount(0)
  })

  test('the room picker lists the rooms a lesson may use and which are free', async ({ page }) => {
    await sampleSchool(page, { build: false })
    // let Computer Studies for 6A use the science lab as well
    await go(page, 'Lessons')
    await page.getByRole('button', { name: /Computer Studies · 6A/ }).click()
    await page.getByLabel('Science Lab').check()
    await buildTimetable(page)
    await openTimetable(page)
    await pickEntity(page, /Grade 6 A/)
    const chip = lessonChip(page, 'Computer Studies')
    await chip.hover()
    await chip.getByRole('button', { name: 'Choose room' }).click()
    const dialog = page.getByRole('dialog', { name: 'Choose a room' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Computer Lab/ })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Science Lab/ })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Computer Lab.*current/ })).toBeVisible()
    await dialog.getByRole('button', { name: /Science Lab/ }).click()
    await expect(dialog).toBeHidden()
    await expect(lessonChip(page, 'Computer Studies')).toHaveAttribute('title', /Science Lab/)
    // Escape closes the picker without changing anything
    await lessonChip(page, 'Computer Studies').hover()
    await lessonChip(page, 'Computer Studies').getByRole('button', { name: 'Choose room' }).click()
    await expect(dialog).toBeVisible() // it opens after the rooms have been looked up
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(lessonChip(page, 'Computer Studies')).toHaveAttribute('title', /Science Lab/)
  })

  test('improve quality works on the current timetable and reports before and after', async ({ page }) => {
    await sampleSchool(page)
    await openTimetable(page)
    await page.getByRole('button', { name: 'Improve quality' }).click()
    await expect(page.getByText(/Timetable quality/)).toBeVisible({ timeout: 30_000 })
  })
})
