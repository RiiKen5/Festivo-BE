// Invitation card: open from the event page, switch colour, download.
const { chromium, APP, session, login, settle, api, tokenFor } = require('./lib');

const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) process.exitCode = 1; };

(async () => {
  const browser = await chromium.launch();
  const { page, issues } = await session(browser, 'card');
  await login(page, 'rohit@test.in');
  const mine = (await api('/events/my-events', { token: await tokenFor('rohit@test.in') })).data;
  const party = mine.find(e => !e.isPublic);
  await page.goto(`${APP}/events/${party.slug}`); await settle(page);

  await page.getByRole('button', { name: 'Make an invitation card' }).click();
  const img = page.locator('app-invitation-card .preview img');
  await img.waitFor({ timeout: 8000 });
  check(await img.evaluate(i => i.naturalWidth === 1080 && i.naturalHeight === 1350), 'card renders at 1080×1350');
  await page.waitForTimeout(300); await page.screenshot({ path: 'shots/card-berry.png' });

  const first = await img.getAttribute('src');
  await page.getByText('Midnight', { exact: true }).click();
  await page.waitForFunction(s => document.querySelector('app-invitation-card .preview img')?.getAttribute('src') !== s, first);
  check(true, 'switching colour redraws the card');
  await page.waitForTimeout(300); await page.screenshot({ path: 'shots/card-midnight.png' });

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
  check(download.suggestedFilename() === `${party.slug}.png`, `downloads ${download.suggestedFilename()}`);

  await browser.close();
  issues.forEach(x => console.log('ISSUE', x));
  if (issues.length) process.exitCode = 1;
})();
