import { expect, test, type Page } from '@playwright/test'
import { buildTimetable, dropOn, go, importSample, lessonChip, newSchool, openApp, openTimetable, pickEntity, pickUp, setDialog, setImproveSeconds, tmpFile } from './helpers'

const bridge = async (page: Page, cmd: string, args: object) => {
  const r = await (await page.request.post('/invoke', { data: { cmd, args } })).json()
  if ('err' in r) throw new Error(r.err)
  return r.ok
}

/** A tiny school where one locked lesson leaves no time for another: Monday only, two periods.
 *  Art (Ms T) is locked in period 1; Music (Mr U) can only be in period 1, because U is off in period 2. */
async function lockedTightSchool(page: Page) {
  const file = tmpFile('Locked-Tight-School')
  const { setup } = await bridge(page, 'create_school', { path: file, name: 'Locked Tight School' })
  setup.days.forEach((d: { working: boolean }, i: number) => { d.working = i === 0 })
  setup.shifts[0].days[0] = setup.shifts[0].days[0].slice(0, 2)
  setup.master.subjects = [
    { id: 'art', name: 'Art', shortName: 'ART', color: '#B5525C' },
    { id: 'mus', name: 'Music', shortName: 'MUS', color: '#4C78A8' },
  ]
  setup.master.teachers = [
    { id: 't', name: 'Ms T', shortName: 'T', shifts: ['morning'] },
    { id: 'u', name: 'Mr U', shortName: 'U', shifts: ['morning'], timeOff: [{ shift: 'morning', day: 0, period: 2, state: 2 }] },
  ]
  setup.master.classes = [{ id: 'a', name: 'Class A', shortName: 'A', shift: 'morning' }]
  const lesson = (id: string, subject: string, teacher: string) =>
    ({ id, subject, teachers: [teacher], parts: [{ classId: 'a', groupId: null }], periodsPerCard: 1, cardsPerWeek: 1, rooms: [] })
  setup.lessons = [lesson('p', 'art', 't'), lesson('r', 'mus', 'u')]
  setup.timetable = { cards: [{ lessonId: 'p', number: 1, shift: 'morning', day: 0, period: 1, length: 1, room: null, locked: true }] }
  setup.settings.improveSeconds = 1
  await bridge(page, 'save_school', { setup })
  await bridge(page, 'close_school', {})
  return file
}

