// Turns docs/user-guide/guide.html into docs/Timewizer-User-Guide.pdf (needs Chromium, like the UI tests).
//   npm run guide
import { chromium } from '@playwright/test'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (process.platform === 'linux' ? '/opt/pw-browsers/chromium' : undefined) })
const page = await browser.newPage()
await page.goto(pathToFileURL(path.resolve('docs/user-guide/guide.html')).href)
await page.evaluate(() => document.fonts.ready)
await page.pdf({ path: 'docs/Timewizer-User-Guide.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: '<div style="font-size:8px;color:#5A6468;width:100%;text-align:center;font-family:sans-serif">Timewizer user guide · <span class="pageNumber"></span></div>',
  margin: { top: '17mm', bottom: '18mm', left: '17mm', right: '17mm' } })
await browser.close()
console.log('Wrote docs/Timewizer-User-Guide.pdf')
