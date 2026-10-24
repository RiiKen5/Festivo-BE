// Live chat between an organizer and a vendor in two browsers: instant
// delivery, unread badge, seen ticks, typing, and booking from inside the chat.
const { chromium, APP, session, login, settle, api, tokenFor } = require('./lib');

const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) process.exitCode = 1; };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise(r => setTimeout(r, 200)); } return false; };

(async () => {
  const browser = await chromium.launch();
  const me = async (email) => (await api('/auth/me', { token: await tokenFor(email) })).data;
  const priyaId = (await me('priya@test.in'))._id;
  const rohitId = (await me('rohit@test.in'))._id;

  const org = await session(browser, 'rohit');
  const ven = await session(browser, 'priya');
  await login(org.page, 'rohit@test.in');
  await login(ven.page, 'priya@test.in');

  await ven.page.goto(APP + '/dashboard'); await settle(ven.page);
  await org.page.goto(APP + '/messages/' + priyaId); await settle(org.page);
  check(await org.page.getByRole('heading', { name: 'Priya Cakes' }).isVisible(), 'organizer opens a new chat from a link');
  check(await org.page.getByRole('button', { name: 'Request booking' }).isVisible(), '"Request booking" offered because Priya has a service');

  // 1. Instant delivery + unread badge on another page
  await org.page.locator('#composer-input').fill('Hi Priya, are you free on the 12th?');
  await org.page.keyboard.press('Enter');
  check(await until(() => org.page.locator('.bubble--mine .tick').first().getAttribute('aria-label').then(l => l === 'Sent')), 'sender sees ✓ Sent');
  check(await until(() => ven.page.locator('a[href="/messages"] .navbar__count').innerText().then(t => t.trim() === '1')), 'vendor sees Messages badge 1 on the dashboard, without reloading');
  check(await until(() => ven.page.locator('app-toast').innerText().then(t => t.includes('Message from Rohit'))), 'vendor gets a popup for the new message');

  // 2. Vendor opens the chat: message is there, sender's tick turns to Seen
  await ven.page.goto(APP + '/messages'); await settle(ven.page);
  await ven.page.getByRole('button', { name: /Rohit Organizer/ }).click();
  check(await until(() => ven.page.locator('.bubble', { hasText: 'are you free on the 12th' }).isVisible()), 'vendor reads the message');
  check(await until(() => org.page.locator('.bubble--mine .tick').first().getAttribute('aria-label').then(l => l === 'Seen')), 'organizer sees ✓✓ Seen live');
  check(await until(() => ven.page.locator('a[href="/messages"] .navbar__count').count().then(c => c === 0)), 'vendor badge clears after reading');

  // 3. Typing indicator and reply
  await ven.page.locator('#composer-input').pressSequentially('Yes I am', { delay: 40 });
  check(await until(() => org.page.locator('.thread__status').innerText().then(t => t.includes('typing'))), 'organizer sees "typing…"');
  await ven.page.keyboard.press('Enter');
  check(await until(() => org.page.locator('.bubble', { hasText: 'Yes I am' }).isVisible()), 'reply arrives instantly');

  // 4. Booking request from inside the chat
  await org.page.getByRole('button', { name: 'Request booking' }).click();
  await settle(org.page, 300);
  await org.page.locator('app-modal').getByRole('button', { name: 'Send request' }).click();
  check(await until(() => org.page.locator('.event-card').first().innerText().then(t => t.includes('Booking request'))), 'request posted as a card in the chat');
  check(await until(() => org.page.locator('.deal__state').innerText().then(t => t.includes('Waiting for Priya'))), 'organizer panel: waiting for vendor');
  check(await until(() => ven.page.locator('.deal__state').innerText().then(t => t.includes('waiting for your reply'))), 'vendor panel updates live: new request');

  // 5. Vendor accepts with a price from the chat; organizer is told to pay
  await ven.page.getByRole('button', { name: /Accept & send price/ }).click();
  await ven.page.locator('app-modal input[type=number]').fill('2100');
  await ven.page.locator('app-modal').getByRole('button', { name: 'Accept booking' }).click();
  check(await until(() => org.page.locator('.event-card', { hasText: 'Accepted at ₹2100' }).isVisible()), 'acceptance card reaches organizer live');
  check(await until(() => org.page.locator('.deal__state').innerText().then(t => t.includes('pay to lock the date'))), 'organizer panel: pay to lock the date');
  check(await until(() => org.page.locator('.navbar__badge').innerText().then(t => Number(t) >= 1)), 'organizer bell badge updates live');
  await org.page.screenshot({ path: 'shots/chat-organizer.png' });
  await ven.page.screenshot({ path: 'shots/chat-vendor.png' });

  // 6. Phone width: list, then full-screen chat with a back button
  const phone = await browser.newContext({ viewport: { width: 390, height: 780 } });
  const p = await phone.newPage();
  const tok = await tokenFor('priya@test.in');
  await p.goto(APP + '/auth/login');
  await p.locator('app-input[formcontrolname=email] input').fill('priya@test.in');
  await p.locator('app-input[formcontrolname=password] input').fill('Password123!');
  await p.locator('button[type=submit]').click();
  await p.waitForURL(u => !u.pathname.startsWith('/auth'));
  await p.goto(APP + '/messages'); await settle(p);
  check(await p.locator('.inbox').isVisible() && !(await p.locator('.thread').isVisible()), 'phone: conversation list only');
  await p.getByRole('button', { name: /Rohit Organizer/ }).click(); await settle(p);
  check(!(await p.locator('.inbox').isVisible()) && await p.locator('#composer-input').isVisible(), 'phone: full-screen chat with input');
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, 'phone: no sideways scrolling');
  await p.screenshot({ path: 'shots/chat-phone.png' });
  await p.getByRole('button', { name: 'Back to conversations' }).click(); await settle(p);
  check(await p.locator('.inbox').isVisible(), 'phone: back returns to the list');
  await phone.close();
  void tok; void rohitId;

  await browser.close();
  const problems = [...org.issues, ...ven.issues];
  problems.forEach(x => console.log('ISSUE', x));
  if (problems.length) process.exitCode = 1;
})();
