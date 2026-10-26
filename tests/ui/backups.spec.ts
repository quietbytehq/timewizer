import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { go, newSchool, openApp, setDialog, tmpFile } from './helpers'

// The bridge keeps one preferences file for the whole run: start and end every test with the defaults.
const resetPrefs = (page: Page) => page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('test_reset_preferences'))
const backupFolder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'timewizer-backups-'))
const backupsIn = (dir: string) => fs.readdirSync(dir).filter(f => / backup \d{4}-\d\d-\d\d \d\d-\d\d-\d\d( \(\d+\))?\.twz$/.test(f)).sort()

async function chooseFolder(page: Page, dir: string) {
  await go(page, 'Backups')
  await setDialog(page, { open: [dir] })
  await page.getByRole('button', { name: /Choose folder|Change folder/ }).click()
  await expect(page.getByTestId('backup-folder')).toHaveText(dir)
}

test.describe('backups', () => {
  test.afterEach(async ({ page }) => { await resetPrefs(page) })

  test('back up now, keep the newest copies, and back up on every save', async ({ page }) => {
    const errors = await openApp(page)
    await resetPrefs(page)
    const file = await newSchool(page, 'Backup Test School')
    const dir = backupFolder()
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a backup')
    await go(page, 'Backups')
    await expect(page.getByTestId('backup-folder')).toHaveText('No folder chosen yet')
    await expect(page.getByRole('button', { name: 'Back up now' })).toBeDisabled()
    await chooseFolder(page, dir)

    const keep = page.getByLabel('How many backups to keep')
    await expect(keep).toHaveValue('10')
    await keep.fill('3')
    await keep.press('Enter')

    await page.getByRole('button', { name: 'Back up now' }).click()
    await expect(page.getByRole('status')).toContainText('Backed up as "Backup-Test-School backup ')
    await expect(page.getByRole('list', { name: 'Backups' }).getByRole('listitem')).toHaveCount(1)
    expect(backupsIn(dir)).toHaveLength(1)

    // automatic backup on save (Ctrl+S saves even with nothing changed)
    await page.getByRole('switch', { name: 'Back up every time I save' }).click()
    await expect(page.getByRole('switch', { name: 'Back up every time I save' })).toHaveAttribute('aria-checked', 'true')
    for (let i = 0; i < 4; i++) {
      const expected = Math.min(3, backupsIn(dir).length + 1)
      await page.keyboard.press('Control+s')
      await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
      await expect.poll(() => backupsIn(dir).length).toBe(expected)
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
    }
    expect(backupsIn(dir)).toHaveLength(3)
    expect(fs.existsSync(path.join(dir, 'notes.txt'))).toBe(true)

    // the settings belong to this computer: they are still there after closing and opening again
    await page.getByRole('button', { name: 'Close' }).click()
    await setDialog(page, { open: file })
    await page.getByRole('button', { name: 'Open file…' }).click()
    await go(page, 'Backups')
    await expect(page.getByTestId('backup-folder')).toHaveText(dir)
    await expect(page.getByLabel('How many backups to keep')).toHaveValue('3')
    expect(errors).toEqual([])
  })

  test('restoring opens the backup as a new file and never replaces the open school', async ({ page }) => {
    await openApp(page)
    await resetPrefs(page)
    const file = await newSchool(page, 'Restore Test School')
    const dir = backupFolder()
    await chooseFolder(page, dir)
    await page.getByRole('button', { name: 'Back up now' }).click()
    await expect(page.getByRole('status')).toBeVisible()

    // change the school afterwards, and save
    await go(page, 'School')
    await page.getByLabel('School name').fill('Restore Test School, changed')
    await page.keyboard.press('Control+s')
    await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible()
    const saved = fs.readFileSync(file)

    await go(page, 'Backups')
    const open = page.getByRole('button', { name: /Open the backup of Restore-Test-School from/ })
    // choosing the open school's own file is refused
    await setDialog(page, { save: file })
    await open.click()
    await expect(page.getByRole('alert').first()).toContainText('never replaces the school that is open now')
    expect(fs.readFileSync(file).equals(saved)).toBe(true)

    const target = tmpFile('Restored-copy')
    await setDialog(page, { save: target })
    await open.click()
    await expect(page.getByText('Restored-copy.twz')).toBeVisible()
    await expect(page.getByLabel('School name')).toHaveValue('Restore Test School')
    expect(fs.existsSync(target)).toBe(true)
    expect(fs.readFileSync(file).equals(saved)).toBe(true)
    expect(backupsIn(dir)).toHaveLength(1)
  })

  test('the welcome screen can restore a backup when no school is open', async ({ page }) => {
    await openApp(page)
    await resetPrefs(page)
    await newSchool(page, 'Welcome Restore School')
    const dir = backupFolder()
    await chooseFolder(page, dir)
    await page.getByRole('button', { name: 'Back up now' }).click()
    await expect(page.getByRole('status')).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    await page.reload()
    await page.getByRole('button', { name: 'Restore from backup…' }).click()
    const target = tmpFile('From-welcome')
    await setDialog(page, { save: target })
    await page.getByRole('button', { name: /Open the backup of Welcome-Restore-School from/ }).click()
    await expect(page.getByText('From-welcome.twz')).toBeVisible()
    await expect(page.getByLabel('School name')).toHaveValue('Welcome Restore School')
  })

  test('a missing backup folder gives a clear message, and saving still works', async ({ page }) => {
    const errors = await openApp(page)
    await resetPrefs(page)
    const file = await newSchool(page, 'Missing Folder School')
    const dir = backupFolder()
    await chooseFolder(page, dir)
    await page.getByRole('switch', { name: 'Back up every time I save' }).click()
    await expect(page.getByRole('switch', { name: 'Back up every time I save' })).toHaveAttribute('aria-checked', 'true')
    fs.rmSync(dir, { recursive: true }) // the USB stick was taken out

    await page.getByRole('button', { name: 'Back up now' }).click()
    await expect(page.getByRole('alert').first()).toContainText('could not be found')
    await expect(page.getByRole('alert').first()).toContainText('choose the backup folder again')

    await page.keyboard.press('Control+s')
    await expect(page.getByRole('alert').filter({ hasText: 'Your school was saved, but the automatic backup did not work' })).toBeVisible()
    expect(fs.existsSync(file)).toBe(true)
    await page.getByRole('button', { name: 'Dismiss' }).click()
    await expect(page.getByText('automatic backup did not work')).toHaveCount(0)

    // choosing a folder that is not there is refused straight away
    await setDialog(page, { open: [`${dir}-elsewhere`] })
    await page.getByRole('button', { name: 'Change folder…' }).click()
    await expect(page.getByRole('alert').first()).toContainText('could not be found')
    expect(errors).toEqual([])
  })
})
