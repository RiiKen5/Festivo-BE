// Day of the event: the vendor confirms arrival with the organizer's code. On a
// second booking the vendor doesn't come: the organizer reports it, the vendor
// replies with a photo, an admin settles it, and the no-show shows publicly.
const crypto = require('crypto');
const path = require('path');
const { chromium, APP, session, login, settle, api, tokenFor } = require('./lib');
const BE = path.resolve(__dirname, '..');
const mongoose = require(BE + '/node_modules/mongoose');
const Booking = require(BE + '/src/models/Booking');

const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) process.exitCode = 1; };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
const sign = (orderId, paymentId) => crypto.createHmac('sha256', 'e2e_secret').update(`${orderId}|${paymentId}`).digest('hex');

// Organizer books, vendor accepts, organizer pays in full; the event is today
const paidBookingToday = async (orgToken, vendorEmail, serviceName, eventId) => {
  const vendorToken = await tokenFor(vendorEmail);
  const services = (await api(`/services?search=${encodeURIComponent(serviceName)}`)).data;
  const service = services.find(s => s.serviceName === serviceName);
  const created = await api('/bookings', { token: orgToken, method: 'POST', body: { eventId, serviceId: service._id } });
  const id = created.data._id;
  await api(`/bookings/${id}/confirm`, { token: vendorToken, method: 'POST', body: {} });
  const order = await api(`/payments/bookings/${id}/order`, { token: orgToken, method: 'POST', body: {} });
  const { orderId } = order.data;
  const paymentId = `pay_${orderId}`;
  await api('/payments/verify', { token: orgToken, method: 'POST', body: { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sign(orderId, paymentId) } });
  await Booking.updateOne({ _id: id }, { eventDate: new Date() });
  return { id, service };
};

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27099/festivo');
  const browser = await chromium.launch();
  const orgToken = await tokenFor('rohit@test.in');
  const event = (await api('/events/my-events', { token: orgToken })).data.find(e => !e.isPublic);
  const photo = await paidBookingToday(orgToken, 'flash@test.in', 'Flash Photography', event._id);
  const cake = await paidBookingToday(orgToken, 'priya@test.in', "Priya's Designer Cakes", event._id);

  // 1. Organizer sees the arrival code
  const org = await session(browser, 'organizer');
  await login(org.page, 'rohit@test.in');
  await org.page.goto(`${APP}/bookings/${photo.id}`); await settle(org.page);
  const code = (await org.page.locator('.arrival-code').innerText()).trim();
  check(/^\d{4}$/.test(code), `organizer sees a 4-digit arrival code (${code})`);
  await org.page.screenshot({ path: 'shots/arrival-code-organizer.png', fullPage: false });

  // 2. Vendor, on a phone, enters it on arrival
  const flash = await session(browser, 'vendor-flash');
  await flash.page.setViewportSize({ width: 390, height: 844 });
  await login(flash.page, 'flash@test.in');
  await flash.page.goto(`${APP}/bookings/${photo.id}`); await settle(flash.page);
  check(!(await flash.page.locator('.arrival-code').count()), 'vendor does not see the code');
  await flash.page.locator('#arrival-code').fill(code === '0000' ? '1111' : '0000');
  await flash.page.getByRole('button', { name: "I've arrived" }).click(); await settle(flash.page);
  check(await flash.page.getByText('That code is not right').first().isVisible(), 'wrong code is refused');
  flash.issues.length = 0; // the refused code is an expected 400
  await flash.page.locator('#arrival-code').fill(code);
  await flash.page.getByRole('button', { name: "I've arrived" }).click();
  check(await until(() => flash.page.getByText('Arrival confirmed at').isVisible()), 'vendor confirms arrival with the code');
  const overflow = await flash.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `booking page fits a phone (overflow ${overflow}px)`);
  await flash.page.screenshot({ path: 'shots/arrival-vendor-phone.png', fullPage: false });

  await org.page.reload(); await settle(org.page);
  check(await until(() => org.page.getByText('The vendor arrived at').isVisible()), 'organizer sees the vendor arrived');

  // 3. The baker never came: organizer reports a no-show
  await org.page.goto(`${APP}/bookings/${cake.id}`); await settle(org.page);
  await org.page.getByRole('button', { name: 'Report a problem' }).click();
  const modal = org.page.locator('app-modal').filter({ hasText: 'What went wrong?' });
  check(await modal.getByRole('button', { name: 'Report problem' }).isDisabled(), 'reason and details required');
  await modal.getByLabel("The vendor didn't come").check();
  await org.page.locator('#problem-details').fill("The cake never arrived and Priya isn't answering calls.");
  await modal.getByRole('button', { name: 'Report problem' }).click();
  check(await until(() => org.page.getByText('Problem reported · payment on hold').isVisible()), 'organizer sees the payment is on hold');
  check(!(await org.page.getByRole('button', { name: 'Mark as done' }).count()), '"Mark as done" hidden while the problem is open');
  await org.page.screenshot({ path: 'shots/problem-reported.png', fullPage: false });

  // 4. Vendor replies with their side and a photo
  const priya = await session(browser, 'vendor-priya');
  await login(priya.page, 'priya@test.in');
  await priya.page.goto(`${APP}/bookings/${cake.id}`); await settle(priya.page);
  check(await priya.page.getByText('Your payout is on hold').isVisible(), 'vendor told the payout is frozen and the deadline');
  await priya.page.locator('#dispute-reply').fill('I delivered at 5 pm to the security desk; here is the photo.');
  await priya.page.locator('.evidence-add input[type=file]').setInputFiles(path.join(__dirname, 'photo.jpg'));
  check(await until(() => priya.page.locator('.evidence img').first().isVisible()), 'photo attached');
  await priya.page.getByRole('button', { name: 'Send reply' }).click();
  check(await until(() => priya.page.getByText('You replied on').isVisible()), 'vendor reply sent');

  // 5. Admin settles: part refund and a verified no-show
  const admin = await session(browser, 'admin');
  await login(admin.page, 'admin@test.in');
  await admin.page.goto(`${APP}/admin`); await settle(admin.page);
  await admin.page.getByRole('button', { name: /Problems/ }).click(); await settle(admin.page);
  const card = admin.page.locator('.dispute-card').first();
  check(await card.getByText("Vendor didn't come").isVisible(), 'admin sees the reported problem');
  check(await card.getByText('security desk').isVisible(), "admin sees the vendor's reply");
  await card.locator('select').selectOption('partial');
  await card.locator('input[type=number]').first().fill('900');
  await card.getByLabel(/Record a verified no-show/).check();
  await card.locator('input[placeholder="Why you decided this"]').fill('No delivery record at the gate.');
  await admin.page.screenshot({ path: 'shots/admin-dispute.png', fullPage: true });
  await card.getByRole('button', { name: 'Settle' }).click();
  check(await until(() => admin.page.getByText('No open problems.').isVisible()), 'admin settles it');

  await org.page.reload(); await settle(org.page);
  check(await until(() => org.page.getByText('₹900 was refunded to the organizer').isVisible()), 'organizer sees the partial refund');

  // 6. The no-show is public on the listing
  const slug = (await api(`/services?search=${encodeURIComponent("Priya's Designer Cakes")}`)).data[0].slug;
  await org.page.goto(`${APP}/services/${slug}`); await settle(org.page);
  check(await org.page.getByText('1 verified no-show').isVisible(), 'no-show shown on the vendor page');

  await browser.close();
  await mongoose.disconnect();
  const issues = [...org.issues, ...flash.issues, ...priya.issues, ...admin.issues];
  issues.forEach(x => console.log('ISSUE', x));
  if (issues.length) process.exitCode = 1;
})();
