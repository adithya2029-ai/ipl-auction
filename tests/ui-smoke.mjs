// Browser smoke test: drives the real UI with several simultaneous users.
// usage: BASE=http://localhost:3100 OUT=./shots node tests/ui-smoke.mjs
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
const require = createRequire(import.meta.url)
let pw
try {
  pw = require('playwright')
} catch {
  pw = require(execSync('npm root -g').toString().trim() + '/playwright')
}
const { chromium, devices } = pw
import fs from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const OUT = process.env.OUT ?? 'shots'
fs.mkdirSync(OUT, { recursive: true })
const errors = []
const browser = await chromium.launch()

async function ctx(name, opts = {}) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...opts })
  const p = await c.newPage()
  p.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`))
  p.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_|hscicdn/.test(m.text()) && errors.push(`[${name}] console: ${m.text()}`))
  return { c, p }
}
const step = (s) => console.log('·', s)

// Host creates room
const host = await ctx('host')
await host.p.goto(BASE)
await host.p.getByPlaceholder('Sunday League Mega Auction').fill('Friends League')
await host.p.getByPlaceholder('Shown to other owners').fill('Adi')
await host.p.getByRole('button', { name: 'Create room' }).click()
await host.p.waitForURL(/\/r\/[A-Z0-9]+\/lobby/)
const code = host.p.url().match(/\/r\/([A-Z0-9]+)\//)[1]
step(`room ${code} created`)
await host.p.getByRole('button', { name: 'Claim' }).first().click() // MI
const invite = await host.p.locator('input[readonly]').first().inputValue()
await host.p.screenshot({ path: `${OUT}/01-lobby-host.png` })

// Friends join via invite link
const friends = []
for (const [name, team] of [['Rahul', 'CSK'], ['Priya', 'RCB'], ['Karan', 'KKR']]) {
  const f = await ctx(name)
  await f.p.goto(invite)
  await f.p.locator('input').first().fill(name)
  await f.p.getByRole('button', { name: 'Request to join' }).click()
  await f.p.getByText('Waiting for the host').waitFor()
  friends.push({ ...f, name, team })
}
await host.p.screenshot({ path: `${OUT}/02-lobby-requests.png` })
for (const f of friends) {
  await host.p.getByRole('button', { name: 'Approve as owner' }).first().click()
  await f.p.getByText('Franchises', { exact: true }).waitFor()
  const names = { CSK: 'Chennai Super Kings', RCB: 'Royal Challengers Bengaluru', KKR: 'Kolkata Knight Riders' }
  await f.p.locator('div.rounded-xl', { hasText: names[f.team] }).getByRole('button', { name: 'Claim' }).click()
  await f.p.waitForTimeout(150)
}
step('friends approved and claimed teams')

// Configure: combined pool, quick timers
await host.p.getByRole('link', { name: 'Configuration' }).click()
await host.p.getByRole('button', { name: /Combined/ }).click()
const timer = host.p.locator('label', { hasText: 'First-bid timer' }).locator('input')
await timer.fill('20')
await host.p.getByRole('button', { name: 'Save settings' }).click()
await host.p.waitForTimeout(300)
await host.p.screenshot({ path: `${OUT}/03-config.png`, fullPage: true })
await host.p.getByRole('button', { name: /Start mega auction/ }).click()
await host.p.getByRole('button', { name: 'Start auction', exact: true }).click()
await host.p.waitForTimeout(300)
step('auction started')

// Live: nominate and bid from two browsers
await host.p.getByRole('link', { name: 'Live Auction' }).click()
for (const f of friends) await f.p.goto(`${BASE}/r/${code}/live`)
await host.p.getByRole('button', { name: /Next player/ }).click()
await friends[0].p.getByRole('button', { name: /^BID ₹/ }).waitFor()
await friends[0].p.getByRole('button', { name: /^BID ₹/ }).click()
await friends[1].p.waitForTimeout(200)
await friends[1].p.getByRole('button', { name: /^BID ₹/ }).click()
await friends[0].p.waitForTimeout(250)
await friends[0].p.getByRole('button', { name: /^BID ₹/ }).click()
await host.p.waitForTimeout(400)
const leadTxt = await friends[0].p.getByRole('button', { name: 'YOU LEAD' }).count()
if (!leadTxt) errors.push('CSK should be leading after third bid')
await host.p.screenshot({ path: `${OUT}/04-live-desktop.png` })
await friends[0].p.screenshot({ path: `${OUT}/05-live-owner.png` })
await host.p.getByRole('button', { name: 'Hammer: SOLD' }).click()
await host.p.waitForTimeout(500)
const soldTab = await host.p.getByRole('button', { name: /Sold \(1\)/ }).count()
if (!soldTab) errors.push('sold tab should show 1')
step('lot sold via UI')

// a few more lots for richer screens
for (let i = 0; i < 4; i++) {
  await host.p.getByRole('button', { name: /Next player/ }).click()
  const f = friends[i % 3]
  await f.p.getByRole('button', { name: /^BID ₹/ }).waitFor()
  await f.p.getByRole('button', { name: /^BID ₹/ }).click()
  await host.p.waitForTimeout(250)
  await host.p.getByRole('button', { name: 'Hammer: SOLD' }).click()
  await host.p.waitForTimeout(300)
}
await host.p.getByRole('button', { name: /Next player/ }).click()
await friends[2].p.getByRole('button', { name: /^BID ₹/ }).click()
await host.p.waitForTimeout(300)

// Tablet & phone views of the live screen
const tab = await ctx('tablet', { ...devices['iPad Pro 11'] })
const phone = await ctx('phone', { ...devices['iPhone 14'] })
for (const [d, label] of [[tab, 'tablet'], [phone, 'phone']]) {
  // reuse Rahul's session token in the device context
  const ls = await friends[0].p.evaluate(() => localStorage.getItem('iplwr.sessions'))
  await d.p.goto(BASE)
  await d.p.evaluate((v) => localStorage.setItem('iplwr.sessions', v), ls)
  await d.p.goto(`${BASE}/r/${code}/live`)
  await d.p.getByText('UNDER THE HAMMER').waitFor()
  await d.p.waitForTimeout(400)
  await d.p.screenshot({ path: `${OUT}/06-live-${label}.png`, fullPage: label === 'phone' })
  const overflow = await d.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (overflow > 2) errors.push(`${label}: horizontal overflow ${overflow}px`)
}
await host.p.getByRole('button', { name: 'Hammer: SOLD' }).click()
await host.p.waitForTimeout(300)

// Trade via UI: CSK proposes to RCB
const csk = friends[0].p
await csk.getByRole('link', { name: 'Trade Centre' }).click()
await csk.getByRole('button', { name: '+ Propose a trade' }).click()
await csk.locator('select').filter({ hasText: 'RCB' }).selectOption('RCB')
const boxes = csk.locator('.max-h-64 input[type=checkbox]')
await boxes.first().check()
await boxes.last().check()
await csk.getByPlaceholder('Cash you add (lakh)').fill('50')
await csk.getByRole('button', { name: 'Send offer' }).click()
const rcb = friends[1].p
await rcb.getByRole('link', { name: /Trade Centre/ }).click()
await rcb.getByRole('button', { name: 'Accept' }).waitFor()
await rcb.screenshot({ path: `${OUT}/07-trade-incoming.png` })
await rcb.getByRole('button', { name: 'Accept' }).click()
await rcb.waitForTimeout(400)
const completed = await rcb.getByText('completed').count()
if (!completed) errors.push('trade should be completed')
step('trade completed via UI')

// Host transfer via UI
await host.p.getByRole('link', { name: 'Host Control' }).click()
await host.p.screenshot({ path: `${OUT}/08-host.png`, fullPage: true })
await host.p.locator('section', { hasText: 'Transfer host privileges' }).locator('select').selectOption({ label: /Priya/ }).catch(async () => {
  const opts = await host.p.locator('section', { hasText: 'Transfer host privileges' }).locator('option').allTextContents()
  const o = opts.find((x) => x.includes('Priya'))
  await host.p.locator('section', { hasText: 'Transfer host privileges' }).locator('select').selectOption({ label: o })
})
await host.p.getByRole('button', { name: 'Offer host controls' }).click()
await host.p.getByRole('button', { name: 'Confirm' }).click()
await rcb.getByRole('button', { name: 'Accept host role' }).click()
await rcb.waitForTimeout(400)
const hostTab = await rcb.getByRole('link', { name: 'Host Control' }).count()
if (!hostTab) errors.push('Priya should now see Host Control')
const oldHostTab = await host.p.getByRole('link', { name: 'Host Control' }).count()
if (oldHostTab) errors.push('Adi should no longer see Host Control')
step('host transferred via UI')

// Remaining pages
await rcb.getByRole('link', { name: 'Teams' }).click()
await rcb.waitForTimeout(300)
await rcb.screenshot({ path: `${OUT}/09-teams.png`, fullPage: true })
await rcb.goto(`${BASE}/r/${code}/teams/CSK`)
await rcb.waitForTimeout(300)
await rcb.screenshot({ path: `${OUT}/10-team-detail.png` })
await rcb.getByRole('link', { name: 'Players' }).click()
await rcb.waitForTimeout(400)
await rcb.screenshot({ path: `${OUT}/11-players.png` })
await rcb.getByRole('button', { name: /Virat Kohli/ }).first().click()
await rcb.waitForTimeout(300)
await rcb.screenshot({ path: `${OUT}/12-profile.png` })
await rcb.keyboard.press('Escape')
await rcb.getByRole('link', { name: 'History' }).click()
await rcb.waitForTimeout(600)
await rcb.screenshot({ path: `${OUT}/13-history.png`, fullPage: true })
// refresh survives
await csk.goto(`${BASE}/r/${code}/live`)
await csk.reload()
await csk.getByText('Franchises').first().waitFor()
step('refresh ok')

// mobile nav pages overflow check
for (const path of ['lobby', 'config', 'teams', 'players', 'trades', 'history']) {
  await phone.p.goto(`${BASE}/r/${code}/${path}`)
  await phone.p.waitForTimeout(350)
  const overflow = await phone.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (overflow > 2) errors.push(`phone ${path}: horizontal overflow ${overflow}px`)
}
await phone.p.goto(`${BASE}/r/${code}/teams`)
await phone.p.waitForTimeout(300)
await phone.p.screenshot({ path: `${OUT}/14-teams-phone.png` })

await browser.close()
console.log(errors.length ? `\nPROBLEMS:\n${errors.join('\n')}` : '\nUI smoke test passed with no console errors')
process.exit(errors.length ? 1 : 0)
