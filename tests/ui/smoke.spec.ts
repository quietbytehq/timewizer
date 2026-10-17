import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import { openApp, newSchool, setDialog, tmpFile } from './helpers'

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

test('a file that is not a school file gives a clear message, not a crash', async ({ page }) => {
  const errors = await openApp(page)
  const junk = tmpFile('not-a-school')
  fs.writeFileSync(junk, 'hello, this is not a school')
  await setDialog(page, { open: junk })
  await page.getByRole('button', { name: /Open file/ }).click()
  await expect(page.getByRole('alert')).toContainText('does not look like a Timewizer school file')
  await expect(page.getByRole('heading', { name: /Timetables, made simple/ })).toBeVisible()
  expect(errors).toEqual([])
})

test('the page runs under the strict content security policy', async ({ page }) => {
  const res = await page.request.get('/')
  const csp = res.headers()['content-security-policy'] ?? ''
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("object-src 'none'")
  expect(csp).not.toContain('unsafe-eval')
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
})
