// Marketing features: attribution on signup, vendor landing page, vendor
// share link, guest-to-host prompt and the admin Growth tab.
const BE = require('path').resolve(__dirname, '..');
const mongoose = require(BE + '/node_modules/mongoose');
const User = require(BE + '/src/models/User');
const { chromium, APP, session, login, settle, api } = require('./lib');

const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) process.exitCode = 1; };

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27099/festivo');
  const browser = await chromium.launch();
  const all = [];

  // 1. A vendor arrives from an Instagram DM link and signs up from the landing page
  {
    const { context, page, issues } = await session(browser, 'vendor-signup');
    all.push(issues);
    await page.goto(APP + '/for-vendors?utm_source=instagram&utm_medium=dm&utm_campaign=pune-bakers');
    await settle(page);
    await page.screenshot({ path: 'shots/growth-for-vendors.png', fullPage: true });
    check(await page.getByRole('heading', { name: /pay before the event/i }).isVisible(), 'vendor landing page renders');

    await page.getByRole('button', { name: /List your service, free/ }).first().click();
    await page.waitForURL(/\/auth\/register\?as=vendor/);
    await settle(page);
    check((await page.locator('.user-type-option--selected').innerText()).includes('Offer Services'), 'register preselects "Offer Services"');

    await page.locator('app-input[formcontrolname=name] input').fill('Meera Balloons');
    await page.locator('app-input[formcontrolname=email] input').fill('meera@test.in');
    await page.locator('app-input[formcontrolname=phone] input').fill('9876500077');
    await page.locator('app-input[formcontrolname=city] input').fill('Pune');
    await page.locator('app-input[formcontrolname=password] input').fill('Password123!');
    await page.locator('input[formcontrolname=acceptTerms]').check();
    const [resp] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/auth/register')),
      page.locator('button[type=submit]').click()
    ]);
    const body = await resp.json();
    const user = await User.findOne({ email: 'meera@test.in' }).select('+acquisition').lean();
    check(user && user.userType === 'helper', 'account created as a vendor');
    check(user && user.acquisition && user.acquisition.source === 'instagram' && user.acquisition.campaign === 'pune-bakers'
      && user.acquisition.landingPage === '/for-vendors', `first touch stored: ${JSON.stringify(user && user.acquisition)}`);

    const verifyUrl = body.data && body.data._dev && body.data._dev.emailVerificationUrl;
    check(!!verifyUrl, 'dev verification link returned');
    if (verifyUrl) {
      await page.goto(verifyUrl.replace('http://localhost:4200', APP));
      await page.waitForURL(/\/services\/create/, { timeout: 15000 }).catch(() => {});
      check(page.url().includes('/services/create'), `new vendor lands on create listing (${page.url()})`);
    }
    await context.close();
  }

  // 2. An existing vendor copies their booking link from My Services
  {
    const { context, page, issues } = await session(browser, 'vendor-share');
    all.push(issues);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => { delete Navigator.prototype.share; });
    await login(page, 'priya@test.in');
    await page.goto(APP + '/dashboard/my-services');
    await settle(page);
    check(await page.getByText('Get paid before the event.').isVisible(), 'share tip shown on My Services');
    await page.getByRole('button', { name: /^Share$/ }).first().click();
    await page.waitForTimeout(400);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    check(/\/services\/.+utm_source=vendor_share/.test(copied), `share link is tagged: ${copied}`);
    await page.screenshot({ path: 'shots/growth-my-services.png' });

    // A customer opening that link and signing up is attributed to the vendor share
    const { context: c2, page: p2, issues: i2 } = await session(browser, 'customer');
    all.push(i2);
    await p2.goto(copied.replace('http://localhost:4200', APP));
    await settle(p2);
    const touch = await p2.evaluate(() => JSON.parse(localStorage.getItem('festivo_first_touch')));
    check(touch && touch.source === 'vendor_share', 'customer first touch is vendor_share');
    await c2.close();
    await context.close();
  }

  // 3. A guest on someone else's event sees the "plan your own" prompt
  {
    const { context, page, issues } = await session(browser, 'guest');
    all.push(issues);
    await login(page, 'asha@test.in');
    const events = await api('/events/upcoming');
    const list = events.data.events || events.data;
    await page.goto(APP + '/events/' + list[0].slug);
    await settle(page);
    check(await page.getByText('Planning your own event?').isVisible(), 'guest sees host prompt on event page');
    await page.screenshot({ path: 'shots/growth-event-cta.png' });
    await context.close();
  }

  // 4. Admin sees signups by source
  {
    const { context, page, issues } = await session(browser, 'admin');
    all.push(issues);
    await login(page, 'admin@test.in');
    await page.goto(APP + '/admin');
    await settle(page);
    await page.getByRole('button', { name: 'Growth' }).click();
    await settle(page);
    const row = page.locator('.growth-table tbody tr', { hasText: 'instagram' });
    check(await row.isVisible(), 'Growth tab lists the instagram signup');
    await page.screenshot({ path: 'shots/growth-admin.png', fullPage: true });
    await context.close();
  }

  await browser.close();
  await mongoose.disconnect();
  const problems = all.flat();
  problems.forEach(p => console.log('ISSUE', p));
  if (problems.length) process.exitCode = 1;
})();
