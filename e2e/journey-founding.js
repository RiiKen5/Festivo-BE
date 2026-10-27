// Founding Vendor Plan: a vendor lists and becomes a founding vendor; a
// customer who comes through the vendor's shared link books at 0%, one who
// found a vendor on Festivo books at the standard 10%, and the vendor sees
// which fee applies.
const { chromium, APP, session, login, settle, api, tokenFor } = require('./lib');

const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) process.exitCode = 1; };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise(r => setTimeout(r, 200)); } return false; };

const requestBooking = async (page, price) => {
  await page.getByRole('button', { name: 'Request booking' }).click();
  await page.locator('app-modal select').first().selectOption({ index: 1 });
  await page.locator('app-modal input[type=number]').first().fill(String(price));
  await page.getByRole('button', { name: 'Send request' }).click();
  await page.waitForURL(/\/bookings/, { timeout: 8000 });
};

(async () => {
  const browser = await chromium.launch();
  const issues = [];

  // A vendor lists their first service and becomes a founding vendor
  const flashToken = await tokenFor('flash@test.in');
  const listed = await api('/services', { token: flashToken, method: 'POST', body: {
    serviceName: 'Flash Candid Reels', category: 'photography', description: 'Short candid reels of your party, edited the same night.',
    basePrice: 4000, priceUnit: 'per_event', city: 'Pune'
  } });
  check(listed.success, 'vendor lists a service');

  const flash = await session(browser, 'flash'); issues.push(flash.issues);
  await login(flash.page, 'flash@test.in');
  await flash.page.goto(`${APP}/dashboard/my-services`); await settle(flash.page);
  check(await until(() => flash.page.getByText("You're a founding vendor").isVisible()), 'vendor sees they are a founding vendor');
  check(await flash.page.locator('.fee-banner').innerText().then(t => t.includes('0%') && t.includes('5%') && t.includes('31 January 2027')), 'founding fees and end date shown');
  await flash.page.screenshot({ path: 'shots/founding-banner.png', fullPage: false });

  // The organizer opens the vendor's shared link and books: the vendor's own customer
  const org = await session(browser, 'rohit'); issues.push(org.issues);
  await login(org.page, 'rohit@test.in');
  await org.page.goto(`${APP}/services/${listed.data.slug}?utm_source=vendor_share&utm_medium=link`); await settle(org.page);
  await requestBooking(org.page, 4000);
  const orgToken = await tokenFor('rohit@test.in');
  const own = (await api('/bookings?role=organizer', { token: orgToken })).data.find(b => b.service.serviceName === 'Flash Candid Reels');
  check(own && own.source === 'vendor_link' && own.feePercent === 0, `booking through the vendor's link: own customer at 0% (${own && own.source} ${own && own.feePercent}%)`);

  await flash.page.goto(`${APP}/bookings/${own._id}`); await settle(flash.page);
  check(await flash.page.getByText('0% fee (your own customer, founding rate').isVisible(), 'vendor sees the own-customer founding fee');

  // Found on Festivo: the cake vendor (not founding) at 10%
  const cake = (await api('/services')).data.find(s => s.serviceName.startsWith('Priya'));
  await org.page.goto(`${APP}/services/${cake.slug}`); await settle(org.page);
  await requestBooking(org.page, 2000);
  const found = (await api('/bookings?role=organizer', { token: orgToken })).data.find(b => b.service.serviceName.startsWith('Priya'));
  check(found && found.source === 'marketplace' && found.feePercent === 10, `booking found on Festivo: 10% (${found && found.feePercent}%)`);

  const priya = await session(browser, 'priya'); issues.push(priya.issues);
  await login(priya.page, 'priya@test.in');
  await priya.page.goto(`${APP}/bookings/${found._id}`); await settle(priya.page);
  await priya.page.getByRole('button', { name: /Accept & send price/ }).first().click();
  check(await priya.page.getByText('you receive ₹1,800 after Festivo\'s 10% fee (new customer from Festivo').isVisible(), 'quote shows what the vendor receives');
  await priya.page.screenshot({ path: 'shots/founding-quote.png', fullPage: false });

  // The public page states the plan
  await org.page.goto(`${APP}/for-vendors`); await settle(org.page);
  check(await org.page.getByText('3% on your own customers, 10% on new customers').isVisible(), 'vendor page shows the fees');
  check(await org.page.getByText('Founding vendors: the first 50').isVisible(), 'vendor page shows the founding offer');

  await browser.close();
  const all = issues.flat();
  all.forEach(x => console.log('ISSUE', x));
  if (all.length) process.exitCode = 1;
})();
