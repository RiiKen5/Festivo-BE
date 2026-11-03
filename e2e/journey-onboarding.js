// Onboarding vendors met in person: an admin lists a vendor from their intake
// form and sends them a link on WhatsApp; the vendor sets a password, finds
// their page and prints a QR card. A customer requests a booking; the admin
// chases the vendor on WhatsApp. While online payment is off, pages say the
// customer pays the vendor directly.
const path = require('path');
const { chromium, APP, session, login, settle, api, tokenFor } = require('./lib');

const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) process.exitCode = 1; };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise(r => setTimeout(r, 200)); } return false; };

// Online payment switched off, as on the live site before Razorpay is on
const paymentsOff = async (context) => context.route('**/api/v1/payments/config', async route => {
  const res = await route.fetch();
  const json = await res.json();
  json.data.enabled = false;
  await route.fulfill({ response: res, json });
});

(async () => {
  const browser = await chromium.launch();
  const issues = [];

  // 1. Admin lists a vendor from their intake form
  const admin = await session(browser, 'admin'); issues.push(admin.issues);
  await admin.context.route('https://wa.me/**', r => r.fulfill({ contentType: 'text/html', body: 'WhatsApp' }));
  await login(admin.page, 'admin@test.in');
  await admin.page.goto(`${APP}/admin`); await settle(admin.page);
  await admin.page.getByRole('button', { name: 'Vendors', exact: true }).click(); await settle(admin.page);
  await admin.page.getByRole('button', { name: 'Add a vendor' }).click();
  const form = admin.page.locator('form.intake');
  await form.getByLabel('Name', { exact: true }).fill('Kavya Rao');
  await form.getByLabel('Email', { exact: true }).fill('kavya.cakes@example.com');
  await form.getByLabel('WhatsApp number').fill('98450 12345');
  await form.getByLabel('Service name').fill("Kavya's Eggless Cakes");
  await form.getByLabel('What they make or do').fill('Eggless theme cakes and cupcakes for birthdays, baked at home in HSR Layout.');
  await form.getByLabel('Starting price (₹)').fill('900');
  await form.getByLabel('Areas they serve').fill('HSR Layout, Koramangala');
  await form.locator('input[type=file]').first().setInputFiles(path.join(__dirname, 'photo.jpg'));
  check(await until(() => form.getByText('Cover added').isVisible()), 'admin uploads the cover photo');
  await admin.page.screenshot({ path: 'shots/admin-add-vendor.png', fullPage: true });
  await form.getByRole('button', { name: 'List vendor' }).click();

  const claimCard = admin.page.locator('.claim-card');
  check(await until(() => claimCard.isVisible()), 'vendor listed; admin sees the link to send');
  const wa = await claimCard.getByRole('link', { name: 'Send on WhatsApp' }).getAttribute('href');
  check(wa.startsWith('https://wa.me/919845012345?text=') && decodeURIComponent(wa).includes("Kavya's Eggless Cakes"), 'WhatsApp message goes to the vendor number with the link');
  const claimUrl = (await claimCard.locator('.claim-url').innerText()).trim();
  check(/\/auth\/reset-password\?token=[0-9a-f]{64}&welcome=1$/.test(claimUrl), 'claim link created');
  check(await admin.page.locator('.row-card', { hasText: 'Kavya Rao' }).getByText('Not claimed yet').isVisible(), 'vendor shows as not claimed yet');
  await admin.page.screenshot({ path: 'shots/admin-claim-link.png', fullPage: false });

  // 2. The vendor opens the link on their phone and sets a password
  const kavya = await session(browser, 'vendor'); issues.push(kavya.issues);
  await kavya.page.setViewportSize({ width: 390, height: 844 });
  await kavya.page.goto(claimUrl.replace(/^https?:\/\/[^/]+/, APP)); await settle(kavya.page);
  check(await kavya.page.getByRole('heading', { name: 'Welcome to Festivo' }).isVisible(), 'vendor is welcomed, not told to "reset"');
  await kavya.page.locator('app-input[formcontrolname=password] input').fill('KavyaCakes123!');
  await kavya.page.locator('app-input[formcontrolname=confirmPassword] input').fill('KavyaCakes123!');
  await kavya.page.getByRole('button', { name: 'Set password' }).click();
  check(await until(() => kavya.page.getByRole('heading', { name: "You're all set" }).isVisible()), 'password set');
  await login(kavya.page, 'kavya.cakes@example.com', 'KavyaCakes123!');
  await kavya.page.goto(`${APP}/dashboard/my-services`); await settle(kavya.page);
  check(await until(() => kavya.page.getByText("Kavya's Eggless Cakes").first().isVisible()), 'vendor sees their listing');
  check(await kavya.page.getByText("You're a founding vendor").isVisible(), 'vendor got a founding spot');

  // 3. The QR card for their counter
  await kavya.page.getByRole('button', { name: 'QR card' }).click();
  const card = kavya.page.locator('app-shop-card img');
  check(await until(() => card.isVisible()), 'QR card drawn');
  const size = await card.evaluate(img => [img.naturalWidth, img.naturalHeight]);
  check(size[0] === 1080 && size[1] === 1350, `QR card is print size (${size.join('x')})`);
  const overflow = await kavya.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `QR card fits a phone (overflow ${overflow}px)`);
  await kavya.page.screenshot({ path: 'shots/vendor-qr-card.png', fullPage: false });
  await kavya.page.keyboard.press('Escape');

  await admin.page.reload(); await settle(admin.page);
  await admin.page.getByRole('button', { name: 'Vendors', exact: true }).click(); await settle(admin.page);
  check(!(await admin.page.locator('.row-card', { hasText: 'Kavya Rao' }).getByText('Not claimed yet').count()), 'admin sees the vendor claimed their page');

  // 4. A customer requests a booking; the vendor hasn't answered
  const orgToken = await tokenFor('rohit@test.in');
  const event = (await api('/events/my-events', { token: orgToken })).data[0];
  const service = (await api(`/services?search=${encodeURIComponent('Kavya')}`)).data[0];
  check(service && service.city === 'Bengaluru', 'listing is live in Bengaluru');
  const booking = await api('/bookings', { token: orgToken, method: 'POST', body: { eventId: event._id, serviceId: service._id } });

  await admin.page.getByRole('button', { name: /Requests/ }).click(); await settle(admin.page);
  const row = admin.page.locator('.row-card', { hasText: "Kavya's Eggless Cakes" });
  check(await until(() => row.isVisible()), 'admin sees the unanswered request');
  const nudge = row.getByRole('link', { name: 'WhatsApp Kavya Rao' });
  const href = decodeURIComponent(await nudge.getAttribute('href'));
  check(href.includes('wa.me/919845012345') && href.includes(`/bookings/${booking.data._id}`), 'nudge opens WhatsApp with the request link');
  const popup = admin.page.context().waitForEvent('page');
  await nudge.click();
  await (await popup).close();
  check(await until(() => row.getByText(/^Messaged /).isVisible()), 'admin sees the vendor was messaged');
  await admin.page.screenshot({ path: 'shots/admin-requests.png', fullPage: false });

  // 5. With online payment off, the vendor is told the customer pays directly
  await paymentsOff(kavya.context);
  await kavya.page.goto(`${APP}/bookings/${booking.data._id}`); await settle(kavya.page);
  await kavya.page.getByRole('button', { name: /Accept & send price/ }).first().click();
  await kavya.page.getByRole('button', { name: 'Accept booking' }).click();
  check(await until(() => kavya.page.getByText(/pays you directly/).first().isVisible()), 'vendor told the organizer pays them directly');

  const visitor = await session(browser, 'visitor'); issues.push(visitor.issues);
  await paymentsOff(visitor.context);
  await visitor.page.goto(`${APP}/for-vendors`); await settle(visitor.page);
  check(await visitor.page.getByText('Launch period:').isVisible(), 'for-vendors page explains the launch period');
  await visitor.page.goto(`${APP}/`); await settle(visitor.page);
  check(await visitor.page.getByRole('heading', { name: 'Pay the vendor' }).isVisible(), 'home page says to pay the vendor directly');

  await browser.close();
  const all = issues.flat();
  all.forEach(x => console.log('ISSUE', x));
  if (all.length) process.exitCode = 1;
})();
