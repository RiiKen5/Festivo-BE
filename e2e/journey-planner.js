// Event planner: create an event, get a checklist with vendor suggestions in
// the event's city, request a vendor from the checklist, tick items off.
const { chromium, APP, session, login, settle, pickCity } = require('./lib');

const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) process.exitCode = 1; };
const inDays = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

(async () => {
  const browser = await chromium.launch();
  const { page, issues } = await session(browser, 'planner');
  await login(page, 'rohit@test.in');

  // City picker: keyboard search on the vendor list filter
  await page.goto(APP + '/services'); await settle(page);
  const filter = page.locator('app-city-select input');
  await filter.fill('beng');
  check(await page.getByRole('option', { name: 'Bengaluru' }).isVisible(), 'city filter suggests Bengaluru for "beng"');
  await filter.press('Enter'); await settle(page);
  check(await filter.inputValue() === 'Bengaluru', 'Enter picks the highlighted city');

  // Create a birthday in Pune
  await page.goto(APP + '/events/create'); await settle(page);
  const f = (n) => page.locator(`app-input[formcontrolname=${n}] input`);
  await f('title').fill('Riya turns 5');
  await page.locator('.type-option').first().click();
  await page.locator('textarea[formcontrolname=description]').fill('Small birthday party at home with family and friends.');
  await f('date').fill(inDays(25));
  await f('time').fill('17:00');
  await f('locationName').fill('Home');
  await pickCity(page, 'Pun');
  await f('address').fill('Baner, Pune');
  await f('expectedGuests').fill('25');
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/events\/riya-turns-5.*new=1/, { timeout: 10000 });
  await settle(page, 1200);

  const planner = page.locator('app-event-planner');
  check(await planner.getByRole('heading', { name: 'Plan your event' }).isVisible(), 'planner is the first thing on the new event');
  check(await planner.getByText("We've added a checklist").isVisible(), 'new event explains the checklist');
  check(await planner.getByText('Order the birthday cake').isVisible() && await planner.getByText('Book decorations').isVisible(), 'birthday checklist created');
  const cakeItem = planner.locator('.item', { hasText: 'Order the birthday cake' });
  check(await cakeItem.getByText("Priya's Designer Cakes").isVisible(), 'cake item suggests a Pune baker');
  await page.screenshot({ path: 'shots/planner-new.png', fullPage: true });

  // Request the baker straight from the checklist
  await cakeItem.getByRole('link', { name: 'Request' }).first().click();
  await page.waitForURL(/\/services\/.*event=/); await settle(page, 1200);
  const modal = page.locator('app-modal');
  check(await modal.locator('select').first().inputValue() !== '', 'request form opens with the event already chosen');
  await modal.getByRole('button', { name: /Send|Request|Confirm/ }).last().click();
  await settle(page, 1000);

  await page.goBack(); await page.goBack().catch(() => {});
  await page.goto(page.url().split('?')[0]); await settle(page, 1200);
  const cakeAfter = page.locator('app-event-planner .item', { hasText: 'Order the birthday cake' });
  check(await cakeAfter.locator('.booked').innerText().then(t => t.includes('Requested')), 'cake item now shows the request instead of suggestions');

  // Tick an item and add one
  const before = await planner.locator('.planner__sub').innerText();
  await planner.locator('.item', { hasText: 'Arrange return gifts' }).locator('.check').click();
  await settle(page, 500);
  check(await planner.locator('.planner__sub').innerText() !== before, 'ticking an item updates progress');
  await page.locator('#planner-add').fill('Buy candles');
  await page.locator('#planner-add').press('Enter');
  check(await planner.getByText('Buy candles').waitFor({ timeout: 5000 }).then(() => true, () => false), 'custom item added inline');
  await page.screenshot({ path: 'shots/planner-progress.png', fullPage: true });

  // Phone width
  await page.setViewportSize({ width: 390, height: 800 }); await settle(page);
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'phone: planner fits without sideways scroll');
  await page.screenshot({ path: 'shots/planner-phone.png', fullPage: true });

  await browser.close();
  issues.forEach(x => console.log('ISSUE', x));
  if (issues.length) process.exitCode = 1;
})();
