import { expect, test, type Page } from '@playwright/test'
import { buildTimetable, dropOn, importSample, lessonChip, newSchool, openApp, openCells, openTimetable, pickEntity, pickUp, places, sampleSchool, setDialog, setImproveSeconds } from './helpers'

const history = (page: Page) => page.getByRole('list', { name: 'Change history' }).getByRole('listitem')
const latest = (page: Page) => history(page).filter({ hasText: 'latest' })

test.describe('undo, redo and the change history', () => {
  test('every timetable edit is listed in plain words with its time, and can be undone and redone', async ({ page }) => {
    const errors = await sampleSchool(page)
    await openTimetable(page)
    await pickEntity(page, /Grade 6 A/)
    // the build is the first step
    await expect(history(page)).toHaveCount(1)
    await expect(latest(page)).toContainText(/Built the timetable \(\d+ of \d+ lesson sessions placed\)/)
    await expect(latest(page).locator('time')).toHaveText(/\d{1,2}:\d{2}:\d{2}/)

    // move
    const original = await places(page, 'Science', 4)
    await pickUp(page, lessonChip(page, 'Science'))
    await dropOn(page, openCells(page).first())
    await expect(latest(page)).toContainText(/Moved Science \(6A\) from \w+day period \d to \w+day period \d/)
    await expect(history(page)).toHaveCount(2)

    // lock and unlock
    const chip = lessonChip(page, 'Mathematics')
    await chip.hover()
    await chip.getByRole('button', { name: 'Lock' }).click()
    await expect(latest(page)).toContainText(/Locked Mathematics \(6A\) on \w+day period \d/)
    await lessonChip(page, 'Mathematics').hover()
    await lessonChip(page, 'Mathematics').getByRole('button', { name: 'Unlock' }).click()
    await expect(latest(page)).toContainText(/Unlocked Mathematics \(6A\)/)

    // take a lesson off the timetable (drop it on the "Not placed yet" area)
    await pickUp(page, lessonChip(page, 'Urdu'))
    await dropOn(page, page.getByText('Drop here to take it off the timetable'))
    await expect(latest(page)).toContainText(/Took Urdu \(6A\) off the timetable \(was \w+day period \d\)/)
    await expect(history(page)).toHaveCount(5)

    // the buttons say what they would undo / redo
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', /^Undo: Took Urdu/)
    await page.getByRole('button', { name: 'Undo' }).click() // Urdu back
    await page.keyboard.press('Control+z') // unlock undone
    await expect(history(page).filter({ hasText: 'undone' })).toHaveCount(2)
    await expect(page.locator('div[draggable="false"][title^="Mathematics "]')).toHaveCount(1) // locked again
    await expect(page.getByRole('button', { name: 'Redo' })).toHaveAttribute('title', /^Redo: Unlocked Mathematics/)
    await page.keyboard.press('Control+y')
    await expect(page.locator('div[draggable="false"]')).toHaveCount(0)
    await expect(history(page).filter({ hasText: 'undone' })).toHaveCount(1)

    // a new edit after undoing drops the edits that were undone
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z') // the move is undone too
    expect(await places(page, 'Science', 4)).toEqual(original)
    await expect(history(page).filter({ hasText: 'undone' })).toHaveCount(4)
    const chip2 = lessonChip(page, 'English')
    await chip2.hover()
    await chip2.getByRole('button', { name: 'Lock' }).click()
    await expect(history(page)).toHaveCount(2)
    await expect(history(page).filter({ hasText: 'undone' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled()
    expect(errors).toEqual([])
  })

  test('swapping two lessons is described with both lessons', async ({ page }) => {
    await sampleSchool(page)
    await openTimetable(page)
    await pickEntity(page, /Grade 6 A/)
    await pickUp(page, lessonChip(page, 'Urdu'))
    const other = page.locator('div[draggable][style*="outline"][style*="var(--success)"]:not([title^="Urdu "])').first()
    await expect(other).toBeVisible()
    const subject = (await other.getAttribute('title'))!.split(' · ')[0]
    await dropOn(page, other)
    await expect(latest(page)).toContainText(`Swapped Urdu (6A) (`)
    await expect(latest(page)).toContainText(` with ${subject} (`)
  })

  test('building again is one step: one undo brings the whole previous timetable back', async ({ page }) => {
    await sampleSchool(page)
    await openTimetable(page)
    await pickEntity(page, /Grade 6 A/)
    // a hand-made change, so the old timetable is easy to recognise
    await pickUp(page, lessonChip(page, 'Science'))
    await dropOn(page, openCells(page).first())
    await expect(latest(page)).toContainText('Moved Science')
    const before = await Promise.all(['Science', 'English', 'Mathematics'].map(async s => (await places(page, s, 4)).join()))

    await buildTimetable(page)
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('title', /^Undo: Built the timetable/)
    await page.keyboard.press('Control+z') // works on the Build page too
    await expect(page.getByRole('button', { name: 'Redo' })).toHaveAttribute('title', /^Redo: Built the timetable/)
    await openTimetable(page)
    await pickEntity(page, /Grade 6 A/)
    const after = await Promise.all(['Science', 'English', 'Mathematics'].map(async s => (await places(page, s, 4)).join()))
    expect(after).toEqual(before)
    await expect(latest(page)).toContainText('Moved Science')
    await expect(history(page).filter({ hasText: 'undone' })).toContainText('Built the timetable')

    // and redo brings the new build back
    await page.getByRole('button', { name: 'Redo' }).click()
    await expect(latest(page)).toContainText('Built the timetable')
  })

  test('opening a school starts with an empty history', async ({ page }) => {
    await openApp(page)
    const file = await newSchool(page)
    await importSample(page)
    await setImproveSeconds(page, 1)
    await buildTimetable(page)
    await page.keyboard.press('Control+s')
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    await setDialog(page, { open: file })
    await page.getByRole('button', { name: 'Open file…' }).click()
    await openTimetable(page)
    await expect(page.getByText('No changes yet')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled()
  })
})
