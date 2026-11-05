// Vendors offering to events: an organizer asks for offers on their event; a
// vendor nearby finds it (without the organizer's details), sends a price and
// a note from their phone; the organizer accepts and it's a confirmed booking.
const { chromium, APP, session, login, settle, api, tokenFor } = require('./lib');

const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) process.exitCode = 1; };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise(r => setTimeout(r, 200)); } return false; };

(async () => {
  const browser = await chromium.launch();
  const issues = [];

  const orgToken = await tokenFor('rohit@test.in');
  const created = await api('/events', { token: orgToken, method: 'POST', body: {
    title: "Ishaan's 6th birthday", description: 'Small party at home for school friends.', eventType: 'birthday',
    date: new Date(Date.now() + 20 * 86400000).toISOString(), time: '17:00',
    locationName: 'Our flat', address: '12 Lane 5, Koregaon Park', city: 'Pune', expectedGuests: 25
  } });
  check(created.success, 'organizer has an upcoming event');
  const event = created.data;

  // 1. Organizer asks for offers
  const org = await session(browser, 'organizer'); issues.push(org.issues);
  await login(org.page, 'rohit@test.in');
  await org.page.goto(`${APP}/events/${event._id}`); await settle(org.page);
  const section = org.page.locator('#offers');
  check(await until(() => section.getByRole('heading', { name: 'Offers from vendors' }).isVisible()), 'organizer sees the offers section');
  check(await section.getByRole('button', { name: 'Ask vendors for offers' }).isDisabled(), 'must pick what they need first');
  await section.getByLabel('Food & cakes').check();
  await section.getByLabel('Decoration').check();
  await org.page.locator('#offers-note').fill('Dinosaur theme, eggless please');
  await section.getByRole('button', { name: 'Ask vendors for offers' }).click();
  check(await until(() => section.getByText('Vendors can send offers for:').isVisible()), 'event is open to offers');

  // 2. A baker on their phone finds it and sends an offer
  const priya = await session(browser, 'vendor'); issues.push(priya.issues);
  await priya.page.setViewportSize({ width: 390, height: 844 });
  await login(priya.page, 'priya@test.in');
  await priya.page.goto(`${APP}/dashboard/find-events`); await settle(priya.page);
  const lead = priya.page.locator('.lead', { hasText: 'Dinosaur theme' });
  check(await until(() => lead.isVisible()), 'vendor sees the event');
  const text = await lead.innerText();
  check(text.includes('25 guests') && text.includes('Pune') && text.includes('Food & cakes'), 'vendor sees date, city, guests and what is needed');
  check(!/Rohit|Koregaon|Ishaan/.test(text), "vendor doesn't see the organizer, address or private title");
  await lead.getByRole('button', { name: 'Send offer' }).click();
  await priya.page.locator('#offer-price').fill('2600');
  await priya.page.locator('#offer-message').fill('1.5 kg eggless dinosaur cake with name topper, delivered by 4 pm.');
  await priya.page.screenshot({ path: 'shots/offer-send-phone.png', fullPage: false });
  await priya.page.locator('app-modal').getByRole('button', { name: 'Send offer' }).click();
  check(await until(() => lead.getByText('Waiting for the organizer').isVisible()), 'offer sent');
  const overflow = await priya.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `find events fits a phone (overflow ${overflow}px)`);
  await priya.page.screenshot({ path: 'shots/find-events-phone.png', fullPage: false });

  // 3. The organizer accepts: it's a confirmed booking
  await org.page.reload(); await settle(org.page);
  const offer = org.page.locator('#offers .offer', { hasText: "Priya's Designer Cakes" });
  check(await until(() => offer.isVisible()), 'organizer sees the offer');
  check(await offer.getByText('₹2,600').isVisible(), 'with the price');
  await section.screenshot({ path: 'shots/offers-organizer.png' });
  org.page.once('dialog', d => d.accept());
  await offer.getByRole('button', { name: 'Accept' }).click();
  await org.page.waitForURL(/\/bookings\//, { timeout: 8000 });
  await settle(org.page);
  check(await until(() => org.page.getByText(/accepted · pay to book the date/).first().isVisible()), 'organizer lands on the confirmed booking, ready to pay');

  const bookings = (await api('/bookings?role=organizer', { token: orgToken })).data;
  const booking = bookings.find(b => b.event && (b.event._id || b.event) === event._id);
  check(booking && booking.status === 'confirmed' && booking.priceAgreed === 2600 && booking.source === 'marketplace', 'booking at the offered price, counted as a new customer');

  await priya.page.goto(`${APP}/dashboard/find-events`); await settle(priya.page);
  await priya.page.getByRole('button', { name: 'Offers you sent' }).click();
  check(await until(() => priya.page.getByText('Accepted · now a booking').isVisible()), 'vendor sees it was accepted');

  await browser.close();
  const all = issues.flat();
  all.forEach(x => console.log('ISSUE', x));
  if (all.length) process.exitCode = 1;
})();