test.describe('locks and conflict colours', () => {
  test('when locks make a build impossible, the locks are named and can be unlocked', async ({ page }) => {
    const errors = await openApp(page)
    const file = await lockedTightSchool(page)
    await setDialog(page, { open: file })
    await page.getByRole('button', { name: 'Open file…' }).click()
    await go(page, 'Build timetable')
    await expect(page.getByText('1 locked lesson stays where it is.')).toBeVisible()
    await page.locator('section').getByRole('button', { name: 'Build again' }).click()

    const box = page.getByTestId('locks-in-the-way')
    await expect(box).toContainText('A locked lesson is stopping other lessons from being placed')
    await expect(box).toContainText('Art')
    await expect(box).toContainText('Monday period 1 · in the way of 1 session')
    await expect(page.getByText(/Music .* cannot be placed: the locked lessons already take every time it could use\. Locked lessons in the way: Art .*\(Monday period 1\)/)).toBeVisible()

    await box.getByRole('button', { name: 'Unlock it and build again' }).click()
    await expect(page.getByText('All 2 lesson sessions are placed.')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('locks-in-the-way')).toHaveCount(0)

    // the unlock is a step of its own in the change history, before the new build
    await openTimetable(page)
    const steps = page.getByRole('list', { name: 'Change history' }).getByRole('listitem')
    await expect(steps.nth(0)).toContainText('Built the timetable (2 of 2')
    await expect(steps.nth(1)).toContainText(/Unlocked Art .*\(Monday period 1\), which was in the way/)
    expect(errors).toEqual([])
  })

  test('while dragging, amber and red boxes say why; green ones are free', async ({ page }) => {
    // Monday only, four periods. Ms T teaches Art to class A in period 1; Music for class B
    // (also Ms T) is not placed yet. Period 1 is a clash, 2 is free, 3 and 4 leave her a gap.
    await openApp(page)
    const file = tmpFile('Colour-School')
    const { setup } = await bridge(page, 'create_school', { path: file, name: 'Colour School' })
    setup.days.forEach((d: { working: boolean }, i: number) => { d.working = i === 0 })
    setup.shifts[0].days[0] = setup.shifts[0].days[0].slice(0, 4)
    setup.shifts[0].breaks = []
    setup.master.subjects = [{ id: 'art', name: 'Art', shortName: 'ART', color: '#B5525C' }, { id: 'mus', name: 'Music', shortName: 'MUS', color: '#4C78A8' }]
    setup.master.teachers = [{ id: 't', name: 'Ms T', shortName: 'T', shifts: ['morning'] }]
    setup.master.classes = [{ id: 'a', name: 'Class A', shortName: 'A', shift: 'morning' }, { id: 'b', name: 'Class B', shortName: 'B', shift: 'morning' }]
    const lesson = (id: string, subject: string, cls: string) => ({ id, subject, teachers: ['t'], parts: [{ classId: cls, groupId: null }], periodsPerCard: 1, cardsPerWeek: 1, rooms: [] })
    setup.lessons = [lesson('x', 'art', 'a'), lesson('y', 'mus', 'b')]
    setup.timetable = { cards: [{ lessonId: 'x', number: 1, shift: 'morning', day: 0, period: 1, length: 1, room: null, locked: false }] }
    await bridge(page, 'save_school', { setup })
    await bridge(page, 'close_school', {})
    await setDialog(page, { open: file })
    await page.getByRole('button', { name: 'Open file…' }).click()
    await openTimetable(page)
    await pickEntity(page, /Class B/)
    await pickUp(page, lessonChip(page, 'Music'))
    const cell = (period: number) => page.locator('tbody tr').nth(period - 1).locator('td').first().locator('div').first()
    await expect(cell(1)).toHaveAttribute('style', /var\(--danger\)/)
    await expect(cell(1)).toHaveAttribute('title', /Ms T is already teaching Art/)
    await expect(cell(2)).toHaveAttribute('style', /var\(--success\)/)
    await expect(cell(2)).toHaveAttribute('title', 'Free')
    for (const p of [3, 4]) {
      await expect(cell(p)).toHaveAttribute('style', /var\(--warning\)/)
      await expect(cell(p)).toHaveAttribute('title', 'Ms T would have a free period in the middle of the day.')
    }
    // amber can be dropped on
    await dropOn(page, cell(4))
    await expect(page.getByRole('list', { name: 'Change history' })).toContainText('Placed Music (B) on Monday period 4')
  })

  test('locks are kept in the school file', async ({ page }) => {
    await openApp(page)
    const file = await newSchool(page)
    await importSample(page)
    await setImproveSeconds(page, 1)
    await buildTimetable(page)
    await openTimetable(page)
    await pickEntity(page, /Grade 6 A/)
    const chip = lessonChip(page, 'English')
    await chip.hover()
    await chip.getByRole('button', { name: 'Lock' }).click()
    await expect(page.locator('div[draggable="false"]')).toHaveCount(1)
    await page.keyboard.press('Control+s')
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    await setDialog(page, { open: file })
    await page.getByRole('button', { name: 'Open file…' }).click()
    await openTimetable(page)
    await pickEntity(page, /Grade 6 A/)
    await expect(page.locator('div[draggable="false"][title^="English "]')).toHaveCount(1)
    await expect(page.locator('div[draggable="false"][title^="English "]')).toHaveAttribute('title', /locked \(unlock it to move it\)/)
  })
})
