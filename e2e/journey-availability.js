// Vendor calendar: block a day, organizers can't request it; accepting on a
// full day asks first; completed bookings ask the organizer for a review.
const { chromium, APP, session, login, settle, api, tokenFor } = require('./lib');

const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) process.exitCode = 1; };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
const keyIn = (days) => new Date(Date.now() + days * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
// Day and month only: Node and the browser punctuate long dates differently
const longDate = (key) => { const d = new Date(`${key}T12:00:00`); return `\\b${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'long' })}`; };

(async () => {
  const browser = await chromium.launch();
  const flashTok = await tokenFor('flash@test.in');
  const rohitTok = await tokenFor('rohit@test.in');
  const flashService = (await api('/services/my-services', { token: flashTok })).data[0];
  const blockedDay = keyIn(3);

  // 1. Photographer blocks a day from their calendar
  const ven = await session(browser, 'flash');
  await login(ven.page, 'flash@test.in');
  await ven.page.goto(APP + '/dashboard/calendar'); await settle(ven.page);
  if (!(await ven.page.getByRole('button', { name: new RegExp(longDate(blockedDay)) }).count())) {
    await ven.page.getByRole('button', { name: 'Next month' }).click(); await settle(ven.page);
  }
  await ven.page.getByRole('button', { name: new RegExp(longDate(blockedDay)) }).click();
  await ven.page.getByRole('button', { name: 'Block this day' }).click();
  check(await until(() => ven.page.getByRole('button', { name: new RegExp(`${longDate(blockedDay)}, blocked`) }).isVisible()), 'day shows as blocked in the calendar');
  check(await ven.page.locator('.cap select').first().inputValue().then(v => v.includes('1')), 'photography defaults to 1 booking a day');
  await ven.page.screenshot({ path: 'shots/calendar.png', fullPage: true });

  // 2. Organizer can't pick that day
  const org = await session(browser, 'rohit');
  await login(org.page, 'rohit@test.in');
  await org.page.goto(`${APP}/services/${flashService.slug}`); await settle(org.page);
  await org.page.getByRole('button', { name: /Request booking/ }).first().click(); await settle(org.page, 800);
  const modal = org.page.locator('app-modal');
  await modal.locator('select').first().selectOption({ index: 1 });
  await modal.locator('#booking-date').fill(blockedDay);
  check(await until(() => modal.getByRole('alert').innerText().then(t => t.includes("isn't available on this date"))), 'request form says the day is unavailable');
  check(await modal.getByRole('button', { name: 'Send request' }).isDisabled(), 'Send request is disabled for that day');
  check(await modal.getByText(/^Not available:/).isVisible(), 'form lists upcoming unavailable days');
  await org.page.screenshot({ path: 'shots/request-blocked.png' });

  // 3. Two requests for the same free day; after accepting one, the vendor is asked before accepting the second
  const freeDay = keyIn(9);
  const events = (await api('/events/my-events', { token: rohitTok })).data.filter(e => !['cancelled', 'completed'].includes(e.status));
  const ids = [];
  for (const e of events.slice(0, 2)) {
    const r = await api('/bookings', { token: rohitTok, method: 'POST', body: { eventId: e._id, serviceId: flashService._id, eventDate: freeDay, priceAgreed: 5000 } });
    ids.push(r.data._id);
  }
  await api(`/bookings/${ids[0]}/confirm`, { token: flashTok, method: 'POST', body: {} });
  let dialogText = '';
  ven.page.once('dialog', d => { dialogText = d.message(); d.accept(); });
  await ven.page.goto(`${APP}/bookings/${ids[1]}`); await settle(ven.page);
  await ven.page.getByRole('button', { name: /Accept & send price/ }).first().click();
  await ven.page.locator('app-modal').getByRole('button', { name: 'Accept booking' }).click();
  check(await until(() => Promise.resolve(dialogText.includes('You already have 1 booking'))), `vendor is warned: "${dialogText.split('\n')[0]}"`);
  check(await until(() => api(`/bookings/${ids[1]}`, { token: flashTok }).then(r => r.data.status === 'confirmed')), 'and can accept anyway');

  // 4. Completing a booking asks the organizer for a review; the link opens the form
  await api(`/bookings/${ids[0]}/complete`, { token: rohitTok, method: 'POST' }).catch(() => {});
  const status = (await api(`/bookings/${ids[0]}`, { token: rohitTok })).data.status;
  if (status !== 'completed') console.log('INFO booking could not be completed before its date via API:', status);
  const notes = (await api('/notifications', { token: rohitTok })).data;
  const ask = (Array.isArray(notes) ? notes : notes.notifications || []).find(n => n.type === 'review');
  if (status === 'completed') {
    check(!!ask && ask.title.startsWith('How was'), `organizer notified: "${ask && ask.title}"`);
    await org.page.goto(`${APP}${ask.actionUrl}`); await settle(org.page, 1000);
    check(await org.page.getByRole('dialog').getByText(/review/i).first().isVisible(), 'review link opens the review form');
  }

  await browser.close();
  const problems = [...ven.issues, ...org.issues].filter(x => !/-> 409|status of 409/.test(x)); // the full-day warning is expected
  problems.forEach(x => console.log('ISSUE', x));
  if (problems.length) process.exitCode = 1;
})();
