// Log in as each demo role through the UI and capture its key screens
const { chromium, session, login, settle } = require('./lib');
const { APP } = require('./lib');
const OUT = process.argv[2] || require('path').join(__dirname, 'shots', 'roles');
require('fs').mkdirSync(OUT, { recursive: true });
const roles = {
  admin: ['/admin', '/dashboard'],
  organizer: ['/dashboard', '/bookings', '/messages', '/notifications'],
  vendor: ['/dashboard', '/bookings', '/dashboard/earnings', '/dashboard/my-services'],
  photographer: ['/bookings', '/dashboard/earnings'],
  decorator: ['/bookings'],
  dj: ['/dashboard/earnings'],
  both: ['/dashboard', '/bookings'],
  attendee: ['/dashboard', '/messages'],
  guest: ['/dashboard']
};
(async () => {
  const browser = await chromium.launch();
  for (const [key, routes] of Object.entries(roles)) {
    const { page, issues, context } = await session(browser, key);
    const res = { key };
    try {
      await page.goto(APP + '/auth/login');
      await page.locator('app-input[formcontrolname=email] input').fill(`${key}@festivo.demo`);
      await page.locator('app-input[formcontrolname=password] input').fill('Festivo@2026');
      await page.locator('button[type=submit]').click();
      await page.waitForURL(u => !u.pathname.startsWith('/auth'), { timeout: 60000 });
      await settle(page);
      for (const r of routes) {
        await page.goto(APP + r); await settle(page, 1200);
        await page.screenshot({ path: `${OUT}/${key}${r.replace(/\//g, '_')}.png`, fullPage: true });
      }
      res.ok = true;
    } catch (e) { res.ok = false; res.err = e.message.split('\n')[0]; }
    console.log(res.ok ? '✓' : '✗', key, res.err || '', issues.length ? '\n   ' + [...new Set(issues)].join('\n   ') : '');
    await context.close();
  }
  await browser.close();
})();
