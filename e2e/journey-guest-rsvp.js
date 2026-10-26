// RSVP without an account: a guest opens a private invite link on their phone,
// RSVPs with a name, gets a check-in code, changes their answer; the host sees them.
// A guest also buys a paid ticket with just a name and phone, then cancels it.
const { chromium, APP, session, login, settle, api, tokenFor, FAKE_CHECKOUT } = require('./lib');
const BE = require('path').resolve(__dirname, '..');
const mongoose = require(BE + '/node_modules/mongoose');
const Event = require(BE + '/src/models/Event');

const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) process.exitCode = 1; };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise(r => setTimeout(r, 200)); } return false; };

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27099/festivo');
  const browser = await chromium.launch();
  const mine = (await api('/events/my-events', { token: await tokenFor('rohit@test.in') })).data;
  const party = mine.find(e => !e.isPublic && !e.entryFee);
  const { inviteCode } = await Event.findById(party._id).select('+inviteCode').lean();
  const paid = mine.find(e => e.entryFee > 0);

  // A guest on a phone, not signed in, opens the WhatsApp invite link
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('https://checkout.razorpay.com/**', r => r.fulfill({ contentType: 'application/javascript', body: FAKE_CHECKOUT }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${APP}/events/${party.slug}?invite=${inviteCode}`); await settle(page);
  await page.getByRole('button', { name: /^RSVP$/ }).click();
  const modal = page.locator('app-modal');
  check(await modal.getByText('Only the host sees your name and number').isVisible(), 'privacy promise shown in the RSVP form');
  check(await modal.getByRole('button', { name: 'Confirm RSVP' }).isDisabled(), 'name is required');
  await page.locator('#guest-name').fill('Asha Rao');
  await modal.locator('.guests-btn').last().click();
  await modal.locator('.guests-btn').last().click();
  await modal.getByRole('button', { name: 'Confirm RSVP' }).click();
  check(await until(() => page.locator('.rsvp-status-card').first().innerText().then(t => t.includes("You're going, Asha Rao"))), 'guest sees they are going, without an account');
  const code = await page.locator('.code-value').first().innerText();
  check(/^[A-Z2-9]{8}$/.test(code), `check-in code shown (${code})`);
  await page.screenshot({ path: 'shots/guest-rsvp-phone.png', fullPage: false });

  // Comes back later on the same phone and changes the answer
  await page.reload(); await settle(page);
  check(await until(() => page.locator('.rsvp-status-card').first().isVisible()), 'answer remembered on return');
  await page.getByRole('button', { name: 'Change RSVP' }).click();
  await modal.getByRole('button', { name: /Maybe/ }).click();
  await modal.getByRole('button', { name: 'Update RSVP' }).click();
  check(await until(() => page.locator('.rsvp-status-card').first().innerText().then(t => t.includes('Maybe, Asha Rao'))), 'guest changes to maybe');

  // Paid events: buy a ticket with a name and phone, no account
  await page.goto(`${APP}/events/${paid.slug}`); await settle(page);
  await page.getByRole('button', { name: 'Buy ticket', exact: true }).click();
  check(await modal.getByText('for your ticket and any refund').isVisible(), 'phone asked for the ticket');
  await page.locator('#guest-name').fill('Kiran Shah');
  check(await modal.getByRole('button', { name: 'Continue to Payment' }).isDisabled(), 'phone is required to buy');
  await page.locator('#guest-phone').fill('98765 43210');
  await modal.getByRole('button', { name: 'Continue to Payment' }).click();
  check(await until(() => page.locator('.rsvp-status-card').first().innerText().then(t => t.includes('You have a ticket, Kiran Shah'))), 'guest bought a ticket without an account');
  check(await page.locator('.code-value').first().isVisible(), 'ticket check-in code shown');
  const paidAmount = await page.evaluate(() => window.__lastCheckout && window.__lastCheckout.amount);
  check(paidAmount === paid.entryFee * 100, `charged the ticket price (${paidAmount / 100})`);
  await page.screenshot({ path: 'shots/guest-ticket-phone.png', fullPage: false });

  await page.reload(); await settle(page);
  check(await until(() => page.locator('.rsvp-status-card').first().innerText().then(t => t.includes('You have a ticket'))), 'ticket remembered on return');
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Cancel ticket' }).click();
  check(await until(() => page.getByRole('button', { name: 'Buy ticket, no sign-up needed' }).isVisible()), 'guest cancels the ticket (refund per policy)');

  // When the host passes the fee on, guests see and pay it on top
  await Event.updateOne({ _id: paid._id }, { ticketFeePaidBy: 'guest' });
  await page.reload(); await settle(page);
  await page.getByRole('button', { name: 'Buy ticket', exact: true }).click();
  check(await modal.getByText("Includes Festivo's 5% booking fee").isVisible(), 'fee on top is explained');
  check(await modal.locator('.total-value').innerText().then(t => t.includes(String(Math.round(paid.entryFee * 1.05 * 100) / 100))), 'total includes the fee');
  await modal.getByRole('button', { name: 'Cancel' }).click();
  check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  await ctx.close();

  // The host sees the guest, marked as having no account
  const host = await session(browser, 'host');
  await login(host.page, 'rohit@test.in');
  await host.page.goto(`${APP}/events/${party.slug}`); await settle(host.page, 1200);
  const row = host.page.locator('.guest', { hasText: 'Asha Rao' });
  check(await until(() => row.isVisible()), 'host sees the guest in the guest list');
  check(await row.getByText('no account').isVisible(), 'guest marked as no account');
  await host.page.screenshot({ path: 'shots/guest-rsvp-host.png', fullPage: true });

  await browser.close();
  await mongoose.disconnect();
  host.issues.forEach(x => console.log('ISSUE', x));
  if (host.issues.length) process.exitCode = 1;
})();
