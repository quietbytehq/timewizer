import { expect, test, type Page } from '@playwright/test'
import { go, newSchool, openApp } from './helpers'

// Straight to the bridge (works before the page has loaded).
const invoke = (page: Page, cmd: string, args: object = {}) => page.request.post('/invoke', { data: { cmd, args } })
const welcome = (page: Page) => page.getByRole('heading', { name: /Timetables, made simple/ })

test.describe('start-up animation', () => {
  test.beforeEach(async ({ page }) => { await invoke(page, 'test_reset_preferences') })
  test.afterEach(async ({ page }) => {
    await invoke(page, 'test_reset_preferences')
    await invoke(page, 'test_set_startup_file', { path: null })
  })

  test('plays for under two seconds, then the welcome screen is ready', async ({ page }) => {
    const errors = await openApp(page, 'light', { motion: true })
    const splash = page.getByTestId('splash')
    await expect(splash).toBeVisible()
    await expect(splash).toContainText('Timewizer')
    const t0 = Date.now()
    await expect(splash).toHaveCount(0, { timeout: 3000 })
    expect(Date.now() - t0).toBeLessThan(2000)
    await expect(welcome(page)).toBeVisible()
    expect(errors).toEqual([])
  })

  test('a click or a key skips it', async ({ page }) => {
    await openApp(page, 'light', { motion: true })
    await expect(page.getByTestId('splash')).toBeVisible()
    let t0 = Date.now()
    await page.getByTestId('splash').click()
    await expect(page.getByTestId('splash')).toHaveCount(0)
    expect(Date.now() - t0).toBeLessThan(800)
    await page.reload()
    await expect(page.getByTestId('splash')).toBeVisible()
    t0 = Date.now()
    await page.keyboard.press('Space')
    await expect(page.getByTestId('splash')).toHaveCount(0)
    expect(Date.now() - t0).toBeLessThan(800)
  })

  test('is not shown when the computer is set to reduce motion', async ({ page }) => {
    await openApp(page, 'light', { motion: false })
    await expect(welcome(page)).toBeVisible()
    await page.waitForTimeout(300)
    await expect(page.getByTestId('splash')).toHaveCount(0)
  })

  test('can be switched off in Preferences, and stays off', async ({ page }) => {
    await openApp(page, 'light', { motion: true })
    await page.getByTestId('splash').click()
    await newSchool(page, 'Splash Settings School')
    await go(page, 'Preferences')
    const sw = page.getByRole('switch', { name: 'Show the short animation when Timewizer starts' })
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await page.reload()
    await expect(welcome(page)).toBeVisible()
    await page.waitForTimeout(300)
    await expect(page.getByTestId('splash')).toHaveCount(0)
  })

  test('never delays a school file opened by double-click', async ({ page }) => {
    await openApp(page, 'light', { motion: false })
    const file = await newSchool(page, 'Double Click School')
    await invoke(page, 'test_set_startup_file', { path: file })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const t0 = Date.now()
    await page.reload()
    await expect(page.getByText('Double-Click-School.twz')).toBeVisible()
    expect(Date.now() - t0).toBeLessThan(1000)
    await expect(page.getByTestId('splash')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'About the school' })).toBeVisible()
  })
})

test.describe('before the app is ready', () => {
  test('the window shows the logo, not a blank screen', async ({ browser }) => {
    // Nothing has run yet: only the page itself
    const ctx = await browser.newContext({ javaScriptEnabled: false })
    const page = await ctx.newPage()
    await page.goto('/')
    await expect(page.getByTestId('boot').getByRole('img', { name: 'Timewizer is starting' })).toBeVisible()
    await ctx.close()
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`the logo stays while the preferences load (${theme})`, async ({ page }) => {
      let release = () => {}
      const held = new Promise<void>(r => { release = r })
      await page.route('**/invoke', async route => {
        if (route.request().postDataJSON()?.cmd === 'get_preferences') await held
        await route.continue()
      })
      await openApp(page, theme, { motion: true })
      await expect(page.getByTestId('boot').getByRole('img', { name: 'Timewizer is starting' })).toBeVisible()
      await page.waitForTimeout(300) // the app has started by now; still the logo, on the theme's background
      await expect(page.getByTestId('boot')).toBeVisible()
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(theme === 'dark' ? 'rgb(15, 34, 41)' : 'rgb(239, 230, 216)')
      release()
      await expect(page.getByTestId('splash')).toBeVisible()
      await expect(page.getByTestId('boot')).toHaveCount(0)
    })
  }
})
