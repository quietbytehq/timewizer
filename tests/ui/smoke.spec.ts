import { expect, test } from '@playwright/test'
import { openApp, newSchool } from './helpers'

test('the app opens and a school can be created', async ({ page }) => {
  const errors = await openApp(page)
  await expect(page.getByRole('heading', { name: /Timetables, made simple/ })).toBeVisible()
  await newSchool(page)
  expect(errors).toEqual([])
})

test('a school file passed on the command line opens straight away (double-click a .twz file)', async ({ page }) => {
  const errors = await openApp(page)
  const file = await newSchool(page, 'Opened From Disk')
  // Pretend the program was started with that file, then start it again.
  await page.evaluate(p => fetch('/invoke', { method: 'POST', body: JSON.stringify({ cmd: 'test_set_startup_file', args: { path: p } }) }), file)
  await page.reload()
  await expect(page.getByText('Opened From Disk').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: /Timetables, made simple/ })).toHaveCount(0)
  await page.evaluate(() => fetch('/invoke', { method: 'POST', body: JSON.stringify({ cmd: 'test_set_startup_file', args: { path: null } }) }))
  expect(errors).toEqual([])
})
